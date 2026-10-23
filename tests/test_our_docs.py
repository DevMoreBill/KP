# -*- coding: utf-8 -*-
"""Счёт, спецификация, договор из КП (app/our_docs.py, /api/requisites, /api/doctpl): проверка реквизитов, запись только
администратором с CSRF, шаблоны Word — только настоящий .docx, скачивание менеджером, функция «docsGen» выключена.
Стенд с вымышленными реквизитами, рабочая база не используется."""
import json
import os
import shutil
import subprocess
import unittest

from kit import Docx, SampleData, Stand, TempStore
from our_docs import OurRequisites

FIRM = {
    'id': 'main',
    'name': 'ООО «Пример»',
    'inn': '7700000001',
    'kpp': '770001001',
    'bik': '044525000',
    'account': '4070 2810 0000 0000 0001',
    'corr': '30101810400000000225',
    'vat': '22',
}


class RequisitesTest(unittest.TestCase):
    """Без сервера: проверка полей."""

    def setUp(self):
        self.tmp = TempStore()
        self.own = OurRequisites(self.tmp.store)

    def tearDown(self):
        self.tmp.close()

    def test_save_and_main(self):
        got = self.own.save({'items': [FIRM, {'id': 'two', 'name': 'ИП Тест'}], 'main': 'two'})
        self.assertEqual(got['main'], 'two')
        self.assertEqual(got['items'][0]['account'], '40702810000000000001')  # пробелы убраны
        self.assertEqual(self.own.list()['items'][1]['name'], 'ИП Тест')

    def test_bad_fields(self):
        for bad in ({'inn': '123'}, {'bik': 'abc'}, {'account': '1' * 19}, {'vat': '18'}, {'name': ''}, {'id': '../x'}):
            with self.assertRaises(ValueError, msg=bad):
                self.own.save({'items': [{**FIRM, **bad}]})
        with self.assertRaises(ValueError):
            self.own.save({'items': [FIRM, FIRM]})
        with self.assertRaises(ValueError):
            self.own.save({'items': 'x'})


class NodeTest(unittest.TestCase):
    def test_docs_in_node(self):
        """Счёт, спецификация, метки шаблона Word, проверка цен (tests/js/docs_gen.js)."""
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        r = subprocess.run([node, os.path.join(repo, 'tests', 'js', 'docs_gen.js')], cwd=repo, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=4, clients=2, kps=2))
        cls.stand.start()
        cls.cookie, cls.csrf = cls.stand.admin()
        cls.mgr = Stand.as_manager(SampleData.MANAGERS[0])

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None, admin=False, headers=None):
        extra = dict(self.csrf if admin else self.mgr, **(headers or {}))
        return self.stand.http.req(method, path, body, cookie=self.cookie if admin else None, headers=extra)

    def test_requisites_admin_only(self):
        status, _body, _h = self.req('PUT', '/api/requisites', {'items': [FIRM]})
        self.assertEqual(status, 403)
        status, body, _h = self.req('PUT', '/api/requisites', {'items': [FIRM]}, admin=True)
        self.assertEqual(status, 200, body)
        status, body, _h = self.req('GET', '/api/requisites')
        data = json.loads(body)
        self.assertEqual(data['items'][0]['inn'], FIRM['inn'])
        self.assertEqual(data['templates'], {'contract': False, 'spec': False})
        status, body, _h = self.req('PUT', '/api/requisites', {'items': [{**FIRM, 'inn': '1'}]}, admin=True)
        self.assertEqual(status, 400)
        self.assertIn('ИНН', body)

    def test_templates(self):
        status, _b, _h = self.req('PUT', '/api/doctpl/contract', Docx.minimal('{покупатель}'))
        self.assertEqual(status, 403)
        status, body, _h = self.req('PUT', '/api/doctpl/contract', b'<html>not word</html>', admin=True)
        self.assertEqual(status, 400, body)
        status, body, _h = self.req('PUT', '/api/doctpl/contract', Docx.minimal('{покупатель}'), admin=True)
        self.assertEqual(status, 200, body)
        status, data, _h = self.stand.http.req('GET', '/api/doctpl/contract', headers=self.mgr, raw=True)
        self.assertEqual(status, 200)
        self.assertTrue(data.startswith(b'PK'))
        status, _b, _h = self.req('GET', '/api/doctpl/spec')
        self.assertEqual(status, 404)
        status, _b, _h = self.req('GET', '/api/doctpl/..%2fkp')
        self.assertEqual(status, 404)
        status, body, _h = self.req('POST', '/api/doctpl/contract/remove', admin=True)
        self.assertEqual(json.loads(body)['templates']['contract'], False)

    def test_feature_off(self):
        self.req('PUT', '/api/doctpl/spec', Docx.minimal('x'), admin=True)
        status, body, _h = self.req('POST', '/api/admin/features', {'values': {'docsGen': {'on': False}}}, admin=True)
        self.assertEqual(status, 200, body)
        try:
            status, _b, _h = self.req('GET', '/api/doctpl/spec')
            self.assertEqual(status, 403)
        finally:
            self.req('POST', '/api/admin/features', {'values': {'docsGen': None}}, admin=True)
            self.req('POST', '/api/doctpl/spec/remove', admin=True)


if __name__ == '__main__':
    unittest.main()
