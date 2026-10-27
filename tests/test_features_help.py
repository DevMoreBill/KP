# -*- coding: utf-8 -*-
"""Выключатели «Функции программы» (решение владельца 23.10: точечно отключать любую функцию, у каждого выключателя —
подробная инструкция): у каждой функции сервера (app/features.py) есть строка в интерфейсе (core/features.js) и
инструкция (core/feature-help.js) с «Где», «Как пользоваться» и «Выключено»; «работает только вместе с» совпадает."""
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'app'))
sys.path.insert(0, os.path.join(ROOT, 'tests'))
JS = os.path.join(ROOT, 'app', 'web', 'js', 'core')


class FeaturesHelpTest(unittest.TestCase):
    def read(self, name):
        with open(os.path.join(JS, name), encoding='utf-8') as f:
            return f.read()

    def test_every_switch_has_help(self):
        from features import FEATURES, NEEDS
        defs = self.read('features.js')
        help_text = self.read('feature-help.js')
        found = dict(re.findall(r"^  (\w+): `(.*?)`,$", help_text, re.M | re.S))
        for key in FEATURES:
            self.assertRegex(defs, r"key: '%s'" % key, 'нет строки в «Функциях программы»: %s' % key)
            text = found.get(key, '')
            for part in ('Где:', 'Как пользоваться:', 'Выключено:'):
                self.assertIn(part, text, '%s: в инструкции нет «%s»' % (key, part))
        for key, need in NEEDS.items():
            block = re.search(r"key: '%s'[^}]*" % key, defs).group(0)
            self.assertIn("needs: '%s'" % need, block, '%s работает только с %s — и в интерфейсе' % (key, need))
        self.assertEqual(set(found) - set(FEATURES), set(), 'инструкция без функции')

    def test_routes_closed(self):
        """Выключили «Удаление сделки» — адрес закрыт; выключили кабинет — закрыты и его функции."""
        from kit import TempStore
        from features import FeatureAccess
        st = TempStore(self).store
        access = FeatureAccess(st)
        who = lambda: (False, 'm1')  # noqa: E731
        self.assertIsNone(access.blocked('POST', '/api/crm/deal/d1/remove', who))
        access.save({'dealDelete': False})
        self.assertEqual(access.blocked('POST', '/api/crm/deal/d1/remove', who), 'Удаление сделки')
        self.assertIsNone(access.blocked('POST', '/api/crm/deal/d1/files', who))
        access.save({'myDay': False})
        self.assertEqual(access.blocked('POST', '/api/crm/deal/d1/files', who), 'Кабинет менеджера')
        self.assertIsNone(access.blocked('POST', '/api/clientcard/contact/remove', who))
        access.save({'contactDelete': False})
        self.assertEqual(access.blocked('POST', '/api/clientcard/contact/remove', who), 'Удаление контактов клиента')
        self.assertIsNone(access.blocked('POST', '/api/clientcard/contact', who), 'правка контактов остаётся')
        access.save({'contactDelete': True, 'clientCard': False})
        self.assertEqual(access.blocked('POST', '/api/clientcard/contact/remove', who), 'Карточка клиента')


if __name__ == '__main__':
    unittest.main()
