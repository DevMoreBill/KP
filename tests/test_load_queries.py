# -*- coding: utf-8 -*-
"""Запросы для одновременной работы отдела (3.218.1): срок действия КП для напоминаний — двумя полями состояния, а не
целым КП; клиенты доски сделок — пачкой; авторы журнала — из памяти до правки КП. Ответы — те же, что прежним способом."""
import json
import os
import sys
import unittest
from datetime import date

from kit import TempStore

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
from kp_track import OfferTerm  # noqa: E402


class LoadQueriesTest(unittest.TestCase):
    def setUp(self):
        self.store = TempStore(self).store

    def kp(self, kid, state, manager='Иванова'):
        text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
        self.store.kp_set(kid, 'state', text)
        self.store.kp_set(kid, 'meta', json.dumps({'id': kid, 'number': kid, 'manager': manager}, ensure_ascii=False))

    def test_terms_same_as_whole_state(self):
        cases = {
            'k1': {'date': '2026-10-01', 'conditions': [{'label': 'Срок действия КП', 'value': '10 рабочих дней'}], 'items': [{'photo': 'x' * 5000}]},
            'k2': {'date': '2026-10-01', 'conditions': [{'label': 'Срок действия', 'value': 'до 15.11.2026'}]},
            'k3': {'conditions': 'не список'},
            'k4': {},
            'k5': 'испорченное{',
        }
        for kid, state in cases.items():
            self.kp(kid, state)
        terms = self.store.kp_terms(list(cases) + ['нет-такого'])
        self.assertNotIn('нет-такого', terms)
        for kid, state in cases.items():
            whole = state if isinstance(state, dict) else {}
            with self.subTest(kid):
                self.assertEqual(OfferTerm.until(terms[kid], {'date': '2026-10-02'}), OfferTerm.until(whole, {'date': '2026-10-02'}))
        self.assertEqual(OfferTerm.until(terms['k2']), date(2026, 11, 15))

    def test_terms_many(self):
        for i in range(1203):
            self.kp('m%d' % i, {'date': '2026-10-01'})
        self.assertEqual(len(self.store.kp_terms(['m%d' % i for i in range(1203)])), 1203)

    def test_clients_batch(self):
        for i in range(3):
            self.store.client_put('c%d' % i, {'name': 'ООО «Клиент %d»' % i, 'contacts': [{'name': 'Иван'}]})
        got = self.store.clients_get(['c0', 'c2', 'c2', 'нет'])
        self.assertEqual(sorted(got), ['c0', 'c2'])
        self.assertEqual(got['c2'], self.store.client_get('c2'))

    def test_authors_follow_kp_changes(self):
        self.kp('a1', {}, manager='Иванова')
        self.assertEqual(self.store.kp_authors(), ['Иванова'])
        self.kp('a2', {}, manager='Петров')
        self.assertEqual(self.store.kp_authors(), ['Иванова', 'Петров'])


if __name__ == '__main__':
    unittest.main()
