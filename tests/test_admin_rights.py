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
        with_db = self.rights({'backup': 'edit'}, ['db'])
        self.assertIn('Ключи и пароли', with_db.refuse('kat', 'GET', '/api/admin/export/sqlite'), 'DB-002: в базе все ключи')
        self.assertEqual(self.rights({'backup': 'edit'}, ['db', 'secrets']).refuse('kat', 'GET', '/api/admin/export/sqlite'), '')
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/export'), '')
        self.assertIn('База данных', acc.refuse('kat', 'POST', '/api/admin/import'))
        self.assertIn('обновлений', acc.refuse('kat', 'POST', '/api/admin/update/rollback'))
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/update'), '')

    def test_template_code_main_only(self):
        """FE-001: skeleton.js выполняется у всех, кто строит КП, — пишет и восстанавливает только главный."""
        acc = self.rights({'templates': 'edit'})
        put = '/api/templates/pnevmotekh/file'
        self.assertIn('главный администратор', acc.refuse('kat', 'PUT', put, None, {'name': 'skeleton.js'}))
        self.assertIn('главный', acc.refuse('kat', 'POST', '/api/templates/pnevmotekh/restore', None,
                                            {'name': 'skeleton-20261027-101010.js'}))
        self.assertEqual(acc.refuse('kat', 'PUT', put, None, {'name': 'template.json'}), '', 'прочие файлы — по вкладке')
        self.assertEqual(acc.refuse('kat', 'GET', '/api/templates/pnevmotekh/history', None, {}), '')
        self.assertEqual(acc.refuse('boss', 'PUT', put, None, {'name': 'skeleton.js'}), '')

    def test_settings_file_keys(self):
        """BE-002: файл настроек с ключами — ещё и право «Ключи и пароли»."""
        acc = self.rights({'changes': 'edit'})
        self.assertEqual(acc.refuse('kat', 'GET', '/api/admin/settings-file', None, {}), '')
        self.assertIn('Ключи и пароли', acc.refuse('kat', 'GET', '/api/admin/settings-file', None, {'keys': '1'}))
        self.assertEqual(self.rights({'changes': 'edit'}, ['secrets']).refuse(
            'kat', 'GET', '/api/admin/settings-file', None, {'keys': '1'}), '')

    def test_settings_import_keeps_secrets(self):
        """BE-002: загрузка файла настроек без права «Ключи» — ключи, пароли и адреса для них остаются текущими."""
        from data_bundle import Keys, SecretFields
        cur = {'ai': {'key': 'OLD', 'base': 'https://api.deepseek.com', 'model': 'm1'}, 'backup2': {'dav': {'url': 'a'}}}
        new = {'ai': {'key': 'EVIL', 'base': 'https://evil.example', 'model': 'm2'}, 'backup2': {'dav': {'url': 'b'}}}
        new['backup2']['path'] = '\\\\evil\\share'
        got = SecretFields.keep('settings', new, cur)
        self.assertNotIn('path', got['backup2'], 'путь второй папки — текущий (у текущей его нет)')
        self.assertEqual(got['ai'], {'key': 'OLD', 'base': 'https://api.deepseek.com', 'model': 'm2'})
        self.assertEqual(got['backup2']['dav'], {'url': 'a'})
        self.assertEqual(SecretFields.keep('mail', {'host': 'evil', 'fromName': 'X'}, {'host': 'smtp.ok'}),
                         {'host': 'smtp.ok', 'fromName': 'X'})
        self.assertNotIn('url', SecretFields.keep('bitrix', {'url': 'https://evil/rest/1/x/'}, {}))
        self.assertIn('integrations', SecretFields.WHOLE)
        self.assertIsNot(Keys.WITH, Keys.WITHOUT)

    def test_unlisted_admin_path_main_only(self):
        """BE-009: адрес «Настроек», которого нет в таблице прав, — только главному."""
        acc = self.rights({key: 'edit' for key in AdminRights.section_keys()}, list(AdminRights.ACTIONS))
        self.assertIn('только главному', acc.refuse('kat', 'POST', '/api/admin/new-thing'))
        self.assertEqual(acc.refuse('boss', 'POST', '/api/admin/new-thing'), '')
        self.assertEqual(acc.refuse('kat', 'GET', '/api/catalog-unlisted'), '', 'адреса программы — как раньше')

    def test_admin_routes_listed(self):
        """Каждый адрес AdminApi — в таблице прав (иначе администратору с правами он закрыт)."""
        import os
        import re
        with open(os.path.join(os.path.dirname(__file__), '..', 'app', 'admin.py'), encoding='utf-8') as file:
            code = file.read()
        api = code[code.index('class AdminApi'):]
        subs = set(re.findall(r"sub == '([^']+)'", api)) | set(re.findall(r"sub\.startswith\(\s*'([^']+)'", api))
        missing = [sub for sub in sorted(subs) if AdminRights.rule_of('/api/admin/' + sub) is None]
        self.assertEqual(missing, [])

    def test_session_max_age(self):
        """BE-012: вход в «Настройки» старше srv.adminMaxHours закрывается, даже если администратор работает."""
        import time
        from admin import AdminSessions
        from kit import TempStore
        store = TempStore(self).store
        saved = AdminSessions._store
        AdminSessions._store = staticmethod(lambda: store)
        try:
            now = time.time()
            self.assertFalse(AdminSessions._expired({'last': now, 'start': now - 11 * 3600}))
            self.assertTrue(AdminSessions._expired({'last': now, 'start': now - 13 * 3600}), 'вход старше 12 ч')
            self.assertTrue(AdminSessions._expired({'last': now - 16 * 60, 'start': now - 60}), 'бездействие 16 мин')
            self.assertFalse(AdminSessions._expired({'last': now}), 'прежняя сессия без start — по последнему действию')
        finally:
            AdminSessions._store = saved

    def test_backup_settings_keep_destinations(self):
        """BE-003 (по ревью): раздел «Настройки» копии базы без права «Ключи» не меняет сервер почты и адрес нейросети."""
        from data_bundle import Keys, ProgramSettings
        from kit import TempStore
        store = TempStore(self).store
        store.kv_set('mail', {'host': 'smtp.ok.ru', 'password': 'pw'})
        store.kv_set('settings', {'ai': {'base': 'https://api.deepseek.com', 'model': 'a'}})
        copy = {'mail': {'host': 'smtp.evil.example', 'fromName': 'X'}, 'settings': {'ai': {'base': 'https://evil.example', 'model': 'b'}}}
        ProgramSettings(store).apply(copy, Keys.WITHOUT)
        self.assertEqual((store.kv_get('mail')['host'], store.kv_get('mail')['password']), ('smtp.ok.ru', 'pw'))
        self.assertEqual(store.kv_get('settings')['ai'], {'base': 'https://api.deepseek.com', 'model': 'b'})
        ProgramSettings(store).apply(copy)
        self.assertEqual(store.kv_get('mail')['host'], 'smtp.evil.example', 'главный — как в копии')

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

    def test_import_keeps_admins(self):
        """DB-001: не главный с правом «База данных» загружает базу, где он главный, — учётные записи остаются текущими;
        чужие триггеры из файла не переносятся."""
        import os
        import sqlite3
        import tempfile
        boss = self.login(*Stand.ADMIN)
        rights = {'sections': {'backup': 'edit'}, 'actions': ['db', 'secrets']}
        self.call(boss, 'POST', '/api/admin/users',
                  {'action': 'add', 'login': 'dba', 'name': 'База', 'password': 'pass1234', 'rights': rights})
        dba = self.login('dba', 'pass1234')
        st, raw, _ = self.stand.http.req('GET', '/api/admin/export/sqlite', cookie=dba[0], headers=dba[1], raw=True)
        self.assertEqual(st, 200)
        path = os.path.join(tempfile.mkdtemp(), 'kp.sqlite3')
        with open(path, 'wb') as file:
            file.write(raw if raw[:6] == b'SQLite' else self._unzip(raw))
        conn = sqlite3.connect(path)
        admins = json.loads(conn.execute("SELECT value FROM kv WHERE key='admins'").fetchone()[0])
        for user in admins['users']:
            if user['login'] == 'dba':
                user['main'] = True
        conn.execute("UPDATE kv SET value=? WHERE key='admins'", (json.dumps(admins),))
        conn.execute("CREATE TRIGGER evil AFTER INSERT ON kp BEGIN UPDATE kv SET value='x' WHERE key='admins'; END")
        conn.commit()
        conn.close()
        with open(path, 'rb') as file:
            body = file.read()
        st, out, _ = self.stand.http.req('POST', '/api/admin/import/sqlite?name=kp.sqlite3', body, cookie=dba[0],
                                         headers=dict(dba[1], **{'Content-Type': 'application/octet-stream'}))
        self.assertEqual(st, 200, out)
        status = json.loads(self.call(dba, 'GET', '/api/admin/status')[1])
        self.assertFalse(status['rights']['main'], 'главным не стал')
        check = sqlite3.connect(self.stand.db)
        names = [row[0] for row in check.execute("SELECT name FROM sqlite_master WHERE type='trigger'")]
        check.close()
        self.assertNotIn('evil', names)
        self.assertIn('kp_rev_ins', names, 'свои триггеры на месте')

    @staticmethod
    def _unzip(raw):
        import io
        import zipfile
        with zipfile.ZipFile(io.BytesIO(raw)) as box:
            return box.read([n for n in box.namelist() if n.endswith('.sqlite3')][0])

    def test_secret_destinations(self):
        """BE-003: адрес, куда уходит сохранённый ключ или пароль, меняет только право «Ключи и пароли»."""
        boss = self.login(*Stand.ADMIN)
        self.assertEqual(self.call(boss, 'POST', '/api/admin/mail', {'host': 'smtp.ok.ru', 'login': 'kp', 'password': 'pw'})[0], 200)
        rights = {'sections': {'mail': 'edit', 'services': 'edit', 'carriers': 'edit'}, 'actions': []}
        self.call(boss, 'POST', '/api/admin/users',
                  {'action': 'add', 'login': 'svc', 'name': 'Сервисы', 'password': 'pass1234', 'rights': rights})
        svc = self.login('svc', 'pass1234')
        self.assertEqual(self.call(svc, 'POST', '/api/admin/mail', {'host': 'smtp.ok.ru', 'fromName': 'КП'})[0], 200,
                         'тот же сервер — можно')
        st, body, _ = self.call(svc, 'POST', '/api/admin/mail', {'host': 'smtp.evil.example'})
        self.assertEqual(st, 403, body)
        self.assertEqual(self.call(svc, 'POST', '/api/admin/ai', {'model': 'deepseek-chat', 'base': ''})[0], 200)
        self.assertEqual(self.call(svc, 'POST', '/api/admin/ai', {'base': 'https://evil.example'})[0], 403)
        st, body, _ = self.call(svc, 'PUT', '/api/logistics/carriers',
                                {'cdek': {'on': True, 'urls': {'base': 'https://evil.example/v2'}}})
        self.assertEqual(st, 403, body)
        self.assertEqual(self.call(svc, 'PUT', '/api/logistics/carriers',
                                   {'cdek': {'on': False, 'urls': {'base': ''}}})[0], 200, 'включение — можно')
        # DB-002 (по ревью): вторая папка копий в другое место — копия базы со всеми ключами туда
        self.call(boss, 'POST', '/api/admin/users', {'action': 'add', 'login': 'bk', 'name': 'Копии', 'password': 'pass1234',
                                                     'rights': {'sections': {'backup': 'edit'}, 'actions': ['db']}})
        bk = self.login('bk', 'pass1234')
        st, body, _ = self.call(bk, 'POST', '/api/admin/maint/mirror', {'on': True, 'kind': 'folder', 'path': '\\\\evil\\share'})
        self.assertEqual(st, 403, body)
        self.assertEqual(self.call(bk, 'POST', '/api/admin/maint/mirror', {'on': False, 'kind': 'folder', 'path': '', 'keep': 5})[0],
                         200, 'то же место — можно')

    def test_skeleton_refused_on_server(self):
        boss = self.login(*Stand.ADMIN)
        rights = {'sections': {'templates': 'edit'}, 'actions': []}
        self.call(boss, 'POST', '/api/admin/users',
                  {'action': 'add', 'login': 'tpl', 'name': 'Шаблоны', 'password': 'pass1234', 'rights': rights})
        tpl = self.login('tpl', 'pass1234')
        st, body, _ = self.stand.http.req('PUT', '/api/templates/pnevmotekh/file?name=skeleton.js',
                                          'function kpSkeleton(KP){return {}}', cookie=tpl[0], headers=tpl[1])
        self.assertEqual(st, 403, body)
        self.assertIn('skeleton.js', body)
        st, body, _ = self.stand.http.req('PUT', '/api/templates/pnevmotekh/file?name=template.json&name=skeleton.js',
                                          'function kpSkeleton(KP){return {}}', cookie=tpl[0], headers=tpl[1])
        self.assertEqual(st, 403, 'повтор параметра: проверка прав и маршрут берут одно и то же значение')
        boss = self.login(*Stand.ADMIN)
        self.call(boss, 'POST', '/api/admin/users', {'action': 'add', 'login': 'chg', 'name': 'Файл', 'password': 'pass1234',
                                                     'rights': {'sections': {'changes': 'edit'}, 'actions': []}})
        chg = self.login('chg', 'pass1234')
        self.assertEqual(self.call(chg, 'GET', '/api/admin/settings-file?keys=0&keys=1')[0], 403, 'BE-002: повтор keys')


if __name__ == '__main__':
    unittest.main()
