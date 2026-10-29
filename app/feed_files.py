"""Фид поставщика из файлов (без YML): парс сайта (CSV / JSON) + прайсы (XLSX) + остатки — в предложения фида."""

import base64
import binascii
import csv
import hashlib
import html as html_mod
import io
import json
import os
import re
import urllib.parse
import zipfile
from datetime import datetime, timedelta
from typing import Any

import images
from defaults import SrvVal
from genset_sheets import GensetBook, GensetMatch
from genset_tide import TideBook

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
PRESSURE_COLS_MIN = 2
TITLE_MIN = 6
HEAD_GAP = 3
UNITS_ROW_MIN = 3
TABLE_COLS_MIN = 4
SECTION_VALS_MAX = 2
NAME_MIN = 3
PERCENT_MAX = 100
EURO_PRICES_BELOW = 300000
LIST_ITEMS_MIN = 3
SENT_KEY_MIN = 8
HEADING_MAX = 60
CM_VALUES_BELOW = 1000
SPEC_SEEN_MAX = 50000
GLUED_WORDS = 2
LPM_FROM = 60
DIMS_COUNT = 3
SIG_MIN = 2
RECEIVER_MIN = 50
PRICE_NAME_MAX = 90
PRICE_NAME_WORDS = 9
CODE_MIN = 3
SHORT_UP_MAX = 5
NUMS_WITH_RECEIVER = 3
NUMS_WITH_PRESSURE = 2
PRESSURE_CODE_MAX = 50
RECEIVER_MAX = 3000
STD_PRESSURE_MAX = 13
SLUG_MAX = 40

DIR_NAME = 'feeds'
PRESSURE_ALIAS: dict[float, float] = {7: 7.5}  # «7 бар» в названиях и характеристиках — исполнение 7,5 бар
UNITS = {
    'бар',
    'м³/мин',
    'м3/мин',
    'м³/ч',
    'м3/час',
    'м3/ч',
    'л/мин',
    'лит',
    'л',
    'квт',
    'мм',
    'кг',
    'дюйм',
    'дб',
    'дб(а)',
    'евро',
    'eur',
    '€',
    'руб',
    'руб.',
    '₽',
    'usd',
    '$',
    'в/гц',
    'в',
    'модель',
    'тип',
    'r',
    'фланец',
    'шт',
    '(л)',
    '(кг)',
    'об/мин',
    '%',
    '°c',
    'мбар',
    'атм',
    'см',
    'м',
    'g',
    'марка',
    'м2/ч',
    'r (ü)',
    'час',
    'материал',
    'град,°с',
    '°с',
}
HEAD_WORDS = ('Артикул', 'Код SAP', 'Модель', 'Название', 'Наименование')
JUNK = re.compile(r'^(NEW PRICE|Опции|www\.|Содержание|Цены с учетом|\*)', re.I)
CUR_WORDS = {
    'евро': 'EUR',
    'eur': 'EUR',
    '€': 'EUR',
    'руб': 'RUB',
    'руб.': 'RUB',
    '₽': 'RUB',
    'usd': 'USD',
    '$': 'USD',
    'юань': 'CNY',
    'cny': 'CNY',
}


def feed_dir(data_dir: str, fid: str) -> str:
    return os.path.join(data_dir, DIR_NAME, images.slug(fid, 40) or 'feed')


FILE_NAMES = {'pages': 'pages.csv', 'price': 'price.xlsx', 'stock': 'stock.xlsx', 'extra': 'extra.json'}


def file_path(data_dir: str, fid: str, kind, slot=None) -> str:
    """Прайсов у фида может быть несколько — каждый в своём слоте по имени файла."""
    if kind == 'price' and slot and slot != 'price':
        return os.path.join(feed_dir(data_dir, fid), f'price-{images.slug(slot, 40) or "x"}.xlsx')
    return os.path.join(feed_dir(data_dir, fid), FILE_NAMES[kind])


def price_slot(name) -> str:
    """Слот прайса — имя файла без даты и служебных слов."""
    base = re.sub(r'\.[a-z0-9]{2,5}$', '', str(name or '').lower()).replace('_', ' ')
    base = re.sub(r'\d{1,4}[._-]\d{1,2}[._-]\d{1,4}', ' ', base)
    base = re.sub(r'\b(ai|prajs|prais|price|прайс|копия|copy|new|final|rasprodazha|распродажа)\b|\(\d+\)', ' ', base)
    base = re.sub(r'[^a-zа-яё]+', '-', base).strip('-')
    return images.slug(base, 40) or 'price'


def save_file(data_dir: str, fid: str, kind, data, name, slot=None) -> dict:
    """Сохранить файл фида; → мета {name, size, at, …} с итогом разбора (ValueError — файл не читается)."""
    if kind not in FILE_NAMES:
        raise ValueError('Неизвестный вид файла')
    if not data:
        raise ValueError('Файл пустой')
    max_mb = SrvVal.now('cat.feedFileMB')
    if len(data) > max_mb * 1024 * 1024:
        raise ValueError(f'Файл больше {max_mb} МБ (предел — «Настройки → Значения программы»)')
    meta = {'name': str(name or '')[:120], 'size': len(data), 'at': datetime.now().isoformat(timespec='seconds')}
    if kind == 'pages':
        rows = parse_pages(data)
        meta.update(rows=len(rows), cats=len({row['cat'] for row in rows}))
    elif kind == 'extra':
        extra = parse_extra(data)
        meta.update(rows=len(extra['items']), series=len(extra['series']), logos=len(extra['logos']))
    elif kind == 'stock':
        rows = parse_stock(data)
        meta.update(
            rows=len(rows),
            inStock=sum(1 for row in rows if row['qty'] > 0),
            units=sum(row['qty'] for row in rows),
            whs=sorted({wh_name for row in rows for wh_name in (row.get('wh') or {})})[:20],
        )
    else:
        rows, sheets = parse_price(data)
        meta.update(
            rows=len(rows),
            sheets=len(sheets),
            withPrice=sum(1 for row in rows if row['price'] or row.get('dealer')),
            cur=next((row['cur'] for row in rows if row.get('cur')), ''),
            slot=slot or 'price',
            sheetCurs=[{'name': x['name'], 'rows': x['rows'], 'cur': x['cur']} for x in sheets][:40],
        )
    folder = feed_dir(data_dir, fid)
    os.makedirs(folder, exist_ok=True)
    path = file_path(data_dir, fid, kind, slot)
    with open(path + '.tmp', 'wb') as handle:
        handle.write(data)
    os.replace(path + '.tmp', path)
    return meta


def read_file(data_dir: str, fid: str, kind, slot=None) -> bytes | None:
    path = file_path(data_dir, fid, kind, slot)
    if not os.path.exists(path):
        return None
    with open(path, 'rb') as handle:
        return handle.read()


def drop_file(data_dir: str, fid: str, kind, slot=None) -> None:
    try:
        os.remove(file_path(data_dir, fid, kind, slot))
    except OSError:
        pass


def remove_files(data_dir: str, fid: str) -> None:
    folder = feed_dir(data_dir, fid)
    names = os.listdir(folder) if os.path.isdir(folder) else []
    for name in names:
        if re.match(r'^(pages\.csv|price(-[a-z0-9_-]+)?\.xlsx|stock\.xlsx|extra\.json)(\.tmp)?$', name):
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
    try:
        os.rmdir(folder)
    except OSError:
        pass


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
    ref = 'kpa:' + hashlib.sha1(got[1]).hexdigest()[:20]
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


def _col(ref) -> int:
    num = 0
    for char in ref:
        if not char.isalpha():
            break
        num = num * 26 + ord(char.upper()) - 64
    return num - 1


def read_xlsx(data) -> list:
    """Книга XLSX → [(имя листа, [{номер столбца: текст}, …])]; объединённые ячейки развёрнуты (значение — в каждой)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError('Это не файл Excel (.xlsx)') from None
    names = set(z.namelist())
    strings = []
    if 'xl/sharedStrings.xml' in names:
        x = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace')
        for item in re.findall(r'<si>(.*?)</si>', x, re.S):
            strings.append(html_mod.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S))))
    workbook = z.read('xl/workbook.xml').decode('utf-8', 'replace')
    rels = (
        z.read('xl/_rels/workbook.xml.rels').decode('utf-8', 'replace') if 'xl/_rels/workbook.xml.rels' in names else ''
    )
    rid = {}
    for rel in re.findall(r'<Relationship [^>]*>', rels):
        id_found, target_found = re.search(r'\bId="([^"]+)"', rel), re.search(r'\bTarget="([^"]+)"', rel)
        if id_found and target_found:
            rid[id_found.group(1)] = target_found.group(1)
    out = []
    for sheet_match in re.finditer(r'<sheet\b[^>]*>', workbook):
        tag = sheet_match.group(0)
        name_match, rel_id = re.search(r'\bname="([^"]*)"', tag), re.search(r'\br:id="([^"]+)"', tag)
        if not name_match or not rel_id:
            continue
        target = rid.get(rel_id.group(1), '')
        path = target.lstrip('/') if target.startswith('/') else 'xl/' + re.sub(r'^(\./)?(xl/)?', '', target)
        if path not in names:
            continue
        x = z.read(path).decode('utf-8', 'replace')
        rows: dict = {}
        for row_match in re.finditer(r'<row\b[^>]*?(?:\br="(\d+)")?[^>]*>(.*?)</row>', x, re.S):
            row_num = int(row_match.group(1)) if row_match.group(1) else len(rows) + 1
            cells: dict = {}
            for cell_match in re.finditer(r'<c\b([^>]*?)(?:/>|>(.*?)</c>)', row_match.group(2), re.S):
                attrs, inner = cell_match.group(1), cell_match.group(2) or ''
                ref = re.search(r'\br="([A-Z]+)\d*"', attrs)
                col_ix = _col(ref.group(1)) if ref else len(cells)
                type_match = re.search(r'\bt="(\w+)"', attrs)
                cell_type = type_match.group(1) if type_match else ''
                if cell_type == 'inlineStr':
                    v: Any = html_mod.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))
                else:
                    val_match = re.search(r'<v>(.*?)</v>', inner, re.S)
                    v = html_mod.unescape(val_match.group(1)) if val_match else ''
                    if cell_type == 's' and v:
                        try:
                            v = strings[int(v)]
                        except (ValueError, IndexError):
                            v = ''
                if v != '':
                    cells[col_ix] = v
            rows[row_num] = cells
        for merge in re.findall(r'<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"', x):
            col1, row1, col2, row2 = _col(merge[0]), int(merge[1]), _col(merge[2]), int(merge[3])
            v = (rows.get(row1) or {}).get(col1)
            if v in (None, ''):
                continue
            for row in range(row1, min(row2, row1 + 50) + 1):
                for col in range(col1, min(col2, col1 + 50) + 1):
                    rows.setdefault(row, {}).setdefault(col, v)
        out.append((html_mod.unescape(name_match.group(1)), [rows[k] for k in sorted(rows)]))
    if not out:
        raise ValueError('В книге Excel нет листов')
    return out


def _num(v) -> float | None:
    if v is None:
        return None
    text = str(v).strip().replace('\xa0', '').replace(' ', '').replace(',', '.')
    if not re.match(r'^-?\d+(\.\d+)?$', text):
        return None
    return float(text)


def _unit_parts(v) -> list | None:
    """«кВт / В» → ['квт', 'в'], «см / кг  /   r (ü)» → ['см', 'кг', 'r (ü)']; не единица — None."""
    orig = re.sub(r'\s+', ' ', str(v).strip())
    low = orig.lower()
    if not low:
        return None
    if low in UNITS or low in CUR_WORDS:
        return [orig]
    unit_from, unit_to = (
        [x.strip().rstrip('.') for x in low.split('/')],
        [x.strip().rstrip('.') for x in orig.split('/')],
    )
    out, i = [], 0
    while i < len(unit_from):
        if i + 1 < len(unit_from) and unit_from[i] + '/' + unit_from[i + 1] in UNITS:
            out.append(unit_to[i] + '/' + unit_to[i + 1])
            i += 2
        elif unit_from[i] in UNITS or unit_from[i] in CUR_WORDS:
            out.append(unit_to[i])
            i += 1
        else:
            return None
    return out


def _is_unit(v) -> bool:
    return _unit_parts(v) is not None


PRICE_HEAD = re.compile(r'^(отпускная |рекомендованная )?(стоимость|цена|ррц)', re.I)
OPT_HEAD = re.compile(
    r'опци|(?<![а-яё])пуск|(?<![а-яё])охл|рекуперац|grease|смазк|^колес|^шасси|^нагревател|^доохладител|^сменн|комплект фильтров|^цена фильтр',
    re.I,
)


def _price_cols(head) -> dict:
    """Столбцы прайса по текстам шапки: артикул, название, цены по исполнениям, опции, характеристики."""
    cols: dict[str, Any] = {
        'sku': None,
        'name': None,
        'short': None,
        'price': None,
        'prices': [],
        'dealer': None,
        'disc': None,
        'opts': [],
        'specs': [],
        'pcols': [],
    }
    for col in sorted(head):
        head_text = re.sub(r'\s+', ' ', head[col]).strip()
        text_low = head_text.lower()
        if not head_text or JUNK.match(head_text):
            continue
        if re.match(r'^(артикул|код sap|код)$', text_low) and cols['sku'] is None:
            cols['sku'] = col
        elif ('печатн' in text_low or re.match(r'^номе?н?клатура', text_low)) and cols['short'] is None:
            cols['short'] = col
        elif re.match(r'^(модель|название|наименование)', text_low) and cols['name'] is None:
            cols['name'] = col
        elif re.search(r'дилер', text_low) and re.search(r'скидк', text_low):
            cols['disc'] = col
        elif (PRICE_HEAD.match(text_low) or re.match(r'^цена', text_low)) and re.search(r'дилер', text_low):
            cols['dealer'] = col
        elif (
            PRICE_HEAD.match(text_low) or (re.search(r'\b(цена|стоимость)\b', text_low) and not cols['prices'])
        ) and not OPT_HEAD.search(text_low):
            cols['prices'].append((col, _price_qual(head_text)))
        elif PRICE_HEAD.match(text_low) or OPT_HEAD.search(text_low) or re.search(r'\b(цена|стоимость)\b', text_low):
            label = (
                re.sub(r'^(стоимость|цена)( опции)?\s*[-–—:]?\s*', '', head_text, flags=re.I).strip(' -') or head_text
            )
            label = re.sub(
                r'^фильтров с ндс.*', 'Рекомендованные фильтры', label, flags=re.I
            )  # «Цена фильтров с НДС, €»
            cols['opts'].append((col, label))
        elif re.search(r'производ|расход|подача', text_low) and (
            bar_match := re.search(r'(\d+(?:[.,]\d+)?)\s*бар\s*$', text_low)
        ):
            cols['pcols'].append((col, bar_match.group(1).replace(',', '.')))
        else:
            cols['specs'].append((col, head_text))
    if cols['prices']:
        cols['price'] = cols['prices'][0][0]
        if len(cols['prices']) == 1 or len({qual for _, qual in cols['prices']}) < len(cols['prices']):
            cols['prices'] = [(cols['price'], '')]
    elif cols['dealer'] is not None:  # только дилерская цена (Tewatt: «Цена для дилера DDP Москва»)
        cols['prices'] = [(None, '')]
    if len(cols['pcols']) < PRESSURE_COLS_MIN:  # одна «… 8 бар» — обычная характеристика
        cols['specs'] += [(col, head[col]) for col, _ in cols['pcols']]
        cols['pcols'] = []
    return cols


def _price_qual(text) -> str:
    """«Цена с НДС (ZONCN) (IP23)» → «ZONCN IP23»; «Цена (розница) с НДС, €» → «» (розница — основная цена)."""
    qual = ' '.join(re.findall(r'\(([^()]{1,30})\)', text))
    qual = re.sub(r'(?i)\b(с ндс|без ндс|руб\.?|евро|eur|usd|розница|розничная|ррц|€|\$|₽)\b|[€$₽]', ' ', qual)
    return re.sub(r'\s+', ' ', qual).strip(' ,/')


def _opt_name(text) -> str:
    return re.sub(r'\s*\((?:cold start|soft start|w|heat recovery|fs|fgo)\)\s*$', '', text, flags=re.I).strip()[:60]


def parse_price(data) -> tuple:
    """XLSX прайса → (строки с ценами, опциями и характеристиками, валюта, столбцы)."""
    book = read_xlsx(data)
    if TideBook.applies(book):  # прайс-склад Tide Power: исполнения блоками, «НОВЫЕ ЦЕНЫ», брони
        rows, found = TideBook.price_rows(book)
        if rows:
            return rows, found
    if GensetBook.applies(book):  # прайс-склад ДГУ (HERTZ): листы машин и моделей — по шапкам
        rows, found = GensetBook.price_rows(book)
        if rows:
            return rows, found
    out: list = []
    sheets = []
    for sname, rows in book:
        hrs = [i for i, row in enumerate(rows) if any(str(v).strip() in HEAD_WORDS for v in row.values())]
        if not hrs:
            continue
        title = ''
        for row in rows[:3]:
            v = str(row.get(0, '')).strip()
            if len(v) > TITLE_MIN and not JUNK.match(v):
                title = re.sub(r'\s+', ' ', v)[:100]
                break
        tops = [i for k, i in enumerate(hrs) if k == 0 or i - hrs[k - 1] > HEAD_GAP]  # строки шапки подряд — одна шапка
        start_len, cur0, items, prev = len(out), '', [], None
        for k, head_row in enumerate(tops):
            end = tops[k + 1] if k + 1 < len(tops) else len(rows)
            got, cur, prev = _price_block(
                rows, head_row, end, max(0, head_row - 3) if k == 0 else head_row, sname, title, prev
            )
            items.extend(got)
            cur0 = cur0 or cur
        out.extend(items)
        if items:
            sheets.append(
                {
                    'name': sname,
                    'rows': len(out) - start_len,
                    'withPrice': sum(1 for x in items if x['price']),
                    'cur': cur0,
                }
            )
    if not out:
        raise ValueError('В прайсе не нашлось листов с шапкой «Артикул / Модель / Стоимость»')
    return out, sheets


SALE_RX = re.compile(r'распродаж|акци[яи]\b|уценк', re.I)
NOTE_ROW = re.compile(r'^([-*rü]\s|\*)')  # сноски под таблицей: «r - стоимость упаковки…», «* Расход абразива…»


def _price_block(rows, head_row, end, low, sname, title, prev=None) -> tuple:
    """Одна таблица листа: шапка в строке hr, данные до end. Шапка без столбца названия — столбцы прошлой таблицы (prev)."""
    unit_row = next(
        (
            i
            for i in range(head_row, min(head_row + 5, end))
            if sum(1 for v in rows[i].values() if _is_unit(v)) >= UNITS_ROW_MIN
        ),
        None,
    )
    high = unit_row if unit_row is not None else head_row + 1
    ncol = next((col for col, v in rows[head_row].items() if str(v).strip() in HEAD_WORDS), None)
    while (
        unit_row is None
        and high < end
        and ncol is not None
        and str(rows[high].get(ncol, '')).strip() == str(rows[head_row][ncol]).strip()
        and any(re.fullmatch(r'\d+(?:[.,]\d+)?\s*бар', str(v).strip()) for v in rows[high].values())
    ):
        high += 1  # шапка из двух строк: «Производительность» над «6 бар / 8 бар / 10 бар»
    head: dict = {}
    for i in range(low, high):
        vals: Any = {col: re.sub(r'\s+', ' ', str(v)).strip() for col, v in rows[i].items()}
        if i < head_row and len(set(vals.values()) - {''}) <= 1:
            continue  # подзаголовок таблицы над шапкой («Модернизированные винтовые компрессоры…»)
        wide = {
            v for v in vals.values() if list(vals.values()).count(v) >= (3 if i < head_row else 5)
        }  # название листа и завода — объединены
        for col, v in vals.items():
            if i < head_row and (
                _num(v) is not None or re.match(r'^\(?лист\b', v, re.I)
            ):  # номер листа и дата над шапкой
                continue
            # объединённые ячейки повторяют текст в каждой строке и столбце — название листа и повторы шапки не нужны
            if (
                v
                and v not in wide
                and not JUNK.match(v)
                and not (_is_unit(v) and v not in HEAD_WORDS)
                and not head.get(col, '').endswith(v)
            ):
                head[col] = (head.get(col, '') + ' ' + v).strip()
    units = rows[unit_row] if unit_row is not None else {}
    for col, u in units.items():  # столбец с единицей, но без подписи (шапка объединена криво) — подпись по единице
        if col not in head and str(u).strip().lower() in UNIT_LABEL:
            head[col] = UNIT_LABEL[str(u).strip().lower()]
    cols = _price_cols(head)
    if cols['name'] is None and prev:
        cols, units = prev
    if cols['name'] is None:
        return [], '', prev
    cur = ''
    price_col = cols['price'] if cols['price'] is not None else cols['dealer']
    if price_col is not None:
        cur = CUR_WORDS.get(str(units.get(price_col, '')).strip().lower(), '')
        if not cur:
            cur_match = re.search(r'(?<![а-яa-z])(евро|eur|руб|usd|\$|€|₽)', head.get(price_col, ''), re.I)
            cur = CUR_WORDS.get(cur_match.group(1).lower(), '') if cur_match else ''
    group = ''
    if head_row > 0:  # подзаголовок таблицы над шапкой
        subtitles = {str(x).strip() for x in rows[head_row - 1].values()} - {''}
        if len(subtitles) == 1 and len(rows[head_row - 1]) >= TABLE_COLS_MIN:
            group = _group_name(subtitles.pop())
    items = []
    for i in range((unit_row if unit_row is not None else head_row) + 1, end):
        row = rows[i]
        vals = {str(v).strip() for v in row.values()} - {''}
        if (
            len(vals) <= SECTION_VALS_MAX and len(row) >= TABLE_COLS_MIN
        ):  # строка-раздел на всю ширину («Воздушные вертикальные ресиверы…») или сноска
            v = sorted(vals)[0]
            if not NOTE_ROW.match(v) and not re.search(r'упаковк', v, re.I):
                group = _group_name(v)
            continue
        name = re.sub(r'\s+', ' ', str(row.get(cols['name'], ''))).strip().rstrip('*').strip()
        if (
            not name
            or len(name) < NAME_MIN
            or name in HEAD_WORDS
            or JUNK.match(name)
            or NOTE_ROW.match(name)
            or re.match(r'^цены ', name, re.I)
        ):
            continue
        if re.match(r'^(рабочее|максимальн\S*|поправочн\S*|тип|степень|для|итого|примечани\S*)\b', name, re.I):
            continue  # таблица поправочных коэффициентов и примечания под прайсом
        opts = []
        for col, label in cols['opts']:
            v = _num(row.get(col))
            if v:
                opts.append((_opt_name(label), round(v, 2)))
        specs = []
        for col, label in cols['specs']:
            v = str(row.get(col, '')).strip()
            if not v or v in ('-', '—', '–', 'r', 'ü') or re.match(r'^(модель|номе?н?клатура)$', label, re.I):
                continue
            u = str(units.get(col, '')).strip()
            if u.lower().rstrip('.') in ('модель', 'тип', 'r', 'марка', 'материал', 'g') or u.lower() in CUR_WORDS:
                u = ''
            lbl = label
            if re.fullmatch(r'(макс|мин)\.?', u, re.I):  # «Давление, Бар» над столбцами «Макс.» и «Мин.»
                lbl, u = f'{u} {label[:1].lower() + label[1:]}', ''
            for spec in _spec_split(lbl, v, u):
                if spec not in specs:  # объединённые ячейки шапки дают повторы столбцов
                    specs.append(spec)
        sku = str(row.get(cols['sku'], '')).strip() if cols['sku'] is not None else ''
        if sku in ('-', '—'):
            sku = ''
        short = re.sub(r'\s+', ' ', str(row.get(cols['short'], ''))).strip()[:120] if cols['short'] is not None else ''
        dealer = _num(row.get(cols['dealer'])) if cols['dealer'] is not None else None
        disc = _num(row.get(cols['disc'])) if cols['disc'] is not None else None
        disc = disc * 100 if disc is not None and 0 < disc < 1 else disc  # «0.25» в ячейке с форматом «%»
        variants, names = [], _expand_names(name)
        for col, qual in cols['prices'] or [(None, '')]:
            price = _num(row.get(col)) if col is not None else None
            if (
                price is None and col is not None and len(cols['prices']) == 1
            ):  # цена группы в соседней строке без названия
                for j in (i - 1, i + 1, i + 2):
                    if 0 <= j < len(rows) and not str(rows[j].get(cols['name'], '')).strip():
                        price = _num(rows[j].get(col))
                        if price is not None:
                            break
            if price is None and len(cols['prices']) > 1:
                continue  # исполнения нет («−» в столбце IP23)
            variants += [(f'{nm_item} {qual}' if qual else nm_item, price) for nm_item in names]
        for vname, price in variants:
            for pair, flow in [(pair, str(row.get(col, '')).strip()) for col, pair in cols['pcols']] or [(None, '')]:
                if pair is not None and (not flow or flow in ('-', '−', '—', '–')):
                    continue  # при этом давлении модели нет
                spec = list(specs)
                vname2 = vname
                if pair is not None:  # «EXO 5,5/*A AQ» → «EXO 5,5/8A AQ»; «F-Drive 6» → «F-Drive 6-8»
                    pressure = pair.rstrip('0').rstrip('.') if '.' in pair else pair
                    vname2 = vname.replace('*', pressure) if '*' in vname else f'{vname}-{pressure}'
                    spec = [
                        ('Давление', '{} бар'.format(pressure.replace('.', ','))),
                        *spec,
                        ('Производительность', _spec_val(flow, 'м³/мин')),
                    ]
                items.append(
                    {
                        'sku': sku[:40],
                        'name': vname2[:300],
                        'short': '' if _num(short) is not None else short,
                        'pbar': pair,
                        'price': round(price, 2) if price else None,
                        'cur': cur,
                        'opts': opts,
                        'specs': spec,
                        'sheet': sname,
                        'title': title,
                        'group': group,
                        'sale': bool(SALE_RX.search(sname + ' ' + group)),
                        'dealer': round(dealer, 2) if dealer else None,
                        'disc': disc if disc and 0 < disc < PERCENT_MAX else None,
                    }
                )
    if (
        cur == 'RUB'
        and items
        and re.search(r'ррц', head.get(price_col, ''), re.I)
        and all((x['price'] or 0) < EURO_PRICES_BELOW for x in items)
    ):
        cur = 'EUR'  # «РРЦ Москва с НДС (руб)» у дизелей Liutech — цены 17 710…94 710: это евро, не рубли
        for x in items:
            x['cur'], x['curGuess'] = 'EUR', True
    return items, cur, (cols, units)


def _expand_names(name) -> list:
    """«FС/FT/FA/FH 12» (одна строка на четыре фильтра) → «FC 12», «FT 12», «FA 12», «FH 12»."""
    match = re.match(r'^([A-ZА-ЯЁ]{1,4}(?:/[A-ZА-ЯЁ]{1,4})+)\s+(\S.*)$', name)
    if not match:
        return [name]
    return [f'{x.translate(LAT_CYR)} {match.group(2)}' for x in match.group(1).split('/')]


def _group_name(v) -> str:
    v = re.split(r'[\r\n]', str(v).strip())[0]
    return re.split(r'(?<=[а-яА-Я])\s+для\s|[.,(]', re.sub(r'\s+', ' ', v))[0].strip()[:80]


UNIT_LABEL = {
    'бар': 'Макс. давление',
    'квт': 'Мощность',
    'кг': 'Масса',
    'дб': 'Уровень шума',
    'м³/мин': 'Производительность',
    'м3/мин': 'Производительность',
    'л/мин': 'Производительность',
    'м³/ч': 'Производительность',
    'м3/час': 'Производительность',
    'лит': 'Объём ресивера',
    'л': 'Объём ресивера',
}
SPEC_UNITS = {
    'лит': 'л',
    'м3/мин': 'м³/мин',
    'м3/час': 'м³/ч',
    'м3/ч': 'м³/ч',
    'кВт.': 'кВт',
    'кВт/ч': 'кВт',
    'дБ(А)': 'дБ',
    'мбар': 'мбар',
    '(л)': 'л',
    '(кг)': 'кг',
}


def _spec_split(label, v, u) -> list:
    """Составной столбец: «Габариты / Масса / Упаковка» «81 х 41 х 64 / 65» «см / кг / r (ü)» → [(Габариты, 81×41×64 см), (Масса, 65 кг)]."""
    units = _unit_parts(u) if u else None
    values = [x.strip() for x in re.split(r'\s+/\s+', v)]
    labels = [x.strip() for x in label.split(' / ')]
    if units and len(units) > 1 and len(values) > 1:
        if len(labels) >= len(values):
            return [
                (labels[k][:60], _spec_val(values[k], units[k] if k < len(units) else '')) for k in range(len(values))
            ]
        if len(labels) == 1 and len(values) == len(units):
            return [(label[:60], ' / '.join(_spec_val(values[k], units[k]) for k in range(len(values))))]
    return [(label[:60], _spec_val(re.sub(r'\s+', ' ', v), units[0] if units else u))]


def _spec_val(v, u) -> str:
    u = SPEC_UNITS.get(str(u).strip(), str(u).strip())
    v = str(v).strip()
    num = _num(v)
    if num is not None:
        v = (f'{num}') if float(num).is_integer() else (f'{num:.3f}').rstrip('0').rstrip('.').replace('.', ',')
    v = v.replace('x', '×').replace('х', '×') if re.match(r'^\d+\s*[xх×]\s*\d+', v) else v
    return (f'{v} {u}') if u and re.match(r'^[-+]?\d', v) and not re.search(r'["\'“”]|^\d+/\d+$|^DN', v) else v


JUNK_SENT = re.compile(
    r'\bваш(е|ем|у|им|их|а|и)?\b|\bвам\b|верный способ|обратитесь|звоните|позвоните|менеджер|оставьте заявку|заказать|купить|'
    r'\bцен[аыу]\b|доставк|примерн|индивидуально|согласно проекту|официальн\S* (дилер|представител|поставщик)|'
    r'в наличии|со склада|гарантия качества|лучшее решение|не имеет аналогов|по выгодн|скидк|акци[яи]\b|\bоплат|\bфишк',
    re.I,
)
HEAD_RX = re.compile(
    r'\s*(технические особенности|главное о серии|общие характеристики|основные характеристики|основные преимущества|особенности|преимущества|опции|комплектация|применение|области применения)([^:\n•]{0,50}):\s*',
    re.I,
)


LIST_HEAD_RX = re.compile(
    r'(Общие характеристики|Основные характеристики|Основные преимущества)\s+([^.:\n•►]{20,}?)(?=\s*(?:$|\n|\.\s|Технические особенности|Опции))'
)


def _list_items(match) -> str:
    """Склеенный перечень пунктов («Общие характеристики Блок … Система …») — списком."""
    items = [x.strip(' ,;') for x in re.split(r'\s+(?=[А-ЯЁ][а-яё])(?<![«/]\s)', match.group(2)) if x.strip(' ,;')]
    if len(items) < LIST_ITEMS_MIN:
        return match.group(0)
    return '\n' + match.group(1) + ':\n' + '\n'.join('• ' + x for x in items) + '\n'


BLOCK_LABELS = {
    'Назначение',
    'Конструкция и принцип работы',
    'Диапазон серии',
    'Исполнения',
    'Особенности',
    'Технические особенности',
    'Главное о серии',
    'Общие характеристики',
    'Преимущества',
    'Опции',
    'Комплектация',
    'Применение',
    'Описание',
    'Устройство',
    'Исполнения и опции',
}
# схема блоков карточки: «Назначение», «Устройство», «Преимущества», «Исполнения и опции», «Комплектация»; заголовки страниц
# поставщиков сводятся к ней, одноимённые блоки объединяются
BLOCK_MAP = {
    'Конструкция и принцип работы': 'Устройство',
    'Технические особенности': 'Преимущества',
    'Общие характеристики': 'Преимущества',
    'Главное о серии': 'Преимущества',
    'Особенности': 'Преимущества',
    'Опции': 'Исполнения и опции',
    'Исполнения': 'Исполнения и опции',
    'Диапазон серии': 'Исполнения и опции',
    'Применение': 'Назначение',
}
BLOCK_ORDER = ['Назначение', 'Устройство', 'Преимущества', 'Исполнения и опции', 'Комплектация']


def clean_desc(text) -> str:
    """Описание со страницы → текст без «воды»: вводный абзац, подзаголовки, список «• …»; повторы и рекламные фразы убраны."""
    desc_text = html_mod.unescape(str(text or '')).replace('\xa0', ' ')
    desc_text = LIST_HEAD_RX.sub(_list_items, desc_text)
    desc_text = re.sub(r'["«»]{2,}|\s*"\s*;|\s*"(?=\s|$)|(?<=\s)"\s*', ' ', desc_text)  # сломанные кавычки из CSV
    desc_text = re.sub(r'\s*[►▪■●♦➢➤✓]\s*(?=[А-ЯA-Zа-я0-9])|\s+-\s+(?=[А-Я])', '\n• ', desc_text)
    keep: dict = {}  # заголовки блоков отдельной строкой («Исполнения и опции:») — не разбирать на подзаголовки
    for lab in sorted(BLOCK_LABELS, key=len, reverse=True):
        tok = f'\x00{len(keep)}\x00'
        cleaned = re.sub(r'(?m)^\s*' + re.escape(lab) + r':\s*$', tok, desc_text)
        if cleaned != desc_text:
            keep[tok], desc_text = lab + ':', cleaned
    desc_text = HEAD_RX.sub(lambda match: '\n' + match.group(1).strip().capitalize() + ':\n', desc_text)
    for tok, lab in keep.items():
        desc_text = desc_text.replace(tok, '\n' + lab + '\n')
    desc_text = desc_text.replace('С°', '°C').replace('C°', '°C').replace('м3/', 'м³/').replace('м3 /', 'м³/')
    out, seen = [], set()
    for raw_line in desc_text.split('\n'):
        line = re.sub(r'\s+', ' ', raw_line).strip()
        if not line:
            continue
        if line.startswith('• ') or line.endswith(':'):
            parts = [line]
        else:
            parts = [x.strip() for x in re.split(r'(?<=[.!?;])\s+(?=[А-ЯA-Z0-9«])', line) if x.strip()]
        for sent in parts:
            body = sent[2:] if sent.startswith('• ') else sent
            body = body.strip(' ;"').rstrip('.;') + ('' if sent.endswith(':') else '.')
            key = re.sub(r'[^а-яa-z0-9]', '', body.lower())
            if (len(key) < SENT_KEY_MIN and not sent.endswith(':')) or key in seen:
                continue
            if JUNK_SENT.search(body) and not sent.endswith(':'):
                continue
            seen.add(key)
            out.append(('• ' + body) if sent.startswith('• ') else (sent if sent.endswith(':') else body))
    # подзаголовок без пунктов после него не нужен (кроме заголовков блоков карточки: «Назначение:» и т. п. — перед абзацем)
    res = []
    for i, x in enumerate(out):
        nxt = out[i + 1] if i + 1 < len(out) else ''
        if (
            x.endswith(':')
            and not nxt.startswith('• ')
            and not (x[:-1] in BLOCK_LABELS and nxt and not nxt.endswith(':'))
        ):
            continue
        res.append(x)
    return '\n'.join(res)[:4000].strip()


HEAD_LABEL = {
    'технические особенности': 'Технические особенности',
    'главное о серии': 'Главное о серии',
    'особенности': 'Особенности',
    'общие характеристики': 'Общие характеристики',
    'основные характеристики': 'Общие характеристики',
    'основные преимущества': 'Преимущества',
    'преимущества': 'Преимущества',
    'опции': 'Опции',
    'комплектация': 'Комплектация',
    'применение': 'Применение',
    'области применения': 'Применение',
}
PURPOSE_RX = re.compile(
    r'предназначен|применя(ет|ют)ся|использу(ет|ют)ся|решает|для предприятий|подходит для|отрасл|задач', re.I
)
DESIGN_RX = re.compile(
    r'принцип|конструкц|состоит|состав|оборудован|оснащ|установлен|теплообменник|контроллер|двигател|блок|корпус|кожух|'
    r'панел|клапан|фильтр|систем|привод|ресивер|сенсорн|экран|датчик|колонн|адсорбент|сито|сечени|ремен|подшипник|ротор|'
    r'сепаратор|шкаф|отсек|насос|охлажден|цилиндр',
    re.I,
)
PARAM_RX = re.compile(
    r'^(производительность|давление|избыточное давление|рабочее давление|вакуум|разрежение|мощность|расход|напряжение|'
    r'точка росы|объ[её]м|чистота|уровень шума)\b[^.]{0,70}\.?$',
    re.I,
)
VARIANT_RX = re.compile(r'исполнени', re.I)
BLOCK_LIMIT = 12


def _sents(text) -> list:
    return [x.strip() for x in re.split(r'(?<=[.!?])\s+(?=[А-ЯA-Z0-9«(])', text) if x.strip()]


def _intro_blocks(prose, bullets) -> list:
    """Вводный текст без подзаголовков: назначение → конструкция и принцип работы → диапазон серии → исполнения/особенности."""
    buckets: dict[str, list[str]] = {'Назначение': [], 'Конструкция и принцип работы': [], 'Диапазон серии': []}
    cur = 'Назначение'
    sents = [sent for line in prose for sent in _sents(line)]
    for i, sent in enumerate(sents):
        if PARAM_RX.match(sent):
            buckets['Диапазон серии'].append(sent)
            continue
        if cur == 'Назначение' and i > 0 and not PURPOSE_RX.search(sent) and DESIGN_RX.search(sent):
            cur = 'Конструкция и принцип работы'
        buckets[cur].append(sent)
    out = [(lab, ' '.join(v)) for lab, v in buckets.items() if v and lab != 'Диапазон серии']
    if buckets['Диапазон серии']:
        out.append(('Диапазон серии', '\n'.join('• ' + sent for sent in buckets['Диапазон серии'])))
    if bullets:
        lab = (
            'Исполнения'
            if sum(1 for bullet in bullets if VARIANT_RX.search(bullet)) * 2 >= len(bullets)
            else 'Особенности'
        )
        out.append((lab, '\n'.join(bullets)))
    return out


def desc_blocks(text) -> list:
    """Очищенное описание → блоки карточки [(заголовок, текст)] по схеме BLOCK_LABELS."""
    text = str(text or '').strip()
    if not text:
        return []
    sections: list[dict[str, Any]] = []
    cur: dict[str, Any] = {'label': '', 'prose': [], 'bullets': []}
    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        if line.endswith(':') and not line.startswith('• ') and len(line) <= HEADING_MAX:
            if cur['prose'] or cur['bullets']:
                sections.append(cur)
            key = line[:-1].strip().lower()
            cur = {
                'label': HEAD_LABEL.get(key) or (line[:-1].strip()[:1].upper() + line[:-1].strip()[1:]),
                'prose': [],
                'bullets': [],
            }
            continue
        (cur['bullets'] if line.startswith('• ') else cur['prose']).append(line)
    if cur['prose'] or cur['bullets']:
        sections.append(cur)
    out = []
    for sec in sections:
        if not sec['label']:
            out.extend(_intro_blocks(sec['prose'], sec['bullets']))
        elif sec['label'] in ('Модельный ряд', 'Диапазон серии') and not sec['bullets']:
            out.append(('Исполнения и опции', '\n'.join('• ' + x for x in sec['prose'])))
        else:
            out.append((sec['label'], '\n'.join(([' '.join(sec['prose'])] if sec['prose'] else []) + sec['bullets'])))
    out = [(lab, block_text) for lab, block_text in out if block_text.strip()]
    if len(out) == 1 and sections and not sections[0]['label']:
        return [('Описание', out[0][1])]
    merged = {}
    for raw_lab, block_text in out:  # к схеме блоков; одинаковые пункты не повторяются
        lab = BLOCK_MAP.get(raw_lab, raw_lab)
        if lab not in merged:
            merged[lab] = block_text
            continue
        have = set(merged[lab].split('\n'))
        add = [x for x in block_text.split('\n') if x not in have]
        if add:
            merged[lab] += ('\n' if merged[lab] else '') + '\n'.join(add)
    order = {k: i for i, k in enumerate(BLOCK_ORDER)}
    return sorted(merged.items(), key=lambda pair: order.get(pair[0], len(order)))[:BLOCK_LIMIT]


SPEC_CLASS = [
    ('pressure_min', r'^мин\S*\s+давлен'),
    ('pressure_in', r'давлен\S*\s+на входе'),
    ('vacuum', r'разряжени|вакуум'),
    ('relay', r'реле\s+давлени'),
    ('pressure', r'давлен'),
    ('flow_out', r'по\s+нагнетани|привед'),
    ('flow_clean', r'по\s+очистке'),
    ('flow_rpm', r'при\s+оборотах'),
    ('flow', r'производительн|пропускн\S*\s+способн'),
    ('power', r'мощност'),
    ('dims', r'габарит'),
    ('length', r'^(длина|глубина)'),
    ('width', r'^ширина'),
    ('height', r'^высота'),
    ('mass_ads', r'масс\S*\s+адсорбент'),
    ('mass', r'^(масса|вес|общий вес)'),
    ('noise', r'шум'),
    ('outlet', r'выход\S*,?\s+сжатого|^соединение$|^присоединительн|соединение по воздуху'),
    ('receiver', r'ресивер|^объ[её]м$'),
    ('dryer', r'встроенн\S*\s+осушител|модель осушителя'),
    ('filters', r'встроенн\S*\s+фильтр|тип фильтров|фильтры в составе'),
    ('voltage', r'напряжени'),
    ('refrigerant', r'^(?!.*компрессор).*хлад(о|а)гент'),
    ('controller', r'контроллер'),
    ('cartridge', r'картридж|катридж'),
    ('purity', r'чистот'),
    ('country', r'страна'),
    ('ip', r'степень защиты'),
    ('rpm', r'скорост\S*\s+вращени'),
]
SPEC_LABEL = {
    'pressure_min': 'Минимальное давление',
    'pressure_in': 'Давление на входе',
    'vacuum': 'Максимальное разрежение',
    'pressure': 'Давление',
    'flow': 'Производительность',
    'power': 'Мощность',
    'dims': 'Габариты (Д × Ш × В)',
    'mass': 'Масса',
    'mass_ads': 'Масса адсорбента',
    'noise': 'Уровень шума',
    'outlet': 'Выход сжатого воздуха',
    'receiver': 'Объём ресивера',
    'dryer': 'Встроенный осушитель',
    'filters': 'Встроенные фильтры',
    'voltage': 'Напряжение',
    'refrigerant': 'Хладагент',
    'controller': 'Контроллер',
    'cartridge': 'Картридж',
    'purity': 'Чистота',
    'rpm': 'Скорость вращения',
}
SPEC_DROP = re.compile(
    r'^(аналог|примечание|все характеристики|new price|количество комментариев|тема форума|похожие товары)', re.I
)
# единица в названии характеристики («Давление, атм.», «Габариты, см») — переносится в значение
KEY_UNIT = re.compile(
    r'^(.*?\S)\s*,\s*(атм\.?|бар|л\.?|л/мин\.?|квт(?:/в)?|см|мм|кг\.?|дба|дб\(а\)|°\s?[cс]|град,?\s*°?[cс]|г/час|лет|'
    r'м³/мин|м3/мин|мг/м³|мг/м3|мкм|м²/ч|м2/ч|м|час|дюйм)$',
    re.I,
)
UNIT_FIX = {
    'атм.': 'атм',
    'л.': 'л',
    'л/мин.': 'л/мин',
    'кг.': 'кг',
    'дба': 'дБ(А)',
    'квт': 'кВт',
    'м3/мин': 'м³/мин',
    'мг/м3': 'мг/м³',
    'м2/ч': 'м²/ч',
}
# подписи прайса и сайта АСО → одна подпись для одинаковых характеристик
SPEC_RENAME = [
    (r'^(макс\.?\s*раб(\.|очее)?\s*давл(\.|ение)?|макс\.?\s*давление|рабочее давление|давление)$', 'Давление'),
    (r'^мин\.?\s*давление$', 'Минимальное давление'),
    (r'^(произв\.?|производит\.?)$', 'Производительность'),
    (
        r'^(произв\.?\s*привед\.?\s*к\s*н\.?\s*услов\.?|произв\.?\s*по\s*нагнетанию)$',
        'Производительность по нагнетанию',
    ),
    (r'^произв\.?\s*при оборотах$', 'Производительность при оборотах'),
    (r'^произв(\.|одительность)?\s*по очистке( поверхности)?$', 'Производительность по очистке'),
    (r'^(объем ресивера|ресивер)$', 'Объём ресивера'),
    (r'^объем$', 'Объём'),
    (r'^объем камеры$', 'Объём камеры'),
    (r'^(вход\s*/\s*выход|выход)$', 'Вход/выход'),
    (r'^(сталь|марка стали)$', 'Марка стали'),
    (r'^расход абразива на 1\s*м[2²]\*?$', 'Расход абразива на 1 м²'),
    (r'^рекоменд\.?\s*рабочее давление$', 'Рабочее давление'),
]
POWER_KEY = re.compile(r'^(привод|эл\.?\s*питание|электропривод)$', re.I)


def _spec_rows(k, v) -> list:
    """Строка характеристики → строки каталога: единица — в значение, составные значения — по строкам."""
    k = re.sub(r'\s+', ' ', re.sub(r'^[PР](?=асход)', 'Р', str(k or '').strip()))
    k = re.sub(r'(?i)производит\s+ельн', 'Производительн', k)  # перенос внутри слова в шапке прайса
    v = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    k = re.sub(r'^C(?=тепень)', 'С', k)
    unit = ''
    match = KEY_UNIT.match(k) or re.match(r'^(.*?\S)\s+(мг/м3|мг/м³|мкм)$', k)  # «Степень очистки по воде мг/м3»
    if match:
        k, unit = match.group(1), match.group(2)
    match = re.match(
        r'^(наружное покрытие),\s*(.+)$', k, re.I
    )  # «Наружное покрытие, полиэфирная порошковая краска: RAL 5010»
    if match:
        k, v = match.group(1), f'{match.group(2)} {v}'
    unit = re.sub(r'^град,?\s*°?[cс]$|^°\s?[cс]$', '°C', unit, flags=re.I)
    unit = UNIT_FIX.get(unit.lower(), unit)
    v = re.sub(r'(?<=\d)\s*град,?\s*°?[CС]$|(?<=\d)\s*°\s?С$', ' °C', v)
    for regex, label in SPEC_RENAME:
        if re.match(regex, k, re.I):
            k = label
            break
    if POWER_KEY.match(k):
        main = 'Мощность' if re.match(r'^эл', k, re.I) else 'Мощность двигателя'
        if not re.match(r'^\d', v):
            return [('Двигатель', v)] if v else []
        parts = [x.strip() for x in re.split(r'\s*/\s*', v) if x.strip()]
        out = []
        for i, x in enumerate(parts[:2]):
            num_text = re.sub(r'\s*(кВт|В)$', '', x, flags=re.I).replace('.', ',')
            num_text = re.sub(r'\s*[*×xх]\s*', ' × ', num_text)  # «2*75» — два двигателя
            match = re.match(r'^([\d ×,]+?)\s*(\(.*\))$', num_text)  # «11(S=1,15)» → «11 кВт (S=1,15)»
            u = 'В' if i == 1 else 'кВт'
            out.append(
                (
                    'Напряжение' if i == 1 else main,
                    f'{match.group(1)} {u} {match.group(2)}' if match else f'{num_text} {u}',
                )
            )
        return [_spec_fix(first, second) for first, second in out]
    v = re.sub(r'^(\d+)\.(\d+)$', r'\1,\2', v)
    if (
        unit
        and re.match(r'^([-+−≤<]?\s*\d|до\b|от\b|не более|не менее)', v, re.I)
        and not re.search(r'[a-zа-я°³²"]\.?\s*$', v, re.I)
    ):
        v = f'{v} {unit}'
    if unit == 'кВт' and re.match(r'^\d+\s*[*×xх]\s*\d', v):
        v = re.sub(r'\s*[*×xх]\s*', ' × ', v)
    if spec_class(k) == 'dims':
        nums = re.findall(r'\d+(?:[.,]\d+)?', v)
        if re.search(r'см\s*$', v) or (unit == 'см' and nums):
            v = re.sub(r'\s*(см|мм)\s*$', '', v)
            vals = [float(x.replace(',', '.')) for x in nums]
            if vals and max(vals) < CM_VALUES_BELOW:  # «7515*2540*2495» с подписью «см» — это уже миллиметры
                v = ' × '.join((f'{x * 10:g}').replace('.', ',') for x in vals)
            else:
                v = re.sub(r'\s*[*×xхX]\s*', ' × ', v)
            v += ' мм'
    if re.match(r'^условия эксплуатации|температур', k, re.I) and re.search(r'\d$', v) and '°' not in v:
        v += ' °C'
    return [_spec_fix(k, v)]


_SPEC_SEEN: dict = {}  # подпись характеристики → класс: одни и те же подписи у тысяч позиций разбираются один раз


def spec_class(key) -> str:
    key = str(key or '')
    cached = _SPEC_SEEN.get(key)
    if cached is not None:
        return cached
    k = re.sub(r'\s*\([^)]*\)\s*$', '', key).strip().lower()
    k = re.sub(r'(?<=[а-я])-(?=[а-я])', '', k)  # «Производи-тельность» — перенос в ячейке прайса
    k = k.replace('производитсть', 'производительность')  # «Производит-сть» — сокращение в шапке прайса
    cached = next((cached for cached, regex in SPEC_CLASS if re.search(regex, k)), None) or 'k:' + re.sub(
        r'[^а-яa-z0-9]', '', k
    )
    if len(_SPEC_SEEN) < SPEC_SEEN_MAX:
        _SPEC_SEEN[key] = cached
    return cached


def _tidy_label(k) -> str:
    k = re.sub(r'\s+', ' ', str(k or '')).strip(' *:')
    k = re.sub(r'\*+$', '', k).strip()
    words = k.split(' ')
    if (
        len(words) == GLUED_WORDS and words[0].lower() == words[1].lower()
    ):  # «Ширина ширина» — склейка объединённых ячеек
        k = words[0]
    k = re.sub(r'\s*\((Д[/хx×]Ш[/хx×]В)\)|\s+Д[/хx×]Ш[/хx×]В$', '', k)
    k = (
        k.replace('Производи-тельность', 'Производительность')
        .replace('Производит-сть', 'Производительность')
        .replace('Присое-динение', 'Присоединение')
        .replace('приблизительно', '')
        .replace('Максиальное', 'Максимальное')
        .strip()
    )
    if re.fullmatch(r'[A-ZА-Я]', k):
        k = 'Размер ' + k
    return k[:60]


EMPTY_VALS = {'-', '—', '–', 'нет данных', 'n/a', 'нет', ''}


def _spec_fix(k, v) -> tuple:
    """Строка характеристики без прочерков, единицы — без скобок, подписи — как в каталоге."""
    k = re.sub(r'(?<=[а-я])-(?=[а-я])', '', str(k or '').strip())
    v = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    if v.lower() in EMPTY_VALS or re.match(r'^[а-яa-z]', k) or re.match(r'^артикул\s*\d', k, re.I):
        return k, ''  # «имеют температурный режим…», «Артикул 6006400004» — обрывки примечаний прайса
    match = re.match(r'^(?:размер\s+)?([A-HА-ЕНa-h])(?:\s*\(мм\))?$', k, re.I)
    if match:  # размеры на чертеже: «A (мм)», «Размер А» (кириллица) — одинаково
        lat = match.group(1).upper().translate(str.maketrans('АВСЕН', 'ABCEH'))
        k = f'Размер {lat}, мм'
        v = re.sub(r'\s*мм$', '', v)
    v = re.sub(r'\s*\((м³/мин|м3/мин|м³/ч|м3/ч|л/мин|нм3/час|нм³/ч|бар|л|кг|мм|кВт|дБ)\)', r' \1', v)
    for regex, replacement in (
        (r'(?<=\d)\s*bar\b', ' бар'),
        (r'(?<=\d)\s*m3/min\b', ' м³/мин'),
        (r'(?<=\d)\s*dB\s*\(A\)', ' дБ(А)'),
        (r'(?<=\d)\s*dB\b', ' дБ'),
        (r'^IP\s+(\d\d)$', r'IP\1'),
        (r'(?<=\d)\s*kW\b', ' кВт'),
        (r'(?<=\d)\s*V\b', ' В'),
        (r'(?<=\d)\s*Hz\b', ' Гц'),
        (r'\s*В/Гц$', ''),
        (r'\bБар\b', 'бар'),
        (r'(?<=\d)\s*(нм3|нм³)\s*/\s*час?\b', ' нм³/ч'),
        (r'(?<=\d)\s*м3\s*/\s*(мин|час|ч)\b', r' м³/\1'),
        (r'(?<=\d)м³', ' м³'),
        (r'м³/час\b', 'м³/ч'),
        (r"''|”|“", '"'),
        (r'(?<=\d)\s*литр\w*', ' л'),
        (r'Гц\s+В$', 'Гц'),
    ):
        v = re.sub(regex, replacement, v, flags=re.I)
    if re.match(r'^степень защиты', k, re.I) and re.match(r'^IE\d', v):
        k = 'Класс энергоэффективности'
    cls_name = spec_class(k)
    if cls_name == 'dims':  # «1940 X 950 X 2125 ДхШхВ мм» → «1940 × 950 × 2125 мм»
        v = re.sub(r'\(?\s*Д\s*[хx×]\s*Ш\s*[хx×]\s*В\s*\)?', ' ', v, flags=re.I)
        v = re.sub(r'(?<=\d)\s*[xхX×]\s*(?=\d)', ' × ', v).strip()
        v = re.sub(r'\s+', ' ', v)
        if re.search(r'\d$', v):
            v += ' мм'
    if cls_name == 'receiver' and re.fullmatch(r'\d+(?:\s*[×x]\s*\d+)?', v):
        v = re.sub(r'\s*[×x]\s*', ' × ', v) + ' л'
    if cls_name == 'flow' and re.fullmatch(r'\d+(?:[.,]\d+)?', v) and not re.search(r'\(', k):
        num = float(v.replace(',', '.'))
        v = (f'{v} л/мин') if num >= LPM_FROM else (f'{v} м³/мин')
    return k, v


def merge_specs(parse_rows, price_specs) -> list:
    """Характеристики: парс, затем прайс; одинаковые параметры — значение прайса (точнее)."""
    rows: list = []
    idx = {}
    for k, v in (row for pair in parse_rows for row in _spec_rows(*pair)):
        if SPEC_DROP.match(k) or not v:
            continue
        cls_name = spec_class(k)
        if cls_name in idx:
            continue
        idx[cls_name] = len(rows)
        rows.append([k, v])
    dims = {}
    for k, v in (row for pair in price_specs for row in _spec_rows(*pair)):
        if SPEC_DROP.match(k) or not v:
            continue
        cls_name = spec_class(k)
        if cls_name in ('length', 'width', 'height'):
            dims[cls_name] = (_tidy_label(k), v)
            continue
        label = SPEC_LABEL.get(cls_name) or _tidy_label(k)
        if cls_name in idx:
            if (
                not str(rows[idx[cls_name]][1]).lower().startswith(str(v).lower())
            ):  # «YNT55A (Baosi)» в парсе полнее «YNT55A» прайса
                rows[idx[cls_name]][1] = v  # прайс точнее парса
        else:
            idx[cls_name] = len(rows)
            rows.append([label, v])
    if len(dims) == DIMS_COUNT and all(re.search(r'^[\d.,\s]+(мм)?$', str(dims[cls_name][1])) for cls_name in dims):
        v = '{} × {} × {} мм'.format(
            *tuple(re.sub(r'\s*мм$', '', str(dims[cls_name][1])) for cls_name in ('length', 'width', 'height'))
        )
        if 'dims' in idx:
            rows[idx['dims']][1] = v
        else:
            rows.append([SPEC_LABEL['dims'], v])
    else:  # одна «Длина» (рукав 10 м) — это не габариты
        rows += [
            [dim_label, v]
            for cls_name, (dim_label, v) in dims.items()
            if cls_name not in idx and not ('dims' in idx and cls_name != 'length')
        ]  # «Высота H» фильтра — уже в габаритах
    return [(k, str(v)[:300]) for k, v in rows]


def _norm(text) -> str:
    text = (
        str(text or '')
        .lower()
        .replace('ё', 'е')
        .replace('х', 'x')
        .replace('–', '-')
        .replace('—', '-')
        .replace(',', '.')
    )
    text = re.sub(r'\s*\((?:compact|o)\)\s*$', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def name_key(text) -> str:
    """Название для сравнения: только буквы и цифры («DVK 30 (O)» → «dvk30»)."""
    return re.sub(r'[^a-z0-9а-я]', '', _norm(text))


def _model_key(text) -> str:
    """Код модели из названия: слова с цифрами и латиница заглавными («Осушитель DryAir DA 440» → «dryairda440»)."""
    words = [
        word
        for word in re.split(r'\s+', str(text or ''))
        if re.search(r'\d', word)
        or (len(word) > 1 and re.fullmatch(r'[A-Za-z][A-Za-z-]*', word) and word.upper() == word)
    ]
    return name_key(' '.join(words))


def _model_set(text) -> frozenset | None:
    """Те же слова модели, но как множество — порядок слов в прайсе и на сайте бывает разным («EAGLE-N VSD 132 7,5 BAR» и «EAGLE-N 132-7,5 VSD»)."""
    words: list = []
    for word_raw in re.split(r'[\s/]+', str(text or '').replace('–', '-').replace('—', '-')):
        word = word_raw.strip('(),;')
        if (
            not word
            or word.lower() in ('bar', 'бар')
            or not (re.search(r'\d', word) or re.fullmatch(r'[A-Z][A-Z-]*', word))
        ):
            continue
        words.extend(x.lower().replace(',', '.') for x in re.split(r'-(?=[A-Za-z\d])', word) if x)
    return frozenset(words) if len(words) >= SIG_MIN else None


def _char(page, regex) -> str:
    for k, v in page.get('chars') or []:
        if re.search(regex, k, re.I):
            text = str(v).strip()
            return '' if text in ('-', '—', '–', 'нет', 'Нет') else text
    return ''


def page_cfg(page) -> dict:
    """Исполнение позиции парса: по названию и характеристикам (давление, ресивер, осушитель) — как model_cfg у прайса."""
    cfg = model_cfg(page['name'], page['name'])
    pressure = _num_attr(re.sub(r'[^\d,.]', '', _char(page, r'^давление')).replace(',', '.') or None)
    if pressure:
        cfg['p'] = pressure
    recv = _char(page, r'объ[её]м ресивера')
    match2 = re.match(r'^\s*(\d+)\s*[xх×]\s*(\d+)', recv, re.I)  # «2 × 270» — два ресивера
    rec = int(match2.group(1)) * int(match2.group(2)) if match2 else _num_attr(re.sub(r'[^\d,.]', '', recv) or None)
    if rec and rec >= RECEIVER_MIN:
        cfg['rec'] = int(rec)
    if _char(page, r'модель осушителя') or re.search(r'\d+d$', (page.get('url') or '').rstrip('/'), re.I):
        cfg['dry'] = True
    return cfg


def lat_series(cfg) -> tuple:
    """Латинские серии исполнения (Dalgakiran: «DVK», «TIDY») — по ним сопоставляются позиции парса, прайса и каталога."""
    return tuple(
        sorted(ser for ser in cfg['ser'] if re.match(r'^[A-Z]', ser) and ser != 'R')
    )  # R — резьба «R1 1/2"», не серия


def _cfg_key(cfg) -> tuple:
    pressure = PRESSURE_ALIAS.get(cfg['p'], cfg['p'])  # в прайсе «7» и «7,5» — одно исполнение (на сайте — 7,5)
    return (lat_series(cfg), cfg['size'], pressure, cfg['rec'], cfg['dry'], cfg['vsd'], cfg['w'])


def cfg_compatible(cfg_a, cfg_b) -> bool:
    """Не противоречат ли исполнения: серия (латинские слова), типоразмер, частотник, водяное охлаждение. Без серии — не судим."""
    if not lat_series(cfg_a) or not lat_series(cfg_b) or cfg_a['size'] is None or cfg_b['size'] is None:
        return True
    if (
        lat_series(cfg_a) != lat_series(cfg_b)
        or cfg_a['size'] != cfg_b['size']
        or cfg_a['vsd'] != cfg_b['vsd']
        or cfg_a['w'] != cfg_b['w']
    ):
        return False
    key_a, key_b = _cfg_key(cfg_a), _cfg_key(cfg_b)
    if cfg_a['p'] and cfg_b['p'] and key_a[2] != key_b[2]:  # давление известно с обеих сторон — должно совпасть
        return False
    return cfg_a['rec'] == cfg_b['rec'] and cfg_a['dry'] == cfg_b['dry']


def unique_names(pages) -> list:
    """Одинаковые названия в парсе — уникальными по исполнению (давление, ресивер, D); копии — убираются."""
    groups: dict = {}
    out = []
    seen = set()
    for page_rec in pages:
        groups.setdefault(page_rec['name'], []).append(page_rec)
    for page in pages:
        page_rec = page
        same = groups[page_rec['name']]
        if len(same) > 1:
            cfg = page_cfg(page_rec)
            suf = ''
            if cfg['p']:
                suf += '-' + ('{:g}'.format(cfg['p'])).replace('.', ',')
            recv = _char(page_rec, r'объ[её]м ресивера')
            match2 = re.match(r'^\s*(\d+)\s*[xх×]\s*(\d+)', recv, re.I)
            if match2:
                suf += f'-{match2.group(1)}×{match2.group(2)}'
            elif cfg['rec']:
                suf += '-' + str(cfg['rec'])
            if cfg['dry']:
                suf += 'D'
            if suf and not re.search(re.escape(suf) + r'$', page_rec['name']):
                page_rec = dict(
                    page_rec, name=page_rec['name'] + suf, model=((page_rec.get('model') or '') + suf).strip('-')
                )
        sig = (page_rec['name'], json.dumps(page_rec.get('chars') or [], ensure_ascii=False))
        if sig in seen:
            continue  # та же позиция на сайте дважды
        seen.add(sig)
        out.append(page_rec)
    names: dict = {}
    for page_rec in out:
        names.setdefault(page_rec['name'], []).append(page_rec)
    for name, lst in names.items():  # всё ещё одинаковые (разная производительность) — с номером варианта
        for i, page_rec in enumerate(lst[1:], 2):
            page_rec['name'] = f'{name} (вариант {i})'
    return out


def match_prices(pages, prices) -> tuple:
    """Каждой позиции парса — строка прайса по исполнению, названию, модели, коду изделия."""
    by_norm: dict = {}
    by_key: dict = {}
    by_model: dict = {}
    by_short: dict = {}
    by_set: dict = {}
    by_cfg: dict = {}
    for price in prices:
        if (
            len(price['name']) > PRICE_NAME_MAX or len(price['name'].split()) > PRICE_NAME_WORDS
        ):  # примечания и сноски в столбце названий — не товары
            continue
        by_norm.setdefault(_norm(price['name']), price)
        by_key.setdefault(name_key(price['name']), price)
        cfg = model_cfg(price['name'])
        price['_cfg'] = cfg
        if lat_series(cfg) and cfg['size'] is not None:
            by_cfg.setdefault(_cfg_key(cfg), []).append(price)
        model_key = _model_key(price['name'])
        if model_key:
            by_model.setdefault(model_key, []).append(price)
        if price['short']:
            by_short.setdefault(name_key(price['short']), []).append(price)
        model_set = _model_set(price['name'])
        if model_set:
            by_set.setdefault(model_set, []).append(price)

    by_code: dict = {}
    by_sig: dict = {}
    for price in prices:
        for code in {_code(price['name']), _code(price['short'])} - {''}:
            by_code.setdefault(code, []).append(price)
        for name_match in [price['name']] + [
            re.sub(r'\s+EKON$', '', v, flags=re.I) for k, v in price['specs'] if re.match(r'^модель\b', k, re.I)
        ]:  # «Модель Liutech»
            core, opt = _sig(name_match)
            if len(core) >= SIG_MIN and any(re.search(r'\d', x) for x in core):
                by_sig.setdefault(core, []).append((opt, price))
                if price.get('pbar'):  # «LENTO 15 LK» без давления в названии — строки «… -6 / -8 / -10»
                    by_sig.setdefault((*core[:-1], '*'), []).append((opt, price))

    def one(
        lst,
    ) -> dict | None:  # модель → строка прайса, только если все строки этой модели с одной ценой (иначе — не угадывать)
        if not lst:
            return None
        priced = [cand for cand in lst if cand['price']] or lst
        priced = [cand for cand in priced if not cand.get('sale')] or priced  # РРЦ важнее строки распродажи
        return priced[0] if len({cand['price'] for cand in priced}) == 1 else None

    hit, how = {}, {'cfg': 0, 'name': 0, 'key': 0, 'model': 0, 'short': 0, 'set': 0}
    for page in pages:
        cfg = page_cfg(page)
        price = one(by_cfg.get(_cfg_key(cfg))) if lat_series(cfg) and cfg['size'] is not None and cfg['p'] else None
        if price:
            how['cfg'] += 1
            hit[page['url']] = price
            continue
        model_key = _model_key(page['name']) or name_key(page.get('model'))
        model_set = _model_set(page['name'])
        steps = (
            ('name', lambda page_rec=page: by_norm.get(_norm(page_rec['name']))),
            ('key', lambda page_rec=page: by_key.get(name_key(page_rec['name']))),
            ('model', lambda mkey=model_key: one(by_model.get(mkey)) if mkey else None),
            (
                'short',
                lambda page_rec=page: one(by_short.get(name_key(page_rec['model']))) if page_rec.get('model') else None,
            ),
            ('set', lambda mset=model_set: one(by_set.get(mset)) if mset else None),
            ('code', lambda page_rec=page: _by_code(page_rec['name'], by_code)),
        )
        price = None
        for step, find in steps:  # по очереди — до первого найденного
            price = find()
            if price:
                how[step] = how.get(step, 0) + 1
                break
        if price and not cfg_compatible(cfg, price.get('_cfg') or model_cfg(price['name'])):
            how['rejected'] = how.get('rejected', 0) + 1  # «DVK 75-7» ≠ «DVK D 75-7»: другое исполнение
            price = None
        if not price:
            price = _by_sig(
                page, by_sig, one
            )  # последний шаг: «EXDM 5.5/7 IP54» = «EXDM 5,5/7 IP54», «G-Drive-T-20-7» = «G Drive T 20-7»
            if price:
                how['sig'] = how.get('sig', 0) + 1
        if price:
            hit[page['url']] = price
    used = {id(price) for price in hit.values()}
    return hit, {'matched': len(hit), 'how': how, 'priceOnly': sum(1 for price in prices if id(price) not in used)}


LAT_CYR = str.maketrans('АВЕКМНОРСТХ', 'ABEKMHOPCTX')
SIG_BRANDS = re.compile(r'^(EXELUTE|LUPAMAT|ALMIG|LIUTECH|TEWATT|DALGAKIRAN|REMEZA)$')
SIG_OPT = re.compile(r'^(IP\d\d|ZONCN|OMRON|INNOVANCE|INOVANCE|YASKAWA|MITSUBISHI)$')


def _sig(name) -> tuple:
    """Подпись модели из названия → (серия, размер, исполнение) для сравнения с прайсом."""
    text = re.sub(r'\([^)]*\)', ' ', str(name or '')).upper().replace(',', '.')
    text = re.sub(r'\bIP\s+(\d\d)\b', r'IP\1', text)  # «IP 54»
    text = re.sub(r'\bZONCH\b', 'ZONCN', text).replace('INNOVANCE', 'INOVANCE')  # опечатки в выгрузке склада
    text = re.sub(r'(IP\d\d)-\d+-\d+', r'\1', text)  # «IP54-10-54» — хвост выгрузки сайта
    text = re.sub(r'\b[A-Z]+/[A-Z]+\b', ' ', text)  # «OMRON/INOVANCE» — любой из двух
    words = [
        word.translate(LAT_CYR) for word in text.split() if not re.fullmatch(r'[А-ЯЁ.:-]+', word)
    ]  # «ВИНТОВОЙ» — не код
    text = ' '.join(words)
    text = re.sub(r'\b(?!IP\d)([A-Z]{2,})(\d{2,})\b', r'\1 \2', text)  # «XED180», «LUY130-12»
    text = re.sub(r'\bDHK\d\b', 'DHK', text)
    toks = [x.strip('.') for x in re.split(r'[\s\-]+', text)]
    toks = [x for x in toks if x and not SIG_BRANDS.match(x)]
    return tuple(x for x in toks if not SIG_OPT.match(x)), frozenset(x for x in toks if SIG_OPT.match(x))


def _code(text) -> str:
    """Код изделия из названия латиницей («РВ 500/10» → «PB500/10»)."""
    run = _code_run(text)
    code = re.sub(r'[\s.\-]', '', ''.join(run)).upper().replace(',', '.').translate(LAT_CYR)
    return code if len(code) >= CODE_MIN else ''


def _code_run(text) -> list:
    """Слова кода изделия в названии: первое слово с цифрой и соседние короткие заглавные («РВ», «АСО-ВК», «ESQ»)."""
    words = [word.strip(',;:') for word in re.sub(r'\([^)]*\)', ' ', str(text or '')).split()]
    words = [word for word in words if word]
    i = next((k for k, word in enumerate(words) if re.search(r'\d', word)), None)
    if i is None:
        return []

    def short_up(token) -> Any:
        return re.fullmatch(r'[A-ZА-ЯЁ][A-ZА-ЯЁ-]*', token) and len(token.replace('-', '')) <= SHORT_UP_MAX

    first, second = i, i + 1
    while first > 0 and short_up(words[first - 1]):
        first -= 1
    while second < len(words) and (
        re.search(r'\d', words[second]) or short_up(words[second]) or words[second].startswith('-')
    ):
        second += 1
    return words[first:second]


def code_cfg(name, model='') -> dict | None:
    """Исполнение по коду изделия русских моделей (серия, размер, давление, ресивер)."""
    for src in (model, name):
        run = _code_run(src)
        if run and len(run) > 1 and re.fullmatch(r'АСО|ASO', run[0], re.I) and re.match(r'[A-ZА-ЯЁ]+\d', run[1]):
            run = run[1:]  # «АСО К1/10» — марка завода, а не серия «АСО-К»
        raw = ' '.join(run).upper().translate(LAT_CYR).replace(',', '.')
        match = re.match(r'^([A-ZА-ЯЁ]+(?:[\s-]+[A-ZА-ЯЁ]+)?)[\s-]*(\d+(?:\.\d+)?)(.*)$', raw)
        if match:
            break
    else:
        return None
    rest, low = match.group(3), (str(name or '') + ' ' + str(model or '')).lower()
    pic_match = re.search(r'/\s*(\d+(?:\.\d+)?)', rest)
    rec = re.search(r'-\s*(\d{3,4})\b', rest[pic_match.end() :] if pic_match else '')
    gen = re.search(r'(?:^|[/\d\s.])([MH]\d?Э?)(?=$|[\s.\-/]|OB)', rest)  # «КТ16МЭ» — поколение «МЭ», не «М»
    var = re.match(r'^\s*-\s*(\d{2})\b', rest)
    flags = set(re.findall(r'ESQ|ПЭ|ПД|ГЦ|Ц\b', rest.replace('ГЦ', ' ГЦ ')))
    return {
        'ser': re.sub(r'[\s-]', '', match.group(1)),
        'size': float(match.group(2)),
        'cyr': bool(re.search(r'[А-ЯЁ]', ' '.join(run).upper())),
        'p': float(pic_match.group(1)) if pic_match else None,
        'rec': int(rec.group(1)) if rec else None,
        'gen': gen.group(1) if gen else '',
        'var': var.group(1) if var else '',
        'dry': bool(re.search(r'\bOB\b|OB-|\.OB|M\dOB', rest) or 'осушител' in low),
        'vsd': 'ESQ' in flags or bool(re.search(r'частотн', low)),
        'flags': sorted(flags - {'ESQ'}),
    }


def _by_sig(page, by_sig, one) -> dict | None:
    """Строка прайса с той же подписью модели (степень защиты и частотник — совпадают)."""
    core, opt = _sig(page['name'])
    if len(core) < SIG_MIN:
        return None
    cands = [(opt_n, price) for opt_n, price in by_sig.get(core, []) if opt_n <= opt]
    if not cands:
        bar = next((v for k, v in page.get('chars') or [] if re.search(r'давлен', k, re.I)), '')
        nums = re.findall(r'\d+(?:[.,]\d+)?', str(bar))
        pairs = by_sig.get((*core, '*'), [])
        cands = [
            (opt_n, price)
            for opt_n, price in pairs
            if opt_n <= opt and nums and _num(price.get('pbar')) == _num(nums[-1])
        ] or [(opt_n, price) for opt_n, price in pairs if opt_n <= opt]
    if not cands:
        return None
    best = max(len(opt_n) for opt_n, _ in cands)
    return one([price for opt_n, price in cands if len(opt_n) == best])


def _by_code(name, by_code) -> dict | None:
    """Строка прайса с тем же кодом изделия; несколько — ближайшая по словам."""
    code = _code(name)
    lst = by_code.get(code)
    if not lst:
        return None

    def words(x) -> set:
        return {word[:5] for word in re.findall(r'[а-яёa-z]{3,}', str(x).lower())}

    mine = words(name)

    # код в модели надёжнее кода в номенклатуре (в прайсе АСО у «РГ 110/10» номенклатура «РЕСИВЕР РВ110/16»)
    def score(price) -> int:
        return (
            (_code(price['name']) == code) * 10
            + len(mine & (words(price['name']) | words(price['short']))) * 2
            - len(words(price['name']) - mine)
        )

    best = sorted(lst, key=score, reverse=True)
    if len(best) > 1 and score(best[0]) == score(best[1]) and best[0]['price'] != best[1]['price']:
        return None
    return best[0]


def parse_stock(data) -> list:
    """XLSX остатков → [{sku, skus, name, brand, qty, wh: {склад: шт}, transit, prod, eta, promo, sheet}] (StockFile)."""
    return StockFile(data).rows()


class StockFile:
    """Файл остатков поставщика. Столбцы — по шапке (в две строки тоже: «Остатки по складам» над «Москва», «СПб») и по
    содержимому: склады отдельными столбцами, общее количество, «итого», в пути, даты поступления, статус машины (HERTZ),
    склад строки, скидки. Одна модель несколькими строками (партии, коды) — одна строка, количества складываются."""

    HEAD = re.compile(r'^(артикул|код|номенклатура|наименование|модель)\b', re.I)
    NAME = re.compile(r'^(номенклатура|наименование|название|модель)')
    SKU = re.compile(r'^(артикул|код)')
    BRAND = re.compile(r'^(бренд|марка|производитель)')
    STATUS = re.compile(r'^статус')
    PROMO = re.compile(r'^скидки|^акци')
    WH_NAME = re.compile(r'^(склад|на каком складе)')
    QTY = re.compile(r'^(свободн\w* )?(остат\w*|кол-?во|количеств\w*|наличи\w*|свободн\w*|доступн\w*)(,? ?шт\.?)?$')
    WH_QTY = re.compile(r'склад|остат|наличи')
    WH_WORDS = re.compile(r'^(остат\w*|наличи\w*|кол-?во|количеств\w*)( (на|по) склад\w*)?[ ,:]*', re.I)
    TOTAL = re.compile(r'^(итого|всего)')
    TRANSIT = re.compile(r'в пути|транзит|ожида|поступ|приход')
    DATE = re.compile(r'дата|срок|прибыт')
    RESERVE = re.compile(r'резерв')
    FREE = re.compile(r'[ ,(]*(без|за вычетом|минус|кроме)\s+резерв\w*\)?')  # «Остаток без резерва» — свободный
    WITH_RESERVE = re.compile(r'[ ,(]*(с|включая)\s+уч[её]том\s+резерв\w*\)?|[ ,(]*включая\s+резерв\w*\)?')
    WH_TAIL = re.compile(r'[ ,:]*(остат\w*|наличи\w*|кол-?во|количеств\w*|свободн\w*)( шт\.?)?$', re.I)
    PRICE = re.compile(r'цен|руб|сумм|стоим|ррц|ндс|скидк|%|евро|долл|usd|eur')
    AMOUNT = re.compile(r'^[<>≥≤~]?\s*(?:более|больше|свыше|от|до|менее|меньше)?\s*(\d+)\s*\+?\s*(?:шт\.?)?$', re.I)
    DATE_TEXT = re.compile(r'(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?')
    NUMERIC_SHARE = 0.6
    SERIAL_MIN, SERIAL_MAX = 30000, 80000  # число Excel — дата (1982–2119)
    EXCEL_DAY0 = datetime(1899, 12, 30)
    HEAD_ROWS = 30
    SUB_MIN = 2

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.out: dict = {}

    def rows(self) -> list:
        for sname, rows in read_xlsx(self.data):
            self._sheet(sname, rows)
        if not self.out:
            raise ValueError(
                'В файле остатков не нашлось шапки «Артикул / Номенклатура» или «Бренд / Модель» и столбца с количеством'
            )
        return self._aliases(list(self.out.values()))

    # ---------------------------------------------------------------- шапка и столбцы
    @staticmethod
    def _clean(text) -> str:
        return re.sub(r'\s+', ' ', str(text or '')).strip()

    def _head(self, rows: list) -> int | None:
        return next(
            (
                i
                for i, row in enumerate(rows[: self.HEAD_ROWS])
                if any(self.HEAD.match(self._clean(v)) for v in row.values())
            ),
            None,
        )

    def _titles(self, rows: list, head_row: int) -> tuple[dict, int]:
        """{столбец: подпись}; вторая строка шапки («Москва» под «Остатки по складам») — к подписи. → (подписи, первая строка данных)."""
        head = {col: self._clean(v) for col, v in rows[head_row].items()}
        sub = rows[head_row + 1] if head_row + 1 < len(rows) else {}
        key_cols = [
            col for col, title in head.items() if self.NAME.match(title.lower()) or self.SKU.match(title.lower())
        ]
        texts = {
            col: self._clean(v) for col, v in sub.items() if self._clean(v) and _num(v) is None and col not in key_cols
        }
        if len(texts) >= self.SUB_MIN and not any(self._clean(sub.get(col)) for col in key_cols):
            group = ''
            for col in sorted(texts):
                text = texts[col]
                group = head.get(col) or group  # объединённая ячейка шапки — над всеми своими столбцами
                head[col] = f'{group} {text}'.strip() if group.lower() != text.lower() else text
            return head, head_row + 2
        return head, head_row + 1

    def _amount(self, v) -> float | None:
        """Количество: число или «10+», «>5», «более 10» (столько есть точно)."""
        num = _num(v)
        if num is not None:
            return num
        found = self.AMOUNT.match(self._clean(v))
        return float(found.group(1)) if found else None

    def _numeric(self, data_rows: list, col) -> bool:
        vals = [row.get(col) for row in data_rows if self._clean(row.get(col))]
        return bool(vals) and sum(self._amount(v) is not None for v in vals) >= self.NUMERIC_SHARE * len(vals)

    def _dated(self, data_rows: list, col) -> bool:
        vals = [self._clean(row.get(col)) for row in data_rows if self._clean(row.get(col))]
        return bool(vals) and sum(bool(self._eta(v)) for v in vals) >= self.NUMERIC_SHARE * len(vals)

    def _roles(self, orig: dict, data_rows: list) -> dict:
        """Роли столбцов: name, sku, brand, status, promo, whname; qty, total, transit — столбцы; wh — {столбец: склад}; eta."""

        head = {col: title.lower() for col, title in orig.items()}

        def pick(regex) -> Any:
            return next((col for col, title in sorted(head.items()) if regex.match(title)), None)

        roles: dict = {
            'name': pick(self.NAME),
            'sku': pick(self.SKU),
            'brand': pick(self.BRAND),
            'status': pick(self.STATUS),
            'promo': pick(self.PROMO),
            'whname': None,
            'qty': None,
            'total': None,
            'transit': [],
            'eta': None,
            'wh': {},
        }
        taken = {roles[k] for k in ('name', 'sku', 'brand', 'status', 'promo')} - {None}
        for col, title in sorted(head.items()):
            if col in taken or not title:
                continue
            self._role(roles, col, title, data_rows, orig[col])
        return roles

    def _role(self, roles: dict, col, title: str, data_rows: list, label: str) -> None:
        if self.FREE.search(title) and self._numeric(data_rows, col):
            roles['qty'] = col
            return
        title = self.WITH_RESERVE.sub('', title).strip()
        if self.RESERVE.search(title):
            return
        if (self.DATE.search(title) or self.TRANSIT.search(title)) and self._dated(data_rows, col):
            roles['eta'] = roles['eta'] if roles['eta'] is not None else col
            return
        if not self._numeric(data_rows, col):
            if self.WH_NAME.match(title) and roles['whname'] is None:
                roles['whname'] = col
            return
        if self.TOTAL.match(title):
            roles['total'] = col
        elif self.TRANSIT.search(title):
            roles['transit'].append(col)
        elif self.QTY.match(title) and (roles['qty'] is None or title.startswith('свобод')):
            roles['qty'] = col  # свободный остаток важнее общего: его можно продать
        elif self.WH_QTY.search(title):
            roles['wh'][col] = self._wh_label(label)

    def _wh_label(self, title: str) -> str:
        label = self.WH_TAIL.sub('', self.WH_WORDS.sub('', title)).strip(' ,:') or title
        return label[:1].upper() + label[1:40]

    def _fallback_qty(self, roles: dict, head: dict, data_rows: list) -> Any:
        """Количество без подписи — столбец, где больше всего чисел (не цена и не резерв)."""
        skip = {roles['sku'], roles['name']} | {
            col for col, title in head.items() if self.PRICE.search(title.lower()) or self.RESERVE.search(title.lower())
        }
        nums: dict = {}
        for row in data_rows:
            for col, v in row.items():
                if col not in skip and self._amount(v) is not None:
                    nums[col] = nums.get(col, 0) + 1
        return max(nums, key=lambda col: nums[col]) if nums else None

    # ---------------------------------------------------------------- строки
    def _sheet(self, sname: str, rows: list) -> None:
        head_row = self._head(rows)
        if head_row is None:
            return
        head, first = self._titles(rows, head_row)
        names = [col for col, title in head.items() if self.NAME.match(title.lower()) or self.SKU.match(title.lower())]
        if not names:
            return
        titles = {self._clean(v).lower() for v in rows[head_row].values()}
        data_rows = [
            row
            for row in rows[first:]
            if any(self._clean(row.get(col)) not in ('', '0') for col in names)
            and not StockModel.is_head(row, titles)
            and not any(StockModel.HEAD_CELL.match(self._clean(row.get(col))) for col in names)
        ]
        roles = self._roles(head, data_rows)
        if roles['qty'] is None and roles['status'] is None and not roles['wh'] and roles['total'] is None:
            roles['qty'] = self._fallback_qty(roles, head, data_rows)
            if roles['qty'] is None:
                return
        for row in data_rows:
            self._row(sname, row, roles)

    def _count(self, v) -> int:
        num = self._amount(v)
        return max(0, int(num)) if num else 0

    def _row(self, sname: str, row: dict, roles: dict) -> None:
        name = self._clean(row.get(roles['name']) if roles['name'] is not None else '')
        sku = self._clean(row.get(roles['sku']) if roles['sku'] is not None else '')
        if not (name or sku) or NOTE_ROW.match(name or sku):
            return
        brand = self._clean(row.get(roles['brand'])) if roles['brand'] is not None else ''
        rec = self.out.setdefault(
            (brand.lower(), self._key(name, sku)),
            {
                'sku': sku[:60],
                'skus': [],
                'name': (name or sku)[:200],
                'brand': brand[:40],
                'qty': 0,
                'wh': {},
                'transit': 0,
                'prod': 0,
                'eta': '',
                'promo': '',
                'sheet': sname,
            },
        )
        if sku and sku[:60] not in rec['skus']:
            rec['skus'].append(sku[:60])
        status = self._clean(row.get(roles['status'])).lower() if roles['status'] is not None else ''
        place = self._clean(row.get(roles['whname'])) if roles['whname'] is not None else ''
        if roles['status'] is not None:
            self._unit(rec, row, roles, status, place)
        else:
            self._amounts(rec, row, roles, place)
        for col in roles['transit']:
            rec['transit'] += self._count(row.get(col))
        eta = self._eta(row.get(roles['eta'])) if roles['eta'] is not None else ''
        if not eta and not re.search(r'на склад', status):
            eta = self._eta(f'{status} {place}')
        if eta:
            rec['eta'] = min([rec['eta'], eta], key=lambda text: (text[3:], text[:2])) if rec['eta'] else eta
        self._promo(rec, row, roles)

    @staticmethod
    def _key(name: str, sku: str) -> str:
        """Одна модель — одна строка: по названию с кодом модели (партии, разные коды 1С); общее название без цифр
        («Фильтр масляный») у разных артикулов — разные товары."""
        if re.search(r'\d', name):
            return 'n:' + _sku_key(name)
        return 's:' + _sku_key(sku) if sku else 'n:' + _sku_key(name)

    def _unit(self, rec: dict, row: dict, roles: dict, status: str, place: str) -> None:
        """Строка на машину (HERTZ): статус — на складе, в пути, в производстве."""
        qty = self._count(row.get(roles['qty'])) if roles['qty'] is not None else 1
        if re.search(r'на склад|в наличии', status):
            rec['qty'] += qty
            self._place(rec, place, qty)
        elif re.search(r'в пути', status):
            rec['transit'] += qty
        elif re.search(r'производств|заказ', status):
            rec['prod'] += qty

    def _amounts(self, rec: dict, row: dict, roles: dict, place: str) -> None:
        """Сводка: склады столбцами (сумма — наличие), иначе общее количество (склад — из столбца «Склад»)."""
        by_wh = {label: self._count(row.get(col)) for col, label in roles['wh'].items()}
        if any(by_wh.values()):
            for label, qty in by_wh.items():
                if qty:
                    rec['qty'] += qty
                    rec['wh'][label] = rec['wh'].get(label, 0) + qty
            return
        col = roles['qty'] if roles['qty'] is not None else roles['total']
        qty = self._count(row.get(col)) if col is not None else 0
        rec['qty'] += qty
        self._place(rec, place, qty)

    @staticmethod
    def _place(rec: dict, place: str, qty: int) -> None:
        if qty and place and place != '0' and not re.match(r'^\d', place):
            rec['wh'][place[:40]] = rec['wh'].get(place[:40], 0) + qty

    def _eta(self, value) -> str:
        """Дата поступления → «ДД.ММ»: текст «15.11.2026», «прибытие 27.10» или число-дата Excel."""
        num = _num(value)
        if num is not None and self.SERIAL_MIN <= num <= self.SERIAL_MAX:
            day = self.EXCEL_DAY0 + timedelta(days=int(num))
            return f'{day.day:02d}.{day.month:02d}'
        found = self.DATE_TEXT.search(self._clean(value))
        return f'{int(found.group(1)):02d}.{int(found.group(2)):02d}' if found else ''

    def _promo(self, rec: dict, row: dict, roles: dict) -> None:
        promo = self._clean(row.get(roles['promo'])) if roles['promo'] is not None else ''
        if not promo or promo == '0' or rec['promo']:
            return
        share = _num(promo)
        rec['promo'] = f'Скидка {share * 100:g} %' if share is not None and 0 < share < 1 else promo[:80]

    @staticmethod
    def _aliases(rows: list) -> list:
        """«НЭК» и «НЭК (Москва)» — один склад: короткое название — к единственному полному."""
        names = {wh_val for x in rows for wh_val in x['wh']}
        full = {
            wh_val: [wh_name for wh_name in names if wh_name.lower().startswith(wh_val.lower() + ' (')]
            for wh_val in names
        }
        alias = {wh_val: wh_name[0] for wh_val, wh_name in full.items() if len(wh_name) == 1}
        for x in rows:
            merged: dict = {}
            for wh_val, qty_val in x['wh'].items():
                merged[alias.get(wh_val, wh_val)] = merged.get(alias.get(wh_val, wh_val), 0) + qty_val
            x['wh'] = merged
        return rows


def _sku_key(text) -> str:
    return re.sub(r'[\s.\-]', '', str(text or '')).upper().translate(LAT_CYR)


def _merge_stock(rows) -> dict:
    """Несколько строк остатков одной модели («LUY050-7 (без шасси)» и «(на шасси)») — одна: количества складываются."""
    if len(rows) == 1:
        return rows[0]
    x = dict(rows[0], wh=dict(rows[0].get('wh') or {}))
    for row in rows[1:]:
        for k in ('qty', 'transit', 'prod'):
            x[k] = x.get(k, 0) + row.get(k, 0)
        for warehouse, qty in (row.get('wh') or {}).items():
            x['wh'][warehouse] = x['wh'].get(warehouse, 0) + qty
        if row.get('eta') and (not x.get('eta') or (row['eta'][3:], row['eta'][:2]) < (x['eta'][3:], x['eta'][:2])):
            x['eta'] = row['eta']
        x['promo'] = x.get('promo') or row.get('promo') or ''
    return x


class StockModel:
    """Исполнение строки остатков по названию без русских слов и марки — запасной путь, когда артикула и подписи модели мало:
    «Компрессор винтовой TIDY10-7 (O) Dalgakiran,» ↔ «Винтовой компрессор Dalgakiran TIDY 10-7», «INVERSYS Plus PM 22-7,5» ↔
    «INVERSYS PLUS PM 22-7,5 с частотным преобразователем». Вид изделия (компрессор, фильтр, шкаф…) должен совпасть: «Комплект ЗИП
    для компрессора PET MASTER 300» — не сам компрессор."""

    BRANDS = re.compile(r'^(DALGAKIRAN|HERTZ)$', re.I)
    KINDS = (
        'компрессор',
        'воздуходувк',
        'осушител',
        'фильтр',
        'сепаратор',
        'ресивер',
        'шкаф',
        'панел',
        'генератор',
        'комплект',
        'масловлаго',
        'электростанц',
        'установк',
    )
    CYR_WORD = re.compile(r'^[А-ЯЁа-яё.,:;/()«»"-]+$')

    HEAD_CELL = re.compile(r'^(артикул|код|номенклатура|наименование|название|модель)$', re.I)

    @staticmethod
    def is_head(row: dict, titles: set) -> bool:
        """Строка — повтор шапки (объединённые ячейки шапки на две строки) или строка единиц «(шт.)»."""
        cells = [re.sub(r'\s+', ' ', str(v)).strip().lower() for v in row.values() if str(v).strip()]
        return bool(cells) and (
            all(cell in titles for cell in cells) or all(re.fullmatch(r'\(.*\)', cell) for cell in cells)
        )

    @classmethod
    def text(cls, name: str) -> str:
        """Название без русских слов, марки и хвостовых запятых: остаётся код модели."""
        words = [word.strip(',;') for word in re.sub(r'\([^)]*\)', ' ', str(name or '')).split()]
        return ' '.join(word for word in words if word and not cls.CYR_WORD.match(word) and not cls.BRANDS.match(word))

    @classmethod
    def kind(cls, name: str) -> str:
        """Вид изделия — первое из известных слов в названии («Комплект ЗИП для компрессора» — комплект)."""
        low = str(name or '').lower()
        found = [(low.find(stem), stem) for stem in cls.KINDS if stem in low]
        return min(found)[1] if found else ''

    @classmethod
    def cfg(cls, name: str) -> dict | None:
        cfg = model_cfg(cls.text(name), name)
        return cfg if cfg['ser'] and cfg['size'] is not None else None

    @staticmethod
    def key(cfg: dict) -> tuple:
        return (frozenset(cfg['ser']), cfg['size'], cfg['vsd'], cfg['w'], cfg['dry'], cfg['rec'])

    @classmethod
    def index(cls, stock: list) -> dict:
        """Исполнение → [(давление, вид, строка)]."""
        out: dict = {}
        for row in stock:
            cfg = cls.cfg(row['name'])
            if cfg:
                out.setdefault(cls.key(cfg), []).append((cfg['p'], cls.kind(row['name']), row))
        return out

    @staticmethod
    def of_rows(stock: list, prices: list, name: str, idx: tuple) -> dict | None:
        """Остатки карточки, которой подошли несколько строк прайса (давления одной модели): по их артикулам вместе,
        иначе — по названию карточки."""
        found: dict = {}
        for price in prices:
            row = stock_row(stock, price.get('sku'), '', idx) if price.get('sku') else None
            if row is not None:
                found[id(row)] = row
        return _merge_stock(list(found.values())) if found else stock_row(stock, '', name, idx)

    @classmethod
    def find(cls, idx: dict, name: str) -> dict | None:
        """Строка (несколько — вместе) того же исполнения и вида; давление — то же, без давления у позиции — все давления."""
        cfg = cls.cfg(name)
        if not cfg:
            return None
        kind = cls.kind(name)
        rows = [
            (pbar, row)
            for pbar, row_kind, row in idx.get(cls.key(cfg), [])
            if not kind or not row_kind or row_kind == kind
        ]
        if cfg['p'] is not None:
            rows = [(pbar, row) for pbar, row in rows if pbar == cfg['p']]
        return _merge_stock([row for _, row in rows]) if rows else None


def stock_index(stock) -> tuple:
    """Указатели по строкам остатков: (артикул → строка, код изделия → [кандидаты для _by_code], подпись модели → [(признаки, строка)])."""
    by_sku: dict = {}
    by_code: dict = {}
    for row in stock:
        for sku in row.get('skus') or ([row['sku']] if row['sku'] else []):
            by_sku.setdefault(_sku_key(sku), []).append(row)
        for code in {_code(row['name']), _code(row['sku'])} - {''}:
            by_code.setdefault(code, []).append(row)
    # строки с одним кодом и одинаковыми словами (исполнения «на шасси» / «без шасси») — одна строка
    code_rows = {}
    for code, rows in by_code.items():
        same_words = len({re.sub(r'\([^)]*\)', '', row['name']).strip().lower() for row in rows}) == 1
        if len(rows) > 1 and same_words:
            code_rows[code] = [{'name': rows[0]['name'], 'short': rows[0]['sku'], 'price': 0, 'r': _merge_stock(rows)}]
        else:  # price — для _by_code: строки с разным количеством при равном счёте не угадываются
            code_rows[code] = [
                {'name': row['name'], 'short': row['sku'], 'price': row['qty'], 'r': row} for row in rows
            ]
    by_sig: dict = {}  # «EXDM 7,5/10 IP 54» ↔ «Винтовой компрессор EXELUTE EXDM 7.5/10 IP54»
    for row in stock:
        core, opt = _sig(row['name'])
        if len(core) >= SIG_MIN and any(re.search(r'\d', x) for x in core):
            by_sig.setdefault(core, []).append((opt, row))
    return {k: _merge_stock(v) for k, v in by_sku.items()}, code_rows, by_sig, StockModel.index(stock)


def stock_row(stock, sku, name, idx=None) -> dict | None:
    """Строка остатков позиции: по артикулу, подписи модели, коду изделия или исполнению (StockModel)."""
    by_sku, by_code, by_sig, by_cfg = idx or stock_index(stock)
    row = by_sku.get(_sku_key(sku)) if sku else None
    if row is None:
        core, opt = _sig(name)
        drv = {x for x in opt if not x.startswith('IP')}  # частотник в названии позиции не указан — подходит любой
        cands = (
            [
                (cand, x)
                for cand, x in by_sig.get(core, [])
                if cand <= opt or (not drv and {y for y in cand if y.startswith('IP')} <= opt)
            ]
            if len(core) >= SIG_MIN
            else []
        )
        if cands:
            best = max(len(cand) for cand, _ in cands)
            return _merge_stock([x for cand, x in cands if len(cand) == best])
    if row is None and _code(name):
        x = _by_code(name, by_code)
        row = x['r'] if x else None
    if row is None:
        row = StockModel.find(by_cfg, name)
    return row


def stock_info(row) -> dict:
    """Строка остатков → doc.stock (без даты): {qty, available, wh: [[склад, шт]], transit, prod, eta, promo}."""
    state = {'qty': row['qty'] if row else 0, 'available': bool(row and row['qty'] > 0)}
    if row:
        for k in ('transit', 'prod', 'eta', 'promo'):
            if row.get(k):
                state[k] = row[k]
        if row.get('wh'):
            state['wh'] = sorted(([warehouse, qty] for warehouse, qty in row['wh'].items()), key=lambda pair: -pair[1])
    return state


def apply_stock(offers, stock) -> int:
    """Остатки → в предложения фида; → число позиций с остатками."""
    idx = stock_index(stock)
    found = 0
    for offer in offers:
        row = stock_row(stock, offer.get('sku'), offer['name'], idx)
        if row is None and offer.get('model'):
            row = stock_row(stock, '', offer['model'], idx)
        offer['stockInfo'] = stock_info(row)
        offer['qty'] = offer['stockInfo']['qty']
        offer['available'] = offer['qty'] > 0
        offer['nostock'] = False
        found += row is not None
    return found


def _param(k) -> tuple:
    """«Давление (бар)» → («Давление», «бар»); «Мощность, кВт» разберёт feeds._param_name."""
    match = re.match(r'^(.*\S)\s*\(([^()]{1,12})\)$', k)
    return (match.group(1), match.group(2)) if match else (k, '')


def _price_specs_ok(page, price) -> list:
    """Характеристики строки прайса без явных ошибок (давление не из названия и т. п.)."""
    if not price:
        return []
    pressure = page_cfg(page)['p']
    out = []
    for k, v in price['specs']:
        if pressure and spec_class(k) == 'pressure':
            num = _num_attr(re.sub(r'[^\d,.]', '', str(v)).replace(',', '.') or None)
            if num and PRESSURE_ALIAS.get(num, num) != PRESSURE_ALIAS.get(pressure, pressure):
                continue
        out.append((k, v))
    return out


def build_feed(feed, pages, prices, param_name, stock=None) -> dict:
    """→ {shop, date, cats, offers} как у feeds.parse(): позиции парса с ценой из прайса."""
    pages = unique_names(pages)
    if prices and prices[0].get('genset'):  # прайс-склад ДГУ: по модели, исполнению и альтернатору
        hit, stats = GensetMatch.pages(pages, prices)
    else:
        hit, stats = (
            match_prices(pages, prices) if prices else ({}, {'matched': 0, 'how': {}, 'priceOnly': len(prices)})
        )
    cats: dict = {}
    offers: dict = {}
    maker = (
        re.split(r'[,;]', feed.get('maker') or '')[0]
    ).strip()  # «EXELUTE, LUPAMAT» — у позиции своя марка из парса
    cur0 = (feed.get('cur') or '').upper()
    for page in pages:
        cid = 'site-' + (images.slug(page['cat'], 40) or 'other')
        cats.setdefault(cid, {'id': cid, 'name': page['cat'], 'parent': '', 'path': page['cat']})
        price = hit.get(page['url'])
        params = []
        for k, v in merge_specs(page['chars'], _price_specs_ok(page, price)):
            param_key, u = _param(k)
            param_key, u = param_name(param_key, u)
            if u == 'дюйм' and re.search(
                r'["“”\']|\bDN\b|\bG\s*\d', v
            ):  # «2"», «DN 50», «G 1/2» — единица уже в значении
                u = ''
            params.append({'k': param_key[:60], 'u': u, 'v': v})
        oid = _oid(page['url'].rstrip('/').rsplit('/', 1)[-1] or page['name'], page['url'], offers)
        offer = _offer(
            oid,
            page['name'],
            cid,
            page['cat'],
            page['url'],
            page['pictures'],
            clean_desc(page['desc']),
            params,
            page.get('brand') or maker,
            page['model'],
            price,
            cur0,
        )
        # начало описания называет вид («Адсорбционный осушитель …») — по нему точнее определяется категория программы
        offer['crumbs'] = page['cat'] + ' / ' + re.sub(r'[|/]', ' ', page['desc'][:120])
        offers[oid] = offer
    if feed.get('priceOnly') and prices:
        used = {id(price_rec) for price_rec in hit.values()}
        for price_rec in prices:
            if id(price_rec) in used or not price_rec['price']:
                continue
            cid = 'price-' + (images.slug(price_rec['sheet'], 40) or 'sheet')
            cats.setdefault(
                cid,
                {
                    'id': cid,
                    'name': price_rec['sheet'],
                    'parent': '',
                    'path': 'Прайс / ' + (price_rec['title'] or price_rec['sheet']),
                },
            )
            oid = _oid(
                'p-' + (price_rec['sku'] or price_rec['name']), price_rec['sheet'] + '|' + price_rec['name'], offers
            )
            params = []
            for k, v in merge_specs([], price_rec['specs']):
                param_key, u = param_name(k, '')
                params.append({'k': param_key[:60], 'u': u, 'v': v})
            offers[oid] = _offer(
                oid,
                price_rec['name'],
                cid,
                price_rec['sheet'],
                '',
                [],
                '',
                params,
                maker,
                price_rec['short'],
                price_rec,
                cur0,
            )
    offs = list(offers.values())
    logos: dict = {}  # логотипы марок из JSON-парса: {марка: kpa:…}
    for page in pages:
        if page.get('logo'):
            logos.setdefault(page.get('brand') or maker, page['logo'])
    if prices and prices[0].get('genset'):
        GensetMatch.unpriced(offs)
    elif stock:  # у прайса-склада ДГУ наличие — в самом прайсе
        stats['stock'] = apply_stock(offs, stock)
    return {
        'shop': feed.get('name') or '',
        'date': '',
        'cats': cats,
        'offers': offs,
        'match': stats,
        'prices': prices,
        'stock': stock,
        'logos': logos,
    }


# Карточка, заведённая вручную, описывает модель целиком («TIDY-N 15 с ресивером и осушителем», давление 7,5 / 8,5 / 10 / 13 бар),
# а прайс — каждое исполнение отдельно («TIDY-N 15-7,5-250D»). Цена у давлений до 13 бар одна, отличается исполнение:
# ресивер (250 / 500 л), осушитель (D после ресивера или ID), водяное охлаждение (W), частотник (VSD). Сопоставление — по серии,
# типоразмеру и исполнению; давление не учитывается, если цены совпадают.
CFG_SKIP = {
    'КОМПРЕССОР',
    'ВИНТОВОЙ',
    'БЕЗМАСЛЯНЫЙ',
    'ПОРШНЕВОЙ',
    'СПИРАЛЬНЫЙ',
    'ДВУХСТУПЕНЧАТЫЙ',
    'ДОЖИМНОЙ',
    'DALGAKIRAN',
    'COMPACT',
    'BAR',
    'БАР',
}


def model_cfg(model, text='') -> dict:
    """Модель → исполнение {ser, size, p, rec, dry, vsd} для сравнения карточек и прайса."""
    model_text = re.sub(r'\([^)]*\)', ' ', str(model or '').replace('\\', '')).upper().replace(',', '.')
    model_text = re.sub(r'(?<=\d)\s*[XХ×]\s*(?=\d)', 'X', model_text)  # «2х270», «2 × 270» → «2X270»
    low_text = str(text or '').lower()
    cfg: dict[str, Any] = {'ser': set(), 'size': None, 'p': None, 'rec': None, 'dry': False, 'vsd': False, 'w': False}
    nums = []
    for tok in re.split(r'[\s/]+', model_text):
        if not tok:
            continue
        if tok in ('VSD', 'VFD'):
            cfg['vsd'] = True
            continue
        if tok == 'ID':
            cfg['dry'] = True
            continue
        if tok == 'W':  # «EAGLE-N VSD 200 10 BAR W» — водяное охлаждение
            cfg['w'] = True
            continue
        parts = []
        for x in tok.split('-'):
            group_match = re.match(r'^([A-ZА-Я]{2,})(\d+(?:\.\d+)?)$', x)  # «DS11» → «DS», «11»
            parts += [group_match.group(1), group_match.group(2)] if group_match else ([x] if x else [])
        for x in parts:
            num_match = re.match(r'^(\d+(?:\.\d+)?)([A-ZА-Я]*)$', x)
            if num_match:
                nums.append(float(num_match.group(1)))
                suf = num_match.group(2)
                if suf == 'W':
                    cfg['w'] = True
                elif suf == 'D' and len(nums) >= NUMS_WITH_RECEIVER:  # «-250D» — ресивер с осушителем
                    cfg['dry'] = True
                elif suf == 'D':  # «DVK 220D» — серия с прямым приводом
                    cfg['ser'].add('D')
                continue
            if re.match(r'^\d+X\d', x):  # «2X270D» — два ресивера
                match = re.match(r'^(\d+)X(\d+)(D?)$', x)
                if match:
                    cfg['rec'] = int(match.group(1)) * int(match.group(2))
                    cfg['dry'] = cfg['dry'] or bool(match.group(3))
                continue
            if re.match(r'^[A-ZА-Я]+$', x) and x not in CFG_SKIP:
                cfg['ser'].add(x)
    if any(ser.startswith('INVERS') for ser in cfg['ser']):  # INVERSYS — всегда с частотным преобразователем
        cfg['vsd'] = True
    if 'DS' in cfg['ser']:  # спиральные DS: S/D/T/Q — число головок, не серия
        cfg['ser'] -= {'S', 'D', 'T', 'Q'}
    if nums:
        cfg['size'] = nums[0]
    if len(nums) >= NUMS_WITH_PRESSURE and nums[1] <= PRESSURE_CODE_MAX:
        cfg['p'] = nums[1]
    if len(nums) >= NUMS_WITH_RECEIVER and RECEIVER_MIN <= nums[2] <= RECEIVER_MAX:
        cfg['rec'] = int(nums[2])
    if re.search(r'частот|инвертор|\bvsd\b', low_text):
        cfg['vsd'] = True
    if re.search(r'водян', low_text):
        cfg['w'] = True
    if re.search(
        r'(с|со встроенным|и)\s+осушител', low_text
    ):  # «с ресивером и осушителем»; сам «Осушитель DK 10» — не признак
        cfg['dry'] = True
    match2 = re.search(r'ресивер\S*\s*(\d{3,4})', low_text)
    if match2:
        cfg['rec'] = int(match2.group(1))
    elif re.search(r'(с|на) ресивер', low_text) and not cfg['rec']:
        cfg['rec'] = -1  # с ресивером, объём не указан
    return cfg


def card_attrs(cfg, attrs) -> dict:
    """Исполнение карточки каталога (model_cfg) дополняется её полями: частотник, осушитель, объём ресивера; → cfg."""
    attr_map = attrs or {}
    if str(attr_map.get('vsd') or '').lower() == 'да':
        cfg['vsd'] = True
    if str(attr_map.get('dryer') or '').lower() == 'да':
        cfg['dry'] = True
    rec = _num_attr(re.sub(r'[\s\xa0]', '', str(attr_map.get('receiver'))))  # «1 000» л
    if rec and cfg['rec'] in (None, -1):
        cfg['rec'] = int(rec)
    return cfg


def match_card(name, model, attrs, prices) -> tuple:
    """Ручная карточка → строки прайса того же исполнения; → (строки, причина-если-нет)."""
    if prices and prices[0].get('genset'):
        return GensetMatch.card(name, model, attrs or {}, prices)
    cfg = card_attrs(model_cfg(model or name, name), attrs)
    attr_map = attrs or {}
    if not cfg['ser'] or cfg['size'] is None:
        return [], 'не понятна модель'
    cand = []
    for price in prices:
        price_col = price.get(
            '_cfg'
        )  # исполнение строки прайса разбирается один раз (match_prices или первая карточка)
        if price_col is None:
            price_col = price['_cfg'] = model_cfg(price['name'] or price['short'])
        if (
            price_col['ser'] != cfg['ser']
            or price_col['size'] != cfg['size']
            or price_col['vsd'] != cfg['vsd']
            or price_col['w'] != cfg['w']
            or price_col['dry'] != cfg['dry']
        ):
            continue
        if (cfg['rec'] is None) != (price_col['rec'] is None) or (
            cfg['rec'] not in (None, -1) and price_col['rec'] != cfg['rec']
        ):
            continue
        cand.append((price, price_col))
    if not cand:
        return [], 'нет в прайсе'
    pressure_val = cfg.get('p') or _num_attr(attr_map.get('pressure'))
    std = [(price, price_col) for price, price_col in cand if not price_col['p'] or price_col['p'] <= STD_PRESSURE_MAX]
    if std and not (pressure_val and pressure_val > STD_PRESSURE_MAX):
        cand = std
    priced = [(price, price_col) for price, price_col in cand if price['price']]
    if not priced:
        return [price for price, _ in cand], 'в прайсе без цены'
    if len({price['price'] for price, _ in priced}) > 1:
        by_p = [(price, price_col) for price, price_col in priced if pressure_val and price_col['p'] == pressure_val]
        if len({price['price'] for price, _ in by_p}) == 1:
            return [price for price, _ in by_p], ''
        return [price for price, _ in priced], 'разные цены у исполнений'
    return [price for price, _ in priced], ''


def _num_attr(v) -> float | None:
    try:
        return float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def _oid(base, uniq, offers) -> str:
    """Идентификатор предложения ≤ 40 знаков (feeds._cid режет длиннее) и без повторов: длинные похожие ссылки — с хвостом-хэшем."""
    oid = images.slug(base, 40) or 'item'
    if oid in offers or len(images.slug(base, 60)) > SLUG_MAX:
        oid = (images.slug(base, 32) + '-' + hashlib.md5(uniq.encode('utf-8')).hexdigest()[:7]).strip('-')
    return oid


def _offer(oid, name, cid, path, url, pictures, desc, params, maker, model, price, cur0) -> dict:
    return {
        'oid': oid,
        'name': name[:300],
        'cat': cid,
        'path': path,
        'url': url,
        'price': price['price'] if price else None,
        'oldprice': None,
        'cur': (price['cur'] if price and price.get('cur') else cur0) or 'EUR',
        'vendor': maker,
        'dealer': price.get('dealer') if price else None,
        'disc': price.get('disc') if price else None,
        'priceFile': price.get('file') if price else '',
        'model': model or (price['short'] if price else '') or '',
        'sku': price['sku'] if price else '',
        'barcode': '',
        'pictures': pictures,
        'desc': desc,
        'params': params,
        'available': True,
        'qty': None,
        'nostock': True,
        'authoritative': True,
        'weight': None,
        'dims': '',
        'notes': '',
        'opts': [{'name': opt_name, 'price': v} for opt_name, v in (price['opts'] if price else [])],
        'sheet': price['sheet'] if price else '',
        **_row_stock(price),
    }


def _row_stock(price) -> dict:
    """Наличие из самой строки прайса (прайс-склад ДГУ); без файла остатков."""
    info = price.get('stockInfo') if price else None
    return {'stockInfo': info, 'qty': info['qty'], 'available': info['available'], 'nostock': False} if info else {}
