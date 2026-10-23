# -*- coding: utf-8 -*-
"""Деньги по сделкам 3.200.0: платёжный календарь (crm_money.PayCalendar — оплаты клиентов и платежи поставщикам по плану
исполнения, суммы поставщикам — только с правом экономики), просроченные оплаты и «Напомнить об оплате» (одно дело), 1С по
OData (onec.py — настройки с проверкой и скрытым паролем, поступление по ИНН и номеру КП / сумме отмечает оплату, повтор
не учитывается); маршруты — только администратор. Временная база, вымышленные данные, 1С — подставные ответы."""
import json
import unittest
from datetime import date, timedelta

from kit import SampleData, Stand, TempStore
from test_crm_exec import ExecTest


def day(shift):
    return (date.today() + timedelta(days=shift)).isoformat()


class MoneyBase(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store
        from crm import DealBook
        meta = {'id': 'k1', 'number': '2026-001', 'client': 'ООО «А»', 'clientInn': '7700000001', 'authorId': 'm1', 'manager': 'Иванова',
                'date': day(0), 'sum': 1000000, 'items': ['Компрессор'], 'plan': ExecTest.PLAN}
        self.st.kp_set('k1', 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        self.did = DealBook(self.st).on_kp('k1', meta, 'Иванова')
        book = DealBook(self.st)
        book.update(self.did, {'expected': day(-60), 'clientInn': '7700000001'}, 'тест')


class PayCalendarTest(MoneyBase):
    def test_rows_and_overdue(self):
        from crm_money import PayCalendar
        rows = PayCalendar(self.st).rows(None, lambda deal: False)
        self.assertEqual([row['dir'] for row in rows], ['in', 'in'], 'без права экономики — только оплаты клиентов')
        self.assertTrue(all(row['approx'] for row in rows), 'договор не подписан — даты примерные')
        rows = PayCalendar(self.st).rows(None, lambda deal: True)
        self.assertEqual(sorted(row['dir'] for row in rows), ['in', 'in', 'out', 'out'])
        late = PayCalendar.overdue(rows)
        self.assertEqual(len(late), 2, 'обе оплаты клиента по плану в прошлом')
        self.assertEqual(late[0]['amount'], 500000)
        self.assertEqual(PayCalendar(self.st).rows(['someone-else'], lambda deal: True), [])

    def test_reminder_once(self):
        from crm import DealBook
        from crm_money import PayReminder
        deal = DealBook(self.st).get(self.did)
        first = PayReminder(self.st).add(deal, 'Аванс 50 %', 'тест')
        again = PayReminder(self.st).add(deal, 'Аванс 50 %', 'тест')
        self.assertEqual(first['id'], again['id'], 'второе напоминание не дублирует дело')
        self.assertEqual(first['kind'], 'call')


class OneCTest(MoneyBase):
    KEY = '11111111-2222-3333-4444-555555555555'

    def fake(self, pays):
        calls = []

        def request(url, headers=None, timeout=None):
            calls.append(url)
            self.assertTrue(headers['Authorization'].startswith('Basic '))
            if 'Catalog_' in url:
                return json.dumps({'value': [{'Ref_Key': self.KEY, 'ИНН': '7700000001'}]}).encode()
            return json.dumps({'value': pays}).encode()

        return request, calls

    def sync(self, pays):
        from onec import OneCApi, OneCConf, OneCSync
        OneCConf(self.st).save({'url': 'http://1c.example/base', 'login': 'kp', 'password': 'секрет', 'on': True, 'days': 30})
        request, calls = self.fake(pays)
        api = OneCApi(OneCConf(self.st).get(), request)
        return OneCSync(self.st, api).run(), calls

    def pay(self, ref, amount, purpose):
        return {'Ref_Key': ref, 'Number': '15', 'Date': day(-1) + 'T10:00:00', 'СуммаДокумента': amount,
                'Контрагент_Key': self.KEY, 'НазначениеПлатежа': purpose}

    def test_conf(self):
        from onec import OneCConf
        conf = OneCConf(self.st)
        for bad in ({'url': 'ftp://x'}, {'url': 'http://x', 'days': 0}, {'url': 'http://x y'}):
            with self.assertRaises(ValueError, msg=bad):
                conf.save(bad)
        conf.save({'url': 'http://srv/base/', 'login': 'kp', 'password': 'p1', 'days': 10})
        self.assertEqual(conf.public()['password'], OneCConf.MASK, 'пароль не уходит из сервера')
        conf.save({'url': 'http://srv/base', 'login': 'kp', 'password': OneCConf.MASK, 'days': 10})
        self.assertEqual(conf.get()['password'], 'p1', 'маска — пароль прежний')
        self.assertEqual(conf.get()['url'], 'http://srv/base')

    def test_by_number_and_amount(self):
        from crm_exec import ExecBook
        res, calls = self.sync([self.pay('a1', 500000.0, 'Оплата по счёту № 2026-001 от 01.10'),
                                self.pay('a2', 123.0, 'Прочее')])
        self.assertIn('standard.odata/Document_', calls[0].replace('%D0', ''), calls[0])
        self.assertEqual(len(res['matched']), 1)
        self.assertEqual(res['matched'][0]['step'], 'Аванс 50 % — при подписании')
        done = ExecBook(self.st).deal(self.did)['exec']['done']
        self.assertEqual(done['p:c1']['by'], '1С')
        self.assertEqual(done['p:c1']['at'], day(-1))
        res, _calls = self.sync([self.pay('a1', 500000.0, 'Оплата по счёту № 2026-001')])
        self.assertEqual(res['checked'], 0, 'учтённое поступление второй раз не берётся')
        res, _calls = self.sync([self.pay('a3', 500000.0, 'Окончательный расчёт')])
        self.assertEqual(res['matched'][0]['step'], 'Окончательный расчёт 50 %', 'без номера — по сумме')


class OneCRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=2, clients=1, kps=1))
        cls.stand.start()
        cls.cookie, cls.csrf = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_admin_only(self):
        mgr = Stand.as_manager(SampleData.MANAGERS[0])
        for method, path in (('GET', '/api/onec'), ('PUT', '/api/onec'), ('POST', '/api/onec/sync')):
            status, _b, _h = self.stand.http.req(method, path, {} if method != 'GET' else None, headers=mgr)
            self.assertEqual(status, 403, path)
        status, body, _h = self.stand.http.req('PUT', '/api/onec', {'url': 'http://1c.invalid/base', 'login': 'u', 'password': 'p'},
                                               cookie=self.cookie, headers=self.csrf)
        self.assertEqual(status, 200, body)
        self.assertNotIn('"p"', body)
        status, body, _h = self.stand.http.req('POST', '/api/onec/check', {}, cookie=self.cookie, headers=self.csrf)
        self.assertEqual(json.loads(body)['ok'], False, 'стенд без интернета — понятная причина, не 500')
        status, body, _h = self.stand.http.req('GET', '/api/crm/pay', headers=mgr)
        self.assertEqual(status, 200, body)
        self.assertIn('overdue', json.loads(body))


if __name__ == '__main__':
    unittest.main()
