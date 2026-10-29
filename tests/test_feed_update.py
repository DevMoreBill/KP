# -*- coding: utf-8 -*-
"""«Обновить цены» / «Обновить остатки» фида из файлов (feed_update): новые файлы — в черновик, список «было → стало» без записи
в каталог, применение — кроме снятых галочек, файлы фида меняются только при «Применить», «Отмена» ничего не меняет; цены не
трогают наличие и наоборот; несколько прайсов — заменяется только выбранный. Вымышленные данные."""
import json
import os
import unittest

from kit import Stand, TempStore
from test_feed_genset import Book, card, hertz_sheets

PAGES = [
    {'category': 'Винтовые компрессоры', 'name': 'Винтовой компрессор ТестМаш ВК-10', 'model': 'ВК-10', 'brand': 'ТестМаш',
     'url': 'https://example.ru/vk-10', 'images': [], 'description': [{'title': 'Назначение', 'text': 'Сжатый воздух для цеха.'}],
     'specs': [{'name': 'Давление', 'value': '8 бар'}]},
    {'category': 'Винтовые компрессоры', 'name': 'Винтовой компрессор ТестМаш ВК-20', 'model': 'ВК-20', 'brand': 'ТестМаш',
     'url': 'https://example.ru/vk-20', 'images': [], 'description': [{'title': 'Назначение', 'text': 'Сжатый воздух для цеха.'}],
     'specs': [{'name': 'Давление', 'value': '8 бар'}]},
]


def price_book(vk10, vk20):
    return Book.xlsx([('Компрессоры', [['Артикул', 'Модель', 'Цена, €'],
                                       ['TM-10', 'Винтовой компрессор ТестМаш ВК-10', vk10],
                                       ['TM-20', 'Винтовой компрессор ТестМаш ВК-20', vk20]])])


def stock_book(vk10, vk20):
    return Book.xlsx([('Остатки', [['Артикул', 'Номенклатура', 'Остаток'],
                                   ['TM-10', 'Винтовой компрессор ТестМаш ВК-10', vk10],
                                   ['TM-20', 'Винтовой компрессор ТестМаш ВК-20', vk20]])])


class Base(unittest.TestCase):
    def setUp(self):
        import feeds
        from equipment_types import load_types_builtin
        self.feeds, self.types = feeds, load_types_builtin()
        temp = TempStore(self)
        self.st, self.dir = temp.store, temp.dir
        self.addCleanup(setattr, feeds, 'DATA_DIR', feeds.DATA_DIR)
        feeds.DATA_DIR = temp.dir
        feeds._CACHE.clear()
        feeds.JOBS.clear()

    def doc(self, cid):
        return json.loads(self.st.one('SELECT doc FROM catalog WHERE id=?', (cid,))[0])

    def draft(self, fid, scope, files):
        from feed_update import FeedDraft, FeedUpdate, Scope
        feed = self.feeds.feed_get(self.st, fid)
        draft = FeedDraft.start(self.dir, feed, Scope(scope))
        for name, data, slot in files:
            draft.put(feed, name, data, slot)
        return draft, FeedUpdate(self.st, feed, draft)


class GensetPricesTest(Base):
    """Прайс-склад HERTZ: позиции, заведённые вручную (price_cards)."""

    def setUp(self):
        super().setUp()
        self.cards = [card('ДГУ HERTZ HG 45 CH в кожухе', 'HG 45 CH', 'В кожухе', 'Hertz'),
                      card('ДГУ HERTZ HG 138 BC открытого исполнения', 'HG 138 BC', 'Открытое', 'Crompton')]
        for doc in self.cards:
            self.st.catalog_put(doc['id'], json.dumps(doc, ensure_ascii=False), 'тест')
        rec = self.feeds.feed_save(self.st, {'kind': 'files', 'name': 'HERTZ', 'maker': 'HERTZ', 'priceKind': 'rrc', 'cur': 'EUR'})
        self.fid = rec['id']
        self.feeds.feed_file_put(self.st, self.fid, 'price', Book.xlsx(hertz_sheets(1)), 'hertz-13.10.xlsx')
        self.feeds.check_feed(self.st, self.feeds.feed_get(self.st, self.fid), 'тест', log=lambda *a: None)

    def new_price(self):
        sheets = hertz_sheets(9)
        units = next(rows for name, rows in sheets if name == 'Cклад Hertz')
        for row in units:
            if row and row[0] == 'HG 45 CH':
                row[8], row[9], row[4] = 13000, 8450, 'Склад Андреевское, МО'
            if row and row[0] == 'HG 138 BC' and row[1] == 'B1':
                row[8] = 30000  # +42 % — резкое изменение
        return Book.xlsx(sheets)

    def test_preview_writes_nothing_then_apply(self):
        hg45, bc = self.cards[0]['id'], self.cards[1]['id']
        before = self.doc(hg45)
        draft, upd = self.draft(self.fid, 'price', [('hertz-28.10.xlsx', self.new_price(), None)])
        rep = upd.preview()
        self.assertEqual(self.doc(hg45), before, 'предпросмотр каталог не меняет')
        self.assertEqual(self.feeds.price_files(self.feeds.feed_get(self.st, self.fid))[0]['name'], 'hertz-13.10.xlsx')
        rows = {row['id']: row for row in rep['rows']}
        rrc = next(ch for ch in rows[hg45]['changes'] if ch['f'] == 'rrc')
        self.assertEqual((rrc['old'], rrc['new'], rrc['cur']), (1268000, 1300000, 'EUR'))
        self.assertEqual(rows[hg45]['dir'], 'up')
        self.assertTrue(rows[bc]['sharp'], 'больше ±20 % — подсвечено')
        self.assertEqual(rep['files'][0]['replaces'], 'hertz-13.10.xlsx', 'тот же поставщик по имени — замена')
        res = upd.apply([bc], 'админ')
        got = self.doc(hg45)
        self.assertEqual((got['rrc']['price'], got['cost']), (1300000, 845000))
        self.assertEqual(got['stock']['qty'], before['stock']['qty'], 'цены не трогают наличие')
        self.assertEqual(self.doc(bc)['rrc']['price'], 2114000, 'снятая галочка — позиция как была')
        self.assertEqual((res['skipped'], len(res['rows'])), (1, 1))
        feed = self.feeds.feed_get(self.st, self.fid)
        self.assertEqual([meta['name'] for meta in self.feeds.price_files(feed)], ['hertz-28.10.xlsx'])
        log = self.feeds.log_of(self.st, self.fid)[0]
        self.assertEqual((log['scope'], log['updated'] >= 1, log['price'][0]['name']), ('price', True, got['name']))
        self.assertFalse(os.path.exists(draft.root), 'черновик убран')

    def test_cancel_keeps_everything(self):
        from feed_update import FeedDraft
        draft, upd = self.draft(self.fid, 'price', [('hertz-28.10.xlsx', self.new_price(), None)])
        upd.preview()
        draft.drop()
        feed = self.feeds.feed_get(self.st, self.fid)
        self.assertEqual(self.feeds.price_files(feed)[0]['name'], 'hertz-13.10.xlsx')
        with self.assertRaisesRegex(ValueError, 'начните заново'):
            FeedDraft(self.dir, draft.token).info(feed)
        with self.assertRaisesRegex(ValueError, 'начните заново'):
            FeedDraft(self.dir, '../../etc')


class FilesFeedTest(Base):
    """Фид из файлов: парс + прайсы + остатки, позиции связаны с фидом."""

    def setUp(self):
        super().setUp()
        feeds = self.feeds
        rec = feeds.feed_save(self.st, {'kind': 'files', 'name': 'ТестМаш', 'maker': 'ТестМаш', 'priceKind': 'rrc', 'cur': 'EUR',
                                        'pageDesc': False})
        self.fid = rec['id']
        feeds.feed_file_put(self.st, self.fid, 'pages', json.dumps({'format': 'kp-parse/1', 'items': PAGES}, ensure_ascii=False).encode(), 'parse.json')
        feeds.feed_file_put(self.st, self.fid, 'price', price_book(1000, 2000), 'testmash-compressors.xlsx')
        feeds.feed_file_put(self.st, self.fid, 'stock', stock_book(2, 0), 'stock-01.10.xlsx')
        res = feeds.import_feed(self.st, feeds.feed_get(self.st, self.fid), self.types, feeds.IMAGE_STORE, 'тест', log=lambda *a: None)
        self.assertEqual(res['added'], 2, res)
        self.ids = {doc['name'][-5:]: doc['id'] for doc in feeds._feed_docs(self.st, self.fid)}

    def test_stock_only(self):
        vk10, vk20 = self.ids['ВК-10'], self.ids['ВК-20']
        self.assertEqual(self.doc(vk10)['stock']['qty'], 2)
        _, upd = self.draft(self.fid, 'stock', [('stock-28.10.xlsx', stock_book(0, 5), None)])
        rep = upd.preview()
        rows = {row['id']: row for row in rep['rows']}
        self.assertEqual((rows[vk10]['dir'], rows[vk20]['dir']), ('out', 'in'))
        change = rows[vk20]['changes'][0]
        self.assertEqual((change['old']['text'], change['new']['text']), ('нет в наличии', 'в наличии 5'))
        price = self.doc(vk10)['rrc']['price']
        upd.apply([], 'админ')
        self.assertEqual((self.doc(vk10)['stock']['qty'], self.doc(vk20)['stock']['qty']), (0, 5))
        self.assertEqual(self.doc(vk10)['rrc']['price'], price, 'остатки не трогают цены')
        self.assertEqual(self.feeds.feed_get(self.st, self.fid)['files']['stock']['name'], 'stock-28.10.xlsx')

    def test_price_with_two_files(self):
        feeds = self.feeds
        dryers = Book.xlsx([('Осушители', [['Артикул', 'Модель', 'Цена, €'], ['TM-D', 'Осушитель ТестМаш ОР-1', 500]])])
        feeds.feed_file_put(self.st, self.fid, 'price', dryers, 'testmash-dryers.xlsx')
        _, upd = self.draft(self.fid, 'price', [('testmash-compressors-28.10.xlsx', price_book(1100, 2000), None)])
        rep = upd.preview()
        self.assertEqual([row['id'] for row in rep['rows']], [self.ids['ВК-10']], 'изменилась одна цена')
        self.assertEqual(rep['rows'][0]['changes'][0]['pct'], 10.0)
        upd.apply([], 'админ')
        names = sorted(meta['name'] for meta in feeds.price_files(feeds.feed_get(self.st, self.fid)))
        self.assertEqual(names, ['testmash-compressors-28.10.xlsx', 'testmash-dryers.xlsx'], 'второй прайс остался')
        self.assertEqual(self.doc(self.ids['ВК-10'])['stock']['qty'], 2, 'наличие не трогается')


    def test_compressor_price_with_rrc_is_not_genset(self):
        """Прайс компрессоров «Модель / РРЦ» (Абсолют Индастриал) — не прайс-склад ДГУ: наличие — из файла остатков."""
        feeds = self.feeds
        book = Book.xlsx([('Компрессоры', [['Бренд', 'Модель', 'Наличие', 'РРЦ, €'],
                                           ['ТестМаш', 'Винтовой компрессор ТестМаш ВК-10', 'на складе', 1000],
                                           ['ТестМаш', 'Винтовой компрессор ТестМаш ВК-20', 'под заказ', 2000]])])
        feeds.feed_file_put(self.st, self.fid, 'price', book, 'testmash-compressors.xlsx')
        feed = feeds.load(self.st, feeds.feed_get(self.st, self.fid), max_age=0)
        self.assertFalse(any(price.get('genset') for price in feed['prices']))
        self.assertEqual(sorted(offer['qty'] for offer in feed['offers']), [0, 2], 'наличие — из файла остатков')

    def test_other_file_name(self):
        """Один прайс — новый файл с любым именем его заменяет; несколько — неузнанный файл можно переставить."""
        from feed_update import FeedDraft, Scope
        feeds = self.feeds
        draft, _ = self.draft(self.fid, 'price', [('price-new.xlsx', price_book(1200, 2000), None)])
        self.assertEqual(draft.info(feeds.feed_get(self.st, self.fid))['files'][0]['replaces'], 'testmash-compressors.xlsx')
        dryers = Book.xlsx([('Осушители', [['Артикул', 'Модель', 'Цена, €'], ['TM-D', 'Осушитель ТестМаш ОР-1', 500]])])
        feeds.feed_file_put(self.st, self.fid, 'price', dryers, 'testmash-dryers.xlsx')
        feed = feeds.feed_get(self.st, self.fid)
        draft = FeedDraft.start(self.dir, feed, Scope.PRICE)
        rec = draft.put(feed, 'price-new.xlsx', price_book(1200, 2000), None)
        self.assertEqual(rec['replaces'], '', 'несколько прайсов, имя не узнано — новый прайс')
        slot = next(meta['slot'] for meta in feeds.price_files(feed) if meta['name'] == 'testmash-compressors.xlsx')
        moved = draft.move(feed, rec['slot'], slot)
        self.assertEqual(moved['replaces'], 'testmash-compressors.xlsx')
        self.assertEqual(len(draft.info(feed)['files']), 1)
        prices = feeds.price_files(draft.config(feed))
        self.assertEqual(sorted(meta['name'] for meta in prices), ['price-new.xlsx', 'testmash-dryers.xlsx'])
        back = draft.move(feed, slot, 'new')
        self.assertEqual(back['replaces'], '')
        self.assertEqual(len(feeds.price_files(draft.config(feed))), 3, 'прежний прайс вернулся, новый — отдельно')


class RouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand().start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def call(self, path, body=None, raw=None, **query):
        adm, csrf = self.stand.admin()
        qs = '&'.join(f'{k}={v}' for k, v in query.items())
        data = raw if raw is not None else (body or {})
        headers = dict(csrf, **({'Content-Type': 'application/octet-stream'} if raw is not None else {}))
        st, text, _ = self.stand.http.req('POST', f'/api/admin/feeds/{path}' + (f'?{qs}' if qs else ''), data, cookie=adm, headers=headers)
        return st, (json.loads(text) if text.startswith('{') else text)

    def test_flow_and_switch(self):
        adm, csrf = self.stand.admin()
        st, text, _ = self.stand.http.req('POST', '/api/admin/feeds', {'kind': 'files', 'name': 'Прайс тест', 'maker': 'ТестМаш', 'cur': 'EUR'},
                                          cookie=adm, headers=csrf)
        self.assertEqual(st, 200, text)
        fid = json.loads(text)['id']
        st, text, _ = self.stand.http.req('POST', f'/api/admin/feeds/{fid}/upload?kind=price&name=a.xlsx', price_book(1000, 2000),
                                          cookie=adm, headers=dict(csrf, **{'Content-Type': 'application/octet-stream'}))
        self.assertEqual(st, 200, text)
        st, got = self.call(f'{fid}/update/start', {'scope': 'price'})
        self.assertEqual(st, 200, got)
        token = got['token']
        st, got = self.call(f'{fid}/update/preview', {'token': token})
        self.assertEqual(st, 400, 'без нового файла — нечего показывать')
        st, got = self.call(f'{fid}/update/file', raw=price_book(1500, 2000), token=token, name='a-2.xlsx')
        self.assertEqual((st, got.get('replaces')), (200, 'a.xlsx'), got)
        st, got = self.call(f'{fid}/update/preview', {'token': token})
        self.assertEqual(st, 200, got)
        self.assertIn('rows', got)
        st, got = self.call(f'{fid}/update/cancel', {'token': token})
        self.assertEqual(st, 200, got)
        st, got = self.call(f'{fid}/update/start', {'scope': 'всё'})
        self.assertEqual(st, 400)
        st, text, _ = self.stand.http.req('POST', '/api/admin/features', {'values': {'feedUpdate': {'on': False}}}, cookie=adm, headers=csrf)
        self.assertEqual(st, 200, text)
        st, got = self.call(f'{fid}/update/start', {'scope': 'price'})
        self.assertEqual(st, 403, 'выключено — закрыто')


if __name__ == '__main__':
    unittest.main()
