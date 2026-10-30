"""Прайс поставщика из Excel: столбцы цен и опций, группы и распродажа."""

import re
from typing import Any

from feed_desc import UNIT_LABEL, _spec_split, _spec_val
from feed_match import LAT_CYR
from feed_xlsx import CUR_WORDS, _is_unit, read_xlsx
from genset_sheets import GensetBook
from genset_tide import TideBook
from num import Num

PRESSURE_COLS_MIN = 2
TITLE_MIN = 6
HEAD_GAP = 3
UNITS_ROW_MIN = 3
TABLE_COLS_MIN = 4
SECTION_VALS_MAX = 2
NAME_MIN = 3
PERCENT_MAX = 100
EURO_PRICES_BELOW = 300000
HEAD_WORDS = ('Артикул', 'Код SAP', 'Модель', 'Название', 'Наименование')
JUNK = re.compile(r'^(NEW PRICE|Опции|www\.|Содержание|Цены с учетом|\*)', re.I)
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
                Num.parse(v) is not None or re.match(r'^\(?лист\b', v, re.I)
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
            v = Num.parse(row.get(col))
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
        dealer = Num.parse(row.get(cols['dealer'])) if cols['dealer'] is not None else None
        disc = Num.parse(row.get(cols['disc'])) if cols['disc'] is not None else None
        disc = disc * 100 if disc is not None and 0 < disc < 1 else disc  # «0.25» в ячейке с форматом «%»
        variants, names = [], _expand_names(name)
        for col, qual in cols['prices'] or [(None, '')]:
            price = Num.parse(row.get(col)) if col is not None else None
            if (
                price is None and col is not None and len(cols['prices']) == 1
            ):  # цена группы в соседней строке без названия
                for j in (i - 1, i + 1, i + 2):
                    if 0 <= j < len(rows) and not str(rows[j].get(cols['name'], '')).strip():
                        price = Num.parse(rows[j].get(col))
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
                        'short': '' if Num.parse(short) is not None else short,
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
