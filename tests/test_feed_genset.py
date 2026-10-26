# -*- coding: utf-8 -*-
"""Прайс-склад ДГУ (HERTZ, `genset_sheets`): листы машин и моделей читаются по шапкам в любом порядке листов и строк,
без листа машин — только цены моделей; закупка — «Цена Дилер»; наличие: склад в МО — в наличии, остальное — в пути со
сроком; карточка ↔ строка по модели, исполнению и альтернатору; фид только из прайса. Остатки Dalgakiran — без повторов
шапки, по модели при другом порядке строк."""
import io
import json
import random
import unittest
import zipfile
from xml.sax.saxutils import escape

from kit import TempStore

UNITS_HEAD = ['Модель / ссылка на ТС', 'Серийный номер', 'Ном.мощ-ть, кВт', 'Мотор / Альтернатор', 'Наличие', 'Исполнение',
              'Гарантия', 'Комментарии', 'Цена РРЦ, евро с НДС', 'Цена Дилер, евро с НДС', '% скидки']
UNITS = [
    ['HG 45 CH', 'A1', 32, 'Cummins / Hertz / ComAp', 'Склад Андреевское, МО', 'в кожухе', '24', 'Турция', 12680, 8242, 0.35],
    ['HG 45 CH', 'A2', 32, 'Cummins / Hertz / ComAp', 'прибытие 27.10.2026', 'в кожухе', '24', 'Турция', 12680, 8242, 0.35],
    ['HG 138 BC', 'B1', 100, 'Baudouin / Crompton', 'Склад Андреевское, МО', 'открытая', '24', 'распродажа', 21140, 13741, 0.35],
    ['HG 138 BC', 'B2', 100, 'Baudouin / Evotec / Datakom', 'На складе в Стамбуле', 'в кожухе', '24', 'Турция', 26200, '', 0.3],
    ['HG 275 ВD', 'C1', 200, 'Baudouin / Evotec', 'в производстве до 01.12.2026', 'в кожухе', '24', '', 41000, 28700, 0.3],
    ['HG 41 WL', 'D1', 30, 'Weichai / Leroy-Somer / ComAp', 'середина ноября', 'в кожухе', '24', '', 8280, 5796, 0.3],
    ['HG 41 WL', 'D2', 30, 'Weichai / Leroy-Somer / ComAp', 'оплачена', 'в кожухе', '24', '', 8280, 5796, 0.3],
]
MODEL_HEAD = [
    {4: '50 HZ / 400V', 7: 'Валюта', 8: 'Генератор открытый (с автоматом защиты от КЗ)'},
    {4: 'Максимальная мощность', 9: ' В кожухе', 10: 'Шкаф АВР'},
    {1: 'Модель электростанции', 2: 'Модель двигателя', 3: 'Модель альтернатора', 4: 'кВА', 6: 'кВт'},
]
MODELS = [
    ['Техничка', 'HG 45 CH', '4BTA', 'Hertz', 50, 45, 36, 'EUR', 11000, 12500, 900],
    ['Техничка', 'HG 60 CH', '6BT', 'Hertz', 66, 60, 48, 'EUR', 'по запросу', '-', '-'],
]


class Book:
    """Книга XLSX из листов {имя: строки} — строка списком значений или {столбец: значение}."""

    @staticmethod
    def col(i):
        return chr(ord('A') + i)

    @classmethod
    def sheet(cls, rows):
        out = []
        for r, row in enumerate(rows, 1):
            cells = row.items() if isinstance(row, dict) else enumerate(row)
            xml = ''
            for c, v in sorted(cells):
                if v in ('', None):
                    continue
                ref = '%s%d' % (cls.col(c), r)
                xml += ('<c r="%s"><v>%s</v></c>' % (ref, v) if isinstance(v, (int, float))
                        else '<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, escape(str(v))))
            out.append('<row r="%d">%s</row>' % (r, xml))
        return '<worksheet><sheetData>%s</sheetData></worksheet>' % ''.join(out)

    @classmethod
    def xlsx(cls, sheets):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            tags, rels = '', ''
            for i, (name, rows) in enumerate(sheets, 1):
                tags += '<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), i, i)
                rels += '<Relationship Id="rId%d" Target="worksheets/sheet%d.xml"/>' % (i, i)
                z.writestr('xl/worksheets/sheet%d.xml' % i, cls.sheet(rows))
            z.writestr('xl/workbook.xml', '<workbook xmlns:r="r"><sheets>%s</sheets></workbook>' % tags)
            z.writestr('xl/_rels/workbook.xml.rels', '<Relationships>%s</Relationships>' % rels)
        return buf.getvalue()


def hertz_sheets(seed=0):
    rnd = random.Random(seed)
    units, models = [list(row) for row in UNITS], [list(row) for row in MODELS]
    rnd.shuffle(units)
    rnd.shuffle(models)
    sheets = [
        ('Cклад Hertz', [['Склад HERTZ'], [], [], UNITS_HEAD, *units, ['', '', '', '', '', 'ЦЕНА ДИЛЕР АКТУАЛЬНА …']]),
        ('CUMMINS', [*MODEL_HEAD, {0: 'Cummins - Hertz'}, *models]),
        ('Адрес склада', [['Андреевское, МО']]),
    ]
    rnd.shuffle(sheets)
    return sheets


def card(name, model, execution, alternator=''):
    return {'id': 'c-' + model.replace(' ', '') + execution[:3] + alternator[:3], 'name': name, 'cat': 'dgu',
            'attrs': {'maker': 'HERTZ', 'model': model, 'execution': execution, 'alternator': alternator}}


class GensetSheetsTest(unittest.TestCase):
    def rows(self, seed=0, drop=()):
        import feed_files
        sheets = [sheet for sheet in hertz_sheets(seed) if sheet[0] not in drop]
        return {row['name']: row for row in feed_files.parse_price(Book.xlsx(sheets))[0]}

    def test_units_by_header_any_order(self):
        base = self.rows(0)
        for seed in (1, 2, 3, 7):
            self.assertEqual(json.dumps(self.rows(seed), sort_keys=True), json.dumps(base, sort_keys=True))
        hg45 = base['HG 45 CH в кожухе']
        self.assertEqual((hg45['price'], hg45['dealer'], hg45['disc'], hg45['cur']), (12680, 8242, 35, 'EUR'))
        self.assertEqual(hg45['stockInfo']['qty'], 1)
        self.assertEqual(hg45['stockInfo']['transit'], 1)
        self.assertEqual(hg45['stockInfo']['eta'], '27.10')
        self.assertEqual(hg45['stockInfo']['wh'], [['Склад Андреевское, МО', 1]])

    def test_statuses_and_sale(self):
        rows = self.rows()
        open_bc = rows['HG 138 BC открытого исполнения']
        self.assertEqual((open_bc['stockInfo']['qty'], open_bc['stockInfo']['promo']), (1, 'распродажа'))
        istanbul = rows['HG 138 BC в кожухе']['stockInfo']
        self.assertEqual((istanbul['qty'], istanbul['transit']), (0, 1))
        self.assertIsNone(rows['HG 138 BC в кожухе']['dealer'])  # нет «Цены Дилер» — закупка по «% скидки»
        prod = rows['HG 275 ВD в кожухе']['stockInfo']
        self.assertEqual((prod['prod'], prod['eta']), (1, '01.12'))
        paid = rows['HG 41 WL в кожухе']['stockInfo']
        self.assertEqual((paid['transit'], paid['eta']), (2, 'середина ноября'))  # «оплачена» — не срок
        self.assertEqual(rows['HG 45 CH открытого исполнения']['stockInfo'], {'qty': 0, 'available': False, 'order': True})

    def test_models_sheet_without_units(self):
        rows = self.rows(drop=('Cклад Hertz',))
        self.assertEqual(rows['HG 45 CH открытого исполнения']['price'], 11000)
        self.assertEqual(rows['HG 45 CH в кожухе']['price'], 12500)
        self.assertEqual(rows['HG 45 CH в кожухе']['opts'], [('Шкаф АВР', 900)])
        self.assertIsNone(rows['HG 60 CH в кожухе']['price'])  # «по запросу»
        with_units = self.rows()
        self.assertEqual(with_units['HG 45 CH в кожухе']['price'], 12680)  # лист машин важнее листа моделей

    def test_card_match(self):
        import feed_files
        prices = list(self.rows().values())
        got, why = feed_files.match_card('ДГУ HERTZ HG 45 CH в кожухе', 'HG 45 CH', {'execution': 'В кожухе'}, prices)
        self.assertEqual((why, got[0]['price']), ('', 12680))
        got, why = feed_files.match_card('ДГУ HG 275 BD', 'HG 275 BD', {'execution': 'В кожухе'}, prices)
        self.assertEqual((why, got[0]['price']), ('', 41000))  # «ВD» русской буквой — та же модель
        _, why = feed_files.match_card('x', 'HG 138 BC', {'execution': 'Открытое', 'alternator': 'Evotec'}, prices)
        self.assertEqual(why, 'другой альтернатор')
        got, why = feed_files.match_card('x', 'HG 138 BC', {'execution': 'Открытое', 'alternator': 'Crompton'}, prices)
        self.assertEqual((why, got[0]['price']), ('', 21140))
        _, why = feed_files.match_card('x', 'HG 60 CH', {'execution': 'В кожухе'}, prices)
        self.assertEqual(why, 'в прайсе без цены')
        _, why = feed_files.match_card('x', 'HG 999 CH', {'execution': 'В кожухе'}, prices)
        self.assertEqual(why, 'нет в прайсе')

    def test_other_price_not_genset(self):
        from genset_sheets import GensetBook
        dalg = [('DSP', [{0: 'Артикул', 1: 'Модель', 2: 'Название', 5: 'Мощность', 6: 'Двигатель', 9: 'Стоимость'}])]
        self.assertFalse(GensetBook.applies(dalg))


class GensetFeedTest(unittest.TestCase):
    def setUp(self):
        import feeds
        self.feeds = feeds
        temp = TempStore(self)
        self.st = temp.store
        self.addCleanup(setattr, feeds, 'DATA_DIR', feeds.DATA_DIR)
        feeds.DATA_DIR = temp.dir
        feeds._CACHE.clear()
        self.cards = [card('ДГУ HERTZ HG 45 CH в кожухе', 'HG 45 CH', 'В кожухе', 'Hertz'),
                      card('ДГУ HERTZ HG 138 BC открытого исполнения', 'HG 138 BC', 'Открытое', 'Crompton'),
                      card('ДГУ HERTZ HG 60 CH в кожухе', 'HG 60 CH', 'В кожухе')]
        for doc in self.cards:
            self.st.catalog_put(doc['id'], json.dumps(doc, ensure_ascii=False), 'тест')

    def run_feed(self, sheets):
        feeds = self.feeds
        rec = feeds.feed_get(self.st, 'hertz-ooo-gis') or feeds.feed_save(
            self.st, {'kind': 'files', 'name': 'HERTZ (ООО ГИС)', 'maker': 'HERTZ', 'priceKind': 'rrc', 'cur': 'EUR'})
        feeds.feed_file_put(self.st, rec['id'], 'price', Book.xlsx(sheets), 'hertz.xlsx')
        feeds.check_feed(self.st, feeds.feed_get(self.st, rec['id']), 'тест', log=lambda *a: None)
        return {doc['id']: json.loads(self.st.one('SELECT doc FROM catalog WHERE id=?', (doc['id'],))[0]) for doc in self.cards}

    def test_prices_only_feed(self):
        got = self.run_feed(hertz_sheets(4))
        hg45 = got[self.cards[0]['id']]
        self.assertEqual(hg45['rrc']['price'], 1268000)
        self.assertEqual(hg45['cost'], 824200)  # «Цена Дилер», а не сетка скидок фида
        self.assertEqual(hg45['stock']['qty'], 1)
        self.assertEqual(hg45['stock']['transit'], 1)
        sale = got[self.cards[1]['id']]
        self.assertEqual((sale['rrc']['price'], sale['stock']['promo']), (2114000, 'распродажа'))
        self.assertNotIn('rrc', got[self.cards[2]['id']])  # «по запросу» — цена карточки не трогается

    def test_new_price_file_moves_prices(self):
        self.run_feed(hertz_sheets(1))
        sheets = hertz_sheets(9)
        units = next(rows for name, rows in sheets if name == 'Cклад Hertz')
        for row in units:
            if row and row[0] == 'HG 45 CH':
                row[8], row[9], row[4] = 13000, 8450, 'Склад Андреевское, МО'
        self.feeds._CACHE.clear()
        hg45 = self.run_feed(sheets)[self.cards[0]['id']]
        self.assertEqual((hg45['rrc']['price'], hg45['cost'], hg45['stock']['qty']), (1300000, 845000, 2))


    def test_sold_out_resets_stock(self):
        self.run_feed(hertz_sheets(2))
        sheets = hertz_sheets(5)
        units = next(rows for name, rows in sheets if name == 'Cклад Hertz')
        units[:] = [row for row in units if not row or row[0] not in ('HG 45 CH', 'HG 138 BC')]
        self.feeds._CACHE.clear()
        got = self.run_feed(sheets)
        hg45 = got[self.cards[0]['id']]
        self.assertEqual((hg45['rrc']['price'], hg45['stock']['qty'], hg45['stock'].get('order')), (1250000, 0, True))
        self.assertEqual(got[self.cards[1]['id']]['stock']['qty'], 0)  # машину продали — модели нет в прайсе
        self.assertTrue(got[self.cards[2]['id']]['stock']['order'])  # «по запросу» — под заказ


class GensetPagesTest(unittest.TestCase):
    """Парс новых моделей + прайс-склад: позиция создаётся с ценой и наличием из прайса, фото — похожей модели."""

    def setUp(self):
        import feeds
        import images
        from equipment_types import load_types_builtin
        self.feeds, self.types = feeds, load_types_builtin()
        temp = TempStore(self)
        self.st = temp.store
        feeds._CACHE.clear()
        self.addCleanup(setattr, feeds, 'IMAGE_STORE', feeds.IMAGE_STORE)
        self.addCleanup(setattr, feeds, 'DATA_DIR', feeds.DATA_DIR)
        feeds.DATA_DIR = temp.dir
        feeds.IMAGE_STORE = images.ImageStore(temp.dir)
        for cid, name, photo in (('d1', 'Дизель-генераторная установка HERTZ HG 44 CH в кожухе', '/img/a.jpg'),
                                 ('d2', 'Дизель-генераторная установка HERTZ HG 44 CH открытого исполнения', '/img/b.jpg'),
                                 ('d3', 'Дизель-генераторная установка HERTZ HG 900 CH в кожухе', '/img/c.jpg')):
            doc = {'id': cid, 'name': name, 'photo': {'src': photo}, 'attrs': {'cat': 'dgu', 'maker': 'HERTZ', 'model': name.split('HERTZ ')[1][:9]}}
            self.st.catalog_put(cid, json.dumps(doc, ensure_ascii=False), 'тест')

    def test_new_model_priced_with_photo_from(self):
        feeds = self.feeds
        page = {'category': 'Дизельные генераторы', 'name': 'Дизель-генераторная установка HERTZ HG 45 CH в кожухе', 'model': 'HG 45 CH',
                'brand': 'HERTZ', 'url': 'https://example.ru/products/#hg-45-ch-can', 'images': [],
                'description': [{'title': 'Назначение', 'text': 'Резервное электроснабжение.'}], 'specs': [{'name': 'Исполнение', 'value': 'В кожухе'}]}
        rec = feeds.feed_save(self.st, {'kind': 'files', 'name': 'HERTZ', 'maker': 'HERTZ', 'priceKind': 'rrc', 'cur': 'EUR', 'pageDesc': False})
        feeds.feed_file_put(self.st, rec['id'], 'pages', json.dumps({'format': 'kp-parse/1', 'items': [page]}, ensure_ascii=False).encode(), 'parse.json')
        feeds.feed_file_put(self.st, rec['id'], 'price', Book.xlsx(hertz_sheets(2)), 'hertz.xlsx')
        res = feeds.import_feed(self.st, feeds.feed_get(self.st, rec['id']), self.types, feeds.IMAGE_STORE, 'тест', log=lambda *a: None)
        self.assertEqual((res['added'], res['errors'], res['photos']['borrowed']), (1, [], 1))
        doc = next(json.loads(text) for (text,) in self.st.all('SELECT doc FROM catalog') if 'HG 45' in text)
        self.assertEqual(doc['attrs']['cat'], 'dgu')
        self.assertEqual(doc['photoFrom']['id'], 'd1')  # тот же кожух и ближайший типоразмер
        self.assertEqual(doc['stock']['qty'], 1)
        self.assertEqual(doc['cost'], 824200)


class StockHeadTest(unittest.TestCase):
    def test_repeated_head_and_order(self):
        import feed_files
        head = ['Артикул', 'Номенклатура', 'Остаток']
        rows = [['A-1', 'Компрессор TIDY 10-10 (O)', 2], ['A-2', 'Осушитель DK 20', 1], ['A-3', 'Фильтр GON 100', 4]]
        base = None
        for seed in (0, 1, 2):
            shuffled = list(rows)
            random.Random(seed).shuffle(shuffled)
            data = Book.xlsx([('Остатки', [['Складские остатки'], head, head, *shuffled])])
            got = sorted((row['sku'], row['qty']) for row in feed_files.parse_stock(data))
            self.assertNotIn('Артикул', [sku for sku, _ in got])
            base = base or got
            self.assertEqual(got, base)
        self.assertEqual(len(base), 3)


if __name__ == '__main__':
    unittest.main()
