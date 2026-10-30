# -*- coding: utf-8 -*-
"""Деньги и документы по отчёту аудита 30.10 (node tests/js/audit_money.js): договорной курс в документе КП — «курс
расчёта», прогноз месяца без сделок без ожидаемой даты, сумма вкладки КП с опциями."""
import os
import shutil
import subprocess
import unittest

from kit import REPO


class AuditMoneyJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'audit_money.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
