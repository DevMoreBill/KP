# -*- coding: utf-8 -*-
"""Безопасность сервера отдела на стенде с входом менеджеров по паролю: без входа — ничего, чужие КП, права менеджера
и администратора, CSRF и чужие сайты, обход путей, опасные имена файлов и архивы обновления, SQL-инъекции, неверный ввод,
заголовки ответа, действия «только на компьютере-сервере», перебор паролей.

Сотрудник «по сети» — запрос с собственного адреса компьютера (не 127.x); если такого адреса нет, набор пропускается."""
import io
import json
import os
import time
import unittest
import urllib.parse
import zipfile

from kit import Http, Net, SampleData, Stand


class SecurityTest(unittest.TestCase):
    PW = {'m1': 'pass-m1-52', 'm2': 'pass-m2-52'}

    @classmethod
    def setUpClass(cls):
        cls.rem = Net.remote_ip()
        if not cls.rem:
            raise unittest.SkipTest('нет сетевого адреса, кроме 127.0.0.1: запросы «по сети» не проверить')
        cls.sample = SampleData()
        cls.stand = Stand(sample=cls.sample).start()
        cls.net = Http(cls.stand.port, host=cls.rem)          # сотрудник по сети
        cls.loc = cls.stand.http                               # компьютер-сервер
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS
        for mgr, lg, perms in ((cls.M1, 'm1', {'kpOthers': False, 'dealView': True, 'catEdit': False, 'catAdd': False}),
                               (cls.M2, 'm2', {'kpOthers': False, 'dealView': False, 'catEdit': False, 'catAdd': False})):
            st, b, _ = cls.loc.req('POST', '/api/admin/access/' + mgr[0], {'login': lg, 'password': cls.PW[lg], 'perms': perms}, cookie=cls.adm, headers=cls.A)
            assert st == 200, (st, b)
        st, b, _ = cls.loc.req('POST', '/api/admin/access', {'enabled': True}, cookie=cls.adm, headers=cls.A)
        assert st == 200, (st, b)
        st, b, cls.login_headers = cls.net.req('POST', '/api/auth/login', {'login': 'm1', 'password': cls.PW['m1']})
        assert st == 200, (st, b)
        cls.U1 = Http.cookie(cls.login_headers)
        cls.U2 = Http.cookie(cls.net.req('POST', '/api/auth/login', {'login': 'm2', 'password': cls.PW['m2']})[2])
        cls.K1 = cls.sample.kp_ids[cls.M1[0]]
        cls.K2 = cls.sample.kp_ids[cls.M2[0]]

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None, cookie=None, headers=None, raw=False, local=False):
        return (self.loc if local else self.net).req(method, path, body, cookie=cookie, headers=headers, raw=raw)

    def admin_req(self, method, path, body=None, csrf=True, headers=None):
        h = dict(self.A) if csrf else {}
        h.update(headers or {})
        return self.loc.req(method, path, body, cookie=self.adm, headers=h)

    # ---------------------------------------------------------------- без входа
    def test_01_nothing_without_login(self):
        self.assertTrue(self.U1.startswith('kp_user='))
        sc = self.login_headers.get('Set-Cookie', '')
        self.assertTrue('HttpOnly' in sc and 'SameSite=Strict' in sc, sc)
        k2 = self.K2[0]
        for p in ['/api/catalog', '/api/history', '/api/history?limit=5', '/api/clients', '/api/managers', '/api/kp/%s/state' % k2, '/api/integrations',
                  '/api/suppliers', '/api/customs', '/api/defaults', '/api/lists', '/api/types', '/api/templates', '/api/catalog/x', '/img/logos/x.png',
                  '/api/kp/%s/docx' % k2, '/api/logistics', '/api/uitexts', '/api/calendar', '/api/catalog/sync?since=0', '/api/catalog/search?q=x',
                  '/api/me/prefs', '/api/kp/%s/versions' % k2, '/api/clientcard?inn=1', '/api/presets', '/api/drafts', '/api/features', '/api/reminders',
                  '/api/report', '/api/mail/status']:
            with self.subTest(p):
                self.assertEqual(self.req('GET', p)[0], 401)
        self.assertIn(self.req('GET', '/api/cbr')[0], (401, 403))
        for method, p, body in [('POST', '/api/kp/new', {}), ('PUT', '/api/kp/zz1/state', {'a': 1}), ('POST', '/api/img', b'\x89PNG\r\n\x1a\n0000'),
                                ('POST', '/api/pagetext', {'url': 'http://example.com'}), ('POST', '/api/ai/fill', {'prompt': 'x'}),
                                ('POST', '/api/tz/parse?name=tz.txt', b'\xd0\xa2\xd0\x97 ' * 20),
                                ('PUT', '/api/clients/x1', {'name': 'x'}), ('PUT', '/api/me/prefs', {})]:
            with self.subTest(p):
                self.assertEqual(self.req(method, p, body)[0], 401)
        self.assertEqual(self.req('GET', '/')[0], 200, 'страница входа открывается')
        self.assertEqual(self.req('GET', '/api/ping')[0], 200, 'проверка связи — без входа')

    # ---------------------------------------------------------------- менеджер: только свои КП, без прав администратора
    def test_02_foreign_kp(self):
        k2 = self.K2[0]
        for p in ['state', 'meta', 'docx', 'pdf', 'versions', 'versions/1', 'rev', 'mailform']:
            with self.subTest(p):
                self.assertEqual(self.req('GET', '/api/kp/%s/%s' % (k2, p), cookie=self.U1)[0], 403)
        for method, p, body in [('PUT', 'state', {'client': 'взлом'}), ('PUT', 'track', {'status': 'won'}), ('POST', 'send', {'to': 'x@example.com'})]:
            with self.subTest(p):
                self.assertEqual(self.req(method, '/api/kp/%s/%s' % (k2, p), body, cookie=self.U1)[0], 403)
        st, b, _ = self.req('GET', '/api/history?limit=500', cookie=self.U1)
        items = json.loads(b)['items']
        self.assertTrue(items and all(x.get('authorId') == self.M1[0] for x in items), 'журнал — только свои КП')
        rows = json.loads(self.req('GET', '/api/history', cookie=self.U1)[1])
        self.assertTrue(all(x.get('authorId') == self.M1[0] for x in rows))
        rows = json.loads(self.req('GET', '/api/report?from=2000-01-01&to=2100-01-01', cookie=self.U1)[1])['items']
        self.assertTrue(rows and all(x.get('authorId') == self.M1[0] for x in rows), 'отчёт — только свои КП')
        self.assertEqual(self.req('PUT', '/api/kp/%s/track' % self.K1[0], {'status': 'work', 'followUp': {'date': '2026-01-01', 'note': '<img src=x>'}},
                                  cookie=self.U1)[0], 200)
        items = json.loads(self.req('GET', '/api/reminders', cookie=self.U1)[1])['items']
        self.assertTrue(all(x['id'] in self.K1 for x in items), items)
        st, b, _ = self.req('GET', '/api/kp/%s/state' % self.K2[0], cookie=self.U2)
        self.assertEqual(st, 200)
        self.assertNotIn('deal', json.loads(b), 'без права «экономика сделки» расчёт не отдаётся')

    def test_03_manager_is_not_admin(self):
        for method, p, body in [('GET', '/api/integrations/export', None), ('PUT', '/api/integrations', {'dadataKey': 'x'}), ('PUT', '/api/uitexts', {'a': 'b'}),
                                ('PUT', '/api/logistics', {}), ('POST', '/api/logistics/refresh', {}), ('GET', '/api/admin/users', None),
                                ('POST', '/api/admin/lists', {'values': {}}), ('PUT', '/api/templates/pnevmotekh/file?name=skeleton.js', 'alert(1)'),
                                ('POST', '/api/templates/pnevmotekh/delete', {}), ('POST', '/api/templates/pnevmotekh/reset', {}),
                                ('POST', '/api/admin/access/' + self.M1[0], {'perms': {'kpOthers': True}}), ('DELETE', '/api/kp/%s' % self.K1[0], None),
                                ('PUT', '/api/catalog/zzsec1', {'id': 'zzsec1', 'name': 'x'}), ('GET', '/api/admin/mail', None),
                                ('PUT', '/api/managers/' + self.M2[0], {'name': self.M2[1], 'phone': '+7 000'})]:
            with self.subTest('%s %s' % (method, p)):
                self.assertIn(self.req(method, p, body, cookie=self.U1)[0], (401, 403))
        keys = json.loads(self.req('GET', '/api/integrations', cookie=self.U1)[1] or '{}')
        self.assertFalse(any(isinstance(v, str) and len(v) > 12 and '•' not in v and '*' not in v for v in keys.values()), 'ключи API целиком не выдаются')

    def test_04_admin_api_closed(self):
        pk = io.BytesIO()
        with zipfile.ZipFile(pk, 'w') as z:
            z.writestr('update/version.json', '{"version": "9.9.9"}')
            z.writestr('update/app/kp_server.py', 'print(1)')
        calls = [('GET', '/api/admin/history', None), ('GET', '/api/admin/history/1', None), ('POST', '/api/admin/history/1/rollback', {}),
                 ('GET', '/api/admin/export?sections=settings', None), ('GET', '/api/admin/export/sqlite', None), ('GET', '/api/admin/export/cats', None),
                 ('POST', '/api/admin/import/file/preview', b'{}'), ('POST', '/api/admin/import/file', b'{}'), ('POST', '/api/admin/import/sqlite', b'SQLite format 3\x00'),
                 ('GET', '/api/admin/connections', None), ('POST', '/api/admin/connections', {}), ('GET', '/api/admin/maint/mirror', None),
                 ('POST', '/api/admin/maint/mirror', {'on': True, 'path': '/tmp'}), ('POST', '/api/admin/maint/mirror/check', {'path': '/tmp'}),
                 ('POST', '/api/admin/maint/mirror/run', {}), ('GET', '/api/admin/update', None), ('POST', '/api/admin/update', {'repo': 'evil/x'}),
                 ('POST', '/api/admin/update/check', {}), ('POST', '/api/admin/update/upload?force=1', pk.getvalue()), ('POST', '/api/admin/update/download', {}),
                 ('POST', '/api/admin/update/rollback', {}), ('POST', '/api/admin/update/remove', {}), ('POST', '/api/admin/restart', {}),
                 ('GET', '/api/admin/system', None), ('GET', '/api/admin/attention', None), ('POST', '/api/admin/folder', {'which': 'data'}),
                 ('GET', '/api/admin/access', None), ('POST', '/api/admin/features', {'values': {}}), ('GET', '/api/admin/stats', None),
                 ('GET', '/api/admin/log', None), ('GET', '/api/admin/log/download', None), ('GET', '/api/admin/alerts', None),
                 ('POST', '/api/admin/alerts', {'on': True, 'to': 'evil@example.com'}), ('POST', '/api/admin/alerts/test', {})]
        octet = {'Content-Type': 'application/octet-stream'}
        for method, p, body in calls:
            with self.subTest('m1 %s %s' % (method, p)):
                self.assertEqual(self.req(method, p, body, cookie=self.U1, headers=octet if isinstance(body, bytes) else None)[0], 401)
        for method, p, body in [x for x in calls if x[0] == 'POST']:
            with self.subTest('без CSRF %s %s' % (method, p)):
                self.assertEqual(self.admin_req(method, p, body, csrf=False, headers=octet if isinstance(body, bytes) else None)[0], 401)

    def test_05_dangerous_files(self):
        kn = 'zzsec%d' % int(time.time())
        self.req('PUT', '/api/kp/%s/meta' % kn, {'number': kn, 'authorId': self.M1[0]}, cookie=self.U1)
        for nm in ['evil.bat', 'evil.exe', 'evil.hta', 'CON.docx', 'evil.docx.lnk']:
            with self.subTest(nm):
                st, b, _ = self.req('PUT', '/api/kp/%s/docx?name=%s' % (kn, urllib.parse.quote(nm)), b'MZ\x90\x00 not a docx', cookie=self.U1)
                path = ((Http.js(b) or {}).get('path') if st == 200 else '') or ''
                self.assertTrue(st >= 400 or path.lower().endswith('.docx'), (st, path))
        self.assertGreaterEqual(self.req('PUT', '/api/kp/%s/docx?name=ok.docx' % kn, b'not a zip at all', cookie=self.U1)[0], 400)
        for name, files in [('../ в пути', {'update/../../evil.py': 'x'}), ('абсолютный путь', {'/etc/evil': 'x'}), ('диск Windows', {'C:/evil.py': 'x'}),
                            ('неверная версия', {})]:
            with self.subTest(name):
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, 'w') as z:
                    z.writestr('update/version.json', '{"version": "%s"}' % ('9.9; rm' if name == 'неверная версия' else '9.9.9'))
                    z.writestr('update/app/kp_server.py', 'x')
                    for n, t in files.items():
                        z.writestr(n, t)
                st, b, _ = self.admin_req('POST', '/api/admin/update/upload', buf.getvalue(), headers={'Content-Type': 'application/zip'})
                self.assertEqual(st, 422, b[:200])
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.stand.dir), 'evil.py')))
        self.assertIn(self.admin_req('POST', '/api/admin/update', {'repo': 'https://evil.example/x'})[0], (400, 422), 'репозиторий — только «владелец/имя»')
        st, b, _ = self.admin_req('POST', '/api/admin/maint/mirror/check', {'path': self.stand.data + '/../data'})
        self.assertEqual(st, 400, 'вторая папка: обход через ../ к папке данных')

    def test_06_path_traversal(self):
        for p in ['/web/../settings.json', '/web/..%2f..%2fapp%2fsettings.json', '/web/%2e%2e/%2e%2e/app/admin.py', '/web/....//....//settings.json',
                  '/img/../../data/kp.sqlite3', '/img/..%2f..%2fkp.sqlite3', '/img/..%5c..%5ckp.sqlite3', '/img/%2e%2e%2f%2e%2e%2fsettings.json',
                  '/tpl/pnevmotekh/..%2f..%2fapp%2fsettings.json', '/tpl/pnevmotekh/%2e%2e%5c%2e%2e%5csettings.json', '/tpl/..%2f/settings.json',
                  '/web/js/../../settings.json', '//etc/passwd', '/img//etc/passwd', '/img/C:/Windows/win.ini', '/api/kp/..%2f..%2fx/state']:
            with self.subTest(p):
                st, b, _ = self.req('GET', p, cookie=self.U1)
                self.assertFalse(any(s in b for s in ('"mode"', 'SQLite format', 'root:x:', 'import ', '[fonts]')), (st, b[:100]))
                self.assertLess(st, 500)

    def test_07_foreign_sites_and_headers(self):
        self.assertEqual(self.req('PUT', '/api/kp/%s/state' % self.K1[0], {'x': 1}, cookie=self.U1, headers={'Origin': 'http://evil.example'})[0], 403)
        self.assertEqual(self.req('POST', '/api/auth/login', {'login': 'm1', 'password': self.PW['m1']}, headers={'Origin': 'null'})[0], 403)
        self.assertEqual(self.req('GET', '/api/geo/suggest?q=x', cookie=self.U1)[0], 403, 'платные запросы — только из программы')
        st, b, hd = self.req('GET', '/api/history', cookie=self.U1, headers={'Origin': 'http://evil.example'})
        self.assertNotIn('Access-Control-Allow-Origin', hd)
        st, b, hd = self.req('GET', '/', cookie=self.U1)
        for k in ('Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy'):
            self.assertIn(k, hd)
        self.assertNotIn('Python', hd.get('Server', ''))

    def test_08_injection_and_bad_input(self):
        for p in ['/api/history?limit=5&q=%27%20OR%201%3D1--', '/api/clients?q=%27%29%20OR%201%3D1--', '/api/history?limit=5&author=%27%20OR%20%271%27%3D%271']:
            with self.subTest(p):
                st, b, _ = self.req('GET', p, cookie=self.U1)
                self.assertEqual(st, 200)
                self.assertNotIn(self.M2[0], b, 'без чужих данных')
        for method, p, body, hdr in [('PUT', '/api/kp/%s/state' % self.K1[0], '{bad json', {}), ('PUT', '/api/kp/%s/state' % self.K1[0], '[1,2]', {}),
                                     ('POST', '/api/ai/fill', 'x' * 10, {}), ('PUT', '/api/clients/ab', '"str"', {}), ('POST', '/api/kp/new', b'', {'Content-Length': '-5'}),
                                     ('GET', '/api/catalog/%00', None, {}), ('PUT', '/api/managers/' + self.M1[0], '{"name": 5}', {}),
                                     ('GET', '/api/admin/history?limit=99999999999999999999', None, {}), ('POST', '/api/clientcard/note', '[1]', {})]:
            with self.subTest('%s %s' % (method, p)):
                try:
                    st = self.req(method, p, body, cookie=self.U1, headers=hdr)[0]
                except OSError as e:
                    self.fail('соединение оборвалось: %s' % e)
                self.assertLess(st, 500)
        self.assertEqual(self.admin_req('POST', '/api/admin/history/999999/rollback', {})[0], 400)

    def test_09_drafts_presets_card(self):
        self.assertEqual(self.req('PUT', '/api/drafts/dsec1', {'state': {'client': 'Секрет m1', 'items': []}}, cookie=self.U1)[0], 200)
        st, b, _ = self.req('GET', '/api/drafts', cookie=self.U2)
        self.assertTrue(st == 200 and 'Секрет' not in b)
        self.assertEqual(self.req('GET', '/api/drafts/dsec1', cookie=self.U2)[0], 403)
        self.assertEqual(self.req('GET', '/api/drafts/dsec1', cookie=self.U2, headers={'X-KP-User-Id': self.M1[0]})[0], 403, 'подпись запроса не заменяет вход')
        self.assertEqual(self.req('PUT', '/api/drafts/dsec1', {'state': {}}, cookie=self.U2)[0], 403)
        self.assertEqual(self.req('POST', '/api/drafts/dsec1/delete', {}, cookie=self.U2)[0], 403)
        self.assertIn(self.req('GET', '/api/drafts/..%2Fkp', cookie=self.U1)[0], (400, 404))
        self.assertEqual(self.req('PUT', '/api/presets/psec1', {'state': {'items': [{}]}, 'title': '<img src=x onerror=alert(1)>'}, cookie=self.U1)[0], 200)
        self.assertEqual(self.req('POST', '/api/presets/psec1/delete', {}, cookie=self.U2)[0], 403)
        self.assertEqual(self.req('PUT', '/api/presets/psec1', {'state': {}, 'title': 'x'}, cookie=self.U2)[0], 403)
        self.assertEqual(self.admin_req('POST', '/api/presets/psec1/delete', {})[0], 200)
        inn = json.loads(self.loc.req('GET', '/api/kp/%s/meta' % self.K2[0], cookie=self.adm)[1])['clientInn']
        d = json.loads(self.req('GET', '/api/clientcard?inn=' + inn, cookie=self.U1)[1])
        self.assertTrue(all(x.get('authorId') == self.M1[0] for x in d.get('kps', [])), 'в карточке клиента — без КП другого менеджера')
        st, b, _ = self.req('GET', '/api/clientcard?inn=' + inn, cookie=self.U2)
        d = json.loads(b)
        self.assertTrue(d.get('kps'), 'свои КП в карточке видны')
        cid = (d.get('client') or {}).get('id')
        if cid:
            st, b, _ = self.req('POST', '/api/clientcard/note', {'id': cid, 'text': 'заметка m2 <script>'}, cookie=self.U2)
            at = json.loads(b)['notes'][0]['at']
            self.assertEqual(self.req('POST', '/api/clientcard/note', {'id': cid, 'del': at}, cookie=self.U1)[0], 403)
            self.assertEqual(self.req('POST', '/api/clientcard/note', {'id': cid, 'del': at}, cookie=self.U2)[0], 200)
        self.assertEqual(self.req('GET', '/api/clientcard', cookie=self.U1)[0], 400)
        # функции — выбранным менеджерам и только администратору
        self.admin_req('POST', '/api/admin/features', {'values': {'clientCard': {'on': True, 'who': 'users', 'users': [self.M1[0]]},
                                                                  'drafts': {'on': True, 'who': 'admin'}}})
        self.assertEqual(self.req('GET', '/api/clientcard', cookie=self.U1)[0], 400, 'm1 в списке — доступ есть')
        self.assertEqual(self.req('GET', '/api/clientcard', cookie=self.U2)[0], 403)
        self.assertEqual(self.req('GET', '/api/drafts', cookie=self.U1)[0], 403)
        self.assertEqual(self.admin_req('GET', '/api/drafts')[0], 200)
        f1 = json.loads(self.req('GET', '/api/features', cookie=self.U1)[1])
        f2 = json.loads(self.req('GET', '/api/features', cookie=self.U2)[1])
        self.assertTrue(f1['clientCard'] and not f2['clientCard'] and not f1['drafts'] and not f2['drafts'], (f1, f2))
        self.admin_req('POST', '/api/admin/features', {'values': {'clientCard': None, 'drafts': None}})
        self.req('POST', '/api/drafts/dsec1/delete', {}, cookie=self.U1)

    def test_10_prefs_are_personal(self):
        st, b, _ = self.req('PUT', '/api/me/prefs', {'theme': 'dark', 'mailSign': 'подпись m1'}, cookie=self.U1, headers={'X-KP-User-Id': self.M2[0]})
        self.assertTrue(st == 200 and json.loads(b)['id'] == self.M1[0], 'подпись запроса другого менеджера не меняет, чьи настройки')
        self.assertNotIn('подпись m1', self.req('GET', '/api/me/prefs', cookie=self.U2)[1])
        st, b, _ = self.req('GET', '/api/me/prefs', cookie=self.U2, headers={'X-KP-User-Id': self.M1[0]})
        self.assertTrue('подпись m1' not in b and json.loads(b)['id'] == self.M2[0])

    def test_11_server_only_actions(self):
        st, b, hd = self.net.req('POST', '/api/admin/login', {'login': Stand.ADMIN[0], 'password': Stand.ADMIN[1]})
        self.assertEqual(st, 200, 'администратор входит и по сети')
        ar, ah = Http.cookie(hd), {'X-CSRF-Token': json.loads(b)['csrf']}
        self.assertEqual(self.net.req('POST', '/api/admin/folder', {'which': 'data'}, cookie=ar, headers=ah)[0], 403, 'папки сервера по сети не открываются')
        self.assertEqual(self.net.req('POST', '/api/admin/setup', {'login': 'x2', 'password': 'Pass12345'})[0], 409)
        for p in ('/api/backup', '/api/shutdown'):
            with self.subTest(p):
                st, b, _ = self.req('POST', p, {}, cookie=self.U1)
                self.assertTrue(st != 200 or json.loads(b).get('ok') is False, (st, b[:100]))
        st, b, _ = self.req('POST', '/api/kp/%s/open' % self.K1[0], {}, cookie=self.U1)
        self.assertTrue(st != 200 or json.loads(b).get('remote') is True, 'Word по сети — только скачивание')
        self.assertTrue(self.stand.up(), 'сервер не выключился по сети')

    def test_12_blocked_manager(self):
        self.admin_req('POST', '/api/admin/access/' + self.M2[0], {'blocked': True})
        self.assertEqual(self.req('GET', '/api/history', cookie=self.U2)[0], 401, 'сессия заблокированного менеджера закрыта')
        self.assertEqual(self.req('POST', '/api/auth/login', {'login': 'm2', 'password': self.PW['m2']})[0], 403)
        self.admin_req('POST', '/api/admin/access/' + self.M2[0], {'blocked': False})

    def test_13_login_screen(self):
        """Экран входа: «Запомнить меня», подсказка «Забыли пароль?» от администратора, ответы не выдают, есть ли логин."""
        # без «Запомнить меня» — cookie до закрытия браузера (без Max-Age), вход работает; по умолчанию — на срок входа
        st, _, hd = self.req('POST', '/api/auth/login', {'login': 'm1', 'password': self.PW['m1'], 'remember': False})
        self.assertEqual(st, 200)
        self.assertNotIn('Max-Age', hd.get('Set-Cookie', ''))
        self.assertEqual(self.req('GET', '/api/history', cookie=Http.cookie(hd))[0], 200)
        self.assertIn('Max-Age=%d' % (30 * 86400), self.login_headers.get('Set-Cookie', ''))
        # неверный пароль: неизвестный логин и известный — один и тот же ответ (адрес «компьютера-сервера»: попытки — его)
        a = self.req('POST', '/api/auth/login', {'login': 'net-takogo', 'password': 'x1'}, local=True)
        b = self.req('POST', '/api/auth/login', {'login': 'm2', 'password': 'x1'}, local=True)
        self.assertEqual((a[0], b[0]), (403, 403))
        self.assertEqual(a[1].split('. ')[0], 'Неверный логин или пароль')
        self.assertEqual(b[1].split('. ')[0], 'Неверный логин или пароль')
        # заблокирован: с неверным паролем — как всем, «вход запрещён» — только с верным
        self.admin_req('POST', '/api/admin/access/' + self.M2[0], {'blocked': True})
        try:
            self.assertTrue(self.req('POST', '/api/auth/login', {'login': 'm2', 'password': 'x2'}, local=True)[1].startswith('Неверный логин'))
            st, b, _ = self.req('POST', '/api/auth/login', {'login': 'm2', 'password': self.PW['m2']}, local=True)
            self.assertEqual(st, 403)
            self.assertIn('запрещён', b)
        finally:
            self.admin_req('POST', '/api/admin/access/' + self.M2[0], {'blocked': False})
        self.U2 = self.__class__.U2 = Http.cookie(self.net.req('POST', '/api/auth/login', {'login': 'm2', 'password': self.PW['m2']})[2])
        # подсказка «Забыли пароль?»: пишет администратор, видна до входа; менеджер её не меняет; длинная — 400
        st, b, _ = self.admin_req('POST', '/api/admin/access', {'help': '  Пароль сбросит Иванов И.,\n доб. 123 '})
        self.assertEqual((st, json.loads(b)['help']), (200, 'Пароль сбросит Иванов И., доб. 123'))
        s = json.loads(self.req('GET', '/api/auth/status')[1])
        self.assertEqual((s['help'], s['sessionDays'], s['shortHours']), ('Пароль сбросит Иванов И., доб. 123', 30, 12))
        self.assertNotIn('managers', s)
        self.assertEqual(self.admin_req('POST', '/api/admin/access', {'help': 'x' * 201})[0], 400)
        self.assertEqual(self.req('POST', '/api/admin/access', {'help': 'взлом'}, cookie=self.U1)[0], 401)
        st, b, _ = self.admin_req('POST', '/api/admin/access', {'enabled': True})
        self.assertTrue(json.loads(b)['enabled'] and json.loads(b)['help'], 'включение входа не стирает подсказку')

    def test_90_password_guessing(self):
        """Последней: адрес, с которого перебирали пароли, заблокирован на 10 минут."""
        codes = [self.loc.req('POST', '/api/auth/login', {'login': 'm2', 'password': 'wrong%d' % i})[0] for i in range(12)]
        self.assertIn(429, codes)
        st, b, hd = self.loc.req('POST', '/api/auth/login', {'login': 'm2', 'password': self.PW['m2']})
        self.assertEqual(st, 429)
        self.assertIn('снова через', b)
        self.assertTrue(0 < int(hd.get('Retry-After', 0)) <= 600, hd)
        codes = [self.loc.req('POST', '/api/admin/login', {'login': 'admin', 'password': 'w%d' % i})[0] for i in range(3)]
        self.assertIn(429, codes)
        self.assertEqual(self.net.req('GET', '/api/history', cookie=self.U1)[0], 200, 'другой адрес работает')


if __name__ == '__main__':
    unittest.main()
