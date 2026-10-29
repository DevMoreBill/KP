# -*- coding: utf-8 -*-
"""Напоминание «Отправлено N дн. назад — ответа нет?» не появляется, когда по сделке КП запланировано дело (в том числе
звонок «Обратная связь по КП № …», который кабинет ставит сам) или дело сделано после отправки КП; следующий шаг сделки на
доске — любое открытое дело сделки, а не только дела её ответственного (crm.KpFollowUp, TaskBook.next_open)."""
import json
import unittest
from datetime import date, timedelta

from kit import Http, SampleData, Stand, TempStore

SENT_DAYS = 10  # больше kp.staleDays (7) — КП «давно отправлено»


def sent_track():
    return {'status': 'sent', 'at': (date.today() - timedelta(days=SENT_DAYS)).isoformat() + 'T10:00:00'}


class FollowUpUnitTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def kp(self, kid, track):
        from crm import DealBook
        meta = {'id': kid, 'number': kid, 'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'authorId': 'm1',
                'manager': 'Иванова', 'date': date.today().isoformat(), 'sum': 100000}
        self.st.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        self.st.kp_track_set(kid, track)
        return DealBook(self.st).on_kp(kid, meta, 'Иванова'), meta

    def stale(self, kid, meta, track):
        from crm import KpFollowUp
        from kp_track import ReminderList
        handled = KpFollowUp(self.st).handled({kid: track})
        items = ReminderList(store=self.st, handled=handled).collect([(kid, meta, track, {})], lambda _meta: True)
        return [item for item in items if item['kind'] == 'stale']

    def test_open_feedback_call_hides_stale(self):
        from crm import DealBook
        from crm_auto import AutoTasks
        from kp_track import ReminderList
        track = sent_track()
        did, meta = self.kp('26-114', track)
        AutoTasks(self.st).sync(DealBook(self.st).get(did))
        old = ReminderList(store=self.st).collect([('26-114', meta, track, {})], lambda _meta: True)
        self.assertEqual([item['kind'] for item in old], ['stale'], 'прежняя проверка не видела дел сделки')
        self.assertEqual(self.stale('26-114', meta, track), [], 'есть «Обратная связь по КП» — предупреждения нет')

    def test_done_after_sending_hides_stale(self):
        from crm import TaskBook
        track = sent_track()
        did, meta = self.kp('26-115', track)
        task = TaskBook(self.st).add({'kind': 'call', 'title': 'Обратная связь по КП № 26-115', 'due': date.today().isoformat()},
                                     'm1', 'тест', did)
        TaskBook(self.st).update(task['id'], {'state': 'done'})
        self.assertEqual(self.stale('26-115', meta, track), [], 'все дела сделаны после отправки — клиенту звонили')

    def test_no_tasks_or_cancelled_keeps_stale(self):
        from crm import TaskBook
        track = sent_track()
        did, meta = self.kp('26-116', track)
        self.assertEqual(len(self.stale('26-116', meta, track)), 1, 'дел нет — напоминание остаётся')
        task = TaskBook(self.st).add({'kind': 'call', 'title': 'Звонок', 'due': date.today().isoformat()}, 'm1', 'тест', did)
        TaskBook(self.st).update(task['id'], {'state': 'cancel'})
        self.assertEqual(len(self.stale('26-116', meta, track)), 1, 'отменённое дело — не работа с клиентом')

    def test_done_before_sending_keeps_stale(self):
        from crm import TaskBook
        track = sent_track()
        did, meta = self.kp('26-117', track)
        task = TaskBook(self.st).add({'kind': 'call', 'title': 'Уточнить ТЗ', 'due': date.today().isoformat()}, 'm1', 'тест', did)
        TaskBook(self.st).update(task['id'], {'state': 'done'})
        before = (date.today() - timedelta(days=SENT_DAYS + 3)).isoformat() + 'T09:00'
        self.st.write('UPDATE crm_tasks SET done_at=? WHERE id=?', (before, task['id']))
        self.assertEqual(len(self.stale('26-117', meta, track)), 1, 'дело закрыто до отправки КП — ответа по КП не было')

    def test_next_open_any_manager(self):
        from crm import TaskBook
        did, _meta = self.kp('26-118', {'status': 'new'})
        tasks = TaskBook(self.st)
        tasks.add({'kind': 'call', 'title': 'Позже', 'due': (date.today() + timedelta(days=5)).isoformat()}, 'm1', 'тест', did)
        tasks.add({'kind': 'meet', 'title': 'Коллега на объекте', 'due': date.today().isoformat()}, 'm2', 'тест', did)
        found = tasks.next_open([did, 'нет-такой'])
        self.assertEqual(list(found), [did])
        self.assertEqual(found[did]['title'], 'Коллега на объекте', 'ближайшее дело — и чужое по этой сделке')


class FollowUpApiTest(unittest.TestCase):
    """На стенде: менеджер видит напоминание по КП без дел и не видит по КП, у сделки которого запланирован звонок."""

    @classmethod
    def setUpClass(cls):
        cls.data = SampleData(items=20, clients=4, kps=6)
        cls.stand = Stand('server', cls.data)
        import storage
        from crm import DealBook
        from crm_auto import AutoTasks
        store = storage.Store(cls.stand.db)
        cls.with_call, cls.without = cls.data.kp_ids['mgr-ivanova'][:2]
        for kid in (cls.with_call, cls.without):
            store.kp_track_set(kid, sent_track())
        meta = json.loads(store.one('SELECT meta FROM kp WHERE id=?', (cls.with_call,))[0])
        cls.deal = DealBook(store).on_kp(cls.with_call, meta, SampleData.MANAGERS[0][1])
        AutoTasks(store).sync(DealBook(store).get(cls.deal))
        store.conn().close()
        cls.stand.start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None):
        return self.stand.http.req(method, path, body, headers=Stand.as_manager(SampleData.MANAGERS[0]))

    def stale(self):
        st, b, _ = self.req('GET', '/api/reminders')
        self.assertEqual(st, 200, b)
        return {item['id'] for item in Http.js(b)['items'] if item['kind'] == 'stale'}

    def test_reminders(self):
        self.assertEqual(self.stale(), {self.without}, 'КП без дел — напоминание; КП со звонком обратной связи — нет')
        st, b, _ = self.req('GET', '/api/crm/deal/' + self.deal)
        self.assertEqual(st, 200, b)
        call = [task for task in Http.js(b)['tasks'] if task['state'] == 'open']
        self.assertEqual(len(call), 1, b)
        self.assertIn('Обратная связь по КП', call[0]['title'])
        st, b, _ = self.req('PUT', '/api/crm/task/%d' % call[0]['id'], {'state': 'done'})
        self.assertEqual(st, 200, b)
        self.assertEqual(self.stale(), {self.without}, 'звонок сделан после отправки — напоминания по КП нет')


if __name__ == '__main__':
    unittest.main()
