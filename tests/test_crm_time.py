# -*- coding: utf-8 -*-
"""«Где тратится время» (app/crm_time.py, /api/crm/time): дни на стадиях по истории, от заявки до первого КП,
дела позже срока; по отделу, без имён менеджеров. Вымышленные данные."""
import json
import unittest
from datetime import datetime, timedelta

from kit import Http, SampleData, Stand, TempStore


class DealTimeTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def _deal(self, created, moves, extra=None):
        from crm import DealBook
        book = DealBook(self.st)
        did = book.create({'title': 'Прогон', 'client': 'ООО «Тест»'}, 'm1', 'Иванова', 'тест')['id']
        deal = book.get(did)
        deal['created'] = created.isoformat(timespec='seconds')
        deal.update(extra or {})
        deal['history'] = [{'what': 'stage', 'from': a, 'to': b, 'at': when.isoformat(timespec='seconds'), 'by': 'тест'}
                           for a, b, when in moves]
        doc = {k: v for k, v in deal.items() if k not in ('id', 'managerId', 'stage', 'updated', 'rev', 'kps', 'next', 'tasks', 'funnel')}
        self.st.write('UPDATE deals SET doc=?, stage=? WHERE id=?', (json.dumps(doc, ensure_ascii=False), moves[-1][1] if moves else 'lead', did))
        return did

    def test_stage_days(self):
        from crm_time import DealTime
        now = datetime.now()
        self._deal(now - timedelta(days=10), [('lead', 'sent', now - timedelta(days=8)), ('sent', 'won', now - timedelta(days=2))])
        self._deal(now - timedelta(days=6), [('lead', 'sent', now - timedelta(days=2))])
        rep = DealTime(self.st).report()
        by = {row['key']: row for row in rep['stages']}
        self.assertEqual(rep['deals'], 2)
        self.assertEqual((by['lead']['median'], by['lead']['deals']), (3.0, 2), 'запрос: 2 и 4 дня')
        self.assertEqual((by['sent']['median'], by['sent']['deals']), (4.0, 2), 'КП отправлено: 6 дней до победы, 2 — по сей день')
        self.assertNotIn('won', by, 'закрытые стадии не считаются')
        self.assertEqual(rep['lateTasks'], {'done': 0, 'late': 0})

    def test_losses(self):
        from crm_time import DealTime
        now = datetime.now()
        self._deal(now - timedelta(days=9), [('lead', 'sent', now - timedelta(days=7)), ('sent', 'lost', now - timedelta(days=1))],
                   {'lostReason': 'Дорого'})
        self._deal(now - timedelta(days=5), [('lead', 'lost', now - timedelta(days=3))], {'lostReason': 'Дорого'})
        self._deal(now - timedelta(days=5), [('lead', 'sent', now - timedelta(days=3)), ('sent', 'lost', now - timedelta(days=2))])
        got = DealTime(self.st).report()['losses']
        self.assertEqual(got['lost'], 3)
        self.assertEqual([(row['key'], row['lost']) for row in got['stages']], [('sent', 2), ('lead', 1)])
        self.assertEqual(got['reasons'][0], {'text': 'Дорого', 'lost': 2})
        self.assertEqual(got['reasons'][1], {'text': 'причина не указана', 'lost': 1})


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=3, clients=1, kps=2))
        cls.stand.start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_report(self):
        status, body, _ = self.stand.http.req('GET', '/api/crm/time', headers=Stand.as_manager(SampleData.MANAGERS[0]))
        self.assertEqual(status, 200, body)
        got = Http.js(body)
        self.assertEqual(set(got), {'days', 'deals', 'stages', 'firstKp', 'lateTasks', 'losses'})
        self.assertNotIn('Иванова', body if isinstance(body, str) else body.decode('utf-8'), 'без имён менеджеров')


if __name__ == '__main__':
    unittest.main()
