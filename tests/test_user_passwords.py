# -*- coding: utf-8 -*-
"""Пароли менеджеров на стенде со входом по паролю: «Сбросить пароль» у администратора (временный пароль: один раз в ответе,
только хешем в базе, срок srv.tempPwHours, до смены — никаких других запросов), смена пароля самим менеджером (неверный
текущий — отказ и попытка засчитана, другие входы закрываются, текущий остаётся), «Выйти на всех устройствах» (менеджер и
администратор), чужой пароль менеджер не сбросит, CSRF, в журнале действий и журнале сервера нет паролей."""
import json
import os
import sqlite3
import time
import unittest

from kit import Http, SampleData, Stand


class UserPasswordsTest(unittest.TestCase):
    PW = {'m1': 'pass-m1-52', 'm2': 'pass-m2-52'}

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=10, clients=3, kps=1)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS
        cls.secrets = []           # все пароли, что появлялись в проверке: ни один не должен попасть в журналы
        st, b = cls.admin('POST', '/api/admin/defaults', {'values': {'srv.loginFails': {'on': True, 'v': '20'}}})
        assert st == 200, (st, b)
        for mgr, lg in ((cls.M1, 'm1'), (cls.M2, 'm2')):
            st, b = cls.admin('POST', '/api/admin/access/' + mgr[0], {'login': lg, 'password': cls.PW[lg]})
            assert st == 200, (st, b)
            cls.secrets.append(cls.PW[lg])
        st, b = cls.admin('POST', '/api/admin/access', {'enabled': True})
        assert st == 200, (st, b)

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    @classmethod
    def admin(cls, method, path, body=None, csrf=True, cookie=None):
        st, b, _ = cls.http.req(method, path, body, cookie=cls.adm if cookie is None else cookie, headers=dict(cls.A) if csrf else {})
        return st, (Http.js(b) if st == 200 else b)

    def login(self, lg, pw, expect=200):
        st, b, hd = self.http.req('POST', '/api/auth/login', {'login': lg, 'password': pw})
        self.assertEqual(st, expect, b)
        return (Http.cookie(hd), Http.js(b)) if st == 200 else (None, b)

    def get(self, cookie, path='/api/managers'):
        return self.http.req('GET', path, cookie=cookie)

    def change(self, cookie, new, new2=None, old=None, headers=None):
        body = {'new': new, 'new2': new if new2 is None else new2}
        if old is not None:
            body['old'] = old
        self.secrets.append(new)
        st, b, hd = self.http.req('POST', '/api/auth/password', body, cookie=cookie, headers=headers)
        return st, b, hd

    def access_row(self, mid):
        return next(x for x in self.admin('GET', '/api/admin/access')[1]['managers'] if x['id'] == mid)

    def mgr_access(self):
        c = sqlite3.connect(self.stand.db)
        try:
            return json.loads(c.execute("SELECT value FROM kv WHERE key='mgrAccess'").fetchone()[0])
        finally:
            c.close()

    def set_mgr_access(self, a):
        c = sqlite3.connect(self.stand.db)
        try:
            c.execute("UPDATE kv SET value=? WHERE key='mgrAccess'", (json.dumps(a, ensure_ascii=False),))
            c.commit()
        finally:
            c.close()

    def audit(self):
        c = sqlite3.connect(self.stand.db)
        try:
            return c.execute('SELECT action, entity_type, entity_id, before, after, result, user_name, role FROM audit ORDER BY id').fetchall()
        finally:
            c.close()

    # ---------------------------------------------------------------- «Сбросить пароль» и временный пароль
    def test_01_reset_and_temp_password(self):
        mid = self.M1[0]
        a, _ = self.login('m1', self.PW['m1'])
        b, _ = self.login('m1', self.PW['m1'])
        self.assertEqual(self.access_row(mid)['sessions'], 2)
        # без администратора и без CSRF — нельзя
        self.assertEqual(self.http.req('POST', '/api/admin/access/%s/reset' % mid, {}, cookie=a)[0], 401)
        self.assertEqual(self.admin('POST', '/api/admin/access/%s/reset' % mid, {}, csrf=False)[0], 401)
        self.assertEqual(self.admin('POST', '/api/admin/access/net-takogo/reset', {})[0], 404)
        st, r = self.admin('POST', '/api/admin/access/%s/reset' % mid, {})
        self.assertEqual(st, 200, r)
        tmp = r['password']
        self.secrets.append(tmp)
        self.assertGreaterEqual(len(tmp), 10)
        self.assertEqual(r['hours'], 24, 'srv.tempPwHours по умолчанию — сутки')
        self.assertNotIn(tmp, json.dumps(self.mgr_access()), 'в базе — только хеш')
        # прежние входы закрыты, прежний пароль не подходит
        self.assertEqual(self.get(a)[0], 401)
        self.assertEqual(self.get(b)[0], 401)
        self.login('m1', self.PW['m1'], 403)
        row = self.access_row(mid)
        self.assertTrue(row['temp'] and not row['temp']['expired'] and row['sessions'] == 0, row)
        # вход временным: до смены пароля — только смена (403 с заголовком для клиента), служебное — можно
        t, res = self.login('m1', tmp)
        self.assertTrue(res['mustChange'])
        self.assertTrue(json.loads(self.get(t, '/api/auth/status')[1])['user']['mustChange'])
        st, body, hd = self.get(t)
        self.assertEqual(st, 403)
        self.assertIn('задайте свой пароль', body)
        self.assertEqual(hd.get('X-KP-Auth'), 'change-password')
        self.assertEqual(self.http.req('PUT', '/api/kp/x1/meta', {'number': '1'}, cookie=t)[0], 403)
        self.assertEqual(self.get(t, '/api/ping')[0], 200)
        # неверный новый пароль — понятный отказ
        for new, new2, text in (('abc', None, 'не короче 4'), ('good-pass-1', 'good-pass-2', 'не совпадают'), (tmp, None, 'совпадает с прежним'),
                                ('', None, 'два раза')):
            st, body, _ = self.change(t, new, new2)
            self.assertEqual(st, 400, (new, body))
            self.assertIn(text, body)
        st, body, _ = self.change(t, 'own-pass-77')
        self.assertEqual(st, 200, body)
        self.assertEqual(self.get(t)[0], 200, 'вход остаётся, ограничение снято')
        self.assertFalse(json.loads(self.get(t, '/api/auth/status')[1])['user'].get('mustChange'))
        self.login('m1', tmp, 403)
        self.login('m1', self.PW['m1'], 403)
        self.login('m1', 'own-pass-77')
        self.assertIsNone(self.access_row(mid)['temp'])
        self.PW['m1'] = 'own-pass-77'
        acts = [(x[0], x[5]) for x in self.audit() if x[2] == mid]
        self.assertIn(('reset_password', 'success'), acts)
        self.assertIn(('set_password', 'success'), acts)

    def test_02_temp_password_expires(self):
        mid = self.M2[0]
        st, r = self.admin('POST', '/api/admin/access/%s/reset' % mid, {})
        self.assertEqual(st, 200, r)
        tmp = r['password']
        self.secrets.append(tmp)
        t, _ = self.login('m2', tmp)
        a = self.mgr_access()
        a[mid]['temp']['exp'] = time.time() - 5           # срок вышел
        self.set_mgr_access(a)
        self.assertEqual(self.get(t)[0], 401, 'вход с истёкшим временным паролем закрыт')
        st, body = self.login('m2', tmp, 403)
        self.assertIn('истёк', body)
        self.assertTrue(self.access_row(mid)['temp']['expired'])
        # постоянный пароль от администратора снимает временный
        st, b = self.admin('POST', '/api/admin/access/' + mid, {'password': self.PW['m2']})
        self.assertEqual(st, 200, b)
        c, res = self.login('m2', self.PW['m2'])
        self.assertFalse(res['mustChange'])
        self.assertEqual(self.get(c)[0], 200)
        self.assertIsNone(self.access_row(mid)['temp'])

    # ---------------------------------------------------------------- смена пароля менеджером
    def test_03_change_own_password(self):
        old = self.PW['m1']
        s1, _ = self.login('m1', old)
        s2, _ = self.login('m1', old)
        self.assertEqual(self.change(None, 'x-new-1', old=old)[0], 401, 'без входа')
        st, body, _ = self.change(s1, 'x-new-1', old='wrong-old')
        self.assertEqual(st, 403)
        self.assertIn('Текущий пароль указан неверно', body)
        self.assertEqual(self.change(s1, 'x-new-1')[0], 403, 'без текущего пароля — нельзя')
        st, body, _ = self.change(s1, 'x-new-1', old=old, headers={'Origin': 'http://evil.example'})
        self.assertEqual(st, 403, 'чужой сайт')
        st, body, _ = self.change(s1, 'm1-new-pass', old=old)
        self.assertEqual(st, 200, body)
        self.assertGreaterEqual(json.loads(body)['closed'], 1)
        self.assertEqual(self.get(s1)[0], 200, 'текущий вход жив')
        self.assertEqual(self.get(s2)[0], 401, 'другой вход закрыт')
        self.login('m1', old, 403)
        self.login('m1', 'm1-new-pass')
        self.PW['m1'] = 'm1-new-pass'
        fails = [x for x in self.audit() if x[0] == 'set_password' and x[5] == 'failed' and x[2] == self.M1[0]]
        self.assertTrue(fails, 'неверный текущий пароль — в журнале')

    # ---------------------------------------------------------------- «Выйти на всех устройствах»
    def test_04_logout_everywhere(self):
        mid = self.M1[0]
        s1, _ = self.login('m1', self.PW['m1'])
        s2, _ = self.login('m1', self.PW['m1'])
        st, b, hd = self.http.req('POST', '/api/auth/logout-all', {}, cookie=s1)
        self.assertEqual(st, 200, b)
        self.assertGreaterEqual(json.loads(b)['closed'], 2)
        self.assertIn('Max-Age=0', hd.get('Set-Cookie', ''))
        self.assertEqual(self.get(s1)[0], 401)
        self.assertEqual(self.get(s2)[0], 401)
        self.assertEqual(self.http.req('POST', '/api/auth/logout-all', {})[0], 401, 'без входа')
        # администратор: только с сессией и CSRF; менеджер — нет
        s3, _ = self.login('m1', self.PW['m1'])
        s4, _ = self.login('m1', self.PW['m1'])
        self.assertEqual(self.access_row(mid)['sessions'], 2)
        self.assertEqual(self.admin('POST', '/api/admin/access/%s/logout' % mid, {}, csrf=False)[0], 401)
        self.assertEqual(self.http.req('POST', '/api/admin/access/%s/logout' % mid, {}, cookie=s3)[0], 401)
        st, r = self.admin('POST', '/api/admin/access/%s/logout' % mid, {})
        self.assertEqual(st, 200, r)
        self.assertEqual(r['closed'], 2)
        self.assertEqual(self.get(s3)[0], 401)
        self.assertEqual(self.get(s4)[0], 401)
        self.login('m1', self.PW['m1'])        # пароль не меняется
        acts = [x[0] for x in self.audit() if x[2] == mid]
        self.assertGreaterEqual(acts.count('logout_all'), 2)

    def test_05_manager_cannot_reset_other(self):
        s1, _ = self.login('m1', self.PW['m1'])
        for path in ('/api/admin/access/%s/reset' % self.M2[0], '/api/admin/access/%s/logout' % self.M2[0], '/api/admin/access/' + self.M2[0]):
            st, b, _ = self.http.req('POST', path, {'password': 'hacked-1'}, cookie=s1, headers={'X-CSRF-Token': 'fake'})
            self.assertEqual(st, 401, (path, b))
        self.login('m2', self.PW['m2'])

    # ---------------------------------------------------------------- журналы без паролей
    def test_90_no_passwords_in_logs(self):
        rows = json.dumps(self.audit(), ensure_ascii=False)
        logs = self.stand.output()
        d = os.path.join(self.stand.data, 'logs')
        for f in os.listdir(d) if os.path.isdir(d) else []:
            with open(os.path.join(d, f), encoding='utf-8', errors='replace') as fh:
                logs += fh.read()
        for pw in set(self.secrets):
            if len(pw) >= 6:
                self.assertNotIn(pw, rows, 'пароль в журнале действий')
                self.assertNotIn(pw, logs, 'пароль в журнале сервера')
        self.assertEqual(self.stand.request_errors(), [])

    def test_99_change_password_guessing(self):
        """Подбор текущего пароля при смене — как подбор при входе: пауза после srv.loginFails ошибок."""
        s1, _ = self.login('m1', self.PW['m1'])
        st, b = self.admin('POST', '/api/admin/defaults', {'values': {'srv.loginFails': {'on': True, 'v': '3'}}})
        self.assertEqual(st, 200, b)
        time.sleep(5.5)          # значения сервера кэшируются на 5 с
        codes = [self.change(s1, 'x-guess-1', old='guess-%d' % i)[0] for i in range(4)]
        self.assertIn(429, codes, codes)
        self.assertEqual(self.change(s1, 'x-guess-2', old=self.PW['m1'])[0], 429, 'во время паузы и верный — нет')


if __name__ == '__main__':
    unittest.main()
