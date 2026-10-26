# -*- coding: utf-8 -*-
"""Курс ЦБ: свежий сохранённый ответ (моложе CbrCache.FRESH) отдаётся без запроса на cbr.ru — запуск программы и каждое
окно не ждут ЦБ; старше — запрос, ЦБ не ответил — сохранённое с пометкой."""
import os
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
import web_api  # noqa: E402


class FakeStore:
    def __init__(self):
        self.kv = {}

    def kv_get(self, key):
        return self.kv.get(key)

    def kv_set(self, key, value):
        self.kv[key] = value


class CbrCacheTest(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore()
        self.calls = []
        self._store = web_api.store
        web_api.store = lambda: self.store
        web_api.CbrCache._failed.clear()

    def tearDown(self):
        web_api.store = self._store
        web_api.CbrCache._failed.clear()

    def fetch(self):
        self.calls.append(1)
        return {'date': '2026-10-27', 'USD': 81.5}

    def stamp(self, seconds_ago):
        return (datetime.now() - timedelta(seconds=seconds_ago)).strftime('%Y-%m-%dT%H:%M:%S')

    def test_fresh_without_request(self):
        first = web_api.CbrCache.get('cbr_last', self.fetch)
        second = web_api.CbrCache.get('cbr_last', self.fetch)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual((first['USD'], second['USD']), (81.5, 81.5))

    def test_old_is_refetched(self):
        self.store.kv['cbr_last'] = {'USD': 80.0, 'fetched': self.stamp(web_api.CbrCache.FRESH + 60)}
        self.assertEqual(web_api.CbrCache.get('cbr_last', self.fetch)['USD'], 81.5)
        self.assertEqual(len(self.calls), 1)

    def test_old_and_cbr_down_gives_saved(self):
        self.store.kv['cbr_last'] = {'USD': 80.0, 'fetched': self.stamp(web_api.CbrCache.FRESH + 60)}
        got = web_api.CbrCache.get('cbr_last', lambda: {'error': 'нет связи'})
        self.assertEqual((got['USD'], got['stale']), (80.0, True))

    def test_bad_stamp_is_refetched(self):
        self.store.kv['cbr_last'] = {'USD': 80.0, 'fetched': 'вчера'}
        self.assertEqual(web_api.CbrCache.get('cbr_last', self.fetch)['USD'], 81.5)


if __name__ == '__main__':
    unittest.main()
