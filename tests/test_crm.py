# -*- coding: utf-8 -*-
"""Кабинет менеджера (crm.py): сделки из КП (миграция и новые КП), этап вперёд по ходу сделки КП, сумма по последнему КП,
своя сумма, причина проигрыша, дела (выполнить, отменить — не удалить), права: свои — каждому, чужие — администратору
и менеджеру с правом «КП других менеджеров»."""
import json
import urllib.parse
import unittest
from datetime import date, timedelta

from kit import Http, SampleData, Schema, Stand, TempStore


def meta(kid, client, inn, mid, name, day, total, **kw):
    return dict({'id': kid, 'number': kid, 'client': client, 'clientInn': inn, 'authorId': mid, 'manager': name, 'date': day,
                 'sum': total, 'items': ['Компрессор ВК-%s' % kid]}, **kw)


class UnitTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def put(self, kid, m, status=None):
        self.st.kp_set(kid, 'meta', json.dumps(m, ensure_ascii=False), 'тест')
        if status:
            self.st.kp_track_set(kid, {'status': status, 'reason': 'Цена' if status == 'lost' else ''})

    def test_adopt_groups_and_closes(self):
        from crm import DealBook
        today = date.today()
        d = lambda n: (today - timedelta(days=n)).isoformat()
        # клиент А: два КП с разницей 10 дней — одна сделка; третье через 90 дней — новая
        self.put('1', meta('1', 'ООО «А»', '7700000001', 'm1', 'Иванова', d(100), 100000))
        self.put('2', meta('2', 'ООО «А»', '7700000001', 'm1', 'Иванова', d(90), 150000), 'sent')
        self.put('3', meta('3', 'ООО «А»', '7700000001', 'm1', 'Иванова', d(1), 90000), 'work')
        # тот же клиент у другого менеджера — своя сделка
        self.put('4', meta('4', 'ООО «А»', '7700000001', 'm2', 'Петров', d(2), 50000))
        # выиграно давно — «Выиграно»; без движения 200 дней — «Проиграно» с причиной
        self.put('5', meta('5', 'ООО «Б»', '7700000002', 'm1', 'Иванова', d(80), 70000), 'won')
        self.put('6', meta('6', 'ООО «В»', '7700000003', 'm1', 'Иванова', d(200), 10000), 'sent')
        book = DealBook(self.st)
        self.assertEqual(book.adopt(), 6)
        self.assertEqual(book.adopt(), 0, 'второй раз — нечего раскладывать')
        by = {kid: book.deal_of(kid) for kid in '123456'}
        self.assertEqual(by['1'], by['2'])
        self.assertNotEqual(by['2'], by['3'])
        self.assertNotEqual(by['3'], by['4'])
        g = book.get(by['1'])
        self.assertEqual((g['stage'], g['sum'], g['managerId']), ('sent', 150000, 'm1'), 'этап — по лучшему КП, сумма — по последнему')
        self.assertEqual(book.get(by['3'])['stage'], 'talks')
        self.assertEqual(book.get(by['5'])['stage'], 'won')
        old = book.get(by['6'])
        self.assertEqual(old['stage'], 'lost')
        self.assertIn('180', old['lostReason'])
        self.assertLess(old['updated'], d(150), 'закрытая давно сделка не всплывает в кабинете')
        mine = [x['id'] for x in book.deals(['m1'])]
        self.assertNotIn(by['6'], mine)
        self.assertIn(by['3'], mine)

    def test_kp_sync_sum_and_lost(self):
        from crm import DealBook
        book = DealBook(self.st)
        today = date.today().isoformat()
        self.put('10', meta('10', 'ООО «Г»', '7700000004', 'm1', 'Иванова', today, 200000))
        did = book.on_kp('10', json.loads(self.st.kp_get('10', 'meta')), 'Иванова')
        self.assertEqual(book.get(did)['stage'], 'lead')
        # второе КП в ту же сделку (выбрано в КП)
        self.put('11', meta('11', 'ООО «Г»', '7700000004', 'm1', 'Иванова', today, 180000))
        self.assertEqual(book.on_kp('11', json.loads(self.st.kp_get('11', 'meta')), 'Иванова', want=did), did)
        self.assertEqual(book.get(did)['sum'], 180000)
        self.st.kp_track_set('10', {'status': 'work'})
        book.refresh('10', 'Иванова')
        self.assertEqual(book.get(did)['stage'], 'talks')
        # назад этап сам не уходит
        self.st.kp_track_set('10', {'status': 'sent'})
        book.refresh('10', 'Иванова')
        self.assertEqual(book.get(did)['stage'], 'talks')
        # все КП проиграны — сделка проиграна с причиной; КП снова в работе — сделка вернулась
        self.st.kp_track_set('10', {'status': 'lost', 'reason': 'Сроки'})
        self.st.kp_track_set('11', {'status': 'lost', 'reason': 'Цена'})
        book.refresh('11', 'Иванова')
        d = book.get(did)
        self.assertEqual(d['stage'], 'lost')
        self.assertTrue(d['lostReason'])
        self.st.kp_track_set('11', {'status': 'work'})
        book.refresh('11', 'Иванова')
        self.assertEqual(book.get(did)['stage'], 'talks')
        # своя сумма не перетирается КП; пусто — снова по КП
        d = book.update(did, {'sum': '250 000,50'}, 'Иванова')
        self.assertEqual((d['sum'], d['sumOwn']), (25000050, True))
        book.refresh('11', 'Иванова')
        self.assertEqual(book.get(did)['sum'], 25000050)
        self.assertEqual(book.update(did, {'sum': ''}, 'Иванова')['sum'], 180000)
        with self.assertRaises(ValueError):
            book.update(did, {'stage': 'lost'}, 'Иванова')
        with self.assertRaises(ValueError):
            book.update(did, {'stage': 'нет'}, 'Иванова')
        d = book.update(did, {'stage': 'won'}, 'Иванова')
        self.assertEqual(d['stage'], 'won')
        self.assertEqual(d['history'][-1]['to'], 'won')

    def test_migration_fills_and_rolls_back(self):
        from crm import DealBook
        self.put('20', meta('20', 'ООО «Д»', '7700000005', 'm1', 'Иванова', date.today().isoformat(), 5000), 'sent')
        Schema.down_to(self.st, '2027-10-crm')
        self.assertNotIn('2027-10-crm', self.st.migrations_applied())
        self.assertIsNone(self.st.one("SELECT name FROM sqlite_master WHERE name='deals'"))
        self.st.migrations_up()
        did = DealBook(self.st).deal_of('20')
        self.assertTrue(did, 'при обновлении программы КП сразу в сделках')
        self.assertEqual(DealBook(self.st).get(did)['stage'], 'sent')

    def test_stages_from_lists(self):
        from crm import Stages
        st = self.st.kv_get('settings') or {}
        st['lists'] = {'crm.stages': [{'id': 'lead', 'name': 'Заявка'}, {'id': 'tender', 'name': 'Тендер'}, {'id': 'lost', 'name': 'Отказ'}]}
        self.st.kv_set('settings', st)
        self.assertEqual([(s['key'], s['label']) for s in Stages.all(self.st)],
                         [('lead', 'Заявка'), ('tender', 'Тендер'), ('won', 'Выиграно'), ('lost', 'Отказ')])

    def test_tasks(self):
        from crm import TaskBook
        tb = TaskBook(self.st)
        with self.assertRaises(ValueError):
            tb.add({'kind': 'call'}, 'm1', 'И')
        with self.assertRaises(ValueError):
            tb.add({'kind': 'party', 'due': '2027-01-01'}, 'm1', 'И')
        with self.assertRaises(ValueError):
            tb.add({'kind': 'call', 'due': '2027-01-01', 'time': '25:00'}, 'm1', 'И')
        t = tb.add({'kind': 'call', 'due': date.today().isoformat(), 'time': '10:30'}, 'm1', 'И')
        self.assertEqual((t['title'], t['state']), ('Звонок', 'open'))
        t = tb.update(t['id'], {'state': 'done'})
        self.assertTrue(t['doneAt'])
        self.assertEqual(len(tb.list(['m1'])), 1, 'сделанное сегодня — в списке')
        self.assertEqual(tb.list(['m2']), [])


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = SampleData(items=20, clients=4, kps=6)
        cls.stand = Stand('server', cls.data)
        cls.stand.start()
        cls.h = cls.stand.http

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, m, path, body=None, mgr=0, **kw):
        return self.h.req(m, path, body, headers=Stand.as_manager(SampleData.MANAGERS[mgr]), **kw)

    def test_board_and_rights(self):
        st, b, _ = self.req('GET', '/api/crm/board')
        self.assertEqual(st, 200, b)
        r = Http.js(b)
        mine = self.data.kp_ids['mgr-ivanova']
        self.assertEqual(sorted(k['id'] for d in r['deals'] for k in d['kps']), sorted(mine), 'старые КП разложены по сделкам')
        self.assertTrue(all(d['managerId'] == 'mgr-ivanova' for d in r['deals']))
        self.assertEqual([s['key'] for s in r['stages']][-2:], ['won', 'lost'])
        # без входа по паролю — как журнал: отдел виден
        st, b, _ = self.req('GET', '/api/crm/board?manager=all')
        self.assertEqual(st, 200)
        self.assertGreater(len(Http.js(b)['deals']), len(r['deals']))

    def test_deal_flow(self):
        st, b, _ = self.req('POST', '/api/crm/deal', {'title': 'Станция для карьера', 'client': 'ООО «Пример 1»'})
        self.assertEqual(st, 200, b)
        d = Http.js(b)
        did = d['id']
        self.assertEqual((d['stage'], d['managerId']), ('lead', 'mgr-ivanova'))
        st, b, _ = self.req('POST', '/api/crm/deal', {'note': 'пусто'})
        self.assertEqual(st, 400)
        self.assertIn('клиента', b)
        # дело по сделке, выполнить; удалить нельзя
        st, b, _ = self.req('POST', '/api/crm/task', {'deal': did, 'kind': 'meet', 'due': date.today().isoformat(), 'title': 'Встреча на объекте'})
        self.assertEqual(st, 200, b)
        t = Http.js(b)
        st, b, _ = self.req('PUT', '/api/crm/task/%d' % t['id'], {'state': 'done'})
        self.assertEqual((st, Http.js(b)['state']), (200, 'done'))
        st, _b, _ = self.req('DELETE', '/api/crm/task/%d' % t['id'])
        self.assertEqual(st, 403)
        # правка с номером правки; устаревший номер — 409
        st, b, _ = self.h.req('PUT', '/api/crm/deal/' + did, {'stage': 'talks'},
                              headers=dict(Stand.as_manager(SampleData.MANAGERS[0]), **{'X-KP-Rev': str(d['rev'])}))
        self.assertEqual(st, 200, b)
        st, b, _ = self.h.req('PUT', '/api/crm/deal/' + did, {'stage': 'sent'},
                              headers=dict(Stand.as_manager(SampleData.MANAGERS[0]), **{'X-KP-Rev': str(d['rev'])}))
        self.assertEqual(st, 409, 'сделку успели изменить')
        # КП переносится в сделку; сумма — по нему
        kid = self.data.kp_ids['mgr-ivanova'][0]
        st, b, _ = self.req('POST', '/api/crm/deal/%s/kp' % did, {'kp': kid})
        self.assertEqual(st, 200, b)
        st, b, _ = self.req('GET', '/api/crm/deal/' + did)
        r = Http.js(b)
        self.assertEqual([k['id'] for k in r['kps']], [kid])
        self.assertGreater(r['sum'], 0)
        self.assertEqual(len(r['tasks']), 1)
        # сохранение КП с выбранной сделкой
        kid2 = self.data.kp_ids['mgr-ivanova'][1]
        m = json.loads(self.req('GET', '/api/kp/%s/meta' % kid2)[1])
        st, b, _ = self.req('PUT', '/api/kp/%s/meta' % kid2, dict(m, dealId=did))
        self.assertEqual((st, Http.js(b)['deal']), (200, did))
        # выбор сделки клиента для КП
        st, b, _ = self.req('GET', '/api/crm/pick?name=' + urllib.parse.quote('ООО «Пример 1»'))
        self.assertIn(did, [x['id'] for x in Http.js(b)['items']])
        # ход сделки КП двигает этап сделки вперёд
        st, b, _ = self.req('PUT', '/api/kp/%s/track' % kid, {'status': 'won'})
        self.assertEqual(st, 200, b)
        self.assertEqual(Http.js(self.req('GET', '/api/crm/deal/' + did)[1])['stage'], 'contract')
        self.assertEqual(self.stand.request_errors(), [])

    def test_z_login_rights(self):
        adm, A = self.stand.admin()
        st, b, _ = self.h.req('GET', '/api/crm/board?manager=all', cookie=adm, headers=A)
        self.assertEqual(st, 200, b)
        self.assertTrue(Http.js(b)['canAll'])
        self.assertEqual(len(Http.js(b)['managers']), 2)
        petrov = [d['id'] for d in Http.js(b)['deals'] if d['managerId'] == 'mgr-petrov']
        for mid, lg in (('mgr-ivanova', 'crm1'), ('mgr-petrov', 'crm2')):
            st, b, _ = self.h.req('POST', '/api/admin/access/' + mid, {'login': lg, 'password': 'pass-crm-52', 'perms': {'kpOthers': lg == 'crm2'}},
                                  cookie=adm, headers=dict(A))
            self.assertEqual(st, 200, b)
        st, b, _ = self.h.req('POST', '/api/admin/access', {'enabled': True}, cookie=adm, headers=dict(A))
        self.assertEqual(st, 200, b)
        self.addCleanup(lambda: self.h.req('POST', '/api/admin/access', {'enabled': False}, cookie=adm, headers=dict(A)))
        login = lambda lg: Http.cookie(self.h.req('POST', '/api/auth/login', {'login': lg, 'password': 'pass-crm-52'})[2])
        c1, c2 = login('crm1'), login('crm2')
        # без права «КП других»: свои — да, отдел и чужая сделка — нет, подпись запроса чужим менеджером не помогает
        st, b, _ = self.h.req('GET', '/api/crm/board', cookie=c1, headers=Stand.as_manager(SampleData.MANAGERS[1]))
        self.assertEqual(st, 200)
        self.assertTrue(all(d['managerId'] == 'mgr-ivanova' for d in Http.js(b)['deals']))
        self.assertFalse(Http.js(b)['canAll'])
        self.assertEqual(self.h.req('GET', '/api/crm/board?manager=all', cookie=c1)[0], 403)
        self.assertEqual(self.h.req('GET', '/api/crm/deal/' + petrov[0], cookie=c1)[0], 403)
        self.assertEqual(self.h.req('PUT', '/api/crm/deal/' + petrov[0], {'stage': 'talks'}, cookie=c1)[0], 403)
        self.assertEqual(self.h.req('POST', '/api/crm/task', {'deal': petrov[0], 'kind': 'call', 'due': '2027-01-10'}, cookie=c1)[0], 403)
        # с правом — кабинет коллеги и передача сделки
        st, b, _ = self.h.req('GET', '/api/crm/board?manager=mgr-ivanova', cookie=c2)
        self.assertEqual(st, 200, b)
        mine = Http.js(b)['deals'][0]
        st, b, _ = self.h.req('PUT', '/api/crm/deal/' + mine['id'], {'managerId': 'mgr-petrov'}, cookie=c2)
        self.assertEqual(st, 200, b)
        self.assertEqual(Http.js(b)['managerId'], 'mgr-petrov')
        self.assertEqual(self.h.req('PUT', '/api/crm/deal/' + mine['id'], {'managerId': 'mgr-ivanova'}, cookie=c1)[0], 403)


if __name__ == '__main__':
    unittest.main()
