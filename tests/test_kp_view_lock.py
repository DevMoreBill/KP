# -*- coding: utf-8 -*-
"""Чужое КП — только просмотр 3.204.0 (web_api KpController._others_kp): сохранённое КП другого менеджера без отметки
«Разрешить правку» (заголовок X-KP-Edit-Other) не перезаписывается — ответ 409; своё КП и новое — сохраняются; функция
выключена — как раньше. Стенд с вымышленными данными, рабочая база не используется."""
import json
import unittest
import urllib.parse

from kit import Stand


class ViewLockTest(unittest.TestCase):
    KID = 'zzlock1'

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(mode='local').start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.stop()

    def put(self, field, body, who, edit=False):
        headers = {'X-KP-User-Id': who, 'X-KP-User': urllib.parse.quote(who)}
        if edit:
            headers['X-KP-Edit-Other'] = '1'
        return self.stand.http.req('PUT', '/api/kp/%s/%s' % (self.KID, field), body, headers=headers)

    def test_01_own_saves(self):
        meta = {'id': self.KID, 'number': 'Т-1', 'client': 'ООО «А»', 'authorId': 'm1', 'managerId': 'm1', 'sum': 1000}
        self.assertEqual(self.put('meta', meta, 'm1')[0], 200, 'новое КП — сохраняется')
        self.assertEqual(self.put('state', {'number': 'Т-1', 'authorId': 'm1'}, 'm1')[0], 200, 'своё КП — сохраняется')

    def test_02_others_refused(self):
        status, body, _ = self.put('state', {'number': 'Т-1', 'authorId': 'm1', 'client': 'чужая правка'}, 'm2')
        self.assertEqual(status, 409)
        self.assertIn('только для просмотра', body)
        self.assertEqual(self.put('meta', {'id': self.KID, 'authorId': 'm1'}, 'm2')[0], 409)
        state = json.loads(self.stand.http.req('GET', '/api/kp/%s/state' % self.KID)[1])
        self.assertNotEqual(state.get('client'), 'чужая правка', 'КП не изменилось')

    def test_03_unlocked_saves(self):
        self.assertEqual(self.put('state', {'number': 'Т-1', 'authorId': 'm1', 'client': 'разрешено'}, 'm2', edit=True)[0], 200)
        state = json.loads(self.stand.http.req('GET', '/api/kp/%s/state' % self.KID)[1])
        self.assertEqual(state.get('client'), 'разрешено')

    def test_04_docx_refused(self):
        status = self.stand.http.req('PUT', '/api/kp/%s/docx?name=kp.docx' % self.KID, b'PK\x03\x04' + b'0' * 64,
                                     headers={'X-KP-User-Id': 'm2'})[0]
        self.assertEqual(status, 409)


if __name__ == '__main__':
    unittest.main()
