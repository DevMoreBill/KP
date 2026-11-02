# -*- coding: utf-8 -*-
"""Дубли сделок на «Сегодня», окно «Объединить сделки» и Битрикс24, «Выровнять все» в «Расхождениях с Битрикс24»
(3.274.0): node tests/js/deal_dupes.js — группа «Дубли» в «Что сделать», выключатели, загрузка, окно объединения, кнопки
«Выровнять все» и «Отправить сейчас»."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class DealDupesJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'deal_dupes.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
