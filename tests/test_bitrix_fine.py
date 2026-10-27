# -*- coding: utf-8 -*-
"""Тонкие правила обмена с Битрикс24 (3.219.0): контакты, компании, сделки, дела — каждая настройка меняет то, что
обещает её описание, а по умолчанию всё работает как раньше."""
import time
import unittest

from test_bitrix import SyncBase


class BitrixFineRulesTest(SyncBase):
    def rules(self, **parts):
        from bitrix import BitrixConf
        BitrixConf(self.st).save(parts, 'тест')

    def send(self, kid):
        from bitrix import BitrixQueue
        did = self.kp(kid)
        BitrixQueue.touch(self.st, 'deal', did)
        res = self.sync().run()
        self.assertEqual(res['failed'], 0, res)
        return did

    def test_defaults_same_as_before(self):
        from bitrix import BitrixConf
        view = BitrixConf(self.st).rules().view()
        self.assertEqual(view['contacts'], {'dir': 'both', 'create': True, 'fill': True, 'deal': True, 'max': 3, 'bare': True, 'junk': True})
        self.assertEqual(view['deals'], {'newFlag': True, 'gone': 'unlink'})
        self.assertTrue(all(view['company'][key] for key in ('byComm', 'fill', 'check', 'byPeople')))
        self.assertEqual(view['tasks']['in'], {'call': True, 'meet': True, 'mail': True, 'task': True})
        self.assertTrue(view['tasks']['done'])

    def test_old_contacts_direction_kept(self):
        """Направление контактов прежде хранилось у компаний — после обновления действует то же."""
        self.rules(company={'contacts': 'out'})
        from bitrix import BitrixConf
        self.assertEqual(BitrixConf(self.st).rules().contacts()['dir'], 'out')
        self.rules(company={'find': 'inn'})
        self.assertEqual(BitrixConf(self.st).rules().contacts()['dir'], 'out', 'сохранение компаний его не сбрасывает')
        self.rules(contacts={'dir': 'in'})
        self.assertEqual(BitrixConf(self.st).rules().contacts()['dir'], 'in')

    def test_checks(self):
        for bad in ({'contacts': {'max': 0}}, {'contacts': {'max': 11}}, {'contacts': {'dir': 'x'}}, {'deals': {'gone': 'x'}}):
            with self.subTest(bad), self.assertRaises(ValueError):
                self.rules(**bad)

    def test_contacts_not_created_when_off(self):
        self.rules(contacts={'create': False})
        self.send('26-0101')
        self.assertEqual(len(self.fake.contacts), 0, 'контакт не создан')
        self.assertEqual(self.fake.deal_people, {}, 'к сделке не привязан')

    def test_contacts_found_still_linked_when_create_off(self):
        found = self.fake.handle('crm.contact.add', {'fields': {'NAME': 'Пётр', 'LAST_NAME': 'Сидоров', 'PHONE': [{'VALUE': '+79001112233'}]}})['result']
        self.rules(contacts={'create': False})
        self.send('26-0102')
        self.assertEqual(list(self.fake.contacts), [str(found)], 'найденный в Битриксе — привязан, новых нет')
        bid = list(self.fake.deals)[0]
        self.assertIn(str(found), self.fake.deal_people.get(bid, []))

    def test_contact_not_bound_to_deal(self):
        self.rules(contacts={'deal': False})
        self.send('26-0103')
        self.assertEqual(len(self.fake.contacts), 1, 'контакт создан у компании')
        self.assertEqual(self.fake.deal_people, {}, 'к сделке не привязан')

    def test_contacts_max(self):
        doc = self.st.client_get('inn7700000001')
        names = ('Аксенов Иван', 'Борисов Пётр', 'Волков Олег', 'Гусев Илья', 'Данилов Глеб')
        doc['contacts'] = [{'name': name, 'phone': f'+7900000000{i}'} for i, name in enumerate(names)]
        self.st.client_put('inn7700000001', doc, 'тест')
        self.rules(contacts={'max': 2})
        self.send('26-0104')
        self.assertEqual(len(self.fake.contacts), 2)

    def test_bare_and_junk_contacts_in(self):
        from crm import DealBook
        self.rules(contacts={'bare': False, 'junk': False})
        cid = self.fake.handle('crm.company.add', {'fields': {'TITLE': 'ООО «Дельта»'}})['result']
        self.fake.handle('crm.requisite.add', {'fields': {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': cid, 'RQ_INN': '7800000003'}})
        for name, phone in (('Без Телефона', ''), ('С Телефоном', '+7 911 222-33-44')):
            last, first = name.split()
            self.fake.handle('crm.contact.add', {'fields': {'NAME': first, 'LAST_NAME': last, 'COMPANY_ID': cid,
                                                            'PHONE': [{'VALUE': phone}] if phone else []}})
        time.sleep(1.1)
        self.fake.new_deal(TITLE='Насос', COMPANY_ID=str(cid))
        self.sync().run()
        names = [row['name'] for row in self.st.client_get('inn7800000003').get('contacts') or []]
        self.assertIn('С Телефоном', names)
        self.assertNotIn('Без Телефона', names, 'контакты без телефона и почты не загружаются')
        self.assertTrue([x for x in DealBook(self.st).deals(None) if x['title'] == 'Насос'])

    def test_company_fill_off(self):
        from bitrix import BitrixQueue
        did = self.send('26-0105')
        company = list(self.fake.companies.values())[0]
        self.assertEqual(company.get('EMAIL'), [])
        self.st.client_put('inn7700000001', dict(self.st.client_get('inn7700000001'), email='new@alfa.ru'), 'тест')
        self.rules(company={'fill': False})
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(company.get('EMAIL'), [], 'почта в компанию Битрикса не дописана')

    def test_company_by_comm_off(self):
        self.st.client_put('inn7700000001', dict(self.st.client_get('inn7700000001'), email='office@alfa.ru'), 'тест')
        orig = self.fake.handle('crm.company.add', {'fields': {'TITLE': 'Альфа', 'EMAIL': [{'VALUE': 'office@alfa.ru'}]}})['result']
        self.rules(company={'byComm': False, 'find': 'inn'})
        self.send('26-0106')
        self.assertNotEqual(str(list(self.fake.deals.values())[0]['COMPANY_ID']), str(orig), 'по почте не ищется')

    def test_company_check_off(self):
        from bitrix import BitrixConf
        self.rules(company={'check': False})
        BitrixConf(self.st).mark(companyCheck='2000-01-01')
        self.send('26-0107')
        self.assertEqual(BitrixConf(self.st).get()['companyCheck'], '2000-01-01', 'проверка не выполнялась')

    def test_new_deal_not_flagged(self):
        from crm import DealBook
        self.rules(deals={'newFlag': False})
        time.sleep(1.1)
        self.fake.new_deal(TITLE='Без отметки', ASSIGNED_BY_ID='7')
        self.sync().run()
        deal = [x for x in DealBook(self.st).deals(None) if x['title'] == 'Без отметки'][0]
        self.assertFalse(deal.get('bxNew'))

    def gone(self, how):
        from bitrix import BitrixLinks, BitrixQueue
        self.rules(deals={'gone': how})
        did = self.send('26-0108')
        bid = list(self.fake.deals)[0]
        del self.fake.deals[bid]
        BitrixQueue.touch(self.st, 'deal', did)
        return did, bid, self.sync().run(), BitrixLinks(self.st)

    def test_gone_unlink(self):
        from bitrix import BitrixQueue
        did, bid, res, links = self.gone('unlink')
        self.assertEqual(res['failed'], 0, res)
        self.assertEqual(links.get('deal', did)['sent'].get('gone'), bid)
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(self.fake.deals, {}, 'в Битрикс больше не отправляется')

    def test_gone_recreate(self):
        did, bid, res, links = self.gone('recreate')
        self.assertEqual(res['failed'], 0, res)
        self.assertEqual(len(self.fake.deals), 1)
        self.assertNotEqual(links.get('deal', did)['bx'], bid, 'создана заново')

    def test_gone_keep(self):
        _did, _bid, res, _links = self.gone('keep')
        self.assertEqual(res['failed'], 1, 'ошибка — в «Не отправлено»')

    def test_tasks_in_kinds_and_done(self):
        from crm import TaskBook
        did = self.send('26-0109')
        bid = list(self.fake.deals)[0]
        self.rules(tasks={'in': {'call': False}, 'done': False})
        time.sleep(1.1)
        self.fake.add_activity(bid, 'Звонок клиенту', '2026-10-25T10:00:00+03:00', TYPE_ID='2')
        self.fake.add_activity(bid, 'Встреча на объекте', '2026-10-25T14:00:00+03:00', TYPE_ID='1', COMPLETED='Y')
        self.fake.add_activity(bid, 'Встреча в офисе', '2026-10-26T14:00:00+03:00', TYPE_ID='1')
        self.sync().run()
        titles = [x['title'] for x in TaskBook(self.st).list(deal=did)]
        self.assertEqual(titles, ['Встреча в офисе'], 'звонки не загружаются, выполненные — тоже')


if __name__ == '__main__':
    unittest.main()
