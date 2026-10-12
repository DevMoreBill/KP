# -*- coding: utf-8 -*-
"""Правки каталога файлом (app/catalog_patch.py — CatalogPatch, формат kp-catalog-patch) на сгенерированной базе:
предпросмотр без записи, запись только перечисленных полей (цены, закупка, остатки не трогаются), поле, изменённое после
выгрузки, — пропуск с отчётом, повторная загрузка ничего не меняет, неизвестные позиции и записи в неверном виде, таблицы
и описание целиком по отпечатку прежних, копия базы перед записью."""
import json
import unittest

from kit import SampleData, TempStore
from catalog_patch import CatalogPatch


class CatalogPatchTest(unittest.TestCase):
    def setUp(self):
        self.ts = TempStore(self)
        self.st = self.ts.store
        self.sample = SampleData(items=12, clients=1, kps=0).fill(self.st)
        self.cp = CatalogPatch(self.st)

    def doc(self, cid):
        return json.loads(self.st.catalog_get(cid))

    def patch(self, items):
        return {'format': CatalogPatch.FORMAT, 'version': 1, 'createdAt': '2026-10-12T12:00:00', 'title': 'Проверка', 'items': items}

    def test_preview_apply_and_repeat(self):
        a, b = self.doc('tst-0000'), self.doc('tst-0005')       # винтовой компрессор и фильтр
        price, cost = a['price'], a['cost']
        feats = [{'label': 'Ступень очистки', 'text': 'Пылевой фильтр: частицы до 1 мкм.'}]
        items = [{'id': a['id'], 'name': a['name'], 'why': 'проверка',
                  'attrs': {'oilFree': [None, 'Нет'], 'flow': [a['attrs']['flow'], 12.5], 'pressure': [str(a['attrs']['pressure']), None]},
                  'set': {'spec': [a['spec'], 'Новое описание']}},
                 {'id': b['id'], 'name': b['name'], 'why': 'ступень', 'attrs': {'stage': [None, 'Пылевой (после адсорбционного осушителя)']},
                  'features': {'was': CatalogPatch.digest(b.get('features')), 'new': feats}}]
        backups = []
        r = self.cp.run(self.patch(items), False, 'проверка', lambda: backups.append(1))
        self.assertEqual((r['applied'], r['patch']['items'], r['patch']['fields'], r['patch']['written']), (False, 2, 6, 0), r)
        self.assertEqual(self.doc(a['id']), a, 'предпросмотр ничего не пишет')
        self.assertEqual(backups, [], 'копия базы — только перед записью')
        r = self.cp.run(self.patch(items), True, 'проверка', lambda: backups.append(1))
        self.assertEqual((r['patch']['written'], r['report']['catalog']['updated'], backups), (2, 2, [1]), r)
        x = self.doc(a['id'])
        self.assertEqual((x['attrs']['oilFree'], x['attrs']['flow'], x['spec']), ('Нет', 12.5, 'Новое описание'))
        self.assertNotIn('pressure', x['attrs'], '«стало» null — поле убрано')
        self.assertEqual((x['price'], x['cost'], x['groups']), (price, cost, a['groups']), 'цены, закупка и таблицы не тронуты')
        y = self.doc(b['id'])
        self.assertEqual((y['attrs']['stage'], y['features']), ('Пылевой (после адсорбционного осушителя)', feats))
        r = self.cp.run(self.patch(items), True, 'проверка', lambda: backups.append(1))
        self.assertEqual((r['patch']['items'], r['patch']['same'], r['patch']['written'], len(backups)), (0, 6, 0, 1), 'повторная загрузка — без изменений')

    def test_conflicts_missing_and_errors(self):
        a, b = self.doc('tst-0001'), self.doc('tst-0002')
        a['attrs']['flow'] = 99                                       # после выгрузки поменяли вручную
        b['groups'] = [{'name': 'Своя', 'rows': [{'k': 'Масса', 'v': '10 кг'}]}]
        for d in (a, b):
            self.st.catalog_put(d['id'], json.dumps(d, ensure_ascii=False), 'менеджер')
        old = self.sample.items[1]
        items = [{'id': a['id'], 'attrs': {'flow': [old['attrs']['flow'], 1.5], 'oilFree': [None, 'Да']}},
                 {'id': b['id'], 'groups': {'was': CatalogPatch.digest(self.sample.items[2]['groups']), 'new': []}},
                 {'id': 'tst-9999', 'attrs': {'flow': [1, 2]}},            # нет в каталоге
                 {'id': 'tst-0003', 'attrs': {'flow': [1]}},
                 {'id': 'tst-0004', 'attrs': {'bad key': [1, 2]}},
                 {'id': 'tst-0004', 'set': {'cost': [1, 2]}},
                 {'id': '../x', 'attrs': {}}]
        r = self.cp.run(self.patch(items), True, 'проверка')
        p = r['patch']
        self.assertEqual((p['items'], p['fields'], p['missing'], p['conflictCount']), (1, 1, 1, 2), p)
        self.assertEqual(len(r['errors']), 4, r['errors'])
        self.assertTrue(any('поле «flow» изменено после выгрузки' in c for c in p['conflicts']), p['conflicts'])
        self.assertTrue(any('характеристики изменены после выгрузки' in c for c in p['conflicts']), p['conflicts'])
        x = self.doc(a['id'])
        self.assertEqual((x['attrs']['flow'], x['attrs']['oilFree']), (99, 'Да'), 'изменённое вручную — не тронуто, остальное — внесено')
        self.assertEqual(self.doc(b['id'])['groups'], b['groups'])

    def test_not_a_patch(self):
        for d in ({'format': 'kp-backup', 'version': 1, 'sections': {}}, {'format': CatalogPatch.FORMAT, 'version': 2, 'items': []},
                  {'format': CatalogPatch.FORMAT, 'version': 1, 'items': 'x'}, []):
            with self.subTest(d=str(d)[:40]):
                with self.assertRaises(ValueError):
                    self.cp.run(d, False)
        self.assertFalse(CatalogPatch.is_patch({'format': 'kp-backup'}))
        self.assertEqual(CatalogPatch.norm(10.0), CatalogPatch.norm('10'))
        self.assertEqual(CatalogPatch.digest(None), CatalogPatch.digest([]))


if __name__ == '__main__':
    unittest.main()
