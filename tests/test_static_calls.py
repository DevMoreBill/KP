# -*- coding: utf-8 -*-
"""Вызовы «Класс.метод(…)» импортированных классов интерфейса — метод есть у класса (node tests/js/static_calls.js):
убранный при переписывании метод с оставшимся вызовом — падение кнопки у пользователя."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class StaticCallsJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'static_calls.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
