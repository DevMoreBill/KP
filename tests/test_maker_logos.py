# -*- coding: utf-8 -*-
"""Логотипы производителей (app/maker_logos.py, «Настройки → Фиды поставщиков → Логотипы производителей»): закреплённый
логотип встаёт на всё оборудование марки (все написания), отдаётся в /api/logos поверх найденного в каталоге, фид ставит
его поверх своего, открепление оставляет логотип на позициях; картинка — только PNG/JPEG/WebP до 2 МБ; без сессии
администратора и токена CSRF — отказ."""
import base64
import json
import os
import struct
import sys
import unittest
import zlib

from kit import APP, SampleData, Stand, TempStore

sys.path.insert(0, APP)
from maker_logos import MakerLogos   # noqa: E402


def png(w=40, h=12, rgb=(200, 30, 30)):
    """Маленькая картинка PNG (без сторонних библиотек)."""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)   # noqa: E731
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


class Images:
    """Заменитель хранилища изображений: файлы — в папке проверки."""
    def __init__(self, root):
        self.root = root

    def put(self, data, ext, folder, title):
        rel = '%s/%s__%s%s' % (folder, title, '%010x' % zlib.crc32(data), ext)
        os.makedirs(os.path.join(self.root, folder), exist_ok=True)
        with open(os.path.join(self.root, rel), 'wb') as f:
            f.write(data)
        return rel


class MakerLogosUnitTest(unittest.TestCase):
    def setUp(self):
        self.t = TempStore(self)
        st = self.t.store
        for i, mk in enumerate(['Remeza', 'REMEZA', 'Ремеза', 'Dali', 'Remeza']):
            st.catalog_put('it%d' % i, json.dumps({'name': 'Позиция %d' % i, 'attrs': {'maker': mk, 'cat': 'comp_screw'},
                                                   'logo': {'src': '/img/logos/old.png', 'w': 10, 'h': 5}}, ensure_ascii=False), 'проверка')
        self.ml = MakerLogos(st, Images(self.t.dir))

    def test_image_check(self):
        d, ext, w, h = MakerLogos.image('data:image/png;base64,' + base64.b64encode(png(40, 12)).decode())
        self.assertEqual((ext, w, h), ('.png', 40, 12))
        for bad, word in [('', 'Нет картинки'), (base64.b64encode(b'<svg/>').decode(), 'PNG, JPEG или WebP'),
                          (base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'0' * (MakerLogos.MAX_BYTES + 10)).decode(), '2 МБ')]:
            with self.assertRaises(ValueError) as e:
                MakerLogos.image(bad)
            self.assertIn(word, str(e.exception))

    def test_set_applies_to_all_spellings_and_pins(self):
        import imgfetch
        r = self.ml.set('Remeza', base64.b64encode(png()).decode(), 'admin')
        self.assertEqual(r['items'], 4, 'все написания марки: Remeza, REMEZA, Ремеза')
        src = r['logo']['src']
        self.assertTrue(src.startswith('/img/logos/'))
        for i in range(5):
            d = json.loads(self.t.store.catalog_get('it%d' % i))
            self.assertEqual(d['logo']['src'] == src, i != 3, 'Dali не тронут')
        L = imgfetch.logos(self.t.store)
        self.assertEqual(L['remeza']['src'], src, '/api/logos — закреплённый')
        self.assertEqual(L['ремеза']['src'], src)
        self.assertEqual(self.ml.apply(), 0, 'повторно — без изменений')
        row = next(x for x in self.ml.list() if x['maker'].lower() == 'remeza')
        self.assertTrue(row['pinned'] and row['n'] == 4 and row['logo']['src'] == src)
        # фид: закреплённый логотип — поверх логотипа позиции
        import feeds
        fill, _ = feeds._logo_filler(self.t.store, None, {})
        doc = {'attrs': {'maker': 'REMEZA'}, 'logo': {'src': '/img/feed.png'}}
        self.assertTrue(fill(doc))
        self.assertEqual(doc['logo']['src'], src)
        # открепление: на позициях остаётся, фид снова ставит свой, если у позиции логотипа нет
        self.ml.unpin('Ремеза')
        self.assertFalse(self.ml.pins())
        self.assertEqual(json.loads(self.t.store.catalog_get('it0'))['logo']['src'], src)
        fill, _ = feeds._logo_filler(self.t.store, None, {})
        doc = {'attrs': {'maker': 'REMEZA'}, 'logo': {'src': '/img/feed.png'}}
        self.assertFalse(fill(doc))
        with self.assertRaises(ValueError):
            self.ml.unpin('Remeza')
        with self.assertRaises(ValueError):
            self.ml.set('', base64.b64encode(png()).decode())


class MakerLogosRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=8, clients=1, kps=1)).start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_admin_route(self):
        http, maker = self.stand.http, SampleData.MAKERS[0]
        body = json.dumps({'maker': maker, 'image': base64.b64encode(png()).decode()}, ensure_ascii=False)
        st, _, _ = http.req('POST', '/api/admin/logos', body, headers={'Content-Type': 'application/json'})
        self.assertIn(st, (401, 403), 'без входа администратора')
        cookie, csrf = self.stand.admin()
        st, _, _ = http.req('POST', '/api/admin/logos', body, cookie=cookie, headers={'Content-Type': 'application/json'})
        self.assertIn(st, (401, 403), 'без токена CSRF')
        H = dict(csrf, **{'Content-Type': 'application/json'})
        st, b, _ = http.req('POST', '/api/admin/logos', json.dumps({'maker': maker, 'image': 'bm90IGltYWdl'}), cookie=cookie, headers=H)
        self.assertEqual(st, 400)
        self.assertIn('PNG', b)
        st, b, _ = http.req('POST', '/api/admin/logos', body, cookie=cookie, headers=H)
        self.assertEqual(st, 200, b)
        r = json.loads(b)
        self.assertEqual(r['items'], 2, 'позиции марки на стенде')
        st, b, _ = http.req('GET', '/img/' + r['logo']['src'][len('/img/'):])
        self.assertEqual(st, 200, 'файл логотипа отдаётся')
        st, b, _ = http.req('GET', '/api/logos')
        self.assertEqual(json.loads(b)[maker.lower()]['src'], r['logo']['src'])
        st, b, _ = http.req('GET', '/api/admin/logos', cookie=cookie, headers=csrf)
        row = next(x for x in json.loads(b)['items'] if x['maker'] == maker)
        self.assertTrue(row['pinned'])
        st, b, _ = http.req('POST', '/api/admin/logos', json.dumps({'maker': maker, 'unpin': True}, ensure_ascii=False), cookie=cookie, headers=H)
        self.assertEqual(st, 200, b)
        self.assertEqual(self.stand.request_errors(), [])


if __name__ == '__main__':
    unittest.main()
