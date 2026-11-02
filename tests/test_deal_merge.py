# -*- coding: utf-8 -*-
"""Объединение сделок, дубли сделок и предупреждение при «＋ Сделка» 3.273.0 (deal_merge): КП, дела, документы (с файлами),
звонки и письма Битрикс24 и комментарии отмеченных сделок переходят в итоговую, они сами — в корзину; связь с Битрикс24
продолжается, если у итоговой её не было; дубли — незакрытые сделки одного клиента у одного менеджера (воронка и закупка —
те же). Временная база и стенд с вымышленными данными, рабочая база не используется."""
import json
import os
import sys
import unittest
from datetime import date
from unittest import mock

from kit import REPO, Stand, TempStore

sys.path.insert(0, os.path.join(REPO, 'app'))

PDF = b'%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'


class MergeBase(unittest.TestCase):
    INN = '7700000001'

    def setUp(self):
        self.st = TempStore(self).store

    def kp(self, kid, mid='m1', inn=INN, client='ООО «Альфа»', want='new', **extra):
        """КП — в отдельную новую сделку (как «Отдельная новая сделка» без правила) → id сделки."""
        from crm import DealBook
        meta = {'id': kid, 'number': kid, 'client': client, 'clientInn': inn, 'authorId': mid, 'managerId': mid,
                'manager': f'Менеджер {mid}', 'date': date.today().isoformat(), 'savedAt': f'2026-11-0{kid[-1]}T10:00:00',
                'sum': 1000, 'items': ['Компрессор'], **extra}
        self.st.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), 'тест')
        return DealBook(self.st).on_kp(kid, meta, 'тест', want)

    def merge(self, target, *sources):
        from deal_merge import DealMerge
        return DealMerge(self.st).merge(target, list(sources), 'Иванова')

    def deal(self, did):
        from crm import DealBook
        return DealBook(self.st).get(did)


class MergeTest(MergeBase):
    def test_everything_moves(self):
        from bitrix_comms import DealComms
        from crm import DealBook, TaskBook
        from deal_files import DealFiles
        from deal_merge import MergedDeals
        first, second = self.kp('k1'), self.kp('k2')
        self.assertNotEqual(first, second)
        tasks = TaskBook(self.st)
        tasks.add({'kind': 'call', 'due': '2026-11-10', 'title': 'Позвонить'}, 'm1', 'тест', deal=second)
        done = tasks.add({'kind': 'mail', 'due': '2026-11-01', 'title': 'Письмо'}, 'm1', 'тест', deal=second)
        tasks.update(done['id'], {'state': 'done'}, 'тест')
        doc = DealFiles.of(self.st).add_kind(second, 'contract', 'Договор.pdf', PDF, 'тест', 'm1')
        DealComms(self.st).put({'bx': '501', 'deal': second, 'kind': 'call', 'at': '2026-11-01T09:00:00'})
        book = DealBook(self.st)
        book.comment(second, 'Клиент просил скидку', 'Иванова')
        book.update(second, {'note': 'Объект — цех № 3'}, 'тест')

        report = self.merge(first, second).out()
        self.assertEqual((report['kps'], report['tasks'], report['files'], report['talks'], report['comments']), (1, 2, 1, 1, 1))
        self.assertEqual(report['merged'], [self.number(second)])
        self.assertEqual(book.deal_of('k2'), first)
        self.assertEqual(self.st.all('SELECT DISTINCT deal_id FROM crm_tasks'), [(first,)], 'оба дела — в итоговой')
        read = DealFiles.of(self.st).read(first, doc['id'])
        self.assertIsNotNone(read, 'документ с файлом — в итоговой')
        self.assertEqual(read[1], PDF)
        self.assertEqual(self.st.all('SELECT bx_id FROM deal_comm WHERE deal_id=?', (first,)), [('501',)])
        target = self.deal(first)
        self.assertEqual(target['note'], 'Объект — цех № 3', 'пустая заметка итоговой — из объединённой')
        self.assertIn(f'Из сделки № {self.number(second)}: Клиент просил скидку', [row['text'] for row in target['comments']])
        merge = [row for row in target['history'] if row.get('what') == 'merge']
        self.assertEqual((merge[0]['kps'], merge[0]['tasks'], merge[0]['files']), (1, 2, 1))
        self.assertIsNone(self.deal(second), 'объединённая — не в сделках')
        title = self.st.one("SELECT title FROM trash WHERE entity_type='deal' AND entity_id=?", (second,))[0]
        self.assertIn(f'объединена со сделкой № {self.number(first)}', title)
        self.assertEqual(MergedDeals(self.st).target_of(second), first)

    def number(self, did):
        row = self.st.one("SELECT doc FROM deals WHERE id=?", (did,)) or self.st.one(
            "SELECT json_extract(data, '$.doc') FROM trash WHERE entity_type='deal' AND entity_id=?", (did,))
        return json.loads(row[0])['number']

    def test_both_notes_and_blanks(self):
        from crm import DealBook
        first, second = self.kp('k1'), self.kp('k2')
        book = DealBook(self.st)
        book.update(first, {'note': 'Своя заметка', 'expected': ''}, 'тест')
        book.update(second, {'note': 'Чужая заметка', 'expected': '2027-01-15'}, 'тест')
        self.merge(first, second)
        target = self.deal(first)
        self.assertEqual(target['note'], 'Своя заметка')
        self.assertTrue(any(row['text'].startswith(f'Заметка сделки № {self.number(second)}: Чужая') for row in target['comments']))
        self.assertEqual(target['expected'], '2027-01-15', 'пустая ожидаемая дата — из объединённой')

    def test_sum_by_latest_kp(self):
        first = self.kp('k1', sum=1000)
        second = self.kp('k2', sum=5000)
        from crm import DealBook
        before = DealBook(self.st).get(first)['sum']
        self.merge(first, second)
        self.assertNotEqual(self.deal(first)['sum'], before, 'сумма — по последнему КП объединённых')

    def test_refusals(self):
        from crm import DealBook
        first, second, third = self.kp('k1'), self.kp('k2'), self.kp('k3')
        with self.assertRaisesRegex(ValueError, 'саму с собой'):
            self.merge(first, first)
        with self.assertRaisesRegex(ValueError, 'Отметьте'):
            self.merge(first)
        with self.assertRaises(LookupError):
            self.merge(first, 'd999')
        book = DealBook(self.st)
        book.update(second, {'stage': 'won'}, 'тест')
        with self.assertRaisesRegex(ValueError, 'выиграна — объединяйте в неё'):
            self.merge(first, second)
        book.update(third, {'stage': 'lost', 'lostReason': 'Дорого'}, 'тест')
        with self.assertRaisesRegex(ValueError, 'проиграна'):
            self.merge(third, first)
        self.merge(second, first)
        self.assertIsNone(self.deal(first), 'в выигранную — можно')

    def test_rollback_keeps_files(self):
        from bitrix_comms import DealComms
        from crm import DealBook
        from deal_files import DealFiles
        first, second = self.kp('k1'), self.kp('k2')
        doc = DealFiles.of(self.st).add_kind(second, 'invoice', 'Счёт.pdf', PDF, 'тест', 'm1')
        with mock.patch.object(DealComms, 'move', side_effect=RuntimeError('сбой')), self.assertRaises(RuntimeError):
            self.merge(first, second)
        self.assertEqual(DealBook(self.st).deal_of('k2'), second, 'КП — на месте')
        self.assertIsNotNone(DealFiles.of(self.st).read(second, doc['id']), 'файл документа — на месте')
        self.assertIsNotNone(self.deal(second), 'сделка не удалена')

    def test_bitrix_link(self):
        first, second = self.kp('k1'), self.kp('k2')
        from crm import DealBook
        DealBook(self.st).comment(second, 'Уже в Битриксе', 'Иванова')
        self.st.write("INSERT INTO bx_link (kind, local_id, bx_id, sent, at) VALUES ('deal', ?, '77', '{}', '')", (second,))
        self.st.write(f"INSERT INTO bx_link (kind, local_id, bx_id, sent, at) VALUES ('file', 'comment|{second}|1', '77', '{{}}', '')")
        report = self.merge(first, second).out()
        self.assertEqual(report['bitrixFrom'], self.number(second))
        self.assertEqual(self.st.one("SELECT local_id FROM bx_link WHERE kind='deal' AND bx_id='77'")[0], first,
                         'итоговая продолжает сделку Битрикс24 объединённой')
        self.assertTrue(self.st.one("SELECT 1 FROM bx_link WHERE kind='file' AND local_id LIKE ?", (f'comment|{first}|%',)),
                        'отправленный комментарий не уйдёт второй раз')
        third, fourth = self.kp('k3'), self.kp('k4')
        self.st.write("INSERT INTO bx_link (kind, local_id, bx_id, sent, at) VALUES ('deal', ?, '88', '{}', '')", (third,))
        self.st.write("INSERT INTO bx_link (kind, local_id, bx_id, sent, at) VALUES ('deal', ?, '99', '{}', '')", (fourth,))
        self.assertEqual(self.merge(third, fourth).out()['bitrixFrom'], '', 'у итоговой своя сделка — связь не меняется')
        self.assertEqual(self.st.one("SELECT local_id FROM bx_link WHERE kind='deal' AND bx_id='99'")[0], fourth)

    def test_redirect_and_restore(self):
        from deal_merge import MergedDeals
        first, second, third = self.kp('k1'), self.kp('k2'), self.kp('k3')
        self.merge(second, third)
        self.merge(first, second)
        self.assertEqual(MergedDeals(self.st).target_of(third), first, 'по цепочке')
        tid = self.st.one("SELECT id FROM trash WHERE entity_type='deal' AND entity_id=?", (third,))[0]
        self.st.trash_restore(tid)
        self.assertEqual(MergedDeals(self.st).target_of(third), third, 'вернули из корзины — снова она сама')


class DupesTest(MergeBase):
    def test_groups(self):
        from crm import DealBook
        from deal_merge import DealDupes
        first, second = self.kp('k1'), self.kp('k2')
        tender = self.kp('k3', tender={'number': '0373100000126000001'})
        other_mgr = self.kp('k4', mid='m2')
        won = self.kp('k5')
        DealBook(self.st).update(won, {'stage': 'won'}, 'тест')
        self.kp('k6', inn='7700000002', client='ООО «Бета»')
        groups = DealDupes(self.st).groups(None)
        self.assertEqual(len(groups), 1, groups)
        ids = [row['id'] for row in groups[0]['deals']]
        self.assertEqual(sorted(ids), sorted([first, second]), 'тендер, другой менеджер, выигранная и другой клиент — не дубли')
        self.assertNotIn(tender, ids)
        self.assertNotIn(other_mgr, ids)
        self.assertEqual(groups[0]['target'], first, 'одинаковые стадии и КП — итоговая самая ранняя')
        DealBook(self.st).update(second, {'stage': 'talks'}, 'тест')
        self.assertEqual(DealDupes(self.st).groups(None)[0]['target'], second, 'дальше продвинувшаяся — итоговая')
        self.assertEqual(DealDupes(self.st).groups(['m2']), [], 'отбор по менеджеру')


class RouteTest(unittest.TestCase):
    """Маршруты на стенде (вход по паролю, без права «КП других менеджеров»): объединение (права, неверный ввод,
    выключатель, журнал), дубли, предупреждение «＋ Сделка»."""

    PASSWORD = 'pass-merge-52'

    @classmethod
    def setUpClass(cls):
        from kit import Http, SampleData
        cls.stand = Stand('server', SampleData(items=20, clients=4, kps=1)).start()
        cls.http = cls.stand.http
        cls.adm, cls.adm_headers = cls.stand.admin()
        for mid, login in (('mgr-ivanova', 'mrg1'), ('mgr-petrov', 'mrg2')):
            status, body, _ = cls.http.req('POST', '/api/admin/access/' + mid,
                                           {'login': login, 'password': cls.PASSWORD, 'perms': {'kpOthers': False}},
                                           cookie=cls.adm, headers=dict(cls.adm_headers))
            assert status == 200, (status, body)
        cls.http.req('POST', '/api/admin/access', {'enabled': True}, cookie=cls.adm, headers=dict(cls.adm_headers))
        enter = lambda login: Http.cookie(cls.http.req('POST', '/api/auth/login', {'login': login, 'password': cls.PASSWORD})[2])
        cls.mine, cls.theirs = enter('mrg1'), enter('mrg2')

    @classmethod
    def tearDownClass(cls):
        cls.http.req('POST', '/api/admin/access', {'enabled': False}, cookie=cls.adm, headers=dict(cls.adm_headers))
        cls.stand.close()

    def new_deal(self, client='ООО «Дельта»', inn='7700000088', who=None):
        status, body, _ = self.http.req('POST', '/api/crm/deal', {'client': client, 'clientInn': inn}, cookie=who or self.mine)
        self.assertEqual(status, 200, body)
        return json.loads(body)

    def test_1_warn_dupes_merge(self):
        http = self.http
        first = self.new_deal()
        status, body, _ = http.req('GET', '/api/crm/pick?inn=7700000088&name=x', cookie=self.mine)
        self.assertEqual(json.loads(body)['guard']['lock']['deal'], first['id'], '«＋ Сделка» знает о свежей сделке клиента')
        second = self.new_deal()
        status, body, _ = http.req('GET', '/api/crm/dupes', cookie=self.mine)
        self.assertEqual(status, 200, body)
        group = next(row for row in json.loads(body)['groups'] if row['inn'] == '7700000088')
        self.assertEqual({row['id'] for row in group['deals']}, {first['id'], second['id']})
        self.assertEqual(http.req('GET', '/api/crm/dupes?manager=all', cookie=self.mine)[0], 403, 'весь отдел — с правом')
        status, body, _ = http.req('GET', '/api/crm/dupes?manager=all', cookie=self.adm, headers=dict(self.adm_headers))
        self.assertEqual(status, 200, body)
        bad = http.req('POST', f'/api/crm/deal/{first["id"]}/merge', {'deals': 'd1'}, cookie=self.mine)
        self.assertEqual(bad[0], 400, bad[1])
        status, body, _ = http.req('POST', f'/api/crm/deal/{first["id"]}/merge', {'deals': [second['id']]}, cookie=self.mine)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['merged'], [second['number']])
        status, body, _ = http.req('GET', f'/api/crm/deal/{second["id"]}', cookie=self.mine)
        self.assertEqual(status, 404)
        self.assertIn(f'объединена со сделкой № {first["number"]}', body)
        status, body, _ = http.req('GET', '/api/admin/audit?action=merge_deal', cookie=self.adm, headers=dict(self.adm_headers))
        self.assertIn('merge_deal', body, 'объединение — в журнале действий')

    def test_2_foreign_and_off(self):
        http = self.http
        mine = self.new_deal('ООО «Эпсилон»', '7700000099')
        theirs = self.new_deal('ООО «Эпсилон»', '7700000099', who=self.theirs)
        status = http.req('POST', f'/api/crm/deal/{mine["id"]}/merge', {'deals': [theirs['id']]}, cookie=self.mine)[0]
        self.assertEqual(status, 403, 'чужую сделку — нельзя')
        http.req('POST', '/api/admin/features', {'values': {'dealMerge': {'on': False}, 'dealDupes': {'on': False}}},
                 cookie=self.adm, headers=dict(self.adm_headers))
        other = self.new_deal('ООО «Эпсилон»', '7700000099')
        self.assertEqual(http.req('POST', f'/api/crm/deal/{mine["id"]}/merge', {'deals': [other['id']]}, cookie=self.mine)[0], 403)
        self.assertEqual(http.req('GET', '/api/crm/dupes', cookie=self.mine)[0], 403)
        http.req('POST', '/api/admin/features', {'values': {'dealMerge': None, 'dealDupes': None}},
                 cookie=self.adm, headers=dict(self.adm_headers))

    def test_3_today_dupes(self):
        """«Сегодня» (3.274.0): свои дубли; кабинет коллеги — с правом; весь отдел — пусто («Отдел»); свой выключатель."""
        http, adm = self.http, dict(cookie=self.adm, headers=dict(self.adm_headers))
        ids = {self.new_deal('ООО «Зета»', '7700000111')['id'] for _ in range(2)}

        def groups(query='', **who):
            status, body, _ = http.req('GET', '/api/crm/dupes/mine' + query, **(who or {'cookie': self.mine}))
            self.assertEqual(status, 200, body)
            return [row for row in json.loads(body)['groups'] if row['inn'] == '7700000111']

        [group] = groups()
        self.assertEqual({row['id'] for row in group['deals']}, ids)
        self.assertEqual(groups(cookie=self.theirs), [], 'у коллеги своих дублей этого клиента нет')
        self.assertEqual(http.req('GET', '/api/crm/dupes/mine?manager=mgr-ivanova', cookie=self.theirs)[0], 403)
        self.assertEqual(len(groups('?manager=mgr-ivanova', **adm)), 1, 'руководитель — в кабинете менеджера')
        self.assertEqual(groups('?manager=all', **adm), [], 'весь отдел — «Отдел» → «Дубли сделок»')
        http.req('POST', '/api/admin/features', {'values': {'dealDupes': {'on': False}}}, **adm)
        self.assertEqual(len(groups()), 1, '«Дубли сделок в «Отделе»» выключены — на «Сегодня» есть')
        http.req('POST', '/api/admin/features', {'values': {'dealDupes': None, 'todayDupes': {'on': False}}}, **adm)
        self.assertEqual(http.req('GET', '/api/crm/dupes/mine', cookie=self.mine)[0], 403)
        http.req('POST', '/api/admin/features', {'values': {'todayDupes': None}}, **adm)


if __name__ == '__main__':
    unittest.main()
