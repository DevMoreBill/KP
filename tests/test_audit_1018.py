# -*- coding: utf-8 -*-
"""Исправления аудита 18.10 (проверки ECC): «%0A» в адресе мимо проверки прав, откат незавершённой транзакции,
модерация поверх текущей карточки и без двойного принятия, NaN из файлов, суммы КП не числом, порядок КП с № 1000,
фильтр «Тендер», контакты клиента, документ для Word, пакет обновления с «D:» в пути, CSRF не ASCII."""
import io
import json
import threading
import unittest
import zipfile

from kit import SampleData, Stand, TempStore


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=6, clients=2, kps=2)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None, headers=None):
        h = dict({'Content-Type': 'application/json', 'X-KP-User-Id': 'x'}, **(headers or {}))
        return self.http.req(method, path, json.dumps(body) if body is not None else None, headers=h)

    def test_01_newline_in_path(self):
        for m, p in (('GET', '/api/integrations/export%0A'), ('PUT', '/api/integrations%0A'), ('PUT', '/api/logistics%0A'),
                     ('PUT', '/api/uitexts%0A'), ('PUT', '/api/types%0A'), ('PUT', '/api/kp/abc%0A/state'), ('GET', '/api/ping%00')):
            st, b, _ = self.req(m, p, {} if m == 'PUT' else None)
            self.assertEqual(st, 400, (m, p, b[:200]))
        st, b, _ = self.req('GET', '/api/integrations/export')
        self.assertIn(st, (401, 403), 'без администратора ключи не отдаются')

    def test_02_csrf_not_ascii(self):
        st, _, _ = self.http.req('PUT', '/api/integrations', '{}', cookie=self.adm,
                                 headers={'Content-Type': 'application/json', 'X-CSRF-Token': 'ключ'.encode('utf-8').decode('latin-1')})
        self.assertIn(st, (401, 403))
        self.assertEqual(self.stand.request_errors(), [])

    def test_03_pdf_only_docx(self):
        st, b, _ = self.http.req('POST', '/api/pdf', b'{\\rtf1 x}', headers={'Content-Type': 'application/octet-stream'})
        self.assertEqual(st, 422)
        self.assertIn('Word', b if isinstance(b, str) else b.decode('utf-8'))


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def test_rollback_after_error(self):
        st = self.st
        with self.assertRaises(Exception):
            st.kp_set('2026-999', 'state', '{}', base_rev=5)          # КП нет, а номер правки указан — 409
        self.assertFalse(st.conn().in_transaction, 'транзакция откатилась')
        self.assertEqual(st.all('SELECT COUNT(*) FROM kp')[0][0], 0, 'пустая строка КП не осталась')
        err = []

        def other():
            try:
                st.kv_set('probe', {'a': 1})
            except Exception as e:
                err.append(e)
        t = threading.Thread(target=other)
        t.start()
        t.join(10)
        self.assertEqual(err, [], 'запись из другого потока не ждёт блокировку')

    def test_kp_order_and_tender(self):
        st = self.st
        for kid, tender in (('2026-999', True), ('2026-1000', False), ('2025-1200', False)):
            meta = {'kpId': kid, 'number': kid, 'client': 'К'}
            if tender:
                meta['tender'] = {'number': '123'}
            st.kp_set(kid, 'state', '{}')
            st.kp_set(kid, 'meta', json.dumps(meta, indent=1))          # с пробелами — как пересохраняет сервер
        total, rows = st.kp_page()
        self.assertEqual([json.loads(r)['kpId'] for r in rows], ['2026-1000', '2026-999', '2025-1200'], 'с № 1000 — сверху, по числу')
        total, rows = st.kp_page(kind='tender')
        self.assertEqual((total, [json.loads(r)['kpId'] for r in rows]), (1, ['2026-999']))
        self.assertEqual(st.kp_page(kind='std')[0], 2)

    def test_attrs_not_object(self):
        self.st.catalog_put('a1', json.dumps({'name': 'x', 'attrs': ['a']}))
        self.assertEqual(json.loads(self.st.catalog_get('a1'))['name'], 'x')

    def test_trash_restore_unknown_columns(self):
        st = self.st
        st.catalog_put('a2', json.dumps({'name': 'y'}))
        st.trash_put('catalog', 'a2', 'y', 'тест')
        tid = st.trash_list()[0]['id']
        row = json.loads(st.one('SELECT data FROM trash WHERE id=?', (tid,))[0])
        row['evil) VALUES (1);--'] = 1
        st.write('UPDATE trash SET data=? WHERE id=?', (json.dumps(row), tid))
        st.trash_restore(tid)
        self.assertEqual(json.loads(st.catalog_get('a2'))['name'], 'y')


class ModerationTest(unittest.TestCase):
    def test_approve_keeps_newer_prices(self):
        import catalog_admin
        st = TempStore(self).store
        before = {'name': 'Компрессор', 'price': 100, 'spec': 'старое'}
        st.catalog_put('p1', json.dumps(before))
        eid = st.pending_add('p1', 'edit', json.dumps(before), json.dumps(dict(before, spec='новое')), 'u', 'Менеджер')
        st.catalog_put('p1', json.dumps(dict(before, price=250)))           # фид обновил цену, пока правка ждала
        desk = catalog_admin.ModerationDesk(st, 'admin', lambda *a, **k: None)
        self.assertTrue(desk.review(eid, 'approve')['ok'])
        d = json.loads(st.catalog_get('p1'))
        self.assertEqual((d['spec'], d['price']), ('новое', 250))
        self.assertFalse(desk.review(eid, 'approve')['ok'], 'второе «Принять» ничего не пишет')


class FilesTest(unittest.TestCase):
    def test_nan_in_files(self):
        from data_bundle import StrictJson
        from data_file import DataFile
        from data_file import XlsxData, XmlTree
        import xml.etree.ElementTree as ET
        with self.assertRaises(ValueError):
            StrictJson.loads('{"price": NaN}')
        with self.assertRaises(ValueError):
            json.loads('[Infinity]', parse_constant=DataFile.no_const)
        self.assertIsNone(XmlTree.value(ET.fromstring('<x t="n">NaN</x>')))
        self.assertEqual(XlsxData._number('nan'), 'nan')
        self.assertEqual(XlsxData._number('12.5'), 12.5)

    def test_econ_rub_not_number(self):
        from admin import econ_rub
        self.assertEqual(econ_rub({'sum': '1 000'})[0], 1000)
        self.assertEqual(econ_rub({'econ': {'cur': 'RUB', 'sum': float('nan')}})[0], 0)

    def test_docx_check(self):
        from pdf_convert import DocxCheck

        def docx(extra=None, ct='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'):
            b = io.BytesIO()
            with zipfile.ZipFile(b, 'w') as z:
                z.writestr('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="%s"/></Types>' % ct)
                z.writestr('word/document.xml', '<w:document/>')
                for n, t in (extra or {}).items():
                    z.writestr(n, t)
            return b.getvalue()
        DocxCheck.check(docx({'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Type="http://x/hyperlink" '
                                                                 'Target="https://pnevmoteh.ru" TargetMode="External"/></Relationships>'}))
        for bad in (b'{\\rtf1}', docx({'word/vbaProject.bin': 'x'}),
                    docx(ct='application/vnd.ms-word.document.macroEnabled.main+xml'),
                    docx({'word/_rels/settings.xml.rels': '<Relationships><Relationship Id="r1" Type="http://x/attachedTemplate" '
                                                          'Target="\\\\host\\share\\t.dotm" TargetMode="External"/></Relationships>'})):
            with self.assertRaises(ValueError):
                DocxCheck.check(bad)

    def test_update_drive_in_path(self):
        from app_update import UpdatePackage as P
        for n in ('update/app/D:/x.py', 'update/a/../b', '/update/x', 'update/a\\x'):
            self.assertTrue(P._unsafe(n), n)
        self.assertFalse(P._unsafe('update/app/x.py'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
