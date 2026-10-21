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


class SyncBase(unittest.TestCase):
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


class SyncTest(SyncBase):
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
        self.assertEqual([[x[0] for x in c['FILES']] for c in f.comments], [['КП 26-0001.docx', 'КП 26-0001.pdf']], 'КП — одной записью')
        note = f.comments[0]['COMMENT']
        for part in ('КП № 26-0001 от ', 'Предложено:', '• Компрессор ВК-26-0001 — 2 шт × 500\u00a0000 ₽',
                     'Итого: 1\u00a0000\u00a0000 ₽ (с НДС 22 %)', 'Экономика: выручка без НДС 819\u00a0672 ₽',
                     'прибыль до налога 150\u00a0000 ₽', 'маржинальность 18,2 %', 'Файлы: КП (Word), КП (PDF)'):
            self.assertIn(part, note)
        # второе КП того же клиента — компания та же (по ИНН), файлы — не повторяются
        did2 = self.kp('26-0002')
        BitrixQueue.touch(self.st, 'deal', did2)
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(len(f.companies), 1, 'дублей компании нет')
        self.assertEqual(len(f.deals), 2)
        self.assertEqual(len(f.comments), 2, 'второе КП — своей записью (и без файлов), первое не повторяется')
        self.assertIn('КП № 26-0002', f.comments[1]['COMMENT'])
        self.files['26-0001'] = [('КП 26-0001.docx', b'PK-docx-v2', 'КП (Word)'), ('КП 26-0001.pdf', b'%PDF', 'КП (PDF)'),
                                 ('Экономика_КП_26-0001.xlsx', b'PK-xlsx', 'Экономика сделки (Excel)')]
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(len(f.comments), 3)
        self.assertIn('— добавлено: КП (Word), Экономика сделки (Excel)', f.comments[-1]['COMMENT'], 'то же КП — коротко, что добавилось')
        self.assertEqual([x[0] for x in f.comments[-1]['FILES']], ['КП 26-0001.docx', 'Экономика_КП_26-0001.xlsx'])
        self.kp('26-0001', total=120000000)
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(len(f.comments), 4)
        self.assertIn('Итого: 1\u00a0200\u00a0000 ₽', f.comments[-1]['COMMENT'])
        self.assertIn('(новая версия КП)', f.comments[-1]['COMMENT'])
        self.assertNotIn('FILES', f.comments[-1], 'файлы те же — не прикладываются повторно')
        self.assertNotIn(FakeBitrix.KEY, json.dumps(BitrixLog(self.st).tail(), ensure_ascii=False))

    def test_comment_to_timeline(self):
        """Комментарий ленты сделки уходит в ленту сделки Битрикса один раз; пустой и слишком длинный — ошибка."""
        from bitrix import BitrixQueue
        from crm import DealBook
        did = self.kp('26-0021')
        book = DealBook(self.st)
        row = book.comment(did, '  Клиент ждёт ответа до пятницы  ', 'Иванова Анна')
        self.assertEqual((row['id'], row['text']), (1, 'Клиент ждёт ответа до пятницы'))
        for bad in ('', ' ', 'x' * (book.COMMENT_MAX + 1)):
            with self.assertRaises(ValueError):
                book.comment(did, bad, 'Иванова Анна')
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        notes = [c['COMMENT'] for c in self.fake.comments if 'пятницы' in c['COMMENT']]
        self.assertEqual(notes, ['Иванова Анна: Клиент ждёт ответа до пятницы'])

    def test_my_company(self):
        """Наша компания в сделке: по умолчанию ПНЕВМОТЕХ (а не компания портала по умолчанию), выбор в карточке — уходит в Битрикс."""
        from bitrix import BitrixQueue
        from bitrix_my import MyCompanies
        from crm import DealBook
        for cid, title in (('901', 'ООО «Пневмоком»'), ('902', 'ООО «ПНЕВМОТЕХ»')):
            self.fake.companies[cid] = {'ID': cid, 'TITLE': title, 'IS_MY_COMPANY': 'Y'}
        did = self.kp('26-0011')
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual([row['title'] for row in MyCompanies(self.st).all()], ['ООО «Пневмоком»', 'ООО «ПНЕВМОТЕХ»'])
        bid = self.st.one("SELECT bx_id FROM bx_link WHERE kind='deal' AND local_id=?", (did,))[0]
        self.assertEqual(self.fake.deals[str(bid)]['MYCOMPANY_ID'], 902, 'по умолчанию — ПНЕВМОТЕХ')
        DealBook(self.st).update(did, {'myCompany': '901'}, 'Иванова Анна')
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(self.fake.deals[str(bid)]['MYCOMPANY_ID'], 901, 'выбор менеджера')
        with self.assertRaises(ValueError):
            DealBook(self.st).update(did, {'myCompany': 'x'}, 'Иванова Анна')
        from bitrix import BitrixConf
        BitrixConf(self.st).save({'company': {'my': '901'}}, 'тест')
        self.assertEqual(MyCompanies(self.st).default(BitrixConf(self.st).rules().company()['my']), '901', 'выбор администратора')

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
        self.assertTrue(mine[0].get('bxNew'), 'новая из Битрикса — отмечена для кабинета')
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


class RulesTest(SyncBase):
    """Тонкая настройка (19.10): направления, менеджеры, поля, воронки, товары и файлы, компании, дела, расписание, пробный прогон,
    старые сделки с даты, журнал «было → стало» по менеджеру."""

    def conf(self, **d):
        from bitrix import BitrixConf
        return BitrixConf(self.st).save(d, 'тест')

    def push(self, did):
        from bitrix import BitrixQueue
        BitrixQueue.touch(self.st, 'deal', did)
        return self.sync().run()

    def test_only_from_bitrix(self):
        from crm import DealBook
        self.conf(mode='in')
        did = self.kp('26-0101')
        self.push(did)
        self.assertEqual(self.fake.deals, {}, 'только из Битрикса — в Битрикс ничего не пишется')
        self.assertFalse(any(m.endswith('.add') or m.endswith('.update') for m in self.fake.methods()), self.fake.methods())
        nb = self.fake.new_deal(TITLE='Насосная станция', ASSIGNED_BY_ID='7')
        self.assertEqual(self.sync().run()['created'], 1)
        d = next(x for x in DealBook(self.st).deals(None) if x['title'] == 'Насосная станция')
        DealBook(self.st).update(d['id'], {'stage': 'talks'}, 'Иванова')       # правка в программе остаётся в программе
        self.sync().run()
        self.assertEqual(self.fake.deals[nb]['STAGE_ID'], 'C3:NEW')
        self.assertEqual(DealBook(self.st).get(d['id'])['stage'], 'talks')
        time.sleep(1.1)
        self.fake.edit_deal(nb, STAGE_ID='C3:FINAL_INVOICE')                # изменили в Битриксе — значение Битрикса
        self.sync().run()
        self.assertEqual(DealBook(self.st).get(d['id'])['stage'], 'contract')

    def test_managers_and_fallback(self):
        from crm import DealBook
        self.conf(mgr={'m2': {'on': False}, 'm1': {'dir': 'both'}}, fallback='m1')
        d2 = self.kp('26-0102', authorId='m2', manager='Петров Олег')
        self.push(d2)
        self.assertEqual(self.fake.deals, {}, 'менеджер не участвует — его сделки не уходят')
        self.fake.new_deal(TITLE='Сделка Петрова', ASSIGNED_BY_ID='8')
        self.fake.new_deal(TITLE='Сделка без пары', ASSIGNED_BY_ID='99')
        res = self.sync().run()
        self.assertEqual((res['created'], res['skipped']), (1, 1), res)
        got = next(x for x in DealBook(self.st).deals(None) if x['title'] == 'Сделка без пары')
        self.assertEqual(got['managerId'], 'm1', 'ответственный не сопоставлен — менеджеру по правилу')
        self.conf(fallback='skip')
        self.fake.new_deal(TITLE='Ещё без пары', ASSIGNED_BY_ID='99')
        self.assertEqual(self.sync().run()['created'], 0)

    def test_field_map(self):
        self.conf(fields={'KP_PROFIT': {'dir': 'off'}, 'KP_COST': {'bx': 'UF_CRM_1700000001'}, 'dealNo': {'dir': 'out'},
                          'title': {'dir': 'out'}, 'note': {'win': 'ours'}})
        did = self.kp('26-0103')
        self.push(did)
        d = list(self.fake.deals.values())[0]
        self.assertNotIn('UF_CRM_KP_PROFIT', d, 'поле выключено — не передаётся')
        self.assertEqual(d['UF_CRM_1700000001'], 669671.6, 'себестоимость — в существующее поле портала')
        self.assertNotIn('UF_CRM_KP_COST', d)
        self.assertIn('UF_CRM_KP_DEALNO', [u['FIELD_NAME'] for u in self.fake.ufields], 'своё поле включили — создано')
        self.assertNotIn('UF_CRM_KP_PROFIT', [u['FIELD_NAME'] for u in self.fake.ufields])
        self.assertTrue(d['UF_CRM_KP_DEALNO'])
        time.sleep(1.1)
        self.fake.edit_deal(d['ID'], TITLE='Переименовали в Битриксе')
        self.sync().run()
        self.push(did)
        self.assertNotEqual(self.fake.deals[d['ID']]['TITLE'], 'Переименовали в Битриксе', 'название — только из программы')
        from bitrix import BitrixConf
        with self.assertRaises(ValueError):
            BitrixConf(self.st).save({'fields': {'KP_NET': {'dir': 'in'}}}, 'т')      # экономика — только в Битрикс
        with self.assertRaises(ValueError):
            BitrixConf(self.st).save({'fields': {'note': {'bx': 'uf crm; drop'}}}, 'т')

    def test_funnels(self):
        from crm import DealBook
        self.conf(cats=['0'], stagesBy={'0': {'lead': 'NEW', 'won': 'WON'}}, mgr={'m2': {'cat': '0'}})
        self.fake.new_deal(TITLE='Из общей воронки', CATEGORY_ID='0', STAGE_ID='NEW', ASSIGNED_BY_ID='7')
        self.assertEqual(self.sync().run()['created'], 1)
        got = next(x for x in DealBook(self.st).deals(None) if x['title'] == 'Из общей воронки')
        self.assertEqual(got['stage'], 'lead')
        d2 = self.kp('26-0104', authorId='m2', manager='Петров Олег')
        self.push(d2)
        mine = [x for x in self.fake.deals.values() if 'UF_CRM_KP_NUMBER' in x]
        self.assertEqual((mine[0]['CATEGORY_ID'], mine[0]['STAGE_ID']), ('0', 'NEW'), 'сделка менеджера — в его воронку, этап — по её соответствию')
        v = self.conf(category='0')               # смена основной воронки: этапы прежней остаются за ней, у новой — свои
        self.assertEqual((v['stages'], v['stagesBy']['3']['lead']), ({'lead': 'NEW', 'won': 'WON'}, 'C3:NEW'))

    def test_send_company_tasks(self):
        from crm import TaskBook
        self.conf(send={'rows': True, 'rowsHow': 'sum', 'files': {'word': False}}, company={'create': False},
                  tasks={'kinds': {'call': 'off', 'meet': 'call'}, 'other': False})
        did = self.kp('26-0105')
        self.files['26-0105'] = [('КП.docx', b'PK-docx', 'КП (Word)'), ('КП.pdf', b'%PDF', 'КП (PDF)')]
        tb = TaskBook(self.st)
        tb.add({'kind': 'call', 'due': '2026-10-20', 'title': 'Позвонить'}, 'm1', 'И', did)
        tb.add({'kind': 'meet', 'due': '2026-10-21', 'title': 'Встретиться'}, 'm1', 'И', did)
        self.push(did)
        d = list(self.fake.deals.values())[0]
        self.assertEqual(self.fake.companies, {}, 'компании не создаются')
        self.assertNotIn('COMPANY_ID', d)
        self.assertEqual(len(self.fake.rows[d['ID']]), 1, 'товары — одной строкой итога')
        self.assertEqual([c['FILES'][0][0] for c in self.fake.comments], ['КП.pdf'], 'Word выключен')
        acts = list(self.fake.activities.values())
        self.assertEqual([(a['SUBJECT'], a['TYPE_ID']) for a in acts], [('Встреча: Встретиться', '2')], 'звонки не передаются, встреча — делом-звонком')
        time.sleep(1.1)
        self.fake.add_activity(d['ID'], 'Своё дело Битрикса', '2026-10-25T10:00:00+03:00', TYPE_ID='6')
        self.assertEqual(self.sync().run()['tasks'], 0, 'дела, заведённые не программой, — по правилу не загружаются')

    def test_schedule_and_conf(self):
        from bitrix_rules import BitrixRules
        from datetime import datetime
        r = BitrixRules({'sched': {'from': '08:00', 'to': '20:00'}})
        self.assertTrue(r.in_hours(datetime(2026, 10, 19, 9, 0)))
        self.assertFalse(r.in_hours(datetime(2026, 10, 19, 21, 0)))
        self.assertTrue(BitrixRules({'sched': {'from': '22:00', 'to': '06:00'}}).in_hours(datetime(2026, 10, 19, 23, 30)), 'через полночь')
        now = datetime.now()
        h0, h1 = (now.hour + 2) % 24, (now.hour + 3) % 24
        self.conf(sched={'from': '%02d:00' % h0, 'to': '%02d:00' % h1, 'batch': 50, 'tries': 5})
        self.assertEqual(self.sync().run(), {'hours': True}, 'вне часов обмена — фоновый обмен ждёт')
        self.assertNotIn('hours', self.sync().run_now(), 'кнопкой — всегда')
        for bad in ({'sched': {'from': '8 утра'}}, {'sched': {'batch': 5}}, {'mode': 'всё'}, {'fallback': 'чужой'}, {'cats': ['x']}):
            with self.assertRaises(ValueError, msg=bad):
                self.conf(**bad)
        v = self.conf(mgr={'m1': {'dir': 'in'}, 'нет-такого': {'on': False}})
        self.assertEqual(list(v['mgr']), ['m1'], 'неизвестные менеджеры отбрасываются')

    def test_dry_run_and_journal(self):
        from bitrix import BitrixDry, BitrixLog
        from crm import DealBook
        did = self.kp('26-0106')
        from bitrix import BitrixQueue
        BitrixQueue.touch(self.st, 'deal', did)
        self.fake.new_deal(TITLE='Новая для пробы', ASSIGNED_BY_ID='8')
        n0 = len(DealBook(self.st).deals(None))
        r = BitrixDry(self.st, direct()).run()
        self.assertTrue(any(x.startswith('Создать сделку') for x in r['bitrix']), r)
        self.assertTrue(any('Новая сделка из Битрикс24' in x for x in r['program']), r)
        self.assertEqual(len(self.fake.deals), 1, 'в Битрикс ничего не записано')
        self.assertEqual(len(DealBook(self.st).deals(None)), n0, 'в программе ничего не изменилось')
        self.assertEqual(BitrixQueue(self.st).stats()['queued'], 1, 'очередь та же')
        # настоящий обмен и журнал «было → стало» с менеджером
        self.sync().run()
        bid = next(k for k, x in self.fake.deals.items() if 'UF_CRM_KP_NUMBER' in x)
        time.sleep(1.1)
        self.fake.edit_deal(bid, STAGE_ID='C3:EXECUTING')
        self.sync().run()
        row = next(x for x in BitrixLog(self.st).tail() if '←' in x['text'] and 'этап' in x['text'])
        self.assertIn('этап: Запрос → Переговоры', row['text'])
        self.assertEqual(row['mid'], 'm1')

    def test_old_deals_import(self):
        from bitrix import BitrixImport
        from crm import DealBook
        did = self.kp('26-0107')                    # открытая сделка программы клиента с ИНН 7700000001 — ещё не в Битриксе
        cid = self.fake.handle('crm.company.add', {'fields': {'TITLE': 'ООО «Альфа»'}})['result']
        self.fake.handle('crm.requisite.add', {'fields': {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': cid, 'RQ_INN': '7700000001'}})
        a = self.fake.new_deal(TITLE='Старая Альфа', COMPANY_ID=str(cid), DATE_CREATE='2026-03-01T10:00:00+03:00')
        b = self.fake.new_deal(TITLE='Старая без клиента', DATE_CREATE='2026-04-01T10:00:00+03:00', ASSIGNED_BY_ID='8')
        self.fake.new_deal(TITLE='Слишком старая', DATE_CREATE='2025-01-01T10:00:00+03:00')
        imp = BitrixImport(self.st, direct())
        with self.assertRaises(ValueError):
            imp.preview('01.03.2026')
        pv = imp.preview('2026-02-01')
        acts = {x['id']: (x['act'], x.get('deal')) for x in pv['items']}
        self.assertEqual(acts, {a: ('link', did), b: ('new', None)}, pv)
        res = imp.run('2026-02-01', None, [a, b])
        self.assertEqual((res['created'], res['linked']), (1, 1), res)
        got = next(x for x in DealBook(self.st).deals(None) if x['title'] == 'Старая без клиента')
        self.assertEqual(got['managerId'], 'm2')
        self.assertFalse(got.get('bxNew'), 'старые сделки не отмечаются «новыми из Битрикса»')
        self.assertEqual(imp.preview('2026-02-01')['items'], [], 'повторно не предлагаются')

    def test_log_migration(self):
        from kit import Schema
        Schema.down_to(self.st, '2027-14-bitrix-log-mid')
        self.assertNotIn('mid', [r[1] for r in self.st.all('PRAGMA table_info(bx_log)')])
        self.st.migrations_up()
        self.assertIn('mid', [r[1] for r in self.st.all('PRAGMA table_info(bx_log)')])


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
        self.assertTrue(all('/crm/deal/details/' in d.get('bxUrl', '') for d in bd['deals']), 'ссылки «Открыть в Битрикс24» на доске')
        # файл настроек: без ключей — без адреса вебхука
        st, b, hd = self.h.req('GET', '/api/admin/settings-file', cookie=adm, headers=dict(A), raw=True)
        self.assertEqual(st, 200)
        self.assertNotIn(FakeBitrix.KEY.encode(), b)
        self.assertIn('"bitrix"'.encode(), b)
        # Битрикс недоступен — запись «Не отправлено», «Повторить» у одной записи
        self.fake.down = True
        self.h.req('PUT', '/api/crm/deal/' + did, {'note': 'новая заметка'}, headers=Stand.as_manager(SampleData.MANAGERS[0]))
        v = Http.js(self.h.req('POST', '/api/admin/bitrix/run', {}, cookie=adm, headers=dict(A))[1])
        self.assertEqual([f['id'] for f in v['failed']], [did], v.get('result'))
        self.assertIn('Сделка №', v['failed'][0]['title'])
        self.fake.down = False
        st, b, _ = self.h.req('POST', '/api/admin/bitrix/resend', {'kind': 'deal', 'id': did}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        self.assertEqual(Http.js(b)['failed'], [])
        self.assertEqual(self.h.req('POST', '/api/admin/bitrix/resend', {'kind': 'deal', 'id': did}, cookie=adm, headers=dict(A))[0], 404)
        self.assertEqual(self.stand.request_errors(), [])


    def test_desk_rules(self):
        """Тонкая настройка в «Настройках»: правила сохраняются с проверкой, кнопки обмена, пробный прогон, старые сделки."""
        adm, A = self.stand.admin()
        req = lambda p, body: self.h.req('POST', '/api/admin/bitrix' + p, body, cookie=adm, headers=dict(A))
        st, b, _ = self.h.req('POST', '/api/admin/bitrix', {'url': self.fake.url, 'category': '3', 'on': True}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        st, b, _ = req('', {'mode': 'both', 'fields': {'KP_PROFIT': {'dir': 'off'}}, 'sched': {'batch': 100}, 'send': {'fileMB': 10}})
        self.assertEqual(st, 200, b)
        v = Http.js(b)['rules']
        self.assertEqual((v['fields']['KP_PROFIT']['dir'], v['sched']['batch'], v['send']['fileMB']), ('off', 100, 10))
        self.assertEqual(req('', {'sched': {'from': '25:00'}})[0], 400)
        self.assertEqual(req('', {'fields': {'KP_NET': {'dir': 'in'}}})[0], 400)
        st, b, _ = self.h.req('POST', '/api/admin/bitrix', {'mode': 'in'}, headers=Stand.as_manager(SampleData.MANAGERS[0]))
        self.assertIn(st, (401, 403), 'правила — только администратор')
        self.assertEqual(req('/stages', {'category': '0'})[0], 200)
        self.assertEqual(req('/pull', {})[0], 200)
        self.assertEqual(req('/push', {'number': 'нет-такой'})[0], 404)
        num = Http.js(self.h.req('GET', '/api/crm/board', headers=Stand.as_manager(SampleData.MANAGERS[0]))[1])['deals'][0]['number']
        st, b, _ = req('/push', {'number': str(num)})
        self.assertEqual(st, 200, b)
        st, b, _ = req('/dry', {})
        self.assertEqual(st, 200, b)
        self.assertIn('bitrix', Http.js(b))
        st, b, _ = req('/import/preview', {'from': '2026-01-01'})
        self.assertEqual(st, 200, b)
        self.assertEqual(req('/import/preview', {'from': 'вчера'})[0], 400)
        st, b, _ = req('/test', {})
        self.assertTrue(any(f['code'] == 'UF_CRM_1700000001' for f in Http.js(b)['fields']), 'поля портала — для карты полей')
        self.assertEqual(self.stand.request_errors(), [])


class TimeTest(unittest.TestCase):
    """Время Битрикса в местное — без системного localtime: в Windows он падает (Errno 22) на датах до 1970 и после 3000."""

    def test_far_dates(self):
        import bitrix
        from datetime import datetime as real

        class WinDatetime(real):
            def astimezone(self, tz=None):
                if tz is None and not 1970 <= self.year <= 3000:
                    raise OSError(22, 'Invalid argument')
                return super().astimezone(tz)

        orig = bitrix.datetime
        bitrix.datetime = WinDatetime
        self.addCleanup(setattr, bitrix, 'datetime', orig)
        local = bitrix.BitrixTime.local
        zone = bitrix.BitrixTime.zone()
        for text in ('9999-12-31T23:59:59+03:00', '1900-01-01T00:00:00+03:00', '2026-10-21T11:35:00+03:00'):
            want = real.fromisoformat(text).astimezone(zone).replace(tzinfo=None).isoformat(timespec='seconds')
            self.assertEqual(local(text), want, text)
        self.assertEqual(local(''), '')
        self.assertEqual(local('2026-10-21T11:35:00'), '2026-10-21T11:35:00')
        self.assertEqual(local('9999-12-31T23:59:59-12:00'), '', 'за пределом года 9999 — как пустая дата, без падения')


if __name__ == '__main__':
    unittest.main()
