# -*- coding: utf-8 -*-
"""Программа значком на экране «Домой» (функция «homeApp», 31.10): описание /manifest.webmanifest — название, значки
(файлы есть, размер — как в описании), вид на весь экран; выключена — значок открывает браузер; адрес и значки открыты без
входа менеджера (значок ставится до входа), данные программы — нет."""
import json
import struct
import unittest

from kit import Http, Net, SampleData, Stand


class HomeAppTest(unittest.TestCase):
    PNG = b'\x89PNG\r\n\x1a\n'

    @classmethod
    def setUpClass(cls):
        cls.sample = SampleData()
        cls.stand = Stand(sample=cls.sample).start()
        cls.adm, cls.A = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def manifest(self, http=None):
        code, body, headers = (http or self.stand.http).req('GET', '/manifest.webmanifest')
        self.assertEqual(code, 200, body)
        self.assertTrue(headers.get('Content-Type', '').startswith('application/manifest+json'), headers)
        return json.loads(body)

    def feature(self, value):
        code, body, _ = self.stand.http.req('POST', '/api/admin/features', {'values': {'homeApp': value}},
                                            cookie=self.adm, headers=self.A)
        self.assertEqual(code, 200, body)

    def test_full_screen_with_icons(self):
        data = self.manifest()
        self.assertEqual(data['display'], 'standalone')
        self.assertEqual((data['start_url'], data['scope']), ('/', '/'))
        self.assertTrue(data['name'] and data['short_name'])
        for icon in data['icons']:
            code, png, headers = self.stand.http.req('GET', icon['src'], raw=True)
            self.assertEqual(code, 200, icon['src'])
            self.assertEqual(headers.get('Content-Type'), 'image/png')
            self.assertEqual(png[:8], self.PNG)
            width, height = struct.unpack('>II', png[16:24])  # заголовок IHDR
            self.assertEqual('%dx%d' % (width, height), icon['sizes'], icon['src'])

    def test_switched_off_opens_browser(self):
        self.feature({'on': False})
        try:
            self.assertEqual(self.manifest()['display'], 'browser')
        finally:
            self.feature(None)
        self.assertEqual(self.manifest()['display'], 'standalone')

    def test_page_links_manifest(self):
        code, page, _ = self.stand.http.req('GET', '/')
        self.assertEqual(code, 200)
        self.assertIn('rel="manifest" href="/manifest.webmanifest"', page)
        self.assertIn('rel="apple-touch-icon" href="/web/img/app-180.png', page)

    def test_open_without_login(self):
        remote = Net.remote_ip()
        if not remote:
            self.skipTest('нет сетевого адреса, кроме 127.0.0.1: запрос «по сети» не проверить')
        mgr = SampleData.MANAGERS[0]
        code, body, _ = self.stand.http.req('POST', '/api/admin/access/' + mgr[0],
                                            {'login': 'h1', 'password': 'Home-App-52', 'perms': {}},
                                            cookie=self.adm, headers=self.A)
        self.assertEqual(code, 200, body)
        code, body, _ = self.stand.http.req('POST', '/api/admin/access', {'enabled': True}, cookie=self.adm, headers=self.A)
        self.assertEqual(code, 200, body)
        net = Http(self.stand.port, host=remote)
        try:
            self.assertEqual(net.req('GET', '/api/clients')[0], 401, 'данные — только после входа')
            self.assertEqual(self.manifest(net)['display'], 'standalone')
            self.assertEqual(net.req('GET', '/web/img/app-180.png', raw=True)[0], 200)
        finally:
            self.stand.http.req('POST', '/api/admin/access', {'enabled': False}, cookie=self.adm, headers=self.A)


if __name__ == '__main__':
    unittest.main()
