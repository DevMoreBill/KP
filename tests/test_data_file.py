# -*- coding: utf-8 -*-
"""Единые форматы выгрузки (data_file.DataFile, решение владельца 18.10): у каждого варианта — Excel, JSON, XML, YML,
архив .zip; любой файл загружается обратно с теми же данными; «только изменённое в файле» — по отпечаткам записей;
«Каталог по фильтру» (supplier_scope.CatalogFilter) — без невыбранных цен, при загрузке они остаются в базе."""
import json
import unittest
import urllib.parse

from kit import Http, SampleData, Stand


DOC = {'format': 'kp-backup', 'version': 1, 'createdAt': '2026-10-18T10:00:00', 'keep': ['cost'],
       'digests': {'catalog': {'c1': 'abc'}},
       'sections': {
           'catalog': [
               {'id': 'c1', 'name': 'Компрессор «Тест» 7,5 кВт', 'price': 125000.5, 'priceCur': 'RUB', 'kind': 'equip',
                'attrs': {'cat': 'comp_screw', 'maker': 'ТестМаш', 'flow': 7.3, 'kw': 10.0, 'oil': True, 'code': '007',
                          'list': ['a', 'b'], 'deep': {'x': 1}},
                'features': [{'label': 'Назначение', 'text': 'Строка\r\nс переводом\tи табом\x01'}],
                'photo': {'src': '/img/c1.jpg', 'on': True}, 'gallery': [], 'opts': {}, 'big': 10 ** 16, 'long': 'Я' * 70000},
               {'id': 'c2', 'name': '  пробелы  ', 'stock': {'qty': 0, 'available': False}, 'num': -3, 'neg': -0.25}],
           'clients': [{'id': 'k1', 'name': 'ООО Ромашка', 'inn': '7700000000', 'contacts': [{'name': 'Иван', 'phone': '+7'}]}],
           'suppliers': {'suppliers': [{'id': 's1', 'name': 'Поставщик'}], 'customs': {'cat:x': {'code': '8414', 'duty': 0}}},
           'settings': {'types': [{'id': 't', 'name': 'Тип', 'fields': []}], 'settings': {'a': 1, 'b': 'текст', 'c': None}},
       }}


class FormatsTest(unittest.TestCase):
    def roundtrip(self, fmt):
        from data_file import DataFile
        data, ext, ctype, _ = DataFile().dump(json.dumps(DOC, ensure_ascii=False), fmt)
        self.assertTrue(ext.startswith('.'))
        d, z, _ = DataFile().load(data)
        if z:
            z.close()
        return d

    def test_xml_yml_exact(self):
        self.assertEqual(self.roundtrip('xml'), DOC)
        self.assertEqual(self.roundtrip('yml'), DOC, 'YML — те же данные (<kp_data> внутри yml_catalog)')

    def test_xlsx(self):
        from data_file import DataFile
        d = self.roundtrip('xlsx')
        a, b = DOC['sections']['catalog'], d['sections']['catalog']
        self.assertEqual([DataFile.digest(x) for x in a], [DataFile.digest(x) for x in b], 'записи каталога — те же')
        self.assertEqual(b[0]['long'], 'Я' * 70000, 'длинное значение — частями на скрытом листе')
        self.assertEqual(b[0]['attrs']['code'], '007', 'текст из цифр остаётся текстом')
        self.assertIs(b[0]['attrs']['oil'], True)
        self.assertEqual(b[0]['features'][0]['text'], 'Строка\r\nс переводом\tи табом\x01')
        self.assertEqual(b[0]['opts'], {}, 'пустой объект не теряется')
        self.assertEqual(b[1]['name'], '  пробелы  ')
        self.assertEqual(d['sections']['suppliers'], DOC['sections']['suppliers'])
        self.assertEqual(d['sections']['clients'], DOC['sections']['clients'])
        self.assertEqual(d['sections']['settings'], DOC['sections']['settings'])
        self.assertEqual({k: v for k, v in d.items() if k != 'sections'}, {k: v for k, v in DOC.items() if k != 'sections'})

    def test_zip_json(self):
        self.assertEqual(self.roundtrip('json'), DOC)
        self.assertEqual(self.roundtrip('zip'), DOC)

    def test_sniff_and_bad(self):
        from data_file import DataFile
        self.assertEqual(DataFile.sniff(b'SQLite format 3\x00' + b'0' * 50), 'sqlite')
        self.assertEqual(DataFile.sniff(b'\xef\xbb\xbf <?xml version="1.0"?><a/>'), 'xml')
        with self.assertRaises(ValueError):
            DataFile().load(b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><kp_data/>')
        with self.assertRaises(ValueError):
            DataFile().load(b'<other/>')
        self.assertEqual(DataFile.digest({'a': 10.0, 'b': None, 'c': {'d': ''}}), DataFile.digest({'a': 10, 'c': {}}))


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand('server', sample=SampleData(items=60, clients=8, kps=3))
        cls.stand.start()
        cls.h = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def get(self, path):
        st, b, hd = self.h.req('GET', '/api/admin/' + path, cookie=self.adm, headers=self.A, raw=True)
        self.assertEqual(st, 200, b[:300])
        return b, hd

    def post(self, path, data):
        hd = dict(self.A, **{'Content-Type': 'application/octet-stream'})
        st, b, _ = self.h.req('POST', '/api/admin/' + path, data, cookie=self.adm, headers=hd)
        try:
            return st, Http.js(b)
        except ValueError:
            return st, b

    def store(self):
        import storage
        return storage.Store(self.stand.db)

    def test_all_formats_load_back(self):
        q = 'sections=catalog,clients,managers,kp,suppliers,settings'
        counts = None
        for fmt in ('json', 'xlsx', 'xml', 'zip'):
            data, hd = self.get('export?%s&fmt=%s' % (q, fmt))
            self.assertIn('КП_выгрузка_', urllib.parse.unquote(str(hd)), fmt)
            st, r = self.post('import/file/preview?name=x.' + fmt, data)
            self.assertEqual(st, 200, (fmt, r))
            rep = {k: (v['new'], v['updated'], v['invalid']) for k, v in r['report'].items()}
            self.assertEqual(rep['catalog'], (0, 60, 0), fmt)
            counts = counts or rep
            self.assertEqual(rep, counts, 'любой формат — то же самое: %s' % fmt)
            self.assertTrue(r['digests'])
        st, r = self.post('import/file?name=x.xlsx', self.get('export?%s&fmt=xlsx' % q)[0])
        self.assertEqual(st, 200, r)
        self.assertEqual(self.stand.request_errors(), [])

    def test_yml_catalog_only(self):
        from data_file import DataFile
        data, _ = self.get('export?sections=catalog,clients,settings&fmt=yml&prices=cost,price')
        d, z, _ = DataFile().load(data)
        self.assertEqual(list(d['sections']), ['catalog'], 'YML — для сайтов: только каталог')
        self.assertFalse(any(k in x for x in d['sections']['catalog'] for k in ('cost', 'margin', 'costDisc')), 'без закупки')
        self.assertNotIn(b'<purchase', data)

    def test_excel_values_and_auto(self):
        from data_file import XlsxData
        s = self.store()
        cid = s.all('SELECT id FROM catalog ORDER BY id LIMIT 1')[0][0]
        x = json.loads(s.catalog_get(cid))
        x.update({'note': '', 'emptyNone': None, 'flo': 0.1 + 0.2, 'feed': 'f1', 'updatedAt': '2026-10-01T00:00:00'})
        s.catalog_put(cid, json.dumps(x, ensure_ascii=False))
        data, _ = self.get('export?sections=catalog&fmt=xlsx')
        doc = XlsxData().load(data)
        y = {r['id']: r for r in doc['sections']['catalog']}[cid]
        self.assertEqual((y['note'], y['emptyNone'], y['flo']), ('', None, 0.1 + 0.2), 'пустые значения и точность — как в базе')
        x.update({'feed': 'f2', 'updatedAt': '2026-10-02T00:00:00'})      # фид обновил запись после выгрузки — не конфликт
        s.catalog_put(cid, json.dumps(x, ensure_ascii=False))
        y['name'] = 'Правка'
        st, r = self.post('import/file/preview?mode=auto', XlsxData().dump(doc))     # auto — у Excel «только изменённое»
        self.assertEqual(st, 200, r)
        self.assertEqual(r['mode'], 'edits')
        c = r['report']['catalog']
        self.assertEqual((c['updated'], c['conflict']), (1, 0), r)
        st, r = self.post('import/file/preview?mode=auto', self.get('export?sections=catalog&fmt=json')[0])
        self.assertEqual(r['mode'], 'all', 'не Excel — «всё как в файле»')

    def test_no_category_filter(self):
        s = self.store()
        cid = s.all('SELECT id FROM catalog ORDER BY id LIMIT 1')[0][0]
        x = json.loads(s.catalog_get(cid))
        x.setdefault('attrs', {})['cat'] = ''
        s.catalog_put(cid, json.dumps(x, ensure_ascii=False))
        r = json.loads(self.get('export/filter?flt=' + urllib.parse.quote(json.dumps({'cat': '__none__'})))[0])
        self.assertGreaterEqual(r['n'], 1, '«Без категории» — позиции без категории')
        r2 = json.loads(self.get('export/filter?flt=' + urllib.parse.quote(json.dumps({'cat': ''})))[0])
        self.assertGreater(r2['n'], r['n'], 'пустое — все категории')

    def test_edits_only(self):
        s = self.store()
        ids = [r[0] for r in s.all('SELECT id FROM catalog ORDER BY id LIMIT 3')]
        data, _ = self.get('export?sections=catalog&fmt=xlsx')
        from data_file import DataFile, XlsxData
        doc = XlsxData().load(data)
        by = {x['id']: x for x in doc['sections']['catalog']}
        by[ids[0]]['name'] = 'Правка в Excel'            # правили в файле
        by[ids[1]]['name'] = 'Правка в Excel 2'          # правили в файле, но и в программе после выгрузки
        by[ids[0]]['price'] = 1                          # цены в «только изменённом» не загружаются
        x = json.loads(s.catalog_get(ids[1]))
        x['spec'] = 'Изменено в программе'
        s.catalog_put(ids[1], json.dumps(x, ensure_ascii=False))
        y = json.loads(s.catalog_get(ids[2]))
        y['price'] = 777                                 # цена изменилась фидом — не конфликт и не затирается
        s.catalog_put(ids[2], json.dumps(y, ensure_ascii=False))
        book = XlsxData().dump(doc)
        self.assertEqual(DataFile.sniff(book), 'xlsx')
        st, r = self.post('import/file/preview?mode=edits', book)
        c = r['report']['catalog']
        self.assertEqual((c['updated'], c['conflict'], c['same']), (1, 1, 58), r)
        self.assertEqual(r['mode'], 'edits')
        self.assertTrue(any('Правка в Excel 2' in t for t in r['conflicts']))
        price0 = json.loads(s.catalog_get(ids[0])).get('price')
        st, r = self.post('import/file?mode=edits', book)
        self.assertEqual(st, 200, r)
        a = json.loads(s.catalog_get(ids[0]))
        self.assertEqual((a['name'], a.get('price')), ('Правка в Excel', price0))
        self.assertEqual(json.loads(s.catalog_get(ids[1]))['spec'], 'Изменено в программе')
        self.assertEqual(json.loads(s.catalog_get(ids[2]))['price'], 777)

    def test_filter(self):
        s = self.store()
        n_priced = sum(1 for (d,) in s.all('SELECT light FROM catalog') if json.loads(d).get('price'))
        flt = urllib.parse.quote(json.dumps({'priced': True}))
        r = json.loads(self.get('export/filter?flt=' + flt)[0])
        self.assertEqual(r['n'], n_priced)
        data, _ = self.get('export?sections=catalog&fmt=json&prices=price&flt=' + flt)
        d = json.loads(data)
        self.assertEqual(len(d['sections']['catalog']), n_priced)
        self.assertIn('cost', d['keep'])
        self.assertFalse(any('cost' in x or 'stock' in x for x in d['sections']['catalog']), 'невыбранные цены не выгружаются')
        self.assertTrue(all(x.get('price') for x in d['sections']['catalog']))
        cat = d['sections']['catalog'][0]['attrs']['cat']
        r = json.loads(self.get('export/filter?flt=' + urllib.parse.quote(json.dumps({'cat': cat, 'q': 'zzzнет'})))[0])
        self.assertEqual(r['n'], 0)
        st, _ = self.post('import/file/preview', b'{}')
        self.assertEqual(st, 400)
        st, b, _ = self.h.req('GET', '/api/admin/export/filter?flt=%7B%22q%22%3A5%7D', cookie=self.adm, headers=self.A)
        self.assertEqual(st, 400)

    def test_settings_and_sqlite(self):
        s = self.store()
        s.kv_set('types', {'types': [{'id': 'comp_screw', 'name': 'Винтовые', 'fields': [{'key': 'flow', 'label': 'Расход', 'num': True}]}]})
        s.kv_set('feeds', {'items': [{'id': 'f1', 'name': 'Фид', 'url': 'https://example.ru/f.xml', 'rules': {'stop': ['б/у'], 'min': 0.5}}]})
        s.kv_set('logistics', {'rates': [[1, 2.5, None, 'текст']], 'note': 'строка\r\nс переводом'})
        s.kv_set('uitexts', {'a.b': 'Текст', 'c': ''})
        for fmt in ('xlsx', 'xml', 'yml', 'zip', 'json'):
            data, hd = self.get('settings-file?fmt=' + fmt)
            st, r = self.post('settings-file/preview', data)
            self.assertEqual(st, 200, (fmt, r))
            self.assertTrue(r['sections'], fmt)
            self.assertTrue(all(x['same'] for x in r['sections']), 'настройки после круга — как сейчас: %s' % fmt)
            st, r = self.post('import/file/preview', data)
            self.assertEqual(r, {'kind': 'settings'}, 'файл настроек в «Копии или правки» — подсказка, куда его загрузить')
        data, _ = self.get('export/sqlite')
        st, r = self.post('import/file/preview', data)
        self.assertEqual(r, {'kind': 'sqlite'})
        st, r = self.post('import/file', data)
        self.assertEqual(st, 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
