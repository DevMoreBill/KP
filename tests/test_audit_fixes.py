# -*- coding: utf-8 -*-
"""Исправления аудита 3.96: NaN/Infinity в запросах, откат только последней миграции, история настроек не портит коды
полей, пределы груза доставки, КП из корзины, автор КП, поля карточки менеджера, заготовки без экономики, испорченное
описание КП, имя сервера отдела (подмена DNS), архивы во вложениях, особые ставки пошлины и разбор чисел фида."""
import io
import json
import os
import sys
import unittest
import zipfile

from kit import Http, SampleData, Stand, TempStore

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=6, clients=2, kps=2)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None, admin=False, raw=False):
        h = {'Content-Type': 'application/json'}
        if admin:
            h.update(self.A)
        data = body if raw else (json.dumps(body) if body is not None else None)
        return self.http.req(method, path, data, cookie=self.adm if admin else None, headers=h)

    def test_01_non_finite_numbers_refused(self):
        for raw in ('{"name":"x","attrs":{"noise":NaN}}', '{"sum":Infinity}', '{"a":-Infinity}'):
            st, b, _ = self.req('PUT', '/api/catalog/tst-nan', raw, raw=True)
            self.assertEqual(st, 400, (raw, b))
        st, b, _ = self.req('PUT', '/api/catalog/tst-nan', '{"name":"NaN Infinity в тексте","kind":"option"}', raw=True)
        self.assertEqual(st, 200, 'слова NaN и Infinity в строке — можно')

    def test_02_delivery_cargo_limits(self):
        place = {'l': 1, 'w': 1, 'h': 1, 'm': 0.5}
        for qty in (10 ** 9, 1001, -1, 1.5):
            st, b, _ = self.req('POST', '/api/logistics/quote', {'from': {}, 'to': {}, 'places': [dict(place, qty=qty)]})
            self.assertEqual(st, 400, (qty, b))
        st, b, _ = self.req('POST', '/api/logistics/quote', {'from': {}, 'to': {}, 'places': [dict(place, l=40, qty=1)]})
        self.assertEqual(st, 400, 'место длиннее 30 м')

    def test_03_manager_card_fields(self):
        mid = self.M1[0]
        st, b, _ = self.req('PUT', '/api/managers/' + mid, {'name': self.M1[1], 'evil': 'x', 'perms': {'a': 1}})
        self.assertEqual(st, 200, b)
        doc = Http.js(b)
        self.assertNotIn('evil', doc)
        self.assertNotIn('perms', doc)
        st, b, _ = self.req('PUT', '/api/managers/' + mid, {'name': self.M1[1], 'position': 'x' * 5000})
        self.assertEqual(st, 422, b)

    def test_04_kp_in_trash_closed(self):
        kid = Http.js(self.req('POST', '/api/kp/new')[1])['id']
        self.assertEqual(self.req('PUT', '/api/kp/%s/meta' % kid, {'number': kid, 'client': 'Клиент'})[0], 200)
        self.assertEqual(self.req('POST', '/api/admin/delete', {'type': 'kp', 'ids': [kid]}, admin=True)[0], 200)
        self.assertEqual(self.req('PUT', '/api/kp/%s/state' % kid, {'items': []})[0], 403, 'КП в корзине не перезаписать')
        self.assertEqual(self.req('GET', '/api/kp/%s/versions' % kid)[0], 403)
        nxt = Http.js(self.req('POST', '/api/kp/new')[1])['id']
        self.assertNotEqual(nxt, kid, 'номер КП из корзины не выдаётся заново')

    def test_05_preset_without_deal(self):
        st, b, _ = self.req('PUT', '/api/presets/p1audit', {'title': 'Заготовка', 'state': {'items': [], 'deal': {'sup': [1]}, 'client': 'ООО'}})
        self.assertEqual(st, 200, b)
        st, b, _ = self.req('GET', '/api/presets/p1audit')
        state = Http.js(b)['data']['state']
        self.assertNotIn('deal', state)
        self.assertNotIn('client', state)

    def test_05b_draft_without_owner(self):
        def put(uid):
            h = {'Content-Type': 'application/json', 'X-KP-User-Id': uid, 'X-KP-User': uid}
            return self.http.req('PUT', '/api/drafts/dnoowner1', json.dumps({'state': {'items': [], 'client': 'ООО'}}), headers=h)
        self.assertEqual(put('')[0], 200)
        st, b, _ = put(self.M1[0])
        self.assertEqual(st, 200, 'черновик без автора — того, кто его сохраняет')
        self.assertEqual(Http.js(b)['row']['owner'], self.M1[0])
        self.assertEqual(put(self.M2[0])[0], 403, 'а дальше — только автора')

    def test_06_migration_down_only_last(self):
        st, b, _ = self.req('GET', '/api/admin/migrations', admin=True)
        mg = Http.js(b)
        first = mg['applied'][0]
        self.assertNotEqual(first, mg['last'])
        st, b, _ = self.req('POST', '/api/admin/migrations/%s/down' % first, {}, admin=True)
        self.assertEqual(st, 400, b)

    def test_07_customs_and_types_bad_input(self):
        self.assertEqual(self.req('PUT', '/api/customs', {'key': [1]})[0], 400)
        self.assertIn(self.req('PUT', '/api/types', {'types': 5})[0], (400, 403))

    def test_08_types_patterns(self):
        """FE-002: шаблон категории с повтором внутри повтора «вешает» браузер у всех — сервер его не сохраняет."""
        from equipment_types import TypePatterns, load_types_builtin
        TypePatterns.check(load_types_builtin(), [])
        bad = {'add': [{'id': 'evil', 'name': 'Злая', 'match': '(a+)+$', 'fields': []}]}
        status, body = self.req('PUT', '/api/types', bad)[:2]
        self.assertIn(status, (400, 403))
        if status == 400:
            self.assertIn('повтор', body)
        with self.assertRaises(ValueError):
            TypePatterns.check([{'id': 'x', 'fields': [{'key': 'p', 'find': '(\\w+\\s?)+$'}]}], [])
        TypePatterns.check([{'id': 'x', 'match': 'винтов\\S*\\s+компрессор', 'fields': []}], [])


class UnitTest(unittest.TestCase):
    def test_settings_history_keeps_field_keys(self):
        from settings_history import SettingsHistory
        snap = SettingsHistory._clean({'types': [{'id': 'x', 'fields': [{'key': 'flow'}]}], 'ai': {'key': 'sk-123', 'model': 'm'},
                                       'mail': {'password': 'p'}})
        self.assertEqual(snap['types'][0]['fields'][0]['key'], 'flow')
        self.assertEqual(snap['ai']['key'], '•••')
        self.assertEqual(snap['mail']['password'], '•••')

    def test_migration_down_refuses_middle(self):
        ts = TempStore(self)
        from storage import MIGRATIONS
        with self.assertRaises(ValueError):
            ts.store.migration_down(MIGRATIONS[0][0])
        ts.store.migration_down(ts.store.migration_last())

    def test_kp_all_meta_skips_broken(self):
        ts = TempStore(self)
        ts.store.write("INSERT INTO kp (id, number, meta) VALUES ('b1', 'b1', 'не JSON')")
        ts.store.write("INSERT INTO kp (id, number, meta) VALUES ('b2', 'b2', '{\"number\":\"b2\"}')")
        self.assertEqual([m['number'] for m in ts.store.kp_all_meta()], ['b2'])

    def test_server_names(self):
        from kp_server import Handler
        for name in ('192.168.1.10', 'server', 'kp.local', 'srv.lan', '::1'):
            self.assertTrue(Handler.lan_name(name), name)
        for name in ('evil-rebind.example', 'kp.example.ru'):
            self.assertFalse(Handler.lan_name(name), name)

    def test_zip_attachments(self):
        from kp_files import KpFiles

        def z(files):
            b = io.BytesIO()
            with zipfile.ZipFile(b, 'w') as zf:
                for n, d in files.items():
                    zf.writestr(n, d)
            return b.getvalue()
        inner = z({'run.exe': b'MZ'})
        for files in ({'evil.exe.': b'x'}, {'evil.exe ': b'x'}, {'a.zip': inner}, {'b.7z': b'x'}, {'m.docm': b'x'}):
            self.assertTrue(KpFiles._zip_bad(z(files)), files.keys())
        self.assertFalse(KpFiles._zip_bad(z({'passport.pdf': b'%PDF', 'docs.zip': z({'a.pdf': b'%PDF'})})))

    def test_feed_numbers_finite(self):
        import feeds
        self.assertIsNone(feeds.parse_number('nan'))
        self.assertIsNone(feeds.parse_number('inf'))
        self.assertEqual(feeds.parse_number('1 234,5'), 1234.5)

    def test_gzip_build_once(self):
        import threading
        from kp_server import GzipCache
        c, built = GzipCache(3, 1), []

        def get():
            with c.building('t'):
                if c.get('t') is None:
                    built.append(1)
                    c.put('t', b'x' * 5000)
        th = [threading.Thread(target=get) for _ in range(8)]
        [t.start() for t in th]
        [t.join() for t in th]
        self.assertEqual(len(built), 1, 'новая версия собирается один раз')
        for i in range(10):
            c.building('k%d' % i)
        self.assertLessEqual(len(c.locks), 3)

    def test_feed_counts(self):
        import feeds
        ts = TempStore(self)
        for i, fid in enumerate(('remeza', 'remeza', 'dali')):
            ts.store.catalog_put('f%d' % i, json.dumps({'id': 'f%d' % i, 'name': 'x', 'feed': {'id': fid}}))
        ts.store.catalog_put('n', json.dumps({'id': 'n', 'name': 'без фида'}))
        self.assertEqual(feeds._feed_counts(ts.store), {'remeza': 2, 'dali': 1})

    def test_non_finite_body(self):
        from kp_server import Handler
        self.assertTrue(Handler.non_finite(b'{"a":NaN}'))
        self.assertFalse(Handler.non_finite(b'{"a":"NaN"}'))
        self.assertFalse(Handler.non_finite(b'PK\x03\x04 NaN binary'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
