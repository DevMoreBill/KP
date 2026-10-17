# -*- coding: utf-8 -*-
"""Связь с Битрикс24 (bitrix.py) на подставном Битриксе (bitrix_fake.py): сделка с компанией по ИНН (без дублей), товары,
экономика в своих полях, файлы КП в ленте; изменения из Битрикса — стадия, дата, ответственный, новые сделки воронки, дела;
приоритет полей (сумма и экономика — из программы, остальное — последняя правка); очередь при недоступном Битриксе;
ключ вебхука не попадает в ответы «Настроек» и журнал; файл настроек — адрес только «с ключами API»."""
import json
import time
import unittest
import urllib.request
from datetime import date

from bitrix_fake import FakeBitrix
from kit import Http, SampleData, Stand, TempStore


def direct():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeBitrix()
        self.addCleanup(self.fake.stop)
        self.st = TempStore(self).store
        st = self.st
        st.manager_put('m1', json.dumps({'name': 'Иванова Анна', 'email': 'Ivanova@example.com'}, ensure_ascii=False), 'тест')
        st.manager_put('m2', json.dumps({'name': 'Петров Олег', 'email': 'petrov@example.com'}, ensure_ascii=False), 'тест')
        st.client_put('inn7700000001', {'id': 'inn7700000001', 'name': 'ООО «Альфа»', 'inn': '7700000001', 'kpp': '770001001', 'address': 'г. Москва',
                                        'contacts': [{'name': 'Сидоров Пётр', 'post': 'Главный инженер', 'phone': '+7 900 111-22-33', 'email': 's@alfa.ru'}]}, 'тест')
        from bitrix import BitrixConf
        BitrixConf(st).save({'url': self.fake.url, 'category': '3', 'on': True,
                             'stages': {'lead': 'C3:NEW', 'sent': 'C3:PREPARATION', 'talks': 'C3:EXECUTING', 'contract': 'C3:FINAL_INVOICE', 'won': 'C3:WON', 'lost': 'C3:LOSE'},
                             'users': {'m1': '7', 'm2': '8'}}, 'тест')
        self.files = {}

    def sync(self):
        from bitrix import BitrixSync
        return BitrixSync(self.st, direct(), files=lambda kid: self.files.get(kid, []))

    def kp(self, kid, total=100000000, **kw):
        from crm import DealBook
        m = dict({'id': kid, 'number': kid, 'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'authorId': 'm1', 'manager': 'Иванова Анна',
                  'date': date.today().isoformat(), 'savedAt': '2026-10-17T10:%s:00' % kid[-2:], 'sum': total, 'items': ['Компрессор ВК-' + kid],
                  'deal': {'confirmed': True, 'profit': 150000.5, 'net': 120000, 'margin': 18.2, 'markup': 22.3,
                           'full': {'price': 1000000, 'revenue': 819672.13, 'cost': 669671.6, 'fin': 12000, 'parts': [['Оборудование', 600000], ['Логистика до границы', 40000]],
                                    'pays': [{'d': '2026-11-01', 't': 'Аванс 30 %', 'a': 300000}]}},
                  'lines': {'rate': 1, 'vat': 22, 'rows': [{'n': 'Компрессор ВК-' + kid, 'q': 2, 'p': 50000000, 'u': 'шт'}]}}, **kw)
        self.st.kp_set(kid, 'meta', json.dumps(m, ensure_ascii=False), 'тест')
        return DealBook(self.st).on_kp(kid, m, 'Иванова Анна')

    def test_push_deal_company_rows_fields_files(self):
        from bitrix import BitrixQueue, BitrixLog
        did = self.kp('26-0001')
        self.files['26-0001'] = [('КП 26-0001.docx', b'PK-docx', 'КП (Word)'), ('КП 26-0001.pdf', b'%PDF', 'КП (PDF)')]
        BitrixQueue.touch(self.st, 'deal', did)
        res = self.sync().run()
        self.assertEqual((res['sent'], res['failed']), (1, 0), res)
        f = self.fake
        self.assertEqual(len(f.ufields), 10, 'поля экономики созданы')
        self.assertEqual(len(f.companies), 1)
        co = list(f.companies.values())[0]
        self.assertEqual(co['TITLE'], 'ООО «Альфа»')
        self.assertEqual(list(f.requisites.values())[0]['RQ_INN'], '7700000001')
        self.assertEqual(list(f.contacts.values())[0]['LAST_NAME'], 'Сидоров')
        d = list(f.deals.values())[0]
        self.assertEqual((d['CATEGORY_ID'], d['STAGE_ID'], d['ASSIGNED_BY_ID'], d['OPPORTUNITY']), ('3', 'C3:NEW', '7', 1000000.0))
        self.assertEqual(d['UF_CRM_KP_PROFIT'], 150000.5)
        self.assertIn('Оборудование: 600 000 ₽', d['UF_CRM_KP_ECON'])
        self.assertIn('Аванс 30 %', d['UF_CRM_KP_ECON'])
        self.assertEqual(f.rows[d['ID']][0]['PRICE'], 500000.0)
        self.assertEqual([c['FILES'][0][0] for c in f.comments], ['КП 26-0001.docx', 'КП 26-0001.pdf'])
        # второе КП того же клиента — компания та же (по ИНН), файлы — не повторяются
        did2 = self.kp('26-0002')
        BitrixQueue.touch(self.st, 'deal', did2)
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(len(f.companies), 1, 'дублей компании нет')
        self.assertEqual(len(f.deals), 2)
        self.assertEqual(len(f.comments), 2, 'неизменённые файлы второй раз не отправляются')
        self.files['26-0001'] = [('КП 26-0001.docx', b'PK-docx-v2', 'КП (Word)')]
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(len(f.comments), 3, 'новая версия файла — новая запись в ленте')
        self.assertIn('новая версия', f.comments[-1]['COMMENT'])
        self.assertNotIn(FakeBitrix.KEY, json.dumps(BitrixLog(self.st).tail(), ensure_ascii=False))

    def test_pull_fields_priority_and_new_deal(self):
        from crm import DealBook
        from bitrix import BitrixQueue
        did = self.kp('26-0003')
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        bid = list(self.fake.deals)[0]
        # в Битриксе: стадия, дата, ответственный, сумма (сумма с КП — из программы)
        time.sleep(1.1)
        self.fake.edit_deal(bid, STAGE_ID='C3:EXECUTING', CLOSEDATE='2026-12-20T03:00:00+03:00', ASSIGNED_BY_ID='8', OPPORTUNITY='1')
        res = self.sync().run()
        self.assertEqual(res['pulled'], 1, res)
        d = DealBook(self.st).get(did)
        self.assertEqual((d['stage'], d['expected'], d['managerId']), ('talks', '2026-12-20', 'm2'))
        self.assertEqual(d['sum'], 100000000, 'сумма с КП — из программы')
        # своя правка программы уходит в Битрикс, а сумма в Битриксе возвращается к сумме КП
        DealBook(self.st).update(did, {'stage': 'contract'}, 'Петров')
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(self.fake.deals[bid]['STAGE_ID'], 'C3:FINAL_INVOICE')
        self.assertEqual(self.fake.deals[bid]['OPPORTUNITY'], 1000000.0)
        # проиграно в Битриксе — с причиной
        time.sleep(1.1)
        self.fake.edit_deal(bid, STAGE_ID='C3:LOSE')
        self.sync().run()
        d = DealBook(self.st).get(did)
        self.assertEqual((d['stage'], d['lostReason']), ('lost', 'Проиграно в Битрикс24'))
        # новая сделка воронки (после включения связи) — в кабинете у ответственного; сделки другой воронки — нет
        time.sleep(1.1)
        cid = self.fake.handle('crm.company.add', {'fields': {'TITLE': 'ООО «Бета»', 'PHONE': [{'VALUE': '+7 911 000-00-00'}]}})['result']
        self.fake.handle('crm.requisite.add', {'fields': {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': cid, 'RQ_INN': '7800000002'}})
        nb = self.fake.new_deal(TITLE='Компрессор для цеха', COMPANY_ID=str(cid), OPPORTUNITY='250000.00', ASSIGNED_BY_ID='8')
        self.fake.new_deal(TITLE='Чужая воронка', CATEGORY_ID='0', STAGE_ID='NEW')
        res = self.sync().run()
        self.assertEqual(res['created'], 1, res)
        mine = [x for x in DealBook(self.st).deals(['m2']) if x['title'] == 'Компрессор для цеха']
        self.assertEqual(len(mine), 1)
        self.assertEqual((mine[0]['client'], mine[0]['clientInn'], mine[0]['sum'], mine[0]['stage']), ('ООО «Бета»', '7800000002', 25000000, 'lead'))
        self.assertEqual(self.st.client_get('inn7800000002')['contacts'][0]['phone'], '+7 911 000-00-00', 'телефон компании — в справочник')
        # повторный опрос не создаёт дублей и не отправляет пришедшее обратно
        n = len(self.fake.deals)
        self.sync().run()
        self.assertEqual(len(self.fake.deals), n)
        self.assertEqual(len([x for x in DealBook(self.st).deals(None) if x['title'] == 'Компрессор для цеха']), 1)
        self.assertTrue(nb)

    def test_tasks_both_ways(self):
        from crm import TaskBook
        from bitrix import BitrixQueue
        did = self.kp('26-0004')
        tb = TaskBook(self.st)
        t = tb.add({'kind': 'call', 'due': '2026-10-20', 'time': '11:00', 'title': 'Уточнить бюджет'}, 'm1', 'И', did)
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        acts = list(self.fake.activities.values())
        self.assertEqual(len(acts), 1)
        self.assertEqual(acts[0]['SUBJECT'], 'Звонок: Уточнить бюджет')
        # сделано в программе → в Битриксе
        tb.update(t['id'], {'state': 'done'})
        BitrixQueue.touch(self.st, 'task', t['id'])
        self.sync().run()
        self.assertEqual(acts[0]['COMPLETED'], 'Y')
        # дело из Битрикса → в кабинет; перенос в Битриксе → в программе
        bid = list(self.fake.deals)[0]
        time.sleep(1.1)
        aid = self.fake.add_activity(bid, 'Встреча: Показ на объекте', '2026-10-25T14:30:00+03:00', TYPE_ID='1')
        res = self.sync().run()
        self.assertEqual(res['tasks'], 1, res)
        got = [x for x in tb.list(deal=did) if x['title'] == 'Показ на объекте']
        self.assertEqual((got[0]['kind'], got[0]['due'], got[0]['state']), ('meet', '2026-10-25', 'open'))
        time.sleep(1.1)
        self.fake.handle('crm.activity.update', {'id': aid, 'fields': {'COMPLETED': 'Y'}})
        self.sync().run()
        self.assertEqual(tb.get(got[0]['id'])['state'], 'done')
        self.assertEqual(len([x for x in tb.list(deal=did)]), 2, 'своё дело не вернулось дублем')

    def test_old_bitrix_without_todo(self):
        from crm import TaskBook
        from bitrix import BitrixQueue
        self.fake.no_todo = True
        did = self.kp('26-0005')
        TaskBook(self.st).add({'kind': 'meet', 'due': '2026-10-21', 'title': 'Встреча'}, 'm1', 'И', did)
        BitrixQueue.touch(self.st, 'deal', did)
        self.assertEqual(self.sync().run()['failed'], 0)
        self.assertEqual(list(self.fake.activities.values())[0]['TYPE_ID'], '1')

    def test_queue_when_down(self):
        from bitrix import BitrixQueue
        did = self.kp('26-0006')
        BitrixQueue.touch(self.st, 'deal', did)
        self.fake.down = True
        res = self.sync().run()
        self.assertIn('error', res)
        self.assertEqual(BitrixQueue(self.st).stats()['queued'], 1, 'Битрикс недоступен — запись ждёт в очереди')
        self.fake.down = False
        BitrixQueue(self.st).retry_all()
        self.assertEqual(self.sync().run()['sent'], 1)
        self.assertEqual(BitrixQueue(self.st).stats()['queued'], 0)

    def test_conf_checks(self):
        from bitrix import BitrixApi, BitrixConf, BitrixError
        with self.assertRaises(BitrixError):
            BitrixApi('https://bitrix24.kompr.ru/')
        BitrixApi('https://bitrix24.kompr.ru/rest/1/q8w7e6r5t4y3/')
        self.assertEqual(BitrixApi.mask('https://bitrix24.kompr.ru/rest/1/q8w7e6r5t4y3/'), 'https://bitrix24.kompr.ru/rest/1/••••y3/'.replace('••••y3', '••••4y3'))
        v = BitrixConf(self.st).view()
        self.assertNotIn(FakeBitrix.KEY, json.dumps(v))
        with self.assertRaises(ValueError):
            BitrixConf(self.st).save({'pollSec': 5}, 'т')
        with self.assertRaises(ValueError):
            BitrixConf(self.st).save({'stages': 'x'}, 'т')
        # неверный ключ — понятная ошибка
        from bitrix import BitrixSync
        BitrixConf(self.st).save({'url': self.fake.url.replace(FakeBitrix.KEY, 'wrongkey99')}, 'т')
        with self.assertRaises(BitrixError) as e:
            BitrixSync(self.st, direct()).check()
        self.assertIn('неверный ключ', str(e.exception))

    def test_check_lists(self):
        r = self.sync().check()
        self.assertEqual([c['id'] for c in r['categories']], ['0', '3'])
        self.assertEqual(r['stages'][-1], {'id': 'C3:LOSE', 'name': 'Провал', 'sem': 'F'})
        self.assertEqual(r['auto'], {'m1': '7', 'm2': '8'}, 'менеджеры — по e-mail без учёта регистра')


class DeskTest(unittest.TestCase):
    """«Настройки → Битрикс24» на стенде: только администратор, ключ не возвращается, файл настроек."""

    @classmethod
    def setUpClass(cls):
        cls.fake = FakeBitrix()
        cls.stand = Stand('server', SampleData(items=10, clients=2, kps=2))
        cls.stand.start()
        cls.h = cls.stand.http

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()
        cls.fake.stop()

    def test_desk(self):
        adm, A = self.stand.admin()
        st, b, _ = self.h.req('POST', '/api/admin/bitrix', {'url': self.fake.url}, headers=Stand.as_manager(SampleData.MANAGERS[0]))
        self.assertIn(st, (401, 403))
        st, b, _ = self.h.req('POST', '/api/admin/bitrix', {'url': self.fake.url, 'category': '3'}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        self.assertNotIn(FakeBitrix.KEY, b)
        st, b, _ = self.h.req('POST', '/api/admin/bitrix/test', {}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        r = Http.js(b)
        self.assertEqual(r['auto'], {'mgr-ivanova': '7', 'mgr-petrov': '8'})
        st, b, _ = self.h.req('POST', '/api/admin/bitrix', {'on': True, 'users': r['auto'], 'stages': {'lead': 'C3:NEW', 'won': 'C3:WON'}}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        self.assertGreater(Http.js(b)['queue']['queued'], 0, 'при включении открытые сделки — в очередь')
        st, b, _ = self.h.req('POST', '/api/admin/bitrix/run', {}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        self.assertEqual(Http.js(b)['queue']['queued'], 0, b)
        self.assertEqual(len(self.fake.deals), 2)
        # карточка сделки — ссылка на сделку Битрикса
        bd = Http.js(self.h.req('GET', '/api/crm/board', headers=Stand.as_manager(SampleData.MANAGERS[0]))[1])
        did = bd['deals'][0]['id']
        card = Http.js(self.h.req('GET', '/api/crm/deal/' + did, headers=Stand.as_manager(SampleData.MANAGERS[0]))[1])
        self.assertIn('/crm/deal/details/', card['bx']['url'])
        # файл настроек: без ключей — без адреса вебхука
        st, b, hd = self.h.req('GET', '/api/admin/settings-file', cookie=adm, headers=dict(A), raw=True)
        self.assertEqual(st, 200)
        self.assertNotIn(FakeBitrix.KEY.encode(), b)
        self.assertIn('"bitrix"'.encode(), b)
        self.assertEqual(self.stand.request_errors(), [])


if __name__ == '__main__':
    unittest.main()
