# -*- coding: utf-8 -*-
"""Исправления аудита 18.10 (проверки ECC): «%0A» в адресе мимо проверки прав, откат незавершённой транзакции,
модерация поверх текущей карточки и без двойного принятия, NaN из файлов, суммы КП не числом, порядок КП с № 1000,
фильтр «Тендер», контакты клиента, документ для Word, пакет обновления с «D:» в пути, CSRF не ASCII; 3.103: справочник
поставщиков (администратор и право «Без модерации», границы полей), фид позиции столбцом, восстановление базы без отметки
миграций и с другим размером страницы, предел писем в час."""
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


    def test_04_suppliers_admin_only(self):
        st, b, _ = self.req('PUT', '/api/suppliers/s-test', {'name': 'Поставщик'})
        self.assertEqual(st, 403, 'справочник поставщиков без права «Без модерации» не меняется')
        h = dict({'Content-Type': 'application/json'}, **self.A)
        st, b, _ = self.http.req('PUT', '/api/suppliers/s-test', json.dumps({'name': 'Поставщик', 'note': 'x'}), cookie=self.adm, headers=h)
        self.assertEqual(st, 200, b[:200])
        st, b, _ = self.http.req('PUT', '/api/suppliers/s-test', json.dumps({'name': 'П', 'bad key': 1}), cookie=self.adm, headers=h)
        self.assertEqual(st, 400)


class StoreTest(unittest.TestCase):
    def test_feed_id_and_limits(self):
        import feeds
        from storage import DocLimits
        st = self.st
        st.catalog_put('f1', json.dumps({'name': 'A', 'feed': {'id': 'feed_1', 'oid': '1'}}))
        st.catalog_put('f2', json.dumps({'name': 'B', 'feed': {'id': 'feed%1', 'oid': '2'}}))
        self.assertEqual([d['id'] for d in feeds._feed_docs(st, 'feed_1')], ['f1'], '«_» и «%» в коде фида — не шаблон')
        self.assertEqual(feeds._feed_counts(st), {'feed_1': 1, 'feed%1': 1})
        DocLimits.check({'name': 'x', 'warehouses': [{'addr': 'a'}]}, 'Карточка')
        for bad in ({'a b': 1}, {'x': 'я' * 10001}, {'x': [0] * 2001}, {'x': {'y': {'z': {'a': {'b': {'c': {'d': 1}}}}}}}):
            with self.assertRaises(ValueError):
                DocLimits.check(bad, 'Карточка')

    def test_restore_old_base(self):
        import os
        import sqlite3
        from kit import TempStore as T
        st = self.st
        other = T(self).store
        other.catalog_put('b', json.dumps({'name': 'Из копии', 'feed': {'id': 'fx'}}))
        src = os.path.join(os.path.dirname(st.path), 'src.sqlite3')
        s = sqlite3.connect(src)
        other.conn().backup(s)
        s.execute("DELETE FROM kv WHERE key='schema'")          # база без отметки миграций (внешний инструмент)
        s.commit()
        s.execute('PRAGMA journal_mode=DELETE')
        s.execute('PRAGMA page_size=1024')                      # другой размер страницы
        s.execute('VACUUM')
        s.close()
        st.restore_sqlite(src)
        self.assertEqual(st.all('SELECT id, feed_id FROM catalog'), [('b', 'fx')])
        self.assertFalse([x for x in os.listdir(os.path.dirname(st.path)) if x.startswith('restore-')], 'временная копия убрана')

    def test_mail_rate(self):
        from kp_track import MailRate
        MailRate.SENT.clear()
        import defaults
        lim = defaults.SrvVal.get(self.st, 'kp.mailPerHour')
        for _ in range(lim):
            MailRate.take(self.st, 'u:t')
        with self.assertRaisesRegex(ValueError, 'за час'):
            MailRate.take(self.st, 'u:t')
        MailRate.take(self.st, 'u:other')
        MailRate.SENT.clear()

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

    def test_reject_does_not_override_approving(self):
        """DB-016: «Отклонить», пришедшее одновременно с «Принять», не перекрывает принятую правку."""
        import catalog_admin
        st = TempStore(self).store
        before = {'name': 'Компрессор', 'spec': 'старое'}
        st.catalog_put('p1', json.dumps(before))
        eid = st.pending_add('p1', 'edit', json.dumps(before), json.dumps(dict(before, spec='новое')), 'u', 'Менеджер')
        stale = st.pending_get(eid)
        self.assertTrue(st.pending_claim(eid))  # «Принять» уже заняло правку
        st.pending_get = lambda _eid: stale       # «Отклонить» прочитал правку до этого
        desk = catalog_admin.ModerationDesk(st, 'admin', lambda *a, **k: None)
        self.assertFalse(desk.review(eid, 'reject', 'нет')['ok'])
        self.assertEqual(st.one('SELECT status FROM pending_edits WHERE id=?', (eid,))[0], 'approving')


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
        DocxCheck.check(docx({'word/header1.xml': '<w:hdr><w:r><w:instrText> PAGE </w:instrText></w:r><w:t>LINK</w:t></w:hdr>'}))
        DocxCheck.check(docx({'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Type="http://x/hyperlink" '
                                                                 'Target="https://pnevmoteh.ru" TargetMode="External"/></Relationships>'}))
        for bad in (b'{\\rtf1}', docx({'word/vbaProject.bin': 'x'}),
                    docx(ct='application/vnd.ms-word.document.macroEnabled.main+xml'),
                    docx({'word/_rels/settings.xml.rels': '<Relationships><Relationship Id="r1" Type="http://x/attachedTemplate" '
                                                          'Target="\\\\host\\share\\t.dotm" TargetMode="External"/></Relationships>'}),
                    # BE-006: внешняя картинка и поле, загружающее файл (код поля разбит на части)
                    docx({'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r2" Type="http://x/image" '
                                                          'Target="\\\\10.0.0.5\\s\\a.png" TargetMode="External"/></Relationships>'}),
                    docx({'word/header1.xml': '<w:hdr><w:r><w:instrText> INCLUDE</w:instrText></w:r>'
                                              '<w:r><w:instrText>PICTURE "http://evil/x.png"</w:instrText></w:r></w:hdr>'})):
            with self.assertRaises(ValueError):
                DocxCheck.check(bad)

    def test_update_drive_in_path(self):
        from app_update import UpdatePackage as P
        for n in ('update/app/D:/x.py', 'update/a/../b', '/update/x', 'update/a\\x'):
            self.assertTrue(P._unsafe(n), n)
        self.assertFalse(P._unsafe('update/app/x.py'))


class EmailRegexTest(unittest.TestCase):
    def test_long_text_fast(self):
        """BE-007: длинная строка без «@» (вставленная карточка, письмо) разбирается быстро, адреса находятся как раньше."""
        import time
        from company_card import CompanyCard
        from deal_intake import IntakeRules
        for pattern in (CompanyCard.EMAIL, IntakeRules.EMAIL):
            start = time.monotonic()
            pattern.findall('a' * 100000)
            self.assertLess(time.monotonic() - start, 1)
            self.assertEqual(pattern.findall('Пишите: ivan.petrov+kp@mail.ru, (sales@pnevmo-tex.ru).'),
                             ['ivan.petrov+kp@mail.ru', 'sales@pnevmo-tex.ru'])


class UnpackLimitTest(unittest.TestCase):
    def test_no_room(self):
        """DB-009: архив базы, который не помещается на диск с запасом, не распаковывается до конца."""
        import os
        import shutil
        import tempfile
        from storage import DbZip
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        box = io.BytesIO()
        with zipfile.ZipFile(box, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('kp.sqlite3', b'\0' * (3 << 20))
        dst = os.path.join(folder, 'x.sqlite3')
        DbZip.unpack(io.BytesIO(box.getvalue()), dst)
        self.assertEqual(os.path.getsize(dst), 3 << 20)
        saved = DbZip.RESERVE
        DbZip.RESERVE = shutil.disk_usage(folder).free - (1 << 20)
        try:
            with self.assertRaises(ValueError):
                DbZip.unpack(io.BytesIO(box.getvalue()), dst)
        finally:
            DbZip.RESERVE = saved


class DealNumberTest(unittest.TestCase):
    def test_taken_number_skipped(self):
        """DB-010: счётчик сделок отстал (копия базы) — новая сделка не перезаписывает существующую."""
        from crm import DealBook
        st = TempStore(self).store
        book = DealBook(st)
        first = book.create({'title': 'Первая', 'client': 'ООО «А»'}, 'm1', 'М', 'тест')
        st.kv_set('crm.seq', 0)
        second = book.create({'title': 'Вторая', 'client': 'ООО «Б»'}, 'm1', 'М', 'тест')
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(book.get(first['id'])['title'], 'Первая')


class IdentTest(unittest.TestCase):
    def test_odd_table_names(self):
        """BE-020: таблица с кавычкой в имени (из загруженной базы) не ломает обслуживание и счёт записей."""
        import maintenance
        st = TempStore(self).store
        conn = st.conn()
        conn.execute('CREATE TABLE "we""ird" ("co""l" TEXT)')
        conn.execute('INSERT INTO "we""ird" VALUES (?)', ('/img/a/b.png',))
        conn.commit()
        self.assertIn('a/b.png', maintenance._referenced(st))
        self.assertEqual(st.table_counts()['we"ird'], 1)


class TrackRaceTest(unittest.TestCase):
    def test_status_and_mail_both_kept(self):
        """DB-005: смена хода сделки и отметка письма одновременно — обе записи остаются."""
        from kp_track import DealTrack
        st = TempStore(self).store
        st.kp_set('k1', 'state', json.dumps({'number': 'k1'}), 'тест')
        read, threads = st.kp_track_get, []

        def slow_get(kid):
            value = read(kid)
            if not threads:
                threads.append(threading.Thread(target=DealTrack(st).mark_sent, args=('k1', ['a@b.ru'], [], 'почта')))
                threads[0].start()
                threads[0].join(0.3)
            return value

        st.kp_track_get = slow_get
        DealTrack(st).update('k1', {'followUp': {'date': '2026-11-01', 'note': 'перезвонить'}}, 'менеджер')
        threads[0].join(5)
        track = read('k1')
        self.assertTrue(track.get('sent'), 'письмо отмечено')
        self.assertEqual((track.get('followUp') or {}).get('date'), '2026-11-01', 'напоминание осталось')


if __name__ == '__main__':
    unittest.main(verbosity=2)
