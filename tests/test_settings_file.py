# -*- coding: utf-8 -*-
"""«Все настройки в файл» (data_bundle.SettingsFile): без ключей API — ни ключей, ни пароля почты; «с ключами API» —
ключи есть, пароль почты — никогда; загрузка — предпросмотр по разделам, выбранные разделы, свои секреты сохраняются,
права менеджеров — только тем, кто есть в базе; маршрут — только администратору."""
import json
import unittest

from kit import Http, Stand, TempStore


def fill(st):
    st.kv_set('settings', {'defaults': {'kp.city': {'on': True, 'v': 'Казань'}}, 'ai': {'enabled': True, 'key': 'sk-секрет-ии', 'model': 'm'}})
    st.kv_set('mail', {'host': 'smtp.example.ru', 'login': 'kp@example.ru', 'password': 'пароль-почты'})
    st.kv_set('integrations', {'checko': 'ключ-checko'})
    st.kv_set('uitexts', {'a.b': 'Своя надпись'})
    st.kv_set('update', {'repo': 'x/y', 'nightly': 'on', 'history': [{'v': '1'}]})
    st.kv_set('mgrAccess', {'m1': {'login': 'm1', 'pw': {'h': 'хеш'}, 'perms': {'catDelete': True}}})


class UnitTest(unittest.TestCase):
    def test_export_secrets(self):
        from data_bundle import SettingsFile
        st = TempStore(self).store
        fill(st)
        name, raw = SettingsFile(st).export(False)
        text = raw.decode('utf-8')
        self.assertTrue(name.endswith('.json'))
        for secret in ('sk-секрет-ии', 'пароль-почты', 'ключ-checko', 'хеш', '"pw"', 'history'):
            self.assertNotIn(secret, text)
        d = json.loads(text)
        self.assertEqual(d['format'], 'kp-settings')
        self.assertEqual(d['sections']['access']['m1']['perms']['catDelete'], True)
        self.assertEqual(d['sections']['update'], {'repo': 'x/y', 'nightly': 'on'})
        _, raw = SettingsFile(st).export(True)
        text = raw.decode('utf-8')
        self.assertIn('sk-секрет-ии', text)
        self.assertIn('ключ-checko', text)
        self.assertNotIn('пароль-почты', text, 'пароли — никогда')

    def test_import_keeps_own_secrets(self):
        from data_bundle import SettingsFile
        src = TempStore(self).store
        fill(src)
        _, raw = SettingsFile(src).export(False)
        dst = TempStore(self).store
        dst.kv_set('settings', {'ai': {'key': 'свой-ключ'}})
        dst.kv_set('mail', {'host': 'old', 'password': 'свой-пароль'})
        dst.kv_set('mgrAccess', {'m2': {'login': 'm2', 'perms': {}}})
        p = SettingsFile(dst).preview(raw)
        keys = {x['key']: x['same'] for x in p['sections']}
        self.assertFalse(keys['mail'])
        self.assertNotIn('integrations', keys)
        r = SettingsFile(dst).apply(raw, ['settings', 'mail', 'access'])
        self.assertEqual(len(r['applied']), 3, r)
        self.assertEqual(dst.kv_get('settings')['ai']['key'], 'свой-ключ', 'ключа в файле нет — остаётся свой')
        self.assertEqual(dst.kv_get('settings')['defaults']['kp.city']['v'], 'Казань')
        self.assertEqual(dst.kv_get('mail'), {'host': 'smtp.example.ru', 'login': 'kp@example.ru', 'password': 'свой-пароль'})
        self.assertNotIn('m1', dst.kv_get('mgrAccess'), 'чужой менеджер не создаётся')
        self.assertIsNone(dst.kv_get('uitexts'), 'не выбранный раздел не тронут')
        with self.assertRaises(ValueError):
            SettingsFile(dst).preview(b'{"format": "other"}')


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand().start()
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_admin_only(self):
        http = self.stand.http
        self.assertEqual(http.req('GET', '/api/admin/settings-file')[0], 401)
        st, b, hd = http.req('GET', '/api/admin/settings-file?keys=1', cookie=self.adm, headers=self.A)
        self.assertEqual(st, 200)
        self.assertIn('attachment', hd.get('Content-Disposition', ''))
        st, b2, _ = http.req('POST', '/api/admin/settings-file/preview', b.encode('utf-8'), cookie=self.adm, headers=self.A)
        self.assertEqual(st, 200, b2)
        st, b3, _ = http.req('POST', '/api/admin/settings-file', b.encode('utf-8'), cookie=self.adm)
        self.assertEqual(st, 401, 'без CSRF — нет')
        st, b3, _ = http.req('POST', '/api/admin/settings-file?sections=settings', b.encode('utf-8'), cookie=self.adm, headers=self.A)
        self.assertEqual(st, 200, b3)
        self.assertIsInstance(Http.js(b3)['applied'], list)


if __name__ == '__main__':
    unittest.main(verbosity=2)
