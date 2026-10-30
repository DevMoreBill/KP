# -*- coding: utf-8 -*-
"""Вход по паролю: менеджер в КП — только вошедший (admin_access.KpManagerLock). Другого менеджера не подставить запросом
(состояние и описание КП получают код, ФИО и контакты из карточки вошедшего); свою карточку менеджер правит, чужую — нет;
администратор и вход без пароля — без ограничения."""
import unittest

from kit import Http, SampleData, Stand


class KpManagerLockTest(unittest.TestCase):
    PW = 'pass-lock-52'

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=5, clients=2, kps=1)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS
        st, b, _ = cls.http.req('POST', '/api/admin/access/' + cls.M1[0], {'login': 'lock1', 'password': cls.PW}, cookie=cls.adm, headers=dict(cls.A))
        assert st == 200, (st, b)

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def set_login(self, on):
        st, b, _ = self.http.req('POST', '/api/admin/access', {'enabled': on}, cookie=self.adm, headers=dict(self.A))
        self.assertEqual(st, 200, b)

    def user(self):
        st, b, hd = self.http.req('POST', '/api/auth/login', {'login': 'lock1', 'password': self.PW})
        self.assertEqual(st, 200, b)
        return Http.cookie(hd)

    def put(self, kid, field, doc, cookie):
        st, b, _ = self.http.req('PUT', '/api/kp/%s/%s' % (kid, field), doc, cookie=cookie)
        self.assertEqual(st, 200, b)
        st, b, _ = self.http.req('GET', '/api/kp/%s/%s' % (kid, field), cookie=cookie)
        self.assertEqual(st, 200, b)
        return Http.js(b)

    def other(self):
        """КП, в котором менеджером указан другой (Петров) — так пришло бы от подменённого клиента."""
        mid, name, mail, phone = self.M2
        return ({'managerId': mid, 'manager': {'name': name, 'email': mail, 'mobile': phone, 'position': 'Менеджер', 'site': 'example.com'}, 'items': []},
                {'managerId': mid, 'manager': name, 'managerPost': 'Менеджер', 'number': 'T-1'})

    def test_01_manager_cannot_put_other_manager(self):
        self.set_login(True)
        try:
            c = self.user()
            kid = Http.js(self.http.req('POST', '/api/kp/new', cookie=c)[1])['id']
            state, meta = self.other()
            s = self.put(kid, 'state', state, c)
            self.assertEqual(s['managerId'], self.M1[0])
            self.assertEqual(s['manager']['name'], self.M1[1])
            self.assertEqual(s['manager']['email'], self.M1[2])
            self.assertEqual(s['manager']['site'], 'example.com', 'свои поля КП (сайт, адрес) остаются')
            m = self.put(kid, 'meta', meta, c)
            self.assertEqual((m['managerId'], m['manager']), (self.M1[0], self.M1[1]))
            self.assertEqual(m['authorId'], self.M1[0])
        finally:
            self.set_login(False)

    def test_02_own_card_editable_other_not(self):
        self.set_login(True)
        try:
            c = self.user()
            mid, name, mail, phone = self.M1
            st, b, _ = self.http.req('PUT', '/api/managers/' + mid, {'name': name, 'email': mail, 'mobile': phone, 'position': 'Старший менеджер'}, cookie=c)
            self.assertEqual(st, 200, b)
            self.assertEqual(Http.js(b)['position'], 'Старший менеджер')
            st, b, _ = self.http.req('PUT', '/api/managers/' + self.M2[0], {'name': self.M2[1], 'position': 'Чужая правка'}, cookie=c)
            self.assertEqual(st, 403, b)
            st, b, _ = self.http.req('PUT', '/api/managers/mgr-new-by-user', {'name': 'Новый Менеджер Тестович'}, cookie=c)
            self.assertEqual(st, 403, 'нового менеджера вошедший не заводит')
            kid = Http.js(self.http.req('POST', '/api/kp/new', cookie=c)[1])['id']
            s = self.put(kid, 'state', self.other()[0], c)
            self.assertEqual(s['manager']['position'], 'Старший менеджер', 'в КП — контакты из своей карточки')
        finally:
            self.set_login(False)

    def test_03_admin_and_no_login_unrestricted(self):
        state, meta = self.other()
        kid = Http.js(self.http.req('POST', '/api/kp/new', cookie=self.adm)[1])['id']
        s = self.put(kid, 'state', state, self.adm)
        self.assertEqual(s['managerId'], self.M2[0], 'администратор ставит любого менеджера')
        kid = Http.js(self.http.req('POST', '/api/kp/new')[1])['id']
        self.assertEqual(self.put(kid, 'state', state, None)['managerId'], self.M2[0], 'вход без пароля — как раньше')


if __name__ == '__main__':
    unittest.main(verbosity=2)
