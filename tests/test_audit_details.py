# -*- coding: utf-8 -*-
"""Мелкие расчётные находки отчёта аудита 30.10, п. 19 (node tests/js/audit_details.js): экономика сделки, логистика,
КП, кабинет — пример из отчёта у каждой находки."""
import json
import os
import shutil
import subprocess
import sys
import unittest

from kit import REPO


class OfferTermTable(unittest.TestCase):
    """CALC-054: срок действия КП на сервере (kp_track.OfferTerm) — по той же таблице примеров, что KpDate.validUntil."""

    def test_same_table(self):
        sys.path.insert(0, os.path.join(REPO, 'app'))
        from kp_track import OfferTerm
        with open(os.path.join(REPO, 'tests', 'offer_term_cases.json'), encoding='utf-8') as handle:
            cases = json.load(handle)
        for one in cases:
            state = {'date': one['date'], 'conditions': [{'label': 'Срок действия предложения', 'value': one['value']}]}
            got = OfferTerm.until(state)
            with self.subTest(one['value']):
                self.assertEqual(got.isoformat() if got else '', one['until'])


class AuditDetailsJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'audit_details.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
