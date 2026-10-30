# -*- coding: utf-8 -*-
"""Ошибки поведения интерфейса, найденные аудитом 30.10 (node tests/js/audit_ui.js): дата «Графика», итоги списка сделок,
отбор «Без движения», сделка у заготовки и смены клиента, строка журнала по номеру КП, редактор правил компоновки, повтор
запросов без конца (календарь сделки, Битрикс24), опрос загрузки фида, копирование по http, галочки плана фида."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class AuditUiJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'audit_ui.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
