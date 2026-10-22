# -*- coding: utf-8 -*-
"""«Сообщить о проблеме» (app/feedback.py, /api/feedback, /api/admin/feedback): проверка ввода, контекст без лишних полей,
«Требует внимания», «Прочитано» — только администратор. Быстрые отборы журнала КП (без ответа, истекают). Вымышленные данные."""
import unittest
from datetime import date, timedelta

from kit import Http, SampleData, Stand, TempStore


class FeedbackTest(unittest.TestCase):
    def test_add_and_done(self):
        from feedback import Feedback
        book = Feedback(TempStore(self).store)
        with self.assertRaises(ValueError):
            book.add({'text': '  '}, 'Иванова')
        with self.assertRaises(ValueError):
            book.add('текст', 'Иванова')
        row = book.add({'text': 'Не нажимается «Сохранить»', 'ctx': {
            'where': 'Кабинет', 'screen': '430×932', 'secret': 'x', 'errors': ['a\n b'] * 15}}, 'Иванова')
        self.assertEqual((row['id'], row['done']), (1, False))
        self.assertNotIn('secret', row['ctx'])
        self.assertEqual((len(row['ctx']['errors']), row['ctx']['errors'][0]), (10, 'a b'))
        self.assertEqual(book.add({'text': 'Ещё'}, 'Петров')['id'], 2)
        self.assertTrue(book.done(1))
        self.assertFalse(book.done(99))
        self.assertEqual([row['id'] for row in book.new()], [2])


class InboxTest(unittest.TestCase):
    """«Главная» «Настроек»: у пункта — действие для кнопки в строке; сбой фида — «Повторить»."""

    def test_feed_failure_and_actions(self):
        import admin_overview
        store = TempStore(self).store
        store.kv_set('feeds', {'items': [{'id': 'f1', 'name': 'Фид Прогон', 'url': 'https://example.test/feed.yml'}]})
        store.kv_set('feedlog:f1', [{'at': '2026-10-22T10:00:00', 'kind': 'check', 'error': 'нет связи'}])
        att = admin_overview.Attention(store, None)
        self.assertEqual([(row['do'], row['tab']) for row in att._feeds()], [('feed:f1', 'feeds')])
        self.assertIn('проверка с ошибкой — нет связи', att._feeds()[0]['text'])
        store.kv_set('feedlog:f1', [{'at': '2026-10-22T11:00:00', 'kind': 'check', 'ok': True}])
        self.assertEqual(att._feeds(), [], 'следующая проверка прошла — пункта нет')


class JournalQuickTest(unittest.TestCase):
    def test_wanted(self):
        from admin import KpJournal
        store = TempStore(self).store
        old = (date.today() - timedelta(days=5)).isoformat()
        fresh = date.today().isoformat()
        soon = (date.today() + timedelta(days=2)).isoformat()
        late = (date.today() + timedelta(days=200)).isoformat()
        sent_old = {'track': {'status': 'sent', 'at': old}}
        self.assertTrue(KpJournal.wanted(store, sent_old, 'quiet'))
        self.assertFalse(KpJournal.wanted(store, {'track': {'status': 'sent', 'at': fresh}}, 'quiet'))
        self.assertFalse(KpJournal.wanted(store, {'track': {'status': 'won', 'at': old}}, 'quiet'))
        self.assertTrue(KpJournal.wanted(store, {'validUntil': soon}, 'expiring'))
        self.assertFalse(KpJournal.wanted(store, {'validUntil': late}, 'expiring'))
        self.assertFalse(KpJournal.wanted(store, {'validUntil': soon, 'track': {'status': 'lost'}}, 'expiring'))


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=3, clients=1, kps=1))
        cls.stand.start()
        cls.adm, cls.A = cls.stand.admin()
        cls.H = Stand.as_manager(SampleData.MANAGERS[0])

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_flow(self):
        http = self.stand.http
        self.assertEqual(http.req('POST', '/api/feedback', {'text': ''}, headers=self.H)[0], 400)
        status, body, _ = http.req('POST', '/api/feedback', {'text': 'Окно сделки уезжает', 'ctx': {'where': 'Кабинет'}},
                                   headers=self.H)
        self.assertEqual(status, 200, body)
        self.assertEqual(http.req('GET', '/api/admin/feedback', headers=self.H)[0], 401, 'менеджеру — нет')
        items = Http.js(http.req('GET', '/api/admin/feedback', headers=self.A, cookie=self.adm)[1])['items']
        self.assertEqual(items[0]['text'], 'Окно сделки уезжает')
        attn = Http.js(http.req('GET', '/api/admin/attention', headers=self.A, cookie=self.adm)[1])['items']
        self.assertTrue(any(row.get('tab') == 'feedback' and row.get('do') == 'feedback' for row in attn))
        self.assertTrue(all(row.get('do') == 'backup' for row in attn if row.get('tab') == 'backup' and 'копи' in row['text']
                            and 'вторую папку' not in row['text'] and 'только на этом диске' not in row['text']))
        fid = items[0]['id']
        self.assertNotEqual(http.req('POST', f'/api/admin/feedback/{fid}/done', {}, headers=self.H)[0], 200)
        self.assertEqual(http.req('POST', f'/api/admin/feedback/{fid}/done', {}, headers=self.A, cookie=self.adm)[0], 200)
        attn = Http.js(http.req('GET', '/api/admin/attention', headers=self.A, cookie=self.adm)[1])['items']
        self.assertFalse(any(row.get('tab') == 'feedback' for row in attn))


if __name__ == '__main__':
    unittest.main()
