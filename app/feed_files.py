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
import os
import re
import zipfile
from datetime import datetime

import images

DIR_NAME = 'feeds'
MAX_FILE = 60 * 1024 * 1024
UNITS = {'бар', 'м³/мин', 'м3/мин', 'м³/ч', 'м3/час', 'м3/ч', 'л/мин', 'лит', 'л', 'квт', 'мм', 'кг', 'дюйм', 'дб', 'дб(а)', 'евро', 'eur', '€',
         'руб', 'руб.', '₽', 'usd', '$', 'в/гц', 'в', 'модель', 'тип', 'r', 'фланец', 'шт', '(л)', '(кг)', 'об/мин', '%', '°c', 'мбар'}
HEAD_WORDS = ('Артикул', 'Код SAP', 'Модель', 'Название', 'Наименование')
JUNK = re.compile(r'^(NEW PRICE|Опции|www\.|Содержание|Цены с учетом|\*)', re.I)
CUR_WORDS = {'евро': 'EUR', 'eur': 'EUR', '€': 'EUR', 'руб': 'RUB', 'руб.': 'RUB', '₽': 'RUB', 'usd': 'USD', '$': 'USD', 'юань': 'CNY', 'cny': 'CNY'}


# ---------------------------------------------------------------- файлы на диске
def feed_dir(data_dir, fid):
    return os.path.join(data_dir, DIR_NAME, images.slug(fid, 40) or 'feed')


def file_path(data_dir, fid, kind):
    return os.path.join(feed_dir(data_dir, fid), 'pages.csv' if kind == 'pages' else 'price.xlsx')


def save_file(data_dir, fid, kind, data, name):
    """Сохранить файл фида; → мета {name, size, at, …} с итогом разбора (ValueError — файл не читается)."""
    if kind not in ('pages', 'price'):
        raise ValueError('Неизвестный вид файла')
    if not data:
        raise ValueError('Файл пустой')
    if len(data) > MAX_FILE:
        raise ValueError('Файл больше %d МБ' % (MAX_FILE // 1024 // 1024))
    meta = {'name': str(name or '')[:120], 'size': len(data), 'at': datetime.now().isoformat(timespec='seconds')}
    if kind == 'pages':
        rows = parse_pages(data)
        meta.update(rows=len(rows), cats=len({r['cat'] for r in rows}))
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
    cands = [c.start() for c in _CHAR_START.finditer(rest)]
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


def parse_pages(data):
    """CSV парса → [{cat, name, url, pictures, desc, chars:[(k, v)], model}]."""
    text = _decode(data)
    lines = text.splitlines()
    if not lines:
        raise ValueError('Файл пустой')
    out, seen = [], set()
    for line in lines[1:] if re.match(r'^"?категор', lines[0].strip(), re.I) else lines:
        line = _unwrap(line)
        if not line.strip():
            continue
        parts = None
        try:
            r = next(csv.reader(io.StringIO(line)))
            if len(r) == 6 and _PROD_URL.match(r[2].strip()):
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
        rows, model = [], ''
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


def _is_unit(v):
    s = str(v).strip().lower()
    return s in UNITS or s in CUR_WORDS


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
        elif 'печатн' in tl and c['short'] is None:
            c['short'] = col
        elif re.match(r'^(модель|название|наименование)', tl) and c['name'] is None:
            c['name'] = col
        elif re.match(r'^(стоимость|цена)', tl) and not re.search(r'опци|пуск|охл|рекуперац|grease|смазк', tl) and c['price'] is None:
            c['price'] = col
        elif re.match(r'^(стоимость|цена)', tl) or 'grease' in tl:
            c['opts'].append((col, re.sub(r'^(стоимость|цена)( опции)?\s*[-–—:]?\s*', '', t, flags=re.I).strip(' -') or t))
        else:
            c['specs'].append((col, t))
    return c


def _opt_name(t):
    return re.sub(r'\s*\((?:cold start|soft start|w|heat recovery|fs|fgo)\)\s*$', '', t, flags=re.I).strip()[:60]


def parse_price(data):
    """XLSX прайса → ([{sku, name, short, price, cur, opts:[(подпись, цена)], specs:[(k, v)], sheet, title}], листы)."""
    book = read_xlsx(data)
    out, sheets = [], []
    for sname, rows in book:
        hr = next((i for i, r in enumerate(rows) if any(str(v).strip() in HEAD_WORDS for v in r.values())), None)
        if hr is None:
            continue
        ur = next((i for i in range(hr, min(hr + 5, len(rows))) if sum(1 for v in rows[i].values() if _is_unit(v)) >= 3), None)
        lo, hi = max(0, hr - 3), (ur if ur is not None else hr + 1)
        title = ''
        for r in rows[:3]:
            v = str(r.get(0, '')).strip()
            if len(v) > 6 and not JUNK.match(v):
                title = re.sub(r'\s+', ' ', v)[:100]
                break
        head = {}
        for i in range(lo, hi):
            vals = {col: re.sub(r'\s+', ' ', str(v)).strip() for col, v in rows[i].items()}
            wide = {v for v in vals.values() if list(vals.values()).count(v) >= 5}      # название листа — объединено через всю таблицу
            for col, v in vals.items():
                # объединённые ячейки повторяют текст в каждой строке и столбце — название листа и повторы шапки не нужны
                if v and v not in wide and not JUNK.match(v) and not (_is_unit(v) and v not in HEAD_WORDS) and not head.get(col, '').endswith(v):
                    head[col] = (head.get(col, '') + ' ' + v).strip()
        units = rows[ur] if ur is not None else {}
        for col, u in units.items():        # столбец с единицей, но без подписи (шапка объединена криво) — подпись по единице
            if col not in head and str(u).strip().lower() in UNIT_LABEL:
                head[col] = UNIT_LABEL[str(u).strip().lower()]
        c = _price_cols(head)
        if c['name'] is None:
            continue
        cur = ''
        if c['price'] is not None:
            cur = CUR_WORDS.get(str(units.get(c['price'], '')).strip().lower(), '')
            if not cur:
                m = re.search(r'\((евро|eur|руб|usd|\$|€|₽)\.?\)', head.get(c['price'], ''), re.I)
                cur = CUR_WORDS.get(m.group(1).lower(), '') if m else ''
        start = (ur if ur is not None else hr) + 1
        items, n0 = [], len(out)
        for i in range(start, len(rows)):
            r = rows[i]
            name = re.sub(r'\s+', ' ', str(r.get(c['name'], ''))).strip()
            if not name or len(name) < 3 or name in HEAD_WORDS or JUNK.match(name) or re.match(r'^цены ', name, re.I):
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
                if not v or v in ('-', '—', '–'):
                    continue
                u = str(units.get(col, '')).strip()
                if u.lower() in ('модель', 'тип', 'r') or u.lower() in CUR_WORDS:
                    u = ''
                specs.append((label[:60], _spec_val(v, u)))
            sku = str(r.get(c['sku'], '')).strip() if c['sku'] is not None else ''
            if sku in ('-', '—'):
                sku = ''
            short = re.sub(r'\s+', ' ', str(r.get(c['short'], ''))).strip()[:120] if c['short'] is not None else ''
            items.append({'sku': sku[:40], 'name': name[:300], 'short': '' if _num(short) is not None else short,
                          'price': round(price, 2) if price else None, 'cur': cur, 'opts': opts, 'specs': specs, 'sheet': sname, 'title': title})
        out.extend(items)
        sheets.append({'name': sname, 'rows': len(out) - n0, 'withPrice': sum(1 for x in items if x['price']), 'cur': cur})
    if not out:
        raise ValueError('В прайсе не нашлось листов с шапкой «Артикул / Модель / Стоимость»')
    return out, sheets


UNIT_LABEL = {'бар': 'Макс. давление', 'квт': 'Мощность', 'кг': 'Масса', 'дб': 'Уровень шума', 'м³/мин': 'Производительность', 'м3/мин': 'Производительность',
              'л/мин': 'Производительность', 'м³/ч': 'Производительность', 'м3/час': 'Производительность', 'лит': 'Объём ресивера', 'л': 'Объём ресивера'}
SPEC_UNITS = {'лит': 'л', 'м3/мин': 'м³/мин', 'м3/час': 'м³/ч', 'м3/ч': 'м³/ч', 'кВт.': 'кВт', 'кВт/ч': 'кВт', 'дБ(А)': 'дБ', 'мбар': 'мбар', '(л)': 'л', '(кг)': 'кг'}


def _spec_val(v, u):
    u = SPEC_UNITS.get(str(u).strip(), str(u).strip())
    v = str(v).strip()
    n = _num(v)
    if n is not None:
        v = ('%d' % n) if float(n).is_integer() else ('%.3f' % n).rstrip('0').rstrip('.').replace('.', ',')
    v = v.replace('x', '×').replace('х', '×') if re.match(r'^\d+\s*[xх×]\s*\d+', v) else v
    return ('%s %s' % (v, u)) if u and re.match(r'^-?\d', v) and not re.search(r'["\'“”]|^\d+/\d+$|^DN', v) else v


# ---------------------------------------------------------------- описание: без рекламы и мусора, с абзацами и списком
JUNK_SENT = re.compile(r'\bваш(е|ем|у|им|их|а|и)?\b|\bвам\b|верный способ|обратитесь|звоните|позвоните|менеджер|оставьте заявку|заказать|купить|'
                       r'\bцен[аыу]\b|доставк|примерн|индивидуально|согласно проекту|официальн\S* (дилер|представител|поставщик)|'
                       r'в наличии|со склада|гарантия качества|лучшее решение|не имеет аналогов|по выгодн|скидк|акци[яи]\b', re.I)
HEAD_RX = re.compile(r'\s*(технические особенности|главное о серии|особенности|преимущества|опции|комплектация|применение|области применения)([^:\n•]{0,50}):\s*', re.I)


def clean_desc(text):
    """Описание со страницы → текст без «воды»: вводный абзац, подзаголовки, список «• …»; повторы и рекламные фразы убраны."""
    t = html_mod.unescape(str(text or '')).replace('\xa0', ' ')
    t = re.sub(r'["«»]{2,}|\s*"\s*;|\s*"(?=\s|$)|(?<=\s)"\s*', ' ', t)      # сломанные кавычки из CSV
    t = re.sub(r'\s*[►▪■●♦➢➤✓]\s*(?=[А-ЯA-Zа-я0-9])|\s+-\s+(?=[А-Я])', '\n• ', t)
    t = HEAD_RX.sub(lambda m: '\n' + m.group(1).strip().capitalize() + ':\n', t)
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
            if len(key) < 8 or key in seen:
                continue
            if JUNK_SENT.search(body) and not sent.endswith(':'):
                continue
            seen.add(key)
            out.append(('• ' + body) if sent.startswith('• ') else (sent if sent.endswith(':') else body))
    # подзаголовок без пунктов после него не нужен
    res = []
    for i, x in enumerate(out):
        if x.endswith(':') and not (i + 1 < len(out) and out[i + 1].startswith('• ')):
            continue
        res.append(x)
    return '\n'.join(res)[:4000].strip()


# ---------------------------------------------------------------- характеристики: парс + прайс (прайс точнее)
SPEC_CLASS = [
    ('pressure_min', r'^мин\S*\s+давлен'), ('pressure_in', r'давлен\S*\s+на входе'), ('vacuum', r'разряжени|вакуум'),
    ('pressure', r'давлен'), ('flow', r'производительн|пропускн\S*\s+способн'), ('power', r'мощност'),
    ('dims', r'габарит'), ('length', r'^длина'), ('width', r'^ширина'), ('height', r'^высота'), ('mass_ads', r'масс\S*\s+адсорбент'),
    ('mass', r'^(масса|вес|общий вес)'), ('noise', r'шум'), ('outlet', r'выход\S*,?\s+сжатого|^соединение$|^присоединительн|соединение по воздуху'),
    ('receiver', r'ресивер'), ('dryer', r'встроенн\S*\s+осушител'), ('filters', r'встроенн\S*\s+фильтр|тип фильтров|фильтры в составе'),
    ('voltage', r'напряжени'), ('refrigerant', r'хлад(о|а)гент'), ('controller', r'контроллер'), ('cartridge', r'картридж|катридж'),
    ('purity', r'чистот'), ('country', r'страна'), ('ip', r'степень защиты'), ('rpm', r'скорост\S*\s+вращени'),
]
SPEC_LABEL = {'pressure_min': 'Минимальное давление', 'pressure_in': 'Давление на входе', 'vacuum': 'Максимальное разрежение', 'pressure': 'Давление',
              'flow': 'Производительность', 'power': 'Мощность', 'dims': 'Габариты (Д × Ш × В)', 'mass': 'Масса', 'mass_ads': 'Масса адсорбента',
              'noise': 'Уровень шума', 'outlet': 'Выход сжатого воздуха', 'receiver': 'Объём ресивера', 'dryer': 'Встроенный осушитель',
              'filters': 'Встроенные фильтры', 'voltage': 'Напряжение', 'refrigerant': 'Хладагент', 'controller': 'Контроллер', 'cartridge': 'Картридж',
              'purity': 'Чистота', 'rpm': 'Скорость вращения'}
SPEC_DROP = re.compile(r'^(аналог|примечание|все характеристики|new price)', re.I)


def spec_class(key):
    k = re.sub(r'\s*\([^)]*\)\s*$', '', str(key or '')).strip().lower()
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


def merge_specs(parse_rows, price_specs):
    """Строки характеристик: парс, затем прайс; одинаковые параметры (давление, производительность, мощность, габариты, масса…)
    берутся из прайса — он точнее; «Длина/Ширина/Высота» прайса складываются в габариты."""
    rows, idx = [], {}
    for k, v in parse_rows:
        if SPEC_DROP.match(k):
            continue
        c = spec_class(k)
        if c in idx:
            continue
        idx[c] = len(rows)
        rows.append([k, v])
    dims = {}
    for k, v in price_specs:
        if SPEC_DROP.match(k) or not str(v).strip():
            continue
        c = spec_class(k)
        if c in ('length', 'width', 'height'):
            dims[c] = re.sub(r'\s*мм$', '', str(v))
            continue
        label = SPEC_LABEL.get(c) or _tidy_label(k)
        if c in idx:
            rows[idx[c]][1] = v           # прайс точнее парса
            if c.startswith('k:'):
                rows[idx[c]][0] = rows[idx[c]][0]
        else:
            idx[c] = len(rows)
            rows.append([label, v])
    if len(dims) == 3:
        v = '%s × %s × %s мм' % (dims['length'], dims['width'], dims['height'])
        if 'dims' in idx:
            rows[idx['dims']][1] = v
        else:
            rows.append([SPEC_LABEL['dims'], v])
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


def match_prices(pages, prices):
    """Каждой позиции парса — строка прайса: по полному названию, затем без знаков, затем по модели (и по набору слов модели). → {url: price_row}, stats."""
    by_norm, by_key, by_model, by_short, by_set = {}, {}, {}, {}, {}
    for p in prices:
        if len(p['name']) > 90 or len(p['name'].split()) > 9:      # примечания и сноски в столбце названий — не товары
            continue
        by_norm.setdefault(_norm(p['name']), p)
        by_key.setdefault(_key(p['name']), p)
        mk = _model_key(p['name'])
        if mk:
            by_model.setdefault(mk, p)
        if p['short']:
            by_short.setdefault(_key(p['short']), p)
        ms = _model_set(p['name'])
        if ms:
            by_set.setdefault(ms, p)
    hit, how = {}, {'name': 0, 'key': 0, 'model': 0, 'short': 0, 'set': 0}
    for pg in pages:
        p = by_norm.get(_norm(pg['name']))
        if p:
            how['name'] += 1
        else:
            p = by_key.get(_key(pg['name']))
            if p:
                how['key'] += 1
            else:
                mk = _model_key(pg['name']) or _key(pg.get('model'))
                p = by_model.get(mk) if mk else None
                if p:
                    how['model'] += 1
                elif pg.get('model') and by_short.get(_key(pg['model'])):
                    p = by_short[_key(pg['model'])]
                    how['short'] += 1
                else:
                    ms = _model_set(pg['name'])
                    p = by_set.get(ms) if ms else None
                    if p:
                        how['set'] += 1
        if p:
            hit[pg['url']] = p
    used = {id(p) for p in hit.values()}
    return hit, {'matched': len(hit), 'how': how, 'priceOnly': sum(1 for p in prices if id(p) not in used)}


# ---------------------------------------------------------------- фид в формате feeds.parse()
def _param(k):
    """«Давление (бар)» → («Давление», «бар»); «Мощность, кВт» разберёт feeds._param_name."""
    m = re.match(r'^(.*\S)\s*\(([^()]{1,12})\)$', k)
    return (m.group(1), m.group(2)) if m else (k, '')


def build_feed(f, pages, prices, param_name):
    """→ {shop, date, cats, offers} как у feeds.parse(): позиции парса с ценой из прайса; при f.priceOnly — и строки прайса без страницы."""
    hit, stats = match_prices(pages, prices) if prices else ({}, {'matched': 0, 'how': {}, 'priceOnly': len(prices)})
    cats, offers = {}, {}
    maker = (f.get('maker') or '').strip()
    cur0 = (f.get('cur') or '').upper()
    for pg in pages:
        cid = 'site-' + (images.slug(pg['cat'], 40) or 'other')
        cats.setdefault(cid, {'id': cid, 'name': pg['cat'], 'parent': '', 'path': pg['cat']})
        pr = hit.get(pg['url'])
        params = []
        for k, v in merge_specs(pg['chars'], pr['specs'] if pr else []):
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
    return {'shop': f.get('name') or '', 'date': '', 'cats': cats, 'offers': list(offers.values()), 'match': stats}


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
            'opts': [{'name': n, 'price': v} for n, v in (pr['opts'] if pr else [])]}
