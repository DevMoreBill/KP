# -*- coding: utf-8 -*-
"""Доработки 18.10 (пункты 1–17 по решению владельца): новая категория не стирает категорию коллеги, загрузка файла
выгрузки с повтором менеджера внутри файла, сумма сделки после корзины, журнал КП — разбор один раз на версию, отчёт за
период, запись пачками, поиск сделок, проверка «здоровья» базы, образец ИИ по категории."""
import json
import os
import sys
import unittest

from kit import SampleData, Stand, TempStore

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=8, clients=3, kps=3)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None, admin=False):
        h = {'Content-Type': 'application/json', 'X-KP-User-Id': SampleData.MANAGERS[0][0]}
        if admin:
            h.update(self.A)
        return self.http.req(method, path, json.dumps(body) if body is not None else None, cookie=self.adm if admin else None, headers=h)

    def test_types_add_keeps_others(self):
        base = {'fields': [{'key': 'kw', 'label': 'Мощность', 'num': True}], 'group': 'Тест', 'item': 'x', 'options': []}
        st, b, _ = self.req('PUT', '/api/types', {'version': 1, 'add': [dict(base, id='ua1', name='Категория A')]})
        self.assertEqual(st, 200, b[:200])
        st, b, _ = self.req('PUT', '/api/types', {'version': 1, 'add': [dict(base, id='ub2', name='Категория B')]})
        self.assertEqual(st, 200, b[:200])
        ids = {t['id'] for t in json.loads(b)['types']}
        self.assertTrue({'ua1', 'ub2'} <= ids, 'вторая новая категория не стёрла первую')

    def test_import_dup_managers_in_file(self):
        doc = {'format': 'kp-backup', 'version': 1, 'sections': {'managers': [
            {'id': 'mx1', 'name': 'Петров Пётр', 'email': 'same@example.com'},
            {'id': 'mx2', 'name': 'Сидоров Сидор', 'email': 'same@example.com'}]}}
        h = dict(self.A, **{'Content-Type': 'application/octet-stream'})
        st, b, _ = self.http.req('POST', '/api/admin/import/file?name=x.json', json.dumps(doc).encode('utf-8'), cookie=self.adm, headers=h)
        self.assertEqual(st, 200, b[:300])
        r = json.loads(b)
        self.assertEqual(r['report']['managers']['new'], 1)
        self.assertTrue(any('повторяется в файле' in e for e in r['errors']), r['errors'])

    def test_crm_find(self):
        st, b, _ = self.req('POST', '/api/crm/deal', {'client': 'ООО «Поиск»', 'title': 'Компрессорная для цеха'})
        if st == 403:
            self.skipTest('кабинет выключен на стенде')
        self.assertEqual(st, 200, b[:200])
        import urllib.parse
        st, b, _ = self.req('GET', '/api/crm/find?q=' + urllib.parse.quote('цеха'))
        self.assertEqual(st, 200)
        self.assertTrue(any('цеха' in d['title'] for d in json.loads(b)['items']))

    def test_health(self):
        st, b, _ = self.req('POST', '/api/admin/maint/health', {}, admin=True)
        self.assertEqual(st, 200, b[:200])
        r = json.loads(b)
        self.assertEqual(r['integrity'], 'ok')
        st, b, _ = self.req('GET', '/api/admin/maint/health', admin=True)
        self.assertEqual(json.loads(b)['at'], r['at'])


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def test_journal_rev_trigger(self):
        st = self.st
        r0 = st.data_rev('kpj')
        st.kp_set('2026-001', 'meta', json.dumps({'kpId': '2026-001', 'number': '2026-001', 'date': '2026-10-01'}))
        r1 = st.data_rev('kpj')
        self.assertNotEqual(r0, r1)
        st.kp_track_set('2026-001', {'status': 'sent'})
        self.assertNotEqual(st.data_rev('kpj'), r1, 'ход сделки тоже меняет версию журнала')

    def test_report_period_and_states(self):
        st = self.st
        for kid, d in (('2026-001', '2026-09-01'), ('2026-002', '2026-10-05')):
            st.kp_set(kid, 'state', json.dumps({'items': [{'name': kid}]}))
            st.kp_set(kid, 'meta', json.dumps({'kpId': kid, 'number': kid, 'date': d}))
        rows = st.kp_metas_where('', '', '', '', '2026-10-01', '2026-10-31')
        self.assertEqual([json.loads(m)['kpId'] for m in rows], ['2026-002'])
        self.assertEqual(set(st.kp_states(['2026-001', '2026-002'])), {'2026-001', '2026-002'})

    def test_write_batch(self):
        from storage import WriteBatch
        st = self.st
        with WriteBatch(st, 3) as b:
            for i in range(7):
                st.catalog_stage('w%d' % i, json.dumps({'name': 'W%d' % i}))
                b.step()
        self.assertEqual(st.catalog_count(), 7)
        self.assertFalse(st.conn().in_transaction)
        with self.assertRaises(ZeroDivisionError):
            with WriteBatch(st, 100):
                st.catalog_stage('w9', json.dumps({'name': 'W9'}))
                1 / 0
        self.assertIsNone(st.catalog_get('w9'), 'сбой — пачка откатывается')

    def test_deal_sum_after_trash(self):
        from crm import DealBook
        st = self.st
        db = DealBook(st)
        for kid, s in (('2026-010', 100000), ('2026-011', 500000)):
            st.kp_set(kid, 'state', '{}')
            st.kp_set(kid, 'meta', json.dumps({'kpId': kid, 'number': kid, 'date': '2026-10-0%s' % kid[-1], 'savedAt': '2026-10-0%sT10:00:00' % kid[-1],
                                               'client': 'К', 'sum': s, 'managerId': 'm1'}))
        did = db.on_kp('2026-010', st.kp_get('2026-010', 'meta'), 'тест')
        db.link(did, '2026-011', 'тест')
        db.refresh('2026-011', 'тест')
        self.assertEqual(db.get(did)['sum'], 500000, 'до корзины — последнее КП')
        st.trash_put('kp', '2026-011', '2026-011', 'тест')
        DealBook.kp_moved(st, '2026-011', 'тест')
        self.assertEqual(db.get(did)['sum'], 100000)

    def test_health_unit(self):
        from db_health import DbHealth
        st = self.st
        st.catalog_put('a', json.dumps({'name': 'Компрессор X 7,5/8', 'attrs': {'cat': 'comp_screw'}}))
        st.catalog_put('b', json.dumps({'name': 'Компрессор X 75/8', 'attrs': {'cat': 'comp_screw'}}))
        st.catalog_put('c', json.dumps({'name': 'компрессор  x-7,5/8', 'attrs': {'cat': 'comp_screw'}}))
        st.catalog_put('d', json.dumps({'name': 'Без категории', 'attrs': {'cat': 'nope_cat'}}))
        r = DbHealth(st).run()
        self.assertEqual(r['dups']['groups'], 1, '«7,5/8» и «75/8» — разные, регистр и пробелы — нет')
        self.assertEqual(r['noCat']['n'], 1)
        self.assertTrue(DbHealth(st).attention())


if __name__ == '__main__':
    unittest.main(verbosity=2)
