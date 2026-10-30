"""Страницы товаров поставщиков: описание, фото, характеристики, разделы сайта, применимость."""

import html as html_mod
import http.cookiejar
import json
import re
import struct
import threading
import urllib.parse
import urllib.request
import zlib
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import imgfetch
from defaults import SrvVal
from feed_text import _html_text
from server_log import ErrorText

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
                errors.append(f'{url[-80:]}: {ErrorText.of(exc)[:120]}')
            return hit or {}
        info['at'] = today.isoformat()
        with lock:
            cache[url] = info
        return info

    def save() -> None:
        with lock:
            store.kv_set('feeddesc', dict(list(cache.items())[-30000:]))

    return get, save, errors


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
