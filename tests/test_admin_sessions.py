# -*- coding: utf-8 -*-
"""Вход администратора переживает перезапуск программы (admin.AdminSessions): в базе — хеш токена, а не сам токен;
выход, смена пароля и удаление учётной записи закрывают сессии и после перезапуска; 15 минут бездействия — сессии нет."""
import hashlib
import json
import sqlite3
import tempfile
import shutil
import time
import unittest

from kit import Http, SampleData, Stand


class AdminSessionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=20, clients=5, kps=2)).start()
        cls.stand.admin()                      # первая учётная запись
        cls.tmp = tempfile.mkdtemp(prefix='kp-sess-')

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def login(self, lg, pw):
        st, b, hd = self.stand.http.req('POST', '/api/admin/login', {'login': lg, 'password': pw})
        self.assertEqual(st, 200, b)
        return Http.cookie(hd), {'X-CSRF-Token': json.loads(b)['csrf']}

    def can_read(self, c):
        return self.stand.http.req('GET', '/api/admin/system', cookie=c)[0] == 200

    def can_change(self, c, h):
        return self.stand.http.req('POST', '/api/admin/maint/mirror/check', {'path': self.tmp}, cookie=c, headers=h)[0] in (200, 400)

    def kv(self, change=None):
        c = sqlite3.connect(self.stand.db)
        try:
            r = c.execute("SELECT value FROM kv WHERE key='adminSessions'").fetchone()
            s = json.loads(r[0]) if r else {}
            if change:
                change(s)
                c.execute("UPDATE kv SET value=? WHERE key='adminSessions'", (json.dumps(s),))
                c.commit()
            return s
        finally:
            c.close()

    def test_sessions(self):
        lg, pw = Stand.ADMIN
        c1, h1 = self.login(lg, pw)
        tok = c1.split('=', 1)[1]
        s = self.kv()
        self.assertIn(hashlib.sha256(tok.encode()).hexdigest(), s, 'в базе — хеш токена')
        self.assertNotIn(tok, json.dumps(s), 'самого токена в базе нет')
        self.stand.restart()
        self.assertTrue(self.can_read(c1), 'после перезапуска сессия действует')
        self.assertTrue(self.can_change(c1, h1), 'и токен CSRF тоже')
        # вторая учётная запись: смена пароля закрывает её другие сессии, удаление — все
        st, b, _ = self.stand.http.req('POST', '/api/admin/users', {'action': 'add', 'login': 'second', 'name': 'Второй', 'password': 'Second123'},
                                       cookie=c1, headers=h1)
        self.assertEqual(st, 200, b)
        c2, h2 = self.login('second', 'Second123')
        c2b, _ = self.login('second', 'Second123')
        st, b, _ = self.stand.http.req('POST', '/api/admin/users', {'action': 'password', 'login': 'second', 'password': 'Second456'}, cookie=c2, headers=h2)
        self.assertEqual(st, 200, b)
        self.assertTrue(self.can_read(c2), 'сессия, из которой сменили пароль, действует')
        self.assertFalse(self.can_read(c2b), 'другая сессия той же учётной записи закрыта')
        self.stand.restart()
        self.assertTrue(self.can_read(c2) and not self.can_read(c2b), 'и после перезапуска')
        st, b, _ = self.stand.http.req('POST', '/api/admin/users', {'action': 'delete', 'login': 'second'}, cookie=c1, headers=h1)
        self.assertEqual(st, 200, b)
        self.assertFalse(self.can_read(c2), 'сессии удалённой учётной записи закрыты')
        # выход
        c3, h3 = self.login(lg, pw)
        self.assertEqual(self.stand.http.req('POST', '/api/admin/logout', {}, cookie=c3, headers=h3)[0], 200)
        self.assertFalse(self.can_read(c3))
        self.stand.restart()
        self.assertFalse(self.can_read(c3), 'после выхода и перезапуска сессия не возвращается')
        # 15 минут без действий: время последнего действия в базе — 16 минут назад
        c4, _ = self.login(lg, pw)
        k4 = hashlib.sha256(c4.split('=', 1)[1].encode()).hexdigest()
        self.stand.stop()

        def older(s):
            s[k4]['last'] = time.time() - 16 * 60
        self.kv(older)
        self.stand.start()
        self.assertFalse(self.can_read(c4), 'сессия старше 15 минут бездействия не действует')
        self.assertTrue(self.can_read(c1), 'рабочая сессия по-прежнему действует')


if __name__ == '__main__':
    unittest.main()
