# -*- coding: utf-8 -*-
"""Выгрузка разделов базы — каталог по выбору (supplier_scope.ExportScope, решение владельца 18.10): несколько категорий,
производителей, поставщиков, фидов; внутри списка — «или», между списками — «и»; позиции целиком (с ценами)."""
import json
import unittest
import urllib.parse

from kit import Http, Stand, TempStore
from test_supplier_export import fill


class ScopeTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        fill(self.st)

    def ids(self, **pick):
        from supplier_scope import ExportScope
        return sorted(ExportScope(self.st).ids(ExportScope.clean(pick)))

    def test_pick(self):
        self.assertEqual(self.ids(makers=['ALFAair']), ['a1', 'a2'], 'производитель — без учёта регистра')
        self.assertEqual(self.ids(makers=['AlfaAir', 'BetaDry']), ['a1', 'a2', 'b1'], 'несколько производителей — любое')
        self.assertEqual(self.ids(sups=['ООО «Альфа»']), ['a1', 'a2'], 'поставщик — фид и производитель из справочника')
        self.assertEqual(self.ids(feeds=['fa', 'fb']), ['a1', 'b1'])
        self.assertEqual(self.ids(feeds=['']), ['a2', 'x1'], 'не из фида')
        self.assertEqual(self.ids(makers=['AlfaAir'], feeds=['fa']), ['a1'], 'между списками — и')
        self.assertEqual(self.ids(cats=['screw'], makers=['BetaDry']), [])
        from supplier_scope import ExportScope
        s = ExportScope(self.st).summary()
        self.assertEqual(sum(r['n'] for r in s['rows']), 4)
        self.assertEqual(s['feeds']['fa'], 'Фид Альфы')
        with self.assertRaises(ValueError):
            ExportScope.clean({'makers': 'AlfaAir'})
        with self.assertRaises(ValueError):
            ExportScope.clean({'makers': ['x'] * 1001})


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand('server')
        import storage
        fill(storage.Store(cls.stand.db))
        cls.stand.start()
        cls.h = cls.stand.http

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_export_pick(self):
        adm, A = self.stand.admin()
        st, b, _ = self.h.req('GET', '/api/admin/export/scope', cookie=adm, headers=A)
        self.assertEqual(st, 200, b)
        self.assertEqual(sum(r['n'] for r in Http.js(b)['rows']), 4)
        q = urllib.parse.urlencode({'sections': 'catalog,clients', 'images': '0', 'pick': json.dumps({'makers': ['AlfaAir'], 'feeds': ['fa']})})
        st, b, hd = self.h.req('GET', '/api/admin/export?' + q, cookie=adm, headers=A, raw=True)
        self.assertEqual(st, 200, b[:200])
        d = json.loads(b)
        self.assertEqual([x['id'] for x in d['sections']['catalog']], ['a1'])
        self.assertEqual(d['sections']['catalog'][0]['price'], 100000, 'позиции целиком — с ценами')
        self.assertIn('clients', d['sections'])
        self.assertEqual(d['pick'], {'feeds': ['fa'], 'makers': ['alfaair']})
        st, b, _ = self.h.req('GET', '/api/admin/export?' + urllib.parse.urlencode({'sections': 'catalog', 'pick': '{"makers": 5}'}), cookie=adm, headers=A)
        self.assertEqual(st, 400)
        self.assertEqual(self.stand.request_errors(), [])


if __name__ == '__main__':
    unittest.main()
