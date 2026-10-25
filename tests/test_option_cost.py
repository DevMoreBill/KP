# -*- coding: utf-8 -*-
"""Закупка опций и услуг (app/web/js/features/kp/option-cost.js, KitDoc.lines): node tests/js/option_cost.js — опция с ценой
или закупкой — своя строка закупки экономики сделки, поставщик — как у позиции, закупка в себестоимости, выключатель optCost."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class OptionCostJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'option_cost.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
