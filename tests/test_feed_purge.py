# -*- coding: utf-8 -*-
"""Удаление позиций, загруженных фидом (feeds.FeedPurge, «Настройки → Фиды поставщиков → Удалить позиции фида…»):
предпросмотр по категориям фида, перенос в корзину одной транзакцией (с восстановлением), «не загружать снова» —
фид запоминает удалённые предложения, «Вернуть в загрузку» снимает запрет; маршрут — только администратору."""
import json
import os
import sys
import unittest

from kit import Http, Stand, TempStore

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))


def fill(store):
    store.kv_set('feeds', {'items': [{'id': 'fx', 'kind': 'yml', 'name': 'Тестовый фид', 'url': 'https://example.ru/feed.xml'}]})
    for i in range(5):
        cat = 'c1' if i < 3 else 'c2'
        store.catalog_put('fx-%d' % i, json.dumps({'id': 'fx-%d' % i, 'name': 'Позиция %d' % i,
                                                   'feed': {'id': 'fx', 'oid': 'o%d' % i, 'cat': cat, 'path': 'Раздел ' + cat}}))
    store.catalog_put('own', json.dumps({'id': 'own', 'name': 'Своя позиция'}))


class UnitTest(unittest.TestCase):
    def test_purge_category_block_unblock(self):
        import feeds
        st = TempStore(self).store
        fill(st)
        f = feeds.feed_get(st, 'fx')
        p = feeds.FeedPurge.preview(st, f)
        self.assertEqual((p['total'], p['picked']), (5, 5))
        self.assertEqual([(c['cat'], c['n']) for c in p['cats']], [('c1', 3), ('c2', 2)])
        self.assertEqual(feeds.FeedPurge.preview(st, f, 'c2')['picked'], 2)
        r = feeds.FeedPurge.run(st, f, 'c1', True, 'тест')
        self.assertEqual(r, {'deleted': 3, 'blocked': 3})
        left = sorted(json.loads(st.catalog_light()), key=lambda x: x['id'])
        self.assertEqual([x['id'] for x in left], ['fx-3', 'fx-4', 'own'], 'своя позиция и другая категория не тронуты')
        self.assertEqual(len(st.trash_list()), 3)
        self.assertEqual(sorted(feeds.feed_get(st, 'fx')['excluded']), ['o0', 'o1', 'o2'])
        self.assertEqual(feeds.status(st)[0]['excluded'], 3, 'в списке фидов — только число')
        etype, eid = st.trash_restore(st.trash_list()[0]['id'])        # восстановление из корзины
        self.assertEqual(etype, 'catalog')
        self.assertTrue(st.catalog_get(eid))
        self.assertEqual(feeds.FeedPurge.unblock(st, 'fx'), 3)
        self.assertFalse(feeds.feed_get(st, 'fx').get('excluded'))
        r = feeds.FeedPurge.run(st, feeds.feed_get(st, 'fx'), '', False, 'тест')
        self.assertEqual((r['deleted'], r['blocked']), (3, 0), 'без «не загружать снова» — запрета нет')
        self.assertFalse(feeds.feed_get(st, 'fx').get('excluded'))


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand().start()
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_admin_only(self):
        import storage
        fill(storage.Store(self.stand.db))
        h = {'Content-Type': 'application/json'}
        st, b, _ = self.stand.http.req('POST', '/api/admin/feeds/fx/purge', json.dumps({'cat': ''}), headers=h)
        self.assertIn(st, (401, 403), 'менеджер не удаляет')
        st, b, _ = self.stand.http.req('POST', '/api/admin/feeds/fx/purge', json.dumps({'preview': True}), cookie=self.adm, headers=dict(h, **self.A))
        self.assertEqual(Http.js(b)['total'], 5)
        st, b, _ = self.stand.http.req('POST', '/api/admin/feeds/fx/purge', json.dumps({'cat': 'c2'}), cookie=self.adm, headers=dict(h, **self.A))
        self.assertEqual(Http.js(b)['deleted'], 2)
        st, b, _ = self.stand.http.req('POST', '/api/admin/feeds/fx/unblock', '{}', cookie=self.adm, headers=dict(h, **self.A))
        self.assertEqual(Http.js(b)['unblocked'], 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
