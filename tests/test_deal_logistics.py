# -*- coding: utf-8 -*-
"""Экономика сделки и логистика: node tests/js/deal_logistics.js (ручной груз в мм и кг, прежние КП в метрах и тоннах,
«своя сумма» доставки в валюте → рубли по курсу, значения «Настройки → Значения программы» в расчёте, ручная перепроверка
формул) и пределы сборного груза на сервере (app/logistics_api.py, LtlLimits) из «Значений программы» — те же ключи и
встроенные значения, что описаны для админки в app/web/js/features/logistics-calc.js (LgValues)."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from kit import APP, REPO


class DealLogisticsJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'deal_logistics.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


class LtlLimitsServer(unittest.TestCase):
    def setUp(self):
        from storage import Store
        self.tmp = tempfile.mkdtemp(prefix='kp-ltl-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.store = Store(os.path.join(self.tmp, 'kp.sqlite3'))

    def test_builtin_and_admin_value(self):
        import defaults
        from logistics_api import LtlLimits, ltl_ok
        place = [{'l': 2.0, 'w': 1.2, 'h': 1.8, 'm': 4.0, 'qty': 1}]          # место 4 000 кг
        ok, why = ltl_ok(place, self.store)
        self.assertFalse(ok)
        self.assertIn('3 000 кг', why)
        self.assertIn('6 000 × 2 400 × 2 500 мм', why)
        defaults.save(self.store, {'log.ltlKg': {'on': True, 'v': '5000'}}, by='проверка')
        self.assertEqual(LtlLimits.get(self.store)['m'], 5.0)
        self.assertEqual(ltl_ok(place, self.store), (True, ''))
        # общая масса: 5 мест по 4 т = 20 т — на пределе; предел 15 000 кг — отдельная машина
        five = [dict(place[0], qty=5)]
        self.assertTrue(ltl_ok(five, self.store)[0])
        defaults.save(self.store, {'log.ltlTotal': {'on': True, 'v': '15 000'}})
        ok, why = ltl_ok(five, self.store)
        self.assertFalse(ok)
        self.assertIn('15 000 кг', why)
        # вне допустимого — встроенное; без базы — встроенные
        defaults.save(self.store, {'log.ltlKg': {'on': True, 'v': '999999'}, 'log.ltlTotal': None})
        self.assertEqual(LtlLimits.get(self.store)['m'], 3.0)
        self.assertEqual(LtlLimits.get(), {'m': 3.0, 'l': 6.0, 'w': 2.4, 'h': 2.5, 'total': 20.0})
        self.assertEqual(LtlLimits.ati_days(self.store), 30)
        defaults.save(self.store, {'log.atiDays': {'on': True, 'v': '14'}})
        self.assertEqual(LtlLimits.ati_days(self.store), 14)

    def test_keys_match_admin_registry(self):
        """ключи, встроенные значения и пределы сервера — как в описании для админки (LgValues в logistics-calc.js)"""
        from logistics_api import LtlLimits
        with open(os.path.join(APP, 'web', 'js', 'features', 'logistics-calc.js'), encoding='utf-8') as f:
            js = f.read()
        for key, b, lo, hi in list(LtlLimits.KEYS.values()) + [LtlLimits.ATI_DAYS]:
            m = re.search(r"\['%s', '\w+', '[^']+', 'num', '(\d+)', \{[^}]*?min:(\d+), max:(\d+)" % re.escape(key), js)
            self.assertIsNotNone(m, 'нет описания %s в logistics-calc.js' % key)
            self.assertEqual((int(m.group(1)), int(m.group(2)), int(m.group(3))), (b, lo, hi), key)


if __name__ == '__main__':
    unittest.main()
