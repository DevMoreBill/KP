# -*- coding: utf-8 -*-
"""Заявка из письма или ТЗ (app/deal_intake.py, маршрут /api/crm/intake): клиент по ИНН, телефону, почте; название
организации, контакт из подписи, тема, бренд и модели каталога; свои реквизиты (почта и телефон менеджеров) не берутся;
письмо .eml без цитаты ответа; нейросеть выключена — правила; контакт — в карточку клиента без дублей. Вымышленные данные."""
import json
import unittest
from email.message import EmailMessage

from kit import Http, SampleData, Stand, TempStore

LETTER = '''Добрый день!

Просим выставить КП на винтовой компрессор ТестМаш ВК-10Т, 2 шт., поставка в г. Казань до конца ноября.
Объект — цех № 3, давление 8 бар.

С уважением,
Кузнецова Мария Ивановна
ООО «Ромашка-Прогон», ИНН 7701234567
тел. +7 (916) 555-44-33, m.kuz@romashka-test.ru
'''


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        self.st.manager_put('m1', json.dumps({'name': 'Иванова Анна', 'email': 'ivanova@pnevmo-test.ru',
                                              'phone': '+7 495 000-11-22'}, ensure_ascii=False), 'тест')
        for cid, name, maker in (('c1', 'Винтовой компрессор ТестМаш ВК-10Т', 'ТестМаш'),
                                 ('c2', 'Винтовой компрессор ТестМаш ВК-15Т', 'ТестМаш'),
                                 ('c3', 'Осушитель Сушка ОР-24', 'Сушка')):
            self.st.catalog_put(cid, json.dumps({'id': cid, 'name': name, 'attrs': {'maker': maker}, 'price': 100000},
                                                ensure_ascii=False), 'тест')

    def intake(self):
        from deal_intake import DealIntake
        return DealIntake(self.st)

    def test_letter_rules(self):
        got = self.intake().parse({'text': LETTER + '\nИванова Анна, ivanova@pnevmo-test.ru, +7 495 000-11-22'})
        self.assertFalse(got['ai'])
        self.assertEqual((got['company'], got['inn']), ('ООО «Ромашка-Прогон»', '7701234567'))
        self.assertEqual(got['person'], 'Кузнецова Мария Ивановна')
        self.assertEqual((got['phone'], got['email']), ('+7 (916) 555-44-33', 'm.kuz@romashka-test.ru'), 'свои — не берутся')
        self.assertTrue(got['topic'].startswith('Просим выставить КП'))
        self.assertEqual(got['brand'], 'ТестМаш')
        self.assertEqual([row['id'] for row in got['models']], ['c1'], 'ВК-15Т в письме нет')
        self.assertEqual(got['client'], {'id': '', 'name': 'ООО «Ромашка-Прогон»', 'inn': '7701234567', 'known': False})

    def test_known_client_by_phone(self):
        self.st.client_put('inn7709999999', {'id': 'inn7709999999', 'name': 'АО «Известный»', 'inn': '7709999999',
                                             'contacts': [{'name': 'Кузнецова', 'phone': '8 916 555 44 33'}]}, 'тест')
        got = self.intake().parse({'text': LETTER.replace('ИНН 7701234567', '')})
        self.assertEqual((got['client']['id'], got['client']['known']), ('inn7709999999', True))

    def test_eml(self):
        from deal_intake import DealIntake
        msg = EmailMessage()
        msg['From'] = 'Мария Кузнецова <m.kuz@romashka-test.ru>'
        msg['Subject'] = 'Запрос: компрессор ВК-10Т'
        msg.set_content('Нужен компрессор ВК-10Т.\n\n> старое письмо\n> ИНН 7700000000')
        mail = DealIntake(self.st).read('Запрос.eml', bytes(msg))
        self.assertEqual((mail['subject'], mail['email'], mail['name']),
                         ('Запрос: компрессор ВК-10Т', 'm.kuz@romashka-test.ru', 'Мария Кузнецова'))
        self.assertNotIn('7700000000', mail['text'], 'цитата прежнего письма отброшена')
        got = self.intake().parse(mail)
        self.assertEqual((got['topic'], got['person'], got['inn']), ('Запрос: компрессор ВК-10Т', 'Мария Кузнецова', ''))
        with self.assertRaises(ValueError):
            DealIntake(self.st).read('scan.exe', b'MZ\x00\x01\x02' * 100)

    def test_empty_and_contact(self):
        with self.assertRaises(ValueError):
            self.intake().parse({'text': '   '})
        self.st.client_put('inn7701234567', {'id': 'inn7701234567', 'name': 'ООО «Ромашка-Прогон»', 'inn': '7701234567',
                                             'contacts': [{'name': 'Сидоров', 'phone': '+7 900 111-22-33'}]}, 'тест')
        intake = self.intake()
        intake.attach_contact('inn7701234567', {'name': 'Кузнецова Мария', 'phone': '+7 (916) 555-44-33',
                                                'email': 'm.kuz@romashka-test.ru'}, 'тест')
        intake.attach_contact('inn7701234567', {'name': 'Кузнецова', 'phone': '8 916 555-44-33'}, 'тест')
        intake.attach_contact('inn7701234567', {'name': 'Без связи', 'phone': '12'}, 'тест')
        names = [row['name'] for row in self.st.client_get('inn7701234567')['contacts']]
        self.assertEqual(names, ['Сидоров', 'Кузнецова Мария'], 'без дублей и без контакта без телефона и почты')


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=6, clients=2, kps=2))
        cls.stand.start()
        cls.H = Stand.as_manager(SampleData.MANAGERS[0])

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_text_file_and_create(self):
        status, body, _ = self.stand.http.req('POST', '/api/crm/intake', {'text': LETTER}, headers=self.H)
        self.assertEqual(status, 200, body)
        got = Http.js(body)
        self.assertEqual(got['inn'], '7701234567')
        status, body, _ = self.stand.http.req('POST', '/api/crm/intake?name=%D0%97.txt', LETTER.encode('utf-8'),
                                              headers=dict(self.H, **{'Content-Type': 'application/octet-stream'}))
        self.assertEqual((status, Http.js(body)['person']), (200, 'Кузнецова Мария Ивановна'))
        status, body, _ = self.stand.http.req('POST', '/api/crm/intake', {'text': ''}, headers=self.H)
        self.assertEqual(status, 400, body)
        client = Http.js(self.stand.http.req('GET', '/api/clients?q=', headers=self.H)[1])
        cid = (client.get('items') or [{}])[0].get('id')
        if cid:
            status, body, _ = self.stand.http.req('POST', '/api/crm/deal', {
                'client': 'x', 'clientId': cid, 'title': 'Из письма', 'note': got['summary'],
                'contact': {'name': 'Кузнецова Мария', 'phone': '+7 916 555-44-33'}}, headers=self.H)
            self.assertEqual(status, 200, body)
            card = Http.js(self.stand.http.req('GET', '/api/clients/' + cid, headers=self.H)[1]) or {}
            self.assertIn('Кузнецова Мария', [row.get('name') for row in card.get('contacts') or []])


if __name__ == '__main__':
    unittest.main()
