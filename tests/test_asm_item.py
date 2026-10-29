# -*- coding: utf-8 -*-
"""Сборное изделие без компоновки (app/web/js/features/kit/asm-item.js): node tests/js/asm_item.js — контейнер и оборудование
из каталога одной позицией: название, назначение, сводная таблица, параметры и цена — только из карточек частей."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class AsmItemJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'asm_item.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
