# -*- coding: utf-8 -*-
"""Фид поставщика из файлов: парс сайта (CSV) + прайс (XLSX) — для поставщиков без товарного фида YML.

  • Парс сайта — CSV: категория, название, ссылка на страницу товара, картинки (через « | »), описание,
    технические характеристики («Ключ: значение | Ключ: значение»). Такой файл отдают парсеры сайтов; Excel при пересохранении
    часто оборачивает строку в кавычки и дописывает «;;;» — это учитывается.
  • Прайс — XLSX с листами по сериям: шапка со столбцами «Артикул», «Модель» (полное название), «Название для печатной
    формы», характеристики с единицами в отдельной строке, «Стоимость» (и столбцы опций «Стоимость …»). Объединённые ячейки
    (одна цена на несколько давлений) разворачиваются.
  • Позиция каталога = строка парса; цена и артикул — из строки прайса с тем же названием (точное совпадение, затем без
    знаков препинания, затем по модели). Новый прайс загружается в любой момент — «Проверить цены» обновит закупку.
  • Файлы хранятся в data/feeds/<id>/ (pages.csv, price.xlsx); разобранный фид — в памяти (feeds._CACHE).
Результат — тот же словарь, что даёт feeds.parse() для YML, поэтому предпросмотр, загрузка и проверка общие.
"""
import csv
import hashlib
import html as html_mod
import io
import json
import urllib.parse
import os
import re
import zipfile
from datetime import datetime

import images

DIR_NAME = 'feeds'
MAX_FILE = 60 * 1024 * 1024
UNITS = {'бар', 'м³/мин', 'м3/мин', 'м³/ч', 'м3/час', 'м3/ч', 'л/мин', 'лит', 'л', 'квт', 'мм', 'кг', 'дюйм', 'дб', 'дб(а)', 'евро', 'eur', '€',
         'руб', 'руб.', '₽', 'usd', '$', 'в/гц', 'в', 'модель', 'тип', 'r', 'фланец', 'шт', '(л)', '(кг)', 'об/мин', '%', '°c', 'мбар',
         'атм', 'см', 'м', 'g', 'марка', 'м2/ч', 'r (ü)', 'мм', 'час', 'материал', 'град,°с', '°с', 'м3/мин'}
HEAD_WORDS = ('Артикул', 'Код SAP', 'Модель', 'Название', 'Наименование')
JUNK = re.compile(r'^(NEW PRICE|Опции|www\.|Содержание|Цены с учетом|\*)', re.I)
CUR_WORDS = {'евро': 'EUR', 'eur': 'EUR', '€': 'EUR', 'руб': 'RUB', 'руб.': 'RUB', '₽': 'RUB', 'usd': 'USD', '$': 'USD', 'юань': 'CNY', 'cny': 'CNY'}


# ---------------------------------------------------------------- файлы на диске
def feed_dir(data_dir, fid):
    return os.path.join(data_dir, DIR_NAME, images.slug(fid, 40) or 'feed')


FILE_NAMES = {'pages': 'pages.csv', 'price': 'price.xlsx', 'stock': 'stock.xlsx'}


def file_path(data_dir, fid, kind):
    return os.path.join(feed_dir(data_dir, fid), FILE_NAMES[kind])


def save_file(data_dir, fid, kind, data, name):
    """Сохранить файл фида; → мета {name, size, at, …} с итогом разбора (ValueError — файл не читается)."""
    if kind not in FILE_NAMES:
        raise ValueError('Неизвестный вид файла')
    if not data:
        raise ValueError('Файл пустой')
    if len(data) > MAX_FILE:
        raise ValueError('Файл больше %d МБ' % (MAX_FILE // 1024 // 1024))
    meta = {'name': str(name or '')[:120], 'size': len(data), 'at': datetime.now().isoformat(timespec='seconds')}
    if kind == 'pages':
        rows = parse_pages(data)
        meta.update(rows=len(rows), cats=len({r['cat'] for r in rows}))
    elif kind == 'stock':
        rows = parse_stock(data)
        meta.update(rows=len(rows), inStock=sum(1 for r in rows if r['qty'] > 0))
    else:
        rows, sheets = parse_price(data)
        meta.update(rows=len(rows), sheets=len(sheets), withPrice=sum(1 for r in rows if r['price']),
                    cur=next((r['cur'] for r in rows if r.get('cur')), ''))
    d = feed_dir(data_dir, fid)
    os.makedirs(d, exist_ok=True)
    tmp = file_path(data_dir, fid, kind) + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, file_path(data_dir, fid, kind))
    return meta


def read_file(data_dir, fid, kind):
    p = file_path(data_dir, fid, kind)
    if not os.path.exists(p):
        return None
    with open(p, 'rb') as fh:
        return fh.read()


def remove_files(data_dir, fid):
    d = feed_dir(data_dir, fid)
    for n in ('pages.csv', 'price.xlsx', 'pages.csv.tmp', 'price.xlsx.tmp'):
        try:
            os.remove(os.path.join(d, n))
        except OSError:
            pass
    try:
        os.rmdir(d)
    except OSError:
        pass


# ---------------------------------------------------------------- парс сайта (CSV)
def _decode(data):
    for enc in ('utf-8-sig', 'cp1251'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', 'replace')


def _unwrap(line):
    """Строка, которую Excel обернул в кавычки целиком (внутренние кавычки удвоены) и дописал «;;;»."""
    line = line.rstrip('\r\n').rstrip(';').strip()
    if len(line) > 1 and line[0] == '"' and line[-1] == '"' and line.count(',') and '""' in line:
        line = line[1:-1].replace('""', '"')
    return line


def _unq(s):
    s = s.strip()
    if len(s) > 1 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    return s.strip()


_PROD_URL = re.compile(r'https?://[^\s,"]+')
_CHAR_START = re.compile(r',"?(?=[^:|,"]{2,70}: [^|]*\| )')


def _split_line(line):
    """категория, название, ссылка, картинки, описание, характеристики — без доверия кавычкам CSV (в описаниях они сломаны)."""
    m = _PROD_URL.search(line)
    if not m:
        return None
    head = line[:m.start()].rstrip(', ')
    cat, _, name = head.partition(',')
    url = m.group(0).rstrip('.,;')
    rest = line[m.end():].lstrip(',')
    pics, desc, chars = '', '', ''
    pm = re.match(r'^"?((?:https?://\S+?)(?:\s*\|\s*https?://\S+?)*)"?(?=,|$)', rest)
    if pm:
        pics = pm.group(1)
        rest = rest[pm.end():].lstrip(',')
    # начало характеристик — «,"Ключ: значение | …»: ключ с заглавной буквы и без точки («,03 мг/м3. Технические особенности:» — хвост
    # описания после запятой в числе «0,03», не характеристики)
    cands = [c.start() for c in _CHAR_START.finditer(rest) if re.match(r'^,\s*"*\s*[А-ЯЁA-Z][^:|.]{0,69}:', rest[c.start():])]
    cut = next((p for p in cands if rest[p:].count(' | ') >= 2), cands[-1] if cands else -1)
    if cut >= 0:
        desc, chars = rest[:cut], rest[cut + 1:]
    elif re.search(r'^[^:|]{2,70}: .*\| ', rest):
        chars = rest
    else:
        desc = rest
    return [_unq(cat), _unq(name), url, _unq(pics), _unq(desc), _unq(chars)]


def _clean_text(s):
    s = html_mod.unescape(s or '').replace('\xa0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    return s.strip(' "')


PAGE_COLS = {'cat': r'^категор', 'name': r'^назван|^наименован', 'url': r'ссылк|^url', 'pictures': r'картин|^фото|изображ', 'desc': r'^описан',
             'chars': r'характерист', 'model': r'^модель', 'sku': r'^артикул'}


def _pages_table(text):
    """Правильный CSV (все поля в кавычках, переносы строк внутри ячеек — как в выгрузке программы): столбцы по заголовкам.
    → список записей [cat, name, url, pics, desc, chars, model] или None, если это не такой файл."""
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error:
        return None
    if len(rows) < 2:
        return None
    head = [re.sub(r'\s+', ' ', h).strip().lower() for h in rows[0]]
    col = {}
    for key, rx in PAGE_COLS.items():
        col[key] = next((i for i, h in enumerate(head) if re.search(rx, h)), None)
    if col['name'] is None or col['url'] is None:
        return None
    body = [r for r in rows[1:] if len(r) > col['url'] and r[col['name']].strip()]
    if not body or sum(1 for r in body if _PROD_URL.match(r[col['url']].strip())) < len(body) * 0.8:
        return None             # кавычки сломаны — строки склеились, читать построчно
    get = lambda r, k: r[col[k]].strip() if col[k] is not None and col[k] < len(r) else ''
    return [[get(r, 'cat'), get(r, 'name'), get(r, 'url'), get(r, 'pictures'), get(r, 'desc'), get(r, 'chars'), get(r, 'model')] for r in body]


# ---------------------------------------------------------------- парс в JSON
# {"format": "kp-parse/1", "supplier": "…", "items": [{"category", "name", "model", "url", "images": [адреса, первое — главное],
#   "description": [{"title": "Назначение", "text": "…"}, {"title": "Общие характеристики", "items": ["…", …]}],
#   "specs": [{"name": "Давление", "value": "8,5 бар"}, …]}]}
# Можно и списком позиций без обёртки, с русскими ключами (категория, название, модель, ссылка, картинки, описание,
# характеристики), описанием одной строкой, характеристиками — объектом {"Давление": "8,5 бар"}.
JSON_KEYS = {'cat': ('category', 'категория', 'cat'), 'name': ('name', 'название', 'наименование'), 'model': ('model', 'модель'),
             'url': ('url', 'ссылка', 'link', 'ссылка на страницу товара'), 'pictures': ('images', 'pictures', 'картинки', 'фото'),
             'desc': ('description', 'описание', 'desc'), 'chars': ('specs', 'characteristics', 'характеристики', 'технические характеристики'),
             'schemes': ('schemes', 'схемы', 'чертежи', 'drawings')}
# разделы сайта по адресу страницы, когда в парсе нет категории (asobezh.ru/catalog/vintovye_kompressory/11_18_5_kvt/…)
URL_SLUGS = {'vintovye_kompressory': 'Винтовые компрессоры', 'porshnevye_kompressory': 'Поршневые компрессоры',
             'vozdushnye_resivery': 'Воздушные ресиверы', 'podgotovka_vozdukha': 'Подготовка воздуха',
             'apparaty_struynoy_ochistki': 'Аппараты струйной очистки', 'na_blokakh_rotorcomp': 'На блоках Rotorcomp',
             'peredvizhnye': 'Передвижные', 'vmks_modulnye_kompressornye_stantsii': 'Модульные компрессорные станции ВМКС',
             's_davleniem_do_16_atm': 'Давление до 16 атм', 'avtonomnyy_privod': 'С автономным приводом', 'tandem': 'Тандем',
             'bloki_upravleniya_porshnevymi_kompressorami': 'Блоки управления', 'na_vertikalnom_resivere': 'На вертикальном ресивере',
             'na_baze_inostrannykh_kompressornykh_golovok': 'На импортных головках', 'seriya_fini': 'Серия FINI',
             '09g2s': 'Сталь 09Г2С', '12x18h10t': 'Нержавеющая сталь 12Х18Н10Т', 'otsinkovannye': 'Оцинкованные',
             'gorizontalnye_resivery_s_plitoy': 'Горизонтальные с плитой', 'osushiteli_vozdukha': 'Осушители воздуха',
             'magistralnye_filtry': 'Магистральные фильтры', 'peskostruynye_apparaty': 'Пескоструйные аппараты',
             'rukava_napornye': 'Рукава напорные', 'rukava_peskostruynye': 'Рукава пескоструйные', 'sopla': 'Сопла',
             'soploderzhateli': 'Соплодержатели', 'stsepleniya_krabovye': 'Сцепления крабовые', 's_elektroprivodom': 'С электроприводом'}


def _url_cat(url):
    """Раздел по адресу: два первых уровня каталога сайта, «4_7_5_kvt» → «4–7,5 кВт», «10_atmosfer» → «10 атм»."""
    path = [x for x in urllib.parse.urlsplit(str(url or '')).path.split('/') if x]
    if path and path[0] in ('catalog', 'katalog', 'products', 'product'):
        path = path[1:]
    out = []
    for seg in path[:2]:
        if re.fullmatch(r'\d+', seg):
            break
        t = URL_SLUGS.get(seg)
        if not t:
            m = re.fullmatch(r'(?:s_privodom_)?(\d+(?:_\d+)*)_kvt', seg)
            m3 = re.fullmatch(r'(\d+)(?:_(\d+))?_atmosfer', seg)
            if m:           # «4_7_5» — 4–7,5; «11_18_5» — 11–18,5; «2_2_4_0» — 2,2–4,0; «18_5» — 18,5
                n = m.group(1).split('_')
                if len(n) == 4:
                    a, b = n[0] + ',' + n[1], n[2] + ',' + n[3]
                elif len(n) == 3:
                    a, b = (n[0], n[1] + ',' + n[2]) if int(n[0]) < int(n[1]) else (n[0] + ',' + n[1], n[2])
                elif len(n) == 2 and int(n[1]) > int(n[0]):
                    a, b = n
                else:
                    a, b = ','.join(n), ''
                t = '%s–%s кВт' % (a, b) if b else '%s кВт' % a
            elif m3:
                t = '%s атм' % '–'.join(x for x in m3.groups() if x)
            else:
                t = seg.replace('_', ' ').capitalize()
        out.append(t)
    return ' / '.join(out)


def _jget(it, key):
    for k in JSON_KEYS[key]:
        for kk in (k, k.capitalize()):
            if kk in it:
                return it[kk]
    return None


SITE_TAIL = re.compile(r'^(официальный сайт|на официальном сайте|на страницах каталога|в разделе техническая документация|рекомендуемая схема|'
                       r'для подбора|задать вопрос|каталог продукции завода|американская компания|стандартная схема пневмосистемы)', re.I)


def _join_lines(text):
    """Текст страницы, разорванный на строки посреди фразы («…ресивер\nРВ 110/11\nсочетает…») → абзацы; ссылки на разделы
    сайта и чужая реклама в конце — убираются."""
    paras = []
    for line in str(text or '').replace('\r', '').split('\n'):
        line = re.sub(r'\s+', ' ', line).strip()
        if not line:
            continue
        if paras and (not re.search(r'[.!?:;]$', paras[-1]) or re.match(r'^[a-zа-яё0-9«"(,.:;–—-]', line)) and not line.startswith(('-', '•')):
            paras[-1] = (paras[-1] + ' ' + line).replace(' ,', ',').replace(' .', '.')
        else:
            paras.append(line)
    return '\n'.join(p for p in paras if not SITE_TAIL.match(p))


def _json_desc(d):
    if isinstance(d, str):
        return _join_lines(d)
    out = []
    for b in d or []:
        if isinstance(b, str):
            out.append(b)
            continue
        if not isinstance(b, dict):
            continue
        title = str(b.get('title') or b.get('заголовок') or '').strip().rstrip(':')
        text = str(b.get('text') or b.get('текст') or '').strip()
        items = [str(x).strip() for x in (b.get('items') or b.get('пункты') or []) if str(x).strip()]
        if title:
            out.append(title + ':')
        if text:
            out.append(text)
        out += ['• ' + x.lstrip('•►- ').strip() for x in items]
    return '\n'.join(out)


def _json_specs(s):
    if isinstance(s, dict):
        return [(str(k), str(v)) for k, v in s.items()]
    out = []
    for r in s or []:
        if isinstance(r, dict):
            k = r.get('name') or r.get('k') or r.get('название') or ''
            v = r.get('value') if r.get('value') is not None else r.get('v', r.get('значение', ''))
            u = str(r.get('unit') or r.get('единица') or '').strip()
            v = str(v if v is not None else '').strip()
            if u and v and not v.lower().endswith(u.lower()):
                v = '%s %s' % (v, u)
            out.append((str(k), v))
        elif isinstance(r, (list, tuple)) and len(r) >= 2:
            out.append((str(r[0]), str(r[1])))
    return out


def parse_pages_json(obj):
    """Парс в JSON → те же записи, что parse_pages из CSV."""
    items = obj.get('items') or obj.get('позиции') if isinstance(obj, dict) else obj
    if not isinstance(items, list):
        raise ValueError('В JSON нет списка позиций (items)')
    out, seen = [], set()
    for it in items:
        if not isinstance(it, dict):
            continue
        name, url = str(_jget(it, 'name') or '').strip(), str(_jget(it, 'url') or '').strip()
        if not name or not url or url in seen:
            continue
        seen.add(url)
        pics = _jget(it, 'pictures') or []
        if isinstance(pics, str):
            pics = re.split(r'\s*\|\s*', pics)
        schemes = _jget(it, 'schemes') or []          # схемы и чертежи — в конец галереи
        pics = list(pics) + (re.split(r'\s*\|\s*', schemes) if isinstance(schemes, str) else list(schemes))
        rows = []
        for k, v in _json_specs(_jget(it, 'chars')):
            k, v = k.strip(), v.strip()
            if k and v and not re.match(r'^модель$', k, re.I):
                rows.append((k[:70], v[:300]))
        model = str(_jget(it, 'model') or '').strip() or ' '.join(_code_run(name))     # «Ресивер воздушный РВ 110/11» → «РВ 110/11»
        out.append({'cat': str(_jget(it, 'cat') or _url_cat(url) or 'Без категории').strip()[:80], 'name': name[:300], 'url': url,
                    'pictures': list(dict.fromkeys(str(u).strip() for u in pics if str(u).strip().startswith('http')))[:12],
                    'desc': _json_desc(_jget(it, 'desc'))[:6000], 'chars': rows, 'model': model[:80]})
    if not out:
        raise ValueError('В JSON не нашлось ни одной позиции с названием и ссылкой на страницу товара')
    return out


def parse_pages(data):
    """CSV или JSON парса → [{cat, name, url, pictures, desc, chars:[(k, v)], model}]."""
    text = _decode(data)
    if text.lstrip()[:1] in ('[', '{'):
        try:
            obj = json.loads(text)
        except ValueError as e:
            raise ValueError('JSON не читается: %s' % e)
        return parse_pages_json(obj)
    lines = text.splitlines()
    if not lines:
        raise ValueError('Файл пустой')
    out, seen = [], set()
    table = _pages_table(text) if re.match(r'^"?(категор|назван)', lines[0].strip(), re.I) else None
    for item in (table if table is not None else (lines[1:] if re.match(r'^"?категор', lines[0].strip(), re.I) else lines)):
        model0 = ''
        if table is not None:
            parts, model0 = item[:6], item[6]
        else:
            line = _unwrap(item)
            if not line.strip():
                continue
            parts = None
            try:
                r = next(csv.reader(io.StringIO(line)))
                # кавычка внутри описания («99%;"») сбивает CSV: поле характеристик тогда — хвост описания, а не «ключ: значение | …»
                if len(r) == 6 and _PROD_URL.match(r[2].strip()) and (not r[5].strip() or (
                        re.match(r'^\s*"?[^:|.]{2,70}:', r[5]) and r[5].count(' | ') >= 2)):
                    parts = [x.strip() for x in r]
            except (csv.Error, StopIteration):
                parts = None
            if parts is None:
                parts = _split_line(line)
        if not parts or not parts[1]:
            continue
        cat, name, url, pics, desc, chars = parts
        url = url.strip()
        if url in seen:
            continue
        seen.add(url)
        pictures, have = [], set()
        for u in re.split(r'\s*\|\s*', pics):
            u = u.strip()
            if not u.startswith('http'):
                continue
            base = u.rsplit('/', 1)[-1]
            if base in have:
                continue
            have.add(base)
            pictures.append(u)
        pictures.sort(key=lambda u: 1 if '/cache/' in u else 0)      # оригиналы раньше уменьшенных копий
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
            if re.match(r'^(примечание|все характеристики)', k, re.I) or len(k) > 45 or re.search(r'[.)]\s|^\d', k):
                continue
            v = re.sub(r'""', '"', v)
            v = re.sub(r'(?<=\d)\s*[xх]\s*(?=\d)', ' × ', v) if re.match(r'^\d+\s*[xх]\s*\d+', v) else v
            if re.match(r'^(масса|вес)', k, re.I) and re.fullmatch(r'0([.,]0+)?', v):
                continue
            rows.append((k[:70], v[:300]))
        out.append({'cat': _clean_text(cat)[:80] or 'Без категории', 'name': _clean_text(name)[:300], 'url': url,
                    'pictures': pictures[:12], 'desc': _clean_text(desc)[:6000], 'chars': rows, 'model': model})
    if not out:
        raise ValueError('В файле не нашлось ни одной строки с категорией, названием и ссылкой на страницу товара')
    return out


# ---------------------------------------------------------------- прайс (XLSX)
def _col(ref):
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + ord(ch.upper()) - 64
    return n - 1


def read_xlsx(data):
    """Книга XLSX → [(имя листа, [{номер столбца: текст}, …])]; объединённые ячейки развёрнуты (значение — в каждой)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError('Это не файл Excel (.xlsx)')
    names = set(z.namelist())
    ss = []
    if 'xl/sharedStrings.xml' in names:
        x = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace')
        for si in re.findall(r'<si>(.*?)</si>', x, re.S):
            ss.append(html_mod.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))
    wb = z.read('xl/workbook.xml').decode('utf-8', 'replace')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8', 'replace') if 'xl/_rels/workbook.xml.rels' in names else ''
    rid = {}
    for rel in re.findall(r'<Relationship [^>]*>', rels):
        i, t = re.search(r'\bId="([^"]+)"', rel), re.search(r'\bTarget="([^"]+)"', rel)
        if i and t:
            rid[i.group(1)] = t.group(1)
    out = []
    for m in re.finditer(r'<sheet\b[^>]*>', wb):
        tag = m.group(0)
        nm, ri = re.search(r'\bname="([^"]*)"', tag), re.search(r'\br:id="([^"]+)"', tag)
        if not nm or not ri:
            continue
        target = rid.get(ri.group(1), '')
        p = target.lstrip('/') if target.startswith('/') else 'xl/' + re.sub(r'^(\./)?(xl/)?', '', target)
        if p not in names:
            continue
        x = z.read(p).decode('utf-8', 'replace')
        rows = {}
        for rm in re.finditer(r'<row\b[^>]*?(?:\br="(\d+)")?[^>]*>(.*?)</row>', x, re.S):
            rn = int(rm.group(1)) if rm.group(1) else len(rows) + 1
            cells = {}
            for cm in re.finditer(r'<c\b([^>]*?)(?:/>|>(.*?)</c>)', rm.group(2), re.S):
                attrs, inner = cm.group(1), cm.group(2) or ''
                ref = re.search(r'\br="([A-Z]+)\d*"', attrs)
                ci = _col(ref.group(1)) if ref else len(cells)
                t = re.search(r'\bt="(\w+)"', attrs)
                t = t.group(1) if t else ''
                if t == 'inlineStr':
                    v = html_mod.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))
                else:
                    vm = re.search(r'<v>(.*?)</v>', inner, re.S)
                    v = html_mod.unescape(vm.group(1)) if vm else ''
                    if t == 's' and v:
                        try:
                            v = ss[int(v)]
                        except (ValueError, IndexError):
                            v = ''
                if v != '':
                    cells[ci] = v
            rows[rn] = cells
        for mg in re.findall(r'<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"', x):
            c1, r1, c2, r2 = _col(mg[0]), int(mg[1]), _col(mg[2]), int(mg[3])
            v = (rows.get(r1) or {}).get(c1)
            if v in (None, ''):
                continue
            for r in range(r1, min(r2, r1 + 50) + 1):
                for c in range(c1, min(c2, c1 + 50) + 1):
                    rows.setdefault(r, {}).setdefault(c, v)
        out.append((html_mod.unescape(nm.group(1)), [rows[k] for k in sorted(rows)]))
    if not out:
        raise ValueError('В книге Excel нет листов')
    return out


def _num(v):
    if v is None:
        return None
    s = str(v).strip().replace('\xa0', '').replace(' ', '').replace(',', '.')
    if not re.match(r'^-?\d+(\.\d+)?$', s):
        return None
    return float(s)


def _unit_parts(v):
    """«кВт / В» → ['квт', 'в'], «см / кг  /   r (ü)» → ['см', 'кг', 'r (ü)']; не единица — None."""
    o = re.sub(r'\s+', ' ', str(v).strip())
    s = o.lower()
    if not s:
        return None
    if s in UNITS or s in CUR_WORDS:
        return [o]
    t, to = [x.strip().rstrip('.') for x in s.split('/')], [x.strip().rstrip('.') for x in o.split('/')]
    out, i = [], 0
    while i < len(t):
        if i + 1 < len(t) and t[i] + '/' + t[i + 1] in UNITS:
            out.append(to[i] + '/' + to[i + 1])
            i += 2
        elif t[i] in UNITS or t[i] in CUR_WORDS:
            out.append(to[i])
            i += 1
        else:
            return None
    return out


def _is_unit(v):
    return _unit_parts(v) is not None


def _price_cols(head):
    """Столбцы прайса по текстам шапки: {sku, name, short, price, opts:[(col, подпись)], specs:[(col, подпись)]}."""
    c = {'sku': None, 'name': None, 'short': None, 'price': None, 'opts': [], 'specs': []}
    for col in sorted(head):
        t = re.sub(r'\s+', ' ', head[col]).strip()
        tl = t.lower()
        if not t or JUNK.match(t):
            continue
        if re.match(r'^(артикул|код sap|код)$', tl) and c['sku'] is None:
            c['sku'] = col
        elif ('печатн' in tl or re.match(r'^номе?н?клатура', tl)) and c['short'] is None:
            c['short'] = col
        elif re.match(r'^(модель|название|наименование)', tl) and c['name'] is None:
            c['name'] = col
        elif re.match(r'^(отпускная )?(стоимость|цена)', tl) and not re.search(r'опци|(?<!от)пуск|охл|рекуперац|grease|смазк', tl) and c['price'] is None:
            c['price'] = col
        elif re.match(r'^(стоимость|цена)', tl) or 'grease' in tl:
            c['opts'].append((col, re.sub(r'^(стоимость|цена)( опции)?\s*[-–—:]?\s*', '', t, flags=re.I).strip(' -') or t))
        else:
            c['specs'].append((col, t))
    return c


def _opt_name(t):
    return re.sub(r'\s*\((?:cold start|soft start|w|heat recovery|fs|fgo)\)\s*$', '', t, flags=re.I).strip()[:60]


def parse_price(data):
    """XLSX прайса → ([{sku, name, short, price, cur, opts:[(подпись, цена)], specs:[(k, v)], sheet, title, group}], листы).
    На листе может быть несколько таблиц со своей шапкой (АСО: фильтры, затем осушители) — каждая читается своей шапкой."""
    book = read_xlsx(data)
    out, sheets = [], []
    for sname, rows in book:
        hrs = [i for i, r in enumerate(rows) if any(str(v).strip() in HEAD_WORDS for v in r.values())]
        if not hrs:
            continue
        title = ''
        for r in rows[:3]:
            v = str(r.get(0, '')).strip()
            if len(v) > 6 and not JUNK.match(v):
                title = re.sub(r'\s+', ' ', v)[:100]
                break
        tops = [i for k, i in enumerate(hrs) if k == 0 or i - hrs[k - 1] > 3]      # строки шапки подряд — одна шапка
        n0, cur0, items, prev = len(out), '', [], None
        for k, hr in enumerate(tops):
            end = tops[k + 1] if k + 1 < len(tops) else len(rows)
            got, cur, prev = _price_block(rows, hr, end, max(0, hr - 3) if k == 0 else hr, sname, title, prev)
            items.extend(got)
            cur0 = cur0 or cur
        out.extend(items)
        if items:
            sheets.append({'name': sname, 'rows': len(out) - n0, 'withPrice': sum(1 for x in items if x['price']), 'cur': cur0})
    if not out:
        raise ValueError('В прайсе не нашлось листов с шапкой «Артикул / Модель / Стоимость»')
    return out, sheets


NOTE_ROW = re.compile(r'^([-*rü]\s|\*)')        # сноски под таблицей: «r - стоимость упаковки…», «* Расход абразива…»


def _price_block(rows, hr, end, lo, sname, title, prev=None):
    """Одна таблица листа: шапка в строке hr, данные до end. Шапка без столбца названия — столбцы прошлой таблицы (prev)."""
    ur = next((i for i in range(hr, min(hr + 5, end)) if sum(1 for v in rows[i].values() if _is_unit(v)) >= 3), None)
    hi = ur if ur is not None else hr + 1
    head = {}
    for i in range(lo, hi):
        vals = {col: re.sub(r'\s+', ' ', str(v)).strip() for col, v in rows[i].items()}
        wide = {v for v in vals.values() if list(vals.values()).count(v) >= (3 if i < hr else 5)}   # название листа и завода — объединены
        for col, v in vals.items():
            if i < hr and (_num(v) is not None or re.match(r'^\(?лист\b', v, re.I)):     # номер листа и дата над шапкой
                continue
            # объединённые ячейки повторяют текст в каждой строке и столбце — название листа и повторы шапки не нужны
            if v and v not in wide and not JUNK.match(v) and not (_is_unit(v) and v not in HEAD_WORDS) and not head.get(col, '').endswith(v):
                head[col] = (head.get(col, '') + ' ' + v).strip()
    units = rows[ur] if ur is not None else {}
    for col, u in units.items():        # столбец с единицей, но без подписи (шапка объединена криво) — подпись по единице
        if col not in head and str(u).strip().lower() in UNIT_LABEL:
            head[col] = UNIT_LABEL[str(u).strip().lower()]
    c = _price_cols(head)
    if c['name'] is None and prev:
        c, units = prev
    if c['name'] is None:
        return [], '', prev
    cur = ''
    if c['price'] is not None:
        cur = CUR_WORDS.get(str(units.get(c['price'], '')).strip().lower(), '')
        if not cur:
            m = re.search(r'\((евро|eur|руб|usd|\$|€|₽)\.?\)', head.get(c['price'], ''), re.I)
            cur = CUR_WORDS.get(m.group(1).lower(), '') if m else ''
    group = ''
    if hr > 0:                          # подзаголовок таблицы над шапкой
        v = {str(x).strip() for x in rows[hr - 1].values()} - {''}
        if len(v) == 1 and len(rows[hr - 1]) >= 4:
            group = _group_name(v.pop())
    items = []
    for i in range((ur if ur is not None else hr) + 1, end):
        r = rows[i]
        vals = {str(v).strip() for v in r.values()} - {''}
        if len(vals) <= 2 and len(r) >= 4:          # строка-раздел на всю ширину («Воздушные вертикальные ресиверы…») или сноска
            v = sorted(vals)[0]
            if not NOTE_ROW.match(v) and not re.search(r'упаковк', v, re.I):
                group = _group_name(v)
            continue
        name = re.sub(r'\s+', ' ', str(r.get(c['name'], ''))).strip().rstrip('*').strip()
        if not name or len(name) < 3 or name in HEAD_WORDS or JUNK.match(name) or NOTE_ROW.match(name) or re.match(r'^цены ', name, re.I):
            continue
        price = _num(r.get(c['price'])) if c['price'] is not None else None
        if price is None and c['price'] is not None:          # цена группы в соседней строке без названия (варианты по давлению)
            for j in (i - 1, i + 1, i + 2):
                if 0 <= j < len(rows) and not str(rows[j].get(c['name'], '')).strip():
                    price = _num(rows[j].get(c['price']))
                    if price is not None:
                        break
        opts = []
        for col, label in c['opts']:
            v = _num(r.get(col))
            if v:
                opts.append((_opt_name(label), round(v, 2)))
        specs = []
        for col, label in c['specs']:
            v = str(r.get(col, '')).strip()
            if not v or v in ('-', '—', '–', 'r', 'ü') or re.match(r'^(модель|номе?н?клатура)$', label, re.I):
                continue
            u = str(units.get(col, '')).strip()
            if u.lower().rstrip('.') in ('модель', 'тип', 'r', 'марка', 'материал', 'g') or u.lower() in CUR_WORDS:
                u = ''
            if re.fullmatch(r'(макс|мин)\.?', u, re.I):        # «Давление, Бар» над столбцами «Макс.» и «Мин.»
                label, u = '%s %s' % (u, label[:1].lower() + label[1:]), ''
            for sp in _spec_split(label, v, u):
                if sp not in specs:              # объединённые ячейки шапки дают повторы столбцов
                    specs.append(sp)
        sku = str(r.get(c['sku'], '')).strip() if c['sku'] is not None else ''
        if sku in ('-', '—'):
            sku = ''
        short = re.sub(r'\s+', ' ', str(r.get(c['short'], ''))).strip()[:120] if c['short'] is not None else ''
        items.append({'sku': sku[:40], 'name': name[:300], 'short': '' if _num(short) is not None else short,
                      'price': round(price, 2) if price else None, 'cur': cur, 'opts': opts, 'specs': specs, 'sheet': sname, 'title': title,
                      'group': group})
    return items, cur, (c, units)


def _group_name(v):
    v = re.split(r'[\r\n]', str(v).strip())[0]
    return re.split(r'(?<=[а-яА-Я])\s+для\s|[.,(]', re.sub(r'\s+', ' ', v))[0].strip()[:80]


UNIT_LABEL = {'бар': 'Макс. давление', 'квт': 'Мощность', 'кг': 'Масса', 'дб': 'Уровень шума', 'м³/мин': 'Производительность', 'м3/мин': 'Производительность',
              'л/мин': 'Производительность', 'м³/ч': 'Производительность', 'м3/час': 'Производительность', 'лит': 'Объём ресивера', 'л': 'Объём ресивера'}
SPEC_UNITS = {'лит': 'л', 'м3/мин': 'м³/мин', 'м3/час': 'м³/ч', 'м3/ч': 'м³/ч', 'кВт.': 'кВт', 'кВт/ч': 'кВт', 'дБ(А)': 'дБ', 'мбар': 'мбар', '(л)': 'л', '(кг)': 'кг'}


def _spec_split(label, v, u):
    """Составной столбец: «Габариты / Масса / Упаковка» «81 х 41 х 64 / 65» «см / кг / r (ü)» → [(Габариты, 81×41×64 см), (Масса, 65 кг)]."""
    us = _unit_parts(u) if u else None
    vs = [x.strip() for x in re.split(r'\s+/\s+', v)]
    ls = [x.strip() for x in label.split(' / ')]
    if us and len(us) > 1 and len(vs) > 1:
        if len(ls) >= len(vs):
            return [(ls[k][:60], _spec_val(vs[k], us[k] if k < len(us) else '')) for k in range(len(vs))]
        if len(ls) == 1 and len(vs) == len(us):
            return [(label[:60], ' / '.join(_spec_val(vs[k], us[k]) for k in range(len(vs))))]
    return [(label[:60], _spec_val(re.sub(r'\s+', ' ', v), us[0] if us else u))]


def _spec_val(v, u):
    u = SPEC_UNITS.get(str(u).strip(), str(u).strip())
    v = str(v).strip()
    n = _num(v)
    if n is not None:
        v = ('%d' % n) if float(n).is_integer() else ('%.3f' % n).rstrip('0').rstrip('.').replace('.', ',')
    v = v.replace('x', '×').replace('х', '×') if re.match(r'^\d+\s*[xх×]\s*\d+', v) else v
    return ('%s %s' % (v, u)) if u and re.match(r'^[-+]?\d', v) and not re.search(r'["\'“”]|^\d+/\d+$|^DN', v) else v


# ---------------------------------------------------------------- описание: без рекламы и мусора, с абзацами и списком
JUNK_SENT = re.compile(r'\bваш(е|ем|у|им|их|а|и)?\b|\bвам\b|верный способ|обратитесь|звоните|позвоните|менеджер|оставьте заявку|заказать|купить|'
                       r'\bцен[аыу]\b|доставк|примерн|индивидуально|согласно проекту|официальн\S* (дилер|представител|поставщик)|'
                       r'в наличии|со склада|гарантия качества|лучшее решение|не имеет аналогов|по выгодн|скидк|акци[яи]\b|\bоплат|\bфишк', re.I)
HEAD_RX = re.compile(r'\s*(технические особенности|главное о серии|общие характеристики|основные характеристики|основные преимущества|особенности|преимущества|опции|комплектация|применение|области применения)([^:\n•]{0,50}):\s*', re.I)


LIST_HEAD_RX = re.compile(r'(Общие характеристики|Основные характеристики|Основные преимущества)\s+([^.:\n•►]{20,}?)(?=\s*(?:$|\n|\.\s|Технические особенности|Опции))')


def _list_items(m):
    """«Общие характеристики Высокоэффективный блок Электронная система управления Быстрое подключение…» (перечень без
    знаков — пункты с заглавной буквы) → «Общие характеристики:» и список «• …»."""
    items = [x.strip(' ,;') for x in re.split(r'\s+(?=[А-ЯЁ][а-яё])(?<![«/]\s)', m.group(2)) if x.strip(' ,;')]
    if len(items) < 3:
        return m.group(0)
    return '\n' + m.group(1) + ':\n' + '\n'.join('• ' + x for x in items) + '\n'


BLOCK_LABELS = {'Назначение', 'Конструкция и принцип работы', 'Диапазон серии', 'Исполнения', 'Особенности', 'Технические особенности',
                'Главное о серии', 'Общие характеристики', 'Преимущества', 'Опции', 'Комплектация', 'Применение', 'Описание',
                'Устройство', 'Исполнения и опции'}
# схема блоков карточки: «Назначение», «Устройство», «Преимущества», «Исполнения и опции», «Комплектация»; заголовки страниц
# поставщиков сводятся к ней, одноимённые блоки объединяются
BLOCK_MAP = {'Конструкция и принцип работы': 'Устройство', 'Технические особенности': 'Преимущества', 'Общие характеристики': 'Преимущества',
             'Главное о серии': 'Преимущества', 'Особенности': 'Преимущества', 'Опции': 'Исполнения и опции', 'Исполнения': 'Исполнения и опции',
             'Диапазон серии': 'Исполнения и опции', 'Применение': 'Назначение'}
BLOCK_ORDER = ['Назначение', 'Устройство', 'Преимущества', 'Исполнения и опции', 'Комплектация']


def clean_desc(text):
    """Описание со страницы → текст без «воды»: вводный абзац, подзаголовки, список «• …»; повторы и рекламные фразы убраны."""
    t = html_mod.unescape(str(text or '')).replace('\xa0', ' ')
    t = LIST_HEAD_RX.sub(_list_items, t)
    t = re.sub(r'["«»]{2,}|\s*"\s*;|\s*"(?=\s|$)|(?<=\s)"\s*', ' ', t)      # сломанные кавычки из CSV
    t = re.sub(r'\s*[►▪■●♦➢➤✓]\s*(?=[А-ЯA-Zа-я0-9])|\s+-\s+(?=[А-Я])', '\n• ', t)
    keep = {}                   # заголовки блоков отдельной строкой («Исполнения и опции:») — не разбирать на подзаголовки
    for lab in sorted(BLOCK_LABELS, key=len, reverse=True):
        tok = '\x00%d\x00' % len(keep)
        t2 = re.sub(r'(?m)^\s*' + re.escape(lab) + r':\s*$', tok, t)
        if t2 != t:
            keep[tok], t = lab + ':', t2
    t = HEAD_RX.sub(lambda m: '\n' + m.group(1).strip().capitalize() + ':\n', t)
    for tok, lab in keep.items():
        t = t.replace(tok, '\n' + lab + '\n')
    t = t.replace('С°', '°C').replace('C°', '°C').replace('м3/', 'м³/').replace('м3 /', 'м³/')
    out, seen = [], set()
    for line in t.split('\n'):
        line = re.sub(r'\s+', ' ', line).strip()
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
            if (len(key) < 8 and not sent.endswith(':')) or key in seen:
                continue
            if JUNK_SENT.search(body) and not sent.endswith(':'):
                continue
            seen.add(key)
            out.append(('• ' + body) if sent.startswith('• ') else (sent if sent.endswith(':') else body))
    # подзаголовок без пунктов после него не нужен (кроме заголовков блоков карточки: «Назначение:» и т. п. — перед абзацем)
    res = []
    for i, x in enumerate(out):
        nxt = out[i + 1] if i + 1 < len(out) else ''
        if x.endswith(':') and not nxt.startswith('• ') and not (x[:-1] in BLOCK_LABELS and nxt and not nxt.endswith(':')):
            continue
        res.append(x)
    return '\n'.join(res)[:4000].strip()


# ---------------------------------------------------------------- описание → логичные блоки карточки
HEAD_LABEL = {'технические особенности': 'Технические особенности', 'главное о серии': 'Главное о серии', 'особенности': 'Особенности',
              'общие характеристики': 'Общие характеристики', 'основные характеристики': 'Общие характеристики', 'основные преимущества': 'Преимущества',
              'преимущества': 'Преимущества', 'опции': 'Опции', 'комплектация': 'Комплектация', 'применение': 'Применение',
              'области применения': 'Применение'}
PURPOSE_RX = re.compile(r'предназначен|применя(ет|ют)ся|использу(ет|ют)ся|решает|для предприятий|подходит для|отрасл|задач', re.I)
DESIGN_RX = re.compile(r'принцип|конструкц|состоит|состав|оборудован|оснащ|установлен|теплообменник|контроллер|двигател|блок|корпус|кожух|'
                       r'панел|клапан|фильтр|систем|привод|ресивер|сенсорн|экран|датчик|колонн|адсорбент|сито|сечени|ремен|подшипник|ротор|'
                       r'сепаратор|шкаф|отсек|насос|охлажден|цилиндр', re.I)
PARAM_RX = re.compile(r'^(производительность|давление|избыточное давление|рабочее давление|вакуум|разрежение|мощность|расход|напряжение|'
                      r'точка росы|объ[её]м|чистота|уровень шума)\b[^.]{0,70}\.?$', re.I)
VARIANT_RX = re.compile(r'исполнени', re.I)
BLOCK_LIMIT = 12


def _sents(t):
    return [x.strip() for x in re.split(r'(?<=[.!?])\s+(?=[А-ЯA-Z0-9«(])', t) if x.strip()]


def _intro_blocks(prose, bullets):
    """Вводный текст без подзаголовков: назначение → конструкция и принцип работы → диапазон серии → исполнения/особенности."""
    buckets = {'Назначение': [], 'Конструкция и принцип работы': [], 'Диапазон серии': []}
    cur = 'Назначение'
    sents = [s for line in prose for s in _sents(line)]
    for i, s in enumerate(sents):
        if PARAM_RX.match(s):
            buckets['Диапазон серии'].append(s)
            continue
        if cur == 'Назначение' and i > 0 and not PURPOSE_RX.search(s) and DESIGN_RX.search(s):
            cur = 'Конструкция и принцип работы'
        buckets[cur].append(s)
    out = [(lab, ' '.join(v)) for lab, v in buckets.items() if v and lab != 'Диапазон серии']
    if buckets['Диапазон серии']:
        out.append(('Диапазон серии', '\n'.join('• ' + s for s in buckets['Диапазон серии'])))
    if bullets:
        lab = 'Исполнения' if sum(1 for b in bullets if VARIANT_RX.search(b)) * 2 >= len(bullets) else 'Особенности'
        out.append((lab, '\n'.join(bullets)))
    return out


def desc_blocks(text):
    """Очищенное описание (clean_desc) → список блоков карточки [(заголовок, текст)]: вводный текст делится на «Назначение»,
    «Конструкция и принцип работы», «Диапазон серии», «Исполнения»; подзаголовки страницы («Технические особенности:»,
    «Главное о серии:», «Опции:»…) становятся отдельными блоками. Без структуры — один блок «Описание»."""
    text = str(text or '').strip()
    if not text:
        return []
    sections, cur = [], {'label': '', 'prose': [], 'bullets': []}
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        if line.endswith(':') and not line.startswith('• ') and len(line) <= 60:
            if cur['prose'] or cur['bullets']:
                sections.append(cur)
            key = line[:-1].strip().lower()
            cur = {'label': HEAD_LABEL.get(key) or (line[:-1].strip()[:1].upper() + line[:-1].strip()[1:]), 'prose': [], 'bullets': []}
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
    out = [(lab, t) for lab, t in out if t.strip()]
    if len(out) == 1 and sections and not sections[0]['label']:
        return [('Описание', out[0][1])]
    merged = {}
    for lab, t in out:          # к схеме блоков; одинаковые пункты не повторяются
        lab = BLOCK_MAP.get(lab, lab)
        if lab not in merged:
            merged[lab] = t
            continue
        have = set(merged[lab].split('\n'))
        add = [x for x in t.split('\n') if x not in have]
        if add:
            merged[lab] += ('\n' if merged[lab] else '') + '\n'.join(add)
    order = {k: i for i, k in enumerate(BLOCK_ORDER)}
    return sorted(merged.items(), key=lambda kv: order.get(kv[0], len(order)))[:BLOCK_LIMIT]


# ---------------------------------------------------------------- характеристики: парс + прайс (прайс точнее)
SPEC_CLASS = [
    ('pressure_min', r'^мин\S*\s+давлен'), ('pressure_in', r'давлен\S*\s+на входе'), ('vacuum', r'разряжени|вакуум'),
    ('relay', r'реле\s+давлени'), ('pressure', r'давлен'), ('flow_out', r'по\s+нагнетани|привед'), ('flow_clean', r'по\s+очистке'), ('flow_rpm', r'при\s+оборотах'),
    ('flow', r'производительн|пропускн\S*\s+способн'), ('power', r'мощност'),
    ('dims', r'габарит'), ('length', r'^(длина|глубина)'), ('width', r'^ширина'), ('height', r'^высота'), ('mass_ads', r'масс\S*\s+адсорбент'),
    ('mass', r'^(масса|вес|общий вес)'), ('noise', r'шум'), ('outlet', r'выход\S*,?\s+сжатого|^соединение$|^присоединительн|соединение по воздуху'),
    ('receiver', r'ресивер|^объ[её]м$'), ('dryer', r'встроенн\S*\s+осушител|модель осушителя'), ('filters', r'встроенн\S*\s+фильтр|тип фильтров|фильтры в составе'),
    ('voltage', r'напряжени'), ('refrigerant', r'хлад(о|а)гент'), ('controller', r'контроллер'), ('cartridge', r'картридж|катридж'),
    ('purity', r'чистот'), ('country', r'страна'), ('ip', r'степень защиты'), ('rpm', r'скорост\S*\s+вращени'),
]
SPEC_LABEL = {'pressure_min': 'Минимальное давление', 'pressure_in': 'Давление на входе', 'vacuum': 'Максимальное разрежение', 'pressure': 'Давление',
              'flow': 'Производительность', 'power': 'Мощность', 'dims': 'Габариты (Д × Ш × В)', 'mass': 'Масса', 'mass_ads': 'Масса адсорбента',
              'noise': 'Уровень шума', 'outlet': 'Выход сжатого воздуха', 'receiver': 'Объём ресивера', 'dryer': 'Встроенный осушитель',
              'filters': 'Встроенные фильтры', 'voltage': 'Напряжение', 'refrigerant': 'Хладагент', 'controller': 'Контроллер', 'cartridge': 'Картридж',
              'purity': 'Чистота', 'rpm': 'Скорость вращения'}
SPEC_DROP = re.compile(r'^(аналог|примечание|все характеристики|new price|количество комментариев|тема форума|похожие товары)', re.I)
# единица в названии характеристики («Давление, атм.», «Габариты, см») — переносится в значение
KEY_UNIT = re.compile(r'^(.*?\S)\s*,\s*(атм\.?|бар|л\.?|л/мин\.?|квт(?:/в)?|см|мм|кг\.?|дба|дб\(а\)|°\s?[cс]|град,?\s*°?[cс]|г/час|лет|'
                      r'м³/мин|м3/мин|мг/м³|мг/м3|мкм|м²/ч|м2/ч|м|час|дюйм)$', re.I)
UNIT_FIX = {'атм.': 'атм', 'л.': 'л', 'л/мин.': 'л/мин', 'кг.': 'кг', 'дба': 'дБ(А)', 'квт': 'кВт', 'м3/мин': 'м³/мин', 'мг/м3': 'мг/м³', 'м2/ч': 'м²/ч'}
# подписи прайса и сайта АСО → одна подпись для одинаковых характеристик
SPEC_RENAME = [
    (r'^(макс\.?\s*раб(\.|очее)?\s*давл(\.|ение)?|макс\.?\s*давление|рабочее давление|давление)$', 'Давление'),
    (r'^мин\.?\s*давление$', 'Минимальное давление'),
    (r'^(произв\.?|производит\.?)$', 'Производительность'),
    (r'^(произв\.?\s*привед\.?\s*к\s*н\.?\s*услов\.?|произв\.?\s*по\s*нагнетанию)$', 'Производительность по нагнетанию'),
    (r'^произв\.?\s*при оборотах$', 'Производительность при оборотах'),
    (r'^произв(\.|одительность)?\s*по очистке( поверхности)?$', 'Производительность по очистке'),
    (r'^(объем ресивера|ресивер)$', 'Объём ресивера'), (r'^объем$', 'Объём'), (r'^объем камеры$', 'Объём камеры'),
    (r'^(вход\s*/\s*выход|выход)$', 'Вход/выход'), (r'^(сталь|марка стали)$', 'Марка стали'),
    (r'^расход абразива на 1\s*м[2²]\*?$', 'Расход абразива на 1 м²'), (r'^рекоменд\.?\s*рабочее давление$', 'Рабочее давление'),
]
POWER_KEY = re.compile(r'^(привод|эл\.?\s*питание|электропривод)$', re.I)


def _spec_rows(k, v):
    """Строка характеристики → строки каталога: единица из названия — в значение, подписи АСО — к общим, «Привод 2,2 / 380»
    — мощность и напряжение, габариты в сантиметрах — в миллиметрах."""
    k = re.sub(r'\s+', ' ', re.sub(r'^[PР](?=асход)', 'Р', str(k or '').strip()))
    k = re.sub(r'(?i)производит\s+ельн', 'Производительн', k)       # перенос внутри слова в шапке прайса
    v = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    k = re.sub(r'^C(?=тепень)', 'С', k)
    unit = ''
    m = KEY_UNIT.match(k) or re.match(r'^(.*?\S)\s+(мг/м3|мг/м³|мкм)$', k)        # «Степень очистки по воде мг/м3»
    if m:
        k, unit = m.group(1), m.group(2)
    m = re.match(r'^(наружное покрытие),\s*(.+)$', k, re.I)         # «Наружное покрытие, полиэфирная порошковая краска: RAL 5010»
    if m:
        k, v = m.group(1), '%s %s' % (m.group(2), v)
    unit = re.sub(r'^град,?\s*°?[cс]$|^°\s?[cс]$', '°C', unit, flags=re.I)
    unit = UNIT_FIX.get(unit.lower(), unit)
    v = re.sub(r'(?<=\d)\s*град,?\s*°?[CС]$|(?<=\d)\s*°\s?С$', ' °C', v)
    for rx, label in SPEC_RENAME:
        if re.match(rx, k, re.I):
            k = label
            break
    if POWER_KEY.match(k):
        main = 'Мощность' if re.match(r'^эл', k, re.I) else 'Мощность двигателя'
        if not re.match(r'^\d', v):
            return [('Двигатель', v)] if v else []
        parts = [x.strip() for x in re.split(r'\s*/\s*', v) if x.strip()]
        out = []
        for i, x in enumerate(parts[:2]):
            n = re.sub(r'\s*(кВт|В)$', '', x, flags=re.I).replace('.', ',')
            n = re.sub(r'\s*[*×xх]\s*', ' × ', n)                   # «2*75» — два двигателя
            m = re.match(r'^([\d ×,]+?)\s*(\(.*\))$', n)              # «11(S=1,15)» → «11 кВт (S=1,15)»
            u = 'В' if i == 1 else 'кВт'
            out.append(('Напряжение' if i == 1 else main, '%s %s %s' % (m.group(1), u, m.group(2)) if m else '%s %s' % (n, u)))
        return [_spec_fix(a, b) for a, b in out]
    v = re.sub(r'^(\d+)\.(\d+)$', r'\1,\2', v)
    if unit and re.match(r'^([-+−≤<]?\s*\d|до\b|от\b|не более|не менее)', v, re.I) and not re.search(r'[a-zа-я°³²"]\.?\s*$', v, re.I):
        v = '%s %s' % (v, unit)
    if unit == 'кВт' and re.match(r'^\d+\s*[*×xх]\s*\d', v):
        v = re.sub(r'\s*[*×xх]\s*', ' × ', v)
    if spec_class(k) == 'dims':
        nums = re.findall(r'\d+(?:[.,]\d+)?', v)
        if re.search(r'см\s*$', v) or (unit == 'см' and nums):
            v = re.sub(r'\s*(см|мм)\s*$', '', v)
            vals = [float(x.replace(',', '.')) for x in nums]
            if vals and max(vals) < 1000:        # «7515*2540*2495» с подписью «см» — это уже миллиметры
                v = ' × '.join(('%g' % (x * 10)).replace('.', ',') for x in vals)
            else:
                v = re.sub(r'\s*[*×xхX]\s*', ' × ', v)
            v += ' мм'
    if re.match(r'^условия эксплуатации|температур', k, re.I) and re.search(r'\d$', v) and '°' not in v:
        v += ' °C'
    return [_spec_fix(k, v)]



def spec_class(key):
    k = re.sub(r'\s*\([^)]*\)\s*$', '', str(key or '')).strip().lower()
    k = re.sub(r'(?<=[а-я])-(?=[а-я])', '', k)         # «Производи-тельность» — перенос в ячейке прайса
    for c, rx in SPEC_CLASS:
        if re.search(rx, k):
            return c
    return 'k:' + re.sub(r'[^а-яa-z0-9]', '', k)


def _tidy_label(k):
    k = re.sub(r'\s+', ' ', str(k or '')).strip(' *:')
    k = re.sub(r'\*+$', '', k).strip()
    words = k.split(' ')
    if len(words) == 2 and words[0].lower() == words[1].lower():        # «Ширина ширина» — склейка объединённых ячеек
        k = words[0]
    k = re.sub(r'\s*\((Д[/хx×]Ш[/хx×]В)\)|\s+Д[/хx×]Ш[/хx×]В$', '', k)
    k = k.replace('Производи-тельность', 'Производительность').replace('приблизительно', '').replace('Максиальное', 'Максимальное').strip()
    if re.fullmatch(r'[A-ZА-Я]', k):
        k = 'Размер ' + k
    return k[:60]


EMPTY_VALS = {'-', '—', '–', 'нет данных', 'n/a', 'нет', ''}


def _spec_fix(k, v):
    """Строка характеристики: без прочерков, единицы без скобок («2,49 (м³/мин)»), «IE5» в «Степени защиты» — класс
    энергоэффективности, производительность без единиц (сайт пишет л/мин) — с единицами."""
    k = re.sub(r'(?<=[а-я])-(?=[а-я])', '', str(k or '').strip())
    v = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    if v.lower() in EMPTY_VALS or re.match(r'^[а-яa-z]', k) or re.match(r'^артикул\s*\d', k, re.I):
        return k, ''                        # «имеют температурный режим…», «Артикул 6006400004» — обрывки примечаний прайса
    m = re.match(r'^(?:размер\s+)?([A-HА-ЕНa-h])(?:\s*\(мм\))?$', k, re.I)
    if m:                                   # размеры на чертеже: «A (мм)», «Размер А» (кириллица) — одинаково
        lat = m.group(1).upper().translate(str.maketrans('АВСЕН', 'ABCEH'))
        k = 'Размер %s, мм' % lat
        v = re.sub(r'\s*мм$', '', v)
    v = re.sub(r'\s*\((м³/мин|м3/мин|м³/ч|м3/ч|л/мин|нм3/час|нм³/ч|бар|л|кг|мм|кВт|дБ)\)', r' \1', v)
    for rx, rp in ((r'(?<=\d)\s*bar\b', ' бар'), (r'(?<=\d)\s*m3/min\b', ' м³/мин'), (r'(?<=\d)\s*dB\s*\(A\)', ' дБ(А)'),
                   (r'(?<=\d)\s*dB\b', ' дБ'), (r'^IP\s+(\d\d)$', r'IP\1'), (r'(?<=\d)\s*kW\b', ' кВт'),
                   (r'(?<=\d)\s*V\b', ' В'), (r'(?<=\d)\s*Hz\b', ' Гц'), (r'\s*В/Гц$', ''), (r'\bБар\b', 'бар'),
                   (r'(?<=\d)\s*(нм3|нм³)\s*/\s*час?\b', ' нм³/ч'), (r'(?<=\d)\s*м3\s*/\s*(мин|час|ч)\b', r' м³/\1'), (r'(?<=\d)м³', ' м³'),
                   (r'м³/час\b', 'м³/ч'), (r"''|”|“", '"'), (r'(?<=\d)\s*литр\w*', ' л'), (r'Гц\s+В$', 'Гц')):
        v = re.sub(rx, rp, v, flags=re.I)
    if re.match(r'^степень защиты', k, re.I) and re.match(r'^IE\d', v):
        k = 'Класс энергоэффективности'
    c = spec_class(k)
    if c == 'dims':                         # «1940 X 950 X 2125 ДхШхВ мм» → «1940 × 950 × 2125 мм»
        v = re.sub(r'\(?\s*Д\s*[хx×]\s*Ш\s*[хx×]\s*В\s*\)?', ' ', v, flags=re.I)
        v = re.sub(r'(?<=\d)\s*[xхX×]\s*(?=\d)', ' × ', v).strip()
        v = re.sub(r'\s+', ' ', v)
        if re.search(r'\d$', v):
            v += ' мм'
    if c == 'receiver' and re.fullmatch(r'\d+(?:\s*[×x]\s*\d+)?', v):
        v = re.sub(r'\s*[×x]\s*', ' × ', v) + ' л'
    if c == 'flow' and re.fullmatch(r'\d+(?:[.,]\d+)?', v) and not re.search(r'\(', k):
        n = float(v.replace(',', '.'))
        v = ('%s л/мин' % v) if n >= 60 else ('%s м³/мин' % v)
    return k, v


def merge_specs(parse_rows, price_specs):
    """Строки характеристик: парс, затем прайс; одинаковые параметры (давление, производительность, мощность, габариты, масса…)
    берутся из прайса — он точнее; «Длина/Ширина/Высота» прайса складываются в габариты."""
    rows, idx = [], {}
    for k, v in (r for kv in parse_rows for r in _spec_rows(*kv)):
        if SPEC_DROP.match(k) or not v:
            continue
        c = spec_class(k)
        if c in idx:
            continue
        idx[c] = len(rows)
        rows.append([k, v])
    dims = {}
    for k, v in (r for kv in price_specs for r in _spec_rows(*kv)):
        if SPEC_DROP.match(k) or not v:
            continue
        c = spec_class(k)
        if c in ('length', 'width', 'height'):
            dims[c] = (_tidy_label(k), v)
            continue
        label = SPEC_LABEL.get(c) or _tidy_label(k)
        if c in idx:
            if not str(rows[idx[c]][1]).lower().startswith(str(v).lower()):   # «YNT55A (Baosi)» в парсе полнее «YNT55A» прайса
                rows[idx[c]][1] = v           # прайс точнее парса
            if c.startswith('k:'):
                rows[idx[c]][0] = rows[idx[c]][0]
        else:
            idx[c] = len(rows)
            rows.append([label, v])
    if len(dims) == 3 and all(re.search(r'^[\d.,\s]+(мм)?$', str(dims[c][1])) for c in dims):
        v = '%s × %s × %s мм' % tuple(re.sub(r'\s*мм$', '', str(dims[c][1])) for c in ('length', 'width', 'height'))
        if 'dims' in idx:
            rows[idx['dims']][1] = v
        else:
            rows.append([SPEC_LABEL['dims'], v])
    else:                                   # одна «Длина» (рукав 10 м) — это не габариты
        rows += [[lb, v] for c, (lb, v) in dims.items() if c not in idx]
    return [(k, str(v)[:300]) for k, v in rows]


# ---------------------------------------------------------------- сопоставление парса и прайса
def _norm(s):
    s = str(s or '').lower().replace('ё', 'е').replace('х', 'x').replace('–', '-').replace('—', '-').replace(',', '.')
    s = re.sub(r'\s*\((?:compact|o)\)\s*$', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def _key(s):
    return re.sub(r'[^a-z0-9а-я]', '', _norm(s))


def _model_key(s):
    """Код модели из названия: слова с цифрами и латиница заглавными («Осушитель DryAir DA 440» → «dryairda440»)."""
    words = [w for w in re.split(r'\s+', str(s or '')) if re.search(r'\d', w) or (len(w) > 1 and re.fullmatch(r'[A-Za-z][A-Za-z-]*', w) and w.upper() == w)]
    return _key(' '.join(words))


def _model_set(s):
    """Те же слова модели, но как множество — порядок слов в прайсе и на сайте бывает разным («EAGLE-N VSD 132 7,5 BAR» и «EAGLE-N 132-7,5 VSD»)."""
    words = []
    for w in re.split(r'[\s/]+', str(s or '').replace('–', '-').replace('—', '-')):
        w = w.strip('(),;')
        if not w or w.lower() in ('bar', 'бар') or not (re.search(r'\d', w) or re.fullmatch(r'[A-Z][A-Z-]*', w)):
            continue
        words.extend(x.lower().replace(',', '.') for x in re.split(r'-(?=[A-Za-z\d])', w) if x)
    return frozenset(words) if len(words) >= 2 else None


def _char(pg, rx):
    for k, v in pg.get('chars') or []:
        if re.search(rx, k, re.I):
            v = str(v).strip()
            return '' if v in ('-', '—', '–', 'нет', 'Нет') else v
    return ''


def page_cfg(pg):
    """Исполнение позиции парса: по названию и характеристикам (давление, ресивер, осушитель) — как model_cfg у прайса."""
    cfg = model_cfg(pg['name'], pg['name'])
    p = _num_attr(re.sub(r'[^\d,.]', '', _char(pg, r'^давление')).replace(',', '.') or None)
    if p:
        cfg['p'] = p
    rv = _char(pg, r'объ[её]м ресивера')
    m2 = re.match(r'^\s*(\d+)\s*[xх×]\s*(\d+)', rv, re.I)          # «2 × 270» — два ресивера
    rec = int(m2.group(1)) * int(m2.group(2)) if m2 else _num_attr(re.sub(r'[^\d,.]', '', rv) or None)
    if rec and rec >= 50:
        cfg['rec'] = int(rec)
    if _char(pg, r'модель осушителя') or re.search(r'\d+d$', (pg.get('url') or '').rstrip('/'), re.I):
        cfg['dry'] = True
    return cfg


def _lat(c):
    return tuple(sorted(s for s in c['ser'] if re.match(r'^[A-Z]', s) and s != 'R'))     # R — резьба «R1 1/2"», не серия


def _cfg_key(c):
    p = 7.5 if c['p'] == 7 else c['p']          # в прайсе «7» и «7,5» — одно исполнение (на сайте — 7,5)
    return (_lat(c), c['size'], p, c['rec'], c['dry'], c['vsd'], c['w'])


def cfg_compatible(a, b):
    """Не противоречат ли исполнения: серия (латинские слова), типоразмер, частотник, водяное охлаждение. Без серии — не судим."""
    if not _lat(a) or not _lat(b) or a['size'] is None or b['size'] is None:
        return True
    if _lat(a) != _lat(b) or a['size'] != b['size'] or a['vsd'] != b['vsd'] or a['w'] != b['w']:
        return False
    ka, kb = _cfg_key(a), _cfg_key(b)
    if a['p'] and b['p'] and ka[2] != kb[2]:        # давление известно с обеих сторон — должно совпасть
        return False
    return a['rec'] == b['rec'] and a['dry'] == b['dry']


def unique_names(pages):
    """Одинаковые названия в парсе («Компрессор винтовой TIDY-N 15» для разных давлений и ресиверов) — уникальными, как в прайсе:
    «… TIDY-N 15-8,5-250D» (давление, ресивер, D — с осушителем). Полные копии (одна и та же позиция дважды) — убираются."""
    groups, out, seen = {}, [], set()
    for pg in pages:
        groups.setdefault(pg['name'], []).append(pg)
    for pg in pages:
        same = groups[pg['name']]
        if len(same) > 1:
            c = page_cfg(pg)
            suf = ''
            if c['p']:
                suf += '-' + ('%g' % c['p']).replace('.', ',')
            rv = _char(pg, r'объ[её]м ресивера')
            m2 = re.match(r'^\s*(\d+)\s*[xх×]\s*(\d+)', rv, re.I)
            if m2:
                suf += '-%s×%s' % (m2.group(1), m2.group(2))
            elif c['rec']:
                suf += '-' + str(c['rec'])
            if c['dry']:
                suf += 'D'
            if suf and not re.search(re.escape(suf) + r'$', pg['name']):
                pg = dict(pg, name=pg['name'] + suf, model=((pg.get('model') or '') + suf).strip('-'))
        sig = (pg['name'], json.dumps(pg.get('chars') or [], ensure_ascii=False))
        if sig in seen:
            continue                        # та же позиция на сайте дважды
        seen.add(sig)
        out.append(pg)
    names = {}
    for pg in out:
        names.setdefault(pg['name'], []).append(pg)
    for n, lst in names.items():        # всё ещё одинаковые (разная производительность) — с номером варианта
        for i, pg in enumerate(lst[1:], 2):
            pg['name'] = '%s (вариант %d)' % (n, i)
    return out


def match_prices(pages, prices):
    """Каждой позиции парса — строка прайса: по исполнению (серия, типоразмер, давление, ресивер, осушитель, частотник,
    водяное охлаждение), по полному названию, без знаков, затем по модели — только если у строк этой модели одна цена.
    → {url: price_row}, stats."""
    by_norm, by_key, by_model, by_short, by_set, by_cfg = {}, {}, {}, {}, {}, {}
    for p in prices:
        if len(p['name']) > 90 or len(p['name'].split()) > 9:      # примечания и сноски в столбце названий — не товары
            continue
        by_norm.setdefault(_norm(p['name']), p)
        by_key.setdefault(_key(p['name']), p)
        c = model_cfg(p['name'])
        p['_cfg'] = c
        if _lat(c) and c['size'] is not None:
            by_cfg.setdefault(_cfg_key(c), []).append(p)
        mk = _model_key(p['name'])
        if mk:
            by_model.setdefault(mk, []).append(p)
        if p['short']:
            by_short.setdefault(_key(p['short']), []).append(p)
        ms = _model_set(p['name'])
        if ms:
            by_set.setdefault(ms, []).append(p)

    by_code = {}
    for p in prices:
        for t in {_code(p['name']), _code(p['short'])} - {''}:
            by_code.setdefault(t, []).append(p)

    def one(lst):       # модель → строка прайса, только если все строки этой модели с одной ценой (иначе — не угадывать)
        if not lst:
            return None
        priced = [p for p in lst if p['price']] or lst
        return priced[0] if len({p['price'] for p in priced}) == 1 else None
    hit, how = {}, {'cfg': 0, 'name': 0, 'key': 0, 'model': 0, 'short': 0, 'set': 0}
    for pg in pages:
        c = page_cfg(pg)
        p = one(by_cfg.get(_cfg_key(c))) if _lat(c) and c['size'] is not None and c['p'] else None
        if p:
            how['cfg'] += 1
            hit[pg['url']] = p
            continue
        p = by_norm.get(_norm(pg['name']))
        if p:
            how['name'] += 1
        else:
            p = by_key.get(_key(pg['name']))
            if p:
                how['key'] += 1
            else:
                mk = _model_key(pg['name']) or _key(pg.get('model'))
                p = one(by_model.get(mk)) if mk else None
                if p:
                    how['model'] += 1
                elif pg.get('model') and one(by_short.get(_key(pg['model']))):
                    p = one(by_short[_key(pg['model'])])
                    how['short'] += 1
                else:
                    ms = _model_set(pg['name'])
                    p = one(by_set.get(ms)) if ms else None
                    if p:
                        how['set'] += 1
                    else:
                        p = _by_code(pg['name'], by_code)
                        if p:
                            how['code'] = how.get('code', 0) + 1
        if p and not cfg_compatible(c, p.get('_cfg') or model_cfg(p['name'])):
            how['rejected'] = how.get('rejected', 0) + 1     # «DVK 75-7» ≠ «DVK D 75-7»: другое исполнение
            p = None
        if p:
            hit[pg['url']] = p
    used = {id(p) for p in hit.values()}
    return hit, {'matched': len(hit), 'how': how, 'priceOnly': sum(1 for p in prices if id(p) not in used)}


LAT_CYR = str.maketrans('АВЕКМНОРСТХ', 'ABEKMHOPCTX')


def _code(s):
    """Код изделия из названия: «Ресивер воздушный РВ 500/10» → «PB500/10», «АСО-ВК 11/8М2» = «АСО-ВК11/8М2»,
    «Винтовой компрессор АСО-ВК110/8 ESQ» → «ACOBK110/8ESQ». Слова в скобках не в коде («(с плитой)»)."""
    run = _code_run(s)
    code = re.sub(r'[\s.\-]', '', ''.join(run)).upper().replace(',', '.').translate(LAT_CYR)
    return code if len(code) >= 3 else ''


def _code_run(s):
    """Слова кода изделия в названии: первое слово с цифрой и соседние короткие заглавные («РВ», «АСО-ВК», «ESQ»)."""
    t = [w.strip(',;:') for w in re.sub(r'\([^)]*\)', ' ', str(s or '')).split()]
    t = [w for w in t if w]
    i = next((k for k, w in enumerate(t) if re.search(r'\d', w)), None)
    if i is None:
        return []
    short_up = lambda w: re.fullmatch(r'[A-ZА-ЯЁ][A-ZА-ЯЁ-]*', w) and len(w.replace('-', '')) <= 5
    a, b = i, i + 1
    while a > 0 and short_up(t[a - 1]):
        a -= 1
    while b < len(t) and (re.search(r'\d', t[b]) or short_up(t[b]) or t[b].startswith('-')):
        b += 1
    return t[a:b]


def code_cfg(name, model=''):
    """Исполнение по коду изделия (русские модели: АСО, ремзавод): «АСО-ВК 11/10М2.ОВ-500» → серия ACOBK, типоразмер 11,
    давление 10, поколение M2, ресивер 500, осушитель; «К25М1/10» → K, 25, M1, давление 10; «РВ 110-01/40» → исполнение 01.
    Марка завода перед кодом («АСО К1/10») — не серия. → dict или None."""
    for src in (model, name):
        run = _code_run(src)
        if run and len(run) > 1 and re.fullmatch(r'АСО|ASO', run[0], re.I) and re.match(r'[A-ZА-ЯЁ]+\d', run[1]):
            run = run[1:]                      # «АСО К1/10» — марка завода, а не серия «АСО-К»
        raw = ' '.join(run).upper().translate(LAT_CYR).replace(',', '.')
        m = re.match(r'^([A-ZА-ЯЁ]+(?:[\s-]+[A-ZА-ЯЁ]+)?)[\s-]*(\d+(?:\.\d+)?)(.*)$', raw)
        if m:
            break
    else:
        return None
    rest, low = m.group(3), (str(name or '') + ' ' + str(model or '')).lower()
    pm = re.search(r'/\s*(\d+(?:\.\d+)?)', rest)
    rec = re.search(r'-\s*(\d{3,4})\b', rest[pm.end():] if pm else '')
    gen = re.search(r'(?:^|[/\d\s.])([MH]\d?Э?)(?=$|[\s.\-/]|OB)', rest)     # «КТ16МЭ» — поколение «МЭ», не «М»
    var = re.match(r'^\s*-\s*(\d{2})\b', rest)
    flags = set(re.findall(r'ESQ|ПЭ|ПД|ГЦ|Ц\b', rest.replace('ГЦ', ' ГЦ ')))
    return {'ser': re.sub(r'[\s-]', '', m.group(1)), 'size': float(m.group(2)), 'cyr': bool(re.search(r'[А-ЯЁ]', ' '.join(run).upper())), 'p': float(pm.group(1)) if pm else None,
            'rec': int(rec.group(1)) if rec else None, 'gen': gen.group(1) if gen else '', 'var': var.group(1) if var else '',
            'dry': bool(re.search(r'\bOB\b|OB-|\.OB|M\dOB', rest) or 'осушител' in low),
            'vsd': 'ESQ' in flags or bool(re.search(r'частотн', low)), 'flags': sorted(flags - {'ESQ'})}


def _by_code(name, by_code):
    """Строка прайса с тем же кодом изделия; несколько — ближайшая по словам («Поршневой компрессор С412М» — «Компрессор С412М»,
    а не «Головка С412М»; «РГ 500/10 (с плитой)» — строка с плитой)."""
    code = _code(name)
    lst = by_code.get(code)
    if not lst:
        return None
    words = lambda x: {w[:5] for w in re.findall(r'[а-яёa-z]{3,}', str(x).lower())}
    mine = words(name)
    # код в модели надёжнее кода в номенклатуре (в прайсе АСО у «РГ 110/10» номенклатура «РЕСИВЕР РВ110/16»)
    score = lambda p: (_code(p['name']) == code) * 10 + len(mine & (words(p['name']) | words(p['short']))) * 2 - len(words(p['name']) - mine)
    best = sorted(lst, key=score, reverse=True)
    if len(best) > 1 and score(best[0]) == score(best[1]) and best[0]['price'] != best[1]['price']:
        return None
    return best[0]


# ---------------------------------------------------------------- остатки на складе поставщика
def parse_stock(data):
    """XLSX остатков: «Артикул», «Номенклатура», количество → [{sku, name, qty}]. Количество — столбец, где в строках
    числа (в выгрузке АСО у него нет своей подписи: шапка «Номенклатура» объединена на три столбца); пусто — 0."""
    out = []
    for sname, rows in read_xlsx(data):
        hr = next((i for i, r in enumerate(rows[:30]) if any(re.match(r'^(артикул|код|номенклатура|наименование|модель)$', str(v).strip(), re.I)
                                                            for v in r.values())), None)
        if hr is None:
            continue
        head = {col: str(v).strip().lower() for col, v in rows[hr].items()}
        sku = next((c for c, t in sorted(head.items()) if re.match(r'^(артикул|код)', t)), None)
        name = next((c for c, t in sorted(head.items()) if re.match(r'^(номенклатура|наименование|название|модель)', t)), None)
        if name is None and sku is None:
            continue
        data_rows = [r for r in rows[hr + 1:] if str(r.get(name if name is not None else sku, '')).strip() not in ('', 'Номенклатура', 'Артикул')]
        qty = next((c for c, t in sorted(head.items()) if re.search(r'остат|кол-?во|количеств|наличи|склад', t)), None)
        if qty is None:
            nums = {}
            for r in data_rows:
                for c, v in r.items():
                    if c not in (sku, name) and _num(v) is not None:
                        nums[c] = nums.get(c, 0) + 1
            qty = max(nums, key=nums.get) if nums else None
        if qty is None:
            continue
        for r in data_rows:
            n = _num(r.get(qty))
            nm = re.sub(r'\s+', ' ', str(r.get(name, '') if name is not None else '')).strip()
            sk = str(r.get(sku, '') if sku is not None else '').strip()
            if (nm or sk) and not NOTE_ROW.match(nm or sk):
                out.append({'sku': sk[:60], 'name': (nm or sk)[:200], 'qty': max(0, int(n)) if n else 0, 'sheet': sname})
    if not out:
        raise ValueError('В файле остатков не нашлось шапки «Артикул / Номенклатура» и столбца с количеством')
    return out


def _sku_key(s):
    return re.sub(r'[\s.\-]', '', str(s or '')).upper().translate(LAT_CYR)


def stock_row(stock, sku, name):
    """Строка остатков для одной позиции: по артикулу, иначе по коду изделия в названии; None — нет в остатках."""
    k = _sku_key(sku)
    r = next((x for x in stock if k and _sku_key(x['sku']) == k), None)
    if r is None and _code(name):
        rows = [{'name': x['name'], 'short': x['sku'], 'price': x['qty'], 'r': x} for x in stock]
        by_code = {}
        for row in rows:
            for t in {_code(row['name']), _code(row['short'])} - {''}:
                by_code.setdefault(t, []).append(row)
        x = _by_code(name, by_code)
        r = x['r'] if x else None
    return r


def apply_stock(offers, stock):
    """Остатки → предложения фида: строка остатков по артикулу из прайса, иначе по коду изделия в названии
    («Поршневой компрессор К14» — «УСТАНОВКА КОМПРЕССОРНАЯ К14»). Позиции нет в остатках — на складе 0. → число найденных."""
    by_sku, by_code = {}, {}
    for r in stock:
        if r['sku']:
            by_sku.setdefault(_sku_key(r['sku']), r)
        row = {'name': r['name'], 'short': r['sku'], 'price': r['qty'], 'r': r}
        for t in {_code(r['name']), _code(r['sku'])} - {''}:
            by_code.setdefault(t, []).append(row)
    found = 0
    for o in offers:
        r = by_sku.get(_sku_key(o.get('sku'))) if o.get('sku') else None
        if r is None:
            x = _by_code(o['name'], by_code) or (_by_code(o['model'], by_code) if o.get('model') else None)
            r = x['r'] if x else None
        o['qty'] = r['qty'] if r else 0
        o['available'] = o['qty'] > 0
        o['nostock'] = False
        found += r is not None
    return found


# ---------------------------------------------------------------- фид в формате feeds.parse()
def _param(k):
    """«Давление (бар)» → («Давление», «бар»); «Мощность, кВт» разберёт feeds._param_name."""
    m = re.match(r'^(.*\S)\s*\(([^()]{1,12})\)$', k)
    return (m.group(1), m.group(2)) if m else (k, '')


def _price_specs_ok(pg, pr):
    """Характеристики строки прайса без явных ошибок: давление, не совпадающее с давлением в названии модели
    (в прайсе у «TIDY-N 5-7,5-250» — «4 бар», значения съехали на строку), не берётся — остаётся из парса."""
    if not pr:
        return []
    p = page_cfg(pg)['p']
    out = []
    for k, v in pr['specs']:
        if p and spec_class(k) == 'pressure':
            n = _num_attr(re.sub(r'[^\d,.]', '', str(v)).replace(',', '.') or None)
            if n and (7.5 if n == 7 else n) != (7.5 if p == 7 else p):
                continue
        out.append((k, v))
    return out


def build_feed(f, pages, prices, param_name, stock=None):
    """→ {shop, date, cats, offers} как у feeds.parse(): позиции парса с ценой из прайса; при f.priceOnly — и строки прайса без страницы;
    stock — остатки на складе (parse_stock): количество у каждой позиции."""
    pages = unique_names(pages)
    hit, stats = match_prices(pages, prices) if prices else ({}, {'matched': 0, 'how': {}, 'priceOnly': len(prices)})
    cats, offers = {}, {}
    maker = (f.get('maker') or '').strip()
    cur0 = (f.get('cur') or '').upper()
    for pg in pages:
        cid = 'site-' + (images.slug(pg['cat'], 40) or 'other')
        cats.setdefault(cid, {'id': cid, 'name': pg['cat'], 'parent': '', 'path': pg['cat']})
        pr = hit.get(pg['url'])
        params = []
        for k, v in merge_specs(pg['chars'], _price_specs_ok(pg, pr)):
            k2, u = _param(k)
            k2, u = param_name(k2, u)
            if u == 'дюйм' and re.search(r'["“”\']|\bDN\b|\bG\s*\d', v):     # «2"», «DN 50», «G 1/2» — единица уже в значении
                u = ''
            params.append({'k': k2[:60], 'u': u, 'v': v})
        oid = _oid(pg['url'].rstrip('/').rsplit('/', 1)[-1] or pg['name'], pg['url'], offers)
        o = _offer(oid, pg['name'], cid, pg['cat'], pg['url'], pg['pictures'], clean_desc(pg['desc']), params, maker, pg['model'], pr, cur0)
        # начало описания называет вид («Адсорбционный осушитель …») — по нему точнее определяется категория программы
        o['crumbs'] = pg['cat'] + ' / ' + re.sub(r'[|/]', ' ', pg['desc'][:120])
        offers[oid] = o
    if f.get('priceOnly') and prices:
        used = {id(p) for p in hit.values()}
        for p in prices:
            if id(p) in used or not p['price']:
                continue
            cid = 'price-' + (images.slug(p['sheet'], 40) or 'sheet')
            cats.setdefault(cid, {'id': cid, 'name': p['sheet'], 'parent': '', 'path': 'Прайс / ' + (p['title'] or p['sheet'])})
            oid = _oid('p-' + (p['sku'] or p['name']), p['sheet'] + '|' + p['name'], offers)
            params = []
            for k, v in merge_specs([], p['specs']):
                k2, u = param_name(k, '')
                params.append({'k': k2[:60], 'u': u, 'v': v})
            offers[oid] = _offer(oid, p['name'], cid, p['sheet'], '', [], '', params, maker, p['short'], p, cur0)
    offs = list(offers.values())
    if stock:
        stats['stock'] = apply_stock(offs, stock)
    return {'shop': f.get('name') or '', 'date': '', 'cats': cats, 'offers': offs, 'match': stats, 'prices': prices, 'stock': stock}


# ---------------------------------------------------------------- ручные карточки каталога ↔ строки прайса
# Карточка, заведённая вручную, описывает модель целиком («TIDY-N 15 с ресивером и осушителем», давление 7,5 / 8,5 / 10 / 13 бар),
# а прайс — каждое исполнение отдельно («TIDY-N 15-7,5-250D»). Цена у давлений до 13 бар одна, отличается исполнение:
# ресивер (250 / 500 л), осушитель (D после ресивера или ID), водяное охлаждение (W), частотник (VSD). Сопоставление — по серии,
# типоразмеру и исполнению; давление не учитывается, если цены совпадают.
CFG_SKIP = {'КОМПРЕССОР', 'ВИНТОВОЙ', 'БЕЗМАСЛЯНЫЙ', 'ПОРШНЕВОЙ', 'СПИРАЛЬНЫЙ', 'ДВУХСТУПЕНЧАТЫЙ', 'ДОЖИМНОЙ', 'DALGAKIRAN', 'COMPACT', 'BAR', 'БАР'}


def model_cfg(model, text=''):
    """Модель → {'ser': серия (буквенные части), 'size': типоразмер, 'p': давление, 'rec': ресивер, 'dry', 'vsd', 'w'}.
    text — название карточки: «с ресивером», «осушител», «водян», «частот»."""
    m = re.sub(r'\([^)]*\)', ' ', str(model or '').replace('\\', '')).upper().replace(',', '.')
    m = re.sub(r'(?<=\d)\s*[XХ×]\s*(?=\d)', 'X', m)                   # «2х270», «2 × 270» → «2X270»
    t = str(text or '').lower()
    cfg = {'ser': set(), 'size': None, 'p': None, 'rec': None, 'dry': False, 'vsd': False, 'w': False}
    nums = []
    for tok in re.split(r'[\s/]+', m):
        if not tok:
            continue
        if tok in ('VSD', 'VFD'):
            cfg['vsd'] = True
            continue
        if tok == 'ID':
            cfg['dry'] = True
            continue
        if tok == 'W':                      # «EAGLE-N VSD 200 10 BAR W» — водяное охлаждение
            cfg['w'] = True
            continue
        parts = []
        for x in tok.split('-'):
            g = re.match(r'^([A-ZА-Я]{2,})(\d+(?:\.\d+)?)$', x)        # «DS11» → «DS», «11»
            parts += [g.group(1), g.group(2)] if g else ([x] if x else [])
        for x in parts:
            n = re.match(r'^(\d+(?:\.\d+)?)([A-ZА-Я]*)$', x)
            if n:
                nums.append(float(n.group(1)))
                suf = n.group(2)
                if suf == 'W':
                    cfg['w'] = True
                elif suf == 'D' and len(nums) >= 3:     # «-250D» — ресивер с осушителем
                    cfg['dry'] = True
                elif suf == 'D':                        # «DVK 220D» — серия с прямым приводом
                    cfg['ser'].add('D')
                elif re.match(r'^\d*X\d', x):
                    pass
                continue
            if re.match(r'^\d+X\d', x):                 # «2X270D» — два ресивера
                r = re.match(r'^(\d+)X(\d+)(D?)$', x)
                if r:
                    cfg['rec'] = int(r.group(1)) * int(r.group(2))
                    cfg['dry'] = cfg['dry'] or bool(r.group(3))
                continue
            if re.match(r'^[A-ZА-Я]+$', x) and x not in CFG_SKIP:
                cfg['ser'].add(x)
    if any(s.startswith('INVERS') for s in cfg['ser']):    # INVERSYS — всегда с частотным преобразователем
        cfg['vsd'] = True
    if 'DS' in cfg['ser']:                  # спиральные DS: S/D/T/Q — число головок, не серия
        cfg['ser'] -= {'S', 'D', 'T', 'Q'}
    if nums:
        cfg['size'] = nums[0]
    if len(nums) >= 2 and nums[1] <= 50:
        cfg['p'] = nums[1]
    if len(nums) >= 3 and 50 <= nums[2] <= 3000:
        cfg['rec'] = int(nums[2])
    if re.search(r'частот|инвертор|\bvsd\b', t):
        cfg['vsd'] = True
    if any(s.startswith('INVERS') for s in cfg['ser']):
        cfg['vsd'] = True
    if re.search(r'водян', t):
        cfg['w'] = True
    if re.search(r'(с|со встроенным|и)\s+осушител', t):        # «с ресивером и осушителем»; сам «Осушитель DK 10» — не признак
        cfg['dry'] = True
    m2 = re.search(r'ресивер\S*\s*(\d{3,4})', t)
    if m2:
        cfg['rec'] = int(m2.group(1))
    elif re.search(r'(с|на) ресивер', t) and not cfg['rec']:
        cfg['rec'] = -1                                 # с ресивером, объём не указан
    return cfg


def match_card(name, model, attrs, prices):
    """Ручная карточка → строки прайса того же исполнения; → (строки, причина-если-нет). Давление учитывается,
    только если у найденных строк разные цены (тогда — по давлению карточки)."""
    cfg = model_cfg(model or name, name)
    a = attrs or {}
    if str(a.get('vsd') or '').lower() == 'да':
        cfg['vsd'] = True
    if str(a.get('dryer') or '').lower() == 'да':
        cfg['dry'] = True
    rec = _num_attr(a.get('receiver'))
    if rec and cfg['rec'] in (None, -1):
        cfg['rec'] = int(rec)
    if not cfg['ser'] or cfg['size'] is None:
        return [], 'не понятна модель'
    cand = []
    for p in prices:
        pc = model_cfg(p['name'] or p['short'])
        if pc['ser'] != cfg['ser'] or pc['size'] != cfg['size'] or pc['vsd'] != cfg['vsd'] or pc['w'] != cfg['w'] or pc['dry'] != cfg['dry']:
            continue
        if (cfg['rec'] is None) != (pc['rec'] is None) or (cfg['rec'] not in (None, -1) and pc['rec'] != cfg['rec']):
            continue
        cand.append((p, pc))
    if not cand:
        return [], 'нет в прайсе'
    hp = cfg.get('p') or _num_attr(a.get('pressure'))
    std = [(p, pc) for p, pc in cand if not pc['p'] or pc['p'] <= 13]
    if std and not (hp and hp > 13):
        cand = std
    priced = [(p, pc) for p, pc in cand if p['price']]
    if not priced:
        return [p for p, _ in cand], 'в прайсе без цены'
    if len({p['price'] for p, _ in priced}) > 1:
        by_p = [(p, pc) for p, pc in priced if hp and pc['p'] == hp]
        if len({p['price'] for p, _ in by_p}) == 1:
            return [p for p, _ in by_p], ''
        return [p for p, _ in priced], 'разные цены у исполнений'
    return [p for p, _ in priced], ''


def _num_attr(v):
    try:
        return float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def _oid(base, uniq, offers):
    """Идентификатор предложения ≤ 40 знаков (feeds._cid режет длиннее) и без повторов: длинные похожие ссылки — с хвостом-хэшем."""
    oid = images.slug(base, 40) or 'item'
    if oid in offers or len(images.slug(base, 60)) > 40:
        oid = (images.slug(base, 32) + '-' + hashlib.md5(uniq.encode('utf-8')).hexdigest()[:7]).strip('-')
    return oid


def _offer(oid, name, cid, path, url, pictures, desc, params, maker, model, pr, cur0):
    return {'oid': oid, 'name': name[:300], 'cat': cid, 'path': path, 'url': url, 'price': pr['price'] if pr else None, 'oldprice': None,
            'cur': cur0 or (pr['cur'] if pr and pr['cur'] else 'EUR'), 'vendor': maker, 'model': model or (pr['short'] if pr else '') or '',
            'sku': pr['sku'] if pr else '', 'barcode': '', 'pictures': pictures, 'desc': desc, 'params': params,
            'available': True, 'qty': None, 'nostock': True, 'authoritative': True, 'weight': None, 'dims': '', 'notes': '',
            'opts': [{'name': n, 'price': v} for n, v in (pr['opts'] if pr else [])], 'sheet': pr['sheet'] if pr else ''}
