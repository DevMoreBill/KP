# -*- coding: utf-8 -*-
"""Особые права менеджеров и каталог в админке (catalog_admin.py): «Удалять товары» (в корзину), «Правки без модерации»
(свои — сразу, чужие — принять / отклонить, в том числе по выбранным полям), «Выгрузка каталога» (Excel, JSON, XML, YML;
закупка — только администратору), корзина (удалить навсегда одну запись, «Очистить корзину» — только администратор).
Без входа по паролю особых прав нет ни у кого, кроме администратора."""
import io
import json
import unittest
import xml.etree.ElementTree as ET
import zipfile

from kit import Http, SampleData, Stand, TempStore


class UnitTest(unittest.TestCase):
    def test_fields_and_partial_merge(self):
        from catalog_admin import ModerationDesk
        st = TempStore(self).store
        before = {'id': 'p1', 'name': 'Старое', 'spec': 'было', 'attrs': {'cat': 'comp_screw', 'kw': 30, 'flow': 5}}
        st.catalog_put('p1', json.dumps(before, ensure_ascii=False))
        after = dict(before, name='Новое', spec='стало', attrs={'cat': 'comp_screw', 'kw': 37, 'flow': 5, 'pressure': 10})
        pid = st.pending_add('p1', 'update', json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False), 'u', 'Иванова')
        keys = [f['key'] for f in ModerationDesk.fields(before, after)]
        self.assertEqual(sorted(keys), ['attrs.kw', 'attrs.pressure', 'name', 'spec'], 'параметры — каждый своей строкой')
        # после отправки правки другой сотрудник поменял поле, которого правка не касается
        cur = dict(before, hint='свой титул')
        st.catalog_put('p1', json.dumps(cur, ensure_ascii=False))
        logs = []
        desk = ModerationDesk(st, 'админ', lambda *a, **k: logs.append(a))
        self.assertTrue(desk.items('pending')[0]['stale'])
        with self.assertRaises(ValueError):
            desk.review(pid, 'approve', '', ['нет-такого'])
        self.assertEqual(desk.review(pid, 'approve', '', ['name', 'attrs.kw']), {'ok': True})
        doc = json.loads(st.catalog_get('p1'))
        self.assertEqual((doc['name'], doc['spec'], doc['attrs']['kw'], doc['hint']), ('Новое', 'было', 37, 'свой титул'))
        self.assertNotIn('pressure', doc['attrs'], 'не отмеченный параметр не принят')
        p = st.pending_get(pid)
        self.assertEqual(p['status'], 'approved')
        self.assertIn('частично', p['reason'])
        self.assertEqual(logs[-1][0], 'approve_edit')
        self.assertEqual(desk.review(pid, 'approve', ''), {'ok': False, 'message': 'Правка уже рассмотрена'})

    def test_export_formats(self):
        from catalog_admin import CatalogExport
        st = TempStore(self).store
        data = SampleData(items=12, clients=1, kps=0)
        for x in data.items:
            st.catalog_put(x['id'], json.dumps(dict(x, rrc={'price': 100, 'cur': 'RUB'}, stock={'qty': 3}, photo={'src': '/img/a/b.jpg'}), ensure_ascii=False))
        ids = [x['id'] for x in data.items]
        ex = CatalogExport(st, None, 'http://srv:8080')
        opts = {'cols': ['cat', 'maker', 'model', 'spec'], 'params': ['kw'], 'price': True, 'rrc': True, 'cost': True, 'stock': True, 'images': 'links'}
        name, raw, ctype, info = ex.build(ids, dict(opts, fmt='json'), admin=False)
        d = json.loads(raw)
        self.assertEqual(len(d['items']), 12)
        self.assertTrue(name.endswith('.json'))
        self.assertFalse(any('cost' in x for x in d['items']), 'закупка — только администратору')
        self.assertFalse(info['cost'])
        x0 = d['items'][0]
        self.assertEqual(x0['images'], ['http://srv:8080/img/a/b.jpg'])
        self.assertEqual([p['key'] for p in x0['params']], ['kw'])
        _, raw, _, _ = ex.build(ids, dict(opts, fmt='json'), admin=True)
        self.assertTrue(all('cost' in x for x in json.loads(raw)['items']), 'администратор выгружает закупку')
        _, raw, _, _ = ex.build(ids, dict(opts, fmt='xml', params=['*']), admin=False)
        root = ET.fromstring(raw)
        self.assertEqual(len(root.findall('item')), 12)
        self.assertTrue(root.find('item/param') is not None)
        _, raw, _, _ = ex.build(ids, dict(opts, fmt='yml'), admin=False)
        y = ET.fromstring(raw)
        self.assertEqual(y.tag, 'yml_catalog')
        offers = y.findall('shop/offers/offer')
        self.assertEqual(len(offers), 12)
        self.assertEqual(offers[0].get('available'), 'true')
        self.assertTrue(offers[0].find('price') is not None and offers[0].find('categoryId') is not None)
        name, raw, ctype, _ = ex.build(ids, dict(opts, fmt='xlsx'), admin=False)
        from feed_xlsx import read_xlsx
        book = read_xlsx(raw)
        self.assertGreaterEqual(len(book), 2, 'лист на категорию')
        self.assertTrue(all(rows[0].get(0) == 'Наименование' for _, rows in book))
        self.assertEqual(sum(len(rows) - 1 for _, rows in book), 12)
        with self.assertRaises(ValueError):
            ex.build([], {'fmt': 'json'}, admin=True)

    def test_trash_drop_clear(self):
        from catalog_admin import TrashBin
        st = TempStore(self).store
        for i in range(3):
            st.catalog_put('t%d' % i, json.dumps({'id': 't%d' % i, 'name': 'П%d' % i}))
        st.trash_put_many('catalog', [('t0', 'П0'), ('t1', 'П1'), ('t2', 'П2')], 'тест')
        tb = TrashBin(st, lambda *a, **k: None)
        r = tb.items('catalog')
        self.assertEqual((len(r['items']), r['counts']), (3, {'catalog': 3}))
        tb.drop(r['items'][0]['id'])
        self.assertEqual(len(tb.items()['items']), 2)
        with self.assertRaises(ValueError):
            tb.drop(10 ** 6)
        self.assertEqual(tb.clear('kp'), 0)
        self.assertEqual(tb.clear(), 2)
        self.assertEqual(tb.items()['items'], [])


class ServerTest(unittest.TestCase):
    PW = {'m1': 'pass-m1-52', 'm2': 'pass-m2-52'}
    H = {'Content-Type': 'application/json'}

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=24, clients=3, kps=1)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def admin(self, method, path, body=None):
        st, b, hd = self.http.req(method, path, body, cookie=self.adm, headers=dict(self.A, **self.H))
        return st, (Http.js(b) if st == 200 else b)

    def login(self, lg):
        st, b, hd = self.http.req('POST', '/api/auth/login', {'login': lg, 'password': self.PW[lg]})
        self.assertEqual(st, 200, b)
        return Http.cookie(hd)

    def test_1_without_login_only_admin(self):
        """Вход по паролю выключен: особые права есть только у администратора."""
        h = dict(self.H, **Stand.as_manager(self.M1))
        st, b, _ = self.http.req('POST', '/api/catalog/trash', {'ids': ['tst-0000']}, headers=h)
        self.assertEqual(st, 403, b)
        self.assertEqual(self.http.req('POST', '/api/catalog/export', {'ids': ['tst-0000']}, headers=h)[0], 403)
        self.assertEqual(self.http.req('GET', '/api/catalog/moderation', headers=h)[0], 403)
        st, r = self.admin('POST', '/api/catalog/trash', {'ids': ['tst-0000', 'нет-такой']})
        self.assertEqual((st, r['deleted']), (200, 1))
        st, r = self.admin('GET', '/api/admin/trash?type=catalog')
        self.assertEqual([x['entityId'] for x in r['items']], ['tst-0000'])
        st, _ = self.admin('POST', '/api/admin/trash/%d/restore' % r['items'][0]['id'], {})
        self.assertEqual(st, 200)
        # без CSRF администратор тоже не удаляет
        st, b, _ = self.http.req('POST', '/api/catalog/trash', {'ids': ['tst-0001']}, cookie=self.adm, headers=self.H)
        self.assertEqual(st, 403)

    def test_2_powers_with_login(self):
        for mgr, lg, perms in ((self.M1, 'm1', {'catDelete': True, 'catSelfMod': True, 'export': True}), (self.M2, 'm2', {})):
            st, b = self.admin('POST', '/api/admin/access/' + mgr[0], {'login': lg, 'password': self.PW[lg], 'perms': perms})
            self.assertEqual(st, 200, b)
            self.assertEqual(b['perms'].get('catDelete', False), bool(perms))
        self.assertEqual(self.admin('POST', '/api/admin/access', {'enabled': True})[0], 200)
        self.assertEqual(self.admin('POST', '/api/admin/moderation', {'enabled': True})[0], 200)
        c1, c2 = self.login('m1'), self.login('m2')
        try:
            # удалять товары
            self.assertEqual(self.http.req('POST', '/api/catalog/trash', {'ids': ['tst-0002']}, cookie=c2, headers=self.H)[0], 403)
            st, b, _ = self.http.req('POST', '/api/catalog/trash', {'ids': ['tst-0002']}, cookie=c1, headers=self.H)
            self.assertEqual((st, Http.js(b)['deleted']), (200, 1))
            # восстанавливает и чистит корзину только администратор
            self.assertEqual(self.http.req('POST', '/api/admin/trash/clear', {}, cookie=c1, headers=self.H)[0], 401)
            # правки: m2 — на модерацию, m1 — сразу
            doc = Http.js(self.http.req('GET', '/api/catalog/tst-0003', cookie=c2)[1])
            doc.pop('_rev', None)
            new = dict(doc, name='Правка m2', spec='новое описание', attrs=dict(doc['attrs'], kw=99))
            st, b, _ = self.http.req('PUT', '/api/catalog/tst-0003', new, cookie=c2, headers=self.H)
            self.assertTrue(Http.js(b).get('pending'), b)
            doc4 = Http.js(self.http.req('GET', '/api/catalog/tst-0004', cookie=c1)[1])
            doc4.pop('_rev', None)
            st, b, _ = self.http.req('PUT', '/api/catalog/tst-0004', dict(doc4, name='Сразу m1'), cookie=c1, headers=self.H)
            self.assertEqual(st, 200)
            self.assertFalse(Http.js(b).get('pending'), 'у m1 «Правки без модерации»')
            # m1 видит очередь и принимает только название
            self.assertEqual(self.http.req('GET', '/api/catalog/moderation', cookie=c2)[0], 403)
            q = Http.js(self.http.req('GET', '/api/catalog/moderation', cookie=c1)[1])['pending']
            pid = next(p['id'] for p in q if p['productId'] == 'tst-0003')
            v = Http.js(self.http.req('GET', '/api/catalog/moderation/%d' % pid, cookie=c1)[1])
            self.assertIn('attrs.kw', [f['key'] for f in v['diff']])
            self.assertEqual(v['afterDoc']['name'], 'Правка m2')
            st, b, _ = self.http.req('POST', '/api/catalog/moderation/%d/reject' % pid, {}, cookie=c1, headers=self.H)
            self.assertEqual(st, 400, 'отклонение — с причиной')
            st, b, _ = self.http.req('POST', '/api/catalog/moderation/%d/approve' % pid, {'fields': ['name']}, cookie=c1, headers=self.H)
            self.assertEqual(st, 200, b)
            cur = Http.js(self.http.req('GET', '/api/catalog/tst-0003', cookie=c1)[1])
            self.assertEqual(cur['name'], 'Правка m2')
            self.assertNotEqual(cur['attrs'].get('kw'), 99, 'не отмеченное поле не принято')
            # выгрузка: m2 — нет, m1 — без закупки
            self.assertEqual(self.http.req('POST', '/api/catalog/export', {'ids': ['tst-0005'], 'fmt': 'json'}, cookie=c2, headers=self.H)[0], 403)
            st, b, hd = self.http.req('POST', '/api/catalog/export', {'ids': ['tst-0005', 'tst-0006'], 'fmt': 'json', 'cost': True, 'price': True},
                                      cookie=c1, headers=self.H)
            self.assertEqual(st, 200, b)
            items = json.loads(b)['items']
            self.assertEqual(len(items), 2)
            self.assertTrue(all('price' in x and 'cost' not in x for x in items))
            self.assertIn('attachment', hd.get('Content-Disposition', ''))
            st, b, hd = self.http.req('POST', '/api/catalog/export', {'ids': ['tst-0005'], 'fmt': 'xlsx', 'images': 'files'}, cookie=c1, headers=self.H, raw=True)
            self.assertEqual(st, 200)
            names = zipfile.ZipFile(io.BytesIO(b)).namelist()
            self.assertTrue(any(n.endswith('.xlsx') for n in names), names)
            # клиенты: m2 — нет, m1 — Excel
            self.assertEqual(self.http.req('POST', '/api/clients/export', {'fmt': 'xlsx'}, cookie=c2, headers=self.H)[0], 403)
            st, b, hd = self.http.req('POST', '/api/clients/export', {'fmt': 'xlsx'}, cookie=c1, headers=self.H, raw=True)
            self.assertEqual(st, 200)
            from feed_xlsx import read_xlsx
            self.assertEqual(len(read_xlsx(b)[0][1]), 4, 'шапка и 3 клиента')
        finally:
            self.admin('POST', '/api/admin/moderation', {'enabled': False, 'pending': 'reject'})
            self.admin('POST', '/api/admin/access', {'enabled': False})
        # журнал действий: выгрузка и удаление записаны
        st, r = self.admin('GET', '/api/admin/audit?action=export_catalog')
        self.assertGreaterEqual(r['total'], 1)
        # администратор: удалить навсегда одну запись и очистить корзину
        st, r = self.admin('GET', '/api/admin/trash')
        self.assertTrue(r['items'])
        self.assertEqual(self.admin('POST', '/api/admin/trash/%d/purge' % r['items'][0]['id'], {})[0], 200)
        st, r = self.admin('POST', '/api/admin/trash/clear', {})
        self.assertEqual(st, 200)
        self.assertEqual(self.admin('GET', '/api/admin/trash')[1]['items'], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
