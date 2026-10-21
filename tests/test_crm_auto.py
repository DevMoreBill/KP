# -*- coding: utf-8 -*-
"""Кабинет: дела сами (crm_auto.py) — звонок после отправки КП, «уточнить решение» до конца срока КП, «связаться с клиентом»
при сделке без движения; каждое дело — один раз; своё «перезвонить» менеджера и 0 в «Значениях программы» — без дела."""
import json
import unittest
from datetime import date, timedelta

from kit import TempStore


class AutoTasksTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def kp(self, kid, track=None, **meta):
        from crm import DealBook
        body = dict({'id': kid, 'number': kid, 'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'authorId': 'm1',
                     'manager': 'Иванова', 'date': date.today().isoformat(), 'sum': 100000}, **meta)
        self.st.kp_set(kid, 'meta', json.dumps(body, ensure_ascii=False), 'тест')
        if track:
            self.st.kp_track_set(kid, track)
        return DealBook(self.st).on_kp(kid, body, 'Иванова')

    def auto(self, did):
        from crm import DealBook
        from crm_auto import AutoTasks
        return AutoTasks(self.st).sync(DealBook(self.st).get(did))

    def tasks(self, did):
        from crm import TaskBook
        return [(task['step'], task['title'], task['due']) for task in TaskBook(self.st).list(deal=did) if task.get('step')]

    def test_after_sent(self):
        sent = (date.today() - timedelta(days=1)).isoformat()
        did = self.kp('26-1', {'status': 'sent', 'at': sent + 'T10:00:00'})
        self.assertEqual(self.auto(did), 1)
        step, title, due = self.tasks(did)[0]
        self.assertEqual((step, title, due), ('auto:sent:26-1', 'Обратная связь по КП № 26-1', (date.today() + timedelta(days=2)).isoformat()))
        self.assertEqual(self.auto(did), 0, 'второй раз — то же дело не ставится')

    def test_follow_up_and_off(self):
        did = self.kp('26-2', {'status': 'sent', 'at': date.today().isoformat(), 'followUp': {'at': date.today().isoformat()}})
        self.assertEqual(self.auto(did), 0, 'менеджер сам поставил «перезвонить»')
        from defaults import SrvVal
        self.st.kv_set('defaults', {'crm.autoCallDays': 0})
        SrvVal.forget()
        other = self.kp('26-3', {'status': 'sent', 'at': date.today().isoformat()})
        self.assertEqual([row for row in self.tasks(other) if row[0].startswith('auto:sent')], [], '0 — правило выключено')
        SrvVal.forget()

    def test_expiring(self):
        until = (date.today() + timedelta(days=1)).isoformat()
        did = self.kp('26-4', validUntil=until)
        self.auto(did)
        steps = {row[0]: row for row in self.tasks(did)}
        self.assertIn('auto:expire:26-4', steps)
        self.assertIn('действует до', steps['auto:expire:26-4'][1])

    def test_idle(self):
        did = self.kp('26-5')
        old = (date.today() - timedelta(days=10)).isoformat() + 'T09:00:00'
        self.st.conn().execute('UPDATE deals SET updated=? WHERE id=?', (old, did))
        self.st.conn().commit()
        self.auto(did)
        idle = [row for row in self.tasks(did) if row[0].startswith('auto:idle:')]
        self.assertEqual(len(idle), 1)
        self.assertEqual(idle[0][2], date.today().isoformat())

    def test_closed_deal(self):
        from crm import DealBook
        did = self.kp('26-6', {'status': 'sent', 'at': date.today().isoformat()})
        DealBook(self.st).update(did, {'stage': 'lost', 'lostReason': 'Дорого'}, 'Иванова')
        self.assertEqual(self.auto(did), 0, 'закрытая сделка — без дел')


if __name__ == '__main__':
    unittest.main()
