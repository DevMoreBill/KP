# -*- coding: utf-8 -*-
"""Кабинет как Битрикс24 (crm_funnels.py, bitrix_mirror*.py): воронки со своими стадиями, стадии провала как причина, ход КП
двигает сделку в воронке Битрикса, поля сделки Битрикса (проверка ввода, только для чтения), миграция столбца воронки;
на подставном Битриксе — структура портала, выбор полей по заполненности, загрузка сделок, стадия и поля в обе стороны,
перенос сделки в другую воронку, перенос прежних связанных сделок."""
import json
import unittest
import urllib.request
from datetime import date

from bitrix_fake import FakeBitrix
from kit import Schema, TempStore

FUNNEL = {
    'id': 'b3', 'bx': '3', 'name': 'Продажи оборудования',
    'stages': [{'key': 'C3:NEW', 'label': 'Новая', 'sem': ''}, {'key': 'C3:PREPARATION', 'label': 'КП отправлено', 'sem': ''},
               {'key': 'C3:EXECUTING', 'label': 'Переговоры', 'sem': ''}, {'key': 'C3:WON', 'label': 'Успешно', 'sem': 'won'},
               {'key': 'C3:PRICE', 'label': 'Высокая цена', 'sem': 'lost'}, {'key': 'C3:LOSE', 'label': 'Провал', 'sem': 'lost'}],
    'track': {'lead': 'C3:NEW', 'sent': 'C3:PREPARATION', 'talks': 'C3:EXECUTING'},
}
FIELDS = [
    {'code': 'UF_CRM_REGION', 'title': 'Регион1', 'label': 'Регион', 'type': 'enumeration', 'multiple': False, 'on': ['b3'],
     'items': [{'id': '10', 'value': 'Москва'}, {'id': '11', 'value': 'Казань'}]},
    {'code': 'UF_CRM_SUM', 'title': 'Сумма счета', 'label': 'Сумма счета', 'type': 'double', 'multiple': False, 'on': ['b3']},
    {'code': 'UF_CRM_FILE', 'title': 'Счет / ТКП', 'label': 'Счет / ТКП', 'type': 'file', 'multiple': True, 'on': ['b3']},
]


def direct():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


class FunnelTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        from crm_funnels import DealFields, Funnels
        Funnels(self.st).save_mirror([dict(FUNNEL)])
        DealFields(self.st).save_defs([dict(row) for row in FIELDS], {'7': 'Иванова Анна'})

    def book(self):
        from crm import DealBook
        return DealBook(self.st)

    def test_closed_by_order(self):
        """Портал не прислал вид стадий: «…:WON» — успех, «…:LOSE» и всё после успеха — провал (стадии-причины отказа)."""
        from crm_funnels import Funnels
        raw = [{'key': k, 'label': k, 'sem': ''} for k in ('C9:NEW', 'C9:1', 'C9:WON', 'C9:LOSE', 'C9:5', 'C9:6')]
        self.assertEqual([row['sem'] for row in Funnels.closed_by_order(raw)], ['', '', 'won', 'lost', 'lost', 'lost'])
        self.st.kv_set('crm.funnels', {'list': [dict(FUNNEL, id='b9', bx='9', stages=raw)]})
        self.assertEqual(Funnels(self.st).open_keys('b9'), ['C9:NEW', 'C9:1'])
        self.assertEqual(Funnels(self.st).resolve('b9', 'C9:6'), ('lost', 'C9:6'))
        conn = self.st.conn()
        conn.execute("INSERT INTO deals (id, doc, manager_id, stage, funnel, rev) VALUES ('d900', '{}', 'm1', 'C9:6', 'b9', 1)")
        from storage import _fill_funnel_closed
        _fill_funnel_closed(self.st, conn)
        conn.commit()
        self.assertEqual(self.st.one("SELECT stage FROM deals WHERE id='d900'")[0], 'lost', 'миграция: сделка на стадии провала')

    def test_funnels_and_stages(self):
        from crm_funnels import Funnels
        funnels = Funnels(self.st)
        self.assertEqual([row['id'] for row in funnels.all()], ['main', 'b3'])
        self.assertEqual(funnels.resolve('b3', 'C3:PRICE'), ('lost', 'C3:PRICE'))
        self.assertEqual(funnels.resolve('b3', 'lost'), ('lost', 'C3:PRICE'), 'общее «проиграно» — первая стадия провала')
        self.assertEqual(funnels.resolve('b3', 'C3:EXECUTING'), ('C3:EXECUTING', 'C3:EXECUTING'))
        self.assertIsNone(funnels.resolve('b3', 'talks'), 'этап своей воронки — не стадия воронки Битрикса')
        self.assertEqual(funnels.resolve('main', 'talks'), ('talks', 'talks'))
        self.assertEqual(funnels.for_new('m1'), 'main')
        funnels.options({'newDeals': 'b3'})
        self.assertEqual(funnels.for_new('m1'), 'b3')
        with self.assertRaises(ValueError):
            funnels.options({'funnels': {'b3': {'track': {'sent': 'C3:LOSE'}}}})
        funnels.options({'funnels': {'b3': {'hidden': True}}})
        self.assertEqual(funnels.for_new('m1'), 'main', 'скрытая воронка — новые сделки в свою')

    def test_deal_in_bitrix_funnel(self):
        book = self.book()
        deal = book.create({'client': 'ООО «Альфа»', 'funnel': 'b3'}, 'm1', 'Иванова', 'тест')
        self.assertEqual((deal['funnel'], deal['stage'], deal.get('fstage')), ('b3', 'C3:NEW', 'C3:NEW'))
        deal = book.update(deal['id'], {'stage': 'C3:EXECUTING'}, 'тест')
        self.assertEqual(deal['stage'], 'C3:EXECUTING')
        deal = book.update(deal['id'], {'stage': 'C3:PRICE'}, 'тест')
        self.assertEqual((deal['stage'], deal['fstage'], deal['lostReason']), ('lost', 'C3:PRICE', 'Высокая цена'))
        self.assertEqual(self.st.one('SELECT stage, funnel FROM deals WHERE id=?', (deal['id'],)), ('lost', 'b3'))
        deal = book.update(deal['id'], {'stage': 'won'}, 'тест')
        self.assertEqual((deal['stage'], deal['fstage']), ('won', 'C3:WON'))
        self.assertNotIn('lostReason', deal)
        with self.assertRaises(ValueError):
            book.update(deal['id'], {'stage': 'talks'}, 'тест')
        deal = book.update(deal['id'], {'funnel': 'main'}, 'тест')
        self.assertEqual((deal['funnel'], deal['stage']), ('main', 'lead'), 'другая воронка — первая стадия')
        self.assertNotIn('fstage', deal)
        what = [row['what'] for row in deal['history']]
        self.assertIn('funnel', what)

    def test_bitrix_fields_input(self):
        book = self.book()
        deal = book.create({'client': 'ООО «Бета»', 'funnel': 'b3'}, 'm1', 'Иванова', 'тест')
        deal = book.update(deal['id'], {'uf': {'UF_CRM_REGION': '11', 'UF_CRM_SUM': '1 500,5'}}, 'тест')
        self.assertEqual(deal['uf'], {'UF_CRM_REGION': '11', 'UF_CRM_SUM': '1500.5'})
        self.assertEqual(deal['history'][-1]['fields'], ['UF_CRM_REGION', 'UF_CRM_SUM'])
        for bad in ({'UF_CRM_REGION': '99'}, {'UF_CRM_SUM': 'много'}, {'UF_CRM_FILE': 'x'}, {'UF_CRM_OTHER': '1'}):
            with self.assertRaises(ValueError, msg=bad):
                book.update(deal['id'], {'uf': bad}, 'тест')
        deal = book.update(deal['id'], {'uf': {'UF_CRM_SUM': ''}}, 'тест')
        self.assertEqual(deal['uf'], {'UF_CRM_REGION': '11'}, 'пустое значение не хранится')

    def test_kp_moves_stage_in_bitrix_funnel(self):
        from crm_funnels import Funnels
        Funnels(self.st).options({'newDeals': 'b3'})
        meta = {'id': '1', 'number': '1', 'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'authorId': 'm1', 'manager': 'Иванова',
                'date': date.today().isoformat(), 'items': ['Компрессор']}
        self.st.kp_set('1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        book = self.book()
        did = book.on_kp('1', meta, 'тест')
        self.assertEqual((book.get(did)['funnel'], book.get(did)['stage']), ('b3', 'C3:NEW'))
        self.st.kp_track_set('1', {'status': 'sent'})
        book.refresh('1', 'тест')
        self.assertEqual(book.get(did)['stage'], 'C3:PREPARATION', 'КП отправлено → стадия по соответствию')
        self.st.kp_track_set('1', {'status': 'won'})
        book.refresh('1', 'тест')
        self.assertEqual(book.get(did)['stage'], 'C3:PREPARATION', '«Договор» без стадии — сделка не двигается')
        self.st.kp_track_set('1', {'status': 'lost', 'reason': 'Цена'})
        book.refresh('1', 'тест')
        deal = book.get(did)
        self.assertEqual((deal['stage'], deal['fstage'], deal['lostReason']), ('lost', 'C3:PRICE', 'Цена'))

    def test_migration_funnel_column(self):
        from crm import DealBook
        deal = DealBook(self.st).create({'client': 'ООО «Гамма»'}, 'm1', 'Иванова', 'тест')
        Schema.down_to(self.st, '2027-15-crm-funnels')
        self.assertNotIn('funnel', [row[1] for row in self.st.all('PRAGMA table_info(deals)')])
        self.st.migrations_up()
        self.assertEqual(self.st.one('SELECT funnel FROM deals WHERE id=?', (deal['id'],)), ('main',))
        self.assertEqual(DealBook(self.st).get(deal['id'])['funnel'], 'main')


class MirrorSyncTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeBitrix()
        self.addCleanup(self.fake.stop)
        fake = self.fake
        fake.stages['DEAL_STAGE_3'].insert(5, ('C3:PRICE', 'Высокая цена', 'F'))
        fake.portal_fields = [
            {'FIELD_NAME': 'UF_CRM_REGION', 'USER_TYPE_ID': 'enumeration', 'L': 'Регион1', 'ITEMS': [{'ID': '10', 'VALUE': 'Москва'}, {'ID': '11', 'VALUE': 'Казань'}]},
            {'FIELD_NAME': 'UF_CRM_NOTE', 'USER_TYPE_ID': 'string', 'L': 'Рабочий комментарий'},
            {'FIELD_NAME': 'UF_CRM_EMPTY', 'USER_TYPE_ID': 'string', 'L': 'Редкое поле'},
            {'FIELD_NAME': 'UF_CRM_SYS', 'USER_TYPE_ID': 'string', 'L': 'Служебное поле - стадия'},
        ]
        self.st = TempStore(self).store
        st = self.st
        st.manager_put('m1', json.dumps({'name': 'Иванова Анна', 'email': 'ivanova@example.com'}, ensure_ascii=False), 'тест')
        from bitrix import BitrixConf
        BitrixConf(st).save({'url': fake.url, 'category': '3', 'on': True, 'users': {'m1': '7'},
                             'stages': {'lead': 'C3:NEW', 'sent': 'C3:PREPARATION', 'talks': 'C3:EXECUTING', 'won': 'C3:WON', 'lost': 'C3:LOSE'}}, 'тест')
        self.open = fake.new_deal(TITLE='Открытая', STAGE_ID='C3:EXECUTING', UF_CRM_REGION='11', UF_CRM_NOTE='звонить в среду', UF_CRM_SYS='x')
        self.closed = fake.new_deal(TITLE='Проиграна', STAGE_ID='C3:PRICE', CLOSED='Y', UF_CRM_REGION='10', UF_CRM_NOTE='дорого')
        for i in range(3):
            fake.new_deal(TITLE=f'Ещё {i}', STAGE_ID='C3:NEW', UF_CRM_NOTE='есть', CLOSED='N')
        fake.deals[self.open]['CLOSED'] = 'N'
        fake.add_activity(self.open, 'Позвонить', '2026-11-01T10:00:00+03:00')

    def load(self):
        from bitrix_mirror_load import MirrorImport, MirrorStructure
        MirrorStructure(self.st, direct()).load()
        return MirrorImport(self.st, direct()).run()

    def test_structure_import_and_exchange(self):
        from bitrix import BitrixLinks, BitrixQueue, BitrixSync
        from crm import DealBook
        from crm_funnels import DealFields, Funnels
        res = self.load()
        funnels = Funnels(self.st)
        self.assertEqual([row['id'] for row in funnels.mirror()], ['b0', 'b3'])
        self.assertEqual(funnels.get('b3')['track'], {'lead': 'C3:NEW', 'sent': 'C3:PREPARATION', 'talks': 'C3:EXECUTING'},
                         'ход КП → стадии — из прежнего соответствия этапов')
        on = {row['code']: row for row in DealFields(self.st).shown('b3')}
        self.assertEqual(sorted(on), ['UF_CRM_NOTE', 'UF_CRM_REGION'], 'заполненные поля; служебное и пустое — нет')
        self.assertEqual(on['UF_CRM_REGION']['label'], 'Регион')
        self.assertEqual(on['UF_CRM_REGION']['items'][1], {'id': '11', 'value': 'Казань'})
        self.assertEqual((res['created'], res['skipped']), (5, 0), res)
        links = BitrixLinks(self.st)
        did = links.local('deal', self.open)
        deal = DealBook(self.st).get(did)
        self.assertEqual((deal['funnel'], deal['stage'], deal['managerId']), ('b3', 'C3:EXECUTING', 'm1'))
        self.assertEqual(deal['uf'], {'UF_CRM_REGION': '11', 'UF_CRM_NOTE': 'звонить в среду'})
        lost = DealBook(self.st).get(links.local('deal', self.closed))
        self.assertEqual((lost['stage'], lost['fstage'], lost['lostReason']), ('lost', 'C3:PRICE', 'Высокая цена'))
        self.assertEqual(res['tasks'], 1, 'открытое дело загруженной сделки')
        # в Битриксе сменили стадию и поле — в программу
        self.fake.edit_deal(self.open, STAGE_ID='C3:PREPARATION', UF_CRM_NOTE='перезвонить')
        BitrixSync(self.st, direct()).run_now()
        deal = DealBook(self.st).get(did)
        self.assertEqual((deal['stage'], deal['uf']['UF_CRM_NOTE']), ('C3:PREPARATION', 'перезвонить'))
        # в программе — поле и стадия провала: в Битрикс как есть
        DealBook(self.st).update(did, {'uf': {'UF_CRM_REGION': '10'}, 'stage': 'C3:PRICE'}, 'Иванова')
        BitrixQueue.touch(self.st, 'deal', did)
        BitrixSync(self.st, direct()).run_now()
        bx = self.fake.deals[self.open]
        self.assertEqual((bx['STAGE_ID'], bx['UF_CRM_REGION']), ('C3:PRICE', '10'))
        # перенос в другую воронку
        DealBook(self.st).update(did, {'funnel': 'b0'}, 'Иванова')
        BitrixQueue.touch(self.st, 'deal', did)
        BitrixSync(self.st, direct()).run_now()
        self.assertEqual((bx['CATEGORY_ID'], bx['STAGE_ID']), ('0', 'NEW'))
        self.assertIn('crm.item.update', self.fake.methods())
        # снова загрузка — без дублей
        res = self.load()
        self.assertEqual((res['created'], res['updated']), (0, 5), res)

    def test_econ_section_both_ways(self):
        """Раздел «Экономика сделки» (deal_econ.py): поля — из карточки портала, значения — из экономики КП в Битрикс;
        логистику поменяли в Битриксе — поправка в КП, прибыль пересчитана и ушла обратно."""
        from bitrix import BitrixLinks, BitrixQueue, BitrixSync
        from crm import DealBook
        from test_deal_econ import Cases
        self.fake.portal_fields += [{'FIELD_NAME': 'UF_CRM_LOGI', 'USER_TYPE_ID': 'money', 'L': 'Логистика'},
                                    {'FIELD_NAME': 'UF_CRM_PROF', 'USER_TYPE_ID': 'double', 'L': 'Прибыль'}]
        self.fake.card = [{'name': 'econ', 'title': 'Экономика сделки', 'elements': [{'name': 'UF_CRM_LOGI'}, {'name': 'UF_CRM_PROF'}]}]
        self.load()
        case = Cases.rows()[0]
        meta = {'id': 'k1', 'number': 'k1', 'client': 'ООО «А»', 'authorId': 'm1', 'managerId': 'm1', 'date': '2026-10-24',
                'sum': 122000000, 'deal': case['before']}
        self.st.kp_set('k1', 'state', json.dumps({'number': 'k1', 'deal': {'touched': True}}, ensure_ascii=False), 'тест')
        self.st.kp_set('k1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        did = DealBook(self.st).on_kp('k1', meta, 'тест')
        BitrixQueue.touch(self.st, 'deal', did)
        BitrixSync(self.st, direct()).run_now()
        bid = BitrixLinks(self.st).get('deal', did)['bx']
        bx = self.fake.deals[bid]
        self.assertEqual((bx['UF_CRM_LOGI'], float(bx['UF_CRM_PROF'])), ('60000|RUB', 516450.27))
        self.fake.edit_deal(bid, UF_CRM_LOGI='160000|RUB')
        BitrixSync(self.st, direct()).run_now()
        BitrixSync(self.st, direct()).run_now()
        fix = json.loads(self.st.kp_get('k1', 'state'))['deal']['bxFix']['logistics']
        self.assertEqual((fix['to'], fix['base']), (160000, 60000))
        self.assertAlmostEqual(float(bx['UF_CRM_PROF']), case['after']['profit'], delta=0.011, msg='прибыль — обратно в Битрикс')
        self.assertEqual(bx['UF_CRM_LOGI'], '160000|RUB', 'логистика — как поменяли в Битриксе')

    def test_econ_payments_list(self):
        """Список «Оплаты» (bitrix_econ_list.py): находится по полям, элемент на каждую отмеченную оплату клиента — сумма,
        закупка и доставка в доле оплаты, НДС; закупку поправили в элементе — поправка в КП и элемент по новой экономике."""
        from bitrix import BitrixLinks, BitrixQueue, BitrixSync
        from crm import DealBook
        from crm_exec import ExecBook
        from test_deal_econ import Cases
        fields = {'NAME': {'FIELD_ID': 'NAME', 'NAME': 'Название', 'TYPE': 'NAME'},
                  'PROPERTY_1': {'NAME': 'Дата поступления', 'TYPE': 'S:Date'}, 'PROPERTY_2': {'NAME': 'Сумма поступлений', 'TYPE': 'N'},
                  'PROPERTY_3': {'NAME': 'Поставщик', 'TYPE': 'S'}, 'PROPERTY_4': {'NAME': 'Закупочная цена', 'TYPE': 'N'},
                  'PROPERTY_5': {'NAME': 'Ст-ть доставки', 'TYPE': 'N'}, 'PROPERTY_6': {'NAME': 'Прочие расходы', 'TYPE': 'N'},
                  'PROPERTY_7': {'NAME': 'НДС включен в закупку', 'TYPE': 'L', 'DISPLAY_VALUES_FORM': {'71': 'Да', '72': 'Нет'}},
                  'PROPERTY_8': {'NAME': 'Ставка НДС', 'TYPE': 'L', 'DISPLAY_VALUES_FORM': {'81': '22', '82': '20', '83': 'Без НДС'}},
                  'PROPERTY_9': {'NAME': 'Сделка', 'TYPE': 'S:ECrm', 'USER_TYPE_SETTINGS': {'DEAL': 'Y'}}}
        self.fake.lists = [{'ID': '40', 'NAME': 'Претензия по браку', 'TYPE': 'lists', 'FIELDS': {'PROPERTY_1': {'NAME': 'Дата', 'TYPE': 'S:Date'}}, 'ELEMENTS': {}},
                           {'ID': '41', 'NAME': 'Оплаты', 'TYPE': 'lists', 'FIELDS': fields, 'ELEMENTS': {}}]
        self.load()
        from bitrix_econ_list import EconList
        view = EconList(self.st).view()
        self.assertEqual((view['list']['name'], view['link']), ('Оплаты', 'поле «Сделка» в списке'))
        self.assertEqual({row['key']: row['field'] for row in view['fields']}['delivery'], 'Ст-ть доставки')
        case = Cases.rows()[0]
        before = dict(case['before'], full=dict(case['before']['full'], sup=[{'name': 'ООО «Поставщик»', 'vatIn': True}]))
        meta = {'id': 'k1', 'number': 'k1', 'client': 'ООО «А»', 'authorId': 'm1', 'managerId': 'm1', 'date': '2026-10-24',
                'sum': 122000000, 'deal': before,
                'plan': {'start': '2026-10-24', 'steps': [{'k': 'adv', 'd': 0, 't': 'Аванс 50 %', 'p': 'cust', 'a': 610000},
                                                          {'k': 'rest', 'd': 30, 't': 'Остаток', 'p': 'cust', 'a': 610000}]}}
        self.st.kp_set('k1', 'state', json.dumps({'number': 'k1', 'deal': {'touched': True}}, ensure_ascii=False), 'тест')
        self.st.kp_set('k1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        did = DealBook(self.st).on_kp('k1', meta, 'тест')
        ExecBook(self.st).mark(did, 'p:adv', '2026-10-25', 'тест')
        BitrixQueue.touch(self.st, 'deal', did)
        BitrixSync(self.st, direct()).run_now()
        bid = BitrixLinks(self.st).get('deal', did)['bx']
        items = list(self.fake.lists[1]['ELEMENTS'].values())
        self.assertEqual(len(items), 1, 'элемент — только на отмеченную оплату')
        item = items[0]
        value = lambda f: next(iter(item[f].values()))  # noqa: E731
        self.assertEqual((value('PROPERTY_1'), value('PROPERTY_2'), value('PROPERTY_4'), value('PROPERTY_5')),
                         ('25.10.2026', '610000.00', '250000.00', '30000.00'))
        self.assertEqual((value('PROPERTY_3'), value('PROPERTY_7'), value('PROPERTY_8'), value('PROPERTY_9')),
                         ('ООО «Поставщик»', '71', '81', bid))
        # закупку в элементе поправили в Битриксе: 250 000 → 300 000 при доле 0,5 — закупка сделки +100 000
        item['PROPERTY_4'] = {'1': '300000'}
        BitrixSync(self.st, direct()).run_now()
        BitrixSync(self.st, direct()).run_now()
        fix = json.loads(self.st.kp_get('k1', 'state'))['deal']['bxFix']['equip']
        self.assertEqual((fix['to'], fix['base']), (600000, 500000))
        item = list(self.fake.lists[1]['ELEMENTS'].values())[0]
        self.assertEqual(float(next(iter(item['PROPERTY_4'].values()))), 300000, 'элемент совпадает с новой экономикой')
        sent = DealBook(self.st).get(did)['econList']['p:adv']['sent']
        self.assertEqual(sent['purchase'], 300000.0, 'новая экономика КП даёт то же значение — повторно не пишется')
        # отметку оплаты сняли — элемент убран
        ExecBook(self.st).mark(did, 'p:adv', '', 'тест')
        BitrixQueue.touch(self.st, 'deal', did)
        BitrixSync(self.st, direct()).run_now()
        self.assertEqual(self.fake.lists[1]['ELEMENTS'], {})

    def test_convert_linked_main_deals(self):
        from bitrix import BitrixLinks
        from bitrix_mirror_load import MirrorConvert, MirrorStructure
        from crm import DealBook
        deal = DealBook(self.st).create({'client': 'ООО «Альфа»', 'stage': 'talks'}, 'm1', 'Иванова', 'тест')
        BitrixLinks(self.st).put('deal', deal['id'], self.open, {'cat': '3', 'stage': 'C3:EXECUTING'})
        MirrorStructure(self.st, direct()).load()
        self.assertEqual(MirrorConvert(self.st).count(), 1)
        self.assertEqual(MirrorConvert(self.st).run('Админ'), 1)
        deal = DealBook(self.st).get(deal['id'])
        self.assertEqual((deal['funnel'], deal['stage']), ('b3', 'C3:EXECUTING'))
        self.assertEqual(MirrorConvert(self.st).count(), 0)


if __name__ == '__main__':
    unittest.main()
