# -*- coding: utf-8 -*-
"""Единицы полей категорий (node tests/js/field_unit.js): производительность поршневых (л/мин) и воздуходувок (м³/ч, мбар)
переводится в м³/мин и бар в одном месте (core/field-unit.js) — расчёт станции, автозаполнение станции, подбор по ТЗ, строка
документа, сборное изделие; встроенная таблица единиц совпадает с app/equipment_types.json."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class FieldUnitJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'field_unit.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
