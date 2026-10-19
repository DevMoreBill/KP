# -*- coding: utf-8 -*-
"""Справочные документы к КП (app/kp_files.py, маршруты /api/kp/<id>/files): загрузка, список, скачивание с исходным именем,
запрет опасных типов, подмены содержимого, путей и больших файлов, пределы на КП, примечание, письмо клиенту с документами,
удаление только администратором (с CSRF и записью в журнал), КП в корзине, чистка удалённых навсегда, функция выключена,
чужой менеджер при входе по паролю, миграция на базе прежней версии. Стенд с вымышленными данными, рабочая база не используется."""
import io
import json
import os
import sqlite3
import tempfile
import shutil
import unittest
import urllib.parse
import zipfile
from datetime import datetime, timedelta

from kit import Http, SampleData, Schema, SmtpSink, Stand, TempStore
from kp_files import KpFiles
import storage


def pdf(size=2000):
    return b'%PDF-1.4\n' + b'0' * max(0, size - 9)


def zipped(names, extra=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for n in names:
            z.writestr(n, extra or 'x')
    return buf.getvalue()


class ContentTest(unittest.TestCase):
    """Проверка имени и содержимого — без сервера."""

    def bad(self, name, data):
        with self.assertRaises(ValueError, msg=name):
            n, ext = KpFiles.clean_name(name)
            KpFiles.check_content(n, ext, data)

    def good(self, name, data):
        n, ext = KpFiles.clean_name(name)
        KpFiles.check_content(n, ext, data)
        return n

    def test_types(self):
        self.good('Паспорт.pdf', pdf())
        self.good('Опросный лист.DOCX', zipped(['word/document.xml', '[Content_Types].xml']))
        self.good('Расчёт.xlsx', zipped(['xl/workbook.xml']))
        self.good('Старый.doc', KpFiles.OLE + b'0' * 100)
        self.good('Схема.png', b'\x89PNG\r\n\x1a\n' + b'0' * 50)
        self.good('Фото.jpeg', b'\xff\xd8\xff\xe0' + b'0' * 50)
        self.good('План.dwg', b'AC1027' + b'\x00' * 50)
        self.good('План.dxf', b'  0\r\nSECTION\r\n  2\r\nHEADER\r\n')
        self.good('Архив.zip', zipped(['паспорт.pdf', 'папка/схема.png']))
        self.good('Заметки.txt', 'Давление 8 бар'.encode('utf-8'))
        self.good('Юникод.txt', '\ufeffтекст'.encode('utf-16'))

    def test_rejected(self):
        for name in ('setup.exe', 'page.html', 'pic.svg', 'run.js', 'x.bat', 'без расширения', '.pdf', 'a.webp'):
            self.bad(name, pdf())
        self.bad('Паспорт.pdf', b'MZ\x90\x00' + b'0' * 100)                  # программа под видом PDF
        self.bad('Паспорт.docx', zipped(['x.txt']))                              # архив, но не Word
        self.bad('Таблица.xls', b'<html><table></table></html>')               # «Excel» из 1С/сайта — страница HTML
        self.bad('Архив.zip', zipped(['readme.txt', 'setup.exe']))               # программа внутри архива
        self.bad('Архив.zip', zipped(['index.HTML']))
        self.bad('Заметки.txt', b'<!DOCTYPE html><script>alert(1)</script>')
        self.bad('Картинка.png', b'\xff\xd8\xff' + b'0' * 10)

    def test_names(self):
        self.assertEqual(KpFiles.clean_name('../../..\\windows\\evil.pdf')[0], 'evil.pdf')
        self.assertEqual(KpFiles.clean_name('C:\\Users\\a\\Паспорт: «ВК-10».pdf')[0], 'Паспорт «ВК-10».pdf')
        n = KpFiles.clean_name('а' * 400 + '.pdf')[0]
        self.assertTrue(len(n) <= KpFiles.NAME_MAX and n.endswith('.pdf'), n)


class StorageTest(unittest.TestCase):
    """Без сервера: корзина и чистка, миграция на базе прежней версии."""

    def kp(self, st, kid):
        st.kp_set(kid, 'state', json.dumps({'kpId': kid}), 'тест')
        st.kp_set(kid, 'meta', json.dumps({'id': kid, 'number': kid}), 'тест')

    def test_trash_and_purge(self):
        ts = TempStore(self)
        st = ts.store
        self.kp(st, '26-0001')
        kf = KpFiles.of(st)
        rec = kf.add('26-0001', 'Паспорт.pdf', pdf(), 'для склада', 'Тест')
        folder = os.path.join(ts.dir, KpFiles.FOLDER, '26-0001')
        self.assertEqual(len(os.listdir(folder)), 1)
        self.assertRegex(os.listdir(folder)[0], KpFiles.DISK.pattern, 'имя на диске — случайное, не из запроса')
        st.trash_put('kp', '26-0001', 'КП', 'admin')
        self.assertEqual(kf.purge(), 0, 'КП в корзине — документы остаются')
        self.assertEqual([x['id'] for x in kf.list('26-0001')], [rec['id']])
        st.write("DELETE FROM trash WHERE entity_type='kp'")           # корзина очищена (срок вышел)
        self.assertEqual(kf.purge(), 1)
        self.assertEqual(kf.list('26-0001'), [])
        self.assertFalse(os.path.isdir(folder), 'папка КП удалена')

    def test_limits(self):
        ts = TempStore(self)
        st = ts.store
        self.kp(st, '26-0002')
        kf = KpFiles.of(st)
        st.kv_set('settings', {'defaults': {'kp.filesMax': {'on': True, 'v': '2'}, 'kp.fileMB': {'on': True, 'v': '1'}}})
        from defaults import SrvVal
        SrvVal.forget()
        try:
            kf.add('26-0002', 'a.pdf', pdf())
            kf.add('26-0002', 'b.pdf', pdf())
            with self.assertRaisesRegex(ValueError, 'больше 2'):
                kf.add('26-0002', 'c.pdf', pdf())
            with self.assertRaisesRegex(ValueError, 'не больше 1 МБ'):
                kf.add('26-0003', 'big.pdf', pdf(2 * 1024 * 1024))
            with self.assertRaises(ValueError):
                kf.add('../x', 'a.pdf', pdf())
        finally:
            SrvVal.forget()
        self.assertEqual(len(os.listdir(os.path.join(ts.dir, KpFiles.FOLDER, '26-0002'))), 2, 'отклонённые файлы на диск не попали')

    def test_migration_old_base(self):
        d = tempfile.mkdtemp(prefix='kp-test-')
        self.addCleanup(shutil.rmtree, d, True)
        path = os.path.join(d, 'kp.sqlite3')
        st = storage.Store(path)
        Schema.down_to(st, '2027-08-kp-files')                 # база прежней версии: таблиц ещё нет
        self.kp(st, '26-0005')
        st.conn().close()
        c = sqlite3.connect(path)
        self.assertIsNone(c.execute("SELECT name FROM sqlite_master WHERE name='kp_files'").fetchone())
        c.close()
        st2 = storage.Store(path)                              # запуск новой версии — миграция с копией базы
        self.assertIn('2027-08-kp-files', st2.migrations_applied())
        self.assertIn('2027-09-kp-files-author', st2.migrations_applied())
        self.assertIsNotNone(st2.one("SELECT name FROM sqlite_master WHERE name='kp_files'"))
        self.assertTrue(st2.one('SELECT meta FROM kp WHERE id=?', ('26-0005',))[0], 'данные КП на месте')
        self.assertTrue(any('before-2027-08-kp-files' in f for f in os.listdir(os.path.join(d, 'backup'))), 'копия базы перед миграцией')
        KpFiles.of(st2).add('26-0005', 'a.pdf', pdf())
        st2.conn().close()


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sink = SmtpSink()
        cls.sample = SampleData(items=12, clients=4, kps=4)
        cls.stand = Stand(sample=cls.sample)
        cls.stand.kv_set('mail', cls.sink.mail_settings())
        cls.stand.start()
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS
        cls.K1 = cls.sample.kp_ids[cls.M1[0]][0]
        cls.K2 = cls.sample.kp_ids[cls.M2[0]][0]

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()
        cls.sink.stop()

    def R(self, method, path, body=None, who='m1', raw=False, extra=None, csrf=True):
        h = Stand.as_manager(self.M1 if who == 'm1' else self.M2) if who in ('m1', 'm2') else (dict(self.A) if csrf else {}) if who == 'adm' else {}
        h.update(extra or {})
        return self.stand.http.req(method, path, body, headers=h, cookie=self.adm if who == 'adm' else None, raw=raw)

    def up(self, kid, name, data, who='m1', note=''):
        q = '/api/kp/%s/files?name=%s%s' % (kid, urllib.parse.quote(name), '&note=' + urllib.parse.quote(note) if note else '')
        return self.R('POST', q, data, who=who, extra={'Content-Type': 'application/octet-stream'})

    def defaults(self, values):
        st, b, _ = self.R('POST', '/api/admin/defaults', {'values': values}, who='adm')
        self.assertEqual(st, 200, b)

    def test_01_upload_list_download(self):
        st, b, _ = self.up(self.K1, 'Паспорт компрессора «ВК».pdf', pdf(5000), note='для монтажников')
        self.assertEqual(st, 200, b)
        rec = Http.js(b)
        self.assertEqual((rec['name'], rec['size'], rec['note'], rec['ext']), ('Паспорт компрессора «ВК».pdf', 5000, 'для монтажников', 'pdf'))
        lst = Http.js(self.R('GET', '/api/kp/%s/files' % self.K1)[1])
        self.assertEqual([x['id'] for x in lst['items']], [rec['id']])
        self.assertEqual(lst['limits']['fileMB'], 25)
        st, data, hd = self.R('GET', '/api/kp/%s/files/%d' % (self.K1, rec['id']), raw=True)
        self.assertEqual((st, data), (200, pdf(5000)))
        cd = hd.get('Content-Disposition', '')
        self.assertTrue(cd.startswith('attachment;') and "filename*=UTF-8''" + urllib.parse.quote('Паспорт компрессора «ВК».pdf') in cd, cd)
        self.assertEqual(hd.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(hd.get('Content-Type'), 'application/pdf')
        folder = os.path.join(self.stand.data, KpFiles.FOLDER, self.K1)
        self.assertEqual(len(os.listdir(folder)), 1)
        # журнал КП показывает число документов, журнал действий — загрузку
        h = Http.js(self.R('GET', '/api/history?limit=50')[1])
        self.assertEqual(next(x for x in h['items'] if x['id'] == self.K1).get('files'), 1)
        self.assertTrue(any(x['action'] == 'add_kp_file' for x in Http.js(self.R('GET', '/api/admin/audit?action=add_kp_file', who='adm')[1])['items']))
        self.__class__.F1 = rec['id']

    def test_02_rejected(self):
        for name, data in (('setup.exe', b'MZ' + b'0' * 100), ('page.html', b'<html></html>'), ('img.svg', b'<svg/>'),
                           ('Паспорт.pdf', b'MZ' + b'0' * 100), ('Пустой.pdf', b''), ('Архив.zip', zipped(['a.exe']))):
            with self.subTest(name):
                st, b, _ = self.up(self.K1, name, data)
                self.assertEqual(st, 400, b)
                self.assertNotIn('Traceback', b)
        st, b, _ = self.up(self.K1, '../../../kp.sqlite3.pdf', pdf())          # путь в имени — только имя файла
        self.assertEqual(st, 200, b)
        self.assertEqual(Http.js(b)['name'], 'kp.sqlite3.pdf')
        self.assertTrue(os.path.isfile(self.stand.db), 'база на месте')
        for bad in ('/api/kp/..%2F..%2Fx/files', '/api/kp/%s/files/abc' % self.K1, '/api/kp/%s/files/999999' % self.K1):
            with self.subTest(bad):
                self.assertIn(self.R('GET', bad)[0], (400, 403, 404))
        st, b, _ = self.up('26-9999', 'a.pdf', pdf())                     # КП ещё не сохранено
        self.assertEqual(st, 400)
        self.assertIn('сохраните КП', b)

    def test_03_size_and_count_limits(self):
        self.defaults({'kp.fileMB': {'on': True, 'v': '1'}, 'kp.filesMax': {'on': True, 'v': '3'}})
        try:
            st, b, _ = self.up(self.K1, 'big.pdf', pdf(1024 * 1024 + 10))
            self.assertEqual(st, 400)
            self.assertIn('не больше 1 МБ', b)
            n = len(Http.js(self.R('GET', '/api/kp/%s/files' % self.K1)[1])['items'])
            for i in range(3 - n):
                self.assertEqual(self.up(self.K1, 'f%d.pdf' % i, pdf())[0], 200)
            st, b, _ = self.up(self.K1, 'more.pdf', pdf())
            self.assertEqual(st, 400)
            self.assertIn('больше 3', b)
        finally:
            self.defaults({'kp.fileMB': None, 'kp.filesMax': None})

    def test_04_note(self):
        p = '/api/kp/%s/files/%d' % (self.K1, self.F1)
        st, b, _ = self.R('PUT', p, {'note': '  сертификат  соответствия\x00 '})
        self.assertEqual(st, 200, b)
        self.assertEqual(Http.js(b)['note'], 'сертификат соответствия')
        self.assertEqual(self.R('PUT', p, {'note': 5})[0], 400)
        self.assertEqual(self.R('PUT', '/api/kp/%s/files/999999' % self.K1, {'note': 'x'})[0], 404)

    def test_05_mail_with_documents(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('word/document.xml', '<w:document/>')
        st, b, _ = self.R('PUT', '/api/kp/%s/docx?name=%s' % (self.K1, urllib.parse.quote('%s КП.docx' % self.K1)), buf.getvalue(),
                          extra={'Content-Type': 'application/octet-stream'})
        self.assertEqual(st, 200, b)
        f = Http.js(self.R('GET', '/api/kp/%s/mailform' % self.K1)[1])
        self.assertTrue(f['files'] and f['mailMB'] == 18 and f['wordSize'] > 0, f)
        n = len(self.sink.messages)
        st, b, _ = self.R('POST', '/api/kp/%s/send' % self.K1, {'to': 'client@example.com', 'subject': 'КП', 'body': 'Добрый день', 'word': True,
                                                                'files': [self.F1]})
        self.assertEqual(st, 200, b)
        self.assertEqual(len(self.sink.messages), n + 1)
        files = self.sink.message()[2]
        self.assertIn('Паспорт компрессора «ВК».pdf', files)
        self.assertTrue(any(x.endswith('.docx') for x in files), files)
        # вложения больше предела письма — понятный отказ, письмо не уходит
        self.defaults({'kp.mailMB': {'on': True, 'v': '5'}})
        try:
            ids = [Http.js(self.up(self.K2, 'big%d.pdf' % i, pdf(3 * 1024 * 1024), who='m2')[1])['id'] for i in range(2)]
            st, b, _ = self.R('PUT', '/api/kp/%s/docx?name=%s' % (self.K2, urllib.parse.quote('%s КП.docx' % self.K2)), buf.getvalue(),
                              who='m2', extra={'Content-Type': 'application/octet-stream'})
            self.assertEqual(st, 200, b)
            st, b, _ = self.R('POST', '/api/kp/%s/send' % self.K2, {'to': 'client@example.com', 'word': True, 'files': ids}, who='m2')
            self.assertEqual(st, 400)
            self.assertIn('не принять письмо больше 5 МБ', b)
            self.assertEqual(len(self.sink.messages), n + 1)
            self.assertEqual(self.R('POST', '/api/kp/%s/send' % self.K2, {'to': 'client@example.com', 'word': True, 'files': ['x']}, who='m2')[0], 400)
        finally:
            self.defaults({'kp.mailMB': None})

    def test_06_delete_only_admin(self):
        p = '/api/kp/%s/files/%d' % (self.K1, self.F1)
        st, b, _ = self.R('DELETE', p)
        self.assertEqual(st, 403, 'у менеджеров удаления нет')
        dp = '/api/admin/kpfiles/%s/%d/delete' % (self.K1, self.F1)
        self.assertEqual(self.R('POST', dp, {})[0], 401, 'менеджер — не администратор')
        self.assertEqual(self.R('POST', dp, {}, who='adm', csrf=False)[0], 401, 'без CSRF-токена')
        lst = Http.js(self.R('GET', '/api/admin/list/kp', who='adm')[1])
        self.assertTrue(next(x for x in lst['items'] if x['id'] == self.K1)['files'] >= 1, 'в «Сохранённых КП» — число документов')
        n_disk = len(os.listdir(os.path.join(self.stand.data, KpFiles.FOLDER, self.K1)))
        st, b, _ = self.R('POST', dp, {}, who='adm')
        self.assertEqual(st, 200, b)
        self.assertEqual(self.R('GET', p, raw=True)[0], 404)
        self.assertEqual(len(os.listdir(os.path.join(self.stand.data, KpFiles.FOLDER, self.K1))), n_disk - 1, 'файл удалён с диска')
        self.assertEqual(self.R('POST', dp, {}, who='adm')[0], 404)
        log = Http.js(self.R('GET', '/api/admin/audit?action=delete_kp_file', who='adm')[1])['items']
        self.assertTrue(log and log[0]['entityId'] == self.K1 and log[0]['before']['name'] == 'Паспорт компрессора «ВК».pdf', log[:1])

    def test_06b_author_removes_own_in_time(self):
        """Автор удаляет свой файл в первые kp.fileUndoMin минут; чужой — нет; срок вышел или 0 — только администратор."""
        def upload(name):
            st, b, _ = self.up(self.K1, name, pdf(1500))
            self.assertEqual(st, 200, b)
            return Http.js(b)['id']

        def mine(fid, who):
            items = Http.js(self.R('GET', '/api/kp/%s/files' % self.K1, who=who)[1])['items']
            return next(x for x in items if x['id'] == fid)

        fid = upload('Не тот файл.pdf')
        self.assertIn('undoUntil', mine(fid, 'm1'), 'автору — до какого времени можно удалить')
        self.assertNotIn('undoUntil', mine(fid, 'm2'), 'другому менеджеру — нет')
        rm = '/api/kp/%s/files/%d/remove' % (self.K1, fid)
        self.assertEqual(self.R('POST', rm, {}, who='m2')[0], 403, 'чужой файл не удаляется')
        st, b, _ = self.R('POST', rm, {})
        self.assertEqual(st, 200, b)
        self.assertEqual(self.R('POST', rm, {})[0], 404)
        log = Http.js(self.R('GET', '/api/admin/audit?action=delete_kp_file', who='adm')[1])['items']
        self.assertTrue(log[0]['before'].get('author') and log[0]['before']['name'] == 'Не тот файл.pdf', log[:1])

        late = upload('Поздно.pdf')                                  # срок вышел — только администратор
        con = sqlite3.connect(self.stand.db)
        con.execute('UPDATE kp_files SET added=? WHERE id=?', ((datetime.now() - timedelta(minutes=11)).isoformat(timespec='seconds'), late))
        con.commit()
        con.close()
        st, b, _ = self.R('POST', '/api/kp/%s/files/%d/remove' % (self.K1, late), {})
        self.assertEqual(st, 403, b)
        self.assertIn('администратор', b)

        self.defaults({'kp.fileUndoMin': {'on': True, 'v': '0'}})    # 0 — удаляет только администратор
        try:
            off = upload('Без отмены.pdf')
            self.assertNotIn('undoUntil', mine(off, 'm1'))
            self.assertEqual(self.R('POST', '/api/kp/%s/files/%d/remove' % (self.K1, off), {})[0], 403)
        finally:
            self.defaults({'kp.fileUndoMin': None})

    def test_07_kp_in_trash(self):
        kid = self.sample.kp_ids[self.M2[0]][1]
        rec = Http.js(self.up(kid, 'Сертификат.pdf', pdf(), who='m2')[1])
        self.assertEqual(self.R('POST', '/api/admin/delete', {'type': 'kp', 'ids': [kid]}, who='adm')[0], 200)
        self.assertIn(self.R('GET', '/api/kp/%s/files' % kid, who='m2')[0], (403, 404), 'КП в корзине — менеджеру документов не видно')
        self.assertIn(self.up(kid, 'ещё.pdf', pdf(), who='m2')[0], (400, 403))
        self.assertEqual(len(Http.js(self.R('GET', '/api/kp/%s/files' % kid, who='adm')[1])['items']), 1, 'администратору видно')
        tid = next(x['id'] for x in Http.js(self.R('GET', '/api/admin/trash', who='adm')[1])['items'] if x['entityId'] == kid)
        self.assertEqual(self.R('POST', '/api/admin/trash/%d/restore' % tid, {}, who='adm')[0], 200)
        st, data, _ = self.R('GET', '/api/kp/%s/files/%d' % (kid, rec['id']), who='m2', raw=True)
        self.assertEqual((st, data), (200, pdf()), 'КП восстановлено вместе с документами')

    def test_08_feature_off(self):
        st, b, _ = self.R('POST', '/api/admin/features', {'values': {'kpFiles': {'on': False}}}, who='adm')
        self.assertEqual(st, 200, b)
        try:
            self.assertEqual(self.R('GET', '/api/kp/%s/files' % self.K1)[0], 403)
            self.assertEqual(self.up(self.K1, 'a.pdf', pdf())[0], 403)
            self.assertEqual(Http.js(self.R('GET', '/api/kp/%s/mailform' % self.K1)[1])['files'], [])
        finally:
            self.R('POST', '/api/admin/features', {'values': {'kpFiles': None}}, who='adm')
        self.assertEqual(self.R('GET', '/api/kp/%s/files' % self.K1)[0], 200)

    def test_09_other_manager_with_login(self):
        rec = Http.js(self.up(self.K1, 'Схема.png', b'\x89PNG\r\n\x1a\n' + b'0' * 64)[1])
        pw = {'m1': 'pass-m1-52', 'm2': 'pass-m2-52'}
        for mgr, lg in ((self.M1, 'm1'), (self.M2, 'm2')):
            st, b, _ = self.R('POST', '/api/admin/access/' + mgr[0], {'login': lg, 'password': pw[lg],
                                                                       'perms': {'kpOthers': False, 'dealView': True, 'catEdit': False, 'catAdd': False}}, who='adm')
            self.assertEqual(st, 200, b)
        self.assertEqual(self.R('POST', '/api/admin/access', {'enabled': True}, who='adm')[0], 200)
        try:
            http = self.stand.http
            u1 = Http.cookie(http.req('POST', '/api/auth/login', {'login': 'm1', 'password': pw['m1']})[2])
            u2 = Http.cookie(http.req('POST', '/api/auth/login', {'login': 'm2', 'password': pw['m2']})[2])
            p = '/api/kp/%s/files' % self.K1
            self.assertEqual(http.req('GET', p)[0], 401, 'без входа — ничего')
            self.assertEqual(http.req('GET', p, cookie=u1)[0], 200, 'автор КП')
            self.assertEqual(http.req('GET', '%s/%d' % (p, rec['id']), cookie=u1)[0], 200)
            for method, path, body in (('GET', p, None), ('GET', '%s/%d' % (p, rec['id']), None), ('POST', p + '?name=x.pdf', pdf()),
                                       ('PUT', '%s/%d' % (p, rec['id']), {'note': 'чужое'})):
                with self.subTest(method + ' ' + path):
                    self.assertEqual(http.req(method, path, body, cookie=u2)[0], 403, 'чужое КП без права «КП других менеджеров»')
        finally:
            self.R('POST', '/api/admin/access', {'enabled': False}, who='adm')

    def test_99_no_server_errors(self):
        self.assertEqual(self.stand.request_errors(), [])


if __name__ == '__main__':
    unittest.main()
