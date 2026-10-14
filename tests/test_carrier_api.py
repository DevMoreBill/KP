# -*- coding: utf-8 -*-
"""Перевозчики (app/logistics_api.py, CarrierApi): включение и адреса API из «Настроек», проверка адреса (только https и
имя сайта), возврат к адресу программы, выключенный перевозчик не считает; запрос идёт за перенаправлением 307 (Энергия
переехала на api2.nrg-tk.pro); токен в тексте ошибки скрыт. Обновления: последний выпуск через страницу github.com,
когда API GitHub не ответил (app_update.ReleaseSource). Без сети — ответы подменяются."""
import io
import os
import shutil
import tempfile
import unittest
import urllib.error
from email.message import Message
from unittest import mock

from kit import APP  # пути к app/
assert APP


class CarrierApiTest(unittest.TestCase):
    def setUp(self):
        from storage import Store
        self.tmp = tempfile.mkdtemp(prefix='kp-car-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.store = Store(os.path.join(self.tmp, 'kp.sqlite3'))

    def test_defaults_and_save(self):
        from logistics_api import CarrierApi
        self.assertEqual(CarrierApi.url(self.store, 'vozovoz', 'url'), 'https://vozovoz.ru/api/')
        self.assertEqual(CarrierApi.url(self.store, 'nrg', 'base'), 'https://api2.nrg-tk.pro/v2')
        CarrierApi.save(self.store, {'vozovoz': {'urls': {'url': 'https://api.vozovoz.ru/v3/'}}}, 'admin')
        self.assertEqual(CarrierApi.url(self.store, 'vozovoz', 'url'), 'https://api.vozovoz.ru/v3/')
        row = next(c for c in CarrierApi.public(self.store)['carriers'] if c['id'] == 'vozovoz')
        self.assertEqual(row['fields'][0]['value'], 'https://api.vozovoz.ru/v3/')
        self.assertEqual(row['by'], 'admin')
        CarrierApi.save(self.store, {'vozovoz': {'urls': {'url': ''}}})          # пусто — адрес программы
        self.assertEqual(CarrierApi.url(self.store, 'vozovoz', 'url'), 'https://vozovoz.ru/api/')

    def test_bad_input(self):
        from logistics_api import CarrierApi
        for bad in ('http://vozovoz.ru/api/', 'https://127.0.0.1/api', 'https://localhost/api', 'ftp://x.ru', 'https://vozovoz.ru/a b',
                    'https://' + 'a' * 300 + '.ru'):
            with self.assertRaises(ValueError, msg=bad):
                CarrierApi.save(self.store, {'vozovoz': {'urls': {'url': bad}}})
        for bad in ({'nope': {}}, {'vozovoz': {'urls': {'evil': 'https://x.ru'}}}, {'vozovoz': 'x'}, ['x']):
            with self.assertRaises(ValueError):
                CarrierApi.save(self.store, bad)
        self.assertEqual(CarrierApi.url(self.store, 'vozovoz', 'url'), 'https://vozovoz.ru/api/')

    def test_off_carrier_not_used(self):
        from logistics_api import CarrierApi, providers
        self.assertTrue(providers(self.store)['nrg'])
        CarrierApi.save(self.store, {'nrg': {'on': False}, 'pec': {'on': False}})
        pv = providers(self.store)
        self.assertFalse(pv['nrg'])
        self.assertFalse(pv['pec'])
        import logistics_api
        with mock.patch.object(logistics_api, 'nrg_quote', side_effect=AssertionError('выключенная Энергия считала')), \
                mock.patch.object(logistics_api, 'pec_quote', side_effect=AssertionError('выключенный ПЭК считал')):
            r = logistics_api.quote(self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Тверь'},
                                                 'places': [{'l': 1, 'w': 1, 'h': 1, 'm': 0.2}]})
        self.assertFalse([e for e in r['errors'] if not e.get('skip')])

    def test_redirect_307_and_hidden_token(self):
        import logistics_api
        calls = []

        def fake(url, data=None, headers=None, method=None):
            calls.append((url, method))
            if 'nrg-tk.ru' in url:
                h = Message()
                h['Location'] = 'https://api2.nrg-tk.pro/v2/price'
                raise urllib.error.HTTPError(url, 307, 'Temporary Redirect', h, io.BytesIO(b''))
            return {'ok': 1}
        with mock.patch.object(logistics_api, '_http', side_effect=fake):
            self.assertEqual(logistics_api._call('https://api2.nrg-tk.ru/v2/price', data={'a': 1}, method='POST'), {'ok': 1})
        self.assertEqual(calls[-1], ('https://api2.nrg-tk.pro/v2/price', 'POST'))
        e = urllib.error.HTTPError('https://vozovoz.ru/api/?token=SECRET123', 404, 'Not Found', Message(),
                                   io.BytesIO('Page not found: /api/?token=SECRET123abc&x=1'.encode()))
        msg = logistics_api._err(e)
        self.assertNotIn('SECRET', msg)
        self.assertIn('token=***', msg)
        self.assertNotIn('SECRET', logistics_api._err(ValueError('Возовоз: /api/?token=SECRET&appkey=SECRET2')))

    def test_test_without_key(self):
        from logistics_api import CarrierApi
        r = CarrierApi.test(self.store, 'vozovoz')
        self.assertFalse(r['ok'])
        self.assertIn('ключ не задан', r['msg'])
        with self.assertRaises(ValueError):
            CarrierApi.test(self.store, 'nope')


class ReleaseWebFallback(unittest.TestCase):
    def test_latest_from_github_page(self):
        import app_update

        class R:
            def __init__(self, url):
                self.url = url

            def geturl(self):
                return self.url

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        src = app_update.ReleaseSource('DevMoreBill/KP')
        with mock.patch.object(src, '_open', side_effect=app_update.UpdateError('404')), \
                mock.patch('urllib.request.urlopen', return_value=R('https://github.com/DevMoreBill/KP/releases/tag/v3.90.0')):
            rel = src.latest()
        self.assertEqual(rel['version'], '3.90.0')
        self.assertEqual(rel['asset']['url'], 'https://github.com/DevMoreBill/KP/releases/download/v3.90.0/KP-Obnovlenie-3.90.0.zip')
        with self.assertRaises(app_update.UpdateError):
            src.download({'id': 0, 'url': 'https://evil.example.com/x.zip'})
        tok = app_update.ReleaseSource('DevMoreBill/KP', 'tkn')        # с токеном — обходного пути нет, ошибка как есть
        with mock.patch.object(tok, '_open', side_effect=app_update.UpdateError('не найден')):
            with self.assertRaises(app_update.UpdateError):
                tok.latest()


if __name__ == '__main__':
    unittest.main()
