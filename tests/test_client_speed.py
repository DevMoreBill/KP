# -*- coding: utf-8 -*-
"""Быстродействие интерфейса (node tests/js/client_speed.js): разбор характеристик карточки каталога и строка поиска окна
подбора — один раз на карточку, черновик КП в браузере — большие картинки отдельными записями, пишутся один раз."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class ClientSpeedJs(unittest.TestCase):
    def test_client_speed(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'client_speed.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
