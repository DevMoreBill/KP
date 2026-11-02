# -*- coding: utf-8 -*-
"""Одна сделка на клиента 3.272.0 (deal_guard.DealGuard): новое КП клиенту, у которого у того же менеджера есть свежая
незакрытая сделка, встаёт в неё; срок — crm.dealLockDays, исключения клиентов — ClientDealRules (администратор);
сделка, куда КП перенесли, пока его правили, не меняется прежней (DealSeen); перенос КП в другую сделку и маршруты.
Временная база и стенд с вымышленными данными, рабочая база не используется."""
import json
import os
import sys
import unittest
from datetime import date, datetime, timedelta
from urllib.parse import quote

from kit import REPO, Stand, TempStore

sys.path.insert(0, os.path.join(REPO, 'app'))


class GuardTest(unittest.TestCase):
    INN = '7700000001'

    def setUp(self):
        self.st = TempStore(self).store
        self.st.client_put(f'inn{self.INN}', {'id': f'inn{self.INN}', 'name': 'ООО «Альфа»', 'inn': self.INN})
        self.st.client_put('c-noinn', {'id': 'c-noinn', 'name': 'ИП Без ИНН'})

    # сохранение КП — как CrmController.on_kp: план правила, сделка, «одна новая сделка» израсходована
    def save(self, kid, mid='m1', inn=INN, client='ООО «Альфа»', **extra):
        from crm import DealBook
        from deal_guard import DealGuard, DealSeen
        meta = {'id': kid, 'number': kid, 'client': client, 'clientInn': inn, 'authorId': mid, 'managerId': mid,
                'manager': mid, 'date': date.today().isoformat(), 'sum': 1000, 'items': ['Компрессор'], **extra}
        self.st.kp_set(kid, 'state', json.dumps({'number': kid, 'authorId': mid, 'items': []}), 'тест')
        self.st.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        book = DealBook(self.st)
        want = DealSeen.want(meta, str(meta.get('dealId') or ''), book.deal_of(kid))
        guard = DealGuard(self.st)
        plan = guard.plan(kid, meta, want or None)
        did = book.on_kp(kid, meta, 'тест', plan.want)
        guard.done(plan, did)
        return did, plan.lock

    def days(self, value):
        self.st.kv_set('settings', {'defaults': {'crm.dealLockDays': {'on': True, 'v': str(value)}}})
        from defaults import SrvVal
        SrvVal.forget()

    def age(self, did, days):
        """КП сделки и сама сделка — «days» дней назад."""
        when = (datetime.now() - timedelta(days=days)).isoformat(timespec='seconds')
        with self.st.lock:
            conn = self.st.conn()
            conn.execute('UPDATE deal_kp SET added=? WHERE deal_id=?', (when, did))
            row = conn.execute('SELECT doc FROM deals WHERE id=?', (did,)).fetchone()
            doc = json.loads(row[0])
            doc['created'] = when
            conn.execute('UPDATE deals SET doc=? WHERE id=?', (json.dumps(doc, ensure_ascii=False), did))
            conn.commit()

    def rule(self, mode, cid=None):
        from deal_guard import ClientDealRules
        return ClientDealRules(self.st).put(cid or f'inn{self.INN}', mode, 'admin')

    def test_second_kp_joins_fresh_deal(self):
        self.days(10)
        first, lock = self.save('k1')
        self.assertIsNone(lock, 'первое КП клиента — новая сделка')
        second, lock = self.save('k2')
        self.assertEqual(second, first, 'второе КП того же клиента — в ту же сделку')
        self.assertEqual(lock.out()['until'], (date.today() + timedelta(days=10)).isoformat())
        self.assertEqual(lock.out()['reason'], 'days')
        third, lock = self.save('k3', dealId='new')
        self.assertEqual(third, first, '«Отдельная новая сделка» — тоже в открытую сделку')
        from crm import DealBook
        self.assertEqual(len(DealBook(self.st).deals()), 1)

    def test_other_manager_client_and_stale(self):
        self.days(10)
        first, _ = self.save('k1')
        self.assertNotEqual(self.save('k2', mid='m2')[0], first, 'у другого менеджера — своя сделка')
        self.assertNotEqual(self.save('k3', inn='7700000002', client='ООО «Бета»')[0], first, 'другой клиент')
        self.age(first, 11)
        fresh, lock = self.save('k4')
        self.assertNotEqual(fresh, first, 'последнее КП старше срока — новая сделка')
        self.assertIsNone(lock)
        self.age(fresh, 9)
        self.assertEqual(self.save('k5')[0], fresh, 'девятый день — ещё в ту же сделку')

    def test_freshest_deal_wins_and_existing_choice_kept(self):
        self.days(10)
        old, _ = self.save('k1')
        self.age(old, 20)
        new, _ = self.save('k2')
        self.age(old, 5)
        self.age(new, 2)
        self.assertEqual(self.save('k3')[0], new, 'из двух свежих — с последним КП')
        self.assertEqual(self.save('k4', dealId=old)[0], old, 'выбранная менеджером сделка — как выбрана')

    def test_tenders_are_separate_tasks(self):
        """КП для тендера — в сделку той же закупки; другая закупка — своя сделка; обычное КП — не в тендерную."""
        self.days(10)
        plain, _ = self.save('k1')
        first, lock = self.save('k2', tender={'number': '0373100001'})
        self.assertNotEqual(first, plain, 'тендер — не в обычную сделку')
        self.assertIsNone(lock)
        self.assertEqual(self.save('k3', tender={'number': '0373100001'})[0], first, 'та же закупка — в её сделку')
        self.assertNotIn(self.save('k4', tender={'number': '0373100002'})[0], (plain, first), 'другая закупка — своя')
        self.assertEqual(self.save('k5')[0], plain, 'обычное КП — в обычную сделку, не в тендерную')

    def test_off_switches(self):
        self.days(0)
        first, _ = self.save('k1')
        self.assertNotEqual(self.save('k2')[0], first, '0 дней — по сроку не ограничивать')
        self.days(10)
        from features import FeatureAccess
        FeatureAccess(self.st).save({'dealGuard': False})
        self.assertNotEqual(self.save('k3')[0], first, 'функция выключена — как раньше')

    def test_closed_and_trashed_deals_not_used(self):
        self.days(10)
        from crm import DealBook
        first, _ = self.save('k1')
        book = DealBook(self.st)
        book.update(first, {'stage': 'won'}, 'тест')
        second, _ = self.save('k2')
        self.assertNotEqual(second, first, 'закрытая сделка — не держит')
        book.remove(second, 'тест')
        self.assertNotIn(self.save('k3')[0], (first, second), 'сделка в корзине — не держит')

    def test_client_modes(self):
        self.days(10)
        first, _ = self.save('k1')
        self.rule('always')
        always, _ = self.save('k2')
        self.assertNotEqual(always, first, '«новые сделки — всегда»')
        self.rule('once')
        once, _ = self.save('k3')
        self.assertNotIn(once, (first, always), '«можно одну новую сделку» — новая')
        self.age(first, 2)
        self.age(always, 1)
        from deal_guard import ClientDealRules, DealMode
        self.assertEqual(ClientDealRules(self.st).mode_of([f'inn{self.INN}']), (DealMode.RULE, ''), 'одна — израсходована')
        self.assertEqual(self.save('k4')[0], once, 'дальше — снова общее правило')
        self.days(0)
        self.age(once, 400)
        self.rule('never')
        joined, lock = self.save('k5')
        self.assertEqual(joined, always, '«запретить» — в незакрытую сделку с последним КП, без срока')
        self.assertEqual(lock.out()['reason'], 'client')
        self.assertEqual(lock.out()['until'], '')
        self.rule('')
        self.assertEqual(ClientDealRules(self.st).all(), {}, 'общее правило — исключение снято')

    def test_client_without_inn(self):
        self.days(10)
        first, _ = self.save('k1', inn='', client='ИП Без ИНН')
        self.assertEqual(self.save('k2', inn='', client='ип без инн')[0], first, 'без ИНН — по названию')
        self.rule('always', 'c-noinn')
        self.assertNotEqual(self.save('k3', inn='', client='ИП Без ИНН', clientId='c-noinn')[0], first,
                            'исключение клиента без ИНН — по id карточки')

    def test_rules_validation(self):
        from deal_guard import ClientDealRules
        rules = ClientDealRules(self.st)
        with self.assertRaisesRegex(ValueError, 'нет в справочнике'):
            rules.put('inn7700000099', 'always', 'admin')
        with self.assertRaisesRegex(ValueError, 'Неизвестный'):
            rules.put(f'inn{self.INN}', 'maybe', 'admin')
        with self.assertRaisesRegex(ValueError, 'Не выбран'):
            rules.put('../x', 'always', 'admin')
        rules.put(f'inn{self.INN}', 'never', 'admin')
        self.assertEqual([row['name'] for row in rules.listing()], ['ООО «Альфа»'])
        self.assertEqual(rules.labels(), {f'inn{self.INN}': 'новые сделки запрещены'})

    def test_emptied_deal_sum(self):
        """КП ушло из сделки: опустевшая сделка — без суммы по КП (была — сумма ушедшего КП); своя сумма — остаётся."""
        self.days(0)
        from crm import DealBook
        book = DealBook(self.st)
        first, _ = self.save('k1')
        other, _ = self.save('k2')
        self.assertEqual(book.get(first)['sum'], 1000)
        book.link(other, 'k1', 'тест')
        self.assertEqual(book.get(first)['sum'], 0, 'сделка без КП — без суммы')
        self.assertEqual(book.kp_count(other), 2)
        book.update(other, {'sum': 5000, 'sumOwn': True}, 'тест')
        own = book.get(other)['sum']
        third, _ = self.save('k3')
        book.link(third, 'k1', 'тест')
        book.link(third, 'k2', 'тест')
        self.assertTrue(own)
        self.assertEqual(book.get(other)['sum'], own, 'своя сумма менеджера — как была')

    def test_moved_kp_not_returned_by_stale_choice(self):
        """КП перенесли в другую сделку, пока оно было открыто: прежняя сделка в КП его не возвращает."""
        self.days(0)
        from crm import DealBook
        from deal_guard import DealSeen
        first, _ = self.save('k1')
        other, _ = self.save('k2')
        DealBook(self.st).link(other, 'k1', 'тест')
        self.assertEqual(self.save('k1', dealId=first, dealSeen=first)[0], other, 'устаревший выбор — КП остаётся')
        self.assertEqual(self.save('k1', dealId=first, dealSeen=other)[0], first, 'выбор менеджера — переносит')
        self.assertEqual(self.save('k1', dealId=other)[0], other, 'без dealSeen (прежние версии) — как выбрано')
        state = json.loads(DealSeen.inject(json.dumps({'number': 'k1', 'dealId': first}), other))
        self.assertEqual((state['dealId'], state['_dealSeen']), (other, other))
        self.assertEqual(DealSeen.inject('{"a":1}', None), '{"a":1}', 'КП без сделки — как сохранено')


class RouteTest(unittest.TestCase):
    """Маршруты на стенде: ответ сохранения КП, выбор сделки в КП, состояние КП, исключения в «Настройках»."""

    WHO = {'X-KP-User-Id': 'mgr-ivanova', 'X-KP-User': 'mgr-ivanova'}

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(mode='local').start()
        cls.inn = '7700000077'

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def meta(self, kid, **extra):
        body = {'id': kid, 'number': kid, 'client': 'ООО «Гамма»', 'clientInn': self.inn, 'authorId': 'mgr-ivanova',
                'managerId': 'mgr-ivanova', 'manager': 'Иванова', 'sum': 1, **extra}
        state = {'number': kid, 'kpId': kid, 'client': 'ООО «Гамма»', 'clientInn': self.inn, 'authorId': 'mgr-ivanova', 'items': []}
        http = self.stand.http
        self.assertEqual(http.req('PUT', f'/api/kp/{kid}/state', state, headers=self.WHO)[0], 200)
        status, body_text, _ = http.req('PUT', f'/api/kp/{kid}/meta', body, headers=self.WHO)
        self.assertEqual(status, 200, body_text)
        return json.loads(body_text)

    def test_1_save_pick_state(self):
        first = self.meta('zzg1')
        self.assertTrue(first['deal'])
        self.assertIsNone(first['dealLock'])
        second = self.meta('zzg2')
        self.assertEqual(second['deal'], first['deal'])
        self.assertEqual(second['dealLock']['deal'], first['deal'])
        status, body, _ = self.stand.http.req('GET', f'/api/crm/pick?inn={self.inn}&name=x', headers=self.WHO)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['guard']['lock']['deal'], first['deal'], 'выбор сделки в КП знает запрет')
        status, body, _ = self.stand.http.req('GET', '/api/kp/zzg2/state', headers=self.WHO)
        state = json.loads(body)
        self.assertEqual((state['dealId'], state['_dealSeen']), (first['deal'], first['deal']), 'КП — со своей сделкой')
        self.assertEqual(self.stand.request_errors(), [])

    def test_2_admin_rules(self):
        http = self.stand.http
        self.assertEqual(http.req('GET', '/api/admin/dealrules', headers=self.WHO)[0], 401, 'менеджеру — нельзя')
        cookie, headers = self.stand.admin()
        cid = f'inn{self.inn}'
        status, body, _ = http.req('POST', '/api/admin/dealrules', {'client': cid, 'mode': 'always'}, cookie=cookie, headers=headers)
        self.assertEqual(status, 400, 'клиента ещё нет в справочнике')
        self.assertIn('нет в справочнике', body)
        card = {'id': cid, 'name': 'ООО «Гамма»', 'inn': self.inn}
        self.assertEqual(http.req('PUT', f'/api/clients/{cid}', card, headers=self.WHO)[0], 200)
        status, body, _ = http.req('POST', '/api/admin/dealrules', {'client': cid, 'mode': 'always'}, cookie=cookie, headers=headers)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['items'][0]['mode'], 'always')
        status, body, _ = http.req('GET', '/api/admin/list/client?q=' + quote('Гамма'), cookie=cookie, headers=headers)
        self.assertIn('новые сделки — всегда', body, 'исключение видно в списке клиентов')
        status, body, _ = http.req('GET', '/api/admin/audit?action=deal_rule', cookie=cookie, headers=headers)
        self.assertIn('deal_rule', body, 'изменение — в журнале действий')
        status, body, _ = http.req('POST', '/api/admin/dealrules', {'client': cid, 'mode': 'x'}, cookie=cookie, headers=headers)
        self.assertEqual(status, 400, body)
        http.req('POST', '/api/admin/features', {'values': {'dealGuard': {'on': False}}}, cookie=cookie, headers=headers)
        self.assertEqual(http.req('GET', '/api/admin/dealrules', cookie=cookie, headers=headers)[0], 403, 'выключено — закрыто')
        http.req('POST', '/api/admin/features', {'values': {'dealGuard': None}}, cookie=cookie, headers=headers)


if __name__ == '__main__':
    unittest.main()
