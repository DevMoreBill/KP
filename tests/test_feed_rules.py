# -*- coding: utf-8 -*-
"""«Что загружать» в фиде (feeds.FeedRules): отбор (марки, слова, стоп-слова, цена, наличие, «новые не создавать»),
поля, которые обновляются у загруженных позиций (выключенное остаётся как в каталоге, и при ежедневной проверке),
план «добавится / изменится / без изменений / пропущено» без записи; маршрут плана — только администратору."""
import json
import unittest

from kit import Http, Stand, TempStore

YML = '''<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-10-17 10:00"><shop><name>Тест</name><categories><category id="1">Компрессоры</category><category id="2">Прочее</category></categories>
<offers>
<offer id="a1" available="true"><name>Компрессор винтовой Alfa 7</name><vendor>Alfa</vendor><price>{p1}</price><currencyId>RUB</currencyId><categoryId>1</categoryId><param name="Мощность">7,5</param><description>Описание {d1}</description></offer>
<offer id="a2" available="false"><name>Компрессор винтовой Alfa 11</name><vendor>Alfa</vendor><price>200000</price><currencyId>RUB</currencyId><categoryId>1</categoryId></offer>
<offer id="b1" available="true"><name>Компрессор Beta 5 б/у</name><vendor>Beta</vendor><price>50000</price><currencyId>RUB</currencyId><categoryId>1</categoryId></offer>
<offer id="c1" available="true"><name>Ремкомплект</name><vendor>Gamma</vendor><price>900</price><currencyId>RUB</currencyId><categoryId>2</categoryId></offer>
</offers></shop></yml_catalog>'''


class Fake:
    """Подмена скачивания фида: текст YML вместо сети."""
    def __init__(self, feeds):
        self.feeds, self.text, self.orig = feeds, YML.format(p1=100000, d1='первое'), feeds.fetch
        feeds.fetch = lambda url: self.text.encode('utf-8')

    def close(self):
        self.feeds.fetch = self.orig


class UnitTest(unittest.TestCase):
    def setUp(self):
        import feeds
        from equipment_types import load_types_builtin
        self.feeds, self.types = feeds, load_types_builtin()
        self.st = TempStore(self).store
        self.fake = Fake(feeds)
        self.addCleanup(self.fake.close)
        feeds.feed_save(self.st, {'url': 'https://example.ru/f.xml', 'name': 'Тест', 'pageDesc': False})
        self.f = feeds.feeds(self.st)[0]
        feeds._CACHE.clear()

    def save(self, **kw):
        self.f = self.feeds.feed_save(self.st, dict(self.f, **kw))
        self.feeds._CACHE.clear()

    def test_filter_and_plan(self):
        F = self.feeds.FeedRules
        self.save(cats={'2': 'skip'}, filter={'brands': ['Alfa', 'Beta'], 'stop': 'б/у', 'priceMax': '150000', 'avail': True})
        p = F.plan(self.st, self.f, self.types)
        st = {r['oid']: (r['status'], r['why']) for r in p['rows']}
        self.assertEqual(st['a1'], ('add', ''))
        self.assertEqual(st['a2'][0], 'skip', 'дороже 150 000 и нет в наличии')
        self.assertEqual(st['b1'], ('skip', 'в названии «б/у»'))
        self.assertEqual(st['c1'], ('skip', 'категория фида пропускается'))
        self.assertEqual(p['counts'], {'add': 1, 'update': 0, 'same': 0, 'skip': 3})
        self.assertEqual(dict(p['brands'])['Alfa'], 2)
        self.assertEqual(self.st.catalog_count(), 0, 'план ничего не пишет')
        r = self.feeds.import_feed(self.st, self.f, self.types, None, 'тест', log=lambda *a: None)
        self.assertEqual((r['added'], r['total']), (1, 1))

    def test_fields_kept(self):
        F = self.feeds.FeedRules
        self.feeds.import_feed(self.st, self.f, self.types, None, 'тест', log=lambda *a: None)
        cid = next(d['id'] for d in self.feeds._feed_docs(self.st, self.f['id']) if d['feed']['oid'] == 'a1')
        doc = json.loads(self.st.catalog_get(cid))
        doc['name'] = 'Своё название'          # ручная правка названия
        self.st.catalog_put(cid, json.dumps(doc, ensure_ascii=False))
        self.fake.text = YML.format(p1=120000, d1='второе')
        self.save(fields={'price': False, 'desc': False}, filter={'add': False})
        p = F.plan(self.st, self.f, self.types)
        row = next(r for r in p['rows'] if r['oid'] == 'a1')
        self.assertEqual(row['status'], 'same', row)
        self.assertEqual(p['counts']['add'], 0, 'новые не создаются')
        self.feeds.import_feed(self.st, self.f, self.types, None, 'тест', log=lambda *a: None)
        doc2 = json.loads(self.st.catalog_get(cid))
        self.assertEqual(doc2['price'], doc['price'], 'цена не обновлена — выключена')
        self.assertEqual(doc2['name'], 'Своё название')
        self.assertIn('первое', json.dumps(doc2['features'], ensure_ascii=False), 'описание — как было')
        self.assertEqual(self.st.catalog_count(), 4, 'новых позиций нет (все 4 загружены в первый раз)')
        self.feeds.check_feed(self.st, self.f, 'тест', log=lambda *a: None)
        self.assertEqual(json.loads(self.st.catalog_get(cid))['price'], doc['price'], 'и ежедневная проверка цену не трогает')
        self.save(fields={'price': True, 'desc': True})
        row = next(r for r in F.plan(self.st, self.f, self.types)['rows'] if r['oid'] == 'a1')
        self.assertEqual(row['status'], 'update')
        self.assertIn('Цены (РРЦ, закупка)', row['changes'])


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand().start()
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_admin_only(self):
        h = {'Content-Type': 'application/json'}
        st, b, _ = self.stand.http.req('POST', '/api/admin/feeds', {'url': 'https://example.invalid/f.xml', 'name': 'Т'}, cookie=self.adm, headers=dict(h, **self.A))
        fid = Http.js(b)['id']
        self.assertEqual(self.stand.http.req('POST', '/api/admin/feeds/%s/loadplan' % fid, {}, headers=h)[0], 401)
        st, b, _ = self.stand.http.req('POST', '/api/admin/feeds/%s/loadplan' % fid, {'filter': {'words': 'x'}}, cookie=self.adm, headers=dict(h, **self.A))
        self.assertEqual(st, 422, 'фид недоступен — понятная ошибка, не 500')


if __name__ == '__main__':
    unittest.main(verbosity=2)
