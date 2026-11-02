# -*- coding: utf-8 -*-
"""Объединение сделок и Битрикс24 3.274.0 (bitrix_merged): у оставшейся сделки своя сделка в Битриксе, у дубля — своя;
сделка дубля закрывается проигранной («Объединена со сделкой № …», стадия проигрыша, запись в ленте); итоговая без своей
— продолжает сделку дубля (не закрывается). «Расхождения с Битрикс24» (bitrix_diff): «Выровнять» — по программе, даже если
в Битриксе правили позже; сравниваются только поля, которые программа отправляет; «Выровнять все». Подставной Битрикс
(bitrix_fake.py), временная база и стенд с вымышленными данными."""
import json
import unittest

from test_bitrix import SyncBase


class MergedBase(SyncBase):
    def push(self, did):
        from bitrix import BitrixQueue
        BitrixQueue.touch(self.st, 'deal', did)
        res = self.sync().run()
        self.assertEqual(res['failed'], 0, res)
        return self.bx_id(did)

    def bx_id(self, did):
        from bitrix import BitrixLinks
        return (BitrixLinks(self.st).get('deal', did) or {}).get('bx')

    def second(self, title='Компрессор, дубль'):
        """Вторая сделка того же клиента — вручную («＋ Сделка»)."""
        from crm import DealBook
        return DealBook(self.st).create({'client': 'ООО «Альфа»', 'clientInn': '7700000001', 'title': title},
                                        'm1', 'Иванова Анна', 'тест')['id']

    def merge(self, target, source, queue=True):
        from bitrix_merged import MergedLose
        from deal_merge import DealMerge
        report = DealMerge(self.st).merge(target, [source], 'Иванова Анна')
        if queue:
            MergedLose.queue(self.st, report.bitrix_left)
        return report

    def number(self, did):
        from crm import DealBook
        return DealBook(self.st).get(did)['number']

    def log(self):
        from bitrix import BitrixLog
        return json.dumps(BitrixLog(self.st).tail(), ensure_ascii=False)

    def pair(self):
        """Две сделки клиента, у каждой своя сделка в Битриксе → (итоговая, дубль, их сделки в Битриксе)."""
        target, source = self.kp('26-0201'), self.second()
        return target, source, self.push(target), self.push(source)


class MergedLoseTest(MergedBase):
    def test_duplicate_closed_lost(self):
        target, source, bx_target, bx_source = self.pair()
        stage_before = self.fake.deals[bx_target]['STAGE_ID']
        report = self.merge(target, source)
        self.assertEqual(report.bitrix_left, [source])
        res = self.sync().run()
        self.assertEqual(res['failed'], 0, res)
        self.assertEqual(self.fake.deals[bx_source]['STAGE_ID'], 'C3:LOSE', 'сделка дубля — проигранной')
        self.assertEqual(self.fake.deals[bx_target]['STAGE_ID'], stage_before, 'сделка итоговой — как была')
        reason = f'Объединена со сделкой № {self.number(target)}'
        [note] = [row for row in self.fake.comments if str(row['ENTITY_ID']) == bx_source and reason in row['COMMENT']]
        self.assertIn(f'в Битрикс24 — сделка {bx_target}', note['COMMENT'], 'где теперь КП и дела')
        self.assertIn('проиграна', self.log())
        from bitrix import BitrixLinks, BitrixQueue
        self.assertEqual(BitrixLinks(self.st).get('deal', source)['sent'].get('merged'), target)
        self.assertEqual(BitrixQueue(self.st).stats()['queued'], 0)
        calls = len(self.fake.calls)
        self.sync().run()
        again = [body for method, body in self.fake.calls[calls:]
                 if method == 'crm.deal.update' and str(body.get('id')) == bx_source]
        self.assertEqual(again, [], 'второй раз не закрывается')

    def test_adopted_not_closed(self):
        """У итоговой своей сделки в Битриксе не было — она продолжает сделку дубля, та не закрывается."""
        source = self.kp('26-0202')
        bx_source, number = self.push(source), self.number(source)
        target = self.second('Новая без Битрикса')
        report = self.merge(target, source)
        self.assertEqual((report.bitrix_left, report.bitrix_from), ([], number))
        self.assertEqual(self.bx_id(target), bx_source)
        self.sync().run()
        self.assertNotEqual(self.fake.deals[bx_source]['STAGE_ID'], 'C3:LOSE')

    def test_closed_in_bitrix_untouched(self):
        target, source, _bx_target, bx_source = self.pair()
        self.fake.edit_deal(bx_source, STAGE_ID='C3:WON')
        self.merge(target, source)
        self.sync().run()
        self.assertEqual(self.fake.deals[bx_source]['STAGE_ID'], 'C3:WON', 'выигранную там — не трогать')
        self.assertIn('уже закрыта', self.log())

    def test_deleted_in_bitrix(self):
        target, source, _bx_target, bx_source = self.pair()
        del self.fake.deals[bx_source]
        self.merge(target, source)
        res = self.sync().run()
        self.assertEqual(res['failed'], 0, res)
        self.assertIsNone(self.bx_id(source), 'связь снята — закрывать нечего')

    def test_reason_field(self):
        """«Причина проигрыша» включена в карте полей — туда же причина."""
        from bitrix import BitrixConf
        BitrixConf(self.st).save({'fields': {'lostReason': {'dir': 'out'}}}, 'тест')
        target, source, _bx_target, bx_source = self.pair()
        self.merge(target, source)
        self.sync().run()
        self.assertEqual(self.fake.deals[bx_source].get('UF_CRM_KP_LOST'), f'Объединена со сделкой № {self.number(target)}')

    def test_stage_not_sent(self):
        """Стадия по карте полей — только из Битрикса: стадию не менять, только запись в ленте."""
        from bitrix import BitrixConf
        BitrixConf(self.st).save({'fields': {'stage': {'dir': 'in'}}}, 'тест')
        target, source, _bx_target, bx_source = self.pair()
        before = self.fake.deals[bx_source]['STAGE_ID']
        self.merge(target, source)
        self.sync().run()
        self.assertEqual(self.fake.deals[bx_source]['STAGE_ID'], before)
        self.assertTrue([row for row in self.fake.comments if str(row['ENTITY_ID']) == bx_source and 'Объединена' in row['COMMENT']])

    def test_feature_off(self):
        from features import FeatureAccess
        target, source, _bx_target, bx_source = self.pair()
        FeatureAccess(self.st).save({'dealMergeBx': {'on': False}}, 'тест')
        self.merge(target, source)
        self.sync().run()
        self.assertNotEqual(self.fake.deals[bx_source]['STAGE_ID'], 'C3:LOSE', 'выключено — как была')

    def test_restored_source_untouched(self):
        from bitrix import BitrixQueue
        from crm import DealBook
        from features import Viewer
        target, source, _bx_target, bx_source = self.pair()
        self.merge(target, source)
        DealBook(self.st).restore(source, Viewer.ADMIN)
        self.sync().run()
        self.assertNotEqual(self.fake.deals[bx_source]['STAGE_ID'], 'C3:LOSE', 'дубль вернули из корзины')
        self.assertEqual(BitrixQueue(self.st).stats()['queued'], 0)

    def test_older_merges_once(self):
        """Объединённые до этой функции (3.273) — закрываются при первом обмене после обновления, один раз."""
        from bitrix import BitrixConf
        target, source, _bx_target, bx_source = self.pair()
        self.merge(target, source, queue=False)
        BitrixConf(self.st).mark(mergedSwept=False)
        self.sync().run()
        self.assertEqual(self.fake.deals[bx_source]['STAGE_ID'], 'C3:LOSE')
        self.assertTrue(BitrixConf(self.st).get()['mergedSwept'])
        third = self.second('Ещё дубль')
        bx_third = self.push(third)
        self.merge(target, third, queue=False)
        self.sync().run()
        self.assertNotEqual(self.fake.deals[bx_third]['STAGE_ID'], 'C3:LOSE', 'обход прежних — только один раз')

    def test_no_lose_stage(self):
        """В воронке нет стадии проигрыша — ошибка в «Не отправлено» с понятной подписью; «Повторить» принимает вид."""
        from bitrix import BitrixQueue
        target, source, _bx_target, _bx_source = self.pair()
        number = self.number(source)
        self.fake.stages['DEAL_STAGE_3'] = [row for row in self.fake.stages['DEAL_STAGE_3'] if row[2] != 'F']
        self.merge(target, source)
        res = self.sync().run()
        self.assertEqual(res['failed'], 1, res)
        [item] = BitrixQueue(self.st).failed()
        self.assertEqual(item['kind'], BitrixQueue.MERGED)
        self.assertIn(f'Сделка № {number} (объединена с другой)', item['title'])
        self.assertIn('закрыть проигранной', item['title'])
        self.assertIn('нет стадии проигрыша', item['error'])
        self.assertIn(BitrixQueue.MERGED, BitrixQueue.KINDS)
        self.assertIn('Не отправлено в Битрикс24', self.log())


class DiffAlignTest(MergedBase):
    def stage_of(self, did):
        from bitrix import BitrixConf
        from crm import DealBook
        return BitrixConf(self.st).rules().stages('3')[DealBook(self.st).get(did)['stage']]

    def report(self):
        from bitrix_diff import BitrixDiff
        return BitrixDiff(self.st, self.sync()).report()

    def test_align_by_program_after_bitrix_edit(self):
        """В Битриксе стадию поменяли позже, опрос её не забрал: «Выровнять» отправляет стадию программы (раньше
        при отправке брались значения Битрикса — сделка выравнивалась не по программе)."""
        from bitrix_diff import BitrixDiff
        from crm import DealBook
        did = self.kp('26-0301')
        bid = self.push(did)
        ours = self.stage_of(did)
        theirs = 'C3:FINAL_INVOICE' if ours != 'C3:FINAL_INVOICE' else 'C3:EXECUTING'
        self.fake.edit_deal(bid, STAGE_ID=theirs)
        [row] = self.report()['rows']
        self.assertEqual([diff['field'] for diff in row['diffs']], ['stage'])
        stage = DealBook(self.st).get(did)['stage']
        BitrixDiff(self.st, self.sync()).align(did)
        res = self.sync().run()
        self.assertEqual(res['failed'], 0, res)
        self.assertEqual(self.fake.deals[bid]['STAGE_ID'], ours, 'в Битриксе — стадия программы')
        self.assertEqual(DealBook(self.st).get(did)['stage'], stage, 'программа не поменялась')
        self.assertEqual(self.report()['rows'], [])
        from bitrix import BitrixLinks
        self.assertNotIn('align', BitrixLinks(self.st).get('deal', did)['sent'], 'отметка снята после отправки')

    def test_only_sent_fields(self):
        """Поле «только из Битрикса» и менеджер без обмена в Битрикс — не расхождение: выровнять по программе нельзя."""
        from bitrix import BitrixConf
        did = self.kp('26-0302')
        bid = self.push(did)
        self.fake.edit_deal(bid, STAGE_ID='C3:FINAL_INVOICE', OPPORTUNITY='1.00')
        fields = {row['field'] for row in self.report()['rows'][0]['diffs']}
        self.assertEqual(fields, {'stage', 'sum'})
        BitrixConf(self.st).save({'fields': {'stage': {'dir': 'in'}}}, 'тест')
        self.assertEqual({row['field'] for row in self.report()['rows'][0]['diffs']}, {'sum'})
        BitrixConf(self.st).save({'mgr': {'m1': {'dir': 'in'}}}, 'тест')
        self.assertEqual(self.report()['rows'], [], 'обмен менеджера — только из Битрикса')

    def test_align_all(self):
        from bitrix_diff import BitrixDiff
        one, two = self.kp('26-0303'), self.second('Вторая')
        for did in (one, two):
            self.fake.edit_deal(self.push(did), OPPORTUNITY='7.00')
        self.assertEqual(len(self.report()['rows']), 2)
        diff = BitrixDiff(self.st, self.sync())
        self.assertEqual(diff.align_all([one, two, 'd999999', one]), 2, 'нет такой — пропуск, повтор — один раз')
        with self.assertRaises(ValueError):
            diff.align_all(['../d1'])
        with self.assertRaises(ValueError):
            diff.align_all('d1')
        self.sync().run()
        self.assertEqual(self.report()['rows'], [])


class AlignAllRouteTest(unittest.TestCase):
    """Маршрут «Выровнять все» на стенде: администратор с токеном, неверный список, выключатель, журнал действий."""

    @classmethod
    def setUpClass(cls):
        from kit import SampleData, Stand
        cls.stand = Stand('server', SampleData(items=20, clients=4, kps=1)).start()
        cls.http = cls.stand.http
        cls.adm, cls.headers = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def post(self, body, **kw):
        return self.http.req('POST', '/api/admin/bitrix/diff/align-all', body, cookie=self.adm, headers=dict(self.headers), **kw)

    def test_route(self):
        status, body, _ = self.http.req('GET', '/api/crm/board?manager=all', cookie=self.adm, headers=dict(self.headers))
        ids = [deal['id'] for deal in json.loads(body)['deals']][:2]
        self.assertTrue(ids, body)
        status, body, _ = self.post({'deals': ids})
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['queued'], len(ids))
        self.assertEqual(self.post({'deals': 'all'})[0], 400)
        self.assertEqual(self.post({'deals': ['d1; DROP']})[0], 400)
        self.assertEqual(self.http.req('POST', '/api/admin/bitrix/diff/align-all', {'deals': ids})[0], 401, 'без входа — нет')
        status, body, _ = self.http.req('GET', '/api/admin/audit?action=edit_settings', cookie=self.adm, headers=dict(self.headers))
        self.assertIn('выровнять все по программе', body)
        self.http.req('POST', '/api/admin/features', {'values': {'bxDiffAll': {'on': False}}}, cookie=self.adm, headers=dict(self.headers))
        self.assertEqual(self.post({'deals': ids})[0], 403)
        self.http.req('POST', '/api/admin/features', {'values': {'bxDiffAll': None}}, cookie=self.adm, headers=dict(self.headers))


if __name__ == '__main__':
    unittest.main()
