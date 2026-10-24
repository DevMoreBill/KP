# -*- coding: utf-8 -*-
"""Передача КП другому менеджеру 3.203.0 (kp_transfer.KpTransfer): автор, менеджер и контакты в КП, сделка и её открытые дела —
новому менеджеру; сделка с КП других менеджеров — по выбору; звонки клиента в карточке сделки — свои, если не открыт отдел;
расхождения с Битрикс24 — валюта сделки. Временная база, вымышленные данные."""
import json
import unittest

from kit import TempStore


class TransferTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        for mid, name in (('m1', 'Иванова А. С.'), ('m2', 'Петров О. И.'), ('m3', 'Сидоров П. П.')):
            self.st.manager_put(mid, json.dumps({'id': mid, 'name': name, 'position': 'Менеджер', 'email': f'{mid}@test.ru'}))
        self.did = self._kp('k1', 'm1')

    def _kp(self, kid, mid):
        from crm import DealBook
        meta = {'id': kid, 'number': kid, 'client': 'ООО «А»', 'clientInn': '7700000001', 'authorId': mid, 'managerId': mid,
                'manager': mid, 'date': '2026-10-20', 'sum': 100000, 'items': ['Компрессор']}
        state = {'number': kid, 'authorId': mid, 'managerId': mid, 'manager': {'name': mid, 'phone': '1'}, 'items': []}
        self.st.kp_set(kid, 'state', json.dumps(state, ensure_ascii=False), 'тест')
        self.st.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        return DealBook(self.st).on_kp(kid, meta, 'тест')

    def test_move_with_deal(self):
        from crm import DealBook, TaskBook
        from kp_transfer import KpTransfer
        task = TaskBook(self.st).add({'kind': 'call', 'due': '2026-10-25', 'title': 'Позвонить'}, 'm1', 'тест', deal=self.did)
        res = KpTransfer(self.st).move('k1', 'm2', 'тест')
        self.assertEqual(res['deal'], self.did)
        meta = json.loads(self.st.kp_get('k1', 'meta'))
        state = json.loads(self.st.kp_get('k1', 'state'))
        self.assertEqual((meta['authorId'], meta['manager']), ('m2', 'Петров О. И.'))
        self.assertEqual(state['manager']['email'], 'm2@test.ru')
        self.assertEqual(DealBook(self.st).get(self.did)['managerId'], 'm2')
        self.assertEqual(TaskBook(self.st).get(task['id'])['managerId'], 'm2', 'открытое дело — новому менеджеру')
        with self.assertRaises(ValueError):
            KpTransfer(self.st).move('k1', 'm2', 'тест')
        with self.assertRaises(ValueError):
            KpTransfer(self.st).move('k1', 'nobody', 'тест')

    def test_deal_with_others_kept(self):
        from crm import DealBook
        from kp_transfer import DealMove, KpTransfer
        self._kp('k2', 'm3')
        DealBook(self.st).link(self.did, 'k2', 'тест')
        plan = KpTransfer(self.st).plan('k1')
        self.assertEqual(plan['deal']['others'], 1, 'в сделке КП коллеги')
        res = KpTransfer(self.st).move('k1', 'm2', 'тест', DealMove.KEEP)
        self.assertIsNone(res['deal'])
        self.assertEqual(DealBook(self.st).get(self.did)['managerId'], 'm1', 'сделка с КП коллег осталась')
        self.assertEqual(json.loads(self.st.kp_get('k1', 'meta'))['authorId'], 'm2')
        with self.assertRaises(LookupError):
            KpTransfer(self.st).plan('nope')


class CallsTest(TransferTest):
    def test_only_own_calls(self):
        from crm import DealBook, TaskBook
        tasks = TaskBook(self.st)
        for mid in ('m1', 'm3'):
            done = tasks.add({'kind': 'call', 'due': '2026-10-20', 'title': 'Звонок ' + mid}, mid, 'тест', deal=self.did)
            tasks.update(done['id'], {'state': 'done'}, 'тест')
        deal = DealBook(self.st).get(self.did)
        self.assertEqual(len(tasks.client_calls(deal)), 2)
        self.assertEqual([row['title'] for row in tasks.client_calls(deal, ['m1'])], ['Звонок m1'])


class CurrencyDiffTest(unittest.TestCase):
    def test_currency(self):
        from bitrix_diff import BitrixDiff
        from test_admin_extras import StubSync
        diff = BitrixDiff(TempStore(self).store, StubSync([]))
        rows = diff._compare({'sum': 100000, 'managerId': 'm1'}, {'STAGE_ID': 'C0:NEW', 'OPPORTUNITY': '1000', 'CURRENCY_ID': 'USD',
                                                                  'ASSIGNED_BY_ID': '7', 'CATEGORY_ID': '0'})
        self.assertEqual([row['field'] for row in rows], ['currency'], 'другая валюта — сумма не сравнивается')


if __name__ == '__main__':
    unittest.main()
