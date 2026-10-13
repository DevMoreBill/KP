# -*- coding: utf-8 -*-
"""Эталонные сценарии «ТЗ → КП» для конструктора модульных станций: текст ТЗ → разбор правилами (TzParse, анкета со
статусами и вопросами) → требования станции → подбор из каталога (TzPick, вымышленный каталог в памяти) → расчёт
(StationCalc) → приложение к КП. Ожидаемые значения посчитаны вручную по файлу правил (app/web/rules/stations.json) и
перепроверены независимо; каждое — с пояснением. Результаты всех сценариев можно выгрузить: KP_SCENARIOS_OUT=файл.json.
Узел расчёта — node tests/js/station_scenarios.js."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from kit import APP, REPO

sys.path.insert(0, APP)
from tz_parse import TzParse   # noqa: E402

# n, название, текст ТЗ, правка менеджера после подбора (как в окне станции) — или None
SCENARIOS = [
    (1, 'Компрессорная 10 м³/мин FAD, 7 бар, 2.4.2, N+1',
     'Техническое задание. Компрессорная станция в блок-контейнере. Производительность станции не менее 10 м3/мин (FAD по ISO 1217), '
     'рабочее давление 7 бар. Класс чистоты сжатого воздуха по ISO 8573-1 — 2.4.2. Схема резервирования N+1. Температура наружного '
     'воздуха от −40 до +30 °C. Гарантия 24 месяца.', None),
    (2, 'Нормальные м³, высота 900 м, влажность 80 %, запас 10 %',
     'Компрессорная станция. Потребность в сжатом воздухе 12 нм3/мин, давление у потребителя 7 бар, класс 1.4.1 по ISO 8573-1. '
     'Высота площадки над уровнем моря 900 м, относительная влажность 80 %. Запас производительности 10 %. Температура наружного '
     'воздуха от −35 до +35 °C. Резервный компрессор не требуется.', None),
    (3, 'Адсорбционный осушитель, точка росы −40 °C',
     'Компрессорная станция производительностью 6 м3/мин, давление 7 бар, точка росы под давлением минус 40 °C. Температура '
     'наружного воздуха от −45 до +30 °C. Без резерва.', None),
    (4, 'Высокогорье 1500 м и жара +40 °C',
     'Компрессорная станция. Производительность 8 м3/мин, рабочее давление 7 бар, класс 3.4.3. Высота над уровнем моря 1500 м. '
     'Температура наружного воздуха от −30 до +40 °C.', None),
    (5, 'Давление 11 бар — компрессор на 13 бар',
     'Компрессорная станция. Производительность 8 м3/мин, рабочее давление на выходе станции 11 бар, класс 2.4.2. '
     'Температура наружного воздуха от −40 до +30 °C.', None),
    (6, 'Безмасляный компрессор, класс 1.2.1',
     'Компрессорная станция с безмасляным компрессором (класс 0 по маслу). Производительность 9 м3/мин, давление 7 бар, '
     'класс 1.2.1 по ISO 8573-1. Температура наружного воздуха от −30 до +30 °C.', None),
    (7, 'ДЭС 180 кВт, основной источник, 24 ч от бака, нагрузка 60 %',
     'Дизельная электростанция — основной источник питания. Мощность нагрузки 180 кВт, средняя нагрузка 60 %. '
     'Работа без дозаправки не менее 24 ч. Температура от −45 до +30 °C.', None),
    (8, 'ДЭС резервная 300 кВт, двигатель 55 кВт прямой пуск, I категория',
     'ДЭС — резервный источник электроснабжения, мощность нагрузки 300 кВт. Пуск асинхронного двигателя насоса 55 кВт — прямой пуск. '
     'Потребители I категории надёжности. Температура от −40 до +35 °C.', None),
    (9, 'ДЭС 500 кВА, схема 2+1',
     'Дизельная электростанция 500 кВА. Схема резервирования 2+1. Работа от бака не менее 8 ч. Температура от −50 до +30 °C, '
     'климатическое исполнение УХЛ1.', None),
    (10, 'Противоречие в ТЗ: 10 и 12 м³/мин',
     'Компрессорная станция. Производительность станции не менее 10 м3/мин, давление 7 бар.\n'
     'Приложение 1. Производительность станции — 12 м3/мин. Температура наружного воздуха от −40 до +30 °C.', None),
    (11, 'Минимальное ТЗ: только производительность',
     'Нужна компрессорная станция на 5 м3/мин.', None),
    (12, 'Ручная замена: ТЗ 10 м³/мин, менеджер поднял потребность до 14',
     'Компрессорная станция. Производительность станции не менее 10 м3/мин (FAD), давление 7 бар, класс 2.4.2. Без резерва. '
     'Температура наружного воздуха от −40 до +30 °C.', {'flow': '14'}),
]


def run_scenarios():
    data = []
    for n, name, tz, edit in SCENARIOS:
        r = TzParse.parse(tz)
        data.append({'n': n, 'name': name, 'req': r['req'], 'edit': edit, 'tz': {'fields': r['fields'], 'questions': r['questions'], 'later': r['later'], 'conflicts': r['conflicts']}})
    node = shutil.which('node')
    if not node:
        return data, None
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'sc.json')
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'station_scenarios.js'), p], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=600)
    if r.returncode:
        raise AssertionError(r.stderr[-6000:])
    out = json.loads(r.stdout)
    for o, d in zip(out, data):
        o['tz'] = d['tz']
    return data, out


class StationScenarios(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.out = run_scenarios()
        if cls.out and os.environ.get('KP_SCENARIOS_OUT'):
            with open(os.environ['KP_SCENARIOS_OUT'], 'w', encoding='utf-8') as f:
                json.dump(cls.out, f, ensure_ascii=False, indent=1)

    def setUp(self):
        if self.out is None:
            self.skipTest('нет Node.js')

    def sc(self, n):
        return next(o for o in self.out if o['n'] == n)

    @staticmethod
    def step(o, sec, part):
        return next(s for s in o['steps'] if s['sec'] == sec and part in s['what'])

    @staticmethod
    def names(o, kind):
        return [(p['name'], p['qty']) for p in o['parts'] if p['kind'] == kind]

    def test_01_basic(self):
        o = self.sc(1)
        # 10 м³/мин FAD, запас 0 (не задан): наименьший избыток — 2 × 5 м³/мин (10 бар: 7 + 0,5 потери + 1 регулирование = 8,5 ≤ 10) + 1 резервный
        self.assertEqual(self.names(o, 'compressor'), [('Компрессор винтовой Пример 5/10', 3)])
        self.assertEqual(self.step(o, 'air', 'рабочие против')['margin'], 0)
        # осушитель на 10 м³/мин: 7,1 бар → 1,004; помещение 30 + 5 = 35 °C → 0,93; вход 45 °C → 0,78: F = 0,72830;
        # DK 110 (9,8) — 7,14 мало; DK 120 (13,8) — 10,05 ≥ 10
        self.assertEqual(self.names(o, 'dryer'), [('Осушитель рефрижераторный Dalgakiran Dryair DK 120', 1)])
        self.assertIn('10,05', self.step(o, 'dryer', 'DK 120')['result'])
        # давление: 7 + 3 × 0,1 (фильтры) + 0,2 (осушитель) + 0,1 (трубы) = 7,6; включение 10 − 1 = 9
        self.assertIn('7,6', self.step(o, 'press', 'Требуемое давление')['result'])
        # ресиверы (методика ПНЕВМОТЕХ 13.10, уточнено 13.10): винтовой — цикл 5 / (8 · 1) = 625 л; наименьшее допустимое — не
        # меньше 15 % минутной производительности (750 л) → 1 × 900 л
        self.assertIn('625 л', self.step(o, 'recv', 'Приоритет 1')['result'])
        self.assertIn('625 л — сработал приоритет 1', self.step(o, 'recv', 'Теоретически')['result'])
        self.assertTrue(self.step(o, 'recv', 'Рекомендация')['result'].startswith('основной 900 л × 1'), self.step(o, 'recv', 'Рекомендация')['result'])
        self.assertEqual(o['errors'], [])
        self.assertIn('Приложение. Расчётная записка и состав станции', o['groups'])
        st = {f['key']: f['status'] for f in o['tz']['fields']}
        self.assertEqual((st['basis'], st['margin'], st['warranty']), ('found', 'default', 'found'))

    def test_02_normal_altitude(self):
        o = self.sc(2)
        # 12 н. м³/мин: 900 м → 90,970 кПа; 35 °C · 80 % → 4,490 кПа: 12 · 101,325 / 86,480 · 308,15/273,15 = 15,861; +10 % = 17,45
        s = self.step(o, 'air', 'Требуемая производительность')
        self.assertIn('17,45', s['result'])
        self.assertIn('15,86', self.step(o, 'air', 'нормальных м³')['result'])
        self.assertEqual(self.names(o, 'compressor'), [('Компрессор винтовой Пример 21/10', 1)])
        self.assertEqual(o['errors'], [])
        self.assertTrue(any('угольный' in p['name'].lower() or 'GON 1550 MA' in p['name'] for p in o['parts']) or
                        any('угольный' in w for w in o['warnings'] + o['errors']), 'класс 1 по маслу — угольный фильтр')

    def test_03_adsorption(self):
        o = self.sc(3)
        # точка росы −40 → адсорбционный; продувка холодной регенерации 15 %: 6 / 0,85 = 7,06 → компрессор 8 м³/мин (10 бар)
        self.assertEqual(self.names(o, 'compressor'), [('Компрессор винтовой Пример 8/10', 1)])
        self.assertIn('7,06', self.step(o, 'air', 'Требуемая производительность')['result'])
        self.assertTrue(self.names(o, 'dryer')[0][0].startswith('Осушитель адсорбционный Dalgakiran DA'))
        self.assertEqual(o['errors'], [])

    def test_04_altitude_heat(self):
        o = self.sc(4)
        self.assertTrue(any('Условия выше номинальных для электродвигателя' in w for w in o['warnings']), o['warnings'])
        self.assertTrue(any('Снижение мощности двигателей' in w for w in o['weak']))
        # 40 + 5 = 45 °C в помещении (0,78), вход 55 °C (интерполяция 0,55): 8 бар… DK с поправками — не меньше 10,5
        d = self.names(o, 'dryer')
        self.assertTrue(d and 'DK' in d[0][0], d)
        self.assertEqual(o['errors'], [])

    def test_05_high_pressure(self):
        o = self.sc(5)
        self.assertEqual(self.names(o, 'compressor'), [('Компрессор винтовой Пример 9/13', 1)])
        # 11 + 0,1 + 0,1 + 0,2 + 0,1 = 11,5 бар; в нижней точке 13 − 1 = 12 ≥ 11,5
        self.assertTrue(self.step(o, 'press', 'давление включения')['ok'])
        self.assertEqual(o['errors'], [])
        self.assertTrue(all(p['qty'] for p in o['parts']))

    def test_06_oil_free(self):
        o = self.sc(6)
        # класс 1.2.1 → адсорбционный; 9 / 0,85 = 10,59 > 10 → два безмасляных (масляные не берутся: в ТЗ класс 0)
        self.assertEqual(self.names(o, 'compressor'), [('Компрессор винтовой безмасляный Пример ОФ-10', 2)])
        self.assertIn('10,59', self.step(o, 'air', 'Требуемая производительность')['result'])
        # осушитель на 20 м³/мин: DA при 7,1 бар → 1,012, вход 30 + 5 + 10 = 45 °C → 0,73: DA 1800 (30) → 22,16
        self.assertEqual(self.names(o, 'dryer'), [('Осушитель адсорбционный Dalgakiran DA 1800', 1)])
        self.assertIn('22,16', self.step(o, 'dryer', 'DA 1800')['result'])
        self.assertEqual(o['errors'], [])
        self.assertFalse(any('угольный' in e for e in o['errors']), 'безмасляный — угольный фильтр не ошибка')
        # давление: 8 бар у безмасляного — в нижней точке 7 < 7,6: предупреждение
        self.assertTrue(any('нижней точке регулирования' in w for w in o['warnings']))

    def test_07_dgu_prime(self):
        o = self.sc(7)
        self.assertEqual(self.names(o, 'dgu'), [('ДГУ Пример 200 кВт открытого исполнения', 1)])
        # средняя 180 · 0,6 = 108 ≤ 140 (0,7 · 200)
        self.assertTrue(self.step(o, 'dgu', 'Средняя нагрузка')['ok'])
        # топливо: нагрузка 108/200 = 0,54 → 27 + (40 − 27) · 0,16 = 29,08 л/ч · 24 · 1,1 = 767,7 л
        self.assertIn('нужно 768 л', self.step(o, 'dgu', 'Запас топлива')['result'])
        self.assertEqual(o['errors'], [])

    def test_08_dgu_standby(self):
        o = self.sc(8)
        # резервный (ESP): 300 кВт → наименьший с ESP ≥ 300 — 320 кВт (ESP 352)… подбор идёт по PRP — 320
        self.assertEqual(self.names(o, 'dgu'), [('ДГУ Пример 320 кВт открытого исполнения', 1)])
        self.assertIn('ESP', self.step(o, 'dgu', 'Мощность ESP')['result'])
        # пуск 55 кВт прямой: 7 · 55 / (0,85 · 0,93) = 487 кВА при генераторе 400 кВА → предупреждение
        self.assertIn('487', self.step(o, 'dgu', 'Пуск наибольшего двигателя от ДГУ')['result'])
        self.assertTrue(any('Пусковая мощность' in w for w in o['warnings']))
        self.assertTrue(o['req'].get('ats'), 'I категория — АВР')
        self.assertTrue(any('АВР' in p['name'] for p in o['parts']))

    def test_09_dgu_kva_reserve(self):
        o = self.sc(9)
        # 500 кВА · 0,8 = 400 кВт; 2 + 1: два рабочих по 200 + резервный 200 (наименьший избыток)
        self.assertEqual(self.names(o, 'dgu'), [('ДГУ Пример 200 кВт открытого исполнения', 3)])
        self.assertEqual(o['errors'], [])

    def test_10_conflict(self):
        o = self.sc(10)
        self.assertEqual([c['key'] for c in o['tz']['conflicts']], ['flow'])
        self.assertTrue(any('разные значения — 10; 12; принято 12' in q for q in o['tz']['later']))
        self.assertEqual(o['tz']['questions'], [], 'заказчика не дёргаем')
        self.assertEqual(o['req']['flow'], '12', 'принято большее — в пользу заказчика')

    def test_11_minimal(self):
        o = self.sc(11)
        st = {f['key']: f['status'] for f in o['tz']['fields']}
        self.assertEqual((st['flow'], st['pressure'], st['tmax']), ('found', 'missing', 'missing'))
        self.assertTrue(any('давление' in q for q in o['questions']))
        # остальное заказчика не дёргает: по умолчанию с запасом, вопрос — «можно уточнить позже»
        self.assertTrue(any('Максимальная температура' in q for q in o['later']))
        self.assertFalse(any('Максимальная температура' in q for q in o['questions']))
        self.assertEqual(o['errors'], [], 'без данных — не ошибка')

    def test_12_manual_edit(self):
        o = self.sc(12)
        # подобрано на 10 (13 м³/мин), менеджер поднял до 14 — расчёт показывает ошибку
        self.assertTrue(any('меньше требуемой 14' in e for e in o['errors']), o['errors'])

    def test_all_have_appendix(self):
        for o in self.out:
            with self.subTest(o['name']):
                if o['steps']:
                    self.assertIn('Приложение. Расчётная записка и состав станции', o['groups'])
                    self.assertTrue(o['version'])


if __name__ == '__main__':
    unittest.main()
