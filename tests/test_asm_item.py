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


class FactorySkeleton(unittest.TestCase):
    """Скелет шаблона «ПНЕВМОТЕХ» изменён (сборное изделие — сначала изделие целиком): заводская копия прежней версии у
    пользователя обновляется сама, своя правка — нет; нынешний заводской скелет — не в списке прежних."""

    def test_old_factory(self):
        import sys

        sys.path.insert(0, os.path.join(REPO, 'app'))
        import kp_templates

        old = kp_templates.OLD_FACTORY['skeleton.js']
        self.assertIn('92c67f11a0a934e6be34451769dad715', old, 'скелет 3.198–3.225 обновляется')
        self.assertIn('c6340138a39635cd5fd817088996556f', old, 'скелет 3.226.0 обновляется')
        for tid in ('pnevmotekh', 'tender'):
            now = kp_templates._norm_md5(os.path.join(REPO, 'templates', tid, 'skeleton.js'))
            self.assertNotIn(now, old, tid)


if __name__ == '__main__':
    unittest.main()
