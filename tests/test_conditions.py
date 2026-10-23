# -*- coding: utf-8 -*-
"""Условие «Доставка» в документе КП (app/web/js/core/conditions.js — KpConditions.deliveryText): доставка до объекта и
известный адрес — «…, по адресу: …»; другие условия, другие варианты доставки и пустой адрес — без изменений."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDRESS = 'г. Казань, ул. Ленина, д. 1'
CASES = [
    ({'label': 'Доставка', 'value': 'Доставка до объекта включена'}, ADDRESS,
     'Доставка до объекта включена по адресу: г. Казань, ул. Ленина, д. 1'),
    ({'label': 'Доставка', 'value': 'Доставка до объекта включена.'}, ADDRESS,
     'Доставка до объекта включена по адресу: г. Казань, ул. Ленина, д. 1'),
    ({'label': 'Доставка', 'value': 'Доставка до объекта включена'}, '', 'Доставка до объекта включена'),
    ({'label': 'Доставка', 'value': 'Доставка рассчитывается отдельно'}, ADDRESS, 'Доставка рассчитывается отдельно'),
    ({'label': 'Доставка', 'value': f'Доставка до объекта: {ADDRESS}'}, ADDRESS, f'Доставка до объекта: {ADDRESS}'),
    ({'label': 'Срок поставки', 'value': 'до объекта 10 дней'}, ADDRESS, 'до объекта 10 дней'),
]


class DeliveryConditionTest(unittest.TestCase):
    def test_delivery_address(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        script = (
            "import(process.argv[1]).then(({ KpConditions }) => {"
            " const cases = JSON.parse(process.argv[2]);"
            " console.log(JSON.stringify(cases.map(([cond, address]) => KpConditions.deliveryText(cond, address)))); })"
        )
        module = 'file://' + os.path.join(ROOT, 'app', 'web', 'js', 'core', 'conditions.js')
        out = subprocess.run([node, '-e', script, module, json.dumps([case[:2] for case in CASES], ensure_ascii=False)],
                             capture_output=True, text=True, timeout=60, check=True).stdout
        self.assertEqual(json.loads(out), [case[2] for case in CASES])


if __name__ == '__main__':
    unittest.main()
