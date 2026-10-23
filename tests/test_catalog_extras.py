# -*- coding: utf-8 -*-
"""Каталог 3.199.0: дата цены позиции (storage.PriceStamp — ставится при смене цены или валюты, иначе прежняя), поля
priceAt и lead в лёгком каталоге; возраст цены, аналоги, срок поставки в условия КП и типовые станции — в Node
(tests/js/catalog_extras.js). Временная база с вымышленными позициями."""
import json
import os
import shutil
import subprocess
import unittest

from kit import TempStore
from storage import PriceStamp, light_of


class PriceStampTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TempStore(self)
        self.store = self.tmp.store

    def card(self, cid):
        return json.loads(self.store.catalog_get(cid))

    def test_stamp(self):
        self.store.catalog_put('a1', json.dumps({'name': 'Компрессор', 'price': 100000, 'priceCur': 'RUB'}))
        first = self.card('a1')['priceAt']
        self.store.catalog_put('a1', json.dumps({**self.card('a1'), 'priceAt': '2000-01-01', 'spec': 'правка описания'}))
        self.assertEqual(self.card('a1')['priceAt'], first, 'описание правили — дата цены прежняя')
        self.store.catalog_put('a1', json.dumps({**self.card('a1'), 'priceCur': 'USD'}))
        self.assertGreaterEqual(self.card('a1')['priceAt'], first)
        self.store.catalog_put('a1', json.dumps({**self.card('a1'), 'price': 0}))
        self.assertNotIn('priceAt', self.card('a1'), 'цены нет — даты нет')

    def test_light(self):
        light = light_of({'id': 'x', 'name': 'Н', 'price': 1, 'priceAt': '2026-01-01', 'lead': 'под заказ 6–8 недель'})
        self.assertEqual(light['priceAt'], '2026-01-01')
        self.assertEqual(light['lead'], 'под заказ 6–8 недель')

    def test_old_card_without_date(self):
        PriceStamp.put(doc := {'price': 5}, {'price': 5})
        self.assertNotIn('priceAt', doc, 'прежняя позиция без даты — дату не выдумываем (интерфейс берёт updatedAt)')


class NodeTest(unittest.TestCase):
    def test_catalog_in_node(self):
        """Возраст цены, аналоги, срок поставки, типовые станции (tests/js/catalog_extras.js)."""
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        r = subprocess.run([node, os.path.join(repo, 'tests', 'js', 'catalog_extras.js')], cwd=repo, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
