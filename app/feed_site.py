"""Парс сайта поставщика из файла: страницы в CSV или JSON, дополнительные данные, картинки из файла."""

import base64
import binascii
import csv
import hashlib
import html as html_mod
import io
import json
import re
import urllib.parse
from typing import Any

from feed_match import _code_run

SPEC_PIPES = 2
ROWS_MIN = 2
RANGE_TWO_DECIMALS = 4
RANGE_ONE_DECIMAL = 3
RANGE_WHOLE = 2
PAIR = 2
ASSETS_MAX = 4000
DESC_MIN = 40
CSV_CELLS = 6
SPEC_KEY_MAX = 45


def _decode(data) -> str:
    for enc in ('utf-8-sig', 'cp1251'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', 'replace')


def _unwrap(line) -> str:
    """Строка, которую Excel обернул в кавычки целиком (внутренние кавычки удвоены) и дописал «;;;»."""
    line = line.rstrip('\r\n').rstrip(';').strip()
    if len(line) > 1 and line[0] == '"' and line[-1] == '"' and line.count(',') and '""' in line:
        line = line[1:-1].replace('""', '"')
    return line


def _unq(text) -> str:
    text = text.strip()
    if len(text) > 1 and text[0] == '"' and text[-1] == '"':
        text = text[1:-1]
    return text.strip()


_PROD_URL = re.compile(r'https?://[^\s,"]+')
_CHAR_START = re.compile(r',"?(?=[^:|,"]{2,70}: [^|]*\| )')


def _split_line(line) -> list | None:
    """категория, название, ссылка, картинки, описание, характеристики — без доверия кавычкам CSV (в описаниях они сломаны)."""
    match = _PROD_URL.search(line)
    if not match:
        return None
    head = line[: match.start()].rstrip(', ')
    cat, _, name = head.partition(',')
    url = match.group(0).rstrip('.,;')
    rest = line[match.end() :].lstrip(',')
    pics, desc, chars = '', '', ''
    pic_match = re.match(r'^"?((?:https?://\S+?)(?:\s*\|\s*https?://\S+?)*)"?(?=,|$)', rest)
    if pic_match:
        pics = pic_match.group(1)
        rest = rest[pic_match.end() :].lstrip(',')
    # начало характеристик — «,"Ключ: значение | …»: ключ с заглавной буквы и без точки («,03 мг/м3. Технические особенности:» — хвост
    # описания после запятой в числе «0,03», не характеристики)
    cands = [
        cand.start()
        for cand in _CHAR_START.finditer(rest)
        if re.match(r'^,\s*"*\s*[А-ЯЁA-Z][^:|.]{0,69}:', rest[cand.start() :])
    ]
    cut = next((pos for pos in cands if rest[pos:].count(' | ') >= SPEC_PIPES), cands[-1] if cands else -1)
    if cut >= 0:
        desc, chars = rest[:cut], rest[cut + 1 :]
    elif re.search(r'^[^:|]{2,70}: .*\| ', rest):
        chars = rest
    else:
        desc = rest
    return [_unq(cat), _unq(name), url, _unq(pics), _unq(desc), _unq(chars)]


def _clean_text(text) -> str:
    text = html_mod.unescape(text or '').replace('\xa0', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip(' "')


PAGE_COLS = {
    'cat': r'^категор',
    'name': r'^назван|^наименован',
    'url': r'ссылк|^url',
    'pictures': r'картин|^фото|изображ',
    'desc': r'^описан',
    'chars': r'характерист',
    'model': r'^модель',
    'sku': r'^артикул',
}


def _pages_table(text) -> list | None:
    """Разбор CSV (кавычки, переносы внутри ячеек) и «сломанного» CSV построчно."""
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error:
        return None
    if len(rows) < ROWS_MIN:
        return None
    head = [re.sub(r'\s+', ' ', head_cell).strip().lower() for head_cell in rows[0]]
    col: dict[str, int | None] = {}
    for key, regex in PAGE_COLS.items():
        col[key] = next((i for i, head_cell in enumerate(head) if re.search(regex, head_cell)), None)
    if col['name'] is None or col['url'] is None:
        return None
    body = [row for row in rows[1:] if len(row) > col['url'] and row[col['name']].strip()]
    if not body or sum(1 for row in body if _PROD_URL.match(row[col['url']].strip())) < len(body) * 0.8:
        return None  # кавычки сломаны — строки склеились, читать построчно

    def get(cells, k) -> str:
        index = col[k]
        return cells[index].strip() if index is not None and index < len(cells) else ''

    return [
        [
            get(row, 'cat'),
            get(row, 'name'),
            get(row, 'url'),
            get(row, 'pictures'),
            get(row, 'desc'),
            get(row, 'chars'),
            get(row, 'model'),
        ]
        for row in body
    ]


# {"format": "kp-parse/1", "supplier": "…", "items": [{"category", "name", "model", "url", "images": [адреса, первое — главное],
#   "description": [{"title": "Назначение", "text": "…"}, {"title": "Общие характеристики", "items": ["…", …]}],
#   "specs": [{"name": "Давление", "value": "8,5 бар"}, …]}]}
# Можно и списком позиций без обёртки, с русскими ключами (категория, название, модель, ссылка, картинки, описание,
# характеристики), описанием одной строкой, характеристиками — объектом {"Давление": "8,5 бар"}.
JSON_KEYS = {
    'brand': ('brand', 'vendor', 'бренд', 'производитель', 'марка'),
    'cat': ('category', 'категория', 'cat'),
    'name': ('name', 'название', 'наименование'),
    'model': ('model', 'модель'),
    'url': ('url', 'ссылка', 'link', 'ссылка на страницу товара'),
    'pictures': ('images', 'pictures', 'картинки', 'фото'),
    'desc': ('description', 'описание', 'desc'),
    'chars': ('specs', 'characteristics', 'характеристики', 'технические характеристики'),
    'schemes': ('schemes', 'схемы', 'чертежи', 'drawings'),
}
# разделы сайта по адресу страницы, когда в парсе нет категории (asobezh.ru/catalog/vintovye_kompressory/11_18_5_kvt/…)
URL_SLUGS = {
    'vintovye_kompressory': 'Винтовые компрессоры',
    'porshnevye_kompressory': 'Поршневые компрессоры',
    'vozdushnye_resivery': 'Воздушные ресиверы',
    'podgotovka_vozdukha': 'Подготовка воздуха',
    'apparaty_struynoy_ochistki': 'Аппараты струйной очистки',
    'na_blokakh_rotorcomp': 'На блоках Rotorcomp',
    'peredvizhnye': 'Передвижные',
    'vmks_modulnye_kompressornye_stantsii': 'Модульные компрессорные станции ВМКС',
    's_davleniem_do_16_atm': 'Давление до 16 атм',
    'avtonomnyy_privod': 'С автономным приводом',
    'tandem': 'Тандем',
    'bloki_upravleniya_porshnevymi_kompressorami': 'Блоки управления',
    'na_vertikalnom_resivere': 'На вертикальном ресивере',
    'na_baze_inostrannykh_kompressornykh_golovok': 'На импортных головках',
    'seriya_fini': 'Серия FINI',
    '09g2s': 'Сталь 09Г2С',
    '12x18h10t': 'Нержавеющая сталь 12Х18Н10Т',
    'otsinkovannye': 'Оцинкованные',
    'gorizontalnye_resivery_s_plitoy': 'Горизонтальные с плитой',
    'osushiteli_vozdukha': 'Осушители воздуха',
    'magistralnye_filtry': 'Магистральные фильтры',
    'peskostruynye_apparaty': 'Пескоструйные аппараты',
    'rukava_napornye': 'Рукава напорные',
    'rukava_peskostruynye': 'Рукава пескоструйные',
    'sopla': 'Сопла',
    'soploderzhateli': 'Соплодержатели',
    'stsepleniya_krabovye': 'Сцепления крабовые',
    's_elektroprivodom': 'С электроприводом',
}


def _url_cat(url) -> str:
    """Раздел по адресу: два первых уровня каталога сайта, «4_7_5_kvt» → «4–7,5 кВт», «10_atmosfer» → «10 атм»."""
    path = [x for x in urllib.parse.urlsplit(str(url or '')).path.split('/') if x]
    if path and path[0] in ('catalog', 'katalog', 'products', 'product'):
        path = path[1:]
    if len(path) <= 1:  # «/product/<товар>/» — раздела в адресе нет
        return ''
    out = []
    for seg in path[:2]:
        if re.fullmatch(r'\d+', seg):
            break
        slug = URL_SLUGS.get(seg)
        if not slug:
            match = re.fullmatch(r'(?:s_privodom_)?(\d+(?:_\d+)*)_kvt', seg)
            atmo_match = re.fullmatch(r'(\d+)(?:_(\d+))?_atmosfer', seg)
            if match:  # «4_7_5» — 4–7,5; «11_18_5» — 11–18,5; «2_2_4_0» — 2,2–4,0; «18_5» — 18,5
                nums = match.group(1).split('_')
                if len(nums) == RANGE_TWO_DECIMALS:
                    first, second = nums[0] + ',' + nums[1], nums[2] + ',' + nums[3]
                elif len(nums) == RANGE_ONE_DECIMAL:
                    first, second = (
                        (nums[0], nums[1] + ',' + nums[2])
                        if int(nums[0]) < int(nums[1])
                        else (nums[0] + ',' + nums[1], nums[2])
                    )
                elif len(nums) == RANGE_WHOLE and int(nums[1]) > int(nums[0]):
                    first, second = nums
                else:
                    first, second = ','.join(nums), ''
                slug = f'{first}–{second} кВт' if second else f'{first} кВт'
            elif atmo_match:
                slug = '{} атм'.format('–'.join(x for x in atmo_match.groups() if x))
            else:
                slug = seg.replace('_', ' ').capitalize()
        out.append(slug)
    return ' / '.join(out)


def _jget(item, key) -> Any:
    for k in JSON_KEYS[key]:
        for key_variant in (k, k.capitalize()):
            if key_variant in item:
                return item[key_variant]
    return None


SITE_TAIL = re.compile(
    r'^(официальный сайт|на официальном сайте|на страницах каталога|в разделе техническая документация|рекомендуемая схема|'
    r'для подбора|задать вопрос|каталог продукции завода|американская компания|стандартная схема пневмосистемы)',
    re.I,
)


def _join_lines(text) -> str:
    """Строки, разорванные посреди фразы, — обратно в абзацы."""
    paras: list = []
    for raw_line in str(text or '').replace('\r', '').split('\n'):
        line = re.sub(r'\s+', ' ', raw_line).strip()
        if not line:
            continue
        if (
            paras
            and (not re.search(r'[.!?:;]$', paras[-1]) or re.match(r'^[a-zа-яё0-9«"(,.:;–—-]', line))
            and not line.startswith(('-', '•'))
        ):
            paras[-1] = (paras[-1] + ' ' + line).replace(' ,', ',').replace(' .', '.')
        else:
            paras.append(line)
    return '\n'.join(para for para in paras if not SITE_TAIL.match(para))


def _json_desc(blocks) -> str:
    if isinstance(blocks, str):
        return _join_lines(blocks)
    out = []
    for block in blocks or []:
        if isinstance(block, str):
            out.append(block)
            continue
        if not isinstance(block, dict):
            continue
        title = str(block.get('title') or block.get('заголовок') or '').strip().rstrip(':')
        text = str(block.get('text') or block.get('текст') or '').strip()
        items = [str(x).strip() for x in (block.get('items') or block.get('пункты') or []) if str(x).strip()]
        if title:
            out.append(title + ':')
        if text:
            out.append(text)
        out += ['• ' + x.lstrip('•►- ').strip() for x in items]
    return '\n'.join(out)


def _json_specs(specs) -> list:
    if isinstance(specs, dict):
        return [(str(k), str(v)) for k, v in specs.items()]
    out = []
    for row in specs or []:
        if isinstance(row, dict):
            k = row.get('name') or row.get('k') or row.get('название') or ''
            v = row.get('value') if row.get('value') is not None else row.get('v', row.get('значение', ''))
            u = str(row.get('unit') or row.get('единица') or '').strip()
            v = str(v if v is not None else '').strip()
            if u and v and not v.lower().endswith(u.lower()):
                v = f'{v} {u}'
            out.append((str(k), v))
        elif isinstance(row, (list, tuple)) and len(row) >= PAIR:
            out.append((str(row[0]), str(row[1])))
    return out


# картинки внутри JSON: {"assets": {"exdm-blok": "data:image/jpeg;base64,…"}, "items": [{"images": ["asset:exdm-blok", …]}]}
# (вырезки из каталогов производителя). В позиции — адрес «kpa:<хеш содержимого>», сами данные — здесь до загрузки фото.
ASSETS: dict = {}
ASSET_MAX = 8 * 1024 * 1024


def _data_uri(v) -> tuple | None:
    match = re.match(r'^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$', str(v or '').strip())
    if not match:
        return None
    try:
        data = base64.b64decode(match.group(2), validate=False)
    except (binascii.Error, ValueError):
        return None
    if not data or len(data) > ASSET_MAX:
        return None
    ok = (
        data[:3] == b'\xff\xd8\xff'
        or data[:8] == b'\x89PNG\r\n\x1a\n'
        or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')
    )
    return (match.group(1), data) if ok else None


def _json_assets(obj) -> dict:
    """{"ключ": "data:image/…;base64,…"} → {"ключ": "kpa:<хеш>"}; данные — в ASSETS."""
    raw = obj.get('assets') if isinstance(obj, dict) else None
    out: dict = {}
    if not isinstance(raw, dict):
        return out
    if len(ASSETS) > ASSETS_MAX:
        ASSETS.clear()
    for k, v in list(raw.items())[:3000]:
        ref = _put_asset(v)
        if ref:
            out[str(k)] = ref
    return out


def _put_asset(v) -> str:
    got = _data_uri(v)
    if not got:
        return ''
    ref = 'kpa:' + hashlib.sha1(got[1], usedforsecurity=False).hexdigest()[:20]
    ASSETS[ref] = got
    return ref


def asset(ref) -> tuple | None:
    """«kpa:<хеш>» → (тип, данные) или None."""
    return ASSETS.get(ref)


def parse_pages_json(obj) -> list:
    """Парс в JSON → те же записи, что parse_pages из CSV."""
    items = obj.get('items') or obj.get('позиции') if isinstance(obj, dict) else obj
    if not isinstance(items, list):
        raise ValueError('В JSON нет списка позиций (items)')
    assets = _json_assets(obj)

    def pic(u) -> str:
        u = str(u).strip()
        if u.startswith('asset:'):
            return assets.get(u[6:], '')
        if u.startswith('data:'):
            return _put_asset(u)
        return u if u.startswith('http') else ''

    # логотипы марок: {"logos": {"EXELUTE": "asset:logo-exelute"}} — у позиций этой марки, если в каталоге логотипа ещё нет
    raw_logos = picked if isinstance(obj, dict) and isinstance(picked := obj.get('logos'), dict) else {}
    logos = {str(k).strip().lower(): pic(v) for k, v in list(raw_logos.items())[:50] if isinstance(v, str)}
    out, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        name, url = str(_jget(item, 'name') or '').strip(), str(_jget(item, 'url') or '').strip()
        if not name or not url or url in seen:
            continue
        seen.add(url)
        pics = _jget(item, 'pictures') or []
        if isinstance(pics, str):
            pics = re.split(r'\s*\|\s*', pics)
        schemes = _jget(item, 'schemes') or []  # схемы и чертежи — в конец галереи
        pics = list(pics) + (re.split(r'\s*\|\s*', schemes) if isinstance(schemes, str) else list(schemes))
        rows = []
        for spec_key, spec_val in _json_specs(_jget(item, 'chars')):
            k, v = spec_key.strip(), spec_val.strip()
            if k and v and not re.match(r'^модель$', k, re.I):
                rows.append((k[:70], v[:300]))
        model = str(_jget(item, 'model') or '').strip() or ' '.join(
            _code_run(name)
        )  # «Ресивер воздушный РВ 110/11» → «РВ 110/11»
        out.append(
            {
                'cat': str(_jget(item, 'cat') or _url_cat(url) or 'Без категории').strip()[:80],
                'name': name[:300],
                'url': url,
                'pictures': [u for u in dict.fromkeys(pic(u) for u in pics) if u][:12],
                'brand': str(_jget(item, 'brand') or '').strip()[:60],
                'logo': logos.get(str(_jget(item, 'brand') or '').strip().lower(), ''),
                'desc': _json_desc(_jget(item, 'desc'))[:6000],
                'chars': rows,
                'model': model[:80],
            }
        )
    if not out:
        raise ValueError('В JSON не нашлось ни одной позиции с названием и ссылкой на страницу товара')
    return out


# В фиде поставщика (YML) часть позиций без описания или с рекламным текстом сайта («Наша компания предлагает купить…»).
# Файл описаний (JSON) дополняет фид: описание серии — по разделу фида (id или название) и, при необходимости, по названию
# позиции (match — регулярное выражение); описание отдельной позиции — по id предложения или ссылке; логотипы марок.
# mode серии: «empty» — только позициям без описания, «replace» — вместо описания фида.
#   {"format": "kp-feed-extra/1", "series": [{"cats": ["116"], "names": ["Двухступенчатые компрессоры"], "match": "EN",
#     "mode": "replace", "desc": [{"title": "Назначение", "text": "…", "items": ["…"]}]}],
#     "items": [{"oid": "712", "url": "https://…", "desc": […]}], "logos": {"Dali": "data:image/png;base64,…"}}
def _url_key(u) -> str:
    u = re.sub(r'^https?://(www\.)?', '', str(u or '').strip().lower())
    return u.split('?')[0].rstrip('/')


def parse_extra(data) -> dict:
    """JSON описаний к YML-фиду → {series: [{cats, names, rx, mode, desc}], items: {oid или адрес: desc}, logos: {марка: kpa:…}}."""
    try:
        obj = json.loads(_decode(data))
    except ValueError as exc:
        raise ValueError(f'JSON описаний не читается: {exc}') from exc
    if not isinstance(obj, dict):
        raise ValueError('В JSON описаний нет разделов series / items')
    series = []
    for x in (obj.get('series') or [])[:2000]:
        if not isinstance(x, dict):
            continue
        desc = _json_desc(x.get('desc') or x.get('description'))[:6000]
        if not desc:
            continue
        regex = None
        if x.get('match'):
            try:
                regex = re.compile(str(x['match'])[:300], re.I)
            except re.error as exc:
                raise ValueError('Описание серии: ошибка в match «{}»: {}'.format(x['match'], exc)) from exc
        series.append(
            {
                'cats': {str(cand).strip() for cand in x.get('cats') or [] if str(cand).strip()},
                'names': {
                    re.sub(r'\s+', ' ', str(cand)).strip().lower() for cand in x.get('names') or [] if str(cand).strip()
                },
                'rx': regex,
                'mode': 'replace' if x.get('mode') == 'replace' else 'empty',
                'desc': desc,
            }
        )
    items = {}
    for x in (obj.get('items') or [])[:20000]:
        if not isinstance(x, dict):
            continue
        desc = _json_desc(x.get('desc') or x.get('description'))[:6000]
        if not desc:
            continue
        for k in (str(x.get('oid') or '').strip(), _url_key(x.get('url'))):
            if k:
                items[k] = desc
    logos = {}
    if isinstance(obj.get('logos'), dict):
        if len(ASSETS) > ASSETS_MAX:
            ASSETS.clear()
        for k, v in list(obj['logos'].items())[:50]:
            ref = _put_asset(v) if isinstance(v, str) and v.startswith('data:') else ''
            if ref:
                logos[str(k).strip()] = ref
    if not series and not items and not logos:
        raise ValueError('В JSON описаний нет ни описаний серий (series), ни описаний позиций (items)')
    return {'series': series, 'items': items, 'logos': logos}


def apply_extra(feed, extra) -> int:
    """Описания из файла → предложения YML-фида (o.desc, o.descFixed — страница товара его не заменяет); → число позиций."""
    count = 0
    for offer in feed['offers']:
        desc = extra['items'].get(offer['oid']) or extra['items'].get(_url_key(offer.get('url')))
        if not desc:
            cname = re.sub(r'\s+', ' ', ((feed['cats'].get(offer['cat']) or {}).get('name') or '')).strip().lower()
            for x in extra['series']:
                if (offer['cat'] in x['cats'] or cname in x['names']) and (
                    not x['rx'] or x['rx'].search(offer['name'])
                ):
                    if x['mode'] == 'replace' or len(offer['desc'] or '') < DESC_MIN:
                        desc = x['desc']
                    break
        if desc:
            offer['desc'], offer['descFixed'] = desc, True
            count += 1
    if extra['logos']:
        feed['logos'] = dict(feed.get('logos') or {}, **extra['logos'])
    feed['extra'] = {'items': len(extra['items']), 'series': len(extra['series']), 'applied': count}
    return count


def parse_pages(data) -> list:
    """CSV или JSON парса → [{cat, name, url, pictures, desc, chars:[(k, v)], model}]."""
    text = _decode(data)
    if text.lstrip()[:1] in ('[', '{'):
        try:
            obj = json.loads(text)
        except ValueError as exc:
            raise ValueError(f'JSON не читается: {exc}') from exc
        return parse_pages_json(obj)
    lines = text.splitlines()
    if not lines:
        raise ValueError('Файл пустой')
    out, seen = [], set()
    table = _pages_table(text) if re.match(r'^"?(категор|назван)', lines[0].strip(), re.I) else None
    for item in (
        table if table is not None else (lines[1:] if re.match(r'^"?категор', lines[0].strip(), re.I) else lines)
    ):
        model0 = ''
        if table is not None:
            parts, model0 = item[:6], item[6]
        else:
            line = _unwrap(item)
            if not line.strip():
                continue
            parts = None
            try:
                cells = next(csv.reader(io.StringIO(line)))
                # кавычка внутри описания («99%;"») сбивает CSV: поле характеристик тогда — хвост описания, а не «ключ: значение | …»
                if (
                    len(cells) == CSV_CELLS
                    and _PROD_URL.match(cells[2].strip())
                    and (
                        not cells[5].strip()
                        or (re.match(r'^\s*"?[^:|.]{2,70}:', cells[5]) and cells[5].count(' | ') >= SPEC_PIPES)
                    )
                ):
                    parts = [x.strip() for x in cells]
            except (csv.Error, StopIteration):
                parts = None
            if parts is None:
                parts = _split_line(line)
        if not parts or not parts[1]:
            continue
        cat, name, url, pics, desc, chars = list(parts)
        url = url.strip()
        if url in seen:
            continue
        seen.add(url)
        pictures, have = [], set()
        for pic_url in re.split(r'\s*\|\s*', pics):
            u = pic_url.strip()
            if not u.startswith('http'):
                continue
            base = u.rsplit('/', 1)[-1]
            if base in have:
                continue
            have.add(base)
            pictures.append(u)
        pictures.sort(key=lambda u: 1 if '/cache/' in u else 0)  # оригиналы раньше уменьшенных копий
        rows, model = [], model0[:80]
        for piece in re.split(r'\s*\|\s*', _clean_text(chars)):
            k, _, v = piece.partition(':')
            k, v = k.strip(' "'), v.strip(' "')
            if not k or not v:
                continue
            if re.match(r'^модель$', k, re.I):
                model = v[:80]
                continue
            # хвосты описания, попавшие в характеристики («01 мг/м3). Технические особенности: …»), — не параметры
            if (
                re.match(r'^(примечание|все характеристики)', k, re.I)
                or len(k) > SPEC_KEY_MAX
                or re.search(r'[.)]\s|^\d', k)
            ):
                continue
            v = re.sub(r'""', '"', v)
            v = re.sub(r'(?<=\d)\s*[xх]\s*(?=\d)', ' × ', v) if re.match(r'^\d+\s*[xх]\s*\d+', v) else v
            if re.match(r'^(масса|вес)', k, re.I) and re.fullmatch(r'0([.,]0+)?', v):
                continue
            rows.append((k[:70], v[:300]))
        out.append(
            {
                'cat': _clean_text(cat)[:80] or 'Без категории',
                'name': _clean_text(name)[:300],
                'url': url,
                'pictures': pictures[:12],
                'desc': _clean_text(desc)[:6000],
                'chars': rows,
                'model': model,
            }
        )
    if not out:
        raise ValueError('В файле не нашлось ни одной строки с категорией, названием и ссылкой на страницу товара')
    return out
