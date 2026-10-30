"""Книга Excel без сторонних библиотек и разбор ячеек прайсов и остатков: число, единицы измерения."""

import html as html_mod
import io
import re
import zipfile
from typing import Any

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
                    val_match = re.search(r'<v(?:\s[^>]*)?>(.*?)</v>', inner, re.S)
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
