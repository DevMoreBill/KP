# -*- coding: utf-8 -*-
"""Клиент по контакту (client_match.py): поиск по телефону, почте, ФИО контакта, строка поиска после миграции; слияние компаний
и контактов Битрикс24 с клиентами (bitrix_clients.py): по ИНН — реквизиты программы, контакты дописываются; без ИНН — по
контактам (одно совпадение, выбор из нескольких, новый «без ИНН»), сделка только с контактом; исполнение сделки
(crm_exec.py): точки из расчёта КП, план от даты договора, суммы закупки — только с правом экономики, этап вперёд, дела на
ближайшие точки сами, сделанное дело отмечает точку."""
import json
import unittest
from datetime import date, timedelta

from kit import TempStore
from test_bitrix import SyncBase


def day(shift):
    return (date.today() + timedelta(days=shift)).isoformat()


class ClientSearchTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        self.st.client_put('inn7701000001', {'id': 'inn7701000001', 'name': 'ООО «Ромашка»', 'inn': '7701000001', 'contacts': [
            {'name': 'Иванов Иван Петрович', 'phone': '+7 (916) 123-45-67', 'email': 'Ivanov@Romashka.ru'}]})
        self.st.client_put('inn7702000002', {'id': 'inn7702000002', 'name': 'АО «Лютик»', 'inn': '7702000002', 'contacts': [
            {'name': 'Иванов Пётр', 'phone': '8 916 123 45 67'}]})

    def names(self, query):
        return sorted(item['name'] for item in self.st.clients_search(query, 10)['items'])

    def test_by_phone_email_name(self):
        self.assertEqual(self.names('89161234567'), ['АО «Лютик»', 'ООО «Ромашка»'], 'один телефон — две компании, выбор')
        self.assertEqual(self.names('+7 (916) 123-45-67'), ['АО «Лютик»', 'ООО «Ромашка»'])
        self.assertEqual(self.names('IVANOV@romashka.ru'), ['ООО «Ромашка»'])
        self.assertEqual(self.names('Иванов И'), ['ООО «Ромашка»'])
        self.assertEqual(self.names('Иванов'), ['АО «Лютик»', 'ООО «Ромашка»'])
        found = self.st.clients_search('ivanov@romashka.ru', 10)['items'][0]
        self.assertEqual(found['match']['by'], 'e-mail')
        self.assertEqual(found['match']['contact']['name'], 'Иванов Иван Петрович')
        self.assertNotIn('match', self.st.clients_search('ромашка', 10)['items'][0], 'по названию — без отметки контакта')

    def test_extension_and_local(self):
        """телефон с добавочным — это телефон, а не ФИО; короткий городской номер контакта тоже находится"""
        self.st.client_put('inn7703000003', {'id': 'inn7703000003', 'name': 'ООО «Василёк»', 'inn': '7703000003', 'contacts': [
            {'name': 'Сидоров', 'phone': '+7 (495) 765-43-21 доб. 105'}, {'name': 'Склад', 'phone': '98-76-50'}]})
        self.assertEqual(self.names('+7 (495) 765-43-21 доб. 105'), ['ООО «Василёк»'])
        self.assertEqual(self.names('84957654321'), ['ООО «Василёк»'])
        self.assertEqual(self.names('987650'), ['ООО «Василёк»'])
        self.assertEqual(self.st.clients_search('+7 (495) 765-43-21, доб.: 7', 10)['items'][0]['match']['by'], 'телефон')

    def test_match_and_refill(self):
        from client_match import ClientMatch
        cards = ClientMatch(self.st).any_of(phones=['+79161234567'], emails=['ivanov@romashka.ru'])
        self.assertEqual(sorted(card['id'] for card in cards), ['inn7701000001', 'inn7702000002'])
        self.st.write("UPDATE clients SET search='ооо ромашка' WHERE id='inn7701000001'")  # строка поиска прежней версии
        import storage
        storage._fill_client_search(self.st, self.st.conn())
        self.assertEqual(self.names('ivanov@romashka.ru'), ['ООО «Ромашка»'], 'миграция дописала контакты в строку поиска')


class BitrixClientsTest(SyncBase):
    def company(self, cid, title, inn='', **extra):
        self.fake.companies[cid] = dict({'ID': cid, 'TITLE': title}, **extra)
        if inn:
            self.fake.requisites['r' + cid] = {'ID': 'r' + cid, 'ENTITY_TYPE_ID': 4, 'ENTITY_ID': cid, 'RQ_INN': inn}

    def person(self, pid, last, first, phone='', email='', company=''):
        self.fake.contacts[pid] = {'ID': pid, 'LAST_NAME': last, 'NAME': first, 'POST': 'Снабженец', 'COMPANY_ID': company,
                                   'PHONE': [{'VALUE': phone}] if phone else [], 'EMAIL': [{'VALUE': email}] if email else []}

    def clients(self):
        from bitrix_clients import BitrixClients
        return BitrixClients(self.sync())

    def test_by_inn_keeps_legal_data(self):
        self.company('501', 'Альфа (Битрикс)', '7700000001', PHONE=[{'VALUE': '+7 (495) 000-00-01'}])
        self.person('601', 'Кузнецова', 'Мария', '8 (916) 555-44-33', company='501')
        out = self.clients().of_company('501')
        self.assertEqual((out['clientId'], out['name']), ('inn7700000001', 'ООО «Альфа»'), 'название — из базы программы')
        doc = self.st.client_get('inn7700000001')
        self.assertEqual(doc['kpp'], '770001001', 'реквизиты не тронуты')
        names = [row.get('name') for row in doc['contacts']]
        self.assertEqual(names[0], 'Сидоров Пётр')
        self.assertIn('Кузнецова Мария', names)
        self.assertTrue(any(row.get('phone') == '+7 (495) 000-00-01' for row in doc['contacts']), 'телефон компании')
        self.clients().of_company('501')
        self.assertEqual(len(self.st.client_get('inn7700000001')['contacts']), len(doc['contacts']), 'без повторов')

    def test_without_inn(self):
        self.company('502', 'Альфа без реквизитов')
        self.person('602', 'Сидоров', 'Пётр', '8 900 111 22 33', company='502')
        self.assertEqual(self.clients().of_company('502')['clientId'], 'inn7700000001', 'одно совпадение по телефону')
        self.st.client_put('inn7700000009', {'id': 'inn7700000009', 'name': 'ООО «Бета»', 'inn': '7700000009',
                                             'contacts': [{'name': 'Сидоров Пётр', 'phone': '+79001112233'}]})
        out = self.clients().of_company('502')
        self.assertNotIn('clientId', out)
        self.assertEqual(sorted(row['id'] for row in out['pick']), ['inn7700000001', 'inn7700000009'], 'несколько — выбор')
        # общее контактное лицо у другой компании (в названиях нет общего слова) — не сливать, спросить в сделке (27.10)
        self.company('504', 'ООО «Гамма»')
        self.person('604', 'Сидоров', 'Пётр', '8 900 111 22 33', company='504')
        self.st.client_put('inn7700000009', {'id': 'inn7700000009', 'name': 'ООО «Бета»', 'inn': '7700000009'})
        before = self.st.client_get('inn7700000001')
        out = self.clients().of_company('504')
        self.assertNotIn('clientId', out)
        self.assertEqual([row['id'] for row in out['pick']], ['inn7700000001'], 'одно совпадение по контакту, название другое — выбор')
        self.assertEqual(self.st.client_get('inn7700000001'), before, 'карточка клиента не изменена')
        self.company('503', 'ИП Новиков')
        self.person('603', 'Новиков', 'Олег', '8 999 000 00 00', company='503')
        out = self.clients().of_company('503')
        self.assertEqual(out['clientId'], 'bx503')
        doc = self.st.client_get('bx503')
        self.assertTrue(doc['noInn'])
        self.assertEqual(doc['contacts'][0]['name'], 'Новиков Олег')

    def test_deal_and_linked_contacts(self):
        """Контакты сделки и связанные с компанией списком связей (без «основной компании») — в карточку клиента."""
        self.company('505', 'Промстрой', '7700000005')
        self.person('605', 'Ким', 'Игорь', '+7 (900) 555-00-01')  # к сделке
        self.person('606', 'Ли', 'Анна', email='li@prom.ru')  # к компании списком связей
        self.fake.company_people['505'] = ['606']
        bx_id = self.fake.new_deal(TITLE='Мотопомпа', COMPANY_ID='505', CONTACT_ID='605')
        self.fake.deal_people[str(bx_id)] = ['605']
        deal = self.sync()._import_deal(self.fake.deals[bx_id], 'm1')
        names = [row.get('name') for row in self.st.client_get(deal['clientId'])['contacts']]
        self.assertEqual(names[:2], ['Ким Игорь', 'Ли Анна'], 'контакт сделки — первым')

    def test_people_for_old_deal(self):
        """Сделка загружена раньше без контактов — карточка подтягивает их из Битрикса один раз в сутки."""
        from bitrix import BitrixLinks
        from crm import DealBook
        self.company('507', 'Промстрой', '7700000007')
        did = DealBook(self.st).create({'title': 'Мотопомпа', 'client': 'Промстрой', 'clientInn': '7700000007'}, 'm1', 'И', 'И')['id']
        self.person('607', 'Ким', 'Игорь', '+7 (900) 555-00-07')
        bx_id = self.fake.new_deal(TITLE='Мотопомпа', COMPANY_ID='507', CONTACT_ID='607')
        BitrixLinks(self.st).put('deal', did, bx_id)
        self.assertEqual(self.sync().people(did), 1)
        self.assertEqual(DealBook(self.st).get(did)['clientId'], 'inn7700000007', 'клиент связан со сделкой')
        self.assertEqual(self.sync().people(did), 0, 'второй раз за сутки — не спрашивает')

    def test_people_sweep(self):
        """Фоновый проход: контакты подтягиваются для сделок без контактов, без открытия карточки."""
        from bitrix import BitrixLinks
        from crm import DealBook
        self.company('508', 'Техмаш', '7700000008')
        did = DealBook(self.st).create({'title': 'Компрессор', 'client': 'Техмаш', 'clientInn': '7700000008'}, 'm1', 'И', 'И')['id']
        self.person('608', 'Орлов', 'Олег', '+7 (900) 555-00-08')
        BitrixLinks(self.st).put('deal', did, self.fake.new_deal(TITLE='Компрессор', COMPANY_ID='508', CONTACT_ID='608'))
        self.assertEqual(self.sync().people_sweep(), 1)
        self.assertEqual(len(self.st.client_get('inn7700000008')['contacts']), 1)
        self.assertEqual(self.sync().people_sweep(), 0, 'контакты есть — повторно не спрашивает')

    def test_deal_with_contact_only(self):
        self.person('604', 'Сидоров', 'Пётр', email='s@alfa.ru')
        bx_id = self.fake.new_deal(TITLE='Запрос с сайта', CONTACT_ID='604', COMPANY_ID='0')
        deal = self.sync()._import_deal(self.fake.deals[bx_id], 'm1')
        self.assertEqual((deal['clientId'], deal['client'], deal['clientInn']), ('inn7700000001', 'ООО «Альфа»', '7700000001'))

    def test_pick_in_deal(self):
        from crm import DealBook
        book = DealBook(self.st)
        deal = book.create({'title': 'Сделка', 'client': 'Альфа', 'clientPick': [{'id': 'inn1', 'name': 'А', 'by': 'телефон'}, {'id': 'bad id!'}]}, 'm1', 'Иванова', 'тест')
        self.assertEqual([row['id'] for row in deal['clientPick']], ['inn1', 'badid'])
        deal = book.update(deal['id'], {'client': 'ООО «Альфа»', 'clientId': 'inn7700000001', 'clientInn': '7700000001'}, 'тест')
        self.assertEqual(deal['clientPick'], [], 'клиент выбран — выбор снят')


class ExecTest(unittest.TestCase):
    PLAN = {'start': '', 'ready': 30, 'delivery': 40, 'end': 45, 'pnr': None,
            'pays': [{'d': 0, 'p': 50, 't': 'Аванс 50 %'}],
            'steps': [{'k': 'c1', 'd': 0, 't': 'Аванс 50 % — при подписании', 'p': 'cust', 'a': 500000, 'pc': 50},
                      {'k': 'sp:s1:0', 'd': 5, 't': 'Поставщику: предоплата 100 %', 'p': 'sup', 'a': 700000},
                      {'k': 'log:s1', 'd': 30, 't': 'Перевозка и сборы', 'p': 'log', 'a': 60000},
                      {'k': 'c2', 'd': 45, 't': 'Окончательный расчёт 50 %', 'p': 'cust', 'a': 500000, 'pc': 50}]}

    def setUp(self):
        self.st = TempStore(self).store
        from crm import DealBook
        meta = {'id': 'k1', 'number': '2026-001', 'client': 'ООО «А»', 'clientInn': '7700000001', 'authorId': 'm1', 'manager': 'Иванова',
                'date': day(0), 'sum': 1000000, 'items': ['Компрессор'], 'plan': self.PLAN}
        self.st.kp_set('k1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        self.did = DealBook(self.st).on_kp('k1', meta, 'Иванова')

    def deal(self):
        from crm_exec import ExecBook
        return ExecBook(self.st).deal(self.did)

    def view(self, sums):
        from crm_exec import ExecPlan
        return ExecPlan(self.deal()).view(sums)

    def test_plan_and_money(self):
        from crm_exec import Sums
        view = self.view(Sums.SALES)
        self.assertTrue(view['has'])
        self.assertEqual(view['how'], 'guess', 'до договора — от ожидаемой даты')
        keys = [step['key'] for step in view['steps']]
        self.assertEqual(keys, ['sign', 'p:c1', 'p:sp:s1:0', 'notify', 'ready', 'p:log:s1', 'delivery', 'p:c2'])
        by_key = {step['key']: step for step in view['steps']}
        self.assertNotIn('amount', by_key['p:sp:s1:0'], 'закупка без права экономики — без суммы')
        self.assertEqual(by_key['p:c1']['amount'], 500000, 'оплата заказчика — с суммой')
        self.assertEqual(self.view(Sums.ALL)['steps'][2]['amount'], 700000)
        self.assertEqual(view['toPay'], 1000000)
        self.assertEqual(view['next']['key'], 'sign')

    def test_old_kp_pays_by_percent(self):
        from crm_exec import ExecPlan, Sums
        deal = self.deal()
        deal['kps'][0]['plan'] = {key: value for key, value in self.PLAN.items() if key != 'steps'}
        deal['kps'][0]['sum'] = 120000000
        cust = [step for step in ExecPlan(deal).steps(Sums.SALES) if step['kind'] == 'cust']
        self.assertEqual([(step['key'], step['amount']) for step in cust], [('c0', 600000)], 'КП прежней версии: 50 % от 1,2 млн')

    def test_sign_tasks_and_done(self):
        from crm import DealBook, TaskBook
        from crm_exec import ExecBook, ExecTasks, Sums
        ExecBook(self.st).mark(self.did, 'sign', day(-10), 'Иванова')
        deal = DealBook(self.st).get(self.did)
        self.assertEqual(deal['stage'], 'contract', 'договор подписан — этап «Договор и оплата»')
        view = self.view(Sums.SALES)
        self.assertEqual((view['how'], view['start']), ('fact', day(-10)))
        by_key = {step['key']: step for step in view['steps']}
        self.assertEqual(by_key['p:c1']['state'], 'overdue')
        self.assertEqual(by_key['ready']['plan'], day(20))
        tasks = {task['step']: task for task in TaskBook(self.st).list(deal=self.did) if task.get('step')}
        self.assertEqual(sorted(tasks), ['p:c1', 'p:sp:s1:0'], 'дела — на подошедшие точки (7 дней), не на далёкие')
        self.assertEqual(tasks['p:c1']['due'], day(0), 'просроченная точка — дело на сегодня')
        self.assertTrue(tasks['p:sp:s1:0']['title'].startswith('Оплатить поставщику'))
        self.assertEqual(ExecTasks(self.st).sweep(), 0, 'повторно дела не ставятся')
        TaskBook(self.st).update(tasks['p:c1']['id'], {'state': 'done'}, 'Иванова')
        by_key = {step['key']: step for step in self.view(Sums.SALES)['steps']}
        self.assertEqual((by_key['p:c1']['state'], by_key['p:c1']['fact']), ('done', day(0)), 'сделанное дело отметило точку')
        self.assertEqual(self.view(Sums.SALES)['paid'], 500000)
        ExecBook(self.st).mark(self.did, 'p:sp:s1:0', day(-1), 'Иванова')
        task = TaskBook(self.st).get(tasks['p:sp:s1:0']['id'])
        self.assertEqual(task['state'], 'done', 'отмеченная точка закрыла своё дело')
        ExecBook(self.st).mark(self.did, 'p:sp:s1:0', '', 'Иванова')
        self.assertNotEqual({s['key']: s for s in self.view(Sums.SALES)['steps']}['p:sp:s1:0']['state'], 'done', 'отметку можно снять')
        with self.assertRaises(ValueError):
            ExecBook(self.st).mark(self.did, 'nope', day(0), 'Иванова')
        with self.assertRaises(ValueError):
            ExecBook(self.st).mark(self.did, 'ready', '20.10.2026', 'Иванова')
        history = [row['what'] for row in DealBook(self.st).get(self.did)['history']]
        self.assertIn('exec', history)


if __name__ == '__main__':
    unittest.main()
