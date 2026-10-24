# -*- coding: utf-8 -*-
"""Раздел «Экономика сделки» Битрикс24 ↔ экономика КП (app/deal_econ.py, 3.206.0): поля раздела — по названиям; значения
из экономики последнего КП уходят в поля сделки, когда экономика изменилась; правка статьи в Битриксе — поправкой в КП
(пересчёт сервера сверяется с расчётом программы, tests/js/deal_bx_fix.js); правка итога — пометкой. Временная база,
вымышленные данные."""
import json
import os
import shutil
import subprocess
import unittest

from kit import TempStore

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Cases:
    _rows = None

    @classmethod
    def rows(cls):
        if cls._rows is None:
            node = shutil.which('node')
            if not node:
                raise unittest.SkipTest('нет Node.js')
            out = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'deal_bx_fix.js')], cwd=REPO, capture_output=True,
                                 text=True, timeout=120, check=True)
            cls._rows = json.loads(out.stdout)
        return cls._rows


class ShiftTest(unittest.TestCase):
    """Пересчёт сервера = расчёт программы (до копейки; проценты — до 0,0001)."""

    def test_same_as_program(self):
        from deal_econ import EconShift, EconValues
        items = EconValues.by_key()
        for row in Cases.rows():
            with self.subTest(row['name']):
                got = EconShift.apply(row['before'], items[row['key']], row['delta'])
                want = row['after']
                for key in ('profit', 'net', 'lo', 'hi'):
                    if key in want:
                        self.assertAlmostEqual(got[key], want[key], delta=1.01 if key in ('lo', 'hi') else 0.011, msg=key)
                for key in ('margin', 'markup', 'marginLo', 'marginHi'):
                    if want.get(key) is not None:
                        self.assertAlmostEqual(got[key], want[key], places=4, msg=key)
                self.assertAlmostEqual(got['full']['cost'], want['full']['cost'], delta=0.011)
                self.assertEqual(got['full']['fix'], want['full']['fix'])
                values = EconValues.of_summary(got)
                self.assertAlmostEqual(values[row['key']], row['raw'] + row['delta'], delta=0.011, msg='статья с поправкой')

    def test_stale_fix_ignored(self):
        """Статью пересчитали в программе (не равна base) — поправка не действует."""
        for row in Cases.rows():
            self.assertEqual(row['stale']['full']['fix'], {}, row['name'])
            self.assertEqual(row['stale'].get('profit'), row['before'].get('profit'), row['name'])


class MatchTest(unittest.TestCase):
    def test_titles(self):
        from deal_econ import EconValues
        for title, key in (('Маржинальность, %', 'margin'), ('Маржа ожидаемая', 'profit'), ('Наценка', 'markup'),
                           ('Себестоимость', 'cost'), ('Логистика', 'logistics'), ('Доставка до клиента', 'logistics'),
                           ('Таможенные платежи', 'customs'), ('Закупка оборудования', 'equip'), ('Монтаж / ПНР', 'mount'),
                           ('Чистая прибыль', 'net'), ('Выручка без НДС', 'revenue'), ('Прочие расходы', 'other'),
                           ('Источник', '')):
            self.assertEqual(EconValues.match(title), key, title)


class FlowTest(unittest.TestCase):
    """Сделка с КП: поля раздела заполняются, правка логистики в Битриксе — поправка в КП и новые итоги."""

    LOGI, PROFIT, MARGIN = 'UF_CRM_LOGI', 'UF_CRM_PROFIT', 'UF_CRM_MARGIN'

    def setUp(self):
        from crm import DealBook
        from crm_funnels import DealFields
        from deal_econ import DealEcon
        self.st = TempStore(self).store
        self.orig = DealEcon.enabled
        DealEcon.enabled = lambda econ: True
        self.addCleanup(setattr, DealEcon, 'enabled', self.orig)
        rows = [{'code': self.LOGI, 'title': 'Логистика', 'label': 'Логистика', 'type': 'money', 'on': []},
                {'code': self.PROFIT, 'title': 'Прибыль', 'label': 'Прибыль', 'type': 'double', 'on': []},
                {'code': self.MARGIN, 'title': 'Маржинальность, %', 'label': 'Маржинальность, %', 'type': 'string', 'on': []},
                {'code': 'UF_CRM_SRC', 'title': 'Источник', 'label': 'Источник', 'type': 'string', 'on': []}]
        DealFields(self.st).save_defs(rows, {})
        self.st.kv_set(DealEcon.KEY, {'codes': [self.LOGI, self.PROFIT, self.MARGIN, 'UF_CRM_SRC']})
        DealEcon(self.st).mark()
        self.case = Cases.rows()[0]
        meta = {'id': 'k1', 'number': 'k1', 'client': 'ООО «А»', 'authorId': 'm1', 'managerId': 'm1', 'date': '2026-10-24',
                'sum': 122000000, 'deal': self.case['before']}
        self.st.kp_set('k1', 'state', json.dumps({'number': 'k1', 'deal': {'touched': True}}, ensure_ascii=False), 'тест')
        self.st.kp_set('k1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        self.did = DealBook(self.st).on_kp('k1', meta, 'тест')

    def deal(self):
        from crm import DealBook
        return DealBook(self.st).get(self.did)

    def test_fill_and_back(self):
        from deal_econ import DealEcon
        uf = self.deal()['uf']
        self.assertEqual(uf[self.LOGI], '60000|RUB')
        self.assertEqual(uf[self.PROFIT], '516450.27')
        self.assertNotIn('UF_CRM_SRC', uf, 'не экономика — не заполняется')
        said = DealEcon(self.st).from_bitrix(self.did, {self.LOGI: '160000|RUB'}, 'Битрикс24')
        self.assertEqual(len(said), 1)
        state = json.loads(self.st.kp_get('k1', 'state'))
        self.assertEqual(state['deal']['bxFix']['logistics']['to'], 160000)
        self.assertEqual(state['deal']['bxFix']['logistics']['base'], 60000)
        meta = json.loads(self.st.kp_get('k1', 'meta'))
        self.assertAlmostEqual(meta['deal']['profit'], self.case['after']['profit'], delta=0.011)
        uf = self.deal()['uf']
        self.assertEqual(uf[self.LOGI], '160000|RUB', 'логистика — как в Битриксе')
        self.assertAlmostEqual(float(uf[self.PROFIT]), self.case['after']['profit'], delta=0.011, msg='прибыль пересчитана')

    def test_total_note(self):
        from deal_econ import DealEcon
        said = DealEcon(self.st).from_bitrix(self.did, {self.PROFIT: '600000'}, 'Битрикс24')
        self.assertEqual(said, [])
        deal = self.deal()
        self.assertIn(self.PROFIT, deal['econNotes'], 'итог — пометкой')
        self.assertEqual(json.loads(self.st.kp_get('k1', 'meta'))['deal'], self.case['before'], 'экономика не меняется')

    def test_bitrix_edit_kept_until_program_changes(self):
        from crm import DealBook
        book = DealBook(self.st)
        book.put_uf(self.did, {self.PROFIT: '1'}, 'Битрикс24')
        book.autofill(self.did, 'тест')
        self.assertEqual(self.deal()['uf'][self.PROFIT], '1', 'экономика не менялась — правка Битрикса остаётся')
        meta = json.loads(self.st.kp_get('k1', 'meta'))
        meta['deal'] = self.case['after']
        self.st.kp_set('k1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        book.autofill(self.did, 'тест')
        self.assertAlmostEqual(float(self.deal()['uf'][self.PROFIT]), self.case['after']['profit'], delta=0.011)

    def test_regs_fields_skipped(self):
        """Поля регламента («Маржа ожидаемая») — регламенту, не разделу экономики."""
        from deal_econ import DealEcon
        from deal_rules import DealRegs
        orig = DealRegs.codes
        DealRegs.codes = lambda regs: {'margin': self.PROFIT}
        self.addCleanup(setattr, DealRegs, 'codes', orig)
        self.assertNotIn(self.PROFIT, DealEcon(self.st).pairs())


class DiscoverTest(unittest.TestCase):
    """Раздел «Экономика сделки» — по настройке карточки сделки портала (общей и воронок)."""

    class Api:
        def __init__(self):
            self.calls = []

        def call(self, method, params):
            self.calls.append((method, params))
            if params.get('extras'):
                raise RuntimeError('нет права')
            return [{'name': 'main', 'title': 'О сделке', 'elements': [{'name': 'TITLE'}, {'name': 'UF_CRM_SRC'}]},
                    {'name': 'econ', 'title': 'Экономика сделки', 'elements': [{'name': 'UF_CRM_LOGI'}, {'name': 'OPPORTUNITY'},
                                                                                {'name': 'UF_CRM_MARGIN'}]}]

    def test_section(self):
        from crm_funnels import DealFields
        from deal_econ import DealEcon
        st = TempStore(self).store
        rows = [{'code': code, 'title': title, 'label': title, 'type': kind, 'on': []}
                for code, title, kind in (('UF_CRM_LOGI', 'Логистика', 'money'), ('UF_CRM_MARGIN', 'Маржинальность, %', 'string'),
                                          ('UF_CRM_SRC', 'Источник', 'string'))]
        DealFields(st).save_defs(rows, {})
        api = self.Api()
        found = DealEcon(st).discover(api, ['0', '3'])
        self.assertEqual(found['codes'], ['UF_CRM_LOGI', 'UF_CRM_MARGIN'])
        self.assertEqual(found['section'], 'Экономика сделки')
        self.assertEqual(api.calls[-1][1]['extras'], {'dealCategoryId': 3}, 'воронки — тоже (сбой не мешает)')
        self.assertEqual({code: item.key for code, item in DealEcon(st).pairs().items()},
                         {'UF_CRM_LOGI': 'logistics', 'UF_CRM_MARGIN': 'margin'})
        self.assertIn('UF_CRM_LOGI', DealFields(st).codes(), 'поля раздела хранятся в программе и ходят в обмене')
        view = DealEcon(st).save({'map': {'UF_CRM_LOGI': '', 'UF_CRM_SRC': 'profit'}})
        self.assertEqual({row['code']: row['key'] for row in view['rows']},
                         {'UF_CRM_LOGI': '', 'UF_CRM_MARGIN': 'margin', 'UF_CRM_SRC': 'profit'})
        with self.assertRaises(ValueError):
            DealEcon(st).save({'map': {'UF_CRM_NOPE': 'profit'}})
        with self.assertRaises(ValueError):
            DealEcon(st).save({'map': {'UF_CRM_SRC': 'nope'}})


if __name__ == '__main__':
    unittest.main()
