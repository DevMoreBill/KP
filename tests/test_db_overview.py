# -*- coding: utf-8 -*-
"""Сводка вкладки «База и копии» (admin_overview.DbOverview, /api/admin/maint/overview): размер базы, место на диске,
записей в разделах, последняя автокопия с отметкой «давно», вторая папка; только для администратора."""
import unittest

from kit import Http, Stand, TempStore


class OverviewTest(unittest.TestCase):
    def test_counts_and_stale(self):
        t = TempStore(self)
        st = t.store
        import os
        from admin_overview import DbOverview
        o = DbOverview(st, os.path.dirname(st.path)).get()
        self.assertEqual(o['counts']['catalog'], st.catalog_count())
        self.assertEqual(set(o['counts']), set(DbOverview.COUNTS))
        self.assertTrue(o['stale'], 'копий ещё не было — «давно»')
        self.assertFalse(o['mirror']['on'])
        self.assertIn('free', o['disk'])
        import maintenance
        maintenance.DbCopy.daily(st, os.path.dirname(st.path), force=True)
        o = DbOverview(st, os.path.dirname(st.path)).get()
        self.assertTrue(o['backup']['ok'])
        self.assertFalse(o['stale'], 'свежая копия')
        self.assertEqual(o['copies'], 1)


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand('server')
        cls.stand.start()
        cls.h = cls.stand.http

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_route(self):
        adm, A = self.stand.admin()
        st, b, _ = self.h.req('GET', '/api/admin/maint/overview', cookie=adm, headers=A)
        self.assertEqual(st, 200, b)
        d = Http.js(b)
        for k in ('dbBytes', 'disk', 'counts', 'backup', 'mirror', 'stale', 'copies'):
            self.assertIn(k, d)
        self.assertGreater(d['dbBytes'], 0)
        st, b, _ = self.h.req('GET', '/api/admin/maint/overview')
        self.assertIn(st, (401, 403), 'без входа администратора — нельзя')
        self.assertEqual(self.stand.request_errors(), [])


if __name__ == '__main__':
    unittest.main()
