# -*- coding: utf-8 -*-
"""Регламент оформления сделки Битрикс24 (deal_rules.py): поля пунктов находятся по названиям полей портала и видны в
карточке; для стадии «Обращений» — свои обязательные поля, клиент и контакт; проигрыш — комментарий, дубль — ID основной
сделки, нецелевая — свой комментарий; «Проекты» — первый платёж; деньги и запрошенное заполняются сами (экономика, график
платежей, первое КП, источник); в Битрикс уходят телефон и почта компании, контакт со связкой и файл КП в «ТКП / счёт»."""
import json
import unittest
from datetime import date

from bitrix_fake import FakeBitrix
from kit import TempStore
from test_bitrix import direct

ENUM_SOURCE = [{'ID': '1', 'VALUE': 'Рекламная заявка'}, {'ID': '2', 'VALUE': 'Повторная заявка'}, {'ID': '3', 'VALUE': 'Личная заявка'}]
ENUM_PAY = [{'ID': '21', 'VALUE': '100% предоплата'}, {'ID': '22', 'VALUE': 'Предоплата 50%, 50% по факту'},
            {'ID': '23', 'VALUE': 'Постоплата'}]
PORTAL = [
    ('UF_SRC', 'enumeration', 'Источник1', ENUM_SOURCE),
    ('UF_TOPIC', 'string', 'Тема запроса1', None),
    ('UF_CTYPE', 'enumeration', 'Тип компании', [{'ID': '31', 'VALUE': 'Конечный клиент'}, {'ID': '32', 'VALUE': 'Дилер'}]),
    ('UF_REGION', 'enumeration', 'Регион1', [{'ID': '41', 'VALUE': 'Москва'}, {'ID': '42', 'VALUE': 'Казань'}]),
    ('UF_EQ', 'enumeration', 'Тип оборудования1', [{'ID': '51', 'VALUE': 'Компрессоры'}, {'ID': '52', 'VALUE': 'Насосы'}]),
    ('UF_ASKB', 'string', 'Запрошенный бренд1', None),
    ('UF_ASKG', 'string', 'Запрошенный товар1', None),
    ('UF_BRAND', 'string', 'Бренд по Сделке1', None),
    ('UF_GOODS', 'string', 'Товар по Сделке1', None),
    ('UF_EXP', 'money', 'Ожидаемая сумма Сделки1', None),
    ('UF_MARGIN', 'money', 'Маржа ожидаемая1', None),
    ('UF_TKP', 'file', 'Загрузить ТКП/Счет', None),
    ('UF_PAY', 'enumeration', 'Условия оплаты1', ENUM_PAY),
    ('UF_CONTRACT', 'money', 'Сумма сделки по Договору1', None),
    ('UF_PAY1D', 'date', 'Дата выписки по 1-му платежу', None),
    ('UF_PAY1', 'money', '1-й Платеж1', None),
    ('UF_PAY1M', 'money', 'Маржа по 1-му платежу', None),
    ('UF_LOSTC', 'string', 'Комментарий к проигранной Сделке', None),
    ('UF_DUP', 'string', 'ID Основной сделки для Статуса "Дубль Сделки"', None),
    ('UF_UNT', 'string', 'Комментарий к не целевой заявке', None),
]
OBR = [('C5:NEW', 'Новая заявка', 'P'), ('C5:TAKEN', 'Взято в работу', 'P'), ('C5:TKP', 'ТКП отправлено клиенту', 'P'),
       ('C5:AGREE', 'Согласование договора', 'P'), ('C5:SIGNED', 'Договор подписан', 'P'), ('C5:WON', 'В проект', 'S'),
       ('C5:LOSE', 'Сделка проиграна', 'F'), ('C5:DUP', 'Дубль сделки', 'F'), ('C5:UNT', 'Не целевая', 'F')]
PROJ = [('C6:NEW', 'Взято в работу', 'P'), ('C6:PAY1', 'Первая оплата', 'P'), ('C6:BUY', 'Закупка у поставщика', 'P'),
        ('C6:WON', 'Сделка успешна', 'S'), ('C6:LOSE', 'Провал', 'F')]


class RegsBase(unittest.TestCase):
    def setUp(self):
        fake = self.fake = FakeBitrix()
        self.addCleanup(fake.stop)
        fake.categories += [{'id': 5, 'name': 'Обращения'}, {'id': 6, 'name': 'Проекты'}]
        fake.stages['DEAL_STAGE_5'], fake.stages['DEAL_STAGE_6'] = OBR, PROJ
        fake.portal_fields = [{'FIELD_NAME': code, 'USER_TYPE_ID': kind, 'L': label, **({'ITEMS': items} if items else {})}
                              for code, kind, label, items in PORTAL]
        self.st = st = TempStore(self).store
        st.manager_put('m1', json.dumps({'name': 'Иванова Анна', 'email': 'ivanova@example.com'}, ensure_ascii=False), 'тест')
        st.client_put('inn7700000001', {'id': 'inn7700000001', 'name': 'ООО «Альфа»', 'inn': '7700000001', 'address': 'г. Москва',
                                        'contacts': [{'name': 'Сидоров Пётр', 'phone': '+7 900 111-22-33', 'email': 's@alfa.ru'}]}, 'тест')
        from bitrix import BitrixConf
        BitrixConf(st).save({'url': fake.url, 'category': '5', 'on': True, 'users': {'m1': '7'},
                             'stages': {'lead': 'C5:TAKEN', 'sent': 'C5:TKP', 'talks': 'C5:AGREE', 'contract': 'C5:SIGNED',
                                        'won': 'C5:WON', 'lost': 'C5:LOSE'}}, 'тест')
        from bitrix_mirror_load import MirrorStructure
        MirrorStructure(st, direct()).load()

    def regs(self):
        from deal_rules import DealRegs
        return DealRegs(self.st)

    def deal(self, funnel='b5', **extra):
        from crm import DealBook
        data = dict({'title': 'Компрессор', 'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'clientId': 'inn7700000001',
                     'funnel': funnel}, **extra)
        return DealBook(self.st).create(data, 'm1', 'Иванова Анна', 'тест')

    def need(self, deal, stage, reason=''):
        from crm import DealBook
        DealBook(self.st).autofill(deal['id'], 'тест')
        return self.regs().need(DealBook(self.st).get(deal['id']), stage, reason)

    def kp(self, kid, did, **kw):
        from crm import DealBook
        meta = dict({'id': kid, 'number': kid, 'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'authorId': 'm1',
                     'manager': 'Иванова Анна', 'date': date.today().isoformat(), 'savedAt': '2026-10-22T10:%s:00' % kid[-2:],
                     'sum': 100000000, 'items': ['Компрессор ВК-' + kid],
                     'deal': {'confirmed': True, 'profit': 150000, 'full': {'price': 1000000}},
                     'plan': {'pays': [{'d': 0, 'p': 50, 't': 'Аванс 50 % при подписании'},
                                       {'d': 30, 'p': 50, 't': '50 % после поставки'}]}}, **kw)
        self.st.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        self.st.kp_set(kid, 'state', json.dumps({'items': [{'name': 'Компрессор винтовой ВК-' + kid, 'attrs': {'maker': 'Remeza'}}]},
                                                ensure_ascii=False), 'тест')
        DealBook(self.st).link(did, kid, 'тест')


class RegsTest(RegsBase):
    def test_fields_found_and_shown(self):
        from crm_funnels import DealFields
        codes = self.regs().codes()
        self.assertEqual(codes['topic'], 'UF_TOPIC')
        self.assertEqual(codes['askBrand'], 'UF_ASKB')
        self.assertEqual(codes['brand'], 'UF_BRAND', '«Бренд по сделке» — не «Запрошенный бренд»')
        self.assertEqual(codes['contract'], 'UF_CONTRACT')
        self.assertEqual(codes['tkp'], 'UF_TKP')
        self.assertEqual(codes['dupId'], 'UF_DUP')
        self.assertEqual(codes['untarget'], 'UF_UNT')
        self.assertEqual(codes['pay1'], 'UF_PAY1')
        self.assertNotIn('invoice', codes, 'поля сервиса на портале нет — пункт не проверяется')
        shown = {row['code'] for row in DealFields(self.st).shown('b5')}
        self.assertTrue({'UF_TOPIC', 'UF_PAY', 'UF_LOSTC'} <= shown, 'поля регламента — в карточке, хоть и не заполнялись')

    def test_stage_needs(self):
        deal = self.deal(source='own')
        first = self.need(deal, 'C5:NEW')
        self.assertTrue(first['ok'], 'новая заявка — без требований')
        taken = self.need(deal, 'C5:TAKEN')
        keys = [row['key'] for row in taken['fields']]
        self.assertEqual(keys, ['note', 'topic', 'ctype', 'region', 'eqtype', 'askBrand', 'askGoods'],
                         'источник уже заполнен по выбору при создании')
        self.assertEqual([row['key'] for row in taken['client']], ['companyPhone', 'companyEmail'],
                         'контакт полный, у компании нет телефона и почты')
        self.assertEqual(taken['fields'][1]['field']['code'], 'UF_TOPIC')
        signed = [row['key'] for row in self.need(deal, 'C5:SIGNED')['fields']]
        for key in ('brand', 'goods', 'expect', 'margin', 'tkp', 'pay', 'contract'):
            self.assertIn(key, signed)
        self.assertNotIn('pay1', signed, 'платежи — только в «Проектах»')
        with self.assertRaises(ValueError) as err:
            self.regs().check(deal, 'C5:TAKEN')
        self.assertIn('Тема запроса', str(err.exception))
        self.assertIn('Телефон компании', str(err.exception))

    def test_source_filled(self):
        from crm import DealBook
        deal = self.deal(source='repeat')
        DealBook(self.st).autofill(deal['id'], 'тест')
        self.assertEqual(DealBook(self.st).get(deal['id'])['uf'].get('UF_SRC'), '2', 'повторная заявка')
        with self.assertRaises(ValueError):
            self.deal(source='сайт')

    def test_fill_then_move(self):
        from crm import DealBook
        deal = self.deal(source='ad')
        regs = self.regs()
        deal = regs.save_client(deal, {'companyPhone': '+7 495 100-20-30', 'companyEmail': 'info@alfa.ru'}, 'тест')
        uf = {'UF_TOPIC': 'Винтовой компрессор', 'UF_CTYPE': '31', 'UF_REGION': '41', 'UF_EQ': '51', 'UF_ASKB': 'Remeza',
              'UF_ASKG': 'ВК-30'}
        deal = DealBook(self.st).update(deal['id'], {'uf': uf, 'note': 'Нужен компрессор на завод'}, 'тест')
        regs.check(deal, 'C5:TAKEN')
        moved = DealBook(self.st).update(deal['id'], {'stage': 'C5:TAKEN'}, 'тест')
        self.assertEqual(moved['stage'], 'C5:TAKEN')
        client = self.st.client_get('inn7700000001')
        self.assertEqual((client['phone'], client['email']), ('+7 495 100-20-30', 'info@alfa.ru'))
        with self.assertRaises(ValueError):
            regs.save_client(deal, {'companyEmail': 'не почта'}, 'тест')
        with self.assertRaises(ValueError):
            regs.save_client(deal, {'personPhone': '12-34'}, 'тест')

    def test_new_client_and_contact(self):
        from crm import DealBook
        deal = DealBook(self.st).create({'title': 'Насос', 'client': 'ООО «Бета»', 'funnel': 'b5'}, 'm1', 'Иванова Анна', 'тест')
        gaps = self.need(deal, 'C5:TAKEN')['client']
        self.assertEqual(len(gaps), 6, 'клиента нет в справочнике — всё пусто')
        with self.assertRaises(ValueError):
            self.regs().save_client(deal, {'person': 'Петров Иван'}, 'тест')
        from unittest import mock
        with mock.patch('counterparty.Counterparties.lookup', return_value={}):
            filled = self.regs().save_client(deal, {'inn': '7700000099', 'person': 'Петров Иван', 'personPhone': '89001112233'}, 'тест')
        self.assertEqual(filled['clientId'], 'inn7700000099')
        self.assertEqual(self.st.client_get('inn7700000099')['contacts'][0]['name'], 'Петров Иван')

    def test_client_by_inn(self):
        """ИНН — карточка из ФНС (реквизиты, адрес); известный — из справочника; ошибка в ИНН — понятный текст."""
        from unittest import mock
        from deal_rules import ClientByInn
        found = {'short': 'ООО «Гамма»', 'full': 'ООО «Гамма»', 'kpp': '770101001', 'address': 'г. Москва, ул. Тверская, 1'}
        with mock.patch('counterparty.Counterparties.lookup', return_value=found) as lookup:
            doc = ClientByInn(self.st).ensure('7701000011', '', 'тест')
            self.assertEqual((doc['name'], doc['address']), ('ООО «Гамма»', 'г. Москва, ул. Тверская, 1'))
            self.assertEqual(ClientByInn(self.st).ensure('7700000001')['name'], 'ООО «Альфа»', 'известный — из справочника')
            self.assertEqual(lookup.call_count, 1)
        with mock.patch('counterparty.Counterparties.lookup', return_value={'error': 'нет'}):
            with self.assertRaises(ValueError):
                ClientByInn(self.st).ensure('7701000022')
            self.assertEqual(ClientByInn(self.st).ensure('7701000022', 'ООО «Дельта»')['name'], 'ООО «Дельта»')
        with self.assertRaises(ValueError):
            ClientByInn(self.st).ensure('12345')

    def test_known_client_kept(self):
        """ИНН клиента, который уже есть в справочнике, — карточка дополняется, контакты и реквизиты не теряются."""
        from crm import DealBook
        deal = DealBook(self.st).create({'title': 'Насос', 'client': 'Альфа', 'funnel': 'b5'}, 'm1', 'Иванова Анна', 'тест')
        filled = self.regs().save_client(deal, {'inn': '7700000001', 'companyPhone': '+7 495 100-20-30'}, 'тест')
        client = self.st.client_get('inn7700000001')
        self.assertEqual(filled['clientId'], 'inn7700000001')
        self.assertEqual((client['name'], client['address'], client['phone']), ('ООО «Альфа»', 'г. Москва', '+7 495 100-20-30'))
        self.assertEqual(client['contacts'][0]['name'], 'Сидоров Пётр')

    def test_lost_needs(self):
        deal = self.deal()
        lose = [row['key'] for row in self.need(deal, 'C5:LOSE')['fields']]
        self.assertEqual(lose, ['lostNote'])
        self.assertEqual([row['key'] for row in self.need(deal, 'C5:DUP')['fields']], ['lostNote', 'dupId'])
        self.assertEqual([row['key'] for row in self.need(deal, 'C5:DUP', 'клиент ведётся в другой сделке')['fields']],
                         ['lostNote', 'dupId'], 'свой комментарий — «дубль» по стадии')
        self.assertEqual([row['key'] for row in self.need(deal, 'C5:UNT')['fields']], ['lostNote', 'untarget'])
        self.assertEqual(self.need(deal, 'C5:LOSE')['client'], [], 'проигрыш — без требований к клиенту')

    def test_projects_first_payment(self):
        deal = self.deal(funnel='b6')
        keys = [row['key'] for row in self.need(deal, 'C6:PAY1')['fields']]
        self.assertTrue({'pay1Date', 'pay1', 'pay1Margin'} <= set(keys))
        self.assertNotIn('pay1', [row['key'] for row in self.need(deal, 'C6:NEW')['fields']])

    def test_money_from_kp(self):
        from crm import DealBook
        deal = self.deal()
        self.kp('26-0101', deal['id'])
        DealBook(self.st).autofill(deal['id'], 'тест')
        uf = DealBook(self.st).get(deal['id'])['uf']
        self.assertEqual(uf.get('UF_EXP'), '1000000|RUB')
        self.assertEqual(uf.get('UF_CONTRACT'), '1000000|RUB')
        self.assertEqual(uf.get('UF_MARGIN'), '150000|RUB', 'маржа — прибыль из экономики сделки')
        self.assertEqual(uf.get('UF_PAY'), '22', 'аванс 50 % — «Предоплата 50%, 50% по факту»')
        self.assertEqual(uf.get('UF_ASKB'), 'Remeza', 'запрошенный бренд — по первому КП')
        self.assertIn('tkp', [row['key'] for row in self.need(DealBook(self.st).get(deal['id']), 'C5:SIGNED')['fields']],
                      'КП без файла Word — приложить нечего')

    def test_new_request_task(self):
        from crm import DealBook, TaskBook
        from crm_auto import AutoTasks
        deal = self.deal()
        self.assertEqual(deal['fstage'], 'C5:NEW')
        AutoTasks(self.st).sync(DealBook(self.st).get(deal['id']))
        tasks = TaskBook(self.st).list(deal=deal['id'])
        self.assertEqual([task['title'] for task in tasks], ['Новая заявка: взять в работу или закрыть до конца дня'])
        self.assertEqual(AutoTasks(self.st).sync(DealBook(self.st).get(deal['id'])), 0, 'одно дело на сделку')
        moved = DealBook(self.st).update(deal['id'], {'stage': 'C5:LOSE', 'lostReason': 'дорого'}, 'тест')
        AutoTasks(self.st).sync(moved)
        self.assertEqual(TaskBook(self.st).list(deal=deal['id'])[0]['state'], 'done', 'ушла с «Новой заявки» — дело сделано')

    def test_auto_task_done(self):
        """Дело, поставленное кабинетом само, отмечается сделанным (это не точка исполнения)."""
        from crm import TaskBook
        deal = self.deal()
        task = TaskBook(self.st).add({'kind': 'call', 'title': 'Обратная связь', 'due': date.today().isoformat()}, 'm1', 'тест',
                                     deal['id'], step='auto:sent:k1')
        self.assertEqual(TaskBook(self.st).update(task['id'], {'state': 'done'}, 'тест')['state'], 'done')

    def test_admin_map(self):
        regs = self.regs()
        view = regs.save({'map': {'topic': 'UF_GOODS'}, 'off': ['askGoods']})
        row = next(item for item in view['items'] if item['key'] == 'topic')
        self.assertEqual((row['code'], row['auto']), ('UF_GOODS', 'UF_TOPIC'))
        self.assertNotIn('askGoods', regs.codes())
        self.assertNotIn('askGoods', [row['key'] for row in self.need(self.deal(), 'C5:TAKEN')['fields']])
        with self.assertRaises(ValueError):
            regs.save('нет')


class RegsPushTest(RegsBase):
    def test_client_and_file_to_bitrix(self):
        from bitrix import BitrixQueue, BitrixSync
        from crm import DealBook
        deal = self.deal(funnel='b5')
        self.kp('26-0102', deal['id'])
        self.regs().save_client(deal, {'companyPhone': '+7 495 100-20-30', 'companyEmail': 'info@alfa.ru'}, 'тест')
        files = {'26-0102': [('КП 26-0102.docx', b'PK-docx', 'КП (Word)'), ('КП 26-0102.pdf', b'%PDF-1', 'КП (PDF)')]}
        sync = BitrixSync(self.st, direct(), files=lambda kid: files.get(kid, []))
        BitrixQueue.touch(self.st, 'deal', deal['id'])
        sync.run()
        from bitrix import BitrixLinks
        bid = BitrixLinks(self.st).get('deal', deal['id'])['bx']
        bx = self.fake.deals[bid]
        self.assertEqual(bx['UF_TKP']['fileData'][0], 'КП 26-0102.pdf', 'в «ТКП / счёт» — PDF последнего КП')
        company = self.fake.companies[str(bx['COMPANY_ID'])]
        self.assertEqual([row['VALUE'] for row in company['PHONE']][:1], ['+7 495 100-20-30'])
        people = self.fake.deal_people.get(bid)
        self.assertEqual(len(people or []), 1, 'контакт привязан к сделке')
        self.assertEqual(str(self.fake.contacts[people[0]]['COMPANY_ID']), str(company['ID']), 'и к компании')
        calls = len(self.fake.calls)
        DealBook(self.st).update(deal['id'], {'title': 'Компрессор ВК'}, 'тест')
        BitrixQueue.touch(self.st, 'deal', deal['id'])
        sync.run()
        again = [method for method, _body in self.fake.calls[calls:]]
        self.assertNotIn('crm.contact.add', again, 'контакт второй раз не создаётся')
        self.assertNotIn('crm.company.update', again, 'телефон компании второй раз не дописывается')
        self.assertEqual(sum(1 for body in (b for m, b in self.fake.calls[calls:] if m == 'crm.deal.update')
                             if 'UF_TKP' in (body.get('fields') or {})), 0, 'файл КП — один раз')


if __name__ == '__main__':
    unittest.main()
