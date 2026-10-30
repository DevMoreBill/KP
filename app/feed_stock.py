"""Файл остатков поставщика: склады, в пути и сроки, сопоставление строк остатков с позициями."""

import re
from datetime import datetime, timedelta
from typing import Any

from feed_match import LAT_CYR, SIG_MIN, _by_code, _code, _sig, model_cfg
from feed_price_file import NOTE_ROW
from feed_xlsx import _num, read_xlsx
from genset_sheets import EtaDate


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
            rec['eta'] = EtaDate.earliest(rec['eta'], eta)
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
        if row.get('eta'):
            x['eta'] = EtaDate.earliest(x.get('eta') or '', row['eta'])
        x['promo'] = x.get('promo') or row.get('promo') or ''
    x['parts'] = [part for row in rows for part in StockLeftovers.parts(row)]
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


class StockLeftovers:
    """Строки остатков без пары после артикула, подписи модели и кода — второй проход: та же модель с лишними признаками
    исполнения («EXPM 37/10 IP 54 OMRON» ↔ «EXPM 37/10»), код модели среди слов («Automatic drain JAD20 1/2"» ↔
    «Конденсатоотводчик JAD20»). Строка уходит одной позиции — самой подходящей; спорная остаётся без пары."""

    CODE_MIN = 4
    ALIAS = re.compile(r'модель', re.I)

    def __init__(self, stock: list) -> None:
        self.stock = stock
        self.used: set = set()

    @staticmethod
    def parts(row: dict) -> list:
        """Исходные строки остатков, из которых сложена строка."""
        return row.get('parts') or [row]

    @classmethod
    def aliases(cls, offer: dict) -> list:
        """Другие названия модели из характеристик позиции («Модель Liutech: LUY050-7» у Exelute EXP 5/7)."""
        own = {offer.get('model'), offer['name']}
        return [
            str(param['v'])
            for param in offer.get('params') or []
            if cls.ALIAS.search(str(param.get('k'))) and re.search(r'\d', str(param.get('v'))) and param['v'] not in own
        ]

    def take(self, row: dict | None) -> None:
        if row is not None:
            self.used.update(id(part) for part in self.parts(row))

    def assign(self, offers: list) -> dict:
        """offers — позиции без строки остатков; → {id(позиции): строка остатков}."""
        keys = [(offer, *_sig(offer['name']), _code(offer['name'])) for offer in offers]
        got: dict = {}
        for row in self.stock:
            if id(row) in self.used:
                continue
            offer = self._by_options(row, keys) or self._by_code(row, keys)
            if offer is not None:
                got.setdefault(id(offer), []).append(row)
        return {key: _merge_stock(rows) for key, rows in got.items()}

    @staticmethod
    def _unique(cands: list) -> Any:
        return cands[0] if len(cands) == 1 else None

    def _by_options(self, row: dict, keys: list) -> Any:
        core, opt = _sig(row['name'])
        if len(core) < SIG_MIN:
            return None
        cands = [(len(own), offer) for offer, own_core, own, _ in keys if own_core == core and own <= opt]
        best = max((count for count, _ in cands), default=0)
        return self._unique([offer for count, offer in cands if count == best])

    def _by_code(self, row: dict, keys: list) -> Any:
        words = {_code(word) for word in row['name'].split()} - {''}
        return self._unique(
            [
                offer
                for offer, _, _, code in keys
                if len(code) >= self.CODE_MIN and code in words and re.search(r'[A-Z]', code) and re.search(r'\d', code)
            ]
        )


def apply_stock(offers, stock) -> int:
    """Остатки → в предложения фида; → число позиций с остатками."""
    idx = stock_index(stock)
    left = StockLeftovers(stock)
    rows: dict = {}
    for offer in offers:
        row = stock_row(stock, offer.get('sku'), offer['name'], idx)
        if row is None and offer.get('model'):
            row = stock_row(stock, '', offer['model'], idx)
        for alias in StockLeftovers.aliases(offer) if row is None else []:
            row = row or stock_row(stock, '', alias, idx)
        left.take(row)
        rows[id(offer)] = row
    extra = left.assign([offer for offer in offers if rows[id(offer)] is None])
    found = 0
    for offer in offers:
        row = rows[id(offer)] or extra.get(id(offer))
        offer['stockInfo'] = stock_info(row)
        offer['qty'] = offer['stockInfo']['qty']
        offer['available'] = offer['qty'] > 0
        offer['nostock'] = False
        found += row is not None
    return found
