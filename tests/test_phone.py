# -*- coding: utf-8 -*-
"""Телефон в одном виде (app/phone.py и app/web/js/core/phone.js): как бы ни ввели — «+7 (900) 123-45-67»; сервер и
интерфейс приводят одинаково; справочники пишут номера в этом виде, миграция 2027-21-phones приводит уже сохранённые."""
import json
import os
import shutil
import subprocess
import unittest

import storage
from kit import TempStore
from phone import Phone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = {
    '8 900 123 45 67': '+7 (900) 123-45-67',
    '(900)1234567': '+7 (900) 123-45-67',
    '+7-900-123-45-67': '+7 (900) 123-45-67',
    '+79001234567': '+7 (900) 123-45-67',
    '9001234567': '+7 (900) 123-45-67',
    '7 (495) 123 45 67': '+7 (495) 123-45-67',
    '8-800-555-35-35 вн. 3': '+7 (800) 555-35-35 доб. 3',
    '8 (495) 123-45-67, доб 105': '+7 (495) 123-45-67 доб. 105',
    '+7 (900) 123-45-67': '+7 (900) 123-45-67',
    '+375 29 123 45 67': '+375291234567',
    '12-34-56': '12-34-56',
    'звонить секретарю': 'звонить секретарю',
    '  8900 123  4567 ': '+7 (900) 123-45-67',
    '': '',
}


class PhoneTest(unittest.TestCase):
    def test_format(self):
        for raw, want in CASES.items():
            with self.subTest(raw=raw):
                self.assertEqual(Phone.format(raw), want)
                self.assertEqual(Phone.format(want), want, 'повторное приведение ничего не меняет')

    def test_same_in_browser(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        script = (
            "import(process.argv[1]).then(({ Phone }) => {"
            " const cases = JSON.parse(process.argv[2]);"
            " console.log(JSON.stringify(Object.keys(cases).map(raw => Phone.format(raw)))); })"
        )
        module = 'file://' + os.path.join(ROOT, 'app', 'web', 'js', 'core', 'phone.js')
        out = subprocess.run([node, '-e', script, module, json.dumps(CASES, ensure_ascii=False)],
                             capture_output=True, text=True, timeout=60, check=True).stdout
        self.assertEqual(json.loads(out), list(CASES.values()))

    def test_directories_store_one_form(self):
        st = TempStore(self).store
        st.client_put('c1', {'id': 'c1', 'name': 'ООО «Пример»', 'phone': '8(495)1234567',
                             'contacts': [{'name': 'Иванов', 'phone': '89001234567', 'email': 'a@b.ru'}]})
        client = st.client_get('c1')
        self.assertEqual(client['phone'], '+7 (495) 123-45-67')
        self.assertEqual(client['contacts'][0]['phone'], '+7 (900) 123-45-67')
        self.assertEqual(client['contacts'][0]['email'], 'a@b.ru')
        st.supplier_put('s1', {'name': 'Поставщик', 'phones': ['8 495 765 43 21'], 'warehouses': [{'name': 'Склад', 'phone': '9001112233'}]})
        supplier = st.supplier_get('s1')
        self.assertEqual(supplier['phones'], ['+7 (495) 765-43-21'])
        self.assertEqual(supplier['warehouses'][0]['phone'], '+7 (900) 111-22-33')
        st.manager_put('m1', json.dumps({'name': 'Петров Олег', 'phone': '84951112233', 'ext': '105', 'mobile': '+7 900 222 33 44'}))
        manager = next(row for row in json.loads(st.managers_list()) if row['id'] == 'm1')
        self.assertEqual((manager['phone'], manager['ext'], manager['mobile']), ('+7 (495) 111-22-33', '105', '+7 (900) 222-33-44'))

    def test_migration_fixes_saved(self):
        st = TempStore(self).store
        raw = {'id': 'c2', 'name': 'ООО «Старое»', 'contacts': [{'name': 'Сидоров', 'phone': '8 900 555 66 77'}]}
        with st.lock:
            st.conn().execute('INSERT INTO clients (id, doc, updated) VALUES (?, ?, ?)', ('c2', json.dumps(raw, ensure_ascii=False), ''))
            storage._fill_phones(st, st.conn())
        self.assertEqual(st.client_get('c2')['contacts'][0]['phone'], '+7 (900) 555-66-77')
        found = st.clients_search('9005556677', 10, 0)
        self.assertTrue(any(row.get('id') == 'c2' for row in found.get('items', [])), 'клиент ищется по новому номеру')


if __name__ == '__main__':
    unittest.main()
