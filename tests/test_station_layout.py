# -*- coding: utf-8 -*-
"""Компоновка станций в контейнере: расчёт и рисунки (node tests/js/station_layout.js — разбор габаритов и цвета,
расстановка с проходами обслуживания, подбор контейнера, чертёж и 3D-вид, случайные составы), функция программы
«Компоновка станций» на сервере (включена по умолчанию, администратор выключает) и одинаковые ключи функций у
интерфейса (app/web/js/core/features.js) и сервера (app/features.py)."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from kit import APP, REPO


class StationLayoutJs(unittest.TestCase):
    def test_layout_and_drawings(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'station_layout.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])

    def test_golden(self):
        """слепок станций: компоновка, чертежи, 3D и расчёт — как в tests/js/station_golden.json"""
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'station_golden.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=900)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


class StationLayoutFeature(unittest.TestCase):
    def test_feature_switch(self):
        from features import FEATURES, FeatureAccess, Viewer
        from storage import Store
        tmp = tempfile.mkdtemp(prefix='kp-stl-')
        self.addCleanup(shutil.rmtree, tmp, True)
        fa = FeatureAccess(Store(os.path.join(tmp, 'kp.sqlite3')))
        self.assertIn('stLayout', FEATURES)
        self.assertTrue(fa.for_user()['stLayout'], 'включена по умолчанию')
        fa.save({'stLayout': {'on': False}}, author='проверка')
        self.assertFalse(fa.for_user()['stLayout'])
        self.assertFalse(fa.for_user(Viewer(admin=False, uid='m1'))['stLayout'])
        fa.save({'stLayout': None})
        self.assertTrue(fa.for_user(Viewer(admin=False, uid='m1'))['stLayout'], 'встроенное значение вернулось')

    def test_feature_keys_match(self):
        from features import FEATURES
        with open(os.path.join(APP, 'web', 'js', 'core', 'features.js'), encoding='utf-8') as f:
            client = set(re.findall(r"\.add\(\{key:'([A-Za-z0-9_]+)'", f.read()))
        self.assertEqual(sorted(client - set(FEATURES)), [], 'функции интерфейса, которых нет на сервере (app/features.py)')
        self.assertEqual(sorted(set(FEATURES) - client), [], 'функции сервера без подписи в интерфейсе (features.js)')


if __name__ == '__main__':
    unittest.main()
