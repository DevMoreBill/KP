# -*- coding: utf-8 -*-
"""Поля сделки Битрикс24 из КП (deal_autofill.py): пустые поля заполняются по позициям КП (бренд, вид оборудования, тема,
отдел, товар), клиенту (форма организации по ИНН, регион по адресу, тип компании — как у прежних сделок клиента), сумме КП
и прежним сделкам с той же категорией оборудования; изменённое или стёртое менеджером больше не трогается; спорное — не
угадывается; источник, реклама и запрошенный бренд — не заполняются."""
import json
import unittest

from kit import TempStore


def items(*pairs):
    return [{'id': str(i), 'value': value} for i, value in pairs]


FUNNEL = {
    'id': 'b3', 'bx': '3', 'name': 'Обращения',
    'stages': [{'key': 'C3:NEW', 'label': 'Новая', 'sem': ''}, {'key': 'C3:WON', 'label': 'Успешно', 'sem': 'won'},
               {'key': 'C3:LOSE', 'label': 'Провал', 'sem': 'lost'}],
    'track': {'lead': 'C3:NEW'},
}
ON = ['b3']
FIELDS = [
    {'code': 'UF_SRC', 'title': 'Сделка: источник', 'label': 'Сделка: источник', 'type': 'enumeration', 'on': ON,
     'items': items((1, 'Сайт'), (2, 'Звонок'))},
    {'code': 'UF_FORM', 'title': 'Форма организации', 'label': 'Форма организации', 'type': 'enumeration', 'on': ON,
     'items': items((10, 'Юр.лицо'), (11, 'ИП'), (12, 'Физ.лицо'))},
    {'code': 'UF_CTYPE', 'title': 'Тип компании', 'label': 'Тип компании', 'type': 'enumeration', 'on': ON,
     'items': items((20, 'Корпоративный'), (21, 'Дилер'))},
    {'code': 'UF_REGION', 'title': 'Регион1', 'label': 'Регион', 'type': 'enumeration', 'on': ON,
     'items': items((30, 'Москва, Москва'), (31, 'Московская обл., Химки'), (32, 'Татарстан, Казань'))},
    {'code': 'UF_TOPIC', 'title': 'Тема запроса', 'label': 'Тема запроса', 'type': 'enumeration', 'on': ON,
     'items': items((40, 'Насосы'), (41, 'Компрессоры'), (42, 'Генераторы'))},
    {'code': 'UF_EQUIP', 'title': 'Тип оборудования', 'label': 'Тип оборудования', 'type': 'enumeration', 'multiple': True,
     'on': ON, 'items': items((50, 'Генераторы Прочее'), (51, 'Мотопомпы импортные'), (52, 'Мотопомпы отечественные'),
                              (53, 'Компрессоры винтовые'))},
    {'code': 'UF_ASKED', 'title': 'Запрошенный Бренд', 'label': 'Запрошенный Бренд', 'type': 'enumeration', 'multiple': True,
     'on': ON, 'items': items((60, 'Abac'), (61, 'Koshin'))},
    {'code': 'UF_BRAND', 'title': 'Бренд по Сделке', 'label': 'Бренд по Сделке', 'type': 'enumeration', 'multiple': True,
     'on': ON, 'items': items((70, 'Abac'), (71, 'KOSHIN'), (72, 'Atlas Copco'))},
    {'code': 'UF_GOODS', 'title': 'Товар по Сделке', 'label': 'Товар по Сделке', 'type': 'string', 'on': ON},
    {'code': 'UF_SUM', 'title': 'Сумма счета / ТКП', 'label': 'Сумма счета / ТКП', 'type': 'money', 'on': ON},
    {'code': 'UF_DEPT', 'title': 'Отдел', 'label': 'Отдел', 'type': 'enumeration', 'on': ON,
     'items': items((80, 'Дизельные мотопомпы'), (81, 'Компрессорное оборудование'))},
    {'code': 'UF_SIZE', 'title': 'Размер партии', 'label': 'Размер партии', 'type': 'enumeration', 'on': ON,
     'items': items((90, 'Опт'), (91, 'Розница'))},
    {'code': 'UF_CHANCE', 'title': 'Вероятность Успеха', 'label': 'Вероятность Успеха', 'type': 'enumeration', 'on': ON,
     'items': items((100, '10% - Первичный контакт'), (101, '20% - Подготовка и отправка ТКП'))},
    {'code': 'UF_CHIEF', 'title': 'Руководитель Ответственного', 'label': 'Руководитель Ответственного по Сделке',
     'type': 'enumeration', 'on': ON, 'items': items((110, 'Касицын Александр'), (111, 'Петров Пётр'))},
    {'code': 'UF_ADS', 'title': 'Реклама', 'label': 'Реклама', 'type': 'enumeration', 'on': ON,
     'items': items((120, 'Нет'), (121, 'Яндекс'))},
    {'code': 'UF_NOTE', 'title': 'Рабочий комментарий', 'label': 'Рабочий комментарий к сделке', 'type': 'string', 'on': ON},
    {'code': 'UF_NOTEDAY', 'title': 'Дата рабочего комментария', 'label': 'Дата рабочего комментария', 'type': 'date', 'on': ON},
    {'code': 'UF_WORK', 'title': 'Описание работ', 'label': 'Описание работ/неисправности для модели №1', 'type': 'string',
     'on': ON},
]


class AutoFillTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        from crm_funnels import DealFields, Funnels
        Funnels(self.st).save_mirror([dict(FUNNEL)])
        Funnels(self.st).options({'newDeals': 'b3'})
        DealFields(self.st).save_defs([dict(row) for row in FIELDS], {})
        self.st.kv_set('types', {'version': 1, 'types': [{'id': 'mpump', 'name': 'Мотопомпы', 'item': 'Мотопомпа'}]})
        self.st.catalog_put('pump1', json.dumps({'id': 'pump1', 'name': 'Мотопомпа дизельная Koshin KTH-80',
                                                 'attrs': {'cat': 'mpump', 'maker': 'Koshin'}}, ensure_ascii=False), 'тест')
        self.st.client_put('inn7700000001', {'id': 'inn7700000001', 'name': 'ООО «Альфа»', 'inn': '7700000001',
                                             'address': '125009, г. Москва, ул. Тверская, д. 1'}, 'тест')

    def kp(self, kid, rub=1690000, inn='7700000001', cat_id='pump1', attrs=None):
        item = {'name': 'Мотопомпа дизельная Koshin KTH-80', 'catId': cat_id, 'qty': 1, 'price': rub}
        if attrs is not None:
            item['attrs'] = attrs
        meta = {'id': kid, 'number': kid, 'client': 'ООО «Альфа»', 'clientInn': inn, 'authorId': 'm1', 'manager': 'Иванова',
                'date': '2026-10-21', 'sum': rub * 100, 'cur': 'RUB', 'items': [item['name']]}
        self.st.kp_set(kid, 'state', json.dumps({'items': [item]}, ensure_ascii=False), 'тест')
        self.st.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        from crm import DealBook
        return DealBook(self.st).on_kp(kid, meta, 'Иванова')

    def deal(self, did):
        from crm import DealBook
        return DealBook(self.st).get(did)

    def test_fills_from_kp(self):
        did = self.kp('2026-089')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_FORM'), '10', 'ИНН из 10 цифр — юрлицо')
        self.assertEqual(uf.get('UF_REGION'), '30', 'регион — по адресу клиента, Химки и Казань не подходят')
        self.assertNotIn('UF_TOPIC', uf, '«Насосы» словами позиции не угадываются — без прошлых сделок не заполняется')
        self.assertEqual(uf.get('UF_BRAND'), ['71'], 'бренд — производитель позиции, без учёта регистра')
        self.assertEqual(uf.get('UF_GOODS'), 'Мотопомпа дизельная Koshin KTH-80')
        self.assertEqual(uf.get('UF_SUM'), '1690000|RUB', 'сумма КП: в сделке — копейки, в поле — рубли')
        self.assertEqual(uf.get('UF_DEPT'), '80', '«Дизельные мотопомпы» — по словам позиции')
        self.assertNotIn('UF_EQUIP', uf, 'импортные и отечественные мотопомпы одинаково подходят — не угадывается')
        self.assertEqual(uf.get('UF_ASKED'), ['61'], 'запрошенный бренд — по первому КП сделки (регламент)')
        for code in ('UF_SRC', 'UF_CTYPE', 'UF_SIZE'):
            self.assertNotIn(code, uf, code)
        self.assertEqual(set(self.deal(did)['ufAuto']), set(uf))
        hist = [row for row in self.deal(did)['history'] if row.get('what') == 'fields']
        self.assertTrue(hist and hist[-1].get('auto'), 'в истории — «поля Битрикс24 (из КП)»')

    def test_manager_choice_kept(self):
        from crm import DealBook
        did = self.kp('2026-089')
        book = DealBook(self.st)
        book.update(did, {'uf': {'UF_DEPT': '81', 'UF_REGION': ''}}, 'Иванова')
        self.kp('2026-090', rub=1920000)
        from crm import DealBook as Book
        Book(self.st).link(did, '2026-090', 'Иванова')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_DEPT'), '81', 'изменённое менеджером не перезаписывается')
        self.assertNotIn('UF_REGION', uf, 'стёртое менеджером не возвращается')

    def test_auto_value_follows_kp(self):
        did = self.kp('2026-089')
        self.st.kp_set('2026-089', 'meta', json.dumps({'id': '2026-089', 'number': '2026-089', 'client': 'ООО «Альфа»',
                                                       'clientInn': '7700000001', 'sum': 200000000, 'cur': 'RUB'}), 'тест')
        from crm import DealBook
        DealBook(self.st).refresh('2026-089', 'Иванова')
        self.assertEqual(self.deal(did)['uf'].get('UF_SUM'), '2000000|RUB', 'не правленное менеджером — по новому КП')

    def test_learns_from_past_deals(self):
        from crm import DealBook
        book = DealBook(self.st)
        for n in range(3):
            did = self.kp(f'2026-1{n}', inn=f'770000001{n}')
            book.update(did, {'uf': {'UF_EQUIP': ['52'], 'UF_TOPIC': '40', 'UF_SIZE': '91'}}, 'Иванова')
        did = self.kp('2026-200', inn='7700000099')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_EQUIP'), ['52'], 'мотопомпам трижды ставили «отечественные» — так и сейчас')
        self.assertEqual(uf.get('UF_TOPIC'), '40', 'тема — как в прошлых сделках с мотопомпами')
        self.assertEqual(uf.get('UF_SIZE'), '91', 'любое поле списка — по прошлым сделкам с той же категорией')

    def test_client_history(self):
        from crm import DealBook
        did = self.kp('2026-089')
        DealBook(self.st).update(did, {'uf': {'UF_CTYPE': '20'}}, 'Иванова')
        other = self.kp('2026-300')
        self.assertEqual(self.deal(other)['uf'].get('UF_CTYPE'), '20', 'тип компании — как у прежней сделки клиента')

    def test_context_fields(self):
        """Не из КП: вероятность — как на этой стадии, руководитель — как у менеджера, реклама — как при том же источнике,
        дата рабочего комментария — по правке комментария; «Описание работ» товаром не заполняется."""
        from crm import DealBook
        book = DealBook(self.st)
        for n in range(3):
            did = self.kp(f'2026-4{n}', inn=f'770000002{n}')
            book.update(did, {'uf': {'UF_CHANCE': '101', 'UF_CHIEF': '110', 'UF_SRC': '2', 'UF_ADS': '120'}}, 'Иванова')
        did = self.kp('2026-500', inn='7700000098')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_CHANCE'), '101', 'на этой стадии трижды ставили «20%»')
        self.assertEqual(uf.get('UF_CHIEF'), '110', 'руководитель — как у прежних сделок менеджера')
        self.assertNotIn('UF_ADS', uf, 'источник не выбран — реклама не угадывается')
        self.assertNotIn('UF_WORK', uf, 'описание работ — не товар')
        book.update(did, {'uf': {'UF_SRC': '2', 'UF_NOTE': 'Перезвонить в пятницу'}}, 'Иванова')
        book.autofill(did, 'Иванова')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_ADS'), '120', 'при источнике «Звонок» реклама — «Нет», как раньше')
        self.assertEqual(len(uf.get('UF_NOTEDAY') or ''), 10, 'дата рабочего комментария — день правки')
        deal = self.deal(did)
        book.update(did, {'uf': {'UF_WORK': 'Мотопомпа'}}, 'Иванова')
        with self.st.lock:
            fixed = dict(book.get(did), ufAuto=dict(deal['ufAuto'], UF_WORK='Мотопомпа'))
            conn = self.st.conn()
            book._save(conn, did, fixed, 'тест')
            conn.commit()
        book.autofill(did, 'Иванова')
        self.assertNotIn('UF_WORK', self.deal(did)['uf'], 'ошибочное прежнее автозаполнение снято')

    def test_card_fills_old_deal(self):
        from crm import DealBook
        from crm_funnels import DealFields
        DealFields(self.st).save_defs([], {})
        did = self.kp('2026-089')
        self.assertFalse(self.deal(did).get('uf'))
        DealFields(self.st).save_defs([dict(row) for row in FIELDS], {})
        self.assertTrue(DealBook(self.st).autofill(did, 'Иванова'))
        self.assertEqual(self.deal(did)['uf'].get('UF_BRAND'), ['71'])
        self.assertFalse(DealBook(self.st).autofill(did, 'Иванова'), 'второй раз — нечего дополнять')

    def test_several_kp(self):
        """Несколько КП в сделке: бренды — всех живых КП; проигранное КП не учитывается; стёртое менеджером — не возвращается."""
        from crm import DealBook
        self.st.catalog_put('comp1', json.dumps({'id': 'comp1', 'name': 'Компрессор винтовой Atlas Copco GA-11',
                                                 'attrs': {'cat': 'screw', 'maker': 'Atlas Copco'}}, ensure_ascii=False), 'тест')
        self.st.catalog_put('pump2', json.dumps({'id': 'pump2', 'name': 'Мотопомпа Abac M-50', 'attrs': {'cat': 'mpump', 'maker': 'Abac'}},
                                                ensure_ascii=False), 'тест')
        did = self.kp('2026-089')
        book = DealBook(self.st)
        book.update(did, {'uf': {'UF_GOODS': ''}}, 'Иванова')  # стёрто менеджером — не возвращается
        self.kp('2026-090', cat_id='comp1', attrs={})
        book.link(did, '2026-090', 'Иванова')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_BRAND'), ['71', '72'], 'не тронутое менеджером — по всем КП сделки')
        self.kp('2026-091', cat_id='pump2', attrs={})
        book.link(did, '2026-091', 'Иванова')
        self.st.kp_track_set('2026-089', {'status': 'lost'})
        book.refresh('2026-089', 'Иванова')
        uf = self.deal(did)['uf']
        self.assertEqual(uf.get('UF_BRAND'), ['70', '72'], 'проигранное КП (Koshin) не учитывается')
        self.assertNotIn('UF_GOODS', uf)


class WordsTest(unittest.TestCase):
    def test_match(self):
        from collections import Counter

        from deal_autofill import ListMatch, Words
        match = ListMatch(items((1, 'Генераторы Прочее'), (2, 'Генераторы дизельные')), Counter())
        self.assertEqual(match.best(Words.stems('Дизельный генератор 100 кВт')), '2', 'больше совпавших слов')
        self.assertEqual(match.best(Words.stems('Бензиновый генератор')), '1', '«прочее» не мешает')
        self.assertEqual(match.best(Words.stems('Компрессор')), '')
        self.assertEqual(ListMatch(items((1, 'Atlas Copco'), (2, 'Abac')), Counter()).exact(['ATLAS-COPCO']), ['1'])
        popular = ListMatch(items((1, 'Мотопомпы импортные'), (2, 'Мотопомпы отечественные')), Counter({'2': 5}))
        self.assertEqual(popular.best(Words.stems('Мотопомпа')), '2', 'равные — чаще выбирали раньше')


if __name__ == '__main__':
    unittest.main()
