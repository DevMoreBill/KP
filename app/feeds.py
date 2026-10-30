"""Фиды поставщиков (YML и из файлов): загрузка в каталог, ежедневная проверка цен и наличия, страницы товаров."""

import functools
import hashlib
import html as html_mod
import http.cookiejar
import json
import math
import os
import re
import struct
import threading
import urllib.parse
import urllib.request
import zlib
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from enum import Enum
from typing import Any
from xml.etree import ElementTree

import catalog_migrate
import feed_files
import images
import imgfetch
from config import DATA_DIR
from defaults import SrvVal
from feed_photo import FeedPhotoFrom
from maker_logos import MakerLogos
from storage import Conflict, WriteBatch

PERCENT_MAX = 100
DESC_MIN = 40
PROP_KEY_MAX = 80
PROP_VAL_MAX = 300
LINE_MIN = 2
TAB_TITLE_MIN = 3
PROBE_MAX = 80
BLANK_AREA = 40000
BLANK_DENSITY = 0.012
DESC_SHORT = 200
JPEG_MARK = 0xFF
PRESSURE_MIN = 2
PRESSURE_MAX = 60
PRESSURE_NEAR = 0.6
CUR_AT = 3
NOIMG_SHOWN = 3
SAMPLE_MAX = 8
STUB_CATS = 4

KV_KEY = 'feeds'
CACHE_SEC = 1800  # скачанный фид YML годен полчаса
IMAGE_STORE: Any = None  # хранилище изображений data/img (images.ImageStore) — задаёт kp_server при запуске
JOBS: dict = {}  # id фида → {kind, state, done, total, msg, startedAt, result}
_CACHE: dict = {}  # id фида → (время, url, разобранный фид) — предпросмотр и загрузка без повторного скачивания
_LOCK = threading.Lock()
STOCK_TAGS = ('count', 'quantity', 'stock_quantity', 'stock', 'amount', 'qty', 'instock', 'in_stock')
STOCK_PARAM = re.compile(r'^(остаток|остатки|наличие|в наличии|количество( на складе)?|склад)$', re.I)
WH_PARAM = re.compile(
    r'^(?:склад|остаток на складе|остаток)\s+(?:в\s+)?(\S.*)$', re.I
)  # «Склад Новосибирск» = 2 — остаток склада
BRAND_PARAM = re.compile(r'^(бренд|марка|производитель|торговая марка)$', re.I)
JUNK_PARAM = re.compile(r'^(array|object|null|undefined)$', re.I)  # «Картинки галереи: Array» — служебные поля сайта
JUNK_PNAME = re.compile(
    r'\(для авито\)|^(цена|стоимость)\b|^(картинки галереи|полезные документы|видео)$', re.I
)  # поля для площадок, цена


class FeedSupplier:
    @staticmethod
    def id(v) -> str:
        """Поставщик из справочника, к которому привязан фид (id); пусто — поставщик = название фида."""
        v = str(v or '').strip()
        return v if re.match(r'^[A-Za-z0-9_-]{1,64}$', v) else ''


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def parse_number(v) -> float | None:
    """Число из фида; «nan», «inf» и прочее не число — None (иначе в карточку попало бы Infinity, а NaN ронял проверку фида)."""
    try:
        num = float(re.sub(r'[\s\xa0]', '', str(v)).replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) else None


def _txt(el, tag) -> str:
    x = el.find(tag)
    return re.sub(r'\s+', ' ', x.text).strip() if x is not None and x.text else ''


def _html_text(text) -> str:
    """Описание из фида (часто HTML) → обычный текст с абзацами."""
    text = re.sub(r'(?i)<\s*(br|/p|/div|/li|/h\d)\s*/?>', '\n', str(text or ''))
    text = re.sub(r'(?i)<li[^>]*>', '• ', text)
    text = re.sub(r'<[^>]+>', '', text)
    for pattern, repl in (
        ('&nbsp;', ' '),
        ('&laquo;', '«'),
        ('&raquo;', '»'),
        ('&mdash;', '—'),
        ('&ndash;', '–'),
        ('&quot;', '"'),
        ('&amp;', '&'),
        ('&lt;', '<'),
        ('&gt;', '>'),
        ('&#039;', "'"),
    ):
        text = text.replace(pattern, repl)
    text = re.sub(r'\s*(?:\b(?:в|во|на|по)\s+)?#[A-Z0-9_]+#', '', text)  # шаблоны сайта: «в #REGION_NAME_DECLINE_PP#»
    lines = [re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in text.split('\n')]
    return '\n'.join(x for x in lines if x)[:6000]


def feeds(store) -> list:
    return (store.kv_get(KV_KEY) or {}).get('items') or []


def feed_get(store, fid: str) -> dict | None:
    return next((feed for feed in feeds(store) if feed.get('id') == fid), None)


def _cats_ok(cats) -> dict:
    return {str(k)[:40]: v[:40] for k, v in cats.items() if isinstance(v, str) and v}


def feed_save(store, feed) -> dict:
    kind = 'files' if feed.get('kind') == 'files' else 'yml'
    url = str(feed.get('url') or '').strip()
    if kind == 'yml' and not re.match(r'^https?://', url, re.I):
        raise ValueError('Укажите адрес фида (http или https)')
    if kind == 'files' and not str(feed.get('name') or '').strip():
        raise ValueError('Укажите название фида — например, имя поставщика')
    items = feeds(store)
    fid = feed.get('id') or images.slug(feed.get('name') or urllib.parse.urlsplit(url).hostname or 'feed', 30) or 'feed'
    old = next((x for x in items if x.get('id') == fid), None) or {}
    if not feed.get('id') and any(x.get('id') == fid for x in items):
        fid = f'{fid}-{len(items) + 1}'
    disc = parse_number(feed.get('discount'))
    rec = dict(
        old,
        id=fid,
        kind=kind,
        name=str(feed.get('name') or old.get('name') or fid).strip()[:80],
        url=url,
        maker=str(feed.get('maker') or '').strip()[:120],
        discount=disc if disc and 0 < disc < PERCENT_MAX else None,
        auto=feed.get('auto', kind == 'yml') is True,
        pageDesc=feed.get('pageDesc', old.get('pageDesc', kind == 'yml')) is True,
        cats=_cats_ok(feed.get('cats')) if isinstance(feed.get('cats'), dict) else old.get('cats') or {},
        supplier=FeedSupplier.id(feed['supplier'] if 'supplier' in feed else old.get('supplier')),
        updatedAt=_now(),
    )
    rec['discounts'] = (
        discount_rules(feed['discounts']) if isinstance(feed.get('discounts'), list) else old.get('discounts') or []
    )
    rec['filter'] = (
        FeedRules.clean_filter(feed['filter'])
        if isinstance(feed.get('filter'), dict)
        else old.get('filter') or FeedRules.clean_filter({})
    )
    rec['fields'] = (
        FeedRules.clean_fields(feed['fields'])
        if isinstance(feed.get('fields'), dict)
        else old.get('fields') or FeedRules.clean_fields({})
    )
    hints = got_value if isinstance(got_value := feed.get('driveHints'), dict) else old.get('driveHints') or {}
    rec['driveHints'] = {k: re.sub(r'\s+', ' ', str(hints.get(k) or '')).strip()[:400] for k in ('belt', 'direct')}
    if kind == 'files':
        cur = str(feed.get('cur') or old.get('cur') or '').upper()[:3]
        rec.update(
            priceKind='rrc' if feed.get('priceKind', old.get('priceKind')) == 'rrc' else 'cost',
            cur=cur if re.match(r'^[A-Z]{3}$', cur) else '',
            priceOnly=feed.get('priceOnly', old.get('priceOnly')) is True,
            files=old.get('files') or {},
        )
    items = [x for x in items if x.get('id') != fid] + [rec]
    store.kv_set(KV_KEY, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return rec


def price_files(feed) -> list:
    """Прайсы фида из файлов: [мета + slot]; прежний единственный прайс — слот «price»."""
    files = feed.get('files') or {}
    out = [dict(meta) for meta in files.get('prices') or []]
    if files.get('price') and not any(meta.get('slot') == 'price' for meta in out):
        out.insert(0, dict(files['price'], slot='price'))
    return out


class PriceSlots:
    """Какой прайс фида заменяет новый файл: явно выбранный, тот же по имени файла (дата не важна) или новый."""

    NEW = 'new'

    @classmethod
    def pick(cls, have: list, name, slot) -> tuple[str, dict | None]:
        """→ (слот, мета заменяемого прайса | None — новый прайс)."""
        if slot and slot != cls.NEW:
            old = next((meta for meta in have if meta['slot'] == slot), None)
            if not old:
                raise ValueError('Прайс для замены не найден — обновите страницу')
            return slot, old
        key = feed_files.price_slot(name)
        old = next(
            (meta for meta in have if meta['slot'] == key or feed_files.price_slot(meta.get('name')) == key), None
        )
        if old is None and slot != cls.NEW and len(have) == 1 and have[0]['slot'] == 'price':
            old = have[0]  # прежний единственный прайс фида — заменяется
        if old:
            return old['slot'], old
        return cls.free(have, name), None

    @staticmethod
    def free(have: list, name) -> str:
        """Свободный слот для нового прайса по имени файла."""
        key = feed_files.price_slot(name)
        free, slot_no = key, 2
        while any(meta['slot'] == free for meta in have):
            free, slot_no = f'{key}-{slot_no}', slot_no + 1
        return free


def feed_file_put(store, fid: str, kind, data, name, slot=None) -> dict:
    """Файл фида (парс сайта / прайс / остатки): сохранить на диск, запомнить мету в настройках фида; → мета."""
    feed = feed_get(store, fid)
    if not feed:
        raise ValueError('Фид не найден')
    if (kind == 'extra') == (feed.get('kind') == 'files'):
        raise ValueError('Фид из файлов принимает парс, прайсы и остатки; фид YML — только файл описаний (JSON)')
    old = None
    if kind == 'price':
        slot, old = PriceSlots.pick(price_files(feed), name, slot)
    meta = feed_files.save_file(DATA_DIR, fid, kind, data, name, slot if kind == 'price' else None)
    items = feeds(store)
    for x in items:
        if x.get('id') != fid:
            continue
        files = x.setdefault('files', {})
        if kind == 'price':
            if old:  # валюта, выбранная для прайса вручную, сохраняется при замене файла
                meta.update({k: old[k] for k in ('curSet', 'curSheets') if old.get(k)})
            lst = [slot_meta for slot_meta in price_files(x) if slot_meta['slot'] != slot] + [meta]
            files['prices'] = lst
            files.pop('price', None)
        else:
            files[kind] = meta
        x['updatedAt'] = _now()
    store.kv_set(KV_KEY, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return meta


def feed_file_set(store, fid: str, kind, slot, act, cur='', sheet='') -> dict | None:
    """Файл фида: act = drop — убрать; cur — валюта прайса (sheet — для одного листа)."""
    items = feeds(store)
    x = next((i for i in items if i.get('id') == fid), None)
    if not x or (x.get('kind') != 'files' and kind != 'extra'):
        raise ValueError('Фид из файлов не найден')
    files = x.setdefault('files', {})
    cur = str(cur or '').upper()[:3]
    if cur and not re.match(r'^[A-Z]{3}$', cur):
        raise ValueError('Валюта — трёхбуквенный код (EUR, USD, RUB, CNY)')
    if kind in ('stock', 'extra') and act == 'drop':
        feed_files.drop_file(DATA_DIR, fid, kind)
        files.pop(kind, None)
    elif kind == 'price':
        lst = price_files(x)
        meta = next((i for i in lst if i['slot'] == slot), None)
        if not meta:
            raise ValueError('Прайс не найден')
        if act == 'drop':
            feed_files.drop_file(DATA_DIR, fid, 'price', slot)
            lst = [i for i in lst if i['slot'] != slot]
        elif act == 'cur':
            if sheet:
                cur_sheets = dict(meta.get('curSheets') or {})
                if cur:
                    cur_sheets[sheet[:80]] = cur
                else:
                    cur_sheets.pop(sheet[:80], None)
                meta['curSheets'] = cur_sheets
            else:
                meta['curSet'] = cur
        files['prices'] = lst
        files.pop('price', None)
    else:
        raise ValueError('Неизвестное действие')
    x['updatedAt'] = _now()
    store.kv_set(KV_KEY, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return x


def load_prices(feed, root: str = '') -> list:
    """Строки всех прайсов фида с валютой (лист → прайс → файл → фид); «Распродажа» — в конце.
    root — папка данных с файлами фида (черновик обновления, feed_update.FeedDraft), иначе — папка программы."""
    out = []
    for meta in price_files(feed):
        data = feed_files.read_file(root or DATA_DIR, feed['id'], 'price', meta['slot'])
        if not data:
            continue
        rows = feed_files.parse_price(data)[0]
        cur_sheets = meta.get('curSheets') or {}
        for row in rows:
            row['cur'] = (
                cur_sheets.get(row['sheet']) or row.get('cur') or meta.get('curSet') or (feed.get('cur') or '').upper()
            )
            row['file'] = meta.get('name') or meta['slot']
        out += rows
    return [row for row in out if not row.get('sale')] + [row for row in out if row.get('sale')]


def feed_delete(store, fid: str) -> None:
    store.kv_set(KV_KEY, {'items': [x for x in feeds(store) if x.get('id') != fid]})
    feed_files.remove_files(DATA_DIR, fid)
    with _LOCK:
        _CACHE.pop(fid, None)


def log_of(store, fid: str) -> list:
    return store.kv_get('feedlog:' + fid) or []


def _log_add(store, fid: str, rec) -> None:
    log = [rec, *log_of(store, fid)]
    store.kv_set('feedlog:' + fid, log[: SrvVal.get(store, 'cat.feedLog')])


def fetch(url) -> bytes:
    url = imgfetch.web_url(url)
    imgfetch._check_url(url)  # только http(s) и не адреса локальной сети
    req = urllib.request.Request(
        url, headers={'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh feed)', 'Accept': 'application/xml,text/xml,*/*'}
    )
    with imgfetch.SafeWeb.opener().open(req, timeout=120) as resp:
        max_mb = SrvVal.now('cat.feedMaxMB')
        data = resp.read(max_mb * 1024 * 1024 + 1)
    if len(data) > max_mb * 1024 * 1024:
        raise ValueError(f'Фид больше {max_mb} МБ (предел — «Настройки → Значения программы»)')
    return data


PAGE_MAX = 3 * 1024 * 1024
PAGE_V = 5  # версия разбора страницы: при смене кэш перечитывается
# описание со страницы товара запоминается на 30 дней — cat.pageDays («Значения программы»)
_PAGE_SEM = threading.Semaphore(3)  # не больше 3 страниц сайта одновременно


_PAGE_JAR = http.cookiejar.CookieJar()  # cookie сайта (сессия, проверка «не робот») — общие для всех страниц


def _inflate(data, wbits, limit: int = PAGE_MAX * 8) -> bytes:
    """Распаковка ответа сайта с пределом: «сжатая бомба» (маленький архив → гигабайты) не займёт всю память."""
    decomp = zlib.decompressobj(wbits)
    out = decomp.decompress(data, limit)
    if decomp.unconsumed_tail:
        raise ValueError(f'страница после распаковки больше {limit // 1048576} МБ')
    return out


def is_product_page(html) -> bool:
    """Страница товара, а не заглушка защиты от роботов: есть заголовок <h1> и признаки карточки товара."""
    return bool(
        re.search(r'<h1\b', html, re.I)
        and re.search(
            r'itemprop\s*=\s*["\'](?:name|image|description|offers)["\']|data-fancybox|/upload/(?:iblock|medialibrary)/|detail-text',
            html,
            re.I,
        )
    )


def page_html(url, accept=is_product_page) -> str:
    """Страница на сайте поставщика (та же защита, что у фида и фото); accept — проверка, что это страница товара."""
    url = imgfetch.web_url(url)
    imgfetch._check_url(url)
    u = urllib.parse.urlsplit(url)
    headers = {
        'User-Agent': imgfetch.BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Referer': f'{u.scheme}://{u.netloc}/',
    }
    opener = imgfetch.SafeWeb.opener(urllib.request.HTTPCookieProcessor(_PAGE_JAR))

    def get() -> tuple:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=25) as resp:
            return (
                resp.headers.get('Content-Type') or '',
                (resp.headers.get('Content-Encoding') or '').lower(),
                resp.read(PAGE_MAX),
            )

    with _PAGE_SEM:
        ctype, enc, data = imgfetch.retry(get)
    if enc == 'gzip' or data[:2] == b'\x1f\x8b':
        data = _inflate(data, 16 + zlib.MAX_WBITS)
    elif enc == 'deflate':
        try:
            data = _inflate(data, zlib.MAX_WBITS)
        except zlib.error:
            data = _inflate(data, -zlib.MAX_WBITS)
    match = re.search(r'charset=([\w-]+)', ctype, re.I) or re.search(
        rb'<meta[^>]+charset=["\']?([\w-]+)', data[:4096], re.I
    )
    charset = match.group(1) if match else 'utf-8'
    charset = charset.decode('ascii', 'ignore') if isinstance(charset, bytes) else charset
    try:
        html = data.decode(charset)
    except (LookupError, UnicodeDecodeError):
        try:
            html = data.decode('utf-8')
        except UnicodeDecodeError:
            html = data.decode('cp1251', errors='replace')
    if accept and not accept(html):
        raise ValueError('сайт отдал не страницу товара (проверка «не робот» или ошибка сайта)')
    return html


def _inner_html(html, match) -> str:
    """Содержимое элемента, открывающий тег которого найден m (group(1) — имя тега): с учётом вложенных таких же тегов."""
    tag, depth, pos = match.group(1).lower(), 1, match.end()
    for tag_match in re.finditer(rf'<(/?){re.escape(tag)}\b[^>]*>', html[pos:], re.I):
        depth += -1 if tag_match.group(1) else (0 if tag_match.group(0).endswith('/>') else 1)
        if depth == 0:
            return html[pos : pos + tag_match.start()]
    return html[pos : pos + 20000]


def page_desc(html) -> str:
    """Описание товара со страницы: элемент itemprop="description" (Битрикс: div.detail-text-wrap)."""
    html = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1\s*>', '', html or '')
    for regex in (
        r'<(\w+)\b[^>]*\bitemprop\s*=\s*["\']description["\'][^>]*>',
        r'<(\w+)\b[^>]*\bclass\s*=\s*["\'][^"\']*\bdetail-text-wrap\b[^"\']*["\'][^>]*>',
    ):
        for match in re.finditer(regex, html, re.I):
            if match.group(1).lower() in ('meta', 'link'):
                continue
            text = _no_sales(_html_text(_inner_html(html, match)))
            if len(text) >= DESC_MIN:
                return text
    return ''


SALES_RX = (
    r'(?i)tel:|\b8[\s-]?800\b|\+7[\s(]|\b8[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b|оставьте заявку|'
    r'обратн\S* связ|свяжутся с\s*вами|наши (специалисты|менеджеры)|чтобы купить|купить .{0,60}\bв\s+(тд|торгов)|'
    r'@|https?://|www\.|\.(ru|org|com|by)\b|наша компания предлагает|получите подробную информацию|у нашего консультанта|'
    r'помогут подобрать|наши квалифицированные|наших квалифицированных|'
    r'представляет собой неприхотлив|характерна величина рабочего давления'
)  # шаблонный текст сайта вместо описания


def _no_sales(text) -> str:
    """Абзацы-призывы сайта поставщика («Чтобы купить … в ТД …, оставьте заявку по телефону …») в КП не нужны."""
    return '\n'.join(x for x in text.split('\n') if not re.search(SALES_RX, x))


APPLY_RX = (
    r'применяемост|применимост|подходит (?:для|к)|совместим|для моделей|применяется (?:в|для|на)|'
    r'^модел\S*\s+(?:компрессор|оборудован|осушител|техник)'
)


def page_images(html, url, limit: int = 8) -> list:
    """Фото товара — только из галереи карточки (шаблон Аспро / Битрикс)."""
    out = []
    match = re.search(
        r'<(div)\b[^>]*\bclass\s*=\s*["\'][^"\']*product-detail-gallery__slider--big[^"\']*["\'][^>]*>', html, re.I
    )
    if match:
        block = _inner_html(html, match)
        links = re.findall(
            r'<a\b[^>]*\bclass\s*=\s*["\'][^"\']*product-detail-gallery__link[^>]*>', block, re.I
        ) or re.findall(r'<a\b[^>]*\bdata-fancybox\s*=\s*["\']gallery["\'][^>]*>', block, re.I)
    else:  # другой шаблон: только ссылки галереи увеличения
        links = re.findall(r'<a\b[^>]*\bdata-fancybox\s*=\s*["\']gallery["\'][^>]*>', html, re.I)
    for tag in links:
        href = re.search(r'\bhref\s*=\s*["\']([^"\']+)', tag, re.I)
        if not href or not re.search(r'\.(?:jpe?g|png|webp)(?:\?|$)', href.group(1), re.I):
            continue
        u = urllib.parse.urljoin(url, html_mod.unescape(href.group(1)).strip())
        if '/resize_cache/' not in u and re.match(r'^https?://', u) and u not in out:
            out.append(u)
    return out[:limit]


# фото товара на любом сайте: что точно не фото оборудования
IMG_SKIP = (
    r'(?i)logo|icon|sprite|favicon|banner|placeholder|no[-_]?(?:photo|image|img)|noimage|blank|loader|spinner|captcha|'
    r'counter|pixel|social|telegram|whatsapp|vk[-_.]|youtube|payment|/flags?/|rating|stars?[-_.]|arrow|button|avatar|cert|'
    r'sertif|diplom|/menu/|header|footer|watermark|preview_?[0-9]{2}x'
)
IMG_ATTRS = (
    'data-zoom-image',
    'data-large',
    'data-large_image',
    'data-full',
    'data-original',
    'data-big',
    'data-src',
    'data-lazy-src',
    'src',
)
GAL_RX = (
    r'<(\w+)\b[^>]*\bclass\s*=\s*["\'][^"\']*(?:gallery|slider|swiper|carousel|fotorama|zoom|lightbox|product[-_]?(?:image|img|photo|pic|media|gallery)|'
    r'detail[-_]?(?:image|img|photo|pic)|item[-_]?(?:image|photo)|main[-_]?(?:image|photo))[^"\']*["\'][^>]*>'
)


def page_images_any(html, url, limit: int = 12) -> list:
    """Фото товара с любого сайта: галерея, og:image, JSON-LD, крупные картинки страницы."""
    out, seen = [], set()

    def add(u, pattern=r'\.(jpe?g|png|webp)$') -> None:
        u = html_mod.unescape(str(u or '')).strip().split(' ')[0]
        if not u or u.startswith('data:'):
            return
        u = urllib.parse.urljoin(url, u)
        key = u.split('?')[0].lower()
        if (
            not re.match(r'^https?://', u)
            or key in seen
            or re.search(IMG_SKIP, key)
            or re.search(r'\.(svg|gif|ico)$', key)
        ):
            return
        if not re.search(pattern, key):
            return
        seen.add(key)
        out.append(u)

    for u in page_images(html, url, limit):
        add(u)
    for x in LdJson.products(html, LdJson.ANY_RX):
        image = x.get('image')
        for v in image if isinstance(image, list) else [image]:
            add(v.get('url') or v.get('contentUrl') if isinstance(v, dict) else v, pattern='')
    for regex in (
        r'<meta\b[^>]*\bproperty\s*=\s*["\']og:image(?::url)?["\'][^>]*\bcontent\s*=\s*["\']([^"\']+)',
        r'<meta\b[^>]*\bcontent\s*=\s*["\']([^"\']+)["\'][^>]*\bproperty\s*=\s*["\']og:image["\']',
        r'<(?:img|link|meta)\b[^>]*\bitemprop\s*=\s*["\']image["\'][^>]*\b(?:src|href|content)\s*=\s*["\']([^"\']+)',
    ):
        for match in re.finditer(regex, html, re.I):
            add(match.group(1), pattern='')
    for match in re.finditer(
        r'<a\b[^>]*(?:data-fancybox|data-lightbox|data-zoom|rel\s*=\s*["\'](?:lightbox|gallery)|class\s*=\s*["\'][^"\']*(?:fancybox|lightbox|zoom|gallery))[^>]*>',
        html,
        re.I,
    ):
        href = re.search(r'\bhref\s*=\s*["\']([^"\']+)', match.group(0), re.I)
        if href:
            add(href.group(1))
    for match in re.finditer(GAL_RX, html, re.I):
        if len(out) >= limit:
            break
        for tag in re.findall(r'<img\b[^>]*>', _inner_html(html, match)[:60000], re.I):
            for attr in IMG_ATTRS:
                v = re.search(rf'\b{attr}\s*=\s*["\']([^"\']+)', tag, re.I)
                if v:
                    add(v.group(1))
                    break
    return out[:limit]


def _unesc(v) -> str:
    return re.sub(r'\s+', ' ', html_mod.unescape(html_mod.unescape(v or ''))).strip()


def _schema_props(html) -> list:
    """Свойства schema.org (itemprop="additionalProperty"): <meta itemprop="name|value" content> или текст элементов."""
    out = []
    for match in re.finditer(r'<(\w+)\b[^>]*\bitemprop\s*=\s*["\']additionalProperty["\'][^>]*>', html, re.I):
        block = _inner_html(html, match)[:4000]
        props = {}
        for key_name in ('name', 'value'):
            x = re.search(
                rf'<meta\b[^>]*\bitemprop\s*=\s*["\']{key_name}["\'][^>]*\bcontent\s*=\s*"([^"]*)"', block, re.I
            ) or re.search(rf'<(\w+)\b[^>]*\bitemprop\s*=\s*["\']{key_name}["\'][^>]*>(.*?)</\1>', block, re.I | re.S)
            if x:
                props[key_name] = _unesc(re.sub(r'<[^>]+>', ' ', x.group(x.lastindex or 0)))
        k, v = (props.get('name') or '').strip(' :'), props.get('value') or ''
        if k and v:
            out.append([k, v])
    return out


def page_crumbs(html) -> str:
    """Раздел товара по «хлебным крошкам» (schema.org BreadcrumbList) без «Главная» и «Каталог»."""
    match = re.search(r'<(\w+)\b[^>]*\bitemtype\s*=\s*["\'][^"\']*BreadcrumbList["\'][^>]*>', html, re.I)
    if not match:
        return ''
    names = []
    for item in re.split(r'(?=<\w+\b[^>]*\bitemprop\s*=\s*["\']itemListElement["\'])', _inner_html(html, match))[1:]:
        x = re.search(r'<a\b[^>]*\bhref[^>]*>.*?\bitemprop\s*=\s*["\']name["\'][^>]*>(.*?)</', item, re.I | re.S)
        name = _unesc(re.sub(r'<[^>]+>', '', x.group(1))) if x else ''
        if name and not re.match(r'(?i)^(главная|каталог|home)$', name):
            names.append(name)
    return ' / '.join(names)[:300]


PROP_PATS = (
    r'<tr\b[^>]*>\s*<t[dh]\b[^>]*>(.*?)</t[dh]>\s*<td\b[^>]*>(.*?)</td>',
    r'<dt\b[^>]*>(.*?)</dt>\s*<dd\b[^>]*>(.*?)</dd>',
    r'class\s*=\s*["\'][^"\']*(?:prop|char|param|spec|attr|feature)[^"\']*(?:name|title|label|key)[^"\']*["\'][^>]*>(.*?)</\w+>.{0,400}?'
    r'class\s*=\s*["\'][^"\']*(?:prop|char|param|spec|attr|feature)[^"\']*(?:value|val)[^"\']*["\'][^>]*>(.*?)</\w+>',
)
# список характеристик без таблицы: <li><span>Мощность</span><span>22 кВт</span></li>
PROP_LI = (
    r'<li\b[^>]*>\s*<(span|div|b|strong)\b[^>]*>(.*?)</\1>\s*(?:<[^>]*>\s*)*?<(span|div)\b[^>]*>(.*?)</\3>\s*</li>'
)


class PropList:
    """Списки «название — значение» (<li><span>…</span><span>…</span></li>) — правило внутри одного пункта."""

    ITEM = re.compile(r'<li\b[^>]*>.*?</li>', re.I | re.S)
    PAIR = re.compile(PROP_LI, re.I | re.S)

    @classmethod
    def pairs(cls, html) -> list:
        return [
            (match.group(2), match.group(4))
            for item in cls.ITEM.finditer(html)
            for match in [cls.PAIR.fullmatch(item.group(0))]
            if match
        ]


def _table_props(html, pats=PROP_PATS, extra=lambda html: [], limit: int = 60) -> list:
    """Пары из таблиц, dt/dd, блоков свойств (Битрикс и др.); extra(html) — ещё пары (списки «название — значение»)."""
    html = re.sub(r'(?is)<div\b[^>]*\bbasket_props_block\b.*?</table>', '', html)  # скрытый выбор свойств корзины
    out, seen = [], set()
    found = [(match.group(1), match.group(2)) for regex in pats for match in re.finditer(regex, html, re.I | re.S)]
    found += extra(html)
    for key, val in found:
        k = re.sub(r'\s+', ' ', _html_text(key)).strip(' :')
        v = re.sub(r'\s*\n\s*', '; ', _html_text(val)).strip(' ;')
        if (
            1 < len(k) <= PROP_KEY_MAX
            and 0 < len(v) <= PROP_VAL_MAX
            and k.lower() not in seen
            and not re.search(SALES_RX, k + ' ' + v)
        ):
            seen.add(k.lower())
            out.append([k, v])
    return out[:limit]


def page_props(html) -> list:
    """Пары «название — значение» со страницы: свойства schema.org, иначе таблицы, dt/dd и блоки свойств Битрикса."""
    out = _schema_props(html)
    if out:
        return out[:60]
    return _table_props(html)


class LdJson:
    """Товары schema.org Product из JSON-LD страницы, в том числе в @graph и списках."""

    ANY_RX = re.compile(r'(?is)<script\b[^>]*application/ld\+json[^>]*>(.*?)</script>')
    TYPE_RX = re.compile(r'(?is)<script\b[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>')

    @staticmethod
    def products(html, regex) -> Iterator[dict]:
        for match in regex.finditer(html):
            try:
                data = json.loads(match.group(1).strip())
            except ValueError:
                continue
            stack = data if isinstance(data, list) else [data]
            while stack:
                x = stack.pop()
                if isinstance(x, list):
                    stack.extend(x)
                    continue
                if not isinstance(x, dict):
                    continue
                stack.extend(v for v in x.values() if isinstance(v, (dict, list)))
                kind = x.get('@type')
                if kind == 'Product' or (isinstance(kind, list) and 'Product' in kind):
                    yield x


def _ld_product(html) -> tuple:
    """Товар из JSON-LD (schema.org Product): описание и additionalProperty — многие сайты кладут их только туда."""
    desc, props = '', []
    for x in LdJson.products(html, LdJson.TYPE_RX):
        desc_text = _html_text(_unesc(str(x.get('description') or '')))
        if len(desc_text) > len(desc):
            desc = desc_text
        for prop in x.get('additionalProperty') or []:
            if isinstance(prop, dict) and prop.get('name') and prop.get('value') not in (None, ''):
                props.append(
                    [
                        str(prop['name']).strip(' :')[:80],
                        (str(prop['value']) + (' ' + str(prop['unitText']) if prop.get('unitText') else ''))[:300],
                    ]
                )
    return desc, props


# вкладки карточки товара («Описание», «Характеристики», «Комплектация»…): в разметке есть все, видна одна
TAB_RX = (
    r'<(div|section|article)\b[^>]*(?:\brole\s*=\s*["\']tabpanel["\']|\bclass\s*=\s*["\'][^"\']*(?:\btab-pane\b|\btabs?[_-]{1,2}(?:content|pane|panel|body|item-content|block)\b|'
    r'\btab-content__item\b|\btabcontent\b|\btab_content\b|\bdetail-tab|\bproduct-tab|\bjs-tab)[^"\']*["\']|\bdata-tab-content\b)[^>]*>'
)


def _tab_texts(html) -> list:
    """Текст каждой вкладки (без вложенных повторов): таблицы — строками «параметр значение»."""
    out, seen = [], set()
    for match in re.finditer(TAB_RX, html, re.I):
        inner = _inner_html(html, match)
        inner = re.sub(r'(?i)</t[dh]\s*>', ' ', re.sub(r'(?i)</tr\s*>|<table\b[^>]*>', '\n<br>', inner))
        text = _no_sales(re.sub(r'[ \t]{2,}', ' ', _html_text(inner)))
        lines = [x for x in text.split('\n') if len(x) > LINE_MIN and x not in seen]
        if sum(len(x) for x in lines) >= DESC_MIN:
            seen.update(lines)
            out.append('\n'.join(lines))
    return out


def page_apply(html, props) -> str:
    """Применимость запчасти: свойство «Применяемость / Подходит для …» или блок под таким заголовком."""
    for k, v in props:
        if re.search(APPLY_RX, k, re.I):
            return v[:600]
    best = ''
    for match in re.finditer(rf'>\s*([^<>]{{0,30}}(?:{APPLY_RX})[^<>]{{0,40}})\s*(?=<)', html, re.I):
        chunk = html[match.end() : match.end() + 8000]
        cut = re.search(r'(?i)<h[1-6]\b|class\s*=\s*["\'][^"\']*\btab', chunk)
        text = _html_text(chunk[: cut.start()] if cut and cut.start() > 0 else chunk[:3000])
        text = re.sub(r'\s*\n\s*', '; ', text.replace('• ', '')).strip(' ;:')
        if len(text) >= TAB_TITLE_MIN and not re.match(r'(?i)^(описание|характеристики|документ|отзыв)', text):
            best = text[:600]  # последнее подходящее — содержимое вкладки, первое бывает её заголовком
    return best


# проверенные картинки со страницы (адрес → время, тип, байты): скачиваются один раз — при выборе и при сохранении
_PROBE: dict = {}
_PROBE_LOCK = threading.Lock()
PROBE_TTL = 900


def _probe_get(url) -> tuple | None:
    with _PROBE_LOCK:
        x = _PROBE.get(url)
    if x and datetime.now().timestamp() - x[0] < PROBE_TTL:
        return x[1], x[2]
    return None


def probe_images(urls, opts) -> tuple:
    """Фото оборудования: файл и стороны не меньше порогов, не однотонная «пустая» картинка."""
    min_b, min_px, blank = (opts.get('minKB') or 0) * 1024, opts.get('minPx') or 0, opts.get('skipBlank')

    def one(u) -> bool:
        hit = _probe_get(u)
        if hit is None:
            split = urllib.parse.urlsplit(u)
            try:
                hit = imgfetch.fetch_image(u, referer=f'{split.scheme}://{split.netloc}/', tries=1)
            except Exception:
                return False
            with _PROBE_LOCK:
                if len(_PROBE) > PROBE_MAX:
                    for k in sorted(_PROBE, key=lambda k: _PROBE[k][0])[:40]:
                        _PROBE.pop(k, None)
                _PROBE[u] = (datetime.now().timestamp(), hit[0], hit[1])
        data = hit[1]
        width, height = _img_size(data)
        if len(data) < min_b:
            return False
        if width and height and min(width, height) < min_px:
            return False
        return not (
            blank and width and height and width * height >= BLANK_AREA and len(data) / (width * height) < BLANK_DENSITY
        )

    with ThreadPoolExecutor(max_workers=6) as executor:
        ok = list(executor.map(one, urls))
    good = [u for u, k in zip(urls, ok, strict=False) if k]
    return good, len(urls) - len(good)


def page_text(url, opts=None) -> dict:
    """Для автозаполнения: название, описание и характеристики со страницы любого сайта."""
    html = page_html(url, accept=None)
    h1_match = re.search(r'(?is)<h1\b[^>]*>(.*?)</h1>', html) or re.search(r'(?is)<title\b[^>]*>(.*?)</title>', html)
    title = _unesc(re.sub(r'<[^>]+>', ' ', h1_match.group(1))) if h1_match else ''
    ld_desc, ld_props = _ld_product(html)
    clean = re.sub(r'(?is)<(script|style|noscript|svg)\b.*?</\1\s*>', ' ', html)
    clean = re.sub(
        r'(?i)</(span|b|strong|em|a|label)\s*>', r' </\1>', clean
    )  # «Масса</span><span>430 кг» → «Масса 430 кг»
    # характеристики — отовсюду: schema.org, JSON-LD, таблицы и списки (в том числе на скрытых вкладках)
    props, seen = [], set()
    for k, v in _schema_props(html) + ld_props + _table_props(clean, extra=PropList.pairs, limit=200):
        if k.lower() not in seen:
            seen.add(k.lower())
            props.append([k, v])
    props = props[:150]
    desc = page_desc(html)
    if len(ld_desc) > len(desc):
        desc = ld_desc
    # остальные вкладки (комплектация, преимущества, технические данные текстом…) — после описания, без повторов
    have = set(desc.split('\n'))
    for tab_text in _tab_texts(clean):
        add = [x for x in tab_text.split('\n') if x not in have]
        if sum(len(x) for x in add) >= DESC_MIN:
            have.update(add)
            desc = (desc + '\n\n' + '\n'.join(add)).strip()
    desc = desc[:20000]
    if len(desc) < DESC_SHORT:
        body = re.sub(
            r'(?is)<(script|style|noscript|svg|nav|header|footer|form|select|button)\b.*?</\1\s*>', ' ', clean
        )
        body = re.sub(r'(?i)</t[dh]\s*>', ' ', re.sub(r'(?i)</tr\s*>|<table\b[^>]*>', '\n<br>', body))
        main_match = re.search(r'(?is)<main\b[^>]*>(.*)</main>', body) or re.search(
            r'(?is)<body\b[^>]*>(.*)</body>', body
        )
        text = _no_sales(_html_text(main_match.group(1) if main_match else body))
        desc = '\n'.join(x for x in text.split('\n') if len(x) > LINE_MIN)[:12000] if len(text) > len(desc) else desc
    if not (title or desc or props):
        raise ValueError('на странице не нашлось текста')
    opts = opts or {}
    cand = page_images_any(html, url, limit=max(4, (opts.get('maxCount') or 12) * 2))
    imgs, skipped = (
        probe_images(cand, opts) if (opts.get('minKB') or opts.get('minPx') or opts.get('skipBlank')) else (cand, 0)
    )
    return {
        'title': title[:300],
        'text': desc,
        'props': props,
        'imgs': imgs[: opts.get('maxCount') or 12],
        'imgsSkipped': skipped,
    }


def page_info(html, url) -> dict:
    props = page_props(html)
    return {
        't': page_desc(html),
        'imgs': page_images(html, url),
        'props': props,
        'apply': page_apply(html, props),
        'crumbs': page_crumbs(html),
        'v': PAGE_V,
    }


def _page_getter(store) -> tuple:
    """Данные со страниц товаров (описание, фото, свойства, применимость) с кэшем в kv «feeddesc» {адрес: {…, at}}."""
    cache = store.kv_get('feeddesc') or {}
    lock, errors, today, days = threading.Lock(), [], date.today(), SrvVal.get(store, 'cat.pageDays')

    def get(url) -> dict:
        if not url:
            return {}
        with lock:
            hit = cache.get(url)
        if hit and hit.get('v') == PAGE_V:
            try:
                # страница без фото перечитывается на следующий день: сайт мог отдать её не полностью
                if (today - date.fromisoformat(hit['at'])).days < (days if hit.get('imgs') else 1):
                    return hit
            except (KeyError, ValueError):
                pass
        try:
            info = page_info(page_html(url), url)
        except Exception as exc:
            with lock:
                errors.append(f'{url[-80:]}: {str(exc)[:120]}')
            return hit or {}
        info['at'] = today.isoformat()
        with lock:
            cache[url] = info
        return info

    def save() -> None:
        with lock:
            store.kv_set('feeddesc', dict(list(cache.items())[-30000:]))

    return get, save, errors


UNIT_ALIAS = {
    'литров': 'л',
    'литра': 'л',
    'литр': 'л',
    'л.': 'л',
    'кг.': 'кг',
    'квт': 'кВт',
    'вт': 'Вт',
    'в': 'В',
    'бар': 'бар',
    'дб': 'дБ',
    'дба': 'дБ(А)',
    'мм': 'мм',
    'см': 'см',
    'м': 'м',
    'л/мин': 'л/мин',
    'м3/мин': 'м³/мин',
    'м³/мин': 'м³/мин',
    'м3/час': 'м³/ч',
    'м3/ч': 'м³/ч',
    'м³/час': 'м³/ч',
    'м³/ч': 'м³/ч',
    'дюйм': 'дюйм',
    '℃': '°C',
    '°с': '°C',
    '°c': '°C',
}
_TRANSLIT = dict(
    zip(
        'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
        [
            'a',
            'b',
            'v',
            'g',
            'd',
            'e',
            'e',
            'zh',
            'z',
            'i',
            'i',
            'k',
            'l',
            'm',
            'n',
            'o',
            'p',
            'r',
            's',
            't',
            'u',
            'f',
            'h',
            'c',
            'ch',
            'sh',
            'sch',
            '',
            'y',
            '',
            'e',
            'yu',
            'ya',
        ],
        strict=False,
    )
)


def _brand_key(text) -> str:
    """«Ремеза» и «Remeza» — один производитель."""
    return re.sub(r'[^a-z0-9]', '', ''.join(_TRANSLIT.get(char, char) for char in str(text or '').lower()))


def _param_name(name, unit) -> tuple:
    """«Мощность, кВт» без атрибута unit → («Мощность», «кВт»)."""
    if not unit:
        match = re.match(r'^(.*\S)\s*,\s*([^,]{1,12})$', name)
        if match:
            name, unit = match.group(1), match.group(2).strip()
    return name, UNIT_ALIAS.get(unit.lower(), unit)


def _clean_url(u) -> str:
    """Метки рекламы в ссылке на страницу товара (?r1=yandext&r2=, utm_…) убираются."""
    try:
        parts = urllib.parse.urlsplit(u)
        query = [
            (k, v)
            for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if not re.match(r'^(r\d|utm_|yclid|from)', k)
        ]
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), ''))
    except ValueError:
        return u


def parse(data) -> dict:
    """YML → {shop, date, cats:{id:{name, parent, path}}, offers:[…]}."""
    data = data.lstrip(b'\xef\xbb\xbf \t\r\n')
    if re.search(rb'<!ENTITY', data, re.I):  # во всём файле, не только в начале
        raise ValueError('В фиде объявлены сущности XML — такой файл не загружается')
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as exc:
        raise ValueError(f'Фид не читается как XML (YML): {exc}') from exc
    shop = root.find('shop') if root.tag != 'shop' else root
    if shop is None:
        raise ValueError('Это не фид YML: нет раздела <shop>')
    cats: dict[str, dict[str, str]] = {}
    for cat_el in shop.iter('category'):
        cid = (cat_el.get('id') or '').strip()
        if cid:
            cats[cid] = {
                'id': cid,
                'name': re.sub(r'\s+', ' ', cat_el.text or '').strip(),
                'parent': (cat_el.get('parentId') or '').strip(),
            }
    for cat_rec in cats.values():
        path, cat_path, seen = [cat_rec['name']], cat_rec['parent'], set()
        while cat_path and cat_path in cats and cat_path not in seen:
            seen.add(cat_path)
            path.insert(0, cats[cat_path]['name'])
            cat_path = cats[cat_path]['parent']
        cat_rec['path'] = ' / '.join(x for x in path if x)
    offers = []
    for el in shop.iter('offer'):
        oid = (el.get('id') or '').strip()
        if not oid:
            continue
        vendor, model, prefix, sku = (
            _txt(el, 'vendor'),
            _txt(el, 'model'),
            _txt(el, 'typePrefix'),
            _txt(el, 'vendorCode'),
        )
        name = _txt(el, 'name') or ' '.join(x for x in (prefix, vendor, model) if x)
        params = []
        qty = None
        warehouses: dict = {}
        for param_el in el.findall('param'):
            param_name = re.sub(
                r'\s+', ' ', re.sub(r'[\xad\u200b-\u200d\ufeff]', '', param_el.get('name') or '')
            ).strip()
            param_val = re.sub(r'\s+', ' ', param_el.text or '').strip()
            if (
                not param_name
                or not param_val
                or JUNK_PARAM.match(param_val)
                or JUNK_PNAME.search(param_name)
                or (param_name.lower() == 'спецификация' and param_val.isdigit())
            ):
                continue
            num = parse_number(param_val)
            if STOCK_PARAM.match(param_name) and num is not None:
                qty = num
                continue
            match = WH_PARAM.match(param_name)
            if match and num is not None:
                wh_name = match.group(1).strip()
                warehouses[wh_name] = warehouses.get(wh_name, 0) + num
                continue
            if BRAND_PARAM.match(param_name) and not vendor:  # марка и модель — параметрами, а не тегами vendor / model
                vendor = param_val
                continue
            if re.match(r'^модель$', param_name, re.I) and not model:
                model = param_val
                continue
            if re.match(r'^(код номенклатуры|артикул)$', param_name, re.I) and not sku:
                sku = param_val
                continue
            k, u = _param_name(param_name, (param_el.get('unit') or '').strip())
            if re.search(r'мощност', k, re.I):  # «90-4», «200-4 B35» — мощность и число полюсов (исполнение) двигателя
                param_val = re.sub(r'^(\d+(?:[.,]\d+)?)-[2468](?:\s*B\d+)?$', r'\1', param_val)
            params.append({'k': k, 'u': u, 'v': param_val})
        if warehouses and qty is None:
            qty = sum(warehouses.values())
        for tag in STOCK_TAGS:
            v = parse_number(_txt(el, tag))
            if v is not None:
                qty = v
                break
        outs = [
            parse_number(outlet.get('instock')) for outlet in el.iter('outlet') if outlet.get('instock') is not None
        ]
        if outs and any(x is not None for x in outs):
            qty = sum(x for x in outs if x is not None)
        avail_attr = (el.get('available') or '').strip().lower()
        available = avail_attr not in ('false', '0', 'no') if avail_attr else (qty is None or qty > 0)
        desc_el = el.find('description')
        desc = _no_sales(_html_text((desc_el.text if desc_el is not None else '') or ''))
        cur = (_txt(el, 'currencyId') or 'RUB').upper()
        cat = _txt(el, 'categoryId')
        offers.append(
            {
                'oid': oid,
                'name': name[:300],
                'cat': cat,
                'path': (cats.get(cat) or {}).get('path', ''),
                'url': _clean_url(_txt(el, 'url')),
                'price': parse_number(_txt(el, 'price')),
                'oldprice': parse_number(_txt(el, 'oldprice')),
                'cur': 'RUB' if cur in ('RUR', 'RUB') else cur,
                'vendor': vendor,
                'model': model,
                'sku': sku,
                'barcode': _txt(el, 'barcode'),
                'pictures': [
                    re.sub(r'\s+', '', cat_path.text)
                    for cat_path in el.findall('picture')
                    if cat_path.text and cat_path.text.strip()
                ][:12],
                'desc': desc,
                'params': params,
                'available': available,
                'qty': qty,
                'stockInfo': {
                    'wh': sorted(([wh_name, num] for wh_name, num in warehouses.items()), key=lambda pair: -pair[1])
                }
                if warehouses
                else None,
                'weight': parse_number(_txt(el, 'weight')),
                'dims': _txt(el, 'dimensions'),
                'notes': _txt(el, 'sales_notes'),
            }
        )
    if not offers:
        raise ValueError('В фиде нет товаров (<offer>)')
    if any(
        outlet['stockInfo'] for outlet in offers
    ):  # остатки по складам: позиции без складов в фиде — не на складе (под заказ)
        for outlet in offers:
            if outlet['qty'] is None and outlet['available'] and not outlet['stockInfo']:
                outlet['qty'], outlet['available'] = 0, False
    return {
        'shop': _txt(shop, 'name') or _txt(shop, 'company'),
        'date': root.get('date') or '',
        'cats': cats,
        'offers': offers,
    }


def load(store, feed_cfg, max_age=CACHE_SEC, root: str = '') -> dict:
    """Разобранный фид: YML — скачать (кэш 30 минут), из файлов — прочитать сохранённые файлы (кэш до новой загрузки файла).
    root — файлы фида из другой папки данных (черновик обновления цен или остатков): без кэша."""
    files = feed_cfg.get('kind') == 'files'
    if root:
        return _load_files(feed_cfg, root)
    key = (
        json.dumps(
            [feed_cfg.get('files'), feed_cfg.get('maker'), feed_cfg.get('cur'), feed_cfg.get('priceOnly')],
            sort_keys=True,
        )
        if files
        else json.dumps([feed_cfg['url'], (feed_cfg.get('files') or {}).get('extra')], sort_keys=True)
    )
    with _LOCK:
        cached = _CACHE.get(feed_cfg['id'])
        if cached and cached[1] == key and (files or (datetime.now() - cached[0]).total_seconds() < max_age):
            return cached[2]
    if files:
        feed = _load_files(feed_cfg, DATA_DIR)
    else:
        feed = parse(fetch(feed_cfg['url']))
        extra = (
            feed_files.read_file(DATA_DIR, feed_cfg['id'], 'extra')
            if (feed_cfg.get('files') or {}).get('extra')
            else None
        )
        if extra:  # описания серий и позиций, которых нет в фиде, — из файла описаний
            feed_files.apply_extra(feed, feed_files.parse_extra(extra))
    with _LOCK:
        _CACHE[feed_cfg['id']] = (datetime.now(), key, feed)
    return feed


def _load_files(feed_cfg, root: str) -> dict:
    pages = feed_files.read_file(root, feed_cfg['id'], 'pages')
    prices = load_prices(feed_cfg, root)
    if not pages and not prices:
        raise ValueError('Сначала загрузите файл парса сайта (CSV) или прайс')
    stock = feed_files.read_file(root, feed_cfg['id'], 'stock')
    return feed_files.build_feed(
        feed_cfg,
        feed_files.parse_pages(pages) if pages else [],
        prices,
        _param_name,
        feed_files.parse_stock(stock) if stock else None,
    )


def preview(store, feed_cfg, types) -> dict:
    feed = load(store, feed_cfg, max_age=0)
    by_cat: dict = {}
    for offer in feed['offers']:
        by_cat.setdefault(offer['cat'], []).append(offer)
    linked = {doc.get('feed', {}).get('oid') for doc in _feed_docs(store, feed_cfg['id'])}
    cats = []
    for cid, offs in sorted(by_cat.items(), key=lambda x: (feed['cats'].get(x[0]) or {}).get('path') or x[0]):
        cat = feed['cats'].get(cid) or {'path': 'Без категории' if not cid else f'Категория {cid}'}
        kinds: dict = {}
        for offer in offs:
            k = item_cat(offer, types) or 'other'
            kinds[k] = kinds.get(k, 0) + 1
        cats.append(
            {
                'id': cid,
                'path': cat['path'],
                'count': len(offs),
                'kinds': sorted(kinds.items(), key=lambda x: -x[1]),
                'map': (feed_cfg.get('cats') or {}).get(cid, ''),
                'inCatalog': sum(1 for offer in offs if offer['oid'] in linked),
            }
        )
    param_names: dict = {}
    for offer in feed['offers']:
        for param in offer['params']:
            param_names[param['k']] = param_names.get(param['k'], 0) + 1
    offs = feed['offers']
    return {
        'shop': feed['shop'],
        'date': feed['date'],
        'total': len(offs),
        'cats': cats,
        'match': feed.get('match'),
        'extra': feed.get('extra'),
        'kind': feed_cfg.get('kind') or 'yml',
        'withDesc': sum(1 for offer in feed['offers'] if len(offer.get('desc') or '') >= DESC_MIN),
        'available': sum(1 for offer in offs if offer['available']),
        'withPrice': sum(1 for offer in offs if offer['price']),
        'withQty': sum(1 for offer in offs if offer['qty'] is not None),
        'withPhoto': sum(1 for offer in offs if offer['pictures']),
        'inCatalog': len(linked & {offer['oid'] for offer in offs}),
        'params': sorted(param_names.items(), key=lambda x: -x[1])[:40],
        'sample': [
            dict(
                {k: offer[k] for k in ('oid', 'name', 'price', 'cur', 'available', 'qty', 'sku')},
                maker=maker_of(offer, feed_cfg),
                model=model_of(offer, maker_of(offer, feed_cfg)),
                cat=item_cat(offer, types),
                pics=len(offer['pictures']),
                params=len(offer['params']),
            )
            for offer in offs[:8]
        ],
    }


def _img_size(data) -> tuple:
    try:
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', data[16:24])
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            if data[12:16] == b'VP8X':
                return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
            if data[12:16] == b'VP8 ':
                width, height = struct.unpack('<HH', data[26:30])
                return width & 0x3FFF, height & 0x3FFF
        if data[:2] == b'\xff\xd8':
            i = 2
            while i < len(data) - 9:
                if data[i] != JPEG_MARK:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    height, width = struct.unpack('>HH', data[i + 5 : i + 9])
                    return width, height
                i += 2 + struct.unpack('>H', data[i + 2 : i + 4])[0]
    except struct.error:
        pass  # файл обрезан — размер неизвестен
    return None, None


def _cid(fid: str, oid) -> str:
    return (
        '{}-{}'.format(
            images.slug(fid, 20) or 'feed',
            images.slug(oid, 40) or hashlib.md5(oid.encode(), usedforsecurity=False).hexdigest()[:10],
        )
    )[:64]


def _sum_txt(k, v, u) -> str | None:
    """«5,5+5,5» кВт → «11 кВт (5,5+5,5)», «1,4х3» → «4,2 кВт (1,4 × 3)»: в параметр категории идёт общая мощность."""
    if not u or not re.search(r'мощност|производительн', k, re.I):
        return None
    num_rx = r'(\d+(?:[.,]\d+)?)'
    match = re.match(r'^' + num_rx + r'(?:\s*\+\s*' + num_rx + r')+', v)
    if match and '+' in match.group(0):
        tot: Any = sum(parse_number(x) for x in re.findall(num_rx, match.group(0)))
    else:
        match = re.match(r'^' + num_rx + r'\s*[хx×*]\s*(\d)\b', v)
        if not match:
            return None
        tot = (parse_number(match.group(1)) or 0) * int(match.group(2))
    return '{} {} ({})'.format(
        _fmt(round(tot, 3)), u, re.sub(r'\s*\(.*$', '', v).replace('х', ' × ').replace('x', ' × ')
    )


def _with_unit(v, u) -> str:
    """«1.7» + «м³/мин» → «1,7 м³/мин»; текстовое значение («G1"») — без единицы."""
    v = re.sub(r'^(-?\d+)\.(\d+)$', r'\1,\2', v.strip())
    if not u or v.lower().endswith(u.lower()) or not re.match(r'^[-−+]?\d', v):
        return v
    if re.search(r'\d\s*(мм|см|бар|bar|кг|кВт|kw|л|дБ|db|м³|м3|нм3|нм³|°c|в|гц|%)\b', v, re.I):
        return v  # единица уже в значении: «50 мм», «7,5 бар»
    return f'{v} {u}'


def _row_key(k, u) -> str:
    return re.sub(r'[^а-яёa-z]', '', k.lower())[:14] + '|' + (u or '').lower()


def _rows(offer) -> list:
    rows, have = [], set()
    for param in offer['params']:
        v = _sum_txt(param['k'], param['v'], param['u']) or _with_unit(param['v'], param['u'])
        rows.append({'k': param['k'], 'v': v[:300], 'hl': False})
        have.add(_row_key(param['k'], param['u']))
    skip = APPLY_RX + r'|артикул|наличи|цена|стоимост|склад|доставк|гаранти|отзыв|рейтинг|бренд'
    if any(k == 'Для оборудования' for k, v in offer.get('extraRows') or []):
        skip += r'|^применение$'  # у запчасти это строка «Для оборудования»
    for prop_key, param_val in offer.get('props') or []:  # характеристики со страницы товара, которых нет в фиде
        k, u = _param_name(prop_key, '')
        key = _row_key(k, u)
        if key.split('|')[0] and key not in have and not re.search(skip, prop_key, re.I):
            have.add(key)
            rows.append({'k': k[:60], 'v': (_sum_txt(k, param_val, u) or _with_unit(param_val, u))[:300], 'hl': False})
    for k, v in offer.get('extraRows') or []:
        if v:
            rows.append({'k': k, 'v': v[:600], 'hl': False})
    if offer.get('dims') and not any(re.search(r'габарит', row['k'], re.I) for row in rows):
        rows.append({'k': 'Габариты упаковки (Д × Ш × В), см', 'v': offer['dims'].replace('/', ' × '), 'hl': False})
    if offer.get('weight') and not any(re.search(r'^вес|масса', row['k'], re.I) for row in rows):
        rows.append(
            {'k': 'Масса с упаковкой', 'v': '{} кг'.format(str(offer['weight']).rstrip('0').rstrip('.')), 'hl': False}
        )
    return rows


def _fix_drive_rows(rows, offer, feed) -> list:
    """«Тип привода» по сериям из настроек фида (driveHints): сайт иногда ошибается — у «DVK D 340-7» пишет «ременной»."""
    want = DriveHints.kind(
        feed, ' '.join(str(x or '') for x in (offer.get('name'), offer.get('model'), offer.get('sheet')))
    )
    if not want:
        return rows
    for row in rows:
        if re.match(r'^(тип\s+)?привод', row['k'], re.I):
            v = str(row['v']).lower()
            if want == 'direct' and 'ремен' in v:
                row['v'] = 'прямой'
            elif want == 'belt' and re.search(r'прям|муфт', v):
                row['v'] = 'ременной'
    return rows


def _hash(x) -> str:
    return hashlib.md5(
        json.dumps(x, ensure_ascii=False, sort_keys=True).encode('utf-8'), usedforsecurity=False
    ).hexdigest()[:12]


# Парс сайта — исчерпывающий список номенклатуры: по нему один раз «формируется каталог» (позиция на каждое исполнение,
# как на сайте), уже имеющиеся позиции производителя (из прошлых загрузок и заведённые вручную) сопоставляются с позициями
# парса и перестраиваются, лишние совпадения (дубли) уходят в корзину. После сборки (f.built) парс только добавляет новые
# позиции, а прайс — обновляет цены; описания, фото и характеристики правятся вручную.
def _pressures(doc) -> set:
    """Давления позиции каталога: «Рабочее давление 7,5 / 8,5 / 10 / 13 бар» → {7.5, 8.5, 10, 13}; иначе — attrs.pressure."""
    out = set()
    for group in doc.get('groups') or []:
        for row in group.get('rows') or []:
            k = str(row.get('k') or '')
            if re.search(r'давлен', k, re.I) and not re.search(r'мин|вход|разреж|вакуум|шин', k, re.I):
                for x in re.findall(r'\d+(?:[.,]\d+)?', str(row.get('v') or '')):
                    num = float(x.replace(',', '.'))
                    if PRESSURE_MIN <= num <= PRESSURE_MAX:
                        out.add(feed_files.PRESSURE_ALIAS.get(num, num))
    pressure = parse_number((doc.get('attrs') or {}).get('pressure'))
    if not out and pressure:
        out.add(feed_files.PRESSURE_ALIAS.get(pressure, pressure))
    return out


def _doc_cfg(doc) -> dict:
    """Исполнение позиции каталога: по модели, а если в ней нет латинской серии — по названию; плюс поля карточки."""
    attrs = doc.get('attrs') or {}
    cfg = feed_files.model_cfg(attrs.get('model') or doc.get('name'), doc.get('name'))
    if not feed_files.lat_series(cfg):
        cfg = feed_files.model_cfg(doc.get('name'), doc.get('name'))
    return feed_files.card_attrs(cfg, attrs)


def _offer_cfg(offer) -> dict:
    params_map = {
        'name': offer['name'],
        'url': offer.get('url') or '',
        'chars': [
            (param['k'] + (' ({})'.format(param['u']) if param.get('u') else ''), param['v'])
            for param in offer.get('params') or []
        ],
    }
    return feed_files.page_cfg(params_map)


def plan_summary(store, feed_cfg) -> dict:
    """Сборка каталога без записи: сколько позиций парса, с чем сопоставятся, что станет новым, что уйдёт в корзину."""
    feed = load(store, feed_cfg)
    skip = {k for k, v in (feed_cfg.get('cats') or {}).items() if v == 'skip'}
    offs = [offer for offer in feed['offers'] if offer['cat'] not in skip]
    fdocs = _feed_docs(store, feed_cfg['id'])
    plan = build_plan(store, feed_cfg, offs, fdocs)
    oname = {offer['oid']: offer['name'] for offer in offs}
    existing = {(doc.get('feed') or {}).get('oid') for doc in fdocs}
    add = (
        [offer['name'] for offer in offs if offer['oid'] not in existing and offer['oid'] not in plan['links']]
        if feed_cfg.get('built')
        else []
    )
    return {
        'built': feed_cfg.get('built'),
        'offers': len(offs),
        'withPrice': sum(1 for offer in offs if offer['price']),
        'links': len(plan['links']),
        'new': len(plan['new']),
        'add': add[:300],
        'addCount': len(add),
        'linkSample': [
            [doc.get('name'), oname[oid]] for oid, doc in list(plan['links'].items()) if doc.get('name') != oname[oid]
        ][:300],
        'dups': [{'id': doc['id'], 'name': doc.get('name')} for doc in plan['dups']][:300],
        'keep': [{'id': doc['id'], 'name': doc.get('name')} for doc in plan['keep']][:300],
    }


class Missing(Enum):
    """Позиции, которых больше нет в новом файле фида: оставить в каталоге или убрать в корзину."""

    KEEP = 'keep'
    TRASH = 'trash'


class FeedPurge:
    """Удаление позиций фида (администратор): все или одной категории — в корзину, с запретом повторной загрузки."""

    MAX_EXCLUDED = 50000

    @staticmethod
    def _cat(doc) -> tuple:
        feed_info = doc.get('feed') or {}
        return str(feed_info.get('cat') or ''), str(feed_info.get('path') or feed_info.get('crumbs') or '')

    @classmethod
    def _pick(cls, docs, cat) -> list:
        return [doc for doc in docs if not cat or cls._cat(doc)[0] == cat]

    @classmethod
    def preview(cls, store, feed, cat='') -> dict:
        """{total, cats: [{cat, title, n}], picked, sample: [названия], excluded}"""
        docs = _feed_docs(store, feed['id'])
        cats: dict = {}
        for doc in docs:
            cat_name, title = cls._cat(doc)
            x = cats.setdefault(cat_name, {'cat': cat_name, 'title': title or cat_name or 'без категории', 'n': 0})
            x['n'] += 1
        pick = cls._pick(docs, cat)
        return {
            'total': len(docs),
            'cats': sorted(cats.values(), key=lambda x: (-x['n'], x['title'])),
            'picked': len(pick),
            'sample': [doc.get('name') or doc['id'] for doc in pick[:15]],
            'excluded': len(feed.get('excluded') or []),
        }

    @classmethod
    def run(cls, store, feed, cat='', author: str = '') -> dict:
        """Позиции фида (или категории фида) — в корзину. → {deleted, blocked}"""
        pick = cls._pick(_feed_docs(store, feed['id']), cat)
        return {'deleted': cls._trash(store, pick, author), 'blocked': 0}

    @classmethod
    def run_and_block(cls, store, feed, cat='', author: str = '') -> dict:
        """В корзину, и фид их больше не загружает и не предлагает. → {deleted, blocked}"""
        pick = cls._pick(_feed_docs(store, feed['id']), cat)
        count = cls._trash(store, pick, author)
        oids = [(doc.get('feed') or {}).get('oid') for doc in pick]
        blocked = 0
        items = feeds(store)
        for x in items:
            if x.get('id') == feed['id']:
                excluded = list(dict.fromkeys((x.get('excluded') or []) + [str(oid) for oid in oids if oid]))[
                    -cls.MAX_EXCLUDED :
                ]
                blocked = len(excluded) - len(x.get('excluded') or [])
                x['excluded'] = excluded
        store.kv_set(KV_KEY, {'items': items})
        with _LOCK:
            _CACHE.pop(feed['id'], None)
        return {'deleted': count, 'blocked': blocked}

    @staticmethod
    def _trash(store, pick: list, author: str) -> int:
        return store.trash_put_many(
            'catalog', [(doc['id'], doc.get('name') or doc['id']) for doc in pick], author or 'администратор'
        )

    @staticmethod
    def unblock(store, fid: str) -> int:
        items, count = feeds(store), 0
        for x in items:
            if x.get('id') == fid:
                count = len(x.pop('excluded', None) or [])
        store.kv_set(KV_KEY, {'items': items})
        return count


class FeedRules:
    """Что и куда загружает фид: отбор предложений, поля обновления, план «что загрузится»."""

    FIELDS = (
        ('name', 'Название'),
        ('desc', 'Описание'),
        ('photo', 'Фото'),
        ('params', 'Характеристики'),
        ('cat', 'Категория'),
        ('price', 'Цены (РРЦ, закупка)'),
        ('stock', 'Наличие'),
    )
    KEYS = {
        'name': ('name', 'spec'),
        'desc': ('features',),
        'photo': ('photo', 'photoSource', 'gallery'),
        'params': ('groups',),
        'price': (
            'price',
            'priceCur',
            'priceSrc',
            'rrc',
            'cost',
            'costCur',
            'costSrc',
            'costDisc',
            'costAt',
            'margin',
            'mmode',
        ),
        'stock': ('stock',),
    }
    PLAN_ROWS = 3000  # строк плана в ответе (счётчики — по всем)

    @staticmethod
    def _words(v) -> list:
        return [
            word for word in (re.sub(r'\s+', ' ', x).strip().lower() for x in re.split(r'[,;\n]', str(v or ''))) if word
        ][:50]

    @classmethod
    def clean_filter(cls, data) -> dict:
        data = data if isinstance(data, dict) else {}

        def num(v) -> float | None:
            x = parse_number(v)
            return x if x is not None and x >= 0 else None

        return {
            'brands': [str(brand).strip()[:80] for brand in (data.get('brands') or []) if str(brand).strip()][:200]
            if isinstance(data.get('brands'), list)
            else [],
            'words': ', '.join(cls._words(data.get('words')))[:400],
            'stop': ', '.join(cls._words(data.get('stop')))[:400],
            'priceMin': num(data.get('priceMin')),
            'priceMax': num(data.get('priceMax')),
            'avail': data.get('avail') is True,
            'priced': data.get('priced') is True,
            'add': data.get('add', True) is not False,
        }

    @classmethod
    def clean_fields(cls, data) -> dict:
        data = data if isinstance(data, dict) else {}
        return {k: data.get(k, True) is not False for k, _ in cls.FIELDS}

    @classmethod
    def fields(cls, feed) -> dict:
        return cls.clean_fields(feed.get('fields'))

    @classmethod
    def reason(cls, offer, feed) -> str:
        """Почему предложение не загружается (пусто — загружается): категория, отбор, удалено ранее."""
        if (feed.get('cats') or {}).get(offer['cat']) == 'skip':
            return 'категория фида пропускается'
        if offer['oid'] in set(feed.get('excluded') or []):
            return 'удалено из каталога («не загружать снова»)'
        rules = got_value if isinstance(got_value := feed.get('filter'), dict) else {}
        if not rules:
            return ''
        name = (offer.get('name') or '').lower()
        if rules.get('brands') and _brand_key(maker_of(offer, feed)) not in {
            _brand_key(brand) for brand in rules['brands']
        }:
            return 'марка не выбрана'
        words = cls._words(rules.get('words'))
        if words and not any(word in name for word in words):
            return 'в названии нет нужных слов'
        stop = [word for word in cls._words(rules.get('stop')) if word in name]
        if stop:
            return f'в названии «{stop[0]}»'
        price = offer.get('price') or 0
        if rules.get('priced') and not price:
            return 'без цены'
        if rules.get('priceMin') is not None and price and price < rules['priceMin']:
            return 'цена ниже {}'.format(_fmt(rules['priceMin']))
        if rules.get('priceMax') is not None and price and price > rules['priceMax']:
            return 'цена выше {}'.format(_fmt(rules['priceMax']))
        if rules.get('avail') and not offer.get('available'):
            return 'нет в наличии'
        return ''

    @classmethod
    def adds(cls, feed) -> bool:
        rules = got_value if isinstance(got_value := feed.get('filter'), dict) else {}
        return rules.get('add', True) is not False

    @classmethod
    def keep(cls, doc, old, feed) -> dict:
        """Позиция после загрузки: выключенные поля — как были в каталоге (old)."""
        if not old:
            return doc
        files = cls.fields(feed)
        for k, keys in cls.KEYS.items():
            if files.get(k, True):
                continue
            for x in keys:
                if x in old:
                    doc[x] = json.loads(json.dumps(old[x]))
                else:
                    doc.pop(x, None)
        attrs, old_attrs = dict(doc.get('attrs') or {}), dict(old.get('attrs') or {})
        if not files['params']:  # параметры категории — как были (категория — по своей галочке)
            attrs = dict(old_attrs, cat=attrs.get('cat', old_attrs.get('cat')))
        if not files['cat'] and old_attrs.get('cat'):
            attrs['cat'] = old_attrs['cat']
        doc['attrs'] = attrs
        return doc

    @classmethod
    def changes(cls, changes, feed) -> list:
        """Изменения цен и наличия для журнала фида — без выключенных полей."""
        files = cls.fields(feed)
        return [change for change in changes if (files['stock'] if change[0] == 'stock' else files['price'])]

    @classmethod
    def diff(cls, old, doc) -> list:
        """Подписи изменившихся полей позиции."""
        out = []

        def _same(first, second) -> bool:
            return json.dumps(first, sort_keys=True, ensure_ascii=False) == json.dumps(
                second, sort_keys=True, ensure_ascii=False
            )

        for k, label in cls.FIELDS:
            if k == 'cat':
                same = (old.get('attrs') or {}).get('cat') == (doc.get('attrs') or {}).get('cat')
            elif k == 'params':

                def drop(attrs) -> dict:
                    return {x: y for x, y in (attrs or {}).items() if x != 'cat'}

                same = _same(old.get('groups'), doc.get('groups')) and _same(
                    drop(old.get('attrs')), drop(doc.get('attrs'))
                )
            elif k == 'price':
                same = all(_same(old.get(x), doc.get(x)) for x in cls.KEYS['price'] if x != 'costAt')
            elif k == 'stock':

                def strip(text) -> dict:
                    return {x: y for x, y in (text or {}).items() if x != 'at'}

                same = _same(strip(old.get('stock')), strip(doc.get('stock')))
            else:
                same = all(_same(old.get(x), doc.get(x)) for x in cls.KEYS[k])
            if not same:
                out.append(label)
        return out

    @classmethod
    def plan(cls, store, feed_cfg, types) -> dict:
        """Предпросмотр загрузки без записи (фото и страницы товаров не скачиваются)."""
        feed = load(store, feed_cfg, max_age=0)
        existing = {(card.get('feed') or {}).get('oid'): card for card in _feed_docs(store, feed_cfg['id'])}
        files, built = feed_cfg.get('kind') == 'files', bool(feed_cfg.get('built'))
        tnames = {tdef.get('id'): tdef.get('name') for tdef in types}
        rows: list = []
        cnt = {'add': 0, 'update': 0, 'same': 0, 'skip': 0}
        brands: dict = {}
        prices = []
        for offer in feed['offers']:
            maker = maker_of(offer, feed_cfg)
            if maker:
                brands[maker] = brands.get(maker, 0) + 1
            if offer.get('price'):
                prices.append(offer['price'])
            why, reason, old = cls.reason(offer, feed_cfg), [], existing.get(offer['oid'])
            if why:
                status = 'skip'
            elif old:
                if files and built:
                    status, reason = 'same', ['каталог собран — меняются только цены и наличие']
                else:
                    doc, _ = build(dict(offer, pictures=[]), feed_cfg, types, old, None)
                    doc = cls.keep(doc, old, feed_cfg)
                    reason = cls.diff(old, doc)
                    status = 'update' if reason else 'same'
            elif not cls.adds(feed_cfg):
                status, why = 'skip', 'новые позиции не создаются'
            else:
                status = 'add'
            cnt[status] += 1
            if len(rows) < cls.PLAN_ROWS:
                cat = (feed_cfg.get('cats') or {}).get(offer['cat']) or item_cat(offer, types) or 'other'
                rows.append(
                    {
                        'oid': offer['oid'],
                        'name': offer['name'],
                        'maker': maker,
                        'price': offer.get('price') or None,
                        'cur': offer.get('cur') or '',
                        'available': bool(offer.get('available')),
                        'feedCat': (feed['cats'].get(offer['cat']) or {}).get('path') or '',
                        'cat': tnames.get((old.get('attrs') or {}).get('cat') if old else cat) or cat,
                        'status': status,
                        'why': why,
                        'changes': reason,
                        'id': old.get('id') if old else '',
                    }
                )
        return {
            'counts': cnt,
            'total': len(feed['offers']),
            'rows': rows,
            'cut': max(0, len(feed['offers']) - len(rows)),
            'brands': sorted(brands.items(), key=lambda x: (-x[1], x[0]))[:200],
            'price': [min(prices), max(prices)] if prices else None,
            'cur': next((offer.get('cur') for offer in feed['offers'] if offer.get('cur')), ''),
            'fields': cls.fields(feed_cfg),
            'filter': cls.clean_filter(feed_cfg.get('filter')),
            'labels': dict(cls.FIELDS),
        }


def feed_unbuild(store, fid: str) -> None:
    items = feeds(store)
    for x in items:
        if x.get('id') == fid:
            x.pop('built', None)
    store.kv_set(KV_KEY, {'items': items})


def build_plan(store, feed, offs, feed_docs=None) -> dict:
    """Соответствие позиций каталога и парса → {links, dups, keep, new}."""
    docs = (_feed_docs(store, feed['id']) if feed_docs is None else list(feed_docs)) + _maker_cards(store, feed)
    by_url = {}
    by_name: dict = {}
    ocfg = []
    for i, offer in enumerate(offs):
        if offer.get('url'):
            by_url[offer['url'].rstrip('/').lower()] = i
        by_name.setdefault(feed_files.name_key(offer['name']), i)
        ocfg.append(_offer_cfg(offer))
    by_lat: dict = {}
    by_code: dict = {}
    for i, cfg in enumerate(ocfg):
        if feed_files.lat_series(cfg) and cfg['size'] is not None:
            by_lat.setdefault((feed_files.lat_series(cfg), cfg['size']), []).append(i)
        k = feed_files.code_cfg(offs[i]['name'])
        if k:
            by_code.setdefault(k['ser'], []).append((i, k))
    pairs: list[tuple] = []
    cand_docs: set = set()
    for doc in docs:
        feed_info = doc.get('feed') or {}
        if feed_info.get('url') and feed_info['url'].rstrip('/').lower() in by_url:
            pairs.append((0, 0, by_url[feed_info['url'].rstrip('/').lower()], doc['id']))
        offer_ix = by_name.get(feed_files.name_key(doc.get('name')))
        if offer_ix is not None:
            pairs.append((1, 0, offer_ix, doc['id']))
        cfg = _doc_cfg(doc)
        pressures = _pressures(doc)
        lat, lat_hit = feed_files.lat_series(cfg), False
        for offer_ix in by_lat.get((lat, cfg['size']), []) if lat and cfg['size'] is not None else []:
            offer_cfg = ocfg[offer_ix]
            if offer_cfg['vsd'] != cfg['vsd'] or offer_cfg['w'] != cfg['w'] or offer_cfg['dry'] != cfg['dry']:
                continue
            if (cfg['rec'] is None) != (offer_cfg['rec'] is None) or (
                cfg['rec'] not in (None, -1) and offer_cfg['rec'] != cfg['rec']
            ):
                continue
            offer_pressure = feed_files.PRESSURE_ALIAS.get(offer_cfg['p'], offer_cfg['p'])
            if pressures and offer_pressure and offer_pressure not in pressures:
                continue
            own = parse_number((doc.get('attrs') or {}).get('pressure'))
            rank = (
                0
                if own and offer_pressure == feed_files.PRESSURE_ALIAS.get(own, own)
                else (1 + (offer_pressure or 0) / 100)
            )
            pairs.append((2, rank, offer_ix, doc['id']))
            lat_hit = True
        for offer_ix, rank in [] if lat_hit else _code_pairs(doc, offs, ocfg, by_code):
            pairs.append((3, rank, offer_ix, doc['id']))
    pairs.sort(key=lambda x: (x[0], x[1], x[2]))
    by_id = {doc['id']: doc for doc in docs}
    links, taken_o, taken_d = {}, set(), set()
    for _prio, _rank, offer_ix, did in pairs:
        cand_docs.add(did)
        if offer_ix in taken_o or did in taken_d:
            continue
        taken_o.add(offer_ix)
        taken_d.add(did)
        links[offs[offer_ix]['oid']] = by_id[did]
    dups = [by_id[x] for x in cand_docs if x not in taken_d]
    keep = [doc for doc in docs if doc['id'] not in cand_docs]
    return {
        'links': links,
        'dups': dups,
        'keep': keep,
        'new': [offer['oid'] for offer in offs if offer['oid'] not in links],
    }


def _code_pairs(doc, offs, ocfg, by_code) -> list:
    """Русские коды моделей (АСО): карточка «АСО-ВК11/10» — позиция парса «АСО-ВК 11/10М2», «К25М1/10» — «К25М1»."""
    attrs = doc.get('attrs') or {}
    doc_code = feed_files.code_cfg(doc.get('name'), attrs.get('model'))
    if not doc_code or not doc_code['cyr']:  # латинские модели (Dalgakiran) — только по исполнению выше
        return []
    out = []
    for i, offer_cfg in by_code.get(doc_code['ser'], []):
        if not offer_cfg['cyr']:
            continue
        if not (
            offer_cfg['size'] == doc_code['size']
            or (doc_code['size'].is_integer() and offer_cfg['size'] == doc_code['size'] + 0.5)
        ):
            continue
        if (offer_cfg['dry'], offer_cfg['vsd'], offer_cfg['flags'], offer_cfg['var'], offer_cfg['rec']) != (
            doc_code['dry'],
            doc_code['vsd'],
            doc_code['flags'],
            doc_code['var'],
            doc_code['rec'],
        ):
            continue
        if doc_code['gen'] and offer_cfg['gen'] != doc_code['gen']:
            continue
        rank: float = 0 if offer_cfg['gen'] == doc_code['gen'] else 1
        if offer_cfg['p'] is not None and doc_code['p'] is not None:
            if offer_cfg['p'] != doc_code['p']:
                continue
        elif doc_code['p'] is not None:  # «К2/10» и «К2»: давление позиции парса — из характеристик
            offer_pressure = ocfg[i]['p']
            rank += 0 if offer_pressure and abs(offer_pressure - doc_code['p']) < PRESSURE_NEAR else 0.5
        out.append((i, rank + (offer_cfg['size'] != doc_code['size']) * 0.2, offer_cfg['gen']))
    gens = {group_key for _, _, group_key in out}
    if not doc_code['gen'] and len(gens) > 1 and '' not in gens:
        return []  # «КТ16» — это КТ16М или КТ16МЭ? Не угадывать
    return [(i, row) for i, row, _ in out]


def _feed_docs(store, fid: str) -> list:
    out = []
    for (doc,) in store.all('SELECT doc FROM catalog WHERE feed_id = ?', (str(fid)[:80],)):
        try:
            card = json.loads(doc)
        except ValueError:
            continue
        if (card.get('feed') or {}).get('id') == fid:
            out.append(card)
    return out


DRIVES = ('any', 'belt', 'direct')
VSD_RX = re.compile(r'\bVSD\b|\bVFD\b|инвертор|частотн|преобразовател\S*\s+частоты|\bINVERS', re.I)


def discount_rules(raw) -> list:
    """Сетка скидок из настроек: не больше 30 правил, у каждого — скидка 0…99 %, категории — id типов программы."""
    out = []
    for rule in raw[:30]:
        if not isinstance(rule, dict):
            continue
        pct = parse_number(rule.get('pct'))
        if pct is None or not 0 < pct < PERCENT_MAX:
            continue
        cats = [str(cat)[:40] for cat in (rule.get('cats') or []) if re.match(r'^[a-z0-9_-]{1,40}$', str(cat))][:40]
        lim = {k: parse_number(rule.get(k)) for k in ('kwMin', 'kwMax')}
        out.append(
            {
                'label': re.sub(r'\s+', ' ', str(rule.get('label') or '')).strip()[:80],
                'cats': cats,
                'kwUnknown': rule.get('kwUnknown') is True,
                'drive': rule.get('drive') if rule.get('drive') in DRIVES else 'any',
                'pct': round(pct, 2),
                'kwMin': lim['kwMin'] if lim['kwMin'] and lim['kwMin'] > 0 else None,
                'kwMax': lim['kwMax'] if lim['kwMax'] and lim['kwMax'] > 0 else None,
            }
        )
    return out


class DriveHints:
    """Подсказки привода из настроек фида (f.driveHints {belt, direct}): серии в названии / листе прайса."""

    @staticmethod
    @functools.lru_cache(maxsize=64)
    def pattern(words) -> re.Pattern | None:
        """«DVK D, IMPETUS» → регулярное выражение по целым словам (разбирается один раз)."""
        parts = [word.strip() for word in re.split(r'[,;\n]', words or '') if word.strip()]
        if not parts:
            return None
        alt = '|'.join(
            r'[\s-]*'.join(re.escape(x) for x in re.split(r'[\s-]+', part))
            for part in sorted(parts, key=len, reverse=True)
        )
        return re.compile(rf'(?<![A-Za-zА-Яа-я0-9])(?:{alt})(?![A-Za-zА-Яа-я])', re.I)

    @classmethod
    def kind(cls, feed, text) -> str:
        """'direct' | 'belt' | '' — прямые раньше ременных: «DVK D» точнее «DVK»."""
        hints = feed.get('driveHints') or {}
        for kind in ('direct', 'belt'):
            regex = cls.pattern(hints.get(kind))
            if regex and regex.search(text):
                return kind
        return ''


def drive_of(doc, feed) -> str:
    """Привод позиции: 'vsd' (частотник), 'direct', 'belt' или '' — не определён."""
    attrs = doc.get('attrs') or {}
    feed_info = doc.get('feed') or {}
    text = ' '.join(
        str(x or '')
        for x in (
            doc.get('name'),
            attrs.get('model'),
            attrs.get('series'),
            feed_info.get('sheet'),
            feed_info.get('path'),
        )
    )
    rows = [
        (str(row.get('k') or ''), str(row.get('v') or ''))
        for group in doc.get('groups') or []
        for row in group.get('rows') or []
    ]
    reg = ' '.join(v for k, v in rows if re.search(r'регулирован|управлени\S* производ|частот', k, re.I))
    if str(attrs.get('vsd') or '').lower() == 'да' or VSD_RX.search(text) or VSD_RX.search(reg):
        return 'vsd'
    kind = DriveHints.kind(feed, text)
    if kind:
        return kind
    drv = ' '.join(v for k, v in rows if re.search(r'привод|передач', k, re.I)).lower()
    if 'ремен' in drv and not re.search(r'прям|муфт|редукт|зубч', drv):
        return 'belt'
    if re.search(r'прям|муфт|редукт|зубч|соосн|коаксиал', drv):
        return 'direct'
    return ''


def _kw_of(doc) -> float | None:
    kw = parse_number((doc.get('attrs') or {}).get('kw'))
    if kw:
        return kw
    for group in doc.get('groups') or []:
        for row in group.get('rows') or []:
            if re.search(r'мощност', str(row.get('k') or ''), re.I) and not re.search(
                r'потребля|охлажд|вентил', str(row.get('k') or ''), re.I
            ):
                match = re.search(
                    r'(\d+(?:[.,]\d+)?)\s*(квт|kw)', str(row.get('v') or '') + ' ' + str(row.get('k') or ''), re.I
                )
                if match:
                    return parse_number(match.group(1))
    return None


def discount_for(feed, doc) -> tuple:
    """Скидка поставщика для позиции по сетке f.discounts (первое подходящее правило), иначе f.discount; → (pct | None, подпись)."""
    pct, label, _ = _disc_pick(feed, doc)
    return pct, label


def _disc_pick(feed, doc) -> tuple:
    """→ (pct | None, подпись, номер правила | None — «остальное»)."""
    attrs = doc.get('attrs') or {}
    cat = attrs.get('cat') or ''
    drive, kw = None, None
    for i, rule in enumerate(feed.get('discounts') or []):
        if rule.get('cats') and cat not in rule['cats']:
            continue
        if rule.get('drive') in ('belt', 'direct'):
            drive = drive_of(doc, feed) if drive is None else drive
            if (drive == 'belt') != (rule['drive'] == 'belt') or not drive:
                continue
        if rule.get('kwMin') or rule.get('kwMax'):
            kw = _kw_of(doc) if kw is None else kw
            if not kw and not rule.get('kwUnknown'):
                continue
            if kw and ((rule.get('kwMin') and kw < rule['kwMin']) or (rule.get('kwMax') and kw > rule['kwMax'])):
                continue
        return rule['pct'], rule.get('label') or '', i
    if feed.get('discount'):
        return feed['discount'], 'Остальное оборудование' if feed.get('discounts') else '', None
    return None, '', None


def _set_cost(doc, kop, cur, feed, changes, offer=None) -> None:
    """Закупка = цена × (1 − скидка по сетке); ручную закупку (costSrc = manual) не трогает; изменение — в список ch."""
    if doc.get('costSrc', 'feed') != 'feed':
        return
    if offer and offer.get('dealer'):
        new = round(offer['dealer'] * 100)
        disc: Any = {
            'pct': round((1 - new / kop) * 100, 1) if kop and new < kop else 0,
            'label': 'дилерская цена по прайсу',
        }
    else:
        pct, label = (
            (offer['disc'], 'скидка дилера по прайсу') if offer and offer.get('disc') else discount_for(feed, doc)
        )
        if pct is None:
            if feed.get('priceKind') != 'cost' or feed.get('kind') != 'files':
                return
            pct = 0
        new = round(kop * (1 - pct / 100))
        disc = {'pct': pct, 'label': label} if pct else None
    if doc.get('cost') and (doc.get('cost') != new or (doc.get('costCur') or 'RUB') != cur):
        changes.append(('cost', doc.get('cost'), new, cur))
    doc['cost'], doc['costCur'], doc['costSrc'] = new, cur, 'feed'
    doc['costDisc'] = disc


def _price_part(doc, offer, feed, today) -> list:
    """РРЦ, наличие, цена КП и закупка позиции по предложению фида; → список изменений [(поле, было, стало, валюта)]."""
    changes: list = []
    if not offer['price'] and offer.get('dealer'):  # в прайсе только цена для дилера (Tewatt)
        _set_cost(doc, 0, offer['cur'], feed, changes, offer)
        doc['costAt'] = today
    elif offer['price'] and feed.get('priceKind') == 'cost':
        _set_cost(doc, round(offer['price'] * 100), offer['cur'], feed, changes, offer)
        doc['costAt'] = today
    elif offer['price']:
        kop = round(offer['price'] * 100)
        rrc = doc.get('rrc') or {}
        if rrc.get('price') != kop or rrc.get('cur') != offer['cur']:
            if rrc.get('price'):
                changes.append(('rrc', rrc.get('price'), kop))
            doc['rrc'] = {
                'price': kop,
                'cur': offer['cur'],
                'at': today,
                'old': round(offer['oldprice'] * 100) if offer.get('oldprice') else None,
                'prev': rrc.get('price'),
                'prevAt': rrc.get('at'),
            }
        else:
            rrc['at'] = today
        if doc.get('priceSrc', 'rrc') == 'rrc' and (
            doc.get('price') != kop or (doc.get('priceCur') or 'RUB') != offer['cur']
        ):
            doc['price'], doc['priceCur'], doc['priceSrc'] = kop, offer['cur'], 'rrc'
        _set_cost(doc, kop, offer['cur'], feed, changes, offer)
        doc['costAt'] = today
    if offer.get('nostock'):  # фид из файлов не знает наличия
        return changes
    stock = doc.get('stock') or {}
    stock_info = dict(
        offer.get('stockInfo') or {}, qty=offer['qty'], available=bool(offer['available']), at=today, gone=False
    )
    if (
        stock.get('qty'),
        bool(stock.get('available')),
        bool(stock.get('gone')),
        stock.get('transit'),
        stock.get('prod'),
    ) != (
        stock_info['qty'],
        stock_info['available'],
        False,
        stock_info.get('transit'),
        stock_info.get('prod'),
    ) and stock:
        changes.append(('stock', _stock_txt(stock), _stock_txt(stock_info)))
    doc['stock'] = stock_info
    return changes


def _change(cid, doc, change) -> dict:
    return {
        'id': cid,
        'name': doc.get('name'),
        'kind': change[0],
        'old': change[1],
        'new': change[2],
        'cur': change[3] if len(change) > CUR_AT else '',
    }


def _stock_txt(stock) -> str:
    if not stock:
        return '—'
    if stock.get('gone'):
        return 'нет в фиде'
    wait = ', '.join(
        part
        for part in (
            'в пути {}{}'.format(_fmt(stock['transit']), f' (до {stock["eta"]})' if stock.get('eta') else '')
            if stock.get('transit')
            else '',
            'в производстве {}'.format(_fmt(stock['prod'])) if stock.get('prod') else '',
        )
        if part
    )
    if stock.get('qty') is not None:
        base = 'в наличии {}'.format(_fmt(stock['qty'])) if stock['qty'] > 0 else 'нет в наличии'
        return base + ('; ' + wait if wait else '')
    return 'в наличии' if stock.get('available') else 'нет в наличии'


def _fmt(num) -> str:
    return str(int(num)) if float(num).is_integer() else str(num).replace('.', ',')


# явные правила (по названию позиции, затем по разделу фида) — до общего определения по названию
NAME_RULES = [
    (
        r'сепаратор\S*\s+масляного тумана|масловлагоразделител|сепаратор\S*\s+конденсата|водомаслян\S*\s+сепаратор',
        'oil_sep',
    ),
    (r'угольн\S*\s+колонн', 'filter'),
    (
        r'компрессор\S*\s+медицинск|медицинск\S*\s+компрессор',
        'comp_piston',
    ),  # медицинские Remeza — поршневые безмасляные
    (r'^\s*кожух', 'spare'),
    (r'^\s*конденсатоотводчик', 'condensate'),  # отдельный узел «Очистка и отвод конденсата»; нет такой категории — ЗИП
    (
        r'фильтроэлемент|корпус\S*\s+фильтр|патрон\S*\s+воздушн|картридж|блок\S*\s+поршнев|^\s*(поршень|шатун|цилиндр|палец|вкладыш|сапун|'
        r'прессостат|манометр|редуктор|муфта|полумуфта|радиатор|переходник|пластина|термоэлемент|конденсатоотводчик|комплект колец|кольцо)',
        'spare',
    ),
    (r'циклонн\S*\s+сепаратор', 'filter'),
    (r'модульн\S*\s+компрессорн\S*\s+станци|\bВМКС\b', 'st_comp'),  # АСО: станция в блок-контейнере
    (r'шкаф\S*\s+управления', 'automation'),
    (r'^\s*(рукав|сопло|соплодержател|сцеплени)', 'spare'),  # к аппаратам струйной очистки
    # русские модели без латиницы («Поршневой компрессор К2»): «Поршневой компрессор высокого давления … W 64» не трогается
    (r'^(?!.*[A-Za-z])\s*поршнев\S*\s+компрессор', 'comp_piston'),
    (
        r'^(?!.*[A-Za-z])\s*(винтов\S*\s+компрессор|агрегат\S*\s+компрессорн\S*\s+винтов|установк\S*\s+компрессорн\S*\s+винтов)',
        'comp_screw',
    ),
]
PATH_RULES = [
    (r'воздуходувк', 'blower'),
    (r'генератор\S*\s+азота', 'gen_n2'),
    (r'генератор\S*\s+кислорода', 'gen_o2'),
    (r'адсорбц\S*\s+осушител|осушител\S*.*адсорбц', 'dryer_ads'),
    (r'рефрижераторн\S*\s+осушител|осушител\S*.*рефрижер', 'dryer_refrig'),
    (r'воздушн\S*\s+ресивер', 'receiver'),
    (r'фильтр\S*\s+сжатого воздуха', 'filter'),
    (r'циклонн\S*\s+сепаратор', 'filter'),
    (
        r'винтов\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|компрессорн\S*\s+станци|лазерн|'
        r'безмасл\S*\s+компрессор\S*\s+(сухого сжатия|с водяным впрыском)',
        'comp_screw',
    ),  # Dali CAT, VFW — безмасляные винтовые
    (r'поршнев\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|медицинск\S*\s+компрессор', 'comp_piston'),
    (r'спиральн\S*\s+компрессор|компрессор\S*\s+серии\s+акс', 'comp_scroll'),
    (r'дизель-генератор|дизельн\S*\s+генератор|газопоршнев\S*\s+электростанц', 'dgu'),
    (r'ввод\S*\s+резерв', 'ats'),
]


def _rule(rules, text, ids) -> str:
    for regex, cat in rules:
        if cat in ids and re.search(regex, text or '', re.I):
            return cat
    return ''


def item_cat(offer, types) -> str:
    """Категория программы для позиции фида — только из существующих категорий."""
    ids = {tdef.get('id') for tdef in types}
    path, crumbs = str(offer.get('path') or ''), str(offer.get('crumbs') or '')
    spare = next((tdef for tdef in types if tdef.get('id') == 'spare'), None)
    for part in (crumbs, path):  # «Запчасти и расходные материалы / Для винтовых компрессоров»
        if part and spare and spare.get('match') and re.search(spare['match'], part, re.I):
            return 'spare'
    cat = _rule(NAME_RULES, offer['name'], ids)
    if cat:
        return cat
    if (
        'comp_diesel' in ids
        and re.search(r'компрессор', offer['name'], re.I)
        and re.search(r'дизел', offer['name'], re.I)
    ):
        return 'comp_diesel'  # «Компрессор винтовой дизельный PDP 15-7» — дизельный, а не винтовой
    cat = _rule(
        PATH_RULES, re.split(r'\s+[A-Z]', offer['name'])[0], ids
    )  # вид в начале названия: «Винтовой компрессор EXELUTE EXDM-RD …»
    if cat:  # (в описании станции 4 в 1 первым может идти осушитель)
        return cat
    cat = _rule(PATH_RULES, crumbs, ids)  # настоящий раздел сайта (страница товара) надёжнее подборок фида
    if cat:
        return cat
    kind = ' '.join(
        part['v'] for part in offer.get('params') or [] if re.match(r'^(вид|тип) компрессора$', part['k'], re.I)
    )
    cat = _rule(PATH_RULES, kind + ' компрессор', ids) if kind else ''  # параметр фида «Вид компрессора: винтовой»
    if cat:
        return cat
    if re.match(
        r'^\s*осушител', offer['name'], re.I
    ):  # «Осушитель воздуха Dali CAAD-27MP-D», параметр «Осушитель: Адсорбционный»
        cat = _rule(
            PATH_RULES,
            ' '.join(
                'осушитель ' + part['v']
                for part in offer.get('params') or []
                if re.match(r'^(тип )?осушител', part['k'], re.I)
            ),
            ids,
        )
        if cat:
            return cat
    diesel = re.search(r'дизел', offer['name'] + ' ' + path, re.I)
    cat = catalog_migrate.CatDetect.of({'name': offer['name']}, types)
    if cat == 'comp_diesel' and not diesel:  # «Компрессорная станция МВК» — электрическая, винтовая
        cat = 'comp_screw'
    if cat:
        return cat
    cat = _rule(PATH_RULES, path, ids)
    if cat:
        return cat
    for seg in reversed(path.split(' / ')):
        cat = catalog_migrate.CatDetect.of({'name': seg}, types)
        if cat and not (cat == 'comp_diesel' and not diesel):
            return cat
    if 'comp_diesel' in ids and re.search(r'бензин\S*\s+(\S+\s+)?компрессор', offer['name'], re.I):
        return 'comp_diesel'  # компрессор с бензиновым двигателем — рядом с дизельными (свой двигатель)
    return ''


SPARE_PART = [
    (r'маслян\S*\s+фильтр|фильтр\S*\s+маслян', 'Фильтр масляный'),
    (r'сепаратор|маслоотделител', 'Сепаратор (маслоотделитель)'),
    (r'воздушн\S*\s+фильтр|фильтр\S*\s+воздушн|патрон|картридж', 'Фильтр воздушный'),
    (r'фильтроэлемент', 'Фильтроэлемент магистрального фильтра'),
    (r'масло', 'Масло компрессорное'),
    (r'ремень|ремни', 'Ремень приводной'),
    (r'датчик|термоэлемент|прессостат|манометр|конденсаторн', 'Датчики и электрика'),
    (r'клапан|прокладк|сальник|кольц|уплотн', 'Ремкомплект (клапаны, уплотнения)'),
    (r'блок\S*\s+поршнев|поршн|поршень|шатун|цилиндр|палец|пальц|вкладыш', 'Поршневой блок и детали'),
]
PISTON_SERIES = r'(?<![\w])(?:LB|LT|LH|OLD|AB|АВ)\d[\w.]*(?:[-/][\w.]+)*'


def spare_info(offer) -> dict:
    """Запасная часть: вид, для какого оборудования, к каким моделям (название, раздел фида, страница товара)."""
    name, path = offer['name'], str(offer.get('crumbs') or offer.get('path') or '')
    last = path.rsplit(' / ', maxsplit=1)[-1] if path else ''
    use = next(
        (v for k, v in offer.get('props') or [] if re.match(r'(?i)^(применение|назначение|тип оборудования)$', k)), ''
    )
    part = (
        next((v for regex, v in SPARE_PART if re.search(regex, name, re.I)), '')
        or next((v for regex, v in SPARE_PART if re.search(regex, last, re.I)), '')
        or 'Прочее'
    )
    series = re.findall(PISTON_SERIES, name)
    text = use + ' ' + path + ' ' + name
    for_type = (
        'Винтовые компрессоры'
        if re.search(r'винтов|\bВК\s*\d', text, re.I)
        else 'Поршневые компрессоры'
        if series or re.search(r'поршнев|медицинск|кожух', text, re.I)
        else 'Спиральные компрессоры'
        if re.search(r'спиральн', text, re.I)
        else 'Магистральные фильтры'
        if re.search(r'фильтроэлемент|корпус\S*\s+фильтр|фильтр\S*\s+сжатого', text, re.I)
        else ''
    )
    models = offer.get('apply') or ', '.join(dict.fromkeys(series))
    svc = next(
        (
            match.group(1)
            for k, v in offer.get('props') or []
            for match in [re.search(r'(?i)замен\S*\D{0,25}?(\d[\d\s]{1,6})\s*(?:моточас|час|ч\b)', v)]
            if match
        ),
        '',
    )
    return {
        'part': part,
        'forType': for_type,
        'forModels': models[:600],
        'service': int(re.sub(r'\s', '', svc)) if svc else None,
    }


CRUMB_ATTRS = [  # признаки, которые видны только по разделу сайта: (категории, раздел/название, поле, значение)
    (('dryer_ads',), r'холодн\S* регенерац', 'regen', 'Холодная (без нагрева)'),
    (('dryer_ads',), r'горяч\S* регенерац', 'regen', 'Горячая (с нагревом)'),
    (('comp_piston', 'comp_scroll', 'comp_screw'), r'безмасл', 'oilFree', 'Да'),
    (('comp_piston', 'comp_screw'), r'маслозаполн|масл\S+\s+компрессор', 'oilFree', 'Нет'),
    (('comp_piston', 'comp_scroll'), r'ремен\S* привод', 'drive', 'Ременной'),
    (('comp_piston', 'comp_scroll'), r'прям\S* привод', 'drive', 'Прямой'),
    (('comp_screw',), r'частотн|постоянн\S* магнит', 'vsd', 'Да'),
    (('comp_piston',), r'передвижн', 'execution', 'Передвижной'),
    (('comp_screw', 'comp_scroll'), r'на ресивере|ресивер\S* \d', 'execution', 'На ресивере'),
    (('comp_screw', 'comp_scroll'), r'с осушител|осушител\S* встроен', 'dryer', 'Да'),
]


DESC_ATTRS = [  # пустые поля — из описания, когда характеристик на странице нет: (поле, выражение, значение или группа)
    ('drive', r'ремённ\S*|ременн\S*\s+(?:привод|передач)', 'Ременной'),
    ('drive', r'прям\S*\s+привод', 'Прямой'),
    ('voltage', r'напряжени\S*\s+(?:сети\s+)?(220|380|400)\s*в\b', 1),
    ('receiver', r'ресивер\S*\s+(?:объ[её]мом\s+)?(?:на\s+)?(\d{2,4})\s*(?:л|литр)', 1),
    (
        'stages',
        r'(двухступенчат|одноступенчат)',
        lambda match: '2' if match.group(1).lower().startswith('дву') else '1',
    ),
]


# параметры фида вида «Частотный преобразователь: есть», «Тип охлаждения: воздушное» → поля категории (Да / Нет, Воздушное / Водяное)
ROW_ATTRS = (
    ('vsd', r'^частотн|преобразовател\S*\s+частот', ((r'^(есть|да)\b', 'Да'), (r'^нет\b', 'Нет'))),
    ('dryer', r'^(встроенный\s+)?осушител', ((r'^нет\b', 'Нет'), (r'^(есть|да)\b|встроен|рефриж|адсорб', 'Да'))),
    ('cooling', r'^(тип\s+)?охлаждени', ((r'воздуш', 'Воздушное'), (r'водян', 'Водяное'))),
)


def row_attrs(tdef, rows, attrs) -> None:
    fields = {field.get('key'): field for field in tdef.get('fields') or []}
    for key, krx, vals in ROW_ATTRS:
        field = fields.get(key)
        if not field or attrs.get(key) not in (None, ''):
            continue
        for row in rows:
            if not re.search(krx, row['k'], re.I):
                continue
            v = next((out for vrx, out in vals if re.search(vrx, str(row['v']).strip(), re.I)), '')
            if v and (not field.get('values') or v in field['values']):
                attrs[key] = v
            break


def desc_attrs(tdef, text, attrs) -> None:
    fields = {field.get('key'): field for field in tdef.get('fields') or []}
    for k, regex, v in DESC_ATTRS:
        match = re.search(regex, text or '', re.I)
        if (
            k == 'drive'
            and match
            and sum(1 for attr_key, rx2, _ in DESC_ATTRS if attr_key == 'drive' and re.search(rx2, text or '', re.I))
            > 1
        ):
            continue  # «прямой привод надёжнее ременной передачи» — не угадывать
        if k not in fields or attrs.get(k) or not match:
            continue
        if callable(v):
            attrs[k] = v(match)
        elif isinstance(v, int):  # номер группы выражения
            attrs[k] = int(match.group(v)) if k == 'receiver' else match.group(v)
        else:
            attrs[k] = v


def crumb_attrs(tdef, text, attrs) -> None:
    keys = {field.get('key') for field in tdef.get('fields') or []}
    for cats, regex, k, v in CRUMB_ATTRS:
        if tdef.get('id') in cats and k in keys and not attrs.get(k) and re.search(regex, text or '', re.I):
            attrs[k] = v


def model_of(offer, maker) -> str:
    """Модель: <model> из фида, иначе из названия, иначе артикул."""
    if offer['model']:
        return offer['model'][:80]
    brands = {_brand_key(maker), _brand_key(offer['vendor'])} - {''}
    words = [word for word in offer['name'].split() if _brand_key(word) not in brands]
    if offer['sku'] and words and words[0] == offer['sku']:
        return offer['sku'][:80]
    i = 0
    while (
        i < len(words)
        and re.fullmatch(r'[А-Яа-яЁёA-Za-z-]+', words[i])
        and not (len(words[i]) > 1 and words[i].isupper())
    ):
        i += 1
    rest = re.sub(r'^(\([^)]*\)\s*)+', '', ' '.join(words[i:]))  # «Сепаратор (маслоотделитель) для ВК20» — не модель
    rest = re.split(r'(?:^|\s+)(?:с|со|для|в комплекте)\s+', rest)[0].strip(' ,–-')
    rest = re.sub(r'(\s+[а-яё]+)+$', '', rest)  # «РВ 500/11 вертикальный» → «РВ 500/11»
    return (rest or offer['sku'] or '')[:80]


def makers(feed) -> list:
    """Производители фида: «EXELUTE, LUPAMAT, ALMIG» — у дистрибьютора несколько марок (у позиции — своя, из парса)."""
    return [x.strip() for x in re.split(r'[,;]', feed.get('maker') or '') if x.strip()]


def maker_of(offer, feed) -> str:
    makers_list = makers(feed)
    for maker_name in makers_list:
        if not offer['vendor'] or _brand_key(offer['vendor']) == _brand_key(maker_name):
            return maker_name
    return offer['vendor'] or (makers_list[0] if makers_list else '')


def build(offer, feed, types, old=None, put_image=None) -> tuple:
    """Позиция каталога из предложения фида; old — та же позиция в каталоге (ручные правки сохраняются)."""
    today = date.today().isoformat()
    doc = json.loads(json.dumps(old)) if old else {'prices': []}
    cat_id = (feed.get('cats') or {}).get(offer['cat']) or ''
    tmap = {tdef.get('id'): tdef for tdef in types}
    maker = maker_of(offer, feed)
    model = model_of(offer, maker)
    auto = cat_id or item_cat(offer, types) or 'other'
    spare = spare_info(offer) if auto == 'spare' else None
    if spare:
        offer = dict(
            offer,
            extraRows=[
                ('Артикул', offer['sku']),
                ('Для оборудования', spare['forType']),
                ('Применимость', spare['forModels']),
            ],
        )
    rows = _fix_drive_rows(_rows(offer), offer, feed)
    orig = (doc.get('feed') or {}).get('orig') or {}
    # позиция заведена вручную (связана с фидом по модели): признак хранится в doc.feed.linked и действует при каждой загрузке
    handmade = bool(old) and (
        (old.get('feed') or {}).get('linked')
        or (not (old.get('feed') or {}).get('orig') and bool(old.get('groups') or old.get('features')))
    )
    if handmade:  # позиция заведена вручную: её текст и таблицы остаются, значения из файла — точнее, остальное — отдельной группой
        rows = _apply_rows(doc, rows)
    desc = '' if handmade and doc.get('features') else offer['desc']
    new_orig = {'name': offer['name'], 'desc': _hash(desc), 'rows': _hash(rows)}
    if not old or doc.get('name') == orig.get('name'):
        doc['name'] = offer['name']
    feats = doc.get('features') or []
    # описание из фида — несколько блоков карточки (feed_files.desc_blocks); пока их не правили вручную, они обновляются целиком
    fds = [x for x in feats if x.get('feed') and not x.get('feedOpts')]
    blocks = feed_files.desc_blocks(desc) if desc else []
    untouched = (
        not fds
        or _hash('\n'.join(x.get('text') or '' for x in fds)) == orig.get('desc')
        or _hash([[x.get('label') or '', x.get('text') or ''] for x in fds]) == orig.get('descBlocks')
    )
    if blocks and untouched:
        pos = feats.index(fds[0]) if fds else 0
        for x in fds:
            feats.remove(x)
        feats[pos:pos] = [
            {
                'id': hashlib.md5(
                    (offer['oid'] + 'd' + ('' if i == 0 else str(i))).encode(), usedforsecurity=False
                ).hexdigest()[:8],
                'label': lab,
                'text': txt,
                'feed': True,
            }
            for i, (lab, txt) in enumerate(blocks)
        ]
    new_orig['descBlocks'] = _hash([[lab, txt] for lab, txt in blocks])
    opts = offer.get('opts') or []
    feat = next((x for x in feats if x.get('feedOpts')), None)
    otext = '; '.join('{} — {} {}'.format(x['name'], _fmt(x['price']), offer['cur']) for x in opts) if opts else ''
    if otext and (not feat or _hash(feat.get('text') or '') == orig.get('opts')):
        if feat:
            feat['text'] = otext
        else:
            feats.append(
                {
                    'id': hashlib.md5((offer['oid'] + 'o').encode(), usedforsecurity=False).hexdigest()[:8],
                    'label': 'Опции по прайсу поставщика',
                    'text': otext,
                    'feed': True,
                    'feedOpts': True,
                }
            )
    elif not otext and feat and _hash(feat.get('text') or '') == orig.get('opts'):
        feats.remove(feat)
    new_orig['opts'] = _hash(otext)
    doc['features'] = feats
    groups = doc.get('groups') or []
    group_ix = next((i for i, group in enumerate(groups) if group.get('feed')), None)
    if group_ix is not None and not rows and _hash(groups[group_ix].get('rows') or []) == orig.get('rows'):
        groups.pop(group_ix)  # характеристик из фида и со страницы больше нет, вручную таблицу не меняли
    elif rows and (group_ix is None or _hash(groups[group_ix].get('rows') or []) == orig.get('rows')):
        group = {'name': 'Данные поставщика' if handmade else 'Характеристики', 'rows': rows, 'feed': True}
        if group_ix is not None:
            groups[group_ix] = group
        elif handmade:  # у позиции, заведённой вручную, данные поставщика — после её таблиц
            groups.append(group)
        else:
            groups.insert(0, group)
    doc['groups'] = groups
    attrs = doc.get('attrs') or {}
    # категория: новая позиция — по правилам; загруженная раньше — тоже, если её не меняли вручную
    prev_auto = (doc.get('feed') or {}).get('catAuto')
    if not attrs.get('cat') or (old and attrs.get('cat') == (prev_auto or attrs.get('cat'))):
        attrs['cat'] = auto
    if not attrs.get('maker'):
        attrs['maker'] = maker
    if not attrs.get('model'):
        attrs['model'] = model
    tdef = tmap.get(attrs['cat'])
    if tdef and offer.get('authoritative'):  # характеристики из файлов точнее: поля категории — заново по ним
        _redo_attrs(doc, tdef, attrs, handmade)
    if tdef:
        catalog_migrate.fill_from_name(doc, attrs['cat'], attrs)
        catalog_migrate.fill_attrs(doc, tdef, attrs)
        crumb_attrs(tdef, (offer.get('crumbs') or '') + ' / ' + offer['name'], attrs)
        desc_attrs(tdef, desc, attrs)
        row_attrs(tdef, rows, attrs)
    if spare and attrs['cat'] == 'spare':
        for k, v in (
            ('part', spare['part']),
            ('forType', spare['forType']),
            ('forModels', spare['forModels']),
            ('article', offer['sku']),
            ('forMaker', maker),
            ('service', spare['service']),
            (
                'original',
                'Оригинал' if maker and _brand_key(maker) in {_brand_key(match) for match in makers(feed)} else '',
            ),
        ):
            if v and not attrs.get(k):
                attrs[k] = v
    doc['attrs'] = attrs
    if not doc.get('spec'):  # строка под названием: мощность, производительность, давление, ресивер — потом остальное
        top = {'power': 0, 'flow': 1, 'pressure': 2, 'receiver': 3}
        best = sorted(
            (
                row for row in rows if not re.match(r'^(нет|есть|да|-)$', str(row['v']).strip(), re.I)
            ),  # «Ресивер: нет» — не в строку
            key=lambda row_item: top.get(feed_files.spec_class(row_item['k']), 9),
        )
        doc['spec'] = ' · '.join(row['v'] for row in best[:4])[:200]
    if not doc.get('unit'):
        doc['unit'] = 'шт.'
    doc['feed'] = {
        'id': feed['id'],
        'files': feed.get('kind') == 'files',
        'oid': offer['oid'],
        'url': offer['url'],
        'sku': offer['sku'],
        'barcode': offer['barcode'],
        'cat': offer['cat'],
        'path': offer.get('path', ''),
        'crumbs': offer.get('crumbs', ''),
        'sheet': offer.get('sheet', ''),
        'catAuto': auto,
        'orig': new_orig,
        'at': today,
        'linked': bool(handmade),
    }
    changes = _price_part(doc, offer, feed, today)
    if put_image and offer['pictures']:
        if not (doc.get('photo') or {}).get('src'):
            photo = put_image(offer['pictures'][0], tdef, maker, model, offer['name'], 'photo', '')
            if photo:
                doc['photo'] = photo
                doc['photoSource'] = offer['pictures'][0]
        if doc.get('photoSource'):  # главное фото не повторяется в изображениях
            doc['gallery'] = [group for group in doc.get('gallery') or [] if group.get('source') != doc['photoSource']]
        have = {group.get('source') for group in doc.get('gallery') or []} | {
            doc.get('photoSource')
        }  # главное фото, выбранное в редакторе, — не дублировать
        gal = doc.get('gallery') or []
        for pic_no, u in enumerate(
            offer['pictures'][:9]
        ):  # с первого: если главным выбрано другое фото, первое — в изображениях
            if u in have:
                continue
            group = put_image(u, tdef, maker, model, offer['name'], 'gallery', f'foto-{pic_no + 1}')
            if group:
                gal.append(
                    dict(
                        group,
                        id=hashlib.md5(u.encode(), usedforsecurity=False).hexdigest()[:8],
                        caption='',
                        on=True,
                        source=u,
                    )
                )
        doc['gallery'] = gal
    doc['updatedAt'] = _now()
    return doc, changes


def _apply_rows(doc, rows) -> list:
    """Строки из файла — в имеющиеся таблицы позиции (тот же параметр — замена), остальное → список."""
    multi = re.compile(r'\d\s*[/–—-]\s*\d|\bпри\b')
    rest = []
    for row in rows:
        cls_name = feed_files.spec_class(row['k'])
        hit = None
        for group in doc.get('groups') or []:
            if group.get('feed'):
                continue
            for exist_row in group.get('rows') or []:
                exist_val = str(exist_row.get('v') or '')
                if (
                    feed_files.spec_class(exist_row.get('k')) == cls_name
                    and re.search(r'\d', exist_val)
                    and (cls_name not in ('flow', 'pressure') or not multi.search(exist_val))
                ):
                    hit = exist_row
                    break
            if hit:
                break
        if hit:
            if cls_name in (
                'flow',
                'pressure',
                'power',
                'mass',
                'dims',
                'noise',
                'outlet',
                'receiver',
                'voltage',
                'refrigerant',
                'controller',
                'dryer',
                'filters',
                'rpm',
                'purity',
            ):
                hit['v'] = row['v']
        else:
            rest.append(row)
    return rest


def _redo_attrs(doc, tdef, attrs, handmade) -> None:
    """Поля категории заново по таблице характеристик из файла (она точнее)."""
    keep = {'cat', 'maker', 'model', 'series'} | ({'flow', 'pressure'} if handmade else set())
    for field in tdef.get('fields') or []:
        k = field.get('key')
        if k and k not in keep and field.get('find'):
            attrs.pop(k, None)
    catalog_migrate.fill_attrs(doc, tdef, attrs)


def _logo_filler(store, image_store, feed) -> tuple:
    """Логотип у позиций фида: уже имеющийся у марки в каталоге, иначе — из JSON-парса."""
    have = {_brand_key(v['maker']): v for v in imgfetch.logos(store).values()}
    logos = {_brand_key(k): v for k, v in (feed.get('logos') or {}).items() if v}
    pins = MakerLogos(store)  # логотип, закреплённый администратором за маркой, — всегда, даже поверх логотипа позиции
    state: dict[str, Any] = {'put': None, 'save': None}

    def fill(doc) -> bool:
        maker = (doc.get('attrs') or {}).get('maker') or ''
        pin = pins.pinned(maker) if maker else None
        if pin:
            if (doc.get('logo') or {}).get('src') == pin['src']:
                return False
            doc['logo'] = {'src': pin['src'], 'w': pin.get('w'), 'h': pin.get('h')}
            return True
        if (doc.get('logo') or {}).get('src'):
            return False
        brand = _brand_key(maker)
        if not brand:
            return False
        logo = have.get(brand)
        if not logo and logos.get(brand) and image_store is not None:
            if state['put'] is None:
                state['put'], state['save'], _ = _image_putter(store, image_store)
            got = state['put'](logos[brand], None, maker, '', maker, 'logo', '')
            if got:
                logo = have[brand] = {'maker': maker, 'src': got['src'], 'w': got.get('w'), 'h': got.get('h')}
        if not logo:
            return False
        doc['logo'] = {'src': logo['src'], 'w': logo.get('w'), 'h': logo.get('h')}
        return True

    def save() -> None:
        if state['save']:
            state['save']()

    return fill, save


def _image_putter(store, image_store) -> tuple:
    cache = store.kv_get('feedimg') or {}
    lock = threading.Lock()
    stat: dict[str, Any] = {'got': 0, 'fail': []}  # скачано новых картинок; не скачались — «адрес: причина»

    def put(url, tdef, maker, model, name, kind, caption) -> dict | None:
        with lock:
            hit = cache.get(url)
        if hit and image_store.path(hit['rel']):
            return {'src': '/img/' + hit['rel'], 'w': hit.get('w'), 'h': hit.get('h')}
        split = urllib.parse.urlsplit(url)
        try:
            if url.startswith('kpa:'):  # картинка из самого JSON-парса (вырезка из каталога)
                ctype, data = feed_files.asset(url) or (None, None)
                if not data:
                    raise ValueError('картинки нет в файле парса — загрузите парс заново')
            else:
                ctype, data = _probe_get(url) or imgfetch.fetch_image(
                    url, referer=f'{split.scheme}://{split.netloc}/', tries=2
                )
        except Exception as exc:
            with lock:
                stat['fail'].append(f'{url[-70:]}: {str(exc)[:100]}')
            return None
        ext = {'image/png': '.png', 'image/webp': '.webp'}.get(ctype, '.jpg')
        folder, title = images.place(tdef, maker, model, name, kind, caption)
        rel = image_store.put(data, ext, folder, title)
        width, height = _img_size(data)
        with lock:
            cache[url] = {'rel': rel, 'w': width, 'h': height}
            stat['got'] += 1
        return {'src': '/img/' + rel, 'w': width, 'h': height}

    def save() -> None:
        with lock:
            store.kv_set('feedimg', dict(list(cache.items())[-20000:]))

    return put, save, stat


def page_photos(store, image_store, url, tdef=None, maker='', model='', name='', urls=None) -> dict:
    """Фото со страницы товара для одной позиции: [{src, w, h, source}] и ошибки скачивания."""
    if urls:
        urls = [u for u in urls if isinstance(u, str) and re.match(r'^https?://', u)][:20]
    else:
        html = page_html(url)
        urls = page_images(html, url) or page_images_any(html, url)
    if not urls:
        raise ValueError('на странице не найдено фото товара')
    put, save, stat = _image_putter(store, image_store)
    out = []
    for k, u in enumerate(urls):
        got = put(u, tdef, maker, model, name, 'gallery', f'foto-{k + 1}')
        if got:
            out.append(dict(got, source=u))
    save()
    return {'imgs': out, 'errors': stat['fail'][:10]}


def _job(fid: str, kind, total=0) -> dict:
    j = {'kind': kind, 'state': 'run', 'done': 0, 'total': total, 'msg': '', 'startedAt': _now(), 'result': None}
    JOBS[fid] = j
    return j


def busy(fid: str) -> bool:
    j = JOBS.get(fid)
    return bool(j and j['state'] == 'run')


def _img_key(u) -> str:
    """Одна картинка в разных размерах («/upload/abc.png» и «/upload/cache/max_360x500/abc.png») — один ключ."""
    return str(u or '').split('?')[0].rstrip('/').rsplit('/', 1)[-1].lower()


def import_feed(
    store, feed_cfg, types, image_store, author: str = '', only=None, log=print, missing: Missing = Missing.KEEP
) -> dict:
    """Загрузка фида в каталог: новые позиции создаются, связанные обновляются (ручные правки сохраняются)."""
    j = _job(feed_cfg['id'], 'import')
    try:
        feed = load(store, feed_cfg)
        # пропускаемые категории, удалённые администратором позиции (FeedPurge) и отбор «Что загружать» (FeedRules)
        offs = [
            offer
            for offer in feed['offers']
            if not FeedRules.reason(offer, feed_cfg) and (not only or offer['oid'] in only)
        ]
        fdocs = _feed_docs(store, feed_cfg['id'])
        revs = store.catalog_revs()  # номера правок на начало загрузки: правку менеджера за время загрузки не затираем
        existing = {(card.get('feed') or {}).get('oid'): card for card in fdocs}
        if not FeedRules.adds(feed_cfg):  # «новые позиции не создавать» — только уже загруженные
            offs = [offer for offer in offs if offer['oid'] in existing]
        links, lstat, mode, plan = {}, {}, 'import', None
        if feed_cfg.get('kind') == 'files':
            plan = build_plan(store, feed_cfg, offs, fdocs)
            if feed_cfg.get('built'):  # каталог сформирован: парс только добавляет новое, имеющееся не трогает
                mode = 'add'
                offs = [offer for offer in offs if offer['oid'] not in existing and offer['oid'] not in plan['links']]
                existing = {}
            else:
                mode = 'build'
                try:  # сборка перестраивает много позиций — сначала копия базы в data/backup
                    store.backup(
                        os.path.join(
                            os.path.dirname(store.path),
                            'backup',
                            'kp-{}-before-feed-build.zip'.format(datetime.now().strftime('%Y%m%d-%H%M%S')),
                        )
                    )
                except Exception as exc:
                    log(f'Копия базы перед сборкой каталога не создана: {exc}')
                links = {
                    oid: {'id': card['id'], 'prices': card.get('prices') or []} for oid, card in plan['links'].items()
                }
                existing = {}
                gone = plan['dups'] + (plan['keep'] if missing is Missing.TRASH else [])
                for card in gone:  # дубли — в корзину до записи новых позиций (id новой может совпасть)
                    store.trash_put(
                        'catalog',
                        card['id'],
                        card.get('name') or card['id'],
                        author or ('Фид «{}»'.format(feed_cfg['name'])),
                    )
            lstat = {
                'linked': len(plan['links']),
                'dups': len(plan['dups']),
                'keep': len(plan['keep']),
                'trashed': len(plan['dups'])
                + (len(plan['keep']) if mode == 'build' and missing is Missing.TRASH else 0),
            }
        j['total'] = len(offs)
        put, save, istat = _image_putter(store, image_store)
        logo_fill, logo_save = _logo_filler(store, image_store, feed)
        dget, dsave, derr = _page_getter(store)
        photo = _placeholders(feed['offers'])
        pstat: dict[str, Any] = {'img': 0, 'noimg': []}  # страниц товара: с фото / открылись, но фото не найдено
        added = 0
        updated = 0
        same = 0
        price_ch: list = []
        stock_ch: list = []
        errors = []

        def one(offer_item) -> tuple:
            try:
                return _one(offer_item)
            except Exception as err:  # одна позиция с ошибкой не обрывает всю загрузку
                return offer_item, None, err, None

        def _one(src_offer) -> tuple:
            old = existing.get(src_offer['oid']) or links.get(src_offer['oid'])
            if not old:
                cid = _cid(feed_cfg['id'], src_offer['oid'])
                base = store.rev_of('catalog', cid)['rev']
                prev = store.catalog_get(cid)
                old = json.loads(prev) if prev else None
                if old:
                    revs[cid] = base
            old0 = old  # для сравнения «изменилось ли»: old ниже может быть очищен от лишних фото
            src_offer = dict(src_offer, pictures=[u for u in src_offer['pictures'] if u not in photo])
            if old and photo:  # заглушка «нет фото», загруженная раньше, — заменить фото со страницы
                if old.get('photoSource') in photo:
                    old = dict(old, photo=None, photoSource=None)
                old = dict(
                    old,
                    gallery=[gal_item for gal_item in old.get('gallery') or [] if gal_item.get('source') not in photo],
                )
            if feed_cfg.get('pageDesc', True) and src_offer['url']:
                page_info = dget(src_offer['url'])
                if page_info.get('imgs'):
                    pstat['img'] += 1
                elif page_info:
                    pstat['noimg'].append(src_offer['name'][:60])
                if (
                    len(page_info.get('t') or '') > len(src_offer['desc'])
                    and feed_cfg.get('kind') != 'files'
                    and not src_offer.get('descFixed')
                ):  # у фида из файлов и из файла описаний — своё
                    src_offer['desc'] = page_info['t']
                gal = [u for u in page_info.get('imgs') or [] if u not in photo][:9]
                if (
                    gal and feed_cfg.get('kind') == 'files'
                ):  # главное фото — из парса, страница товара добавляет остальные
                    keys = {_img_key(u) for u in src_offer['pictures']}
                    src_offer['pictures'] = (src_offer['pictures'] + [u for u in gal if _img_key(u) not in keys])[:10]
                    gal = []
                if gal:  # фото — только из галереи карточки товара; картинки фида — лишь когда галереи нет
                    src_offer['pictures'] = gal
                    if (
                        old
                    ):  # загруженное раньше не из галереи (фид, описание, og:image) — убрать, если не правили вручную
                        keep = set(gal)
                        old = dict(
                            old,
                            gallery=[
                                gal_item
                                for gal_item in old.get('gallery') or []
                                if not gal_item.get('source')
                                or gal_item['source'] in keep
                                or gal_item.get('caption')
                                or gal_item.get('slot')
                                or gal_item.get('at')
                            ],
                        )
                        if old.get('photoSource') and old['photoSource'] not in keep:
                            old = dict(old, photo=None, photoSource=None)
                src_offer['props'], src_offer['apply'], src_offer['crumbs'] = (
                    page_info.get('props') or [],
                    page_info.get('apply') or '',
                    page_info.get('crumbs') or '',
                )
            doc, changes = build(src_offer, feed_cfg, types, old, put)
            if old0 and mode != 'build':  # выключенные в «Что загружать» поля — как были в каталоге
                doc, changes = FeedRules.keep(doc, old0, feed_cfg), FeedRules.changes(changes, feed_cfg)
            logo_fill(doc)
            return src_offer, old0, doc, changes

        def norm(x) -> str:  # позиция без служебных полей — сравнить, изменилась ли
            return json.dumps(
                {k: v for k, v in (x or {}).items() if k not in ('updatedAt', '_rev', 'id')},
                sort_keys=True,
                ensure_ascii=False,
            )

        pend: list = []

        def flush() -> None:
            """Накопленные позиции — одной транзакцией (WriteBatch): потоки скачивания в это время не ждут базу."""
            nonlocal added, updated
            with WriteBatch(store, 10**9):
                for pend_offer, old, cid, doc, change_list in pend:
                    try:
                        store.catalog_stage(
                            cid,
                            json.dumps(doc, ensure_ascii=False),
                            author or ('Фид «{}»'.format(feed_cfg['name'])),
                            revs.get(cid) if old else None,
                        )
                        added += 0 if old else 1
                        updated += 1 if old else 0
                        for change in change_list:
                            (stock_ch if change[0] == 'stock' else price_ch).append(_change(cid, doc, change))
                    except Conflict as flush_err:
                        errors.append(
                            '{}: позицию изменили во время загрузки ({}) — оставлена как есть, обновится при следующей загрузке'.format(
                                pend_offer['name'][:60], flush_err.author or 'кто-то'
                            )
                        )
                    except Exception as flush_err:
                        errors.append('{}: {}'.format(pend_offer['name'][:60], flush_err))
            pend.clear()

        with ThreadPoolExecutor(6) as executor:
            for offer, old, doc, result in executor.map(one, offs):
                if isinstance(doc, Exception):
                    errors.append('{}: {}'.format(str(offer.get('name') or '')[:60], doc))
                    j['done'] += 1
                    continue
                try:
                    cid = (old or {}).get('id') or _cid(feed_cfg['id'], offer['oid'])
                    if old and norm(old) == norm(doc):
                        same += 1
                        for change_item in result:
                            (stock_ch if change_item[0] == 'stock' else price_ch).append(_change(cid, doc, change_item))
                    else:
                        pend.append((offer, old, cid, doc, result))
                        if len(pend) >= WriteBatch.SIZE:
                            flush()
                except Exception as exc:
                    errors.append('{}: {}'.format(offer['name'][:60], exc))
                j['done'] += 1
        flush()
        save()
        logo_save()
        dsave()
        borrowed = FeedPhotoFrom(store, types).fill(_feed_docs(store, feed_cfg['id']), author or 'Фид')
        if derr:
            errors.append(
                f'Страница товара не открылась (описание, фото, применимость), позиций: {len(derr)} (первая: {derr[0]})'
            )
        if istat['fail']:
            errors.append(f'Фото не скачались: {len(istat["fail"])} (первое: {istat["fail"][0]})')
        if pstat['noimg']:
            errors.append(
                f'На странице товара не найдено фото, позиций: {len(pstat["noimg"])} ({"; ".join(pstat["noimg"][:3])}{" …" if len(pstat["noimg"]) > NOIMG_SHOWN else ""})'
            )
        pics = [
            len(card.get('gallery') or []) + (1 if (card.get('photo') or {}).get('src') else 0)
            for card in _feed_docs(store, feed_cfg['id'])
        ]
        if mode == 'build':
            items = feeds(store)
            for x in items:
                if x.get('id') == feed_cfg['id']:
                    x['built'] = {
                        'at': _now(),
                        'by': author,
                        'items': len(offs),
                        'linked': lstat.get('linked', 0),
                        'trashed': lstat.get('trashed', 0),
                    }
                    x['variants'] = []
            store.kv_set(KV_KEY, {'items': items})
            with _LOCK:
                _CACHE.pop(feed_cfg['id'], None)
        res = {
            'at': _now(),
            'kind': 'import',
            'mode': mode,
            'by': author,
            'total': len(offs),
            'added': added,
            'updated': updated,
            'same': same,
            'linked': lstat.get('linked', 0),
            'dups': [card.get('name') for card in (plan or {}).get('dups', [])][:300],
            'keep': [card.get('name') for card in (plan or {}).get('keep', [])][:300],
            'trashed': lstat.get('trashed', 0),
            'price': price_ch[:300],
            'stock': stock_ch[:300],
            'errors': errors[:50],
            'photos': {
                'borrowed': borrowed,
                'new': istat['got'],
                'pages': pstat['img'],
                'items': len(pics),
                'multi': sum(1 for num in pics if num > 1),
                'avg': round(sum(pics) / len(pics), 1) if pics else 0,
            },
        }
        _log_add(store, feed_cfg['id'], res)
        _mark(store, feed_cfg['id'], 'import', res)
        j.update(state='done', result=res, msg=f'Добавлено {added}, обновлено {updated}')
        return res
    except Exception as exc:
        j.update(state='error', msg=str(exc)[:300])
        _log_add(store, feed_cfg['id'], {'at': _now(), 'kind': 'import', 'by': author, 'error': str(exc)[:300]})
        log('Фид {}: {}'.format(feed_cfg['id'], exc))
        raise


def _maker_cards(store, feed) -> list:
    """Позиции каталога производителей фида (f.maker), заведённые вручную и не связанные ни с одним фидом."""
    maker = {_brand_key(maker_name) for maker_name in makers(feed)} - {''}
    if not maker:
        return []
    out = []
    for (doc,) in store.all('SELECT doc FROM catalog'):
        try:
            card = json.loads(doc)
        except ValueError:
            continue
        if (card.get('feed') or {}).get('id'):
            continue
        if _brand_key((card.get('attrs') or {}).get('maker')) in maker:
            out.append(card)
    return out


class CatalogPut:
    """Запись позиции, изменённой фидом, в каталог; правку менеджера за время проверки не затираем (номер правки)."""

    def __init__(self, store, author: str) -> None:
        self.store, self.author, self.revs = store, author, store.catalog_revs()

    def put(self, was: dict, doc: dict) -> bool:
        """was — позиция до изменений; → записана ли."""
        try:
            self.store.catalog_put(
                doc['id'], json.dumps(doc, ensure_ascii=False), self.author, self.revs.get(doc['id'])
            )
        except Conflict:
            return False  # позицию изменили во время проверки — обновится при следующей
        return True


def price_cards(store, feed, prices, today, author: str = '', stock=None, sink=None) -> tuple:
    """Ручные карточки производителя ↔ строки прайса: РРЦ, цена КП и закупка по сетке скидок.
    sink — куда идут изменённые позиции (CatalogPut — в каталог; предпросмотр — только запоминает)."""
    changes: list = []
    sumr: dict[str, Any] = {'cards': 0, 'priced': 0, 'updated': 0, 'noPrice': [], 'missing': [], 'unclear': []}
    sidx = feed_files.stock_index(stock) if stock else None
    sink = sink or CatalogPut(store, author or ('Фид «{}»'.format(feed['name'])))
    genset = any(price.get('genset') for price in prices)
    for doc in _maker_cards(store, feed):
        was = json.loads(json.dumps(doc))
        attrs = doc.get('attrs') or {}
        sumr['cards'] += 1
        rows, why = feed_files.match_card(doc.get('name'), attrs.get('model'), attrs, prices)
        if why:
            key = {'в прайсе без цены': 'noPrice', 'нет в прайсе': 'missing'}.get(why, 'unclear')
            sumr[key].append(
                {'id': doc['id'], 'name': doc.get('name'), 'why': why, 'rows': [price['name'] for price in rows[:3]]}
            )
            if genset and feed_files.GensetMatch.lost(doc, rows, feed['id'], today) and sink.put(was, doc):
                sumr['updated'] += 1
            continue
        price = rows[0]
        before = json.dumps(
            [
                doc.get('rrc'),
                doc.get('price'),
                doc.get('cost'),
                doc.get('costDisc'),
                doc.get('priceLink'),
                doc.get('stock'),
            ],
            sort_keys=True,
            ensure_ascii=False,
        )
        offer = {
            'price': price['price'],
            'oldprice': None,
            'cur': (price.get('cur') or feed.get('cur') or 'EUR').upper(),
            'nostock': True,
            'dealer': price.get('dealer'),
            'disc': price.get('disc'),
        }
        if (
            stock and sidx is not None and not price.get('genset')
        ):  # остатки поставщика — и у карточек, заведённых вручную
            row = feed_files.StockModel.of_rows(stock, rows, doc.get('name'), sidx)
            stock_info = feed_files.stock_info(row)
            offer.update(qty=stock_info['qty'], available=stock_info['available'], nostock=False, stockInfo=stock_info)
        elif price.get('genset'):  # прайс-склад ДГУ: наличие машин — в самом прайсе
            stock_info = feed_files.GensetMatch.stock(rows) or feed_files.stock_info(None)
            offer.update(qty=stock_info['qty'], available=stock_info['available'], nostock=False, stockInfo=stock_info)
        for cat in _price_part(doc, offer, feed, today):
            changes.append(_change(doc['id'], doc, cat))
        doc['priceLink'] = {
            'feed': feed['id'],
            'sku': price.get('sku') or '',
            'name': price['name'],
            'sheet': price.get('sheet') or '',
            'rows': len(rows),
        }
        sumr['priced'] += 1
        if (
            json.dumps(
                [
                    doc.get('rrc'),
                    doc.get('price'),
                    doc.get('cost'),
                    doc.get('costDisc'),
                    doc.get('priceLink'),
                    doc.get('stock'),
                ],
                sort_keys=True,
                ensure_ascii=False,
            )
            != before
        ):
            doc['updatedAt'] = _now()
            if sink.put(was, doc):
                sumr['updated'] += 1
    for k in ('noPrice', 'missing', 'unclear'):
        sumr[k] = sumr[k][:300]
    return changes, sumr


def discount_plan(store, feed) -> dict:
    """Как сетка скидок разложится по позициям фида (без записи): число, примеры, средняя закупка."""
    rules = list(feed.get('discounts') or [])
    groups = [
        {'label': rule.get('label') or f'Правило {i + 1}', 'pct': rule['pct'], 'count': 0, 'sample': []}
        for i, rule in enumerate(rules)
    ]
    other = {'label': 'Остальное оборудование', 'pct': feed.get('discount'), 'count': 0, 'sample': []}
    unknown, manual, noprice = [], 0, 0
    drive_cats = {
        cat_name for rule in rules if rule.get('drive') in ('belt', 'direct') for cat_name in rule.get('cats') or []
    }
    kw_cats = {
        cat_name for rule in rules if rule.get('kwMin') or rule.get('kwMax') for cat_name in rule.get('cats') or []
    }
    rule_cats = drive_cats | kw_cats
    for doc in _feed_docs(store, feed['id']) + (_maker_cards(store, feed) if feed.get('kind') == 'files' else []):
        i = _disc_pick(feed, doc)[2]
        group = groups[i] if i is not None else other
        group['count'] += 1
        if len(group['sample']) < SAMPLE_MAX:
            group['sample'].append(doc.get('name') or '')
        cat = (doc.get('attrs') or {}).get('cat')
        if group is other and cat in rule_cats:
            why = (
                'привод не определён'
                if cat in drive_cats and not drive_of(doc, feed)
                else ('мощность не указана' if cat in kw_cats and not _kw_of(doc) else '')
            )
            if why:
                unknown.append({'id': doc['id'], 'name': doc.get('name'), 'why': why})
        if doc.get('costSrc', 'feed') != 'feed':
            manual += 1
        if not ((doc.get('rrc') or {}).get('price') or doc.get('cost')):
            noprice += 1
    return {
        'groups': [*groups, other],
        'unknown': unknown[:200],
        'unknownCount': len(unknown),
        'manual': manual,
        'noprice': noprice,
    }


def check_feed(store, feed_cfg, author: str = '', log=print, types=None) -> dict:
    """Ежедневная проверка: РРЦ и наличие связанных позиций каталога; позиции, пропавшие из фида, — «нет в фиде»."""
    j = _job(feed_cfg['id'], 'check')
    try:
        feed = load(store, feed_cfg, max_age=0)
        by_oid = {offer['oid']: offer for offer in feed['offers']}
        revs = store.catalog_revs()  # номера правок до чтения позиций: правку менеджера за время проверки не затираем
        docs = _feed_docs(store, feed_cfg['id'])
        j['total'] = len(docs)
        today = date.today().isoformat()
        price_ch: list = []
        stock_ch: list = []
        gone = []
        upd = 0
        logo_fill, logo_save = _logo_filler(store, IMAGE_STORE, feed)
        for doc in docs:
            card = doc
            offer = by_oid.get(card['feed'].get('oid'))
            before = json.dumps(
                [card.get('rrc'), card.get('stock'), card.get('price'), card.get('cost'), card.get('costDisc')],
                sort_keys=True,
            )
            if logo_fill(card):  # логотип производителя — и у позиций, загруженных раньше
                before += '*'
            if offer:
                if offer.get('sheet'):
                    card['feed']['sheet'] = offer['sheet']
                card['feed']['files'] = feed_cfg.get('kind') == 'files'
                if (
                    types and not feed_cfg.get('built') and FeedRules.fields(feed_cfg)['cat']
                ):  # категория по правилам изменилась (вручную не меняли) — до расчёта скидки
                    attrs = card.get('attrs') or {}
                    auto = (feed_cfg.get('cats') or {}).get(offer['cat']) or item_cat(offer, types) or 'other'
                    prev = card['feed'].get('catAuto')
                    if prev and attrs.get('cat') == prev and auto != prev:
                        attrs['cat'] = auto
                        card['feed']['catAuto'] = auto
                        card['attrs'] = attrs
                        before = before + '*'
                was = json.loads(json.dumps(card))
                changes = FeedRules.changes(_price_part(card, offer, feed_cfg, today), feed_cfg)
                card = (
                    FeedRules.keep(card, was, feed_cfg)
                    if not all(FeedRules.fields(feed_cfg)[k] for k in ('price', 'stock'))
                    else card
                )
                for change in changes:
                    (stock_ch if change[0] == 'stock' else price_ch).append(_change(card['id'], card, change))
            else:
                stock = card.get('stock') or {}
                if not stock.get('gone'):
                    gone.append({'id': card['id'], 'name': card.get('name')})
                if feed_cfg.get('kind') != 'files':  # у фида из файлов наличие неизвестно — не отмечать «нет в фиде»
                    card['stock'] = dict(stock, available=False, gone=True, at=today)
            if (
                json.dumps(
                    [card.get('rrc'), card.get('stock'), card.get('price'), card.get('cost'), card.get('costDisc')],
                    sort_keys=True,
                )
                != before
            ):
                card['updatedAt'] = _now()
                try:
                    store.catalog_put(
                        card['id'],
                        json.dumps(card, ensure_ascii=False),
                        author or ('Фид «{}»'.format(feed_cfg['name'])),
                        revs.get(card['id']),
                    )
                    upd += 1
                except Conflict as exc:
                    log(
                        'Фид «{}»: {} — изменили во время проверки ({}), обновится при следующей'.format(
                            feed_cfg['name'], card.get('name'), exc.author or 'кто-то'
                        )
                    )
            j['done'] += 1
        logo_save()
        cards = None
        if feed_cfg.get('kind') == 'files' and feed.get('prices'):  # карточки производителя, заведённые вручную
            price_res, cards = price_cards(store, feed_cfg, feed['prices'], today, author, feed.get('stock'))
            for change in price_res:
                (stock_ch if change['kind'] == 'stock' else price_ch).append(change)
            upd += cards['updated']
        linked = {card['feed'].get('oid') for card in docs}
        var = set(feed_cfg.get('variants') or [])
        new = (
            [
                offer
                for offer in feed['offers']
                if offer['oid'] not in linked and offer['oid'] not in var and not FeedRules.reason(offer, feed_cfg)
            ]
            if FeedRules.adds(feed_cfg)
            else []
        )
        res = {
            'at': _now(),
            'kind': 'check',
            'by': author,
            'checked': len(docs),
            'updated': upd,
            'price': price_ch[:300],
            'stock': stock_ch[:300],
            'gone': gone[:300],
            'new': len(new),
            'newSample': [offer['name'] for offer in new[:10]],
            'cards': cards,
        }
        _log_add(store, feed_cfg['id'], res)
        _mark(store, feed_cfg['id'], 'check', res)
        n_cost, n_rrc = (
            sum(1 for change in price_ch if change['kind'] == 'cost'),
            sum(1 for change in price_ch if change['kind'] == 'rrc'),
        )
        msg = (
            f'Закупка изменилась: {n_cost}'
            if feed_cfg.get('priceKind') == 'cost' and feed_cfg.get('kind') == 'files'
            else f'РРЦ изменилась: {n_rrc}, закупка: {n_cost}, наличие: {len(stock_ch)}'
        )
        if cards:
            msg += f'; карточки, заведённые вручную: с ценой из прайса {cards["priced"]} из {cards["cards"]}'
        j.update(state='done', result=res, msg=msg)
        return res
    except Exception as exc:
        j.update(state='error', msg=str(exc)[:300])
        _log_add(store, feed_cfg['id'], {'at': _now(), 'kind': 'check', 'by': author, 'error': str(exc)[:300]})
        log('Фид {}: {}'.format(feed_cfg['id'], exc))
        raise


def _mark(store, fid: str, kind, res) -> None:
    items = feeds(store)
    for x in items:
        if x.get('id') == fid:
            x.setdefault('last', {})[kind] = {
                k: res.get(k) for k in ('at', 'added', 'updated', 'same', 'checked', 'new', 'total')
            }
            x['last'][kind]['priceChanges'] = len(res.get('price') or [])
            x['last'][kind]['stockChanges'] = len(res.get('stock') or [])
            x['last'][kind]['gone'] = len(res.get('gone') or [])
    store.kv_set(KV_KEY, {'items': items})


def _placeholders(offers) -> set:
    """Картинка-заглушка «нет фото»: одна и та же у товаров из многих разных разделов фида."""
    cats: dict = {}
    for offer in offers:
        for u in offer['pictures'][:1]:
            cats.setdefault(u, set()).add(offer['cat'])
    return {u for u, cat_offers in cats.items() if len(cat_offers) > STUB_CATS}


def upgrade(store, types, version, log=print) -> None:
    """После обновления программы — один раз перезагрузить фиды с позициями в каталоге."""
    if store.kv_get('feedsUpgrade') == version:
        return
    store.kv_set('feedsUpgrade', version)
    # фид из файлов перестраивает каталог только по кнопке («Сформировать каталог»), после сборки — правки только вручную
    todo = [feed for feed in feeds(store) if _feed_docs(store, feed['id']) and feed.get('kind') != 'files']

    def _run() -> None:
        for feed_cfg in todo:
            log('Фид «{}»: перезагрузка после обновления {}'.format(feed_cfg['name'], version))
            _safe(import_feed, store, feed_cfg, types, IMAGE_STORE, f'Обновление {version}')

    if todo:
        run_bg(_run)


def run_bg(func, *args, **k) -> threading.Thread:
    thread = threading.Thread(target=lambda: _safe(func, *args, **k), daemon=True, name='feed')
    thread.start()
    return thread


def _safe(func, *args, **k) -> None:
    try:
        func(*args, **k)
    except Exception:  # noqa: S110 — import_feed и check_feed уже записали ошибку в задачу, журнал фида и журнал сервера
        pass


def auto_check(store, log=print) -> None:
    """Раз в день (после 6 утра — cat.feedHour в «Значениях программы»): РРЦ и наличие по всем фидам с автопроверкой."""
    if datetime.now().hour < SrvVal.get(store, 'cat.feedHour'):
        return
    today = date.today().isoformat()
    for feed in feeds(store):
        if not feed.get('auto') or feed.get('kind') == 'files' or busy(feed['id']):
            continue
        if ((feed.get('last') or {}).get('check') or {}).get('at', '')[:10] == today:
            continue
        if not _feed_docs(store, feed['id']):
            continue
        _safe(check_feed, store, feed, 'автопроверка', log)


def _feed_counts(store) -> dict | None:
    """{код фида: число связанных позиций} одним запросом (без разбора карточек в Python)."""
    try:
        return {
            fid: count
            for fid, count in store.all('SELECT feed_id, COUNT(*) FROM catalog WHERE feed_id IS NOT NULL GROUP BY 1')
            if fid
        }
    except Exception:  # SQLite без JSON — по-старому
        return None


def status(store) -> list[dict]:
    out, counts = [], _feed_counts(store)
    for feed in feeds(store):
        j = JOBS.get(feed['id'])
        count = counts.get(feed['id'], 0) if counts is not None else len(_feed_docs(store, feed['id']))
        out.append(
            dict(feed, job=j, linked=count, excluded=len(feed.get('excluded') or []))
        )  # список id удалённых — только число
    return out
