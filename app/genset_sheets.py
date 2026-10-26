"""Прайс-склад генераторных установок (HERTZ): лист машин на складе и листы моделей — по заголовкам столбцов, в любом порядке
листов и строк. Строки прайса и наличие — в формате feed_files.parse_price / stock_info; сопоставление с карточками каталога —
по модели, исполнению (открытая / в кожухе) и альтернатору."""

import re
from collections import Counter
from typing import Any

LAT_CYR = str.maketrans('АВЕКМНОРСТХ', 'ABEKMHOPCTX')
PERCENT = 100
SHARE_MAX = 1
HEAD_SCAN = 15
TEXT_MAX = 40


class Exec:
    """Исполнение установки: из ячейки прайса, заголовка столбца или поля карточки."""

    OPEN = 'open'
    CAN = 'can'
    CONT = 'cont'
    WORDS = ((CONT, r'контейнер'), (CAN, r'кожух|капот'), (OPEN, r'открыт'))
    LABELS = {OPEN: 'открытого исполнения', CAN: 'в кожухе', CONT: 'в блок-контейнере'}

    @classmethod
    def of(cls, text: Any) -> str:
        low = str(text or '').lower()
        return next((key for key, regex in cls.WORDS if re.search(regex, low)), '')


class Model:
    """Код модели для сравнения: «HG 275 ВD» (русская В) = «HG275BD»; однофазная «HG 11 BC - 1» — свой код."""

    ALTS = ('crompton', 'leroy', 'evotec', 'stamford', 'hertz', 'mecc', 'marelli', 'linz', 'sincro', 'engga')

    @staticmethod
    def key(text: Any) -> str:
        return re.sub(r'[\s\-_.]', '', str(text or '').upper().translate(LAT_CYR))

    @staticmethod
    def alt(text: Any) -> str:
        """Альтернатор из «Мотор / Альтернатор / Контроллер» или поля карточки: первое слово второй части."""
        parts = [part.strip() for part in str(text or '').split('/')]
        name = parts[1] if len(parts) > 1 else parts[0]
        low = name.lower()
        return next((alt for alt in Model.ALTS if alt in low), '')


class Columns:
    """Номера столбцов по словам заголовка (несколько строк шапки склеиваются)."""

    def __init__(self, rows: list, start: int, depth: int = 3) -> None:
        self.titles: dict[int, str] = {}
        for row in rows[max(0, start - depth + 1) : start + 1]:
            for col, value in row.items():
                text = re.sub(r'\s+', ' ', str(value)).strip().lower()
                if text and text not in self.titles.get(col, ''):
                    self.titles[col] = (self.titles.get(col, '') + ' ' + text).strip()

    def find(self, regex: str, avoid: str = '') -> int | None:
        for col in sorted(self.titles):
            title = self.titles[col]
            if re.search(regex, title) and not (avoid and re.search(avoid, title)):
                return col
        return None


class Cell:
    @staticmethod
    def num(value: Any) -> float | None:
        text = re.sub(r'[\s\xa0]', '', str(value if value is not None else '')).replace(',', '.')
        try:
            return float(text)
        except ValueError:
            return None

    @staticmethod
    def text(row: dict, col: int | None) -> str:
        return re.sub(r'\s+', ' ', str(row.get(col, '') if col is not None else '')).strip()

    @staticmethod
    def cur(title: str) -> str:
        low = title.lower()
        if 'евро' in low or 'eur' in low or '€' in low:
            return 'EUR'
        if 'руб' in low or 'rub' in low:
            return 'RUB'
        if 'usd' in low or 'доллар' in low or '$' in low:
            return 'USD'
        return ''


class Stock:
    """Наличие машины по ячейке «Наличие»: склад в Московской области — в наличии; в производстве; остальное — в пути со сроком."""

    HOME = re.compile(r'склад', re.I)
    AWAY = re.compile(r'стамбул|турци|китай', re.I)
    PROD = re.compile(r'производств', re.I)
    DATE = re.compile(r'(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?')
    WHEN = re.compile(
        r'\d|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|нед|конец|середин|начал', re.I
    )
    ORDER = {'qty': 0, 'available': False, 'order': True}

    @classmethod
    def add(cls, state: dict, status: str) -> None:
        if cls.HOME.search(status) and not cls.AWAY.search(status):
            state['qty'] += 1
            place = status[:TEXT_MAX]
            state['wh'][place] = state['wh'].get(place, 0) + 1
            return
        state['prod' if cls.PROD.search(status) else 'transit'] += 1
        date = cls.DATE.search(status)
        if date:
            eta = f'{int(date.group(1)):02d}.{int(date.group(2)):02d}'
            if not state['eta'] or (eta[3:], eta[:2]) < (state['eta'][3:], state['eta'][:2]):
                state['eta'] = eta
        elif status:
            key = (
                'etaText' if cls.WHEN.search(status) else 'etaNote'
            )  # «оплачена», «в Стамбуле» — срок, только если другого нет
            if not state[key]:
                state[key] = re.sub(r'^прибыти[ея]\s*', '', status, flags=re.I)[:TEXT_MAX]

    @staticmethod
    def empty() -> dict:
        return {'qty': 0, 'wh': {}, 'transit': 0, 'prod': 0, 'eta': '', 'etaText': '', 'etaNote': ''}

    @staticmethod
    def info(state: dict) -> dict:
        """→ doc.stock (как feed_files.stock_info): {qty, available, wh, transit, prod, eta, promo}."""
        out: dict[str, Any] = {'qty': state['qty'], 'available': state['qty'] > 0}
        for key in ('transit', 'prod', 'eta', 'promo'):
            if state.get(key):
                out[key] = state[key]
        if not state.get('eta') and (state.get('etaText') or state.get('etaNote')):
            out['eta'] = state.get('etaText') or state['etaNote']
        if state['wh']:
            out['wh'] = sorted(([place, qty] for place, qty in state['wh'].items()), key=lambda pair: -pair[1])
        return out


class Units:
    """Лист машин на складе: модель, серийный номер, мощность, мотор / альтернатор, наличие, исполнение, РРЦ, дилер, % скидки."""

    @staticmethod
    def head(rows: list) -> int | None:
        for i, row in enumerate(rows[:HEAD_SCAN]):
            text = ' '.join(str(v).lower() for v in row.values())
            if 'модель' in text and 'наличи' in text and 'ррц' in text:
                return i
        return None

    @classmethod
    def parse(cls, sheet: str, rows: list) -> list:
        """→ [{model, exec, alt, kw, status, price, dealer, disc, cur, sale, sheet}] — по машине на строку."""
        head = cls.head(rows)
        if head is None:
            return []
        cols = Columns(rows, head, depth=1)
        pick = {
            'model': cols.find(r'модель'),
            'kw': cols.find(r'мощ'),
            'motor': cols.find(r'мотор|альтернатор|двигател'),
            'status': cols.find(r'наличи'),
            'exec': cols.find(r'исполнени'),
            'note': cols.find(r'коммент|примечан'),
            'rrc': cols.find(r'ррц'),
            'dealer': cols.find(r'дилер'),
            'disc': cols.find(r'скидк'),
        }
        cur = Cell.cur(cols.titles.get(pick['rrc'], '')) if pick['rrc'] is not None else ''
        out = []
        for row in rows[head + 1 :]:
            model = Cell.text(row, pick['model'])
            rrc = Cell.num(row.get(pick['rrc'])) if pick['rrc'] is not None else None
            if not model or not rrc or not re.search(r'\d', model):
                continue
            disc = Cell.num(row.get(pick['disc'])) if pick['disc'] is not None else None
            if disc is not None and 0 < disc <= SHARE_MAX:
                disc *= PERCENT
            note = Cell.text(row, pick['note'])
            out.append(
                {
                    'model': model,
                    'exec': Exec.of(Cell.text(row, pick['exec'])),
                    'alt': Model.alt(Cell.text(row, pick['motor'])),
                    'motor': Cell.text(row, pick['motor']),
                    'kw': Cell.num(row.get(pick['kw'])) if pick['kw'] is not None else None,
                    'status': Cell.text(row, pick['status']),
                    'price': rrc,
                    'dealer': Cell.num(row.get(pick['dealer'])) if pick['dealer'] is not None else None,
                    'disc': disc if disc and 0 < disc < PERCENT else None,
                    'cur': cur or 'EUR',
                    'sale': bool(re.search(r'распродаж|уценк', note, re.I)),
                    'sheet': sheet,
                }
            )
        return out


class Models:
    """Лист моделей: «Модель электростанции», двигатель, альтернатор, кВА / кВт, цены «открытый» / «в кожухе» / «шкаф АВР»
    (или «РРЦ» и «Дилер» одного исполнения)."""

    @staticmethod
    def head(rows: list) -> int | None:
        for i, row in enumerate(rows[:HEAD_SCAN]):
            cells = [str(v).lower() for v in row.values()]
            if any(re.search(r'^модель( электростанции)?$', cell.strip()) for cell in cells) and any(
                re.search(r'альтернатор|ррц', cell) for cell in cells
            ):
                return i
        return None

    @classmethod
    def parse(cls, sheet: str, rows: list) -> list:
        head = cls.head(rows)
        if head is None:
            return []
        cols = Columns(rows, head)
        model = next(
            (col for col, title in sorted(cols.titles.items()) if re.search(r'модель( электростанции)?$', title)), None
        )
        prices = cls._price_cols(cols)
        if model is None or not prices:
            return []
        engine, alt = cols.find(r'двигател'), cols.find(r'альтернатор')
        cur_col = cols.find(r'валют')
        power = cols.find(r'квт')
        out = []
        for row in rows[head + 1 :]:
            name = Cell.text(row, model)
            if not re.search(r'[A-Za-z]{2}\s*\d', name):
                continue
            cur = Cell.text(row, cur_col).upper() if cur_col is not None else ''
            avr = Cell.num(row.get(prices['avr'])) if prices.get('avr') is not None else None
            for kind in (Exec.OPEN, Exec.CAN):
                if prices.get(kind) is None:
                    continue
                out.append(
                    {
                        'model': name,
                        'exec': kind,
                        'alt': Model.alt(Cell.text(row, alt)),
                        'motor': ' / '.join(x for x in (Cell.text(row, engine), Cell.text(row, alt)) if x),
                        'price': Cell.num(row.get(prices[kind])),
                        'dealer': Cell.num(row.get(prices['dealer'])) if prices.get('dealer') is not None else None,
                        'disc': None,
                        'cur': cur if re.fullmatch(r'[A-Z]{3}', cur) else prices['cur'] or 'EUR',
                        'sale': False,
                        'sheet': sheet,
                        'avr': avr,
                        'kw': Cell.num(row.get(power)) if power is not None else None,
                    }
                )
        return out

    @staticmethod
    def _price_cols(cols: Columns) -> dict:
        rrc = cols.find(r'ррц')
        if rrc is not None:  # «Цена кожух б/АВР РРЦ, евро» и «… Дилер, евро» — одно исполнение
            kind = Exec.of(cols.titles[rrc]) or Exec.CAN
            return {kind: rrc, 'dealer': cols.find(r'дилер'), 'cur': Cell.cur(cols.titles[rrc])}
        return {
            Exec.OPEN: cols.find(r'открыт'),
            Exec.CAN: cols.find(r'кожух'),
            'avr': cols.find(r'авр'),
            'cur': '',
        }


class GensetBook:
    """Книга прайса-склада ДГУ → строки прайса (по модели и исполнению) с наличием машин."""

    @staticmethod
    def applies(book: list) -> bool:
        return any(Units.head(rows) is not None or Models.head(rows) is not None for _, rows in book)

    @classmethod
    def price_rows(cls, book: list) -> tuple:
        """→ (строки в формате parse_price + genset, сводка листов)."""
        units: list = []
        models: list = []
        sheets = []
        for sheet, rows in book:
            got = Units.parse(sheet, rows) or Models.parse(sheet, rows)
            if got:
                (units if Units.head(rows) is not None else models).extend(got)
                sheets.append(
                    {
                        'name': sheet,
                        'rows': len({row['model'] for row in got}),
                        'withPrice': sum(1 for x in got if x['price']),
                        'cur': got[0]['cur'],
                    }
                )
        out = cls._from_units(units)
        seen = {(Model.key(row['short']), row['genset']['exec'], row['genset']['alt']) for row in out}
        for row in models:
            if (Model.key(row['model']), row['exec'], row['alt']) not in seen:
                out.append(cls._row(row, None))
        return out, sheets

    @classmethod
    def _from_units(cls, units: list) -> list:
        groups: dict = {}
        for unit in units:
            groups.setdefault((Model.key(unit['model']), unit['exec'], unit['alt']), []).append(unit)
        out = []
        for group in groups.values():
            state = Stock.empty()
            for unit in group:
                Stock.add(state, unit['status'])
            full = [unit for unit in group if not unit['sale']] or group
            price = Counter(unit['price'] for unit in full).most_common(1)[0][0]
            base = next(unit for unit in full if unit['price'] == price)
            if len(full) < len(group) or base['sale']:
                state['promo'] = 'распродажа'
            out.append(cls._row(base, state))
        return out

    @staticmethod
    def _row(item: dict, state: dict | None) -> dict:
        name = '{} {}'.format(item['model'], Exec.LABELS.get(item['exec'], '')).strip()
        specs = []
        if item.get('motor'):
            specs.append(('Двигатель / альтернатор', item['motor']))
        if item.get('kw'):
            specs.append(('Номинальная мощность', '{:g} кВт'.format(item['kw'])))
        return {
            'sku': '',
            'name': name[:300],
            'short': item['model'],
            'pbar': '',
            'price': round(item['price'], 2) if item['price'] else None,
            'cur': item['cur'],
            'opts': [('Шкаф АВР', item['avr'])] if item.get('avr') else [],
            'specs': specs,
            'sheet': item['sheet'],
            'title': item['sheet'],
            'group': '',
            'sale': bool(state and state.get('promo')) and not item['price'],
            'dealer': round(item['dealer'], 2) if item.get('dealer') else None,
            'disc': item.get('disc'),
            'genset': {'exec': item['exec'], 'alt': item['alt']},
            'stockInfo': Stock.info(state) if state else dict(Stock.ORDER),  # машин на складе нет — под заказ
        }


class GensetMatch:
    """Карточка ДГУ ↔ строки прайса-склада: модель, исполнение и альтернатор (если указан и в строке, и в карточке)."""

    @staticmethod
    def card(name: str, model: str, attrs: dict, prices: list) -> tuple:
        """→ (строки, причина-если-нет) — как feed_files.match_card."""
        found = re.search(r'\b[A-Z]{1,3}[\s\-]*\d+[\s\-]*[A-ZА-Я]{2}\b', str(name or '').upper())
        key = Model.key(model) or Model.key(found.group(0) if found else '')
        kind = Exec.of(attrs.get('execution')) or Exec.of(name) or Exec.OPEN
        alt = Model.alt(attrs.get('alternator') or '')
        same = [price for price in prices if price.get('genset') and Model.key(price['short']) == key]
        rows = [price for price in same if price['genset']['exec'] in (kind, '')]  # шкаф АВР, автомат — без исполнения
        if not rows:
            return [], 'нет в прайсе'
        if alt and any(price['genset']['alt'] for price in rows):
            rows = [price for price in rows if price['genset']['alt'] in ('', alt)]
            if not rows:
                return [], 'другой альтернатор'
        priced = [price for price in rows if price['price']]
        return (priced, '') if priced else (rows, 'в прайсе без цены')

    @classmethod
    def pages(cls, pages: list, prices: list) -> tuple:
        """Позиции парса ↔ строки прайса → ({ссылка: строка}, сводка как у match_prices)."""
        hit = {}
        for page in pages:
            chars = dict(page.get('chars') or [])
            alt = next((val for key, val in chars.items() if re.search(r'альтернатор|генератор', key, re.I)), '')
            rows, why = cls.card(page['name'], page.get('model') or '', {'alternator': alt}, prices)
            if rows and not why:
                hit[page['url']] = rows[0]
        used = {id(row) for row in hit.values()}
        return hit, {
            'matched': len(hit),
            'how': {'genset': len(hit)},
            'priceOnly': sum(1 for price in prices if id(price) not in used),
        }

    @staticmethod
    def stock(rows: list) -> dict | None:
        """Наличие карточки — сумма по её строкам (разные альтернаторы одной модели в карточке без альтернатора)."""
        states = [price['stockInfo'] for price in rows if price.get('stockInfo')]
        if not states:
            return None
        out: dict[str, Any] = {'qty': 0, 'available': False}
        places: dict = {}
        for state in states:
            out['qty'] += state['qty']
            for key in ('transit', 'prod'):
                if state.get(key):
                    out[key] = out.get(key, 0) + state[key]
            for key in ('eta', 'promo', 'order'):
                if state.get(key) and not out.get(key):
                    out[key] = state[key]
            for place, qty in state.get('wh') or []:
                places[place] = places.get(place, 0) + qty
        out['available'] = out['qty'] > 0
        if out['qty'] or out.get('transit') or out.get('prod'):
            out.pop('order', None)
        if places:
            out['wh'] = sorted(([place, qty] for place, qty in places.items()), key=lambda pair: -pair[1])
        return out

    @staticmethod
    def unpriced(offers: list) -> None:
        """Позиции парса, которых нет в прайсе-складе, — не в наличии (прежнее наличие не остаётся)."""
        for offer in offers:
            if not offer.get('stockInfo'):
                offer.update(stockInfo={'qty': 0, 'available': False}, qty=0, available=False, nostock=False)

    @staticmethod
    def lost(doc: dict, rows: list, feed_id: str, today: str) -> bool:
        """Карточка без цены в прайсе-складе: наличие её строк (без машин — под заказ); модели нет — не в наличии, если
        наличие раньше дал этот фид. → изменилось ли."""
        if not rows and (doc.get('priceLink') or {}).get('feed') != feed_id:
            return False
        info = GensetMatch.stock(rows) or {'qty': 0, 'available': False}
        was = doc.get('stock') or {}
        if {key: val for key, val in was.items() if key not in ('at', 'gone')} == info:
            return False
        doc['stock'] = dict(info, at=today, gone=False)
        return True
