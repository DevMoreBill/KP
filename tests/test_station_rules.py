# -*- coding: utf-8 -*-
"""Инженерные правила станций (app/station_rules.py, app/web/rules/stations.json): файл поставки проходит проверку
структуры, у каждого правила — источник и статус, в записке нет выдуманных правил; маршруты /api/rules/stations(.js);
загрузка своей версии администратором — проверка, журнал, прежняя версия сохраняется, возврат файла поставки; без
сессии администратора и токена CSRF — отказ. Расчёт станции по правилам — node tests/js/station_calc.js."""
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import unittest

from kit import APP, REPO, SampleData, Stand

sys.path.insert(0, APP)
from station_rules import StationRules   # noqa: E402


class RulesFileTest(unittest.TestCase):
    def setUp(self):
        self.d = StationRules.bundled()

    def test_bundled_valid(self):
        self.assertTrue(StationRules.validate(self.d))
        self.assertEqual(self.d['format'], 'kp-station-rules')
        ids = [r['id'] for r in self.d['rules']]
        self.assertEqual(len(ids), len(set(ids)), 'идентификаторы не повторяются')
        for r in self.d['rules']:
            with self.subTest(r['id']):
                self.assertIn(r['status'], StationRules.STATUSES)
                self.assertTrue(r['source']['doc'].strip(), 'источник')
                self.assertTrue(r.get('group'), 'группа для документа «Инженерные правила и источники»')
        for s in self.d['series']:
            with self.subTest(s['title']):
                re.compile(s['match'])
                self.assertIn(s['kind'], ('dryer', 'filter', 'genset'))
                for k, T in s['f'].items():
                    xs = [x for x, _ in T]
                    self.assertEqual(xs, sorted(xs), 'таблица %s — по возрастанию' % k)
                    self.assertTrue(all(y > 0 for _, y in T))

    def test_rules_used_in_code_exist(self):
        """каждое правило, на которое ссылается код (StationRules.raw/rule/v, N.rule), есть в файле"""
        have = {r['id'] for r in self.d['rules']}
        used = set()
        js = os.path.join(APP, 'web', 'js', 'features')
        for n in os.listdir(js):
            if n.endswith('.js'):
                with open(os.path.join(js, n), encoding='utf-8') as f:
                    used |= set(re.findall(r"(?:StationRules\.(?:raw|rule|v|status|weak|src)|N\.rule)\('([a-z0-9_.]+)'\)", f.read()))
        self.assertTrue(used, 'код читает правила')
        self.assertEqual(sorted(used - have), [], 'нет в файле правил')

    def test_validation(self):
        bad = [({}, 'не файл правил'), (dict(self.d, version=''), 'версия'), (dict(self.d, rules=[]), 'Нет списка')]
        r0 = self.d['rules'][0]
        for patch, word in [({'id': 'Bad Id'}, 'идентификатор'), ({'status': 'maybe'}, 'статус'), ({'source': {'doc': ''}}, 'источник'), ({'title': ''}, 'названия')]:
            d = copy.deepcopy(self.d)
            d['rules'][0] = dict(r0, **patch)
            bad.append((d, word))
        d = copy.deepcopy(self.d)
        d['rules'].append(dict(r0))
        bad.append((d, 'повторяется'))
        d = copy.deepcopy(self.d)
        d['series'][0]['match'] = '(('
        bad.append((d, 'match'))
        for d, word in bad:
            with self.subTest(word), self.assertRaises(ValueError) as e:
                StationRules.validate(d)
            self.assertIn(word.lower(), str(e.exception).lower())


class RulesRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=5, clients=1, kps=1)).start()
        cls.H = Stand.as_manager(SampleData.MANAGERS[0])

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_routes_and_admin(self):
        http = self.stand.http
        st, b, hd = http.req('GET', '/api/rules/stations.js', headers=self.H)
        self.assertEqual(st, 200)
        self.assertIn('javascript', hd.get('Content-Type', ''))
        self.assertTrue(b.startswith('StationRules.use({'), b[:60])
        self.assertNotIn('</', b, 'закрывающий тег не ломает страницу')
        st, b, _ = http.req('GET', '/api/rules/stations', headers=self.H)
        r = http.js(b)
        self.assertEqual((st, r['info']['own'], r['info']['version']), (200, False, StationRules.bundled()['version']))

        # без входа администратора и без токена — отказ
        own = copy.deepcopy(StationRules.bundled())
        own['version'] = '2099.01.01-test'
        own['rules'][0]['value'] = own['rules'][0]['value']
        st, _, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(own), headers=dict(self.H, **{'Content-Type': 'application/json'}))
        self.assertIn(st, (401, 403))
        cookie, csrf = self.stand.admin()
        st, _, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(own), cookie=cookie, headers={'Content-Type': 'application/json'})
        self.assertIn(st, (401, 403), 'без токена CSRF')
        # ошибка в файле — понятный отказ, действующая версия не меняется
        bad = copy.deepcopy(own)
        bad['rules'][0]['status'] = 'maybe'
        st, b, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(bad), cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 400)
        self.assertIn('статус', b)
        st, b, _ = http.req('POST', '/api/admin/rules/stations', b'{not json', cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 400)
        self.assertIn('JSON', b)
        # своя версия: действует для всех, в журнале — запись
        st, b, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(own), cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 200, b[:300])
        self.assertEqual((http.js(b)['info']['version'], http.js(b)['info']['own']), ('2099.01.01-test', True))
        st, b, _ = http.req('GET', '/api/rules/stations.js', headers=self.H)
        self.assertIn('2099.01.01-test', b)
        # вернуть файл поставки
        st, b, _ = http.req('POST', '/api/admin/rules/stations?reset=1', b'', cookie=cookie, headers=csrf)
        self.assertEqual((st, http.js(b)['info']['own']), (200, False))
        st, b, _ = http.req('GET', '/api/rules/stations', headers=self.H)
        self.assertEqual(http.js(b)['info']['version'], StationRules.bundled()['version'])
        self.assertEqual(self.stand.request_errors(), [], 'без ошибок сервера')


class StationCalcJs(unittest.TestCase):
    def test_calc(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'station_calc.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-8000:])


if __name__ == '__main__':
    unittest.main()
