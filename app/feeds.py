# -*- coding: utf-8 -*-
"""Товарные фиды поставщиков (формат YML — «Яндекс.Маркет», его выгружают Bitrix, InSales, 1С и др.)
и фиды из файлов (парс сайта CSV + прайс XLSX — feed_files.py) для поставщиков без YML.

Фид — как API поставщика: по кнопке позиции фида становятся позициями каталога (название, характеристики,
описание, фото, производитель, модель, категория программы), а раз в день программа сверяет РРЦ и наличие.

  • Настройки фидов — kv «feeds»: [{id, name, url, maker, discount, auto, cats:{категория фида: тип программы | "skip"},
    kind: "yml" | "files"; у файлового — files:{pages:{name, size, at, rows}, price:{…}}, priceKind: "rrc" | "cost" (цена прайса —
    РРЦ или наша закупка), cur (валюта прайса), priceOnly (добавлять и позиции, которых нет в парсе)}].
  • Позиция каталога из фида: doc.feed = {id, oid, url, sku, barcode, orig:{…}} — связь с предложением фида;
    doc.rrc = {price (коп.), cur, at, prev, prevAt} — рекомендованная розничная цена;
    doc.stock = {qty, available, at, gone} — наличие у поставщика (qty — если фид даёт остаток).
    Цена КП позиции (doc.price) берётся из РРЦ, пока её не изменили вручную (doc.priceSrc = "rrc");
    закупка (doc.cost) — РРЦ минус скидка поставщика, если скидка задана (doc.costSrc = "feed").
  • Сетка скидок поставщика — f.discounts: [{label, cats:[типы], drive: any|belt|direct, kwMin, kwMax, pct}], первое подходящее
    правило; не подошло ни одно — f.discount («всё остальное»). Привод — по строке «Привод», признаку частотника и подсказкам
    f.driveHints {belt, direct} (серии в названии / листе прайса: «TIDY, DVK» — ременной, «DVK D, IMPETUS» — прямой).
    Какая скидка применена — doc.costDisc {pct, label}.
  • Повторная загрузка не затирает ручные правки: название, описание и таблица характеристик обновляются,
    только если их не меняли после прошлой загрузки (сравнение с doc.feed.orig).
  • Журнал — kv «feedlog:<id>»: последние 30 загрузок и проверок (что добавлено, изменения РРЦ и наличия).
"""
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
import xml.etree.ElementTree as ET
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import catalog_migrate
import feed_files
import images
import imgfetch
from maker_logos import MakerLogos
from storage import Conflict
from config import DATA_DIR
from defaults import SrvVal

KV = 'feeds'
IMAGE_STORE = None      # хранилище изображений data/img (images.ImageStore) — задаёт kp_server при запуске
JOBS = {}               # id фида → {kind, state, done, total, msg, startedAt, result}
_CACHE = {}             # id фида → (время, url, разобранный фид) — предпросмотр и загрузка без повторного скачивания
_LOCK = threading.Lock()
STOCK_TAGS = ('count', 'quantity', 'stock_quantity', 'stock', 'amount', 'qty', 'instock', 'in_stock')
STOCK_PARAM = re.compile(r'^(остаток|остатки|наличие|в наличии|количество( на складе)?|склад)$', re.I)
WH_PARAM = re.compile(r'^(?:склад|остаток на складе|остаток)\s+(?:в\s+)?(\S.*)$', re.I)   # «Склад Новосибирск» = 2 — остаток склада
BRAND_PARAM = re.compile(r'^(бренд|марка|производитель|торговая марка)$', re.I)
JUNK_PARAM = re.compile(r'^(array|object|null|undefined)$', re.I)     # «Картинки галереи: Array» — служебные поля сайта
JUNK_PNAME = re.compile(r'\(для авито\)|^(цена|стоимость)\b|^(картинки галереи|полезные документы|видео)$', re.I)  # поля для площадок, цена



class FeedSupplier:
    @staticmethod
    def id(v):
        """Поставщик из справочника, к которому привязан фид (id); пусто — поставщик = название фида."""
        v = str(v or '').strip()
        return v if re.match(r'^[A-Za-z0-9_-]{1,64}$', v) else ''

def _now():
    return datetime.now().isoformat(timespec='seconds')


def parse_number(v):
    """Число из фида; «nan», «inf» и прочее не число — None (иначе в карточку попало бы Infinity, а NaN ронял проверку фида)."""
    try:
        n = float(re.sub(r'[\s\xa0]', '', str(v)).replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def _txt(el, tag):
    x = el.find(tag)
    return re.sub(r'\s+', ' ', x.text).strip() if x is not None and x.text else ''


def _html_text(s):
    """Описание из фида (часто HTML) → обычный текст с абзацами."""
    s = re.sub(r'(?i)<\s*(br|/p|/div|/li|/h\d)\s*/?>', '\n', str(s or ''))
    s = re.sub(r'(?i)<li[^>]*>', '• ', s)
    s = re.sub(r'<[^>]+>', '', s)
    for a, b in (('&nbsp;', ' '), ('&laquo;', '«'), ('&raquo;', '»'), ('&mdash;', '—'), ('&ndash;', '–'), ('&quot;', '"'),
                 ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'), ('&#039;', "'")):
        s = s.replace(a, b)
    s = re.sub(r'\s*(?:\b(?:в|во|на|по)\s+)?#[A-Z0-9_]+#', '', s)   # шаблоны сайта: «в #REGION_NAME_DECLINE_PP#»
    lines = [re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in s.split('\n')]
    return '\n'.join(x for x in lines if x)[:6000]


# ---------------------------------------------------------------- настройки
def feeds(store):
    return (store.kv_get(KV) or {}).get('items') or []


def feed_get(store, fid):
    return next((f for f in feeds(store) if f.get('id') == fid), None)


def _cats_ok(c):
    return {str(k)[:40]: v[:40] for k, v in c.items() if isinstance(v, str) and v}


def feed_save(store, f):
    kind = 'files' if f.get('kind') == 'files' else 'yml'
    url = str(f.get('url') or '').strip()
    if kind == 'yml' and not re.match(r'^https?://', url, re.I):
        raise ValueError('Укажите адрес фида (http или https)')
    if kind == 'files' and not str(f.get('name') or '').strip():
        raise ValueError('Укажите название фида — например, имя поставщика')
    items = feeds(store)
    fid = f.get('id') or images.slug(f.get('name') or urllib.parse.urlsplit(url).hostname or 'feed', 30) or 'feed'
    old = next((x for x in items if x.get('id') == fid), None) or {}
    if not f.get('id') and any(x.get('id') == fid for x in items):
        fid = '%s-%d' % (fid, len(items) + 1)
    disc = parse_number(f.get('discount'))
    rec = dict(old, id=fid, kind=kind, name=str(f.get('name') or old.get('name') or fid).strip()[:80], url=url,
               maker=str(f.get('maker') or '').strip()[:120], discount=disc if disc and 0 < disc < 100 else None,
               auto=f.get('auto', kind == 'yml') is True, pageDesc=f.get('pageDesc', old.get('pageDesc', kind == 'yml')) is True,
               cats=_cats_ok(f.get('cats')) if isinstance(f.get('cats'), dict) else old.get('cats') or {},
               supplier=FeedSupplier.id(f['supplier'] if 'supplier' in f else old.get('supplier')), updatedAt=_now())
    rec['discounts'] = discount_rules(f['discounts']) if isinstance(f.get('discounts'), list) else old.get('discounts') or []
    rec['filter'] = FeedRules.clean_filter(f['filter']) if isinstance(f.get('filter'), dict) else old.get('filter') or FeedRules.clean_filter({})
    rec['fields'] = FeedRules.clean_fields(f['fields']) if isinstance(f.get('fields'), dict) else old.get('fields') or FeedRules.clean_fields({})
    hints = f.get('driveHints') if isinstance(f.get('driveHints'), dict) else old.get('driveHints') or {}
    rec['driveHints'] = {k: re.sub(r'\s+', ' ', str(hints.get(k) or '')).strip()[:400] for k in ('belt', 'direct')}
    if kind == 'files':
        cur = str(f.get('cur') or old.get('cur') or '').upper()[:3]
        rec.update(priceKind='rrc' if f.get('priceKind', old.get('priceKind')) == 'rrc' else 'cost', cur=cur if re.match(r'^[A-Z]{3}$', cur) else '',
                   priceOnly=f.get('priceOnly', old.get('priceOnly')) is True, files=old.get('files') or {})
    items = [x for x in items if x.get('id') != fid] + [rec]
    store.kv_set(KV, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return rec


def price_files(f):
    """Прайсы фида из файлов: [мета + slot]; прежний единственный прайс — слот «price»."""
    fl = f.get('files') or {}
    out = [dict(m) for m in fl.get('prices') or []]
    if fl.get('price') and not any(m.get('slot') == 'price' for m in out):
        out.insert(0, dict(fl['price'], slot='price'))
    return out


def feed_file_put(store, fid, kind, data, name, slot=None):
    """Файл фида (парс сайта / прайс / остатки): сохранить на диск, запомнить мету в настройках фида; → мета.
    Прайс: slot — какой заменить; иначе заменяется прайс с тем же поставщиком в имени файла (price_slot), без slot —
    и прежний единственный прайс фида (слот «price»); «new» и не нашлось — прайс добавляется."""
    f = feed_get(store, fid)
    if not f:
        raise ValueError('Фид не найден')
    if (kind == 'extra') == (f.get('kind') == 'files'):
        raise ValueError('Фид из файлов принимает парс, прайсы и остатки; фид YML — только файл описаний (JSON)')
    old = None
    if kind == 'price':
        have = price_files(f)
        if slot and slot != 'new':
            old = next((m for m in have if m['slot'] == slot), None)
            if not old:
                raise ValueError('Прайс для замены не найден — обновите страницу')
        else:
            key = feed_files.price_slot(name)      # тот же поставщик в имени файла (дата не важна) — замена
            old = next((m for m in have if m['slot'] == key or feed_files.price_slot(m.get('name')) == key), None)
            if old is None and slot != 'new' and len(have) == 1 and have[0]['slot'] == 'price':
                old = have[0]                   # прежний единственный прайс фида — заменяется
            if old is None:
                slot, n = key, 2
                while any(m['slot'] == slot for m in have):
                    slot, n = '%s-%d' % (key, n), n + 1
        slot = old['slot'] if old else slot
    meta = feed_files.save_file(DATA_DIR, fid, kind, data, name, slot if kind == 'price' else None)
    items = feeds(store)
    for x in items:
        if x.get('id') != fid:
            continue
        fl = x.setdefault('files', {})
        if kind == 'price':
            if old:             # валюта, выбранная для прайса вручную, сохраняется при замене файла
                meta.update({k: old[k] for k in ('curSet', 'curSheets') if old.get(k)})
            lst = [m for m in price_files(x) if m['slot'] != slot] + [meta]
            fl['prices'] = lst
            fl.pop('price', None)
        else:
            fl[kind] = meta
        x['updatedAt'] = _now()
    store.kv_set(KV, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return meta


def feed_file_set(store, fid, kind, slot, act, cur='', sheet=''):
    """Файл фида: act = drop — убрать (прайс или остатки); cur — валюта прайса для листов без валюты
    (sheet — только для этого листа)."""
    items = feeds(store)
    x = next((i for i in items if i.get('id') == fid), None)
    if not x or (x.get('kind') != 'files' and kind != 'extra'):
        raise ValueError('Фид из файлов не найден')
    fl = x.setdefault('files', {})
    cur = str(cur or '').upper()[:3]
    if cur and not re.match(r'^[A-Z]{3}$', cur):
        raise ValueError('Валюта — трёхбуквенный код (EUR, USD, RUB, CNY)')
    if kind in ('stock', 'extra') and act == 'drop':
        feed_files.drop_file(DATA_DIR, fid, kind)
        fl.pop(kind, None)
    elif kind == 'price':
        lst = price_files(x)
        m = next((i for i in lst if i['slot'] == slot), None)
        if not m:
            raise ValueError('Прайс не найден')
        if act == 'drop':
            feed_files.drop_file(DATA_DIR, fid, 'price', slot)
            lst = [i for i in lst if i['slot'] != slot]
        elif act == 'cur':
            if sheet:
                cs = dict(m.get('curSheets') or {})
                if cur:
                    cs[sheet[:80]] = cur
                else:
                    cs.pop(sheet[:80], None)
                m['curSheets'] = cs
            else:
                m['curSet'] = cur
        fl['prices'] = lst
        fl.pop('price', None)
    else:
        raise ValueError('Неизвестное действие')
    x['updatedAt'] = _now()
    store.kv_set(KV, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return x


def load_prices(f):
    """Строки всех прайсов фида; валюта строки: выбранная вручную для листа → найденная в прайсе → выбранная для файла
    → валюта фида. «Распродажа» — в конце (цена распродажи — только если обычной строки нет)."""
    out = []
    for m in price_files(f):
        data = feed_files.read_file(DATA_DIR, f['id'], 'price', m['slot'])
        if not data:
            continue
        rows = feed_files.parse_price(data)[0]
        cs = m.get('curSheets') or {}
        for r in rows:
            r['cur'] = cs.get(r['sheet']) or r.get('cur') or m.get('curSet') or (f.get('cur') or '').upper()
            r['file'] = m.get('name') or m['slot']
        out += rows
    return [r for r in out if not r.get('sale')] + [r for r in out if r.get('sale')]


def feed_delete(store, fid):
    store.kv_set(KV, {'items': [x for x in feeds(store) if x.get('id') != fid]})
    feed_files.remove_files(DATA_DIR, fid)
    with _LOCK:
        _CACHE.pop(fid, None)


def log_of(store, fid):
    return store.kv_get('feedlog:' + fid) or []


def _log_add(store, fid, rec):
    lg = [rec] + log_of(store, fid)
    store.kv_set('feedlog:' + fid, lg[:SrvVal.get(store, 'cat.feedLog')])


# ---------------------------------------------------------------- загрузка и разбор YML
def fetch(url):
    url = imgfetch.web_url(url)
    imgfetch._check_url(url)        # только http(s) и не адреса локальной сети
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh feed)', 'Accept': 'application/xml,text/xml,*/*'})
    with imgfetch.SafeWeb.opener().open(req, timeout=120) as r:
        mb = SrvVal.now('cat.feedMaxMB')
        data = r.read(mb * 1024 * 1024 + 1)
    if len(data) > mb * 1024 * 1024:
        raise ValueError('Фид больше %d МБ (предел — «Настройки → Значения программы»)' % mb)
    return data


PAGE_MAX = 3 * 1024 * 1024
PAGE_V = 5                              # версия разбора страницы: при смене кэш перечитывается
# описание со страницы товара запоминается на 30 дней — cat.pageDays («Значения программы»)
_PAGE_SEM = threading.Semaphore(3)      # не больше 3 страниц сайта одновременно


_PAGE_JAR = http.cookiejar.CookieJar()   # cookie сайта (сессия, проверка «не робот») — общие для всех страниц


def _inflate(data, wbits, limit=PAGE_MAX * 8):
    """Распаковка ответа сайта с пределом: «сжатая бомба» (маленький архив → гигабайты) не займёт всю память."""
    d = zlib.decompressobj(wbits)
    out = d.decompress(data, limit)
    if d.unconsumed_tail:
        raise ValueError('страница после распаковки больше %d МБ' % (limit // 1048576))
    return out


def page_html(url, strict=True):
    """Страница товара на сайте поставщика (та же защита, что у фида и фото). Запрос — как из браузера
    (Bitrix-сайты на «робота» отвечают 403 или пустой страницей-проверкой), cookie сохраняются, повтор при отказе."""
    url = imgfetch.web_url(url)
    imgfetch._check_url(url)
    u = urllib.parse.urlsplit(url)
    hd = {'User-Agent': imgfetch.BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5', 'Accept-Encoding': 'gzip, deflate', 'Referer': '%s://%s/' % (u.scheme, u.netloc)}
    opener = imgfetch.SafeWeb.opener(urllib.request.HTTPCookieProcessor(_PAGE_JAR))

    def get():
        with opener.open(urllib.request.Request(url, headers=hd), timeout=25) as r:
            return r.headers.get('Content-Type') or '', (r.headers.get('Content-Encoding') or '').lower(), r.read(PAGE_MAX)
    with _PAGE_SEM:
        ctype, enc, data = imgfetch.retry(get)
    if enc == 'gzip' or data[:2] == b'\x1f\x8b':
        data = _inflate(data, 16 + zlib.MAX_WBITS)
    elif enc == 'deflate':
        try:
            data = _inflate(data, zlib.MAX_WBITS)
        except zlib.error:
            data = _inflate(data, -zlib.MAX_WBITS)
    m = re.search(r'charset=([\w-]+)', ctype, re.I) or re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', data[:4096], re.I)
    cs = m.group(1) if m else 'utf-8'
    cs = cs.decode('ascii', 'ignore') if isinstance(cs, bytes) else cs
    try:
        html = data.decode(cs)
    except (LookupError, UnicodeDecodeError):
        try:
            html = data.decode('utf-8')
        except UnicodeDecodeError:
            html = data.decode('cp1251', errors='replace')
    if strict and not is_product_page(html):
        raise ValueError('сайт отдал не страницу товара (проверка «не робот» или ошибка сайта)')
    return html


def is_product_page(html):
    """Страница товара, а не заглушка защиты от роботов: есть заголовок <h1> и признаки карточки товара."""
    return bool(re.search(r'<h1\b', html, re.I) and re.search(
        r'itemprop\s*=\s*["\'](?:name|image|description|offers)["\']|data-fancybox|/upload/(?:iblock|medialibrary)/|detail-text', html, re.I))


def _inner_html(html, m):
    """Содержимое элемента, открывающий тег которого найден m (group(1) — имя тега): с учётом вложенных таких же тегов."""
    tag, depth, pos = m.group(1).lower(), 1, m.end()
    for t in re.finditer(r'<(/?)%s\b[^>]*>' % re.escape(tag), html[pos:], re.I):
        depth += -1 if t.group(1) else (0 if t.group(0).endswith('/>') else 1)
        if depth == 0:
            return html[pos:pos + t.start()]
    return html[pos:pos + 20000]


def page_desc(html):
    """Описание товара со страницы: элемент itemprop="description" (Битрикс: div.detail-text-wrap)."""
    html = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1\s*>', '', html or '')
    for rx in (r'<(\w+)\b[^>]*\bitemprop\s*=\s*["\']description["\'][^>]*>',
               r'<(\w+)\b[^>]*\bclass\s*=\s*["\'][^"\']*\bdetail-text-wrap\b[^"\']*["\'][^>]*>'):
        for m in re.finditer(rx, html, re.I):
            if m.group(1).lower() in ('meta', 'link'):
                continue
            text = _no_sales(_html_text(_inner_html(html, m)))
            if len(text) >= 40:
                return text
    return ''


SALES_RX = (r'(?i)tel:|\b8[\s-]?800\b|\+7[\s(]|\b8[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b|оставьте заявку|'
            r'обратн\S* связ|свяжутся с\s*вами|наши (специалисты|менеджеры)|чтобы купить|купить .{0,60}\bв\s+(тд|торгов)|'
            r'@|https?://|www\.|\.(ru|org|com|by)\b|наша компания предлагает|получите подробную информацию|у нашего консультанта|'
            r'помогут подобрать|наши квалифицированные|наших квалифицированных|'
            r'представляет собой неприхотлив|характерна величина рабочего давления')       # шаблонный текст сайта вместо описания


def _no_sales(text):
    """Абзацы-призывы сайта поставщика («Чтобы купить … в ТД …, оставьте заявку по телефону …») в КП не нужны."""
    return '\n'.join(x for x in text.split('\n') if not re.search(SALES_RX, x))


APPLY_RX = (r'применяемост|применимост|подходит (?:для|к)|совместим|для моделей|применяется (?:в|для|на)|'
            r'^модел\S*\s+(?:компрессор|оборудован|осушител|техник)')


def page_images(html, url, limit=8):
    """Фото товара — только из галереи карточки (шаблон Аспро/Битрикс, как у Remeza): блок
    div.product-detail-gallery__slider--big, в нём ссылки a.product-detail-gallery__link (data-fancybox="gallery")
    на оригиналы. Миниатюры (thmb), описание, og:image, баннеры и «похожие товары» не берутся. Нет галереи — нет фото."""
    out = []
    m = re.search(r'<(div)\b[^>]*\bclass\s*=\s*["\'][^"\']*product-detail-gallery__slider--big[^"\']*["\'][^>]*>', html, re.I)
    if m:
        block = _inner_html(html, m)
        links = re.findall(r'<a\b[^>]*\bclass\s*=\s*["\'][^"\']*product-detail-gallery__link[^>]*>', block, re.I) or \
            re.findall(r'<a\b[^>]*\bdata-fancybox\s*=\s*["\']gallery["\'][^>]*>', block, re.I)
    else:   # другой шаблон: только ссылки галереи увеличения
        links = re.findall(r'<a\b[^>]*\bdata-fancybox\s*=\s*["\']gallery["\'][^>]*>', html, re.I)
    for tag in links:
        h = re.search(r'\bhref\s*=\s*["\']([^"\']+)', tag, re.I)
        if not h or not re.search(r'\.(?:jpe?g|png|webp)(?:\?|$)', h.group(1), re.I):
            continue
        u = urllib.parse.urljoin(url, html_mod.unescape(h.group(1)).strip())
        if '/resize_cache/' not in u and re.match(r'^https?://', u) and u not in out:
            out.append(u)
    return out[:limit]


# фото товара на любом сайте: что точно не фото оборудования
IMG_SKIP = (r'(?i)logo|icon|sprite|favicon|banner|placeholder|no[-_]?(?:photo|image|img)|noimage|blank|loader|spinner|captcha|'
            r'counter|pixel|social|telegram|whatsapp|vk[-_.]|youtube|payment|/flags?/|rating|stars?[-_.]|arrow|button|avatar|cert|'
            r'sertif|diplom|/menu/|header|footer|watermark|preview_?[0-9]{2}x')
IMG_ATTRS = ('data-zoom-image', 'data-large', 'data-large_image', 'data-full', 'data-original', 'data-big', 'data-src', 'data-lazy-src', 'src')
GAL_RX = (r'<(\w+)\b[^>]*\bclass\s*=\s*["\'][^"\']*(?:gallery|slider|swiper|carousel|fotorama|zoom|lightbox|product[-_]?(?:image|img|photo|pic|media|gallery)|'
          r'detail[-_]?(?:image|img|photo|pic)|item[-_]?(?:image|photo)|main[-_]?(?:image|photo))[^"\']*["\'][^>]*>')


def page_images_any(html, url, limit=12):
    """Фото товара с любого сайта — для выбора главного и дополнительных (кнопкой «Загрузить» в автозаполнении и
    «Фото с сайта поставщика»). По порядку: галерея карточки (как у фидов), JSON-LD, og:image, itemprop=image, ссылки
    увеличения (fancybox, lightbox), картинки в блоках галереи/слайдера. Логотипы, иконки, баннеры, svg/gif — нет."""
    out, seen = [], set()

    def add(u, strict=True):
        u = html_mod.unescape(str(u or '')).strip().split(' ')[0]
        if not u or u.startswith('data:'):
            return
        u = urllib.parse.urljoin(url, u)
        key = u.split('?')[0].lower()
        if not re.match(r'^https?://', u) or key in seen or re.search(IMG_SKIP, key) or re.search(r'\.(svg|gif|ico)$', key):
            return
        if strict and not re.search(r'\.(jpe?g|png|webp)$', key):
            return
        seen.add(key)
        out.append(u)
    for u in page_images(html, url, limit):
        add(u)
    for x in LdJson.products(html, LdJson.ANY_RX):
        im = x.get('image')
        for v in (im if isinstance(im, list) else [im]):
            add(v.get('url') or v.get('contentUrl') if isinstance(v, dict) else v, strict=False)
    for rx in (r'<meta\b[^>]*\bproperty\s*=\s*["\']og:image(?::url)?["\'][^>]*\bcontent\s*=\s*["\']([^"\']+)',
               r'<meta\b[^>]*\bcontent\s*=\s*["\']([^"\']+)["\'][^>]*\bproperty\s*=\s*["\']og:image["\']',
               r'<(?:img|link|meta)\b[^>]*\bitemprop\s*=\s*["\']image["\'][^>]*\b(?:src|href|content)\s*=\s*["\']([^"\']+)'):
        for m in re.finditer(rx, html, re.I):
            add(m.group(1), strict=False)
    for m in re.finditer(r'<a\b[^>]*(?:data-fancybox|data-lightbox|data-zoom|rel\s*=\s*["\'](?:lightbox|gallery)|class\s*=\s*["\'][^"\']*(?:fancybox|lightbox|zoom|gallery))[^>]*>', html, re.I):
        h = re.search(r'\bhref\s*=\s*["\']([^"\']+)', m.group(0), re.I)
        if h:
            add(h.group(1))
    for m in re.finditer(GAL_RX, html, re.I):
        if len(out) >= limit:
            break
        for tag in re.findall(r'<img\b[^>]*>', _inner_html(html, m)[:60000], re.I):
            for a in IMG_ATTRS:
                v = re.search(r'\b%s\s*=\s*["\']([^"\']+)' % a, tag, re.I)
                if v:
                    add(v.group(1))
                    break
    return out[:limit]


def _unesc(v):
    return re.sub(r'\s+', ' ', html_mod.unescape(html_mod.unescape(v or ''))).strip()


def _schema_props(html):
    """Свойства schema.org (itemprop="additionalProperty"): <meta itemprop="name|value" content> или текст элементов."""
    out = []
    for m in re.finditer(r'<(\w+)\b[^>]*\bitemprop\s*=\s*["\']additionalProperty["\'][^>]*>', html, re.I):
        block = _inner_html(html, m)[:4000]
        kv = {}
        for nm in ('name', 'value'):
            x = re.search(r'<meta\b[^>]*\bitemprop\s*=\s*["\']%s["\'][^>]*\bcontent\s*=\s*"([^"]*)"' % nm, block, re.I) or \
                re.search(r'<(\w+)\b[^>]*\bitemprop\s*=\s*["\']%s["\'][^>]*>(.*?)</\1>' % nm, block, re.I | re.S)
            if x:
                kv[nm] = _unesc(re.sub(r'<[^>]+>', ' ', x.group(x.lastindex)))
        k, v = (kv.get('name') or '').strip(' :'), kv.get('value') or ''
        if k and v:
            out.append([k, v])
    return out


def page_crumbs(html):
    """Раздел товара на сайте по «хлебным крошкам» (schema.org BreadcrumbList): звенья-ссылки без «Главная» и «Каталог»
    (последнее звено — сам товар — ссылкой не бывает)."""
    m = re.search(r'<(\w+)\b[^>]*\bitemtype\s*=\s*["\'][^"\']*BreadcrumbList["\'][^>]*>', html, re.I)
    if not m:
        return ''
    names = []
    for it in re.split(r'(?=<\w+\b[^>]*\bitemprop\s*=\s*["\']itemListElement["\'])', _inner_html(html, m))[1:]:
        x = re.search(r'<a\b[^>]*\bhref[^>]*>.*?\bitemprop\s*=\s*["\']name["\'][^>]*>(.*?)</', it, re.I | re.S)
        name = _unesc(re.sub(r'<[^>]+>', '', x.group(1))) if x else ''
        if name and not re.match(r'(?i)^(главная|каталог|home)$', name):
            names.append(name)
    return ' / '.join(names)[:300]


PROP_PATS = (r'<tr\b[^>]*>\s*<t[dh]\b[^>]*>(.*?)</t[dh]>\s*<td\b[^>]*>(.*?)</td>',
             r'<dt\b[^>]*>(.*?)</dt>\s*<dd\b[^>]*>(.*?)</dd>',
             r'class\s*=\s*["\'][^"\']*(?:prop|char|param|spec|attr|feature)[^"\']*(?:name|title|label|key)[^"\']*["\'][^>]*>(.*?)</\w+>.{0,400}?'
             r'class\s*=\s*["\'][^"\']*(?:prop|char|param|spec|attr|feature)[^"\']*(?:value|val)[^"\']*["\'][^>]*>(.*?)</\w+>')
# список характеристик без таблицы: <li><span>Мощность</span><span>22 кВт</span></li>
PROP_LI = r'<li\b[^>]*>\s*<(span|div|b|strong)\b[^>]*>(.*?)</\1>\s*(?:<[^>]*>\s*)*?<(span|div)\b[^>]*>(.*?)</\3>\s*</li>'


class PropList:
    """Списки «название — значение» (<li><span>…</span><span>…</span></li>): правило проверяется внутри одного пункта
    списка — иначе (.*?) на странице в 1 МБ перебирал до конца страницы (до минуты на страницу) и склеивал соседние
    пункты меню сайта в мнимые характеристики."""
    ITEM = re.compile(r'<li\b[^>]*>.*?</li>', re.I | re.S)
    PAIR = re.compile(PROP_LI, re.I | re.S)

    @classmethod
    def pairs(cls, html):
        return [(m.group(2), m.group(4)) for c in cls.ITEM.finditer(html) for m in [cls.PAIR.fullmatch(c.group(0))] if m]


def _table_props(html, pats=PROP_PATS, li=False, limit=60):
    """Пары из таблиц, dt/dd, блоков свойств (Битрикс и др.); li=True — ещё и списки «название — значение»."""
    html = re.sub(r'(?is)<div\b[^>]*\bbasket_props_block\b.*?</table>', '', html)     # скрытый выбор свойств корзины
    out, seen = [], set()
    found = [(m.group(1), m.group(2)) for rx in pats for m in re.finditer(rx, html, re.I | re.S)]
    if li:
        found += PropList.pairs(html)
    for a, b in found:
        k = re.sub(r'\s+', ' ', _html_text(a)).strip(' :')
        v = re.sub(r'\s*\n\s*', '; ', _html_text(b)).strip(' ;')
        if 1 < len(k) <= 80 and 0 < len(v) <= 300 and k.lower() not in seen and not re.search(SALES_RX, k + ' ' + v):
            seen.add(k.lower())
            out.append([k, v])
    return out[:limit]


def page_props(html):
    """Пары «название — значение» со страницы: свойства schema.org, иначе таблицы, dt/dd и блоки свойств Битрикса."""
    out = _schema_props(html)
    if out:
        return out[:60]
    return _table_props(html)


class LdJson:
    """Товары schema.org Product из блоков JSON-LD страницы (<script type="application/ld+json">) — в том числе вложенные
    в @graph и списки. ANY_RX — блок с «application/ld+json» в любом атрибуте (для фото), TYPE_RX — в атрибуте type."""
    ANY_RX = re.compile(r'(?is)<script\b[^>]*application/ld\+json[^>]*>(.*?)</script>')
    TYPE_RX = re.compile(r'(?is)<script\b[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>')

    @staticmethod
    def products(html, rx):
        for m in rx.finditer(html):
            try:
                data = json.loads(m.group(1).strip())
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
                tp = x.get('@type')
                if tp == 'Product' or (isinstance(tp, list) and 'Product' in tp):
                    yield x


def _ld_product(html):
    """Товар из JSON-LD (schema.org Product): описание и additionalProperty — многие сайты кладут их только туда."""
    desc, props = '', []
    for x in LdJson.products(html, LdJson.TYPE_RX):
        d = _html_text(_unesc(str(x.get('description') or '')))
        if len(d) > len(desc):
            desc = d
        for p in x.get('additionalProperty') or []:
            if isinstance(p, dict) and p.get('name') and p.get('value') not in (None, ''):
                props.append([str(p['name']).strip(' :')[:80], (str(p['value']) + (' ' + str(p['unitText']) if p.get('unitText') else ''))[:300]])
    return desc, props


# вкладки карточки товара («Описание», «Характеристики», «Комплектация»…): в разметке есть все, видна одна
TAB_RX = (r'<(div|section|article)\b[^>]*(?:\brole\s*=\s*["\']tabpanel["\']|\bclass\s*=\s*["\'][^"\']*(?:\btab-pane\b|\btabs?[_-]{1,2}(?:content|pane|panel|body|item-content|block)\b|'
          r'\btab-content__item\b|\btabcontent\b|\btab_content\b|\bdetail-tab|\bproduct-tab|\bjs-tab)[^"\']*["\']|\bdata-tab-content\b)[^>]*>')


def _tab_texts(html):
    """Текст каждой вкладки (без вложенных повторов): таблицы — строками «параметр значение»."""
    out, seen = [], set()
    for m in re.finditer(TAB_RX, html, re.I):
        inner = _inner_html(html, m)
        inner = re.sub(r'(?i)</t[dh]\s*>', ' ', re.sub(r'(?i)</tr\s*>|<table\b[^>]*>', '\n<br>', inner))
        text = _no_sales(re.sub(r'[ \t]{2,}', ' ', _html_text(inner)))
        lines = [x for x in text.split('\n') if len(x) > 2 and x not in seen]
        if sum(len(x) for x in lines) >= 40:
            seen.update(lines)
            out.append('\n'.join(lines))
    return out


def page_apply(html, props):
    """Применимость запчасти: свойство «Применяемость / Подходит для …» или блок под таким заголовком."""
    for k, v in props:
        if re.search(APPLY_RX, k, re.I):
            return v[:600]
    best = ''
    for m in re.finditer(r'>\s*([^<>]{0,30}(?:%s)[^<>]{0,40})\s*(?=<)' % APPLY_RX, html, re.I):
        chunk = html[m.end():m.end() + 8000]
        cut = re.search(r'(?i)<h[1-6]\b|class\s*=\s*["\'][^"\']*\btab', chunk)
        text = _html_text(chunk[:cut.start()] if cut and cut.start() > 0 else chunk[:3000])
        text = re.sub(r'\s*\n\s*', '; ', text.replace('• ', '')).strip(' ;:')
        if len(text) >= 3 and not re.match(r'(?i)^(описание|характеристики|документ|отзыв)', text):
            best = text[:600]       # последнее подходящее — содержимое вкладки, первое бывает её заголовком
    return best


# проверенные картинки со страницы (адрес → время, тип, байты): скачиваются один раз — при выборе и при сохранении
_PROBE, _PROBE_LOCK, PROBE_TTL = {}, threading.Lock(), 900


def _probe_get(url):
    with _PROBE_LOCK:
        x = _PROBE.get(url)
    if x and datetime.now().timestamp() - x[0] < PROBE_TTL:
        return x[1], x[2]
    return None


def probe_images(urls, opts):
    """Оставить фото оборудования: файл не меньше minKB, стороны не меньше minPx, не однотонная «пустая» картинка
    (skipBlank: очень мало байт на пиксель — белый или однотонный фон). → (подходящие, сколько отброшено)."""
    min_b, min_px, blank = (opts.get('minKB') or 0) * 1024, opts.get('minPx') or 0, opts.get('skipBlank')

    def one(u):
        hit = _probe_get(u)
        if hit is None:
            sp = urllib.parse.urlsplit(u)
            try:
                hit = imgfetch.fetch_image(u, referer='%s://%s/' % (sp.scheme, sp.netloc), tries=1)
            except Exception:
                return False
            with _PROBE_LOCK:
                if len(_PROBE) > 80:
                    for k in sorted(_PROBE, key=lambda k: _PROBE[k][0])[:40]:
                        _PROBE.pop(k, None)
                _PROBE[u] = (datetime.now().timestamp(), hit[0], hit[1])
        data = hit[1]
        w, h = _img_size(data)
        if len(data) < min_b:
            return False
        if w and h and min(w, h) < min_px:
            return False
        if blank and w and h and w * h >= 40000 and len(data) / (w * h) < 0.012:
            return False
        return True
    with ThreadPoolExecutor(max_workers=6) as ex:
        ok = list(ex.map(one, urls))
    good = [u for u, k in zip(urls, ok) if k]
    return good, len(urls) - len(good)


def page_text(url, opts=None):
    """Для автозаполнения карточки: название, описание и характеристики со страницы любого сайта (не только поставщиков
    из фидов). Описание — itemprop/JSON-LD и текст всех вкладок карточки (скрытые вкладки тоже есть в разметке);
    свойства — парами из schema.org, JSON-LD, таблиц и списков; если описания нет — видимый текст страницы без меню и скриптов."""
    html = page_html(url, strict=False)
    t = re.search(r'(?is)<h1\b[^>]*>(.*?)</h1>', html) or re.search(r'(?is)<title\b[^>]*>(.*?)</title>', html)
    title = _unesc(re.sub(r'<[^>]+>', ' ', t.group(1))) if t else ''
    ld_desc, ld_props = _ld_product(html)
    clean = re.sub(r'(?is)<(script|style|noscript|svg)\b.*?</\1\s*>', ' ', html)
    clean = re.sub(r'(?i)</(span|b|strong|em|a|label)\s*>', r' </\1>', clean)      # «Масса</span><span>430 кг» → «Масса 430 кг»
    # характеристики — отовсюду: schema.org, JSON-LD, таблицы и списки (в том числе на скрытых вкладках)
    props, seen = [], set()
    for k, v in _schema_props(html) + ld_props + _table_props(clean, li=True, limit=200):
        if k.lower() not in seen:
            seen.add(k.lower())
            props.append([k, v])
    props = props[:150]
    desc = page_desc(html)
    if len(ld_desc) > len(desc):
        desc = ld_desc
    # остальные вкладки (комплектация, преимущества, технические данные текстом…) — после описания, без повторов
    have = set(desc.split('\n'))
    for tx in _tab_texts(clean):
        add = [x for x in tx.split('\n') if x not in have]
        if sum(len(x) for x in add) >= 40:
            have.update(add)
            desc = (desc + '\n\n' + '\n'.join(add)).strip()
    desc = desc[:20000]
    if len(desc) < 200:
        body = re.sub(r'(?is)<(script|style|noscript|svg|nav|header|footer|form|select|button)\b.*?</\1\s*>', ' ', clean)
        body = re.sub(r'(?i)</t[dh]\s*>', ' ', re.sub(r'(?i)</tr\s*>|<table\b[^>]*>', '\n<br>', body))
        m = re.search(r'(?is)<main\b[^>]*>(.*)</main>', body) or re.search(r'(?is)<body\b[^>]*>(.*)</body>', body)
        text = _no_sales(_html_text(m.group(1) if m else body))
        desc = '\n'.join(x for x in text.split('\n') if len(x) > 2)[:12000] if len(text) > len(desc) else desc
    if not (title or desc or props):
        raise ValueError('на странице не нашлось текста')
    opts = opts or {}
    cand = page_images_any(html, url, limit=max(4, (opts.get('maxCount') or 12) * 2))
    imgs, skipped = probe_images(cand, opts) if (opts.get('minKB') or opts.get('minPx') or opts.get('skipBlank')) else (cand, 0)
    return {'title': title[:300], 'text': desc, 'props': props, 'imgs': imgs[:opts.get('maxCount') or 12], 'imgsSkipped': skipped}


def page_info(html, url):
    props = page_props(html)
    return {'t': page_desc(html), 'imgs': page_images(html, url), 'props': props, 'apply': page_apply(html, props),
            'crumbs': page_crumbs(html), 'v': PAGE_V}


def _page_getter(store):
    """Данные со страниц товаров (описание, фото, свойства, применимость) с кэшем в kv «feeddesc» {адрес: {…, at}}."""
    cache = store.kv_get('feeddesc') or {}
    lock, errors, today, days = threading.Lock(), [], date.today(), SrvVal.get(store, 'cat.pageDays')

    def get(url):
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
        except Exception as e:
            with lock:
                errors.append('%s: %s' % (url[-80:], str(e)[:120]))
            return hit or {}
        info['at'] = today.isoformat()
        with lock:
            cache[url] = info
        return info

    def save():
        with lock:
            store.kv_set('feeddesc', dict(list(cache.items())[-30000:]))
    return get, save, errors


UNIT_ALIAS = {'литров': 'л', 'литра': 'л', 'литр': 'л', 'л.': 'л', 'кг.': 'кг', 'квт': 'кВт', 'вт': 'Вт', 'в': 'В', 'бар': 'бар',
              'дб': 'дБ', 'дба': 'дБ(А)', 'мм': 'мм', 'см': 'см', 'м': 'м', 'л/мин': 'л/мин', 'м3/мин': 'м³/мин', 'м³/мин': 'м³/мин',
              'м3/час': 'м³/ч', 'м3/ч': 'м³/ч', 'м³/час': 'м³/ч', 'м³/ч': 'м³/ч', 'дюйм': 'дюйм', '℃': '°C', '°с': '°C', '°c': '°C'}
_TR = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя', ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'i', 'k', 'l', 'm', 'n', 'o',
               'p', 'r', 's', 't', 'u', 'f', 'h', 'c', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya']))


def _brand_key(s):
    """«Ремеза» и «Remeza» — один производитель."""
    return re.sub(r'[^a-z0-9]', '', ''.join(_TR.get(c, c) for c in str(s or '').lower()))


def _param_name(name, unit):
    """«Мощность, кВт» без атрибута unit → («Мощность», «кВт»)."""
    if not unit:
        m = re.match(r'^(.*\S)\s*,\s*([^,]{1,12})$', name)
        if m:
            name, unit = m.group(1), m.group(2).strip()
    return name, UNIT_ALIAS.get(unit.lower(), unit)


def _clean_url(u):
    """Метки рекламы в ссылке на страницу товара (?r1=yandext&r2=, utm_…) убираются."""
    try:
        p = urllib.parse.urlsplit(u)
        q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True) if not re.match(r'^(r\d|utm_|yclid|from)', k)]
        return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ''))
    except ValueError:
        return u


def parse(data):
    """YML → {shop, date, cats:{id:{name, parent, path}}, offers:[…]}."""
    data = data.lstrip(b'\xef\xbb\xbf \t\r\n')
    if b'<!ENTITY' in data[:4096].upper():
        raise ValueError('В фиде объявлены сущности XML — такой файл не загружается')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise ValueError('Фид не читается как XML (YML): %s' % e)
    shop = root.find('shop') if root.tag != 'shop' else root
    if shop is None:
        raise ValueError('Это не фид YML: нет раздела <shop>')
    cats = {}
    for c in shop.iter('category'):
        cid = (c.get('id') or '').strip()
        if cid:
            cats[cid] = {'id': cid, 'name': re.sub(r'\s+', ' ', c.text or '').strip(), 'parent': (c.get('parentId') or '').strip()}
    for c in cats.values():
        path, p, seen = [c['name']], c['parent'], set()
        while p and p in cats and p not in seen:
            seen.add(p)
            path.insert(0, cats[p]['name'])
            p = cats[p]['parent']
        c['path'] = ' / '.join(x for x in path if x)
    offers = []
    for el in shop.iter('offer'):
        oid = (el.get('id') or '').strip()
        if not oid:
            continue
        vendor, model, prefix, sku = _txt(el, 'vendor'), _txt(el, 'model'), _txt(el, 'typePrefix'), _txt(el, 'vendorCode')
        name = _txt(el, 'name') or ' '.join(x for x in (prefix, vendor, model) if x)
        params = []
        qty, wh = None, {}
        for p in el.findall('param'):
            pn = re.sub(r'\s+', ' ', re.sub(r'[\xad\u200b-\u200d\ufeff]', '', p.get('name') or '')).strip()
            pv = re.sub(r'\s+', ' ', p.text or '').strip()
            if not pn or not pv or JUNK_PARAM.match(pv) or JUNK_PNAME.search(pn) or (pn.lower() == 'спецификация' and pv.isdigit()):
                continue
            n = parse_number(pv)
            if STOCK_PARAM.match(pn) and n is not None:
                qty = n
                continue
            m = WH_PARAM.match(pn)
            if m and n is not None:
                w = m.group(1).strip()
                wh[w] = wh.get(w, 0) + n
                continue
            if BRAND_PARAM.match(pn) and not vendor:        # марка и модель — параметрами, а не тегами vendor / model
                vendor = pv
                continue
            if re.match(r'^модель$', pn, re.I) and not model:
                model = pv
                continue
            if re.match(r'^(код номенклатуры|артикул)$', pn, re.I) and not sku:
                sku = pv
                continue
            k, u = _param_name(pn, (p.get('unit') or '').strip())
            if re.search(r'мощност', k, re.I):        # «90-4», «200-4 B35» — мощность и число полюсов (исполнение) двигателя
                pv = re.sub(r'^(\d+(?:[.,]\d+)?)-[2468](?:\s*B\d+)?$', r'\1', pv)
            params.append({'k': k, 'u': u, 'v': pv})
        if wh and qty is None:
            qty = sum(wh.values())
        for tag in STOCK_TAGS:
            v = parse_number(_txt(el, tag))
            if v is not None:
                qty = v
                break
        outs = [parse_number(o.get('instock')) for o in el.iter('outlet') if o.get('instock') is not None]
        if outs and any(x is not None for x in outs):
            qty = sum(x for x in outs if x is not None)
        avail_attr = (el.get('available') or '').strip().lower()
        available = avail_attr not in ('false', '0', 'no') if avail_attr else (qty is None or qty > 0)
        de = el.find('description')
        desc = _no_sales(_html_text((de.text if de is not None else '') or ''))
        cur = (_txt(el, 'currencyId') or 'RUB').upper()
        cat = _txt(el, 'categoryId')
        offers.append({'oid': oid, 'name': name[:300], 'cat': cat, 'path': (cats.get(cat) or {}).get('path', ''), 'url': _clean_url(_txt(el, 'url')),
                       'price': parse_number(_txt(el, 'price')), 'oldprice': parse_number(_txt(el, 'oldprice')), 'cur': 'RUB' if cur in ('RUR', 'RUB') else cur,
                       'vendor': vendor, 'model': model, 'sku': sku, 'barcode': _txt(el, 'barcode'),
                       'pictures': [re.sub(r'\s+', '', p.text) for p in el.findall('picture') if p.text and p.text.strip()][:12],
                       'desc': desc, 'params': params, 'available': available, 'qty': qty,
                       'stockInfo': {'wh': sorted(([w, n] for w, n in wh.items()), key=lambda t: -t[1])} if wh else None,
                       'weight': parse_number(_txt(el, 'weight')), 'dims': _txt(el, 'dimensions'), 'notes': _txt(el, 'sales_notes')})
    if not offers:
        raise ValueError('В фиде нет товаров (<offer>)')
    if any(o['stockInfo'] for o in offers):         # остатки по складам: позиции без складов в фиде — не на складе (под заказ)
        for o in offers:
            if o['qty'] is None and o['available'] and not o['stockInfo']:
                o['qty'], o['available'] = 0, False
    return {'shop': _txt(shop, 'name') or _txt(shop, 'company'), 'date': root.get('date') or '', 'cats': cats, 'offers': offers}


def load(store, f, fresh=False):
    """Разобранный фид: YML — скачать (кэш 30 минут), из файлов — прочитать сохранённые файлы (кэш до новой загрузки файла)."""
    files = f.get('kind') == 'files'
    key = json.dumps([f.get('files'), f.get('maker'), f.get('cur'), f.get('priceOnly')], sort_keys=True) if files else \
        json.dumps([f['url'], (f.get('files') or {}).get('extra')], sort_keys=True)
    with _LOCK:
        c = _CACHE.get(f['id'])
        if c and c[1] == key and (files or (not fresh and (datetime.now() - c[0]).total_seconds() < 1800)):
            return c[2]
    if files:
        pages = feed_files.read_file(DATA_DIR, f['id'], 'pages')
        if not pages:
            raise ValueError('Сначала загрузите файл парса сайта (CSV)')
        prices = load_prices(f)
        stock = feed_files.read_file(DATA_DIR, f['id'], 'stock')
        feed = feed_files.build_feed(f, feed_files.parse_pages(pages), prices, _param_name, feed_files.parse_stock(stock) if stock else None)
    else:
        feed = parse(fetch(f['url']))
        extra = feed_files.read_file(DATA_DIR, f['id'], 'extra') if (f.get('files') or {}).get('extra') else None
        if extra:           # описания серий и позиций, которых нет в фиде, — из файла описаний
            feed_files.apply_extra(feed, feed_files.parse_extra(extra))
    with _LOCK:
        _CACHE[f['id']] = (datetime.now(), key, feed)
    return feed


# ---------------------------------------------------------------- категории фида → типы программы
def preview(store, f, types):
    feed = load(store, f, fresh=True)
    by = {}
    for o in feed['offers']:
        by.setdefault(o['cat'], []).append(o)
    linked = {d.get('feed', {}).get('oid') for d in _feed_docs(store, f['id'])}
    cats = []
    for cid, offs in sorted(by.items(), key=lambda x: (feed['cats'].get(x[0]) or {}).get('path') or x[0]):
        c = feed['cats'].get(cid) or {'path': 'Без категории' if not cid else 'Категория %s' % cid}
        kinds = {}
        for o in offs:
            k = item_cat(o, types) or 'other'
            kinds[k] = kinds.get(k, 0) + 1
        cats.append({'id': cid, 'path': c['path'], 'count': len(offs), 'kinds': sorted(kinds.items(), key=lambda x: -x[1]),
                     'map': (f.get('cats') or {}).get(cid, ''),
                     'inCatalog': sum(1 for o in offs if o['oid'] in linked)})
    pn = {}
    for o in feed['offers']:
        for p in o['params']:
            pn[p['k']] = pn.get(p['k'], 0) + 1
    offs = feed['offers']
    return {'shop': feed['shop'], 'date': feed['date'], 'total': len(offs), 'cats': cats, 'match': feed.get('match'), 'extra': feed.get('extra'), 'kind': f.get('kind') or 'yml',
            'withDesc': sum(1 for o in feed['offers'] if len(o.get('desc') or '') >= 40),
            'available': sum(1 for o in offs if o['available']), 'withPrice': sum(1 for o in offs if o['price']),
            'withQty': sum(1 for o in offs if o['qty'] is not None), 'withPhoto': sum(1 for o in offs if o['pictures']),
            'inCatalog': len(linked & {o['oid'] for o in offs}), 'params': sorted(pn.items(), key=lambda x: -x[1])[:40],
            'sample': [dict({k: o[k] for k in ('oid', 'name', 'price', 'cur', 'available', 'qty', 'sku')}, maker=maker_of(o, f),
                            model=model_of(o, maker_of(o, f)), cat=item_cat(o, types), pics=len(o['pictures']), params=len(o['params']))
                       for o in offs[:8]]}


# ---------------------------------------------------------------- позиция фида → позиция каталога
def _img_size(data):
    try:
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', data[16:24])
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            if data[12:16] == b'VP8X':
                return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
            if data[12:16] == b'VP8 ':
                w, h = struct.unpack('<HH', data[26:30])
                return w & 0x3fff, h & 0x3fff
        if data[:2] == b'\xff\xd8':
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                mk = data[i + 1]
                if mk in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack('>HH', data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    except Exception:
        pass
    return None, None


def _cid(fid, oid):
    return ('%s-%s' % (images.slug(fid, 20) or 'feed', images.slug(oid, 40) or hashlib.md5(oid.encode()).hexdigest()[:10]))[:64]


def _sum_txt(k, v, u):
    """«5,5+5,5» кВт → «11 кВт (5,5+5,5)», «1,4х3» → «4,2 кВт (1,4 × 3)»: в параметр категории идёт общая мощность."""
    if not u or not re.search(r'мощност|производительн', k, re.I):
        return None
    n = r'(\d+(?:[.,]\d+)?)'
    m = re.match(r'^' + n + r'(?:\s*\+\s*' + n + r')+', v)
    if m and '+' in m.group(0):
        tot = sum(parse_number(x) for x in re.findall(n, m.group(0)))
    else:
        m = re.match(r'^' + n + r'\s*[хx×*]\s*(\d)\b', v)
        if not m:
            return None
        tot = parse_number(m.group(1)) * int(m.group(2))
    return '%s %s (%s)' % (_fmt(round(tot, 3)), u, re.sub(r'\s*\(.*$', '', v).replace('х', ' × ').replace('x', ' × '))


def _with_unit(v, u):
    """«1.7» + «м³/мин» → «1,7 м³/мин»; текстовое значение («G1"») — без единицы."""
    v = re.sub(r'^(-?\d+)\.(\d+)$', r'\1,\2', v.strip())
    if not u or v.lower().endswith(u.lower()) or not re.match(r'^[-−+]?\d', v):
        return v
    if re.search(r'\d\s*(мм|см|бар|bar|кг|кВт|kw|л|дБ|db|м³|м3|нм3|нм³|°c|в|гц|%)\b', v, re.I):
        return v                            # единица уже в значении: «50 мм», «7,5 бар»
    return '%s %s' % (v, u)


def _row_key(k, u):
    return re.sub(r'[^а-яёa-z]', '', k.lower())[:14] + '|' + (u or '').lower()


def _rows(o):
    rows, have = [], set()
    for p in o['params']:
        v = _sum_txt(p['k'], p['v'], p['u']) or _with_unit(p['v'], p['u'])
        rows.append({'k': p['k'], 'v': v[:300], 'hl': False})
        have.add(_row_key(p['k'], p['u']))
    skip = APPLY_RX + r'|артикул|наличи|цена|стоимост|склад|доставк|гаранти|отзыв|рейтинг|бренд'
    if any(k == 'Для оборудования' for k, v in o.get('extraRows') or []):
        skip += r'|^применение$'          # у запчасти это строка «Для оборудования»
    for pk, pv in o.get('props') or []:        # характеристики со страницы товара, которых нет в фиде
        k, u = _param_name(pk, '')
        key = _row_key(k, u)
        if key.split('|')[0] and key not in have and not re.search(skip, pk, re.I):
            have.add(key)
            rows.append({'k': k[:60], 'v': (_sum_txt(k, pv, u) or _with_unit(pv, u))[:300], 'hl': False})
    for k, v in o.get('extraRows') or []:
        if v:
            rows.append({'k': k, 'v': v[:600], 'hl': False})
    if o.get('dims') and not any(re.search(r'габарит', r['k'], re.I) for r in rows):
        rows.append({'k': 'Габариты упаковки (Д × Ш × В), см', 'v': o['dims'].replace('/', ' × '), 'hl': False})
    if o.get('weight') and not any(re.search(r'^вес|масса', r['k'], re.I) for r in rows):
        rows.append({'k': 'Масса с упаковкой', 'v': '%s кг' % str(o['weight']).rstrip('0').rstrip('.'), 'hl': False})
    return rows


def _fix_drive_rows(rows, o, f):
    """«Тип привода» по сериям из настроек фида (driveHints): сайт иногда ошибается — у «DVK D 340-7» пишет «ременной»."""
    want = DriveHints.kind(f, ' '.join(str(x or '') for x in (o.get('name'), o.get('model'), o.get('sheet'))))
    if not want:
        return rows
    for r in rows:
        if re.match(r'^(тип\s+)?привод', r['k'], re.I):
            v = str(r['v']).lower()
            if want == 'direct' and 'ремен' in v:
                r['v'] = 'прямой'
            elif want == 'belt' and re.search(r'прям|муфт', v):
                r['v'] = 'ременной'
    return rows


def _hash(x):
    return hashlib.md5(json.dumps(x, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:12]


# ---------------------------------------------------------------- фид из файлов: сборка каталога из полного парса
# Парс сайта — исчерпывающий список номенклатуры: по нему один раз «формируется каталог» (позиция на каждое исполнение,
# как на сайте), уже имеющиеся позиции производителя (из прошлых загрузок и заведённые вручную) сопоставляются с позициями
# парса и перестраиваются, лишние совпадения (дубли) уходят в корзину. После сборки (f.built) парс только добавляет новые
# позиции, а прайс — обновляет цены; описания, фото и характеристики правятся вручную.
def _pressures(d):
    """Давления позиции каталога: «Рабочее давление 7,5 / 8,5 / 10 / 13 бар» → {7.5, 8.5, 10, 13}; иначе — attrs.pressure."""
    out = set()
    for g in d.get('groups') or []:
        for r in g.get('rows') or []:
            k = str(r.get('k') or '')
            if re.search(r'давлен', k, re.I) and not re.search(r'мин|вход|разреж|вакуум|шин', k, re.I):
                for x in re.findall(r'\d+(?:[.,]\d+)?', str(r.get('v') or '')):
                    n = float(x.replace(',', '.'))
                    if 2 <= n <= 60:
                        out.add(7.5 if n == 7 else n)
    p = parse_number((d.get('attrs') or {}).get('pressure'))
    if not out and p:
        out.add(7.5 if p == 7 else p)
    return out


def _doc_cfg(d):
    """Исполнение позиции каталога: по модели, а если в ней нет латинской серии — по названию; плюс поля карточки."""
    a = d.get('attrs') or {}
    c = feed_files.model_cfg(a.get('model') or d.get('name'), d.get('name'))
    if not feed_files.lat_series(c):
        c = feed_files.model_cfg(d.get('name'), d.get('name'))
    return feed_files.card_attrs(c, a)


def _offer_cfg(o):
    pg = {'name': o['name'], 'url': o.get('url') or '', 'chars': [(p['k'] + (' (%s)' % p['u'] if p.get('u') else ''), p['v']) for p in o.get('params') or []]}
    return feed_files.page_cfg(pg)


def plan_summary(store, f):
    """Сборка каталога без записи: сколько позиций парса, с чем сопоставятся, что станет новым, что уйдёт в корзину."""
    feed = load(store, f)
    skip = {k for k, v in (f.get('cats') or {}).items() if v == 'skip'}
    offs = [o for o in feed['offers'] if o['cat'] not in skip]
    fdocs = _feed_docs(store, f['id'])
    plan = build_plan(store, f, offs, fdocs)
    oname = {o['oid']: o['name'] for o in offs}
    existing = {(d.get('feed') or {}).get('oid') for d in fdocs}
    add = [o['name'] for o in offs if o['oid'] not in existing and o['oid'] not in plan['links']] if f.get('built') else []
    return {'built': f.get('built'), 'offers': len(offs), 'withPrice': sum(1 for o in offs if o['price']),
            'links': len(plan['links']), 'new': len(plan['new']), 'add': add[:300], 'addCount': len(add),
            'linkSample': [[d.get('name'), oname[oid]] for oid, d in list(plan['links'].items()) if d.get('name') != oname[oid]][:300],
            'dups': [{'id': d['id'], 'name': d.get('name')} for d in plan['dups']][:300],
            'keep': [{'id': d['id'], 'name': d.get('name')} for d in plan['keep']][:300]}


class FeedPurge:
    """Удаление позиций каталога, загруженных фидом (только администратор): все или одной категории фида — в корзину
    (восстановить — «Обслуживание → Корзина» в течение срока хранения корзины). block — предложения фида запоминаются
    в настройке фида (f['excluded']: id предложений) — загрузка и проверка фида их больше не создают и не предлагают;
    «Вернуть в загрузку» (unblock) снимает запрет."""
    MAX_EXCLUDED = 50000

    @staticmethod
    def _cat(d):
        fd = d.get('feed') or {}
        return str(fd.get('cat') or ''), str(fd.get('path') or fd.get('crumbs') or '')

    @classmethod
    def _pick(cls, docs, cat):
        return [d for d in docs if not cat or cls._cat(d)[0] == cat]

    @classmethod
    def preview(cls, store, f, cat=''):
        """{total, cats: [{cat, title, n}], picked, sample: [названия], excluded}"""
        docs = _feed_docs(store, f['id'])
        cats = {}
        for d in docs:
            c, title = cls._cat(d)
            x = cats.setdefault(c, {'cat': c, 'title': title or c or 'без категории', 'n': 0})
            x['n'] += 1
        pick = cls._pick(docs, cat)
        return {'total': len(docs), 'cats': sorted(cats.values(), key=lambda x: (-x['n'], x['title'])), 'picked': len(pick),
                'sample': [d.get('name') or d['id'] for d in pick[:15]], 'excluded': len(f.get('excluded') or [])}

    @classmethod
    def run(cls, store, f, cat='', block=True, by=''):
        """→ {deleted, blocked}"""
        pick = cls._pick(_feed_docs(store, f['id']), cat)
        n = store.trash_put_many('catalog', [(d['id'], d.get('name') or d['id']) for d in pick], by or 'администратор')
        blocked = 0
        if block:
            oids = [(d.get('feed') or {}).get('oid') for d in pick]
            items = feeds(store)
            for x in items:
                if x.get('id') == f['id']:
                    ex = list(dict.fromkeys((x.get('excluded') or []) + [str(o) for o in oids if o]))[-cls.MAX_EXCLUDED:]
                    blocked = len(ex) - len(x.get('excluded') or [])
                    x['excluded'] = ex
            store.kv_set(KV, {'items': items})
            with _LOCK:
                _CACHE.pop(f['id'], None)
        return {'deleted': n, 'blocked': blocked}

    @staticmethod
    def unblock(store, fid):
        items, n = feeds(store), 0
        for x in items:
            if x.get('id') == fid:
                n = len(x.pop('excluded', None) or [])
        store.kv_set(KV, {'items': items})
        return n


class FeedRules:
    """Что и куда загружает фид — настройки фида «Что загружать» (администратор задаёт до загрузки, видит план):
    • отбор предложений (filter): brands — только эти марки (пусто — все); words — в названии есть хотя бы одно из слов;
      stop — нет ни одного из слов; priceMin / priceMax — цена фида (в его валюте); avail — только в наличии; priced — только
      с ценой; add — создавать новые позиции (нет — обновляются только уже загруженные). Категории — «cats» фида (skip).
    • поля (fields), которые фид обновляет у позиций, уже загруженных в каталог: название, описание, фото, характеристики,
      категория, цены, наличие (по умолчанию — все; новые позиции создаются целиком). Ежедневная проверка цен и наличия
      тоже не трогает выключенное.
    • plan — предпросмотр без записи: каждая позиция фида «добавится / изменится (что именно) / без изменений / пропущена
      (почему)»; в каталог — только после «Загрузить» (выбранные строки)."""
    FIELDS = (('name', 'Название'), ('desc', 'Описание'), ('photo', 'Фото'), ('params', 'Характеристики'), ('cat', 'Категория'),
              ('price', 'Цены (РРЦ, закупка)'), ('stock', 'Наличие'))
    KEYS = {'name': ('name', 'spec'), 'desc': ('features',), 'photo': ('photo', 'photoSource', 'gallery'), 'params': ('groups',),
            'price': ('price', 'priceCur', 'priceSrc', 'rrc', 'cost', 'costCur', 'costSrc', 'costDisc', 'costAt', 'margin', 'mmode'),
            'stock': ('stock',)}
    PLAN_ROWS = 3000        # строк плана в ответе (счётчики — по всем)

    @staticmethod
    def _words(v):
        return [w for w in (re.sub(r'\s+', ' ', x).strip().lower() for x in re.split(r'[,;\n]', str(v or ''))) if w][:50]

    @classmethod
    def clean_filter(cls, d):
        d = d if isinstance(d, dict) else {}
        num = lambda v: (lambda x: x if x is not None and x >= 0 else None)(parse_number(v))
        return {'brands': [str(b).strip()[:80] for b in (d.get('brands') or []) if str(b).strip()][:200] if isinstance(d.get('brands'), list) else [],
                'words': ', '.join(cls._words(d.get('words')))[:400], 'stop': ', '.join(cls._words(d.get('stop')))[:400],
                'priceMin': num(d.get('priceMin')), 'priceMax': num(d.get('priceMax')),
                'avail': d.get('avail') is True, 'priced': d.get('priced') is True, 'add': d.get('add', True) is not False}

    @classmethod
    def clean_fields(cls, d):
        d = d if isinstance(d, dict) else {}
        return {k: d.get(k, True) is not False for k, _ in cls.FIELDS}

    @classmethod
    def fields(cls, f):
        return cls.clean_fields(f.get('fields'))

    @classmethod
    def reason(cls, o, f):
        """Почему предложение не загружается (пусто — загружается): категория, отбор, удалено ранее."""
        if (f.get('cats') or {}).get(o['cat']) == 'skip':
            return 'категория фида пропускается'
        if o['oid'] in set(f.get('excluded') or []):
            return 'удалено из каталога («не загружать снова»)'
        r = f.get('filter') if isinstance(f.get('filter'), dict) else {}
        if not r:
            return ''
        name = (o.get('name') or '').lower()
        if r.get('brands') and _brand_key(maker_of(o, f)) not in {_brand_key(b) for b in r['brands']}:
            return 'марка не выбрана'
        words = cls._words(r.get('words'))
        if words and not any(w in name for w in words):
            return 'в названии нет нужных слов'
        stop = [w for w in cls._words(r.get('stop')) if w in name]
        if stop:
            return 'в названии «%s»' % stop[0]
        p = o.get('price') or 0
        if r.get('priced') and not p:
            return 'без цены'
        if r.get('priceMin') is not None and p and p < r['priceMin']:
            return 'цена ниже %s' % _fmt(r['priceMin'])
        if r.get('priceMax') is not None and p and p > r['priceMax']:
            return 'цена выше %s' % _fmt(r['priceMax'])
        if r.get('avail') and not o.get('available'):
            return 'нет в наличии'
        return ''

    @classmethod
    def adds(cls, f):
        r = f.get('filter') if isinstance(f.get('filter'), dict) else {}
        return r.get('add', True) is not False

    @classmethod
    def keep(cls, doc, old, f):
        """Позиция после загрузки: выключенные поля — как были в каталоге (old)."""
        if not old:
            return doc
        fl = cls.fields(f)
        for k, keys in cls.KEYS.items():
            if fl.get(k, True):
                continue
            for x in keys:
                if x in old:
                    doc[x] = json.loads(json.dumps(old[x]))
                else:
                    doc.pop(x, None)
        a, oa = dict(doc.get('attrs') or {}), dict(old.get('attrs') or {})
        if not fl['params']:            # параметры категории — как были (категория — по своей галочке)
            a = dict(oa, cat=a.get('cat', oa.get('cat')))
        if not fl['cat'] and oa.get('cat'):
            a['cat'] = oa['cat']
        doc['attrs'] = a
        return doc

    @classmethod
    def changes(cls, ch, f):
        """Изменения цен и наличия для журнала фида — без выключенных полей."""
        fl = cls.fields(f)
        return [c for c in ch if (fl['stock'] if c[0] == 'stock' else fl['price'])]

    @classmethod
    def diff(cls, old, doc):
        """Подписи изменившихся полей позиции."""
        out = []
        eq = lambda a, b: json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)
        for k, label in cls.FIELDS:
            if k == 'cat':
                same = (old.get('attrs') or {}).get('cat') == (doc.get('attrs') or {}).get('cat')
            elif k == 'params':
                drop = lambda a: {x: y for x, y in (a or {}).items() if x != 'cat'}
                same = eq(old.get('groups'), doc.get('groups')) and eq(drop(old.get('attrs')), drop(doc.get('attrs')))
            elif k == 'price':
                same = all(eq(old.get(x), doc.get(x)) for x in cls.KEYS['price'] if x != 'costAt')
            elif k == 'stock':
                strip = lambda s: {x: y for x, y in (s or {}).items() if x != 'at'}
                same = eq(strip(old.get('stock')), strip(doc.get('stock')))
            else:
                same = all(eq(old.get(x), doc.get(x)) for x in cls.KEYS[k])
            if not same:
                out.append(label)
        return out

    @classmethod
    def plan(cls, store, f, types):
        """Предпросмотр загрузки без записи (фото и страницы товаров не скачиваются)."""
        feed = load(store, f, fresh=True)
        existing = {(d.get('feed') or {}).get('oid'): d for d in _feed_docs(store, f['id'])}
        files, built = f.get('kind') == 'files', bool(f.get('built'))
        tnames = {t.get('id'): t.get('name') for t in types}
        rows, cnt, brands, prices = [], {'add': 0, 'update': 0, 'same': 0, 'skip': 0}, {}, []
        for o in feed['offers']:
            mk = maker_of(o, f)
            if mk:
                brands[mk] = brands.get(mk, 0) + 1
            if o.get('price'):
                prices.append(o['price'])
            why, ch, old = cls.reason(o, f), [], existing.get(o['oid'])
            if why:
                st = 'skip'
            elif old:
                if files and built:
                    st, ch = 'same', ['каталог собран — меняются только цены и наличие']
                else:
                    doc, _ = build(dict(o, pictures=[]), f, types, old, None)
                    doc = cls.keep(doc, old, f)
                    ch = cls.diff(old, doc)
                    st = 'update' if ch else 'same'
            elif not cls.adds(f):
                st, why = 'skip', 'новые позиции не создаются'
            else:
                st = 'add'
            cnt[st] += 1
            if len(rows) < cls.PLAN_ROWS:
                cat = (f.get('cats') or {}).get(o['cat']) or item_cat(o, types) or 'other'
                rows.append({'oid': o['oid'], 'name': o['name'], 'maker': mk, 'price': o.get('price') or None, 'cur': o.get('cur') or '',
                             'available': bool(o.get('available')), 'feedCat': (feed['cats'].get(o['cat']) or {}).get('path') or '',
                             'cat': tnames.get((old.get('attrs') or {}).get('cat') if old else cat) or cat,
                             'status': st, 'why': why, 'changes': ch, 'id': old.get('id') if old else ''})
        return {'counts': cnt, 'total': len(feed['offers']), 'rows': rows, 'cut': max(0, len(feed['offers']) - len(rows)),
                'brands': sorted(brands.items(), key=lambda x: (-x[1], x[0]))[:200],
                'price': [min(prices), max(prices)] if prices else None, 'cur': next((o.get('cur') for o in feed['offers'] if o.get('cur')), ''),
                'fields': cls.fields(f), 'filter': cls.clean_filter(f.get('filter')), 'labels': dict(cls.FIELDS)}


def feed_unbuild(store, fid):
    items = feeds(store)
    for x in items:
        if x.get('id') == fid:
            x.pop('built', None)
    store.kv_set(KV, {'items': items})


def build_plan(store, f, offs, feed_docs=None):
    """Какие позиции каталога соответствуют позициям парса: {'links': {oid: doc}, 'dups': [doc], 'keep': [doc], 'new': [oid]}.
    Кандидаты: та же ссылка на сайт, то же название, то же исполнение (серия, типоразмер, ресивер, осушитель, частотник,
    водяное охлаждение; давление позиции парса — среди давлений карточки). Каждой позиции парса — не больше одной позиции
    каталога (её id сохраняется — ссылки в КП не теряются); остальные совпавшие — дубли. feed_docs — позиции фида, если уже
    прочитаны (без повторного чтения каталога)."""
    docs = (_feed_docs(store, f['id']) if feed_docs is None else list(feed_docs)) + _maker_cards(store, f)
    by_url, by_name = {}, {}
    ocfg = []
    for i, o in enumerate(offs):
        if o.get('url'):
            by_url[o['url'].rstrip('/').lower()] = i
        by_name.setdefault(feed_files.name_key(o['name']), i)
        ocfg.append(_offer_cfg(o))
    by_lat, by_code = {}, {}
    for i, c in enumerate(ocfg):
        if feed_files.lat_series(c) and c['size'] is not None:
            by_lat.setdefault((feed_files.lat_series(c), c['size']), []).append(i)
        k = feed_files.code_cfg(offs[i]['name'])
        if k:
            by_code.setdefault(k['ser'], []).append((i, k))
    pairs, cand_docs = [], set()
    for d in docs:
        fd = d.get('feed') or {}
        if fd.get('url') and fd['url'].rstrip('/').lower() in by_url:
            pairs.append((0, 0, by_url[fd['url'].rstrip('/').lower()], d['id']))
        i = by_name.get(feed_files.name_key(d.get('name')))
        if i is not None:
            pairs.append((1, 0, i, d['id']))
        c = _doc_cfg(d)
        ps = _pressures(d)
        lat, lat_hit = feed_files.lat_series(c), False
        for i in by_lat.get((lat, c['size']), []) if lat and c['size'] is not None else []:
            oc = ocfg[i]
            if oc['vsd'] != c['vsd'] or oc['w'] != c['w'] or oc['dry'] != c['dry']:
                continue
            if (c['rec'] is None) != (oc['rec'] is None) or (c['rec'] not in (None, -1) and oc['rec'] != c['rec']):
                continue
            op = 7.5 if oc['p'] == 7 else oc['p']
            if ps and op and op not in ps:
                continue
            own = parse_number((d.get('attrs') or {}).get('pressure'))
            rank = 0 if own and op == (7.5 if own == 7 else own) else (1 + (op or 0) / 100)
            pairs.append((2, rank, i, d['id']))
            lat_hit = True
        for i, rank in ([] if lat_hit else _code_pairs(d, offs, ocfg, by_code)):
            pairs.append((3, rank, i, d['id']))
    pairs.sort(key=lambda x: (x[0], x[1], x[2]))
    by_id = {d['id']: d for d in docs}
    links, taken_o, taken_d = {}, set(), set()
    for prio, rank, i, did in pairs:
        cand_docs.add(did)
        if i in taken_o or did in taken_d:
            continue
        taken_o.add(i)
        taken_d.add(did)
        links[offs[i]['oid']] = by_id[did]
    dups = [by_id[x] for x in cand_docs if x not in taken_d]
    keep = [d for d in docs if d['id'] not in cand_docs]
    return {'links': links, 'dups': dups, 'keep': keep, 'new': [o['oid'] for o in offs if o['oid'] not in links]}


def _code_pairs(d, offs, ocfg, by_code):
    """Русские коды моделей (АСО): карточка «АСО-ВК11/10» — позиция парса «АСО-ВК 11/10М2», «К25М1/10» — «К25М1».
    Совпадают серия, типоразмер (старое «18» = «18,5»), ресивер, осушитель, частотник, исполнение; поколение (М2, Н2)
    в старом названии может не быть; давление карточки, которого нет в парсе, — вариант той же модели (уйдёт в дубли).
    → [(индекс позиции парса, ранг)]."""
    a = d.get('attrs') or {}
    dc = feed_files.code_cfg(d.get('name'), a.get('model'))
    if not dc or not dc['cyr']:             # латинские модели (Dalgakiran) — только по исполнению выше
        return []
    out = []
    for i, oc in by_code.get(dc['ser'], []):
        if not oc['cyr']:
            continue
        if not (oc['size'] == dc['size'] or (dc['size'].is_integer() and oc['size'] == dc['size'] + 0.5)):
            continue
        if (oc['dry'], oc['vsd'], oc['flags'], oc['var'], oc['rec']) != (dc['dry'], dc['vsd'], dc['flags'], dc['var'], dc['rec']):
            continue
        if dc['gen'] and oc['gen'] != dc['gen']:
            continue
        rank = 0 if oc['gen'] == dc['gen'] else 1
        if oc['p'] is not None and dc['p'] is not None:
            if oc['p'] != dc['p']:
                continue
        elif dc['p'] is not None:           # «К2/10» и «К2»: давление позиции парса — из характеристик
            op = ocfg[i]['p']
            rank += 0 if op and abs(op - dc['p']) < 0.6 else 0.5
        out.append((i, rank + (oc['size'] != dc['size']) * 0.2, oc['gen']))
    gens = {g for _, _, g in out}
    if not dc['gen'] and len(gens) > 1 and '' not in gens:
        return []                   # «КТ16» — это КТ16М или КТ16МЭ? Не угадывать
    return [(i, r) for i, r, _ in out]


def _feed_docs(store, fid):
    out = []
    for (doc,) in store.all("SELECT doc FROM catalog WHERE doc LIKE ?", ('%"feed": {%' + json.dumps(fid) + '%',)):
        try:
            d = json.loads(doc)
        except ValueError:
            continue
        if (d.get('feed') or {}).get('id') == fid:
            out.append(d)
    return out


DRIVES = ('any', 'belt', 'direct')
VSD_RX = re.compile(r'\bVSD\b|\bVFD\b|инвертор|частотн|преобразовател\S*\s+частоты|\bINVERS', re.I)


def discount_rules(raw):
    """Сетка скидок из настроек: не больше 30 правил, у каждого — скидка 0…99 %, категории — id типов программы."""
    out = []
    for r in raw[:30]:
        if not isinstance(r, dict):
            continue
        pct = parse_number(r.get('pct'))
        if pct is None or not 0 < pct < 100:
            continue
        cats = [str(c)[:40] for c in (r.get('cats') or []) if re.match(r'^[a-z0-9_-]{1,40}$', str(c))][:40]
        lim = {k: parse_number(r.get(k)) for k in ('kwMin', 'kwMax')}
        out.append({'label': re.sub(r'\s+', ' ', str(r.get('label') or '')).strip()[:80], 'cats': cats, 'kwUnknown': r.get('kwUnknown') is True,
                    'drive': r.get('drive') if r.get('drive') in DRIVES else 'any', 'pct': round(pct, 2),
                    'kwMin': lim['kwMin'] if lim['kwMin'] and lim['kwMin'] > 0 else None, 'kwMax': lim['kwMax'] if lim['kwMax'] and lim['kwMax'] > 0 else None})
    return out


class DriveHints:
    """Подсказки привода из настроек фида (f.driveHints {belt, direct}): серии в названии / листе прайса."""

    @staticmethod
    @functools.lru_cache(maxsize=64)
    def rx(words):
        """«DVK D, IMPETUS» → регулярное выражение по целым словам (пробел и дефис внутри серии — любые); разбирается
        один раз на строку подсказок, а не у каждой позиции."""
        parts = [w.strip() for w in re.split(r'[,;\n]', words or '') if w.strip()]
        if not parts:
            return None
        alt = '|'.join(r'[\s-]*'.join(re.escape(x) for x in re.split(r'[\s-]+', p)) for p in sorted(parts, key=len, reverse=True))
        return re.compile(r'(?<![A-Za-zА-Яа-я0-9])(?:%s)(?![A-Za-zА-Яа-я])' % alt, re.I)

    @classmethod
    def kind(cls, f, text):
        """'direct' | 'belt' | '' — прямые раньше ременных: «DVK D» точнее «DVK»."""
        hints = f.get('driveHints') or {}
        for kind in ('direct', 'belt'):
            rx = cls.rx(hints.get(kind))
            if rx and rx.search(text):
                return kind
        return ''


def drive_of(doc, f):
    """Привод позиции: 'vsd' (частотник), 'direct', 'belt' или '' — не определён. Порядок: признак частотника,
    подсказки-серии из настроек фида (прямые — раньше ременных: «DVK D» точнее «DVK»), строка «Привод» таблицы."""
    a = doc.get('attrs') or {}
    fd = doc.get('feed') or {}
    text = ' '.join(str(x or '') for x in (doc.get('name'), a.get('model'), a.get('series'), fd.get('sheet'), fd.get('path')))
    rows = [(str(r.get('k') or ''), str(r.get('v') or '')) for g in doc.get('groups') or [] for r in g.get('rows') or []]
    reg = ' '.join(v for k, v in rows if re.search(r'регулирован|управлени\S* производ|частот', k, re.I))
    if str(a.get('vsd') or '').lower() == 'да' or VSD_RX.search(text) or VSD_RX.search(reg):
        return 'vsd'
    kind = DriveHints.kind(f, text)
    if kind:
        return kind
    drv = ' '.join(v for k, v in rows if re.search(r'привод|передач', k, re.I)).lower()
    if 'ремен' in drv and not re.search(r'прям|муфт|редукт|зубч', drv):
        return 'belt'
    if re.search(r'прям|муфт|редукт|зубч|соосн|коаксиал', drv):
        return 'direct'
    return ''


def _kw_of(doc):
    kw = parse_number((doc.get('attrs') or {}).get('kw'))
    if kw:
        return kw
    for g in doc.get('groups') or []:
        for r in g.get('rows') or []:
            if re.search(r'мощност', str(r.get('k') or ''), re.I) and not re.search(r'потребля|охлажд|вентил', str(r.get('k') or ''), re.I):
                m = re.search(r'(\d+(?:[.,]\d+)?)\s*(квт|kw)', str(r.get('v') or '') + ' ' + str(r.get('k') or ''), re.I)
                if m:
                    return parse_number(m.group(1))
    return None


def discount_for(f, doc):
    """Скидка поставщика для позиции по сетке f.discounts (первое подходящее правило), иначе f.discount; → (pct | None, подпись)."""
    pct, label, _ = _disc_pick(f, doc)
    return pct, label


def _disc_pick(f, doc):
    """→ (pct | None, подпись, номер правила | None — «остальное»)."""
    a = doc.get('attrs') or {}
    cat = a.get('cat') or ''
    drive, kw = None, None
    for i, r in enumerate(f.get('discounts') or []):
        if r.get('cats') and cat not in r['cats']:
            continue
        if r.get('drive') in ('belt', 'direct'):
            drive = drive_of(doc, f) if drive is None else drive
            if (drive == 'belt') != (r['drive'] == 'belt') or not drive:
                continue
        if r.get('kwMin') or r.get('kwMax'):
            kw = _kw_of(doc) if kw is None else kw
            if not kw and not r.get('kwUnknown'):
                continue
            if kw and ((r.get('kwMin') and kw < r['kwMin']) or (r.get('kwMax') and kw > r['kwMax'])):
                continue
        return r['pct'], r.get('label') or '', i
    if f.get('discount'):
        return f['discount'], 'Остальное оборудование' if f.get('discounts') else '', None
    return None, '', None


def _set_cost(doc, kop, cur, f, ch, o=None):
    """Закупка = цена × (1 − скидка по сетке); ручную закупку (costSrc = manual) не трогает; изменение — в список ch.
    Дилерская цена или «Дилер скидка, %» из строки прайса (o) важнее сетки."""
    if doc.get('costSrc', 'feed') != 'feed':
        return
    if o and o.get('dealer'):
        new = int(round(o['dealer'] * 100))
        disc = {'pct': round((1 - new / kop) * 100, 1) if kop and new < kop else 0, 'label': 'дилерская цена по прайсу'}
    else:
        pct, label = (o['disc'], 'скидка дилера по прайсу') if o and o.get('disc') else discount_for(f, doc)
        if pct is None:
            if f.get('priceKind') != 'cost' or f.get('kind') != 'files':
                return
            pct = 0
        new = int(round(kop * (1 - pct / 100)))
        disc = {'pct': pct, 'label': label} if pct else None
    if doc.get('cost') and (doc.get('cost') != new or (doc.get('costCur') or 'RUB') != cur):
        ch.append(('cost', doc.get('cost'), new, cur))
    doc['cost'], doc['costCur'], doc['costSrc'] = new, cur, 'feed'
    doc['costDisc'] = disc


def _price_part(doc, o, f, today):
    """РРЦ, наличие, цена КП и закупка позиции по предложению фида; → список изменений [(поле, было, стало, валюта)].
    У фида из файлов с priceKind = cost цена прайса — наша закупка (минус скидка, если задана); РРЦ и цена КП не трогаются.
    Скидка — по сетке скидок фида (discount_for)."""
    ch = []
    if not o['price'] and o.get('dealer'):     # в прайсе только цена для дилера (Tewatt)
        _set_cost(doc, 0, o['cur'], f, ch, o)
        doc['costAt'] = today
    elif o['price'] and f.get('priceKind') == 'cost':
        _set_cost(doc, int(round(o['price'] * 100)), o['cur'], f, ch, o)
        doc['costAt'] = today
    elif o['price']:
        kop = int(round(o['price'] * 100))
        r = doc.get('rrc') or {}
        if r.get('price') != kop or r.get('cur') != o['cur']:
            if r.get('price'):
                ch.append(('rrc', r.get('price'), kop))
            doc['rrc'] = {'price': kop, 'cur': o['cur'], 'at': today, 'old': int(round(o['oldprice'] * 100)) if o.get('oldprice') else None,
                          'prev': r.get('price'), 'prevAt': r.get('at')}
        else:
            r['at'] = today
        if doc.get('priceSrc', 'rrc') == 'rrc' and (doc.get('price') != kop or (doc.get('priceCur') or 'RUB') != o['cur']):
            doc['price'], doc['priceCur'], doc['priceSrc'] = kop, o['cur'], 'rrc'
        _set_cost(doc, kop, o['cur'], f, ch, o)
        doc['costAt'] = today
    if o.get('nostock'):            # фид из файлов не знает наличия
        return ch
    s = doc.get('stock') or {}
    st = dict(o.get('stockInfo') or {}, qty=o['qty'], available=bool(o['available']), at=today, gone=False)
    if (s.get('qty'), bool(s.get('available')), bool(s.get('gone')), s.get('transit'), s.get('prod')) != \
            (st['qty'], st['available'], False, st.get('transit'), st.get('prod')) and s:
        ch.append(('stock', _stock_txt(s), _stock_txt(st)))
    doc['stock'] = st
    return ch


def _change(cid, doc, c):
    return {'id': cid, 'name': doc.get('name'), 'kind': c[0], 'old': c[1], 'new': c[2], 'cur': c[3] if len(c) > 3 else ''}


def _stock_txt(s):
    if not s:
        return '—'
    if s.get('gone'):
        return 'нет в фиде'
    wait = ', '.join(t for t in ('в пути %s' % _fmt(s['transit']) if s.get('transit') else '',
                                  'в производстве %s' % _fmt(s['prod']) if s.get('prod') else '') if t)
    if s.get('qty') is not None:
        base = 'в наличии %s' % _fmt(s['qty']) if s['qty'] > 0 else 'нет в наличии'
        return base + ('; ' + wait if wait else '')
    return 'в наличии' if s.get('available') else 'нет в наличии'


def _fmt(n):
    return str(int(n)) if float(n).is_integer() else str(n).replace('.', ',')


# явные правила (по названию позиции, затем по разделу фида) — до общего определения по названию
NAME_RULES = [
    (r'сепаратор\S*\s+масляного тумана|масловлагоразделител|сепаратор\S*\s+конденсата|водомаслян\S*\s+сепаратор', 'oil_sep'),
    (r'угольн\S*\s+колонн', 'filter'),
    (r'компрессор\S*\s+медицинск|медицинск\S*\s+компрессор', 'comp_piston'),   # медицинские Remeza — поршневые безмасляные
    (r'^\s*кожух', 'spare'),
    (r'^\s*конденсатоотводчик', 'condensate'),          # отдельный узел «Очистка и отвод конденсата»; нет такой категории — ЗИП
    (r'фильтроэлемент|корпус\S*\s+фильтр|патрон\S*\s+воздушн|картридж|блок\S*\s+поршнев|^\s*(поршень|шатун|цилиндр|палец|вкладыш|сапун|'
     r'прессостат|манометр|редуктор|муфта|полумуфта|радиатор|переходник|пластина|термоэлемент|конденсатоотводчик|комплект колец|кольцо)', 'spare'),
    (r'циклонн\S*\s+сепаратор', 'filter'),
    (r'модульн\S*\s+компрессорн\S*\s+станци|\bВМКС\b', 'st_comp'),       # АСО: станция в блок-контейнере
    (r'шкаф\S*\s+управления', 'automation'),
    (r'^\s*(рукав|сопло|соплодержател|сцеплени)', 'spare'),                  # к аппаратам струйной очистки
    # русские модели без латиницы («Поршневой компрессор К2»): «Поршневой компрессор высокого давления … W 64» не трогается
    (r'^(?!.*[A-Za-z])\s*поршнев\S*\s+компрессор', 'comp_piston'),
    (r'^(?!.*[A-Za-z])\s*(винтов\S*\s+компрессор|агрегат\S*\s+компрессорн\S*\s+винтов|установк\S*\s+компрессорн\S*\s+винтов)', 'comp_screw'),
]
PATH_RULES = [
    (r'воздуходувк', 'blower'), (r'генератор\S*\s+азота', 'gen_n2'), (r'генератор\S*\s+кислорода', 'gen_o2'),
    (r'адсорбц\S*\s+осушител|осушител\S*.*адсорбц', 'dryer_ads'), (r'рефрижераторн\S*\s+осушител|осушител\S*.*рефрижер', 'dryer_refrig'), (r'воздушн\S*\s+ресивер', 'receiver'),
    (r'фильтр\S*\s+сжатого воздуха', 'filter'), (r'циклонн\S*\s+сепаратор', 'filter'),
    (r'винтов\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|компрессорн\S*\s+станци|лазерн|'
     r'безмасл\S*\s+компрессор\S*\s+(сухого сжатия|с водяным впрыском)', 'comp_screw'),      # Dali CAT, VFW — безмасляные винтовые
    (r'поршнев\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|медицинск\S*\s+компрессор', 'comp_piston'),
    (r'спиральн\S*\s+компрессор|компрессор\S*\s+серии\s+акс', 'comp_scroll'),
]


def _rule(rules, text, ids):
    for rx, c in rules:
        if c in ids and re.search(rx, text or '', re.I):
            return c
    return ''


def item_cat(o, types):
    """Категория программы для позиции фида — только из существующих категорий. Порядок: раздел «Запчасти»,
    явные правила по названию, общее определение по названию (как в каталоге), правила по разделу фида, разделы фида
    по одному. Разделы фида бывают подборками («200 л/мин», «С ресивером») — вперемешку винтовые и поршневые."""
    ids = {t.get('id') for t in types}
    path, crumbs = str(o.get('path') or ''), str(o.get('crumbs') or '')
    spare = next((t for t in types if t.get('id') == 'spare'), None)
    for p in (crumbs, path):        # «Запчасти и расходные материалы / Для винтовых компрессоров»
        if p and spare and spare.get('match') and re.search(spare['match'], p, re.I):
            return 'spare'
    c = _rule(NAME_RULES, o['name'], ids)
    if c:
        return c
    if 'comp_diesel' in ids and re.search(r'компрессор', o['name'], re.I) and re.search(r'дизел', o['name'], re.I):
        return 'comp_diesel'                # «Компрессор винтовой дизельный PDP 15-7» — дизельный, а не винтовой
    c = _rule(PATH_RULES, re.split(r'\s+[A-Z]', o['name'])[0], ids)     # вид в начале названия: «Винтовой компрессор EXELUTE EXDM-RD …»
    if c:                                   # (в описании станции 4 в 1 первым может идти осушитель)
        return c
    c = _rule(PATH_RULES, crumbs, ids)      # настоящий раздел сайта (страница товара) надёжнее подборок фида
    if c:
        return c
    kind = ' '.join(p['v'] for p in o.get('params') or [] if re.match(r'^(вид|тип) компрессора$', p['k'], re.I))
    c = _rule(PATH_RULES, kind + ' компрессор', ids) if kind else ''       # параметр фида «Вид компрессора: винтовой»
    if c:
        return c
    if re.match(r'^\s*осушител', o['name'], re.I):      # «Осушитель воздуха Dali CAAD-27MP-D», параметр «Осушитель: Адсорбционный»
        c = _rule(PATH_RULES, ' '.join('осушитель ' + p['v'] for p in o.get('params') or [] if re.match(r'^(тип )?осушител', p['k'], re.I)), ids)
        if c:
            return c
    diesel = re.search(r'дизел', o['name'] + ' ' + path, re.I)
    c = catalog_migrate.detect({'name': o['name']}, types)
    if c == 'comp_diesel' and not diesel:     # «Компрессорная станция МВК» — электрическая, винтовая
        c = 'comp_screw'
    if c:
        return c
    c = _rule(PATH_RULES, path, ids)
    if c:
        return c
    for seg in reversed(path.split(' / ')):
        c = catalog_migrate.detect({'name': seg}, types)
        if c and not (c == 'comp_diesel' and not diesel):
            return c
    if 'comp_diesel' in ids and re.search(r'бензин\S*\s+(\S+\s+)?компрессор', o['name'], re.I):
        return 'comp_diesel'                # компрессор с бензиновым двигателем — рядом с дизельными (свой двигатель)
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


def spare_info(o):
    """Запасная часть: вид, для какого оборудования, к каким моделям (название, раздел фида, страница товара)."""
    name, path = o['name'], str(o.get('crumbs') or o.get('path') or '')
    last = path.split(' / ')[-1] if path else ''
    use = next((v for k, v in o.get('props') or [] if re.match(r'(?i)^(применение|назначение|тип оборудования)$', k)), '')
    part = next((v for rx, v in SPARE_PART if re.search(rx, name, re.I)), '') or \
        next((v for rx, v in SPARE_PART if re.search(rx, last, re.I)), '') or 'Прочее'
    series = re.findall(PISTON_SERIES, name)
    text = use + ' ' + path + ' ' + name
    for_type = ('Винтовые компрессоры' if re.search(r'винтов|\bВК\s*\d', text, re.I) else
                'Поршневые компрессоры' if series or re.search(r'поршнев|медицинск|кожух', text, re.I) else
                'Спиральные компрессоры' if re.search(r'спиральн', text, re.I) else
                'Магистральные фильтры' if re.search(r'фильтроэлемент|корпус\S*\s+фильтр|фильтр\S*\s+сжатого', text, re.I) else '')
    models = o.get('apply') or ', '.join(dict.fromkeys(series))
    svc = next((m.group(1) for k, v in o.get('props') or [] for m in [re.search(r'(?i)замен\S*\D{0,25}?(\d[\d\s]{1,6})\s*(?:моточас|час|ч\b)', v)] if m), '')
    return {'part': part, 'forType': for_type, 'forModels': models[:600], 'service': int(re.sub(r'\s', '', svc)) if svc else None}


CRUMB_ATTRS = [      # признаки, которые видны только по разделу сайта: (категории, раздел/название, поле, значение)
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


DESC_ATTRS = [       # пустые поля — из описания, когда характеристик на странице нет: (поле, выражение, значение или группа)
    ('drive', r'ремённ\S*|ременн\S*\s+(?:привод|передач)', 'Ременной'),
    ('drive', r'прям\S*\s+привод', 'Прямой'),
    ('voltage', r'напряжени\S*\s+(?:сети\s+)?(220|380|400)\s*в\b', 1),
    ('receiver', r'ресивер\S*\s+(?:объ[её]мом\s+)?(?:на\s+)?(\d{2,4})\s*(?:л|литр)', 1),
    ('stages', r'(двухступенчат|одноступенчат)', lambda m: '2' if m.group(1).lower().startswith('дву') else '1'),
]


# параметры фида вида «Частотный преобразователь: есть», «Тип охлаждения: воздушное» → поля категории (Да / Нет, Воздушное / Водяное)
ROW_ATTRS = (('vsd', r'^частотн|преобразовател\S*\s+частот', ((r'^(есть|да)\b', 'Да'), (r'^нет\b', 'Нет'))),
             ('dryer', r'^(встроенный\s+)?осушител', ((r'^нет\b', 'Нет'), (r'^(есть|да)\b|встроен|рефриж|адсорб', 'Да'))),
             ('cooling', r'^(тип\s+)?охлаждени', ((r'воздуш', 'Воздушное'), (r'водян', 'Водяное'))))


def row_attrs(t, rows, a):
    fields = {f.get('key'): f for f in t.get('fields') or []}
    for key, krx, vals in ROW_ATTRS:
        f = fields.get(key)
        if not f or a.get(key) not in (None, ''):
            continue
        for r in rows:
            if not re.search(krx, r['k'], re.I):
                continue
            v = next((out for vrx, out in vals if re.search(vrx, str(r['v']).strip(), re.I)), '')
            if v and (not f.get('values') or v in f['values']):
                a[key] = v
            break


def desc_attrs(t, text, a):
    fields = {f.get('key'): f for f in t.get('fields') or []}
    for k, rx, v in DESC_ATTRS:
        m = re.search(rx, text or '', re.I)
        if k == 'drive' and m and sum(1 for k2, rx2, _ in DESC_ATTRS if k2 == 'drive' and re.search(rx2, text or '', re.I)) > 1:
            continue                        # «прямой привод надёжнее ременной передачи» — не угадывать
        if k not in fields or a.get(k) or not m:
            continue
        if callable(v):
            a[k] = v(m)
        elif isinstance(v, int):            # номер группы выражения
            a[k] = int(m.group(v)) if k == 'receiver' else m.group(v)
        else:
            a[k] = v


def crumb_attrs(t, text, a):
    keys = {f.get('key') for f in t.get('fields') or []}
    for cats, rx, k, v in CRUMB_ATTRS:
        if t.get('id') in cats and k in keys and not a.get(k) and re.search(rx, text or '', re.I):
            a[k] = v


def model_of(o, maker):
    """Модель: <model> из фида, иначе из названия («Поршневой компрессор Ремеза СБ4/С-24.J1047B» → «СБ4/С-24.J1047B»),
    иначе артикул. vendorCode у многих фидов — складской код, а не модель."""
    if o['model']:
        return o['model'][:80]
    brands = {_brand_key(maker), _brand_key(o['vendor'])} - {''}
    words = [w for w in o['name'].split() if _brand_key(w) not in brands]
    if o['sku'] and words and words[0] == o['sku']:
        return o['sku'][:80]
    i = 0
    while i < len(words) and re.fullmatch(r'[А-Яа-яЁёA-Za-z-]+', words[i]) and not (len(words[i]) > 1 and words[i].isupper()):
        i += 1
    rest = re.sub(r'^(\([^)]*\)\s*)+', '', ' '.join(words[i:]))     # «Сепаратор (маслоотделитель) для ВК20» — не модель
    rest = re.split(r'(?:^|\s+)(?:с|со|для|в комплекте)\s+', rest)[0].strip(' ,–-')
    rest = re.sub(r'(\s+[а-яё]+)+$', '', rest)        # «РВ 500/11 вертикальный» → «РВ 500/11»
    return (rest or o['sku'] or '')[:80]


def makers(f):
    """Производители фида: «EXELUTE, LUPAMAT, ALMIG» — у дистрибьютора несколько марок (у позиции — своя, из парса)."""
    return [x.strip() for x in re.split(r'[,;]', f.get('maker') or '') if x.strip()]


def maker_of(o, f):
    ms = makers(f)
    for m in ms:
        if not o['vendor'] or _brand_key(o['vendor']) == _brand_key(m):
            return m
    return o['vendor'] or (ms[0] if ms else '')


def build(o, f, types, old=None, put_image=None):
    """Позиция каталога из предложения фида; old — та же позиция в каталоге (ручные правки сохраняются)."""
    today = date.today().isoformat()
    doc = json.loads(json.dumps(old)) if old else {'prices': []}
    cat_id = (f.get('cats') or {}).get(o['cat']) or ''
    tmap = {t.get('id'): t for t in types}
    maker = maker_of(o, f)
    model = model_of(o, maker)
    auto = cat_id or item_cat(o, types) or 'other'
    sp = spare_info(o) if auto == 'spare' else None
    if sp:
        o = dict(o, extraRows=[('Артикул', o['sku']), ('Для оборудования', sp['forType']), ('Применимость', sp['forModels'])])
    rows = _fix_drive_rows(_rows(o), o, f)
    orig = (doc.get('feed') or {}).get('orig') or {}
    # позиция заведена вручную (связана с фидом по модели): признак хранится в doc.feed.linked и действует при каждой загрузке
    handmade = bool(old) and ((old.get('feed') or {}).get('linked') or (not (old.get('feed') or {}).get('orig') and bool(old.get('groups') or old.get('features'))))
    if handmade:        # позиция заведена вручную: её текст и таблицы остаются, значения из файла — точнее, остальное — отдельной группой
        rows = _apply_rows(doc, rows)
    desc = '' if handmade and doc.get('features') else o['desc']
    new_orig = {'name': o['name'], 'desc': _hash(desc), 'rows': _hash(rows)}
    if not old or doc.get('name') == orig.get('name'):
        doc['name'] = o['name']
    feats = doc.get('features') or []
    # описание из фида — несколько блоков карточки (feed_files.desc_blocks); пока их не правили вручную, они обновляются целиком
    fds = [x for x in feats if x.get('feed') and not x.get('feedOpts')]
    blocks = feed_files.desc_blocks(desc) if desc else []
    untouched = (not fds or _hash('\n'.join(x.get('text') or '' for x in fds)) == orig.get('desc')
                 or _hash([[x.get('label') or '', x.get('text') or ''] for x in fds]) == orig.get('descBlocks'))
    if blocks and untouched:
        pos = feats.index(fds[0]) if fds else 0
        for x in fds:
            feats.remove(x)
        feats[pos:pos] = [{'id': hashlib.md5((o['oid'] + 'd' + ('' if i == 0 else str(i))).encode()).hexdigest()[:8], 'label': lab, 'text': txt, 'feed': True}
                          for i, (lab, txt) in enumerate(blocks)]
    new_orig['descBlocks'] = _hash([[lab, txt] for lab, txt in blocks])
    opts = o.get('opts') or []
    fo = next((x for x in feats if x.get('feedOpts')), None)
    otext = '; '.join('%s — %s %s' % (x['name'], _fmt(x['price']), o['cur']) for x in opts) if opts else ''
    if otext and (not fo or _hash(fo.get('text') or '') == orig.get('opts')):
        if fo:
            fo['text'] = otext
        else:
            feats.append({'id': hashlib.md5((o['oid'] + 'o').encode()).hexdigest()[:8], 'label': 'Опции по прайсу поставщика', 'text': otext, 'feed': True, 'feedOpts': True})
    elif not otext and fo and _hash(fo.get('text') or '') == orig.get('opts'):
        feats.remove(fo)
    new_orig['opts'] = _hash(otext)
    doc['features'] = feats
    groups = doc.get('groups') or []
    gi = next((i for i, g in enumerate(groups) if g.get('feed')), None)
    if gi is not None and not rows and _hash(groups[gi].get('rows') or []) == orig.get('rows'):
        groups.pop(gi)          # характеристик из фида и со страницы больше нет, вручную таблицу не меняли
    elif rows and (gi is None or _hash(groups[gi].get('rows') or []) == orig.get('rows')):
        g = {'name': 'Данные поставщика' if handmade else 'Характеристики', 'rows': rows, 'feed': True}
        if gi is not None:
            groups[gi] = g
        elif handmade:          # у позиции, заведённой вручную, данные поставщика — после её таблиц
            groups.append(g)
        else:
            groups.insert(0, g)
    doc['groups'] = groups
    a = doc.get('attrs') or {}
    # категория: новая позиция — по правилам; загруженная раньше — тоже, если её не меняли вручную
    prev_auto = (doc.get('feed') or {}).get('catAuto')
    if not a.get('cat') or (old and a.get('cat') == (prev_auto or a.get('cat'))):
        a['cat'] = auto
    if not a.get('maker'):
        a['maker'] = maker
    if not a.get('model'):
        a['model'] = model
    t = tmap.get(a['cat'])
    if t and o.get('authoritative'):       # характеристики из файлов точнее: поля категории — заново по ним
        _redo_attrs(doc, t, a, handmade)
    if t:
        catalog_migrate.fill_from_name(doc, a['cat'], a)
        catalog_migrate.fill_attrs(doc, t, a)
        crumb_attrs(t, (o.get('crumbs') or '') + ' / ' + o['name'], a)
        desc_attrs(t, desc, a)
        row_attrs(t, rows, a)
    if sp and a['cat'] == 'spare':
        for k, v in (('part', sp['part']), ('forType', sp['forType']), ('forModels', sp['forModels']), ('article', o['sku']),
                     ('forMaker', maker), ('service', sp['service']), ('original', 'Оригинал' if maker and _brand_key(maker) in {_brand_key(m) for m in makers(f)} else '')):
            if v and not a.get(k):
                a[k] = v
    doc['attrs'] = a
    if not doc.get('spec'):             # строка под названием: мощность, производительность, давление, ресивер — потом остальное
        top = {'power': 0, 'flow': 1, 'pressure': 2, 'receiver': 3}
        best = sorted((r for r in rows if not re.match(r'^(нет|есть|да|-)$', str(r['v']).strip(), re.I)),     # «Ресивер: нет» — не в строку
                      key=lambda r: top.get(feed_files.spec_class(r['k']), 9))
        doc['spec'] = ' · '.join(r['v'] for r in best[:4])[:200]
    if not doc.get('unit'):
        doc['unit'] = 'шт.'
    doc['feed'] = {'id': f['id'], 'files': f.get('kind') == 'files', 'oid': o['oid'], 'url': o['url'], 'sku': o['sku'], 'barcode': o['barcode'], 'cat': o['cat'],
                   'path': o.get('path', ''), 'crumbs': o.get('crumbs', ''), 'sheet': o.get('sheet', ''), 'catAuto': auto, 'orig': new_orig, 'at': today,
                   'linked': bool(handmade)}
    changes = _price_part(doc, o, f, today)
    if put_image and o['pictures']:
        if not (doc.get('photo') or {}).get('src'):
            ph = put_image(o['pictures'][0], t, maker, model, o['name'], 'photo', '')
            if ph:
                doc['photo'] = ph
                doc['photoSource'] = o['pictures'][0]
        if doc.get('photoSource'):      # главное фото не повторяется в изображениях
            doc['gallery'] = [g for g in doc.get('gallery') or [] if g.get('source') != doc['photoSource']]
        have = {g.get('source') for g in doc.get('gallery') or []} | {doc.get('photoSource')}   # главное фото, выбранное в редакторе, — не дублировать
        gal = doc.get('gallery') or []
        for k, u in enumerate(o['pictures'][:9]):     # с первого: если главным выбрано другое фото, первое — в изображениях
            if u in have:
                continue
            g = put_image(u, t, maker, model, o['name'], 'gallery', 'foto-%d' % (k + 1))
            if g:
                gal.append(dict(g, id=hashlib.md5(u.encode()).hexdigest()[:8], caption='', on=True, source=u))
        doc['gallery'] = gal
    doc['updatedAt'] = _now()
    return doc, changes


def _apply_rows(doc, rows):
    """Строки из файла — в уже имеющиеся таблицы позиции: тот же параметр (мощность, масса, габариты…) — значение заменяется,
    если в таблице оно одно (не «7 / 8,5 / 10 бар» для серии); остальные строки → отдельной группой. → строки для группы."""
    multi = re.compile(r'\d\s*[/–—-]\s*\d|\bпри\b')
    rest = []
    for r in rows:
        c = feed_files.spec_class(r['k'])
        hit = None
        for g in doc.get('groups') or []:
            if g.get('feed'):
                continue
            for er in g.get('rows') or []:
                ev = str(er.get('v') or '')
                if feed_files.spec_class(er.get('k')) == c and re.search(r'\d', ev) and (c not in ('flow', 'pressure') or not multi.search(ev)):
                    hit = er
                    break
            if hit:
                break
        if hit:
            if c in ('flow', 'pressure', 'power', 'mass', 'dims', 'noise', 'outlet', 'receiver', 'voltage', 'refrigerant', 'controller', 'dryer', 'filters', 'rpm', 'purity'):
                hit['v'] = r['v']
        else:
            rest.append(r)
    return rest


def _redo_attrs(doc, t, a, handmade):
    """Поля категории заново по таблице характеристик из файла (она точнее). У позиций, заведённых вручную, производительность и
    давление не трогаются — там они на всю серию (максимум), а строка файла — один вариант."""
    keep = {'cat', 'maker', 'model', 'series'} | ({'flow', 'pressure'} if handmade else set())
    for f in t.get('fields') or []:
        k = f.get('key')
        if k and k not in keep and f.get('find'):
            a.pop(k, None)
    catalog_migrate.fill_attrs(doc, t, a)


def _logo_filler(store, image_store, feed):
    """Логотип производителя у позиций фида: тот, что уже есть в каталоге у этой марки (любое написание), иначе — из
    JSON-парса («logos»: картинка сохраняется в папку логотипов). → fill(doc) → True, если логотип поставлен."""
    have = {_brand_key(v['maker']): v for v in imgfetch.logos(store).values()}
    jl = {_brand_key(k): v for k, v in (feed.get('logos') or {}).items() if v}
    pins = MakerLogos(store)     # логотип, закреплённый администратором за маркой, — всегда, даже поверх логотипа позиции
    state = {'put': None, 'save': None}

    def fill(doc):
        maker = (doc.get('attrs') or {}).get('maker') or ''
        pin = pins.pinned(maker) if maker else None
        if pin:
            if (doc.get('logo') or {}).get('src') == pin['src']:
                return False
            doc['logo'] = {'src': pin['src'], 'w': pin.get('w'), 'h': pin.get('h')}
            return True
        if (doc.get('logo') or {}).get('src'):
            return False
        mk = _brand_key(maker)
        if not mk:
            return False
        lg = have.get(mk)
        if not lg and jl.get(mk) and image_store is not None:
            if state['put'] is None:
                state['put'], state['save'], _ = _image_putter(store, image_store)
            g = state['put'](jl[mk], None, maker, '', maker, 'logo', '')
            if g:
                lg = have[mk] = {'maker': maker, 'src': g['src'], 'w': g.get('w'), 'h': g.get('h')}
        if not lg:
            return False
        doc['logo'] = {'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')}
        return True

    def save():
        if state['save']:
            state['save']()
    return fill, save


def _image_putter(store, image_store):
    cache = store.kv_get('feedimg') or {}
    lock = threading.Lock()
    stat = {'got': 0, 'fail': []}       # скачано новых картинок; не скачались — «адрес: причина»

    def put(url, t, maker, model, name, kind, caption):
        with lock:
            hit = cache.get(url)
        if hit and image_store.path(hit['rel']):
            return {'src': '/img/' + hit['rel'], 'w': hit.get('w'), 'h': hit.get('h')}
        sp = urllib.parse.urlsplit(url)
        try:
            if url.startswith('kpa:'):          # картинка из самого JSON-парса (вырезка из каталога)
                ctype, data = feed_files.asset(url) or (None, None)
                if not data:
                    raise ValueError('картинки нет в файле парса — загрузите парс заново')
            else:
                ctype, data = _probe_get(url) or imgfetch.fetch_image(url, referer='%s://%s/' % (sp.scheme, sp.netloc), tries=2)
        except Exception as e:
            with lock:
                stat['fail'].append('%s: %s' % (url[-70:], str(e)[:100]))
            return None
        ext = {'image/png': '.png', 'image/webp': '.webp'}.get(ctype, '.jpg')
        folder, title = images.place(t, maker, model, name, kind, caption)
        rel = image_store.put(data, ext, folder, title)
        w, h = _img_size(data)
        with lock:
            cache[url] = {'rel': rel, 'w': w, 'h': h}
            stat['got'] += 1
        return {'src': '/img/' + rel, 'w': w, 'h': h}

    def save():
        with lock:
            store.kv_set('feedimg', dict(list(cache.items())[-20000:]))
    return put, save, stat


def page_photos(store, image_store, url, t=None, maker='', model='', name='', urls=None):
    """Фото со страницы товара для одной позиции: [{src, w, h, source}] и ошибки скачивания. urls — выбранные
    пользователем адреса картинок (из page_text / page_images_any), иначе — все найденные на странице."""
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
        g = put(u, t, maker, model, name, 'gallery', 'foto-%d' % (k + 1))
        if g:
            out.append(dict(g, source=u))
    save()
    return {'imgs': out, 'errors': stat['fail'][:10]}


# ---------------------------------------------------------------- загрузка в каталог и проверка цен
def _job(fid, kind, total=0):
    j = {'kind': kind, 'state': 'run', 'done': 0, 'total': total, 'msg': '', 'startedAt': _now(), 'result': None}
    JOBS[fid] = j
    return j


def busy(fid):
    j = JOBS.get(fid)
    return bool(j and j['state'] == 'run')


def _img_key(u):
    """Одна картинка в разных размерах («/upload/abc.png» и «/upload/cache/max_360x500/abc.png») — один ключ."""
    return str(u or '').split('?')[0].rstrip('/').rsplit('/', 1)[-1].lower()


def import_feed(store, f, types, image_store, by='', only=None, log=print, trash_missing=False):
    """Загрузка фида в каталог: новые позиции создаются, связанные обновляются (ручные правки сохраняются).
    only — множество id предложений (иначе все, кроме категорий «skip»).
    Фид из файлов: до сборки каталога (f.built) — сборка: каждая позиция парса — позиция каталога, имеющиеся позиции
    производителя сопоставляются (build_plan) и перестраиваются по парсу и прайсу, дубли — в корзину (и позиции, которых
    нет в парсе, — при trash_missing); после сборки — только новые позиции, имеющиеся не меняются."""
    j = _job(f['id'], 'import')
    try:
        feed = load(store, f)
        # пропускаемые категории, удалённые администратором позиции (FeedPurge) и отбор «Что загружать» (FeedRules)
        offs = [o for o in feed['offers'] if not FeedRules.reason(o, f) and (not only or o['oid'] in only)]
        fdocs = _feed_docs(store, f['id'])
        revs = store.catalog_revs()     # номера правок на начало загрузки: правку менеджера за время загрузки не затираем
        existing = {(d.get('feed') or {}).get('oid'): d for d in fdocs}
        if not FeedRules.adds(f):       # «новые позиции не создавать» — только уже загруженные
            offs = [o for o in offs if o['oid'] in existing]
        links, lstat, mode, plan = {}, {}, 'import', None
        if f.get('kind') == 'files':
            plan = build_plan(store, f, offs, fdocs)
            if f.get('built'):          # каталог сформирован: парс только добавляет новое, имеющееся не трогает
                mode = 'add'
                offs = [o for o in offs if o['oid'] not in existing and o['oid'] not in plan['links']]
                existing = {}
            else:
                mode = 'build'
                try:                    # сборка перестраивает много позиций — сначала копия базы в data/backup
                    store.backup(os.path.join(os.path.dirname(store.path), 'backup', 'kp-%s-before-feed-build.zip' % datetime.now().strftime('%Y%m%d-%H%M%S')))
                except Exception as e:
                    log('Копия базы перед сборкой каталога не создана: %s' % e)
                links = {oid: {'id': d['id'], 'prices': d.get('prices') or []} for oid, d in plan['links'].items()}
                existing = {}
                gone = plan['dups'] + (plan['keep'] if trash_missing else [])
                for d in gone:          # дубли — в корзину до записи новых позиций (id новой может совпасть)
                    store.trash_put('catalog', d['id'], d.get('name') or d['id'], by or ('Фид «%s»' % f['name']))
            lstat = {'linked': len(plan['links']), 'dups': len(plan['dups']), 'keep': len(plan['keep']),
                     'trashed': len(plan['dups']) + (len(plan['keep']) if mode == 'build' and trash_missing else 0)}
        j['total'] = len(offs)
        put, save, istat = _image_putter(store, image_store)
        logo_fill, logo_save = _logo_filler(store, image_store, feed)
        dget, dsave, derr = _page_getter(store)
        ph = _placeholders(feed['offers'])
        pstat = {'img': 0, 'noimg': []}     # страниц товара: с фото / открылись, но фото не найдено
        added, updated, same, price_ch, stock_ch, errors = 0, 0, 0, [], [], []

        def one(o):
            old = existing.get(o['oid']) or links.get(o['oid'])
            if not old:
                cid = _cid(f['id'], o['oid'])
                base = store.rev_of('catalog', cid)['rev']
                prev = store.catalog_get(cid)
                old = json.loads(prev) if prev else None
                if old:
                    revs[cid] = base
            old0 = old      # для сравнения «изменилось ли»: old ниже может быть очищен от лишних фото
            o = dict(o, pictures=[u for u in o['pictures'] if u not in ph])
            if old and ph:              # заглушка «нет фото», загруженная раньше, — заменить фото со страницы
                if old.get('photoSource') in ph:
                    old = dict(old, photo=None, photoSource=None)
                old = dict(old, gallery=[g for g in old.get('gallery') or [] if g.get('source') not in ph])
            if f.get('pageDesc', True) and o['url']:
                pi = dget(o['url'])
                if pi.get('imgs'):
                    pstat['img'] += 1
                elif pi:
                    pstat['noimg'].append(o['name'][:60])
                if len(pi.get('t') or '') > len(o['desc']) and f.get('kind') != 'files' and not o.get('descFixed'):    # у фида из файлов и из файла описаний — своё
                    o['desc'] = pi['t']
                gal = [u for u in pi.get('imgs') or [] if u not in ph][:9]
                if gal and f.get('kind') == 'files':       # главное фото — из парса, страница товара добавляет остальные
                    keys = {_img_key(u) for u in o['pictures']}
                    o['pictures'] = (o['pictures'] + [u for u in gal if _img_key(u) not in keys])[:10]
                    gal = []
                if gal:     # фото — только из галереи карточки товара; картинки фида — лишь когда галереи нет
                    o['pictures'] = gal
                    if old:     # загруженное раньше не из галереи (фид, описание, og:image) — убрать, если не правили вручную
                        keep = set(gal)
                        old = dict(old, gallery=[g for g in old.get('gallery') or [] if not g.get('source') or g['source'] in keep
                                                 or g.get('caption') or g.get('slot') or g.get('at')])
                        if old.get('photoSource') and old['photoSource'] not in keep:
                            old = dict(old, photo=None, photoSource=None)
                o['props'], o['apply'], o['crumbs'] = pi.get('props') or [], pi.get('apply') or '', pi.get('crumbs') or ''
            doc, ch = build(o, f, types, old, put)
            if old0 and mode != 'build':      # выключенные в «Что загружать» поля — как были в каталоге
                doc, ch = FeedRules.keep(doc, old0, f), FeedRules.changes(ch, f)
            logo_fill(doc)
            return o, old0, doc, ch

        def norm(x):        # позиция без служебных полей — сравнить, изменилась ли
            return json.dumps({k: v for k, v in (x or {}).items() if k not in ('updatedAt', '_rev', 'id')}, sort_keys=True, ensure_ascii=False)

        with ThreadPoolExecutor(6) as ex:
            for o, old, doc, ch in ex.map(one, offs):
                try:
                    cid = (old or {}).get('id') or _cid(f['id'], o['oid'])
                    if old and norm(old) == norm(doc):
                        same += 1
                    else:
                        store.catalog_put(cid, json.dumps(doc, ensure_ascii=False), by or ('Фид «%s»' % f['name']), revs.get(cid) if old else None)
                        added += 0 if old else 1
                        updated += 1 if old else 0
                    for c in ch:
                        (stock_ch if c[0] == 'stock' else price_ch).append(_change(cid, doc, c))
                except Conflict as e:
                    errors.append('%s: позицию изменили во время загрузки (%s) — оставлена как есть, обновится при следующей загрузке'
                                  % (o['name'][:60], e.by or 'кто-то'))
                except Exception as e:
                    errors.append('%s: %s' % (o['name'][:60], e))
                j['done'] += 1
        save()
        logo_save()
        dsave()
        if derr:
            errors.append('Страница товара не открылась (описание, фото, применимость), позиций: %d (первая: %s)' % (len(derr), derr[0]))
        if istat['fail']:
            errors.append('Фото не скачались: %d (первое: %s)' % (len(istat['fail']), istat['fail'][0]))
        if pstat['noimg']:
            errors.append('На странице товара не найдено фото, позиций: %d (%s%s)' % (
                len(pstat['noimg']), '; '.join(pstat['noimg'][:3]), ' …' if len(pstat['noimg']) > 3 else ''))
        pics = [len(d.get('gallery') or []) + (1 if (d.get('photo') or {}).get('src') else 0) for d in _feed_docs(store, f['id'])]
        if mode == 'build':
            items = feeds(store)
            for x in items:
                if x.get('id') == f['id']:
                    x['built'] = {'at': _now(), 'by': by, 'items': len(offs), 'linked': lstat.get('linked', 0), 'trashed': lstat.get('trashed', 0)}
                    x['variants'] = []
            store.kv_set(KV, {'items': items})
            with _LOCK:
                _CACHE.pop(f['id'], None)
        res = {'at': _now(), 'kind': 'import', 'mode': mode, 'by': by, 'total': len(offs), 'added': added, 'updated': updated, 'same': same,
               'linked': lstat.get('linked', 0), 'dups': [d.get('name') for d in (plan or {}).get('dups', [])][:300],
               'keep': [d.get('name') for d in (plan or {}).get('keep', [])][:300], 'trashed': lstat.get('trashed', 0),
               'price': price_ch[:300], 'stock': stock_ch[:300], 'errors': errors[:50],
               'photos': {'new': istat['got'], 'pages': pstat['img'], 'items': len(pics), 'multi': sum(1 for n in pics if n > 1),
                          'avg': round(sum(pics) / len(pics), 1) if pics else 0}}
        _log_add(store, f['id'], res)
        _mark(store, f['id'], 'import', res)
        j.update(state='done', result=res, msg='Добавлено %d, обновлено %d' % (added, updated))
        return res
    except Exception as e:
        j.update(state='error', msg=str(e)[:300])
        _log_add(store, f['id'], {'at': _now(), 'kind': 'import', 'by': by, 'error': str(e)[:300]})
        log('Фид %s: %s' % (f['id'], e))
        raise


def _maker_cards(store, f):
    """Позиции каталога производителей фида (f.maker), заведённые вручную и не связанные ни с одним фидом."""
    mk = {_brand_key(m) for m in makers(f)} - {''}
    if not mk:
        return []
    out = []
    for (doc,) in store.all("SELECT doc FROM catalog"):
        try:
            d = json.loads(doc)
        except ValueError:
            continue
        if (d.get('feed') or {}).get('id'):
            continue
        if _brand_key((d.get('attrs') or {}).get('maker')) in mk:
            out.append(d)
    return out


def price_cards(store, f, prices, today, by='', stock=None):
    """Ручные карточки производителя ↔ строки прайса (feed_files.match_card: серия, типоразмер, исполнение): РРЦ, цена КП
    и закупка по сетке скидок — как у позиций фида; связь — doc.priceLink {feed, sku, name, at}. → (изменения цен, сводка)."""
    changes, sumr = [], {'cards': 0, 'priced': 0, 'updated': 0, 'noPrice': [], 'missing': [], 'unclear': []}
    sidx = feed_files.stock_index(stock) if stock else None
    for d in _maker_cards(store, f):
        a = d.get('attrs') or {}
        sumr['cards'] += 1
        rows, why = feed_files.match_card(d.get('name'), a.get('model'), a, prices)
        if why:
            key = {'в прайсе без цены': 'noPrice', 'нет в прайсе': 'missing'}.get(why, 'unclear')
            sumr[key].append({'id': d['id'], 'name': d.get('name'), 'why': why, 'rows': [p['name'] for p in rows[:3]]})
            continue
        p = rows[0]
        before = json.dumps([d.get('rrc'), d.get('price'), d.get('cost'), d.get('costDisc'), d.get('priceLink'), d.get('stock')], sort_keys=True, ensure_ascii=False)
        o = {'price': p['price'], 'oldprice': None, 'cur': (p.get('cur') or f.get('cur') or 'EUR').upper(), 'nostock': True,
             'dealer': p.get('dealer'), 'disc': p.get('disc')}
        if stock:           # остатки поставщика — и у карточек, заведённых вручную
            r = feed_files.stock_row(stock, p.get('sku'), d.get('name'), sidx)
            si = feed_files.stock_info(r)
            o.update(qty=si['qty'], available=si['available'], nostock=False, stockInfo=si)
        for c in _price_part(d, o, f, today):
            changes.append(_change(d['id'], d, c))
        d['priceLink'] = {'feed': f['id'], 'sku': p.get('sku') or '', 'name': p['name'], 'sheet': p.get('sheet') or '', 'rows': len(rows)}
        sumr['priced'] += 1
        if json.dumps([d.get('rrc'), d.get('price'), d.get('cost'), d.get('costDisc'), d.get('priceLink'), d.get('stock')], sort_keys=True, ensure_ascii=False) != before:
            d['updatedAt'] = _now()
            store.catalog_put(d['id'], json.dumps(d, ensure_ascii=False), by or ('Фид «%s»' % f['name']))
            sumr['updated'] += 1
    for k in ('noPrice', 'missing', 'unclear'):
        sumr[k] = sumr[k][:300]
    return changes, sumr


def discount_plan(store, f):
    """Как сетка скидок разложится по позициям каталога из фида (без записи): по правилам — число позиций, примеры,
    средняя закупка; отдельно — компрессоры, у которых не определён привод или мощность (их скидка — «остальное»)."""
    rules = list(f.get('discounts') or [])
    groups = [{'label': r.get('label') or 'Правило %d' % (i + 1), 'pct': r['pct'], 'count': 0, 'sample': []} for i, r in enumerate(rules)]
    other = {'label': 'Остальное оборудование', 'pct': f.get('discount'), 'count': 0, 'sample': []}
    unknown, manual, noprice = [], 0, 0
    drive_cats = {c for r in rules if r.get('drive') in ('belt', 'direct') for c in r.get('cats') or []}
    kw_cats = {c for r in rules if r.get('kwMin') or r.get('kwMax') for c in r.get('cats') or []}
    rule_cats = drive_cats | kw_cats
    for d in _feed_docs(store, f['id']) + (_maker_cards(store, f) if f.get('kind') == 'files' else []):
        i = _disc_pick(f, d)[2]
        g = groups[i] if i is not None else other
        g['count'] += 1
        if len(g['sample']) < 8:
            g['sample'].append(d.get('name') or '')
        cat = (d.get('attrs') or {}).get('cat')
        if g is other and cat in rule_cats:
            why = 'привод не определён' if cat in drive_cats and not drive_of(d, f) else ('мощность не указана' if cat in kw_cats and not _kw_of(d) else '')
            if why:
                unknown.append({'id': d['id'], 'name': d.get('name'), 'why': why})
        if d.get('costSrc', 'feed') != 'feed':
            manual += 1
        if not ((d.get('rrc') or {}).get('price') or d.get('cost')):
            noprice += 1
    return {'groups': groups + [other], 'unknown': unknown[:200], 'unknownCount': len(unknown), 'manual': manual, 'noprice': noprice}


def check_feed(store, f, by='', log=print, types=None):
    """Ежедневная проверка: РРЦ и наличие связанных позиций каталога; позиции, пропавшие из фида, — «нет в фиде»."""
    j = _job(f['id'], 'check')
    try:
        feed = load(store, f, fresh=True)
        by_oid = {o['oid']: o for o in feed['offers']}
        docs = _feed_docs(store, f['id'])
        j['total'] = len(docs)
        today = date.today().isoformat()
        price_ch, stock_ch, gone, upd = [], [], [], 0
        logo_fill, logo_save = _logo_filler(store, IMAGE_STORE, feed)
        for d in docs:
            o = by_oid.get(d['feed'].get('oid'))
            before = json.dumps([d.get('rrc'), d.get('stock'), d.get('price'), d.get('cost'), d.get('costDisc')], sort_keys=True)
            if logo_fill(d):            # логотип производителя — и у позиций, загруженных раньше
                before += '*'
            if o:
                if o.get('sheet'):
                    d['feed']['sheet'] = o['sheet']
                d['feed']['files'] = f.get('kind') == 'files'
                if types and not f.get('built') and FeedRules.fields(f)['cat']:     # категория по правилам изменилась (вручную не меняли) — до расчёта скидки
                    a = d.get('attrs') or {}
                    auto = (f.get('cats') or {}).get(o['cat']) or item_cat(o, types) or 'other'
                    prev = d['feed'].get('catAuto')
                    if prev and a.get('cat') == prev and auto != prev:
                        a['cat'] = auto
                        d['feed']['catAuto'] = auto
                        d['attrs'] = a
                        before = before + '*'
                was = json.loads(json.dumps(d))
                ch = FeedRules.changes(_price_part(d, o, f, today), f)
                d = FeedRules.keep(d, was, f) if not all(FeedRules.fields(f)[k] for k in ('price', 'stock')) else d
                for c in ch:
                    (stock_ch if c[0] == 'stock' else price_ch).append(_change(d['id'], d, c))
            else:
                s = d.get('stock') or {}
                if not s.get('gone'):
                    gone.append({'id': d['id'], 'name': d.get('name')})
                if f.get('kind') != 'files':        # у фида из файлов наличие неизвестно — не отмечать «нет в фиде»
                    d['stock'] = dict(s, available=False, gone=True, at=today)
            if json.dumps([d.get('rrc'), d.get('stock'), d.get('price'), d.get('cost'), d.get('costDisc')], sort_keys=True) != before:
                d['updatedAt'] = _now()
                store.catalog_put(d['id'], json.dumps(d, ensure_ascii=False), by or ('Фид «%s»' % f['name']))
                upd += 1
            j['done'] += 1
        logo_save()
        cards = None
        if f.get('kind') == 'files' and feed.get('prices'):        # карточки производителя, заведённые вручную
            cc, cards = price_cards(store, f, feed['prices'], today, by, feed.get('stock'))
            for c in cc:
                (stock_ch if c['kind'] == 'stock' else price_ch).append(c)
            upd += cards['updated']
        linked = {d['feed'].get('oid') for d in docs}
        var = set(f.get('variants') or [])
        new = [o for o in feed['offers'] if o['oid'] not in linked and o['oid'] not in var and not FeedRules.reason(o, f)] if FeedRules.adds(f) else []
        res = {'at': _now(), 'kind': 'check', 'by': by, 'checked': len(docs), 'updated': upd, 'price': price_ch[:300], 'stock': stock_ch[:300],
               'gone': gone[:300], 'new': len(new), 'newSample': [o['name'] for o in new[:10]], 'cards': cards}
        _log_add(store, f['id'], res)
        _mark(store, f['id'], 'check', res)
        n_cost, n_rrc = sum(1 for c in price_ch if c['kind'] == 'cost'), sum(1 for c in price_ch if c['kind'] == 'rrc')
        msg = 'Закупка изменилась: %d' % n_cost if f.get('priceKind') == 'cost' and f.get('kind') == 'files' else \
            'РРЦ изменилась: %d, закупка: %d, наличие: %d' % (n_rrc, n_cost, len(stock_ch))
        if cards:
            msg += '; карточки, заведённые вручную: с ценой из прайса %d из %d' % (cards['priced'], cards['cards'])
        j.update(state='done', result=res, msg=msg)
        return res
    except Exception as e:
        j.update(state='error', msg=str(e)[:300])
        _log_add(store, f['id'], {'at': _now(), 'kind': 'check', 'by': by, 'error': str(e)[:300]})
        log('Фид %s: %s' % (f['id'], e))
        raise


def _mark(store, fid, kind, res):
    items = feeds(store)
    for x in items:
        if x.get('id') == fid:
            x.setdefault('last', {})[kind] = {k: res.get(k) for k in ('at', 'added', 'updated', 'same', 'checked', 'new', 'total')}
            x['last'][kind]['priceChanges'] = len(res.get('price') or [])
            x['last'][kind]['stockChanges'] = len(res.get('stock') or [])
            x['last'][kind]['gone'] = len(res.get('gone') or [])
    store.kv_set(KV, {'items': items})


def _placeholders(offers):
    """Картинка-заглушка «нет фото»: одна и та же у товаров из многих разных разделов фида."""
    cats = {}
    for o in offers:
        for u in o['pictures'][:1]:
            cats.setdefault(u, set()).add(o['cat'])
    return {u for u, c in cats.items() if len(c) > 4}


def upgrade(store, types, version, log=print):
    """После обновления программы — один раз перезагрузить фиды, из которых уже есть позиции в каталоге:
    категории, запчасти (вид, применимость), описания и фото со страниц — по новым правилам. Ручные правки сохраняются."""
    if store.kv_get('feedsUpgrade') == version:
        return
    store.kv_set('feedsUpgrade', version)
    # фид из файлов перестраивает каталог только по кнопке («Сформировать каталог»), после сборки — правки только вручную
    todo = [f for f in feeds(store) if _feed_docs(store, f['id']) and f.get('kind') != 'files']

    def go():
        for f in todo:
            log('Фид «%s»: перезагрузка после обновления %s' % (f['name'], version))
            _safe(import_feed, store, f, types, IMAGE_STORE, 'Обновление %s' % version)
    if todo:
        run_bg(go)


def run_bg(fn, *a, **k):
    t = threading.Thread(target=lambda: _safe(fn, *a, **k), daemon=True, name='feed')
    t.start()
    return t


def _safe(fn, *a, **k):
    try:
        fn(*a, **k)
    except Exception:
        pass            # загрузка и проверка фида сами пишут ошибку в задачу и журнал фида


def auto_check(store, log=print):
    """Раз в день (после 6 утра — cat.feedHour в «Значениях программы»): РРЦ и наличие по всем фидам с автопроверкой."""
    if datetime.now().hour < SrvVal.get(store, 'cat.feedHour'):
        return
    today = date.today().isoformat()
    for f in feeds(store):
        if not f.get('auto') or f.get('kind') == 'files' or busy(f['id']):
            continue
        if ((f.get('last') or {}).get('check') or {}).get('at', '')[:10] == today:
            continue
        if not _feed_docs(store, f['id']):
            continue
        _safe(check_feed, store, f, 'автопроверка', log)


def _feed_counts(store):
    """{код фида: число связанных позиций} одним запросом (без разбора карточек в Python)."""
    try:
        return {fid: n for fid, n in store.all("SELECT json_extract(doc, '$.feed.id'), COUNT(*) FROM catalog "
                                                "WHERE doc LIKE ? GROUP BY 1", ('%"feed": {%',)) if fid}
    except Exception:               # SQLite без JSON — по-старому
        return None


def status(store):
    out, counts = [], _feed_counts(store)
    for f in feeds(store):
        j = JOBS.get(f['id'])
        n = counts.get(f['id'], 0) if counts is not None else len(_feed_docs(store, f['id']))
        out.append(dict(f, job=j, linked=n, excluded=len(f.get('excluded') or [])))      # список id удалённых — только число
    return out
