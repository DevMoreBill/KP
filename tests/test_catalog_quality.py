# -*- coding: utf-8 -*-
"""Качество карточек каталога (catalog_quality.py): у основного оборудования обязательны категория, производитель, модель,
своё главное фото и ключевые характеристики категории — иначе сервер не сохраняет; опции, станции и запчасти — без требований;
правка прежней карточки не должна опустошать заполненное. Возможный дубль (та же модель того же производителя или почти то же
название) уходит на модерацию даже при выключенной модерации и праве «без модерации»; администратор сохраняет сразу.
Выключатель «catQuality» снимает обе проверки."""
import json
import unittest

from kit import Http, SampleData, Stand, TempStore

PHOTO = {'src': '/img/compressors/test/a.jpg'}


def card(**over):
    """Полная карточка винтового компрессора (ключевые: производительность, давление, мощность)."""
    attrs = {'cat': 'comp_screw', 'maker': 'НовыйЗавод', 'model': 'NZ-75 Plus', 'flow': 10.5, 'pressure': 8, 'kw': 55}
    attrs.update(over.pop('attrs', {}))
    doc = {'name': 'Винтовой компрессор НовыйЗавод NZ-75 Plus', 'price': 1000000, 'attrs': attrs, 'photo': PHOTO}
    doc.update(over)
    return doc


class UnitTest(unittest.TestCase):
    def setUp(self):
        from catalog_quality import CardRules
        from equipment_types import load_types_builtin
        self.rules = CardRules(load_types_builtin())

    def test_required_for_main_equipment(self):
        self.assertEqual(self.rules.missing(card()), [])
        gaps = self.rules.missing(card(photo=None, attrs={'maker': '', 'pressure': None}))
        self.assertEqual(gaps, ['производитель', 'рабочее давление', 'главное фото'])
        self.assertIn('главное фото', self.rules.missing(card(photoFrom={'name': 'чужая'})), 'фото похожей модели — не своё')
        self.assertIn('категория', self.rules.missing({'name': 'Что-то', 'attrs': {}}), 'без категории — требуется категория')

    def test_no_requirements_for_options_kits_accessories(self):
        self.assertEqual(self.rules.missing({'name': 'Опция', 'kind': 'option'}), [])
        self.assertEqual(self.rules.missing({'name': 'Станция', 'kit': {'parts': []}, 'attrs': {'cat': 'st_comp'}}), [])
        self.assertEqual(self.rules.missing({'name': 'Фильтрующий элемент', 'attrs': {'cat': 'spare'}}), [])

    def test_editing_old_card_does_not_demand_more(self):
        old = card(photo=None, attrs={'kw': None})
        self.assertEqual(self.rules.check(old, dict(old, price=5)), [], 'прежние пробелы не мешают править цену')
        emptied = card(photo=None, attrs={'kw': None, 'flow': ''})
        self.assertEqual(self.rules.check(old, emptied), ['производительность'], 'опустошать заполненное нельзя')
        self.assertEqual(self.rules.check(old, card(photo=None, attrs={'cat': 'dgu', 'kw': None})), [],
                         'перенос в другую категорию (в том числе пакетно) — без новых требований')
        self.assertEqual(self.rules.check(old, card(photo=None, attrs={'cat': 'dgu', 'kw': None, 'maker': ''})), ['производитель'])
        self.assertEqual(self.rules.check(card(), card(photo=None)), ['главное фото'], 'убрать фото нельзя')

    def test_duplicates(self):
        from catalog_quality import DupFinder
        st = TempStore(self).store
        st.catalog_put('a1', json.dumps(card(), ensure_ascii=False))
        st.catalog_put('a2', json.dumps(card(name='Дизель-генератор Другой АД-100', attrs={'cat': 'dgu', 'maker': 'Другой', 'model': 'АД-100'}), ensure_ascii=False))
        finder = DupFinder(st)
        same_model = finder.find(card(name='Компрессор совсем другой', attrs={'model': 'nz75plus'}), 'new')
        self.assertEqual([(d['id'], d['why']) for d in same_model], [('a1', 'та же модель')])
        other_maker = finder.find(card(name='Компрессор X', attrs={'model': 'NZ-75 Plus', 'maker': 'Иной'}), 'new')
        self.assertEqual(other_maker, [], 'та же модель у другого производителя — не дубль')
        by_name = finder.find(card(name='Винтовой компрессор  НовыйЗавод NZ-75 Plus.', attrs={'model': 'X1'}), 'new')
        self.assertEqual([d['why'] for d in by_name], ['похожее название'])
        words = finder.find(card(name='НовыйЗавод NZ-75 Plus Винтовой компрессор', attrs={'model': 'X2'}), 'new')
        self.assertEqual([d['id'] for d in words], ['a1'], 'те же слова в другом порядке')
        self.assertEqual(finder.find(card(), 'a1'), [], 'сама с собой — не дубль')
        self.assertTrue(DupFinder.changed(None, card()))
        self.assertFalse(DupFinder.changed(card(), card(price=5)))
        self.assertTrue(DupFinder.changed(card(), card(attrs={'model': 'NZ-90'})))


class ServerTest(unittest.TestCase):
    PW = {'m1': 'pass-q-m1-52'}
    H = {'Content-Type': 'application/json'}

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=12, clients=2, kps=0)).start()
        cls.http = cls.stand.http
        cls.adm, cls.A = cls.stand.admin()
        cls.M1 = SampleData.MANAGERS[0]

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def admin(self, method, path, body=None):
        st, b, _ = self.http.req(method, path, body, cookie=self.adm, headers=dict(self.A, **self.H))
        return st, (Http.js(b) if st == 200 else b)

    def put(self, cid, doc, cookie=None):
        st, b, _ = self.http.req('PUT', '/api/catalog/' + cid, doc, cookie=cookie, headers=self.H)
        return st, (Http.js(b) if st == 200 else b.decode('utf-8') if isinstance(b, bytes) else b)

    def features(self, on):
        self.assertEqual(self.admin('POST', '/api/admin/features', {'values': {'catQuality': on}})[0], 200)

    def test_1_incomplete_refused_for_everyone(self):
        st, text = self.put('q-new-1', card(photo=None))
        self.assertEqual(st, 400)
        self.assertIn('главное фото', text)
        st, _, _ = self.http.req('PUT', '/api/catalog/q-new-1', card(photo=None), cookie=self.adm, headers=dict(self.A, **self.H))
        self.assertEqual(st, 400, 'и администратору')
        st, body = self.put('q-opt-1', {'name': 'Опция без фото', 'kind': 'option'})
        self.assertEqual(st, 200, 'опция — без требований')
        st, body = self.http.req('POST', '/api/catalog/check', {'id': 'q-new-1', 'doc': card(photo=None)}, headers=self.H)[:2]
        self.assertEqual(st, 200)
        self.assertEqual(Http.js(body)['missing'], ['главное фото'])

    def test_2_duplicate_goes_to_moderation(self):
        self.assertEqual(self.admin('POST', '/api/admin/moderation', {'enabled': False})[0], 200)
        st, body = self.put('q-orig', card())
        self.assertEqual((st, body.get('pending')), (200, None), 'первая — сразу в каталог')
        st, body = self.put('q-copy', card(name='Компрессор винтовой NZ 75 plus', attrs={'model': 'NZ75PLUS'}))
        self.assertEqual(st, 200)
        self.assertTrue(body['pending'], 'дубль — на модерацию при выключенной модерации')
        self.assertEqual(body['dups'][0]['id'], 'q-orig')
        self.assertEqual(self.http.req('GET', '/api/catalog/q-copy')[0], 404, 'в каталог не попала')
        check = Http.js(self.http.req('POST', '/api/catalog/check', {'id': 'q-copy', 'doc': card(attrs={'model': 'NZ75PLUS'})}, headers=self.H)[1])
        self.assertEqual(check['dups'][0]['why'], 'та же модель')
        st, b, _ = self.http.req('PUT', '/api/catalog/q-adm', card(attrs={'model': 'NZ75PLUS'}), cookie=self.adm, headers=dict(self.A, **self.H))
        self.assertEqual((st, Http.js(b).get('pending')), (200, None), 'администратор — сразу')
        st, body = self.put('q-orig', dict(card(), price=2000000))
        self.assertEqual((st, body.get('pending')), (200, None), 'правка цены своей карточки — не дубль')

    def test_3_self_moderation_right_does_not_skip_duplicates(self):
        st, b = self.admin('POST', '/api/admin/access/' + self.M1[0], {'login': 'm1', 'password': self.PW['m1'], 'perms': {'catSelfMod': True, 'catAdd': True, 'catEdit': True}})
        self.assertEqual(st, 200, b)
        st, b, hd = self.http.req('POST', '/api/auth/login', {'login': 'm1', 'password': self.PW['m1']})
        if st != 200:
            self.skipTest('вход менеджеров на стенде выключен')
        cookie = Http.cookie(hd)
        st, body = self.put('q-m1', card(name='Винтовой компрессор НовыйЗавод NZ-75 Plus'), cookie)
        self.assertEqual(st, 200)
        self.assertTrue(body['pending'], 'право «без модерации» не пропускает дубль')

    def test_5_new_item_from_saved_kp_goes_to_moderation(self):
        st, b, _ = self.http.req('PUT', '/api/catalog/q-kp-auto', card(photo=None, attrs={'model': 'KP-1'}),
                                 headers=dict(self.H, **{'X-KP-Edit': 'auto'}))
        self.assertEqual(st, 200, 'сохранение КП не ломается')
        self.assertTrue(Http.js(b)['pending'], 'неполная позиция из КП — на модерацию, не в каталог')
        self.assertEqual(self.http.req('GET', '/api/catalog/q-kp-auto')[0], 404)

    def test_4_switch_off(self):
        self.features(False)
        try:
            st, body = self.put('q-off', card(photo=None, attrs={'model': 'NZ75PLUS'}))
            self.assertEqual((st, body.get('pending')), (200, None), 'выключено — как раньше')
        finally:
            self.features(True)


if __name__ == '__main__':
    unittest.main()
