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
  • Повторная загрузка не затирает ручные правки: название, описание и таблица характеристик обновляются,
    только если их не меняли после прошлой загрузки (сравнение с doc.feed.orig).
  • Журнал — kv «feedlog:<id>»: последние 30 загрузок и проверок (что добавлено, изменения РРЦ и наличия).
"""
import hashlib
import html as html_mod
import http.cookiejar
import json
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
from config import DATA_DIR

MAX_FEED = 150 * 1024 * 1024
KV = 'feeds'
IMAGE_STORE = None      # хранилище изображений data/img (images.ImageStore) — задаёт kp_server при запуске
JOBS = {}               # id фида → {kind, state, done, total, msg, startedAt, result}
_CACHE = {}             # id фида → (время, url, разобранный фид) — предпросмотр и загрузка без повторного скачивания
_LOCK = threading.Lock()
STOCK_TAGS = ('count', 'quantity', 'stock_quantity', 'stock', 'amount', 'qty', 'instock', 'in_stock')
STOCK_PARAM = re.compile(r'^(остаток|остатки|наличие|в наличии|количество( на складе)?|склад)$', re.I)


def _now():
    return datetime.now().isoformat(timespec='seconds')


def _num(v):
    try:
        return float(re.sub(r'[\s\xa0]', '', str(v)).replace(',', '.'))
    except (TypeError, ValueError):
        return None


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
    disc = _num(f.get('discount'))
    rec = dict(old, id=fid, kind=kind, name=str(f.get('name') or old.get('name') or fid).strip()[:80], url=url,
               maker=str(f.get('maker') or '').strip()[:60], discount=disc if disc and 0 < disc < 100 else None,
               auto=f.get('auto', kind == 'yml') is True, pageDesc=f.get('pageDesc', old.get('pageDesc', kind == 'yml')) is True,
               cats=_cats_ok(f.get('cats')) if isinstance(f.get('cats'), dict) else old.get('cats') or {},
               supplier=str(f.get('supplier') or old.get('supplier') or '')[:64], updatedAt=_now())
    if kind == 'files':
        cur = str(f.get('cur') or old.get('cur') or '').upper()[:3]
        rec.update(priceKind='rrc' if f.get('priceKind', old.get('priceKind')) == 'rrc' else 'cost', cur=cur if re.match(r'^[A-Z]{3}$', cur) else '',
                   priceOnly=f.get('priceOnly', old.get('priceOnly')) is True, files=old.get('files') or {})
    items = [x for x in items if x.get('id') != fid] + [rec]
    store.kv_set(KV, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return rec


def feed_file_put(store, fid, kind, data, name):
    """Файл фида (парс сайта / прайс): сохранить на диск, запомнить мету в настройках фида; → мета."""
    f = feed_get(store, fid)
    if not f or f.get('kind') != 'files':
        raise ValueError('Файлы принимает только фид из файлов')
    meta = feed_files.save_file(DATA_DIR, fid, kind, data, name)
    items = feeds(store)
    for x in items:
        if x.get('id') == fid:
            x.setdefault('files', {})[kind] = meta
            x['updatedAt'] = _now()
    store.kv_set(KV, {'items': items})
    with _LOCK:
        _CACHE.pop(fid, None)
    return meta


def feed_delete(store, fid):
    store.kv_set(KV, {'items': [x for x in feeds(store) if x.get('id') != fid]})
    feed_files.remove_files(DATA_DIR, fid)
    with _LOCK:
        _CACHE.pop(fid, None)


def log_of(store, fid):
    return store.kv_get('feedlog:' + fid) or []


def _log_add(store, fid, rec):
    lg = [rec] + log_of(store, fid)
    store.kv_set('feedlog:' + fid, lg[:30])


# ---------------------------------------------------------------- загрузка и разбор YML
def fetch(url):
    imgfetch._check_url(url)        # только http(s) и не адреса локальной сети
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh feed)', 'Accept': 'application/xml,text/xml,*/*'})
    with urllib.request.build_opener(imgfetch._SafeRedirect).open(req, timeout=120) as r:
        data = r.read(MAX_FEED + 1)
    if len(data) > MAX_FEED:
        raise ValueError('Фид больше 150 МБ')
    return data


PAGE_MAX = 3 * 1024 * 1024
PAGE_V = 5                              # версия разбора страницы: при смене кэш перечитывается
PAGE_DAYS = 30                          # описание со страницы товара запоминается на 30 дней
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
    imgfetch._check_url(url)
    u = urllib.parse.urlsplit(url)
    hd = {'User-Agent': imgfetch.BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5', 'Accept-Encoding': 'gzip, deflate', 'Referer': '%s://%s/' % (u.scheme, u.netloc)}
    opener = urllib.request.build_opener(imgfetch._SafeRedirect, urllib.request.HTTPCookieProcessor(_PAGE_JAR))

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
            r'@|https?://|www\.|\.(ru|org|com|by)\b')


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
    for m in re.finditer(r'(?is)<script\b[^>]*application/ld\+json[^>]*>(.*?)</script>', html):
        try:
            data = json.loads(m.group(1).strip())
        except ValueError:
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                tp = x.get('@type')
                if tp == 'Product' or (isinstance(tp, list) and 'Product' in tp):
                    im = x.get('image')
                    for v in (im if isinstance(im, list) else [im]):
                        add(v.get('url') or v.get('contentUrl') if isinstance(v, dict) else v, strict=False)
                stack.extend(v for v in x.values() if isinstance(v, (dict, list)))
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


def _table_props(html, pats=PROP_PATS, li=False, limit=60):
    """Пары из таблиц, dt/dd, блоков свойств (Битрикс и др.); li=True — ещё и списки «название — значение»."""
    html = re.sub(r'(?is)<div\b[^>]*\bbasket_props_block\b.*?</table>', '', html)     # скрытый выбор свойств корзины
    out, seen = [], set()
    found = [(m.group(1), m.group(2)) for rx in pats for m in re.finditer(rx, html, re.I | re.S)]
    if li:
        found += [(m.group(2), m.group(4)) for m in re.finditer(PROP_LI, html, re.I | re.S)]
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


def _ld_product(html):
    """Товар из JSON-LD (schema.org Product): описание и additionalProperty — многие сайты кладут их только туда."""
    desc, props = '', []
    for m in re.finditer(r'(?is)<script\b[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>', html):
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
            if (tp == 'Product' or (isinstance(tp, list) and 'Product' in tp)):
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
    lock, errors, today = threading.Lock(), [], date.today()

    def get(url):
        if not url:
            return {}
        with lock:
            hit = cache.get(url)
        if hit and hit.get('v') == PAGE_V:
            try:
                # страница без фото перечитывается на следующий день: сайт мог отдать её не полностью
                if (today - date.fromisoformat(hit['at'])).days < (PAGE_DAYS if hit.get('imgs') else 1):
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
              'м3/час': 'м³/ч', 'м3/ч': 'м³/ч', 'м³/час': 'м³/ч', 'м³/ч': 'м³/ч', 'дюйм': 'дюйм'}
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
        vendor, model, prefix = _txt(el, 'vendor'), _txt(el, 'model'), _txt(el, 'typePrefix')
        name = _txt(el, 'name') or ' '.join(x for x in (prefix, vendor, model) if x)
        params = []
        qty = None
        for p in el.findall('param'):
            pn, pv = (p.get('name') or '').strip(), re.sub(r'\s+', ' ', p.text or '').strip()
            if not pn or not pv:
                continue
            if STOCK_PARAM.match(pn) and _num(pv) is not None:
                qty = _num(pv)
                continue
            k, u = _param_name(pn, (p.get('unit') or '').strip())
            params.append({'k': k, 'u': u, 'v': pv})
        for tag in STOCK_TAGS:
            v = _num(_txt(el, tag))
            if v is not None:
                qty = v
                break
        outs = [_num(o.get('instock')) for o in el.iter('outlet') if o.get('instock') is not None]
        if outs and any(x is not None for x in outs):
            qty = sum(x for x in outs if x is not None)
        avail_attr = (el.get('available') or '').strip().lower()
        available = avail_attr not in ('false', '0', 'no') if avail_attr else (qty is None or qty > 0)
        cur = (_txt(el, 'currencyId') or 'RUB').upper()
        cat = _txt(el, 'categoryId')
        offers.append({'oid': oid, 'name': name[:300], 'cat': cat, 'path': (cats.get(cat) or {}).get('path', ''), 'url': _clean_url(_txt(el, 'url')),
                       'price': _num(_txt(el, 'price')), 'oldprice': _num(_txt(el, 'oldprice')), 'cur': 'RUB' if cur in ('RUR', 'RUB') else cur,
                       'vendor': vendor, 'model': model, 'sku': _txt(el, 'vendorCode'), 'barcode': _txt(el, 'barcode'),
                       'pictures': [re.sub(r'\s+', '', p.text) for p in el.findall('picture') if p.text and p.text.strip()][:12],
                       'desc': _html_text((el.find('description').text if el.find('description') is not None else '') or ''),
                       'params': params, 'available': available, 'qty': qty,
                       'weight': _num(_txt(el, 'weight')), 'dims': _txt(el, 'dimensions'), 'notes': _txt(el, 'sales_notes')})
    if not offers:
        raise ValueError('В фиде нет товаров (<offer>)')
    return {'shop': _txt(shop, 'name') or _txt(shop, 'company'), 'date': root.get('date') or '', 'cats': cats, 'offers': offers}


def load(store, f, fresh=False):
    """Разобранный фид: YML — скачать (кэш 30 минут), из файлов — прочитать сохранённые файлы (кэш до новой загрузки файла)."""
    files = f.get('kind') == 'files'
    key = json.dumps([f.get('files'), f.get('maker'), f.get('cur'), f.get('priceOnly')], sort_keys=True) if files else f['url']
    with _LOCK:
        c = _CACHE.get(f['id'])
        if c and c[1] == key and (files or (not fresh and (datetime.now() - c[0]).total_seconds() < 1800)):
            return c[2]
    if files:
        pages = feed_files.read_file(DATA_DIR, f['id'], 'pages')
        if not pages:
            raise ValueError('Сначала загрузите файл парса сайта (CSV)')
        price = feed_files.read_file(DATA_DIR, f['id'], 'price')
        prices = feed_files.parse_price(price)[0] if price else []
        feed = feed_files.build_feed(f, feed_files.parse_pages(pages), prices, _param_name)
    else:
        feed = parse(fetch(f['url']))
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
    return {'shop': feed['shop'], 'date': feed['date'], 'total': len(offs), 'cats': cats, 'match': feed.get('match'), 'kind': f.get('kind') or 'yml',
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
        tot = sum(_num(x) for x in re.findall(n, m.group(0)))
    else:
        m = re.match(r'^' + n + r'\s*[хx×*]\s*(\d)\b', v)
        if not m:
            return None
        tot = _num(m.group(1)) * int(m.group(2))
    return '%s %s (%s)' % (_fmt(round(tot, 3)), u, re.sub(r'\s*\(.*$', '', v).replace('х', ' × ').replace('x', ' × '))


def _with_unit(v, u):
    """«1.7» + «м³/мин» → «1,7 м³/мин»; текстовое значение («G1"») — без единицы."""
    v = re.sub(r'^(-?\d+)\.(\d+)$', r'\1,\2', v.strip())
    if not u or v.lower().endswith(u.lower()) or not re.match(r'^[-−+]?\d', v):
        return v
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


def _hash(x):
    return hashlib.md5(json.dumps(x, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:12]


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


def _price_part(doc, o, f, today):
    """РРЦ, наличие, цена КП и закупка позиции по предложению фида; → список изменений [(поле, было, стало, валюта)].
    У фида из файлов с priceKind = cost цена прайса — наша закупка (минус скидка, если задана); РРЦ и цена КП не трогаются."""
    ch = []
    if o['price'] and f.get('priceKind') == 'cost':
        kop = int(round(o['price'] * 100 * (1 - (f.get('discount') or 0) / 100)))
        if doc.get('costSrc', 'feed') == 'feed' and (doc.get('cost') != kop or (doc.get('costCur') or 'RUB') != o['cur']):
            if doc.get('cost'):
                ch.append(('cost', doc.get('cost'), kop, o['cur']))
            doc['cost'], doc['costCur'], doc['costSrc'] = kop, o['cur'], 'feed'
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
        if f.get('discount') and doc.get('costSrc', 'feed') == 'feed':
            doc['cost'], doc['costCur'], doc['costSrc'] = int(round(kop * (1 - f['discount'] / 100))), o['cur'], 'feed'
    if o.get('nostock'):            # фид из файлов не знает наличия
        return ch
    s = doc.get('stock') or {}
    st = {'qty': o['qty'], 'available': bool(o['available']), 'at': today, 'gone': False}
    if (s.get('qty'), bool(s.get('available')), bool(s.get('gone'))) != (st['qty'], st['available'], False) and s:
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
    if s.get('qty') is not None:
        return 'в наличии %s' % _fmt(s['qty']) if s['qty'] > 0 else 'нет в наличии'
    return 'в наличии' if s.get('available') else 'нет в наличии'


def _fmt(n):
    return str(int(n)) if float(n).is_integer() else str(n).replace('.', ',')


# явные правила (по названию позиции, затем по разделу фида) — до общего определения по названию
NAME_RULES = [
    (r'компрессор\S*\s+медицинск|медицинск\S*\s+компрессор', 'comp_piston'),   # медицинские Remeza — поршневые безмасляные
    (r'^\s*кожух', 'spare'),
    (r'фильтроэлемент|корпус\S*\s+фильтр|патрон\S*\s+воздушн|картридж|блок\S*\s+поршнев|^\s*(поршень|шатун|цилиндр|палец|вкладыш|сапун|'
     r'прессостат|манометр|редуктор|муфта|полумуфта|радиатор|переходник|пластина|термоэлемент|конденсатоотводчик|комплект колец|кольцо)', 'spare'),
    (r'циклонн\S*\s+сепаратор', 'filter'),
]
PATH_RULES = [
    (r'адсорбц\S*\s+осушител|осушител\S*.*адсорбц', 'dryer_ads'), (r'рефрижераторн\S*\s+осушител|осушител\S*.*рефрижер', 'dryer_refrig'), (r'воздушн\S*\s+ресивер', 'receiver'),
    (r'фильтр\S*\s+сжатого воздуха', 'filter'), (r'циклонн\S*\s+сепаратор', 'filter'),
    (r'винтов\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|компрессорн\S*\s+станци|лазерн', 'comp_screw'),
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
    c = _rule(PATH_RULES, crumbs, ids)      # настоящий раздел сайта (страница товара) надёжнее подборок фида
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


def desc_attrs(t, text, a):
    keys = {f.get('key') for f in t.get('fields') or []}
    for k, rx, v in DESC_ATTRS:
        m = re.search(rx, text or '', re.I)
        if k in keys and not a.get(k) and m:
            a[k] = v(m) if callable(v) else (int(m.group(v)) if k == 'receiver' else m.group(v)) if isinstance(v, int) else v


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


def maker_of(o, f):
    fm = f.get('maker') or ''
    if fm and (not o['vendor'] or _brand_key(o['vendor']) == _brand_key(fm)):
        return fm
    return o['vendor'] or fm


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
    rows = _rows(o)
    orig = (doc.get('feed') or {}).get('orig') or {}
    desc = o['desc']
    new_orig = {'name': o['name'], 'desc': _hash(desc), 'rows': _hash(rows)}
    if not old or doc.get('name') == orig.get('name'):
        doc['name'] = o['name']
    feats = doc.get('features') or []
    fd = next((x for x in feats if x.get('feed') and not x.get('feedOpts')), None)
    if desc and (not fd or _hash(fd.get('text') or '') == orig.get('desc')):
        if fd:
            fd['text'] = desc
        else:
            feats.insert(0, {'id': hashlib.md5((o['oid'] + 'd').encode()).hexdigest()[:8], 'label': 'Описание', 'text': desc, 'feed': True})
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
        g = {'name': 'Характеристики', 'rows': rows, 'feed': True}
        if gi is None:
            groups.insert(0, g)
        else:
            groups[gi] = g
    doc['groups'] = groups
    a = doc.get('attrs') or {}
    # категория: новая позиция — по правилам; загруженная раньше — тоже, если её не меняли вручную
    prev_auto = (doc.get('feed') or {}).get('catAuto')
    if not a.get('cat') or (old and a.get('cat') == (prev_auto or a.get('cat'))):
        a['cat'] = auto
    a.setdefault('maker', maker)
    if not a.get('maker'):
        a['maker'] = maker
    if not a.get('model'):
        a['model'] = model
    t = tmap.get(a['cat'])
    if t:
        catalog_migrate.fill_from_name(doc, a['cat'], a)
        catalog_migrate.fill_attrs(doc, t, a)
        crumb_attrs(t, (o.get('crumbs') or '') + ' / ' + o['name'], a)
        desc_attrs(t, desc, a)
    if sp and a['cat'] == 'spare':
        for k, v in (('part', sp['part']), ('forType', sp['forType']), ('forModels', sp['forModels']), ('article', o['sku']),
                     ('forMaker', maker), ('service', sp['service']), ('original', 'Оригинал' if maker and _brand_key(maker) == _brand_key(f.get('maker')) else '')):
            if v and not a.get(k):
                a[k] = v
    doc['attrs'] = a
    if not doc.get('spec'):
        doc['spec'] = ' · '.join(r['v'] for r in rows[:4])[:200]
    if not doc.get('unit'):
        doc['unit'] = 'шт.'
    doc['feed'] = {'id': f['id'], 'oid': o['oid'], 'url': o['url'], 'sku': o['sku'], 'barcode': o['barcode'], 'cat': o['cat'],
                   'path': o.get('path', ''), 'crumbs': o.get('crumbs', ''), 'catAuto': auto, 'orig': new_orig, 'at': today}
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


def import_feed(store, f, types, image_store, by='', only=None, log=print):
    """Загрузка фида в каталог: новые позиции создаются, связанные обновляются (ручные правки сохраняются).
    only — множество id предложений (иначе все, кроме категорий «skip»)."""
    j = _job(f['id'], 'import')
    try:
        feed = load(store, f)
        skip = {k for k, v in (f.get('cats') or {}).items() if v == 'skip'}
        offs = [o for o in feed['offers'] if o['cat'] not in skip and (not only or o['oid'] in only)]
        j['total'] = len(offs)
        existing = {(d.get('feed') or {}).get('oid'): d for d in _feed_docs(store, f['id'])}
        put, save, istat = _image_putter(store, image_store)
        dget, dsave, derr = _page_getter(store)
        ph = _placeholders(feed['offers'])
        pstat = {'img': 0, 'noimg': []}     # страниц товара: с фото / открылись, но фото не найдено
        added, updated, same, price_ch, stock_ch, errors = 0, 0, 0, [], [], []

        def one(o):
            old = existing.get(o['oid'])
            if not old:
                cid = _cid(f['id'], o['oid'])
                prev = store.catalog_get(cid)
                old = json.loads(prev) if prev else None
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
                if len(pi.get('t') or '') > len(o['desc']):
                    o['desc'] = pi['t']
                gal = [u for u in pi.get('imgs') or [] if u not in ph][:9]
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
            return o, old0, doc, ch

        with ThreadPoolExecutor(6) as ex:
            for o, old, doc, ch in ex.map(one, offs):
                try:
                    cid = (old or {}).get('id') or _cid(f['id'], o['oid'])
                    norm = lambda x: json.dumps({k: v for k, v in (x or {}).items() if k not in ('updatedAt', '_rev', 'id')}, sort_keys=True, ensure_ascii=False)
                    if old and norm(old) == norm(doc):
                        same += 1
                    else:
                        store.catalog_put(cid, json.dumps(doc, ensure_ascii=False), by or ('Фид «%s»' % f['name']))
                        added += 0 if old else 1
                        updated += 1 if old else 0
                    for c in ch:
                        (stock_ch if c[0] == 'stock' else price_ch).append(_change(cid, doc, c))
                except Exception as e:
                    errors.append('%s: %s' % (o['name'][:60], e))
                j['done'] += 1
        save()
        dsave()
        if derr:
            errors.append('Страница товара не открылась (описание, фото, применимость), позиций: %d (первая: %s)' % (len(derr), derr[0]))
        if istat['fail']:
            errors.append('Фото не скачались: %d (первое: %s)' % (len(istat['fail']), istat['fail'][0]))
        if pstat['noimg']:
            errors.append('На странице товара не найдено фото, позиций: %d (%s%s)' % (
                len(pstat['noimg']), '; '.join(pstat['noimg'][:3]), ' …' if len(pstat['noimg']) > 3 else ''))
        pics = [len(d.get('gallery') or []) + (1 if (d.get('photo') or {}).get('src') else 0) for d in _feed_docs(store, f['id'])]
        res = {'at': _now(), 'kind': 'import', 'by': by, 'total': len(offs), 'added': added, 'updated': updated, 'same': same,
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


def check_feed(store, f, by='', log=print):
    """Ежедневная проверка: РРЦ и наличие связанных позиций каталога; позиции, пропавшие из фида, — «нет в фиде»."""
    j = _job(f['id'], 'check')
    try:
        feed = load(store, f, fresh=True)
        by_oid = {o['oid']: o for o in feed['offers']}
        docs = _feed_docs(store, f['id'])
        j['total'] = len(docs)
        today = date.today().isoformat()
        price_ch, stock_ch, gone, upd = [], [], [], 0
        for d in docs:
            o = by_oid.get(d['feed'].get('oid'))
            before = json.dumps([d.get('rrc'), d.get('stock'), d.get('price'), d.get('cost')], sort_keys=True)
            if o:
                ch = _price_part(d, o, f, today)
                for c in ch:
                    (stock_ch if c[0] == 'stock' else price_ch).append(_change(d['id'], d, c))
            else:
                s = d.get('stock') or {}
                if not s.get('gone'):
                    gone.append({'id': d['id'], 'name': d.get('name')})
                if f.get('kind') != 'files':        # у фида из файлов наличие неизвестно — не отмечать «нет в фиде»
                    d['stock'] = dict(s, available=False, gone=True, at=today)
            if json.dumps([d.get('rrc'), d.get('stock'), d.get('price'), d.get('cost')], sort_keys=True) != before:
                d['updatedAt'] = _now()
                store.catalog_put(d['id'], json.dumps(d, ensure_ascii=False), by or ('Фид «%s»' % f['name']))
                upd += 1
            j['done'] += 1
        linked = {d['feed'].get('oid') for d in docs}
        skip = {k for k, v in (f.get('cats') or {}).items() if v == 'skip'}
        new = [o for o in feed['offers'] if o['oid'] not in linked and o['cat'] not in skip]
        res = {'at': _now(), 'kind': 'check', 'by': by, 'checked': len(docs), 'updated': upd, 'price': price_ch[:300], 'stock': stock_ch[:300],
               'gone': gone[:300], 'new': len(new), 'newSample': [o['name'] for o in new[:10]]}
        _log_add(store, f['id'], res)
        _mark(store, f['id'], 'check', res)
        j.update(state='done', result=res, msg=('Закупка изменилась: %d' if f.get('priceKind') == 'cost' else 'РРЦ изменилась: %d, наличие: %d') % ((len(price_ch),) if f.get('priceKind') == 'cost' else (len(price_ch), len(stock_ch))))
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
    todo = [f for f in feeds(store) if _feed_docs(store, f['id'])]

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
        pass


def auto_check(store, log=print):
    """Раз в день (после 6 утра): РРЦ и наличие по всем фидам с автопроверкой."""
    if datetime.now().hour < 6:
        return
    today = date.today().isoformat()
    for f in feeds(store):
        if not f.get('auto') or f.get('kind') == 'files' or busy(f['id']):
            continue
        if ((f.get('last') or {}).get('check') or {}).get('at', '')[:10] == today:
            continue
        if not _feed_docs(store, f['id']):
            continue
        try:
            check_feed(store, f, 'автопроверка', log)
        except Exception:
            pass


def status(store):
    out = []
    for f in feeds(store):
        j = JOBS.get(f['id'])
        out.append(dict(f, job=j, linked=len(_feed_docs(store, f['id']))))
    return out
