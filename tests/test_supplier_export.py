# -*- coding: utf-8 -*-
"""Выгрузка каталога по поставщику («Настройки → Обслуживание → Копии и база → Каталог поставщика»; supplier_scope.py):
поставщик позиции — как в фильтре каталога (фид → поставщик справочника или название фида; не из фида — по производителю),
в файле нет цен, закупки и остатков, при загрузке копии обратно они остаются как в базе; книга Excel для правки
(catalog_patch.CatalogSheet) меняет только исправленные ячейки, поле, изменённое после выгрузки, пропускается."""
import io
import json
import os
import sys
import unittest
import zipfile
from xml.sax.saxutils import escape

from kit import Http, Stand, TempStore

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))


def fill(store):
    store.supplier_put('sup1', {'id': 'sup1', 'name': 'ООО «Альфа»', 'makers': ['AlfaAir']})
    store.kv_set('feeds', {'items': [{'id': 'fa', 'kind': 'yml', 'name': 'Фид Альфы', 'supplier': 'sup1', 'url': 'https://example.ru/a.xml'},
                                     {'id': 'fb', 'kind': 'yml', 'name': 'Бета', 'url': 'https://example.ru/b.xml'}]})
    put = lambda cid, doc: store.catalog_put(cid, json.dumps(dict(doc, id=cid), ensure_ascii=False))
    put('a1', {'name': 'Компрессор А1', 'attrs': {'cat': 'screw', 'maker': 'AlfaAir', 'model': 'A1', 'power': 7.5}, 'feed': {'id': 'fa', 'oid': '1'},
               'price': 100000, 'cost': 70000, 'costCur': 'EUR', 'stock': {'qty': 3}})
    put('a2', {'name': 'Компрессор А2', 'attrs': {'cat': 'screw', 'maker': 'alfaair', 'model': 'A2'}, 'price': 200000, 'rrc': 210000})
    put('b1', {'name': 'Осушитель Б1', 'attrs': {'cat': 'dryer', 'maker': 'BetaDry'}, 'feed': {'id': 'fb', 'oid': '7'}, 'price': 5})
    put('x1', {'name': 'Ничей', 'attrs': {'cat': 'other', 'maker': 'Кто-то'}})


def book(sheets):
    """Минимальная книга .xlsx: {имя: [[ячейки]]} (строки — inlineStr, числа — числом); имя «_было» — скрытый лист."""
    def col(i):
        s = ''
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    def cell(r, c, v):
        ref = '%s%d' % (col(c), r + 1)
        if isinstance(v, (int, float)):
            return '<c r="%s"><v>%s</v></c>' % (ref, v)
        return '<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, escape(str(v)))
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        names = list(sheets)
        z.writestr('xl/workbook.xml', '<workbook xmlns:r="r"><sheets>%s</sheets></workbook>' % ''.join(
            '<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(n), i + 1, i + 1) for i, n in enumerate(names)))
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships>%s</Relationships>' % ''.join(
            '<Relationship Id="rId%d" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(len(names))))
        for i, n in enumerate(names):
            rows = ''.join('<row r="%d">%s</row>' % (r + 1, ''.join(cell(r, c, v) for c, v in enumerate(row) if v != ''))
                           for r, row in enumerate(sheets[n]))
            z.writestr('xl/worksheets/sheet%d.xml' % (i + 1), '<worksheet><sheetData>%s</sheetData></worksheet>' % rows)
    return b.getvalue()


class UnitTest(unittest.TestCase):
    def test_groups_and_docs(self):
        from supplier_scope import SupplierScope
        st = TempStore(self).store
        fill(st)
        g = {x['name']: x for x in SupplierScope(st).groups()}
        self.assertEqual(g['ООО «Альфа»']['count'], 2, 'фид, привязанный к поставщику, и производитель из его карточки')
        self.assertTrue(g['ООО «Альфа»']['dir'])
        self.assertEqual((g['Бета']['count'], g['Бета']['dir']), (1, False), 'фид без поставщика — по названию фида')
        self.assertEqual(g[SupplierScope.NONE]['count'], 1)
        docs = SupplierScope(st).docs('ооо альфа')        # регистр и кавычки не важны
        self.assertEqual([d['id'] for d in docs], ['a1', 'a2'])
        for d in docs:
            self.assertFalse(set(d) & set(SupplierScope.PRICE_KEYS), 'без цен, закупки и остатков')
        self.assertEqual(docs[0]['attrs']['power'], 7.5)
        with self.assertRaises(ValueError):
            SupplierScope(st).docs('Нет такого')

    def test_sheet_patch(self):
        from catalog_patch import CatalogPatch, CatalogSheet
        st = TempStore(self).store
        fill(st)
        head = [['Код', 'Название', 'Модель', 'Мощность'], ['id', 'name', 'a:model', 'a:power']]
        orig = [['id', 'ключ', 'значение'], ['a1'], ['a1', 'name', '"Компрессор А1"'], ['a1', 'a:model', '"A1"'], ['a1', 'a:power', '7.5'],
                ['a2'], ['a2', 'name', '"Компрессор А2"'], ['a2', 'a:model', '"A2"']]
        # после выгрузки модель a2 изменили в программе — правка этого поля пропускается
        d = json.loads(st.catalog_get('a2'))
        d['attrs']['model'] = 'A2-new'
        st.catalog_put('a2', json.dumps(d, ensure_ascii=False))
        data = book({'Как править': [['…']],
                     'Винтовые': head + [['a1', 'Компрессор А1 (исправлено)', 'A1', '11'], ['a2', 'Компрессор А2', 'A2-old', ''], ['zz', 'Нет в базе', '', '']],
                     '_было': orig})
        self.assertTrue(CatalogSheet.is_book(data))
        p = CatalogSheet(st).patch(data, 'книга.xlsx')
        self.assertTrue(CatalogPatch.is_patch(p))
        res = CatalogPatch(st).run(p, True, 'тест')
        self.assertEqual(res['patch']['missing'], 1)
        self.assertEqual(res['patch']['conflictCount'], 1, 'модель a2 изменена после выгрузки')
        a1 = json.loads(st.catalog_get('a1'))
        self.assertEqual(a1['name'], 'Компрессор А1 (исправлено)')
        self.assertEqual(a1['attrs']['power'], 11, 'число остаётся числом')
        self.assertEqual((a1['price'], a1['cost'], a1['stock']), (100000, 70000, {'qty': 3}), 'цены и остатки не тронуты')
        self.assertEqual(json.loads(st.catalog_get('a2'))['attrs']['model'], 'A2-new')
        self.assertEqual(CatalogSheet._value('7.2999999999999998', 7.3, True), 7.3, 'число, пересохранённое Excel')
        self.assertIs(CatalogSheet._value('да', False, False), True)
        self.assertFalse(CatalogSheet.is_book(b'{"format":"kp-backup"}'))
        with self.assertRaises(ValueError):
            CatalogSheet(st).patch(book({'Лист1': [['a', 'b']]}))


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand().start()
        cls.adm, cls.A = cls.stand.admin()
        import storage
        fill(storage.Store(cls.stand.db))

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def get(self, path, **kw):
        return self.stand.http.req('GET', '/api/admin/' + path, cookie=self.adm, headers=dict(self.A), **kw)

    def test_admin_only(self):
        st, _, _ = self.stand.http.req('GET', '/api/admin/export/suppliers')
        self.assertIn(st, (401, 403))
        st, _, _ = self.stand.http.req('GET', '/api/admin/export?sup=%D0%91%D0%B5%D1%82%D0%B0')
        self.assertIn(st, (401, 403), 'выгрузка — только администратору')

    def test_export_and_import_keeps_prices(self):
        import urllib.parse
        st, b, _ = self.get('export/suppliers')
        self.assertIn('ООО «Альфа»', [x['name'] for x in Http.js(b)])
        st, b, h = self.get('export?' + urllib.parse.urlencode({'sup': 'ООО «Альфа»', 'images': '0'}), raw=True)
        self.assertEqual(st, 200)
        d = json.loads(b)
        self.assertEqual(d['supplier'], 'ООО «Альфа»')
        items = d['sections']['catalog']
        self.assertEqual(sorted(x['id'] for x in items), ['a1', 'a2'])
        self.assertNotIn('price', json.dumps(items))
        self.assertEqual(list(d['sections']), ['catalog'], 'только каталог, без других разделов')
        # цену поменяли после выгрузки; загрузка копии обратно цену не трогает, название — из копии
        import storage
        s = storage.Store(self.stand.db)
        a1 = json.loads(s.catalog_get('a1'))
        a1.update(price=123456, name='Переименовано')
        s.catalog_put('a1', json.dumps(a1, ensure_ascii=False))
        hd = dict(self.A, **{'Content-Type': 'application/json'})
        st, b, _ = self.stand.http.req('POST', '/api/admin/import/file/preview', json.dumps(d, ensure_ascii=False).encode(), cookie=self.adm, headers=hd)
        self.assertTrue(Http.js(b)['keep'])
        st, b, _ = self.stand.http.req('POST', '/api/admin/import/file', json.dumps(d, ensure_ascii=False).encode(), cookie=self.adm, headers=hd)
        self.assertEqual(st, 200)
        a1 = json.loads(s.catalog_get('a1'))
        self.assertEqual((a1['name'], a1['price'], a1['cost'], a1['stock']), ('Компрессор А1', 123456, 70000, {'qty': 3}))

    def test_excel_route(self):
        data = book({'Л': [['Код', 'Название'], ['id', 'name'], ['b1', 'Осушитель Б1 исправлен']]})
        hd = dict(self.A, **{'Content-Type': 'application/zip'})
        st, b, _ = self.stand.http.req('POST', '/api/admin/import/file/preview?name=x.xlsx', data, cookie=self.adm, headers=hd)
        r = Http.js(b)
        self.assertEqual((r['patch']['items'], r['applied']), (1, False))
        st, b, _ = self.stand.http.req('POST', '/api/admin/import/file?name=x.xlsx', data, cookie=self.adm, headers=hd)
        import storage
        b1 = json.loads(storage.Store(self.stand.db).catalog_get('b1'))
        self.assertEqual((b1['name'], b1['price']), ('Осушитель Б1 исправлен', 5))


if __name__ == '__main__':
    unittest.main(verbosity=2)
