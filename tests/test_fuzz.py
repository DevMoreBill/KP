# -*- coding: utf-8 -*-
"""Фаззинг API на стенде: адреса × методы × испорченные параметры и тела (не JSON, не тот тип, огромные числа, пути
с ../, NUL, ссылки на file:// и на сам сервер). Ни один запрос не должен закончиться внутренней ошибкой сервера (500),
обрывом соединения или ожиданием дольше 15 секунд. Стенд без выхода в интернет — внешние сервисы отвечают отказом сразу."""
import json
import time
import unittest

from kit import SampleData, Stand


class FuzzTest(unittest.TestCase):
    SLOW = 15
    # изменения, после которых стенд уже не проверить (выход, замена базы, удаление) — не трогаем
    SKIP = ('/api/admin/import', '/api/admin/delete', '/api/admin/logout', '/api/admin/password', '/api/shutdown', '/api/admin/restart',
            '/api/admin/update/', '/api/admin/users')
    BAD_Q = ['', 'x', '-1', '99999999999999999999', '%27%22%3C%3E', '..%2F..%2F', '%00', 'NaN', '%E2%80%AE', 'a' * 3000]
    BODIES = [None, '', '{bad', '[]', '"s"', 'null', '123', '{}', '{"x":null}',
              '{"items":"str","id":5,"name":["a"],"values":{"z":[1]},"enabled":"no","state":7,"title":{},"to":[1],"on":"x","path":5}',
              json.dumps({'a': {'b': {'c': [{'d': 1e308}] * 3}}}), '\xff\xfe', '{"url":"file:///etc/passwd"}',
              '{"url":"http://127.0.0.1:9/api/ping"}', '{"path":"../../../etc","which":"../x","values":{"../x":{"on":true}}}']

    @classmethod
    def setUpClass(cls):
        cls.sample = SampleData()
        cls.stand = Stand(sample=cls.sample).start()
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def paths(self):
        kp, cat, cl, mg = self.sample.kp_ids[SampleData.MANAGERS[0][0]][0], self.sample.items[0]['id'], self.sample.clients[0]['id'], SampleData.MANAGERS[0][0]
        k = '/api/kp/' + kp
        return ['/api/types', '/api/geo/suggest?q=%s', '/api/geo/route?from=%s&to=%s', '/api/party?q=%s', '/api/check/quota', '/api/check?inn=%s',
                '/api/integrations', '/api/clients?q=%s&limit=%s&offset=%s', '/api/clients/' + cl, '/api/templates', '/api/templates/pnevmotekh/history',
                '/api/templates/pnevmotekh/file?name=%s', '/api/templates/pnevmotekh/restore?name=%s', '/api/templates/pnevmotekh/copy?to=%s&title=%s',
                '/tpl/pnevmotekh/%s', '/api/ping', '/api/catalog?full=%s', '/api/catalog/sources', '/api/catalog/pending', '/api/catalog/' + cat,
                '/api/img?cat=%s&maker=%s&model=%s&kind=%s', '/img/%s', '/api/managers', '/api/managers/' + mg, '/api/pdf',
                '/api/history?limit=%s&offset=%s&q=%s&kind=%s', k + '/state', k + '/meta', k + '/rev', k + '/versions', k + '/versions/%s',
                k + '/docx?name=%s&dir=%s', k + '/pdf', k + '/track', k + '/mailform', k + '/send', k + '/openpdf', k + '/open', k + '/folder',
                '/api/folder?dir=%s', '/api/cbr', '/api/cbr/keyrate', '/api/logos', '/api/imgfetch?url=%s', '/api/ai/status', '/api/ai/fill', '/api/pagetext',
                '/api/pdftext', '/api/tz/parse?name=%s', '/api/pagephotos', '/api/lists', '/api/defaults', '/api/logistics/quote', '/api/logistics/status', '/api/logistics',
                '/api/uitexts', '/api/version', '/api/calendar?year=%s', '/api/suppliers', '/api/suppliers/s%s', '/api/customs', '/api/auth/status',
                '/api/auth/login', '/api/integrations/export', '/api/admin/status', '/api/admin/access', '/api/admin/access/' + mg, '/api/admin/ai',
                '/api/admin/ai/test', '/api/admin/audit?limit=%s&offset=%s&q=%s', '/api/admin/audit/filters', '/api/admin/audit/%s/rollback',
                '/api/admin/defaults', '/api/admin/export?sections=%s&cats=%s', '/api/admin/export/cats', '/api/admin/feeds', '/api/admin/feeds/zzz/log',
                '/api/admin/lists', '/api/admin/maint', '/api/admin/maint/audit', '/api/admin/maint/mirror', '/api/admin/maint/mirror/check',
                '/api/admin/moderation', '/api/admin/stats?days=%s', '/api/admin/trash', '/api/admin/trash/%s/restore', '/api/admin/list/kp?q=%s',
                '/api/admin/list/catalog?q=%s', '/api/admin/list/client', '/api/admin/pending/%s', '/api/admin/migrations', '/api/admin/mail',
                '/api/admin/mail/test', '/api/admin/features', '/api/admin/history?limit=%s&offset=%s&key=%s', '/api/admin/history/%s',
                '/api/admin/history/%s/rollback', '/api/admin/update', '/api/admin/system', '/api/admin/attention', '/api/admin/log',
                '/api/admin/log/download', '/api/admin/alerts', '/api/admin/alerts/test', '/api/reminders', '/api/report?from=%s&to=%s',
                '/api/mail/status', '/api/drafts', '/api/drafts/dfz1', '/api/drafts/dfz1/delete', '/api/presets', '/api/presets/pfz1',
                '/api/presets/pfz1/delete', '/api/clientcard', '/api/clientcard?inn=%s', '/api/clientcard?id=%s&name=%s', '/api/clientcard/note',
                '/api/features', '/api/catalog/sync?since=%s&epoch=%s', '/api/catalog/search?q=%s', '/api/me/prefs',
                '/api/ai/profile?cat=%s&maker=%s&model=%s']

    def test_no_internal_errors(self):
        errs, slow, n = [], [], 0
        headers = {'X-CSRF-Token': self.A['X-CSRF-Token'], 'X-KP-User-Id': 'fz', 'Content-Type': 'application/json'}
        for p in self.paths():
            if p.startswith(self.SKIP):
                continue
            for method in ('GET', 'PUT', 'POST', 'DELETE'):
                for i, q in enumerate(self.BAD_Q if '%s' in p else ['']):
                    if method != 'GET' and i > 2:
                        continue
                    url = p.replace('%s', q)
                    for body in (self.BODIES if method in ('PUT', 'POST') else [None]):
                        data = body.encode('latin-1', 'replace') if isinstance(body, str) else body
                        t = time.time()
                        try:
                            st, b, _ = self.stand.http.req(method, url, data, cookie=self.adm, headers=headers, timeout=60)
                        except OSError as e:
                            st, b = -1, repr(e)
                        n += 1
                        if st == 500 or st < 0:
                            errs.append((method, url[:120], (body or '')[:40], st, b[:140]))
                        if time.time() - t > self.SLOW:
                            slow.append((round(time.time() - t, 1), method, url[:100]))
        self.assertGreater(n, 3000)
        self.assertEqual(errs[:15], [], 'внутренние ошибки или обрывы: %d из %d запросов' % (len(errs), n))
        self.assertEqual(slow[:10], [], 'дольше %d с' % self.SLOW)
        self.assertTrue(self.stand.up(), 'сервер работает после фаззинга')
        self.assertEqual([r['text'] for r in self.stand.request_errors()][:10], [])


if __name__ == '__main__':
    unittest.main()
