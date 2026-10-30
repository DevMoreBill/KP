# -*- coding: utf-8 -*-
"""Цена позиции каталога «из КП» (аудит 30.10, п. 27; catalog_quality.KpPriceProof, admin._put_product): менеджер без права
«Правка каталога» меняет цену и закупку позиции только сохранением КП — если их подтверждает последнее КП, которое он сохранил;
иначе правка ждёт решения на модерации (сохранение КП не обрывается, каталог не меняется). При включённой модерации
заголовок «из КП» сам по себе модерацию не обходит. Картинки по ссылке (п. 28) — без прокси. Вымышленные данные."""
import os
import unittest
import unittest.mock
import urllib.request

from kit import Http, SampleData, Stand


class KpPriceProofTest(unittest.TestCase):
    PW = 'pass-pp-m2-52'
    H = {'Content-Type': 'application/json'}
    AUTO = {'Content-Type': 'application/json', 'X-KP-Edit': 'auto'}
    KID = 'pp-kp-1'
    NUMBER = 'PP-1'
    NO_EDIT = {'catAdd': False, 'catEdit': False}  # по умолчанию у менеджера оба права есть

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=12, clients=1, kps=0)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()
        cls.M2 = SampleData.MANAGERS[1]
        st, b, _ = cls.http.req('POST', '/api/admin/access/' + cls.M2[0], {'login': 'pp2', 'password': cls.PW, 'perms': cls.NO_EDIT},
                                cookie=cls.adm, headers=dict(cls.A, **cls.H))
        assert st == 200, b
        st, b, _ = cls.http.req('POST', '/api/admin/access', {'enabled': True}, cookie=cls.adm, headers=dict(cls.A, **cls.H))
        assert st == 200, b
        st, b, hd = cls.http.req('POST', '/api/auth/login', {'login': 'pp2', 'password': cls.PW})
        assert st == 200, b
        cls.c2 = Http.cookie(hd)

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def moderation(self, on):
        st = self.http.req('POST', '/api/admin/moderation', {'enabled': on, 'pending': 'reject'}, cookie=self.adm, headers=dict(self.A, **self.H))[0]
        self.assertEqual(st, 200)

    def doc(self, cid):
        doc = Http.js(self.http.req('GET', '/api/catalog/' + cid, cookie=self.c2)[1])
        doc.pop('_rev', None)
        return doc

    def save_kp(self, cid, name, price, cost=0):
        """Как «Сохранить КП»: состояние КП в журнал — до записи цен в каталог."""
        state = {'number': self.NUMBER, 'date': '2026-10-30', 'client': 'ООО «Проба»', 'pricing': {'cur': 'RUB'},
                 'items': [{'name': name, 'catId': cid, 'price': price, 'cost': cost, 'costCur': 'RUB', 'qty': 1,
                            'options': [{'name': 'Опция пробы', 'price': 7000, 'qty': 1}]}]}
        st, b, _ = self.http.req('PUT', '/api/kp/%s/state' % self.KID, state, cookie=self.c2, headers=self.H)
        self.assertEqual(st, 200, b)

    def synced(self, base, price, cost=0):
        """Как сохранение КП в интерфейсе (CatalogSync._money и _history): цена, валюта, закупка и запись истории."""
        doc = dict(base, price=price, priceCur='RUB', cost=cost or base.get('cost') or 0,
                   costCur='RUB', updatedAt='2026-10-30T10:00:00Z')
        entry = {'date': '2026-10-30', 'client': 'ООО «Проба»', 'price': price, 'cur': 'RUB', 'cost': cost, 'costCur': 'RUB',
                 'qty': 1, 'number': self.NUMBER}
        doc['prices'] = [entry] + [row for row in base.get('prices') or [] if row.get('number') != self.NUMBER]
        return doc

    def put(self, cid, doc, headers=None):
        st, b, _ = self.http.req('PUT', '/api/catalog/' + cid, doc, cookie=self.c2, headers=headers or self.AUTO)
        return st, (Http.js(b) if st == 200 else b)

    def test_1_price_of_saved_kp(self):
        self.moderation(False)
        base = self.doc('tst-0007')
        self.save_kp('tst-0007', base['name'], 123456, cost=99000)
        st, body = self.put('tst-0007', self.synced(base, 123456, cost=99000))
        self.assertEqual((st, body.get('pending')), (200, None), body)
        now = self.doc('tst-0007')
        self.assertEqual((now['price'], now['cost'], now['prices'][0]['number']), (123456, 99000, self.NUMBER))

    def test_2_other_price_waits(self):
        self.moderation(False)
        base = self.doc('tst-0008')
        self.save_kp('tst-0008', base['name'], 50000)
        st, body = self.put('tst-0008', self.synced(base, 1))
        self.assertEqual(st, 200, 'сохранение КП не обрывается')
        self.assertTrue(body.get('pending'), 'цена не из КП — на модерацию, было: сразу в каталог')
        self.assertNotEqual(self.doc('tst-0008')['price'], 1)
        st, body = self.put('tst-0008', self.synced(base, 50000), headers=self.H)
        self.assertTrue(body.get('pending'), 'без заголовка «из КП» — тоже не сразу')
        forged = self.synced(base, 50000)
        forged['prices'] = forged['prices'][:1] + [{'price': 1, 'number': 'старое'}]
        self.assertTrue(self.put('tst-0008', forged)[1].get('pending'), 'подменённая история цен — не из КП')

    def test_3_moderation_not_skipped_by_header(self):
        self.moderation(True)
        try:
            base = self.doc('tst-0009')
            self.save_kp('tst-0009', base['name'], 64000)
            st, body = self.put('tst-0009', self.synced(base, 64000))
            self.assertEqual((st, body.get('pending')), (200, None), 'цена сохранённого КП — без модерации, как раньше')
            st, body = self.put('tst-0009', self.synced(self.doc('tst-0009'), 2))  # как интерфейс: свежая карточка
            self.assertEqual(st, 200, body)
            self.assertTrue(body.get('pending'), 'было: заголовок «из КП» пропускал любую цену мимо модерации')
        finally:
            self.moderation(False)

    def test_4_text_edit_still_needs_right(self):
        base = self.doc('tst-0010')
        st, body = self.put('tst-0010', dict(base, spec='чужое описание'), headers=self.H)
        self.assertEqual(st, 403, 'правка содержимого без права — как раньше')


class DirectImagesTest(unittest.TestCase):
    """П. 28: картинки по ссылке — напрямую, без прокси, в том числе системного (адрес соединения проверяется всегда);
    фиды — как были (в отделе с прокси они идут через него)."""

    @staticmethod
    def proxies(opener):
        return [handler.proxies for handler in opener.handlers if isinstance(handler, urllib.request.ProxyHandler)]

    def test_no_proxy_for_images(self):
        import imgfetch
        with unittest.mock.patch.dict(os.environ, {'HTTP_PROXY': 'http://127.0.0.1:9', 'HTTPS_PROXY': 'http://127.0.0.1:9'}):
            self.assertEqual([one for one in self.proxies(imgfetch.SafeWeb.direct()) if one], [], 'картинки — без прокси')
            self.assertIn('http', self.proxies(imgfetch.SafeWeb.opener())[0], 'фиды — с прокси, как раньше')

    def test_tls_context_own(self):
        import imgfetch
        https = [handler for handler in imgfetch.SafeWeb.direct().handlers if isinstance(handler, imgfetch.SafeWeb.HTTPS)]
        self.assertEqual(len(https), 1)
        self.assertTrue(https[0].tls.check_hostname, 'свой контекст TLS с проверкой имени, а не закрытое поле urllib')


if __name__ == '__main__':
    unittest.main()
