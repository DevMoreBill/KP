# -*- coding: utf-8 -*-
"""Права администраторов (admin_rights): главный может всё и один управляет администраторами; у остальных — вкладки
«нет / просмотр / изменение» и отдельные действия (удаление, база, обновления, ключи); проверяет сервер (403 с причиной),
прежние учётные записи остаются главными, последнего главного разжаловать и удалить нельзя."""
import json
import unittest

from admin_rights import AdminRights
from kit import Http, SampleData, Stand


class AdminRightsUnitTest(unittest.TestCase):
    def rights(self, sections=None, actions=None):
        return AdminRights([{'login': 'boss'}, {'login': 'kat', 'main': False,
                                                'rights': {'sections': sections or {}, 'actions': actions or []}}])

    def test_old_accounts_are_main(self):
        self.assertTrue(AdminRights.is_main({'login': 'admin'}))
        self.assertFalse(AdminRights.is_main({'login': 'x', 'rights': {}}))
        self.assertEqual(self.rights().refuse('boss', 'POST', '/api/admin/users'), '')

    def test_levels_and_actions(self):
        acc = self.rights({'goods': 'edit', 'audit': 'view', 'trash': 'edit', 'mail': 'edit'}, ['delete'])
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/audit'), '')
        self.assertIn('только для просмотра', acc.refuse('kat', 'POST', '/api/admin/audit/5/rollback'))
        self.assertIn('Нет доступа', acc.refuse('kat', 'GET', '/api/admin/system'))
        self.assertIn('главный администратор', acc.refuse('kat', 'GET', '/api/admin/users'))
        self.assertEqual(acc.refuse('kat', 'POST', '/api/admin/trash/clear'), '', 'корзина + право удалять')
        self.assertEqual(acc.refuse('kat', 'POST', '/api/admin/delete', {'type': 'catalog'}), '')
        self.assertIn('Нет доступа', acc.refuse('kat', 'POST', '/api/admin/delete', {'type': 'kp'}), 'КП — другой раздел')
        self.assertEqual(acc.refuse('kat', 'POST', '/api/admin/mail', {'host': 'smtp.x.ru', 'password': '••••••'}), '',
                         'пароль «звёздочками» — не смена пароля')
        self.assertIn('Ключи и пароли', acc.refuse('kat', 'POST', '/api/admin/mail', {'password': 'новый'}))
        self.assertEqual(acc.refuse('kat', 'POST', '/api/admin/password', {}), '', 'свой пароль — всегда')
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/attention'), '', 'главная — всегда')

    def test_manager_paths_read_free(self):
        acc = self.rights()
        self.assertEqual(acc.refuse('kat', 'GET', '/api/catalog/p1'), '', 'карточку читает и окно менеджера')
        self.assertIn('Товары', acc.refuse('kat', 'PUT', '/api/catalog/p1'))
        self.assertEqual(acc.refuse('kat', 'GET', '/api/kp/list'), '', 'адреса без вкладки — без проверки')

    def test_db_and_updates(self):
        acc = self.rights({'backup': 'edit', 'updates': 'edit'})
        self.assertIn('База данных', acc.refuse('kat', 'GET', '/api/admin/export/sqlite'))
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/export'), '')
        self.assertIn('База данных', acc.refuse('kat', 'POST', '/api/admin/import'))
        self.assertIn('обновлений', acc.refuse('kat', 'POST', '/api/admin/update/rollback'))
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/update'), '')

    def test_clean(self):
        got = AdminRights.clean({'sections': {'goods': 'edit', 'x': 'edit', 'audit': 'root'}, 'actions': ['db', 'hack']})
        self.assertEqual(got, {'sections': {'goods': 'edit'}, 'actions': ['db']})


class AdminRightsStandTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=10, clients=3, kps=1)).start()
        cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def login(self, lg, pw):
        st, b, hd = self.stand.http.req('POST', '/api/admin/login', {'login': lg, 'password': pw})
        self.assertEqual(st, 200, b)
        return Http.cookie(hd), {'X-CSRF-Token': json.loads(b)['csrf']}

    def call(self, auth, method, path, body=None):
        return self.stand.http.req(method, path, body, cookie=auth[0], headers=auth[1])

    def test_flow(self):
        boss = self.login(*Stand.ADMIN)
        rights = {'sections': {'audit': 'view', 'goods': 'edit'}, 'actions': []}
        st, b, _ = self.call(boss, 'POST', '/api/admin/users',
                             {'action': 'add', 'login': 'kat', 'name': 'Катя', 'password': 'pass1234', 'rights': rights})
        self.assertEqual(st, 200, b)
        kat = self.login('kat', 'pass1234')
        status = json.loads(self.call(kat, 'GET', '/api/admin/status')[1])
        self.assertEqual((status['rights']['main'], status['rights']['sections']), (False, rights['sections']))
        self.assertEqual(self.call(kat, 'GET', '/api/admin/audit')[0], 200)
        st, body, _ = self.call(kat, 'GET', '/api/admin/system')
        self.assertEqual(st, 403)
        self.assertIn('Нет доступа к разделу «Система»', body)
        self.assertEqual(self.call(kat, 'GET', '/api/admin/users')[0], 403, 'администраторами управляет главный')
        self.assertEqual(self.call(kat, 'POST', '/api/admin/features', {'values': {}})[0], 403)
        audit = json.loads(self.call(boss, 'GET', '/api/admin/audit')[1])
        self.assertTrue(any(row.get('action') == 'admin_denied' for row in audit.get('items', [])), 'отказ — в журнале')
        # последнего главного разжаловать и удалить нельзя; назначили главным — может всё
        users = [u for u in json.loads(self.call(boss, 'GET', '/api/admin/users')[1])['items'] if u['main']]
        self.assertEqual(len(users), 1)
        st, b, _ = self.call(boss, 'POST', '/api/admin/users', {'action': 'rights', 'login': users[0]['login'], 'main': False})
        self.assertEqual(st, 400)
        self.assertIn('единственный главный', b)
        self.assertEqual(self.call(boss, 'POST', '/api/admin/users', {'action': 'rights', 'login': 'kat', 'main': True})[0], 200)
        self.assertEqual(self.call(kat, 'GET', '/api/admin/system')[0], 200)


if __name__ == '__main__':
    unittest.main()
