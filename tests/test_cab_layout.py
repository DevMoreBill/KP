# -*- coding: utf-8 -*-
"""Своё расположение разделов кабинета (features/crm/cab-layout.js): node tests/js/cab_layout.js
— сохранённое поверх умолчания, скрытые, выключатель cabLayout."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class CabLayoutJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'cab_layout.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
