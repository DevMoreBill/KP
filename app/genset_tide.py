"""Прайс-склад Tide Power: модели ДГУ строкой с блоками «В открытом исполнении» и «В кожухе» (РРЦ, дилерская, на складе,
ожидается по месяцам), листы серий, «НОВЫЕ ЦЕНЫ» (новые РРЦ и дилерские — важнее) и брони менеджеров поставщика (вычитаются из
наличия, пока не истекли). Строки — в формате genset_sheets.GensetBook (модель, исполнение, альтернатор)."""

import re
from datetime import date, timedelta
from typing import Any

from genset_sheets import Cell, Columns, Exec, Model, Stock
from num import Num

HEAD_SCAN = 15
HEAD_DEPTH = 3
SERIAL_MIN, SERIAL_MAX = 30000, 80000
EXCEL_DAY0 = date(1899, 12, 30)


class Months:
    """Столбцы «Ожидается» по месяцам: «окт», «нояб», «дек» → «октябрь»."""

    NAMES = (
        ('янв', 'январь'),
        ('фев', 'февраль'),
        ('мар', 'март'),
        ('апр', 'апрель'),
        ('май', 'май'),
        ('июн', 'июнь'),
        ('июл', 'июль'),
        ('авг', 'август'),
        ('сен', 'сентябрь'),
        ('окт', 'октябрь'),
        ('ноя', 'ноябрь'),
        ('дек', 'декабрь'),
    )

    @classmethod
    def of(cls, title: str) -> str:
        last = title.rsplit(maxsplit=1)[-1] if title.split() else ''
        return next((name for short, name in cls.NAMES if last.startswith(short)), '')


class TideSheet:
    """Лист моделей: столбцы по шапке в три строки; блоки исполнений — по словам «открыт» / «кожух» в шапке."""

    MODEL = r'^(.* )?модель( дгу)?$'
    BLOCKS = ((Exec.OPEN, r'открыт'), (Exec.CAN, r'кожух'))

    def __init__(self, name: str, rows: list) -> None:
        self.name, self.rows = name, rows
        self.start = self._start()
        self.cols = Columns(rows, self.start, depth=HEAD_DEPTH) if self.start is not None else None

    def _start(self) -> int | None:
        """Последняя строка шапки: строка «Модель» (и следующая, если в ней месяцы или единицы, а не модель)."""
        for i, row in enumerate(self.rows[:HEAD_SCAN]):
            cells = [re.sub(r'\s+', ' ', str(v)).strip().lower() for v in row.values()]
            if any(re.match(r'^модель( дгу)?$', cell) for cell in cells) and any(
                'ррц' in cell or 'налич' in cell for cell in cells
            ):
                nxt = self.rows[i + 1] if i + 1 < len(self.rows) else {}
                return i + 1 if nxt and not any(re.search(r'\d', str(v)) and '-' in str(v) for v in nxt.values()) else i
        return None

    @classmethod
    def applies(cls, name: str, rows: list) -> bool:
        sheet = cls(name, rows)
        if sheet.cols is None:
            return False
        return 'ррц' in ' '.join(sheet.cols.titles.values())

    def data(self) -> list:
        """Строки под шапкой."""
        return self.rows[self.start + 1 :] if self.start is not None else []

    def find(self, regex: str, avoid: str = '') -> int | None:
        return self.cols.find(regex, avoid) if self.cols else None

    def model_col(self) -> int | None:
        for col in sorted(self.cols.titles if self.cols else {}):
            title = self.cols.titles[col] if self.cols else ''
            if re.search(r'модель( дгу)?$', title) and not re.search(
                r'двигател|генератор|альтернатор|контроллер', title
            ):
                return col
        return None

    def blocks(self) -> dict:
        """{исполнение: {rrc, dealer, stock, months: [(столбец, месяц)]}}; без блоков (мотопомпы) — исполнение ''."""
        titles = self.cols.titles if self.cols else {}
        out: dict = {}
        for kind, regex in self.BLOCKS:
            cols = {col: title for col, title in titles.items() if re.search(regex, title) and 'авр' not in title}
            if cols:
                out[kind] = self._block(cols)
        if not out:
            cols = {col: title for col, title in titles.items() if 'авр' not in title}
            out[''] = self._block(cols)
        return out

    @staticmethod
    def _block(cols: dict) -> dict:
        def first(regex: str, avoid: str = '') -> int | None:
            return next(
                (
                    col
                    for col, title in sorted(cols.items())
                    if re.search(regex, title) and not (avoid and re.search(avoid, title))
                ),
                None,
            )

        return {
            'rrc': first(r'ррц', r'стар'),
            'dealer': first(r'дилер', r'стар'),
            'stock': first(r'на складе|наличие', r'ожида'),
            'months': [
                (col, Months.of(title)) for col, title in sorted(cols.items()) if 'ожида' in title and Months.of(title)
            ],
        }


class TideBook:
    """Книга Tide Power → строки прайса ДГУ с наличием."""

    CUR = 'CNY'  # валюта прайса Tide Power (решение владельца 29.10); другая — «Валюта листа» в фиде
    MAIN = 'прайс-лист'
    NEW = 'новые цены'
    STOCK = 'в наличии'
    ORDER = re.compile(r'под заказ', re.I)

    @staticmethod
    def applies(book: list) -> bool:
        return any(TideSheet.applies(name, rows) for name, rows in book) and any(
            'tide' in str(v).lower() for _, rows in book for row in rows[: HEAD_SCAN + 10] for v in row.values()
        )

    @classmethod
    def price_rows(cls, book: list, today: date | None = None) -> tuple:
        """→ (строки в формате parse_price + genset, сводка листов)."""
        today = today or date.today()
        sheets = [(name, TideSheet(name, rows)) for name, rows in book if TideSheet.applies(name, rows)]
        order = sorted(sheets, key=lambda pair: (cls.MAIN not in pair[0].lower(), cls.STOCK in pair[0].lower()))
        prices = {
            key: val for name, sheet in sheets if cls.NEW in name.lower() for key, val in cls._new_prices(sheet).items()
        }
        reserve: dict = {}
        stock: dict = {}
        for name, sheet in sheets:
            if cls.STOCK in name.lower():
                reserve.update(cls._reserves(sheet, today))
                stock.update(cls._stock_rows(sheet))
        out: dict = {}
        summary = []
        for name, sheet in order:
            if cls.NEW in name.lower():
                continue
            got = 0
            for row in cls._rows(sheet, prices, (reserve, stock)):
                key = (Model.key(row['name']), row['genset']['exec'], row['genset']['altModel'])
                if key not in out:
                    out[key] = row
                    got += 1
            summary.append({'name': name, 'rows': got, 'withPrice': got, 'cur': cls.CUR})
        rows = list(out.values())
        for row in rows:
            row['genset'].pop('altModel', None)
        return rows, summary

    # ---------------------------------------------------------------- листы
    @staticmethod
    def _alt_model(sheet: TideSheet, row: dict) -> str:
        """Модель альтернатора: из столбцов «альтернатор» / «генератор» — та ячейка, где есть цифры (марка — без них)."""
        titles = sheet.cols.titles if sheet.cols else {}
        for col in sorted(titles):
            title = titles[col]
            if re.search(r'альтернатор|генератор', title) and not re.search(r'двигател|модель дгу|ном\w*\. ток', title):
                text = Cell.text(row, col)
                if re.search(r'\d', text):
                    return Model.key(text)
        return ''

    @classmethod
    def _new_prices(cls, sheet: TideSheet) -> dict:
        """«НОВЫЕ ЦЕНЫ»: (модель, альтернатор, исполнение) → (новая РРЦ, новая дилерская)."""
        model = sheet.model_col()
        out: dict = {}
        if model is None or not sheet.cols:
            return out
        for kind, regex in TideSheet.BLOCKS:
            rrc = sheet.find(rf'{regex}.*нов\w* ррц')
            dealer = sheet.find(rf'{regex}.*нов\w* дилерск')
            for row in sheet.data():
                code = Cell.text(row, model)
                price = Num.parse(row.get(rrc)) if rrc is not None else None
                if code and price:
                    deal = Num.parse(row.get(dealer)) if dealer is not None else None
                    out[(Model.key(code), cls._alt_model(sheet, row), kind)] = (
                        round(price, 2),
                        round(deal, 2) if deal else None,
                    )
        return out

    @classmethod
    def _reserves(cls, sheet: TideSheet, today: date) -> dict:
        """Брони, которые ещё не истекли: (модель, альтернатор) → штук."""
        model = sheet.model_col()
        titles = sheet.cols.titles if sheet.cols else {}
        counts = sorted(col for col, title in titles.items() if 'брон' in title and re.search(r'кол', title))
        out: dict = {}
        for row in sheet.data():
            code = Cell.text(row, model)
            if not code:
                continue
            total = 0
            for col in counts:
                qty = Num.parse(row.get(col)) or 0
                until = cls._date(row.get(col + 3))
                if qty > 0 and (until is None or until >= today):
                    total += int(qty)
            if total:
                key = (Model.key(code), cls._alt_model(sheet, row))
                out[key] = out.get(key, 0) + total
        return out

    @staticmethod
    def _date(value: Any) -> date | None:
        num = Num.parse(value)
        if num is not None and SERIAL_MIN <= num <= SERIAL_MAX:
            return EXCEL_DAY0 + timedelta(days=int(num))
        found = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', str(value or ''))
        return date(int(found.group(3)), int(found.group(2)), int(found.group(1))) if found else None

    @classmethod
    def _stock_rows(cls, sheet: TideSheet) -> dict:
        """Лист «В наличии и В пути» — наличие и ожидаемое важнее столбцов прайс-листа: (модель, альтернатор, исполнение) → строка."""
        model = sheet.model_col()
        out: dict = {}
        if model is None:
            return out
        blocks = sheet.blocks()
        for row in sheet.data():
            code = Cell.text(row, model)
            if code and re.search(r'\d', code):
                for kind, block in blocks.items():
                    out[(Model.key(code), cls._alt_model(sheet, row), kind)] = (row, block)
        return out

    @classmethod
    def _rows(cls, sheet: TideSheet, prices: dict, extra: tuple) -> list:
        model = sheet.model_col()
        if model is None:
            return []
        reserve, stock = extra
        status = sheet.find(r'наличие$', r'открыт|кожух|ожида')
        variant = [col for col in (sheet.find(r'высота мачты'), sheet.find(r'тип ламп')) if col is not None]
        spec: dict[str, Any] = {
            'engine': (
                sheet.find(r'двигател\w* бренд|^двигатель$|бренд двигател'),
                sheet.find(r'двигател\w* модель|модель двигател'),
            ),
            'alt': (
                sheet.find(r'альтернатор\w* бренд|^генератор$'),
                sheet.find(r'альтернатор\w* модель|модель генератора'),
            ),
            'kw': sheet.find(r'номин\w*.*квт|prime.*квт|номинал.*квт'),
        }
        blocks = sheet.blocks()
        out = []
        for row in sheet.data():
            code = Cell.text(row, model)
            if not code or not re.search(r'\d', code):
                continue
            alt_brand = Cell.text(row, spec['alt'][0])
            alt_model = Model.key(Cell.text(row, spec['alt'][1]))
            booked = reserve.get((Model.key(code), alt_model), 0)
            for kind, block in blocks.items():
                item = cls._item(sheet, row, code, kind, block, prices.get((Model.key(code), alt_model, kind)))
                if item is None:
                    continue
                if variant:  # световые мачты: одна модель — разные мачта и лампы
                    item['name'] = '{} ({})'.format(
                        item['name'], ', '.join(Cell.text(row, col) for col in variant if Cell.text(row, col))
                    )[:300]
                item['genset'] = {
                    'exec': kind,
                    'alt': Model.alt(alt_brand) or ('tide' if 'tide' in alt_brand.lower() else ''),
                    'altModel': alt_model,
                }
                src_row, src_block = stock.get((Model.key(code), alt_model, kind), (row, block))
                item['stockInfo'] = cls._stock(src_row, src_block, booked, Cell.text(row, status))
                item['specs'] = cls._specs(row, spec, alt_brand)
                out.append(item)
        return out

    @classmethod
    def _item(cls, sheet: TideSheet, row: dict, code: str, kind: str, block: dict, new: tuple | None) -> dict | None:
        rrc = Num.parse(row.get(block['rrc'])) if block['rrc'] is not None else None
        dealer = Num.parse(row.get(block['dealer'])) if block['dealer'] is not None else None
        if new:
            rrc, dealer = new[0], new[1] or dealer
        if not rrc:
            return None  # исполнения нет (0 в прайсе)
        name = '{} {}'.format(code, Exec.LABELS.get(kind, '')).strip()
        return {
            'sku': '',
            'name': name[:300],
            'short': code,
            'pbar': '',
            'price': round(rrc, 2),
            'cur': cls.CUR,
            'opts': [],
            'sheet': sheet.name,
            'title': sheet.name,
            'group': '',
            'sale': False,
            'dealer': round(dealer, 2) if dealer else None,
            'disc': None,
        }

    @staticmethod
    def _count(row: dict, col: int | None) -> int:
        num = Num.parse(row.get(col)) if col is not None else None
        return max(0, int(num)) if num else 0

    @classmethod
    def _stock(cls, row: dict, block: dict, booked: int, status: str) -> dict:
        """В наличии — на складе минус брони; ожидается — по месяцам, как у поставщика; брони — отдельно."""
        qty = cls._count(row, block['stock'])
        due = [(month, cls._count(row, col)) for col, month in block['months']]
        due = [(month, num) for month, num in due if num]
        transit = sum(num for _, num in due)
        free = max(0, qty - booked)
        state: dict[str, Any] = {'qty': free, 'available': free > 0}
        if transit:
            state['transit'] = transit
            state['eta'] = ', '.join(f'{month} — {num}' for month, num in due)
        if booked:
            state['reserve'] = booked
        if not free and not transit and (cls.ORDER.search(status) or not qty):
            state.update(Stock.ORDER)
        return state

    @staticmethod
    def _specs(row: dict, spec: dict, alt_brand: str) -> list:
        out = []
        engine = ' '.join(filter(None, (Cell.text(row, spec['engine'][0]), Cell.text(row, spec['engine'][1]))))
        alt = ' '.join(filter(None, (alt_brand, Cell.text(row, spec['alt'][1]))))
        if engine:
            out.append(('Двигатель', engine))
        if alt:
            out.append(('Альтернатор', alt))
        kw = Num.parse(row.get(spec['kw'])) if spec['kw'] is not None else None
        if kw:
            out.append(('Номинальная мощность', f'{round(kw, 1):g} кВт'))
        return out
