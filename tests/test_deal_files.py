# -*- coding: utf-8 -*-
"""Документы сделки (app/deal_files.py, маршруты /api/crm/deal/<id>/files): вид документа, проверка файла как у КП,
пределы, скачивание, удаление автором и администратором; закрывающие документы — дело «прикрепить акт или
УПД» после поставки или выигрыша (давние сделки — без него), сделано само при прикреплении; отправка в Битрикс24 — в поле
файлов по названию (прежние файлы поля сохраняются) или комментарием с файлом в ленте. Стенд с вымышленными данными."""
import json
import unittest
import urllib.parse
from datetime import date, timedelta

from kit import Http, SampleData, Stand, TempStore
from test_bitrix import SyncBase


def pdf(size=2000):
    return b'%PDF-1.4\n' + b'0' * max(0, size - 9)


def day(shift):
    return (date.today() + timedelta(days=shift)).isoformat()


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.st = TempStore(self).store

    def files(self):
        from deal_files import DealFiles
        return DealFiles.of(self.st)

    def test_kinds_and_checks(self):
        files = self.files()
        rec = files.add_kind('d1', 'contract', 'Договор № 15.pdf', pdf(), 'Иванова Анна', 'm1')
        self.assertEqual((rec['kind'], rec['name'], rec['by']), ('contract', 'Договор № 15.pdf', 'Иванова Анна'))
        files.add_kind('d1', 'upd', 'УПД 101.pdf', pdf())
        self.assertEqual(sorted(files.kinds(['d1', 'd2'])['d1']), ['contract', 'upd'])
        self.assertTrue(files.has_closing('d1'))
        self.assertFalse(files.has_closing('d2'))
        with self.assertRaises(ValueError):
            files.add_kind('d1', 'virus', 'a.pdf', pdf())
        with self.assertRaises(ValueError):
            files.add_kind('d1', 'act', 'Акт.pdf', b'MZ' + b'0' * 100)
        with self.assertRaises(ValueError):
            files.add_kind('../kp', 'act', 'Акт.pdf', pdf())

    def test_limit_words(self):
        import defaults
        defaults.save(self.st, {'deal.filesMax': {'v': 1}})
        files = self.files()
        self.assertEqual(files.limits()['filesMax'], 1)
        files.add_kind('d3', 'act', 'Акт.pdf', pdf())
        with self.assertRaises(ValueError) as err:
            files.add_kind('d3', 'act', 'Акт 2.pdf', pdf())
        self.assertIn('У сделки уже 1', str(err.exception))

    def test_closing_due(self):
        from deal_files import DealClosing
        closing = DealClosing(self.st)
        self.assertTrue(closing.due({'id': 'd5', 'stage': 'won', 'stageAt': day(-3)}))
        self.assertFalse(closing.due({'id': 'd5', 'stage': 'won', 'stageAt': day(-200)}), 'давняя сделка — без напоминания')
        self.assertTrue(closing.due({'id': 'd5', 'stage': 'delivery', 'exec': {'done': {'delivery': {'at': day(-1)}}}}))
        self.assertFalse(closing.due({'id': 'd5', 'stage': 'talks'}))
        self.assertFalse(closing.due({'id': 'd5', 'stage': 'talks', 'exec': {'done': 3}}), 'сводка исполнения — не отметки')
        self.files().add_kind('d5', 'act', 'Акт.pdf', pdf())
        self.assertFalse(closing.due({'id': 'd5', 'stage': 'won', 'stageAt': day(-3)}))


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sample = SampleData(items=8, clients=3, kps=3)
        cls.stand = Stand(sample=cls.sample)
        cls.stand.start()
        cls.adm, cls.A = cls.stand.admin()
        cls.M1, cls.M2 = SampleData.MANAGERS
        board = Http.js(cls.stand.http.req('GET', '/api/crm/board', headers=Stand.as_manager(cls.M1))[1])
        cls.D1 = board['deals'][0]['id']

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def R(self, method, path, body=None, who='m1', raw=False, extra=None):
        if who == 'adm':
            headers, cookie = dict(self.A), self.adm
        else:
            headers, cookie = Stand.as_manager(self.M2 if who == 'm2' else self.M1), None
        headers.update(extra or {})
        return self.stand.http.req(method, path, body, headers=headers, cookie=cookie, raw=raw)

    def up(self, kind, name, data, who='m1'):
        query = '/api/crm/deal/%s/files?kind=%s&name=%s' % (self.D1, kind, urllib.parse.quote(name))
        return self.R('POST', query, data, who=who, extra={'Content-Type': 'application/octet-stream'})

    def test_01_upload_card_download(self):
        status, body, _ = self.up('contract', 'Договор поставки.pdf', pdf(4000))
        self.assertEqual(status, 200, body)
        card = Http.js(body)
        self.assertEqual([(row['kind'], row['name']) for row in card['files']], [('contract', 'Договор поставки.pdf')])
        self.assertEqual(card['fileKinds']['upd'], 'УПД')
        self.assertTrue(card['files'][0].get('undoUntil'), 'автор может удалить свой файл в первые минуты')
        fid = card['files'][0]['id']
        status, data, headers = self.R('GET', '/api/crm/deal/%s/files/%d' % (self.D1, fid), raw=True)
        self.assertEqual((status, data), (200, pdf(4000)))
        self.assertTrue(headers.get('Content-Disposition', '').startswith('attachment;'))
        self.assertEqual(self.up('nope', 'Акт.pdf', pdf())[0], 400)

    def test_02_remove(self):
        card = Http.js(self.up('other', 'Лишнее.pdf', pdf())[1])
        fid = next(row['id'] for row in card['files'] if row['name'] == 'Лишнее.pdf')
        status, body, _ = self.R('POST', '/api/crm/deal/%s/files/%d/remove' % (self.D1, fid), {}, who='m2')
        self.assertEqual(status, 403, 'не автор — не удаляет')
        status, body, _ = self.R('POST', '/api/crm/deal/%s/files/%d/remove' % (self.D1, fid), {})
        self.assertEqual(status, 200, body)
        self.assertNotIn('Лишнее.pdf', [row['name'] for row in Http.js(body)['files']])
        card = Http.js(self.up('other', 'Ещё.pdf', pdf())[1])
        fid = next(row['id'] for row in card['files'] if row['name'] == 'Ещё.pdf')
        self.assertEqual(self.R('POST', '/api/admin/dealfiles/%s/%d/delete' % (self.D1, fid), {}, who='adm')[0], 200)
        status, _body, _ = self.stand.http.req('POST', '/api/admin/dealfiles/%s/%d/delete' % (self.D1, fid), {},
                                                cookie=self.adm)
        self.assertIn(status, (401, 403), 'без токена CSRF — нельзя')

    def test_03_closing_task(self):
        card = Http.js(self.R('GET', '/api/crm/deal/%s' % self.D1)[1])
        status, body, _ = self.R('PUT', '/api/crm/deal/%s' % self.D1, {'stage': 'won'}, extra={'X-KP-Rev': str(card['rev'])})
        self.assertEqual(status, 200, body)
        card = Http.js(self.R('GET', '/api/crm/deal/%s' % self.D1)[1])
        self.assertTrue(card['closingDue'])
        steps = [task['state'] for task in card['tasks'] if task.get('step') == 'auto:closing:' + self.D1]
        self.assertEqual(steps, ['open'], 'дело «прикрепить закрывающие» поставлено')
        card = Http.js(self.up('upd', 'УПД № 7.pdf', pdf())[1])
        self.assertFalse(card['closingDue'])
        steps = [task['state'] for task in card['tasks'] if task.get('step') == 'auto:closing:' + self.D1]
        self.assertEqual(steps, ['done'], 'УПД прикреплён — дело сделано само')
        board = Http.js(self.R('GET', '/api/crm/board')[1])
        row = next(deal for deal in board['deals'] if deal['id'] == self.D1)
        self.assertIn('upd', row['docs'])
        self.assertFalse(row['closingDue'])


class BitrixDocsTest(SyncBase):
    def fields(self, *rows):
        from crm_funnels import DealFields
        DealFields(self.st).save_defs([{'code': code, 'title': title, 'type': kind, 'multiple': many}
                                       for code, title, kind, many in rows], {})

    def test_field_or_feed(self):
        from bitrix import BitrixQueue
        from deal_files import DealFiles
        did = self.kp('26-0001')
        self.fields(('UF_CLOSE', 'Закрывающие документы', 'file', True), ('UF_TKP', 'Загрузить ТКП/Счет', 'file', False))
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        bid = next(iter(self.fake.deals))
        self.fake.deals[bid]['UF_CLOSE'] = [{'id': 901, 'showUrl': '/x'}]  # файл, положенный на портале руками
        files = DealFiles.of(self.st)
        files.add_kind(did, 'act', 'Акт № 3.pdf', pdf())
        files.add_kind(did, 'contract', 'Договор.pdf', pdf())
        before = len(self.fake.comments)
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        value = self.fake.deals[bid]['UF_CLOSE']
        self.assertEqual(value[0], {'id': 901}, 'прежний файл поля сохранён')
        self.assertEqual(value[1]['fileData'][0], 'Акт № 3.pdf')
        self.assertNotIn('fileData', json.dumps(self.fake.deals[bid].get('UF_TKP') or {}), 'в поле ТКП документы не кладутся')
        added = self.fake.comments[before:]
        self.assertEqual([row['COMMENT'] for row in added if row.get('FILES')], ['Документ сделки — Договор: Договор.pdf'])
        BitrixQueue.touch(self.st, 'deal', did)
        self.sync().run()
        self.assertEqual(len(self.fake.deals[bid]['UF_CLOSE']), 2, 'второй раз не отправляется')
        self.assertEqual(len([row for row in self.fake.comments if row.get('FILES') and 'Договор.pdf' in row['COMMENT']]), 1)


if __name__ == '__main__':
    unittest.main()
