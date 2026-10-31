# -*- coding: utf-8 -*-
"""Образец категории для запроса к ИИ (ai_profile.CategoryProfile): равные по частоте характеристики, темы описания и
группы — в порядке первого появления в карточках, одинаково при любом запуске сервера (было: порядок множества — от
случайного зерна строк Python, запрос к ИИ и прогон менялись от запуска к запуску)."""
import json
import os
import subprocess
import sys
import unittest

from kit import REPO

APP = os.path.join(REPO, 'app')
CARDS = [
    {'keys': ['Производительность', 'Мощность, кВт', 'Давление', 'Производительность'], 'feats': [('Назначение', 120), ('Устройство', 80)],
     'groups': ['Основные', 'Двигатель']},
    {'keys': ['Давление', 'Мощность (кВт)', 'Производительность'], 'feats': [('Устройство', 90), ('Назначение', 70)],
     'groups': ['Двигатель', 'Основные']},
    {'keys': ['Мощность', 'Производительность', 'Давление', 'Уровень шума'], 'feats': [('Назначение', 100)], 'groups': ['Основные']},
]
SHOW = ('import json, sys; sys.path.insert(0, %r); from ai_profile import CategoryProfile; '
        'prof = CategoryProfile(None)._profile("cat", json.loads(sys.argv[1])); '
        'print(json.dumps([[key["k"] for key in prof["keys"]], prof["labels"], prof["groupNames"]], ensure_ascii=False))' % APP)


class ProfileOrder(unittest.TestCase):
    @staticmethod
    def _order(seed: str) -> str:
        env = dict(os.environ, PYTHONHASHSEED=seed)
        done = subprocess.run([sys.executable, '-c', SHOW, json.dumps(CARDS, ensure_ascii=False)], env=env,
                              capture_output=True, text=True, check=True)
        return done.stdout.strip()

    def test_first_seen_order(self):
        keys, labels, groups = json.loads(self._order('0'))
        self.assertEqual(keys, ['Производительность', 'Мощность, кВт', 'Давление', 'Уровень шума'])
        self.assertEqual(labels, ['Назначение', 'Устройство'])
        self.assertEqual(groups, ['Основные', 'Двигатель'])

    def test_same_for_any_seed(self):
        self.assertEqual(len({self._order(seed) for seed in ('0', '1', '2', '3', '7', '42')}), 1)


if __name__ == '__main__':
    unittest.main()
