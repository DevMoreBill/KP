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
from station_rules import LayoutValues, StationRules   # noqa: E402


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
        for root, _dirs, files in os.walk(js):   # и папки ES-модулей
            for n in files:
                if n.endswith('.js'):
                    with open(os.path.join(root, n), encoding='utf-8') as f:
                        used |= set(re.findall(r"(?:StationRules\.(?:raw|rule|v|status|weak|src|opt)|N\.rule)\(\s*'([a-z0-9_.]+)'\s*\)", f.read()))
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
        # значения компоновки (матрица расстановки, проходы, отступы — правятся в «Настройках» таблицами)
        def lay(rid, fix):
            d = copy.deepcopy(self.d)
            fix(next(r for r in d['rules'] if r['id'] == rid))
            return d
        bad += [
            (lay('layout.matrix', lambda r: r['value']['pair']['rows'][0].update(a='robot')), 'неизвестный вид'),
            (lay('layout.matrix', lambda r: r['value']['pair']['rows'][0].update(base=-5)), 'база'),
            (lay('layout.matrix', lambda r: r['value']['pair']['rows'][0].update(k=0, base=300, min=700)), 'не менее'),
            (lay('layout.matrix', lambda r: r['value']['sides']['rows'][0].update(s='XYZ')), 'буквы'),
            (lay('layout.matrix', lambda r: r['value'].update(evil={'x': 1})), 'неизвестный раздел'),
            (lay('layout.matrix', lambda r: r['value']['door'].update(w=600)), 'door.w'),
            (lay('layout.matrix', lambda r: r['value']['fit'].update(roadW=9000)), 'fit.roadw'),
            (lay('layout.matrix', lambda r: r['value']['fit'].update(dense=2)), 'fit.dense'),
            (lay('layout.matrix', lambda r: r['value']['service'].update(min=2000, max=1200)), 'сервисные ворота'),
            (lay('layout.matrix', lambda r: r['value']['sides']['rows'][1].update(door='нет')), 'да или нет'),
            (lay('norm.aisle_tight', lambda r: r.update(value=500)), 'от 600'),
            (lay('layout.matrix', lambda r: r['value']['gate'].update(addW='1000; drop')), 'число'),
            (lay('norm.aisle', lambda r: r.update(value=[600, 1000])), 'допустимый'),
            (lay('clear.kind', lambda r: r['value']['compressor'].update(back=[100, 300])), 'допустимый'),
        ]
        for d, word in bad:
            with self.subTest(word), self.assertRaises(ValueError) as e:
                StationRules.validate(d)
            self.assertIn(word.lower(), str(e.exception).lower())
        # исправная правка матрицы проходит
        ok = lay('layout.matrix', lambda r: r['value']['pair']['rows'][0].update(base=1200, min=800))
        self.assertTrue(StationRules.validate(ok))
        ok = lay('layout.matrix', lambda r: r['value']['fit'].update(dense=0, wide=0, roadW=2500))
        self.assertTrue(StationRules.validate(ok))

    def test_own_version_gets_new_rules(self):
        """своя версия администратора, сохранённая до новых правил поставки, получает их из файла поставки (14.10: числа станции
        перенесены в правила — в старой своей версии их нет, а расчёт обязан их найти); своё значение не заменяется"""
        own = copy.deepcopy(self.d)
        own['rules'] = [r for r in own['rules'] if r['id'] not in ('heat.conv_units', 'dgu.tank_sizes')]
        next(r for r in own['rules'] if r['id'] == 'heat.ach')['value'] = 0.7
        full = StationRules.complete(own)
        ids = [r['id'] for r in full['rules']]
        self.assertIn('heat.conv_units', ids)
        self.assertIn('dgu.tank_sizes', ids)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(next(r for r in full['rules'] if r['id'] == 'heat.ach')['value'], 0.7, 'своё значение — своё')
        self.assertTrue(StationRules.validate(full))
        self.assertIs(StationRules.complete(self.d), self.d, 'полный файл — без копии')

    def test_layout_params_match(self):
        """пределы чисел компоновки в форме «Настроек» (LayoutParams, features/layout/layout-params.js) и на сервере (LayoutValues.SCALAR)
        совпадают; у каждого числа матрицы по умолчанию есть поле формы, значение файла поставки — в пределах"""
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        js = os.path.join(APP, 'web', 'js', 'features', 'layout', 'index.js')
        web = os.path.join(REPO, 'tests', 'js', 'web.js')
        code = ("require(process.argv[2]).load(process.argv[1]);StationRules.ok=()=>false;const o={},d=[];"
                "for(const [k,f] of LayoutParams.all())o[k]=[f.lo,f.hi];"
                "const D=StationMatrix.DEF;for(const g of Object.keys(D))for(const k of Object.keys(D[g]))"
                "if(typeof D[g][k]==='number'&&!LayoutParams.field(g,k))d.push(g+'.'+k);"
                "console.log(JSON.stringify({o,d,def:D}))")
        r = subprocess.run([node, '-e', code, js, web], capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        from station_rules import LayoutValues
        self.assertEqual({k: tuple(v) for k, v in out['o'].items()}, {k: tuple(v) for k, v in LayoutValues.SCALAR.items()})
        self.assertEqual(out['d'], [], 'числа матрицы без поля в форме')
        m = next(x for x in self.d['rules'] if x['id'] == 'layout.matrix')['value']
        for k, (lo, hi) in LayoutValues.SCALAR.items():
            g, f = k.split('.')
            with self.subTest(k):
                self.assertIn(f, m.get(g, {}), 'в файле поставки')
                self.assertEqual(m[g][f], out['def'][g][f], 'файл поставки = значения программы')
                self.assertTrue(lo <= m[g][f] <= hi)


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
        self.assertTrue(b.startswith(StationRules.JS_IMPORT + '\nStationRules.use({'), b[:120])
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
        # значения правил компоновки из файла поставки — для «Все значения — по умолчанию» (3.86.11)
        st, b, _ = http.req('GET', '/api/admin/rules/stations', cookie=cookie, headers=csrf)
        d = http.js(b)['layoutDef']
        self.assertEqual(sorted(d), sorted(LayoutValues.IDS))
        self.assertEqual(d['layout.matrix'], next(x['value'] for x in StationRules.bundled()['rules'] if x['id'] == 'layout.matrix'))
        # ошибка в файле — понятный отказ, действующая версия не меняется
        bad = copy.deepcopy(own)
        bad['rules'][0]['status'] = 'maybe'
        st, b, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(bad), cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 400)
        self.assertIn('статус', b)
        st, b, _ = http.req('POST', '/api/admin/rules/stations', b'{not json', cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 400)
        self.assertIn('JSON', b)
        # правка значения в «Настройках» — только той же формы, что в файле поставки (число — числом, параметры — те же)
        shape = copy.deepcopy(own)
        r = next(x for x in shape['rules'] if isinstance(x['value'], dict) and x['id'] not in ('layout.matrix', 'clear.kind'))
        r['value'] = dict(r['value'], lishnee=1)
        st, b, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(shape), cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 400)
        self.assertIn('набор параметров', b)
        num = next(x for x in own['rules'] if isinstance(x['value'], (int, float)) and not isinstance(x['value'], bool) and x['id'] != 'norm.aisle_tight')
        num['value'] = 'много'
        st, b, _ = http.req('POST', '/api/admin/rules/stations', json.dumps(own), cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 400)
        self.assertIn('нужно число', b)
        num['value'] = StationRules.bundled()['rules'][own['rules'].index(num)]['value'] * 1.1
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
        # история настроек: своя версия и возврат файла поставки — записи с откатом
        st, b, _ = http.req('GET', '/api/admin/history?key=stationRules', cookie=cookie, headers=csrf)
        items = http.js(b)['items']
        self.assertGreaterEqual(len(items), 2, b[:300])
        self.assertEqual(items[0]['title'], 'Инженерные правила станций')
        self.assertEqual(items[0]['tab'], 'rules')
        st, b, _ = http.req('POST', '/api/admin/history/%s/rollback' % items[0]['id'], b'{}', cookie=cookie, headers=dict(csrf, **{'Content-Type': 'application/json'}))
        self.assertEqual(st, 200, b[:300])
        st, b, _ = http.req('GET', '/api/rules/stations', headers=self.H)
        self.assertEqual((http.js(b)['info']['version'], http.js(b)['info']['own']), ('2099.01.01-test', True), 'откат вернул свою версию')
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
