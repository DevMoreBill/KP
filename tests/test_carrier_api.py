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
        CarrierApi.save(self.store, {'nrg': {'on': False}, 'pec': {'on': False}, 'jde': {'on': False}})
        pv = providers(self.store)
        self.assertFalse(pv['nrg'])
        self.assertFalse(pv['pec'])
        import logistics_api
        with mock.patch.object(logistics_api.Nrg, 'quote', side_effect=AssertionError('выключенная Энергия считала')), \
                mock.patch.object(logistics_api.Pec, 'quote', side_effect=AssertionError('выключенный ПЭК считал')):
            r = logistics_api.DeliveryQuote(self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Тверь'},
                                                         'places': [{'l': 1, 'w': 1, 'h': 1, 'm': 0.2}]}).run()
        self.assertFalse([e for e in r['errors'] if not e.get('skip')])

    def test_station_no_ltl(self):
        """Станция в сборе (ltl: false) — перевозчики сборного груза не спрашиваются (решение владельца 17.10)."""
        import logistics_api
        with mock.patch.object(logistics_api.DeliveryQuote, '_ltl', side_effect=AssertionError('спросили сборный груз')):
            r = logistics_api.DeliveryQuote(self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Тверь'}, 'ltl': False,
                                                         'places': [{'l': 6.06, 'w': 2.44, 'h': 2.59, 'm': 4.5}]}).run()
        self.assertTrue([e for e in r['errors'] if e.get('skip') and e['src'] == 'Сборный груз'])

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
        with mock.patch.object(logistics_api, 'http_json', side_effect=fake):
            self.assertEqual(logistics_api.Http.call('https://api2.nrg-tk.ru/v2/price', data={'a': 1}, method='POST'), {'ok': 1})
        self.assertEqual(calls[-1], ('https://api2.nrg-tk.pro/v2/price', 'POST'))
        e = urllib.error.HTTPError('https://vozovoz.ru/api/?token=SECRET123', 404, 'Not Found', Message(),
                                   io.BytesIO('Page not found: /api/?token=SECRET123abc&x=1'.encode()))
        msg = logistics_api.Http.error(e)
        self.assertNotIn('SECRET', msg)
        self.assertIn('token=***', msg)
        self.assertNotIn('SECRET', logistics_api.Http.error(ValueError('Возовоз: /api/?token=SECRET&appkey=SECRET2')))

    def test_dellin_next_workday(self):
        import logistics_api as lg
        from datetime import date
        sent = []

        def fake(url, data=None, headers=None, method=None):
            sent.append(data['delivery']['derival']['produceDate'])
            if len(sent) < 3:
                raise urllib.error.HTTPError(url, 400, 'Bad', Message(), io.BytesIO(
                    '{"errors":[{"detail":"Выбранная дата недоступна для выбранного адреса"}]}'.encode()))
            return {'data': {'price': 5000, 'orderDates': {}}}
        places = [{'l': 1, 'w': 1, 'h': 1, 'm': 0.2, 'qty': 1}]
        cal = mock.patch.object(lg.workcal, 'year', side_effect=lambda st, y: {'days': lg.workcal.approx(y)})   # без сети
        cal.start()
        self.addCleanup(cal.stop)
        with mock.patch.object(lg.Http, 'call', side_effect=fake):
            r = lg.Dellin.quote(self.store, {'addr': 'Москва'}, {'addr': 'Тверь'}, places)
        self.assertEqual(r['price'], 5000)
        days = [date.fromisoformat(x) for x in sent]
        self.assertEqual(len(days), 3)
        self.assertTrue(all(d.weekday() < 5 and d > date.today() for d in days), 'забор только в рабочие дни после сегодня')
        self.assertEqual(sorted(set(days)), days)
        sent.clear()

        def never(url, data=None, headers=None, method=None):        # ни одна дата не подходит
            sent.append(data['delivery']['derival']['produceDate'])
            raise urllib.error.HTTPError(url, 400, 'Bad', Message(), io.BytesIO(
                '{"errors":[{"detail":"Выбранная дата недоступна для выбранного адреса"}]}'.encode()))
        with mock.patch.object(lg.Http, 'call', side_effect=never):
            with self.assertRaises(ValueError) as cm:
                lg.Dellin.quote(self.store, {'addr': 'Москва'}, {'addr': 'Тверь'}, places)
        self.assertIn('проверьте адрес', str(cm.exception))
        self.assertEqual(len(sent), lg.Dellin.DATE_TRIES)

    def test_nrg_v2_retry_on_502(self):
        import logistics_api as lg
        lg.Nrg.RETRY_PAUSE, pause = 0, lg.Nrg.RETRY_PAUSE
        self.addCleanup(setattr, lg.Nrg, 'RETRY_PAUSE', pause)
        urls = []

        def fake(url, data=None, headers=None, method=None):
            urls.append(url)
            if len(urls) < 3:
                raise urllib.error.HTTPError(url, 502, 'Bad Gateway', Message(), io.BytesIO(b''))
            return {'ok': 1}
        with mock.patch.object(lg.Http, 'call', side_effect=fake):
            self.assertEqual(lg.Nrg._call(self.store, '/price', {'a': 1}), {'ok': 1})
        self.assertEqual(urls[:2], ['https://api2.nrg-tk.pro/v2/price', 'https://api2.nrg-tk.ru/v2/price'])

    def test_nrg_v4_with_token(self):
        """Токен разработчика — API v4 (документация Энергии): заголовок NrgApi-DevToken, POST /prices в рублях,
        места с isStandardSize; цена = перевозка + негабарит + забор + доставка + страхование."""
        import logistics_api as lg
        self.store.kv_set('integrations', {'nrgToken': 'TESTTOKEN123'})
        sent = []

        def fake(url, data=None, headers=None, method=None):
            sent.append((url, data, dict(headers or {})))
            if url.endswith('/cities?lang=ru'):
                return {'cityList': [{'id': 1, 'name': 'Москва'}, {'id': 2, 'name': 'Санкт-Петербург'}]}
            return {'places': 1, 'transfer': [{'typeId': 1, 'type': 'Авто', 'price': 10000, 'maxTransferTimeDays': 4,
                                               'oversize': {'price': 1500, 'priceExpress': 0}},
                                              {'typeId': 2, 'type': 'Авиа', 'price': 30000}],
                    'request': {'price': 800}, 'delivery': {'price': 700}, 'priceInsurance': 250}
        places = [{'l': 1.2, 'w': 0.8, 'h': 1, 'm': 0.3, 'qty': 1}]
        with mock.patch.object(lg.Http, 'call', side_effect=fake):
            r = lg.Nrg.quote(self.store, {'name': 'Москва'}, {'name': 'Санкт-Петербург'}, places, 100000)
        url, body, h = sent[-1]
        self.assertEqual(url, 'https://mainapi.nrg-tk.pro/api/v4/prices')
        self.assertEqual(h.get('NrgApi-DevToken'), 'TESTTOKEN123')
        self.assertEqual((body['idCityFrom'], body['idCityTo'], body['idCurrency'], body['cover']), (1, 2, 1, False))
        self.assertEqual(body['items'][0], {'weight': 300.0, 'width': 0.8, 'height': 1, 'length': 1.2, 'isStandardSize': False})
        self.assertEqual(r['price'], 10000 + 1500 + 800 + 700 + 250)
        self.assertEqual((r['ins'], r['days'], r['door']), (250, 4, True))

        def denied(url, data=None, headers=None, method=None):
            raise urllib.error.HTTPError(url, 401, 'Unauthorized', Message(), io.BytesIO(b'{"message":"Bad credentials"}'))
        with mock.patch.object(lg.Http, 'call', side_effect=denied):
            with self.assertRaises(ValueError) as cm:
                lg.Nrg._call(self.store, '/prices', {})
        self.assertIn('токен не принят', str(cm.exception))
        self.assertNotIn('TESTTOKEN', str(cm.exception))

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


class ChinaFreightTest(unittest.TestCase):
    """Доставка из Китая (app/china_freight.py): ставки экспедиторов — проверка ввода, пересчёт в рубли по курсу ЦБ,
    ставки за кг / м³; без ключа ATI.SU — понятная ошибка источника, а не сбой."""
    def setUp(self):
        from storage import Store
        self.tmp = tempfile.mkdtemp(prefix='kp-cn-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.store = Store(os.path.join(self.tmp, 'kp.sqlite3'))

    def test_rates_and_quote(self):
        from china_freight import ChinaFreight
        cf = ChinaFreight(self.store)
        cf.save_rates([{'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ftl', 'price': '4 500', 'cur': 'USD', 'unit': 'trip', 'days': '14', 'who': 'Экспедитор А'},
                       {'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ltl', 'price': '0,5', 'cur': 'CNY', 'unit': 'kg', 'who': 'Экспедитор Б'}], 'admin')
        fx = {'USD': 90.0, 'CNY': 12.5, 'EUR': 100.0, 'date': '2026-10-14'}
        r = cf.quote({'from': 'шанхай', 'to': 'Забайкальск', 'kind': 'ftl'}, fx)
        self.assertEqual([o['rub'] for o in r['offers']], [405000])
        self.assertEqual(r['offers'][0]['days'], 14)
        self.assertTrue(any(e['src'] == 'ATI.SU' and 'ключ' in e['msg'] for e in r['errors']))      # без ключа ATI.SU
        r = cf.quote({'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ltl', 'kg': '1200'}, fx)
        self.assertEqual(r['offers'][0]['rub'], 7500)                                              # 0,5 CNY × 1200 кг × 12,5
        r = cf.quote({'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ltl'}, fx)                   # нет веса — подсказка
        self.assertFalse(r['offers'])
        self.assertIn('вес', r['errors'][0]['msg'])
        r = cf.quote({'from': 'Пекин', 'to': 'Забайкальск', 'kind': 'docker'}, fx)
        self.assertFalse(r['offers'])
        with self.assertRaises(ValueError):
            cf.quote({'from': '', 'to': 'Забайкальск', 'kind': 'ftl'}, fx)

    def test_customs_value(self):
        """Таможенная стоимость (ТК ЕАЭС ст. 40, решение владельца 17.10): участки, условия поставки, сборный груз,
        срок действия, сравнение с рынком."""
        from unittest import mock
        from china_freight import ChinaFreight
        cf = ChinaFreight(self.store)
        cf.save_rates([
            {'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ftl', 'scope': 'border', 'price': '20000', 'cur': 'CNY', 'unit': 'trip', 'who': 'А', 'until': '2026-12-31'},
            {'from': 'Шанхай', 'to': 'Москва', 'kind': 'ftl', 'scope': 'through', 'price': '40000', 'cur': 'CNY', 'unit': 'trip', 'who': 'Б'},
            {'from': 'Забайкальск', 'to': 'Москва', 'kind': 'ftl', 'scope': 'after', 'price': '150000', 'cur': 'RUB', 'unit': 'trip', 'who': 'А'},
            {'from': 'Иу', 'to': 'Достык (Казахстан)', 'kind': 'ltl', 'price': '2', 'cur': 'CNY', 'unit': 'kg', 'min': '3000', 'who': 'В', 'until': '2026-01-01'},
            {'from': 'Иу', 'to': 'Достык (Казахстан)', 'kind': 'ltl', 'price': '500', 'cur': 'CNY', 'unit': 'm3', 'who': 'В'}], 'admin')
        fx = {'USD': 90.0, 'CNY': 12.5, 'EUR': 100.0, 'date': '2026-10-17'}
        q = {'from': 'Шанхай', 'to': 'Забайкальск', 'dest': 'Москва', 'kind': 'ftl', 'terms': 'EXW',
             'extra': {'v': '2000', 'cur': 'CNY'}, 'ins': {'v': '1000', 'cur': 'CNY'}}
        r = cf.quote(q, fx, today='2026-10-17')
        by = {o['src']: o for o in r['offers']}
        self.assertEqual(by['А']['cv'], 250000 + 25000 + 12500, 'EXW: перевозка + расходы в Китае + страхование')
        self.assertEqual(by['Б']['cv'], 500000 + 37500)
        self.assertTrue(any('вся сумма войдёт' in w for w in by['Б']['warn']), 'сквозная ставка — предупреждение')
        self.assertEqual([o['rub'] for o in r['after']], [150000], 'по РФ — отдельно, не в таможенную стоимость')
        r = cf.quote(dict(q, terms='CPT'), fx, today='2026-10-17')
        self.assertEqual({o['src']: o['cv'] for o in r['offers']}['А'], 12500, 'CPT: перевозка уже в цене, только страхование')
        r = cf.quote(dict(q, terms='CIP'), fx, today='2026-10-17')
        self.assertEqual({o['src']: o['cv'] for o in r['offers']}['А'], 0)
        # сборный груз: большее из «за кг» и «за м³», не меньше минимальной; просроченная ставка; Достык = «Достык (Казахстан)»
        r = cf.quote({'from': 'Иу', 'to': 'Достык', 'kind': 'ltl', 'kg': '1000', 'm3': '5'}, fx, today='2026-10-17')
        o = r['offers'][0]
        self.assertEqual(o['amount'], 3000, 'max(2000 кг, 2500 м³, мин. 3000)')
        self.assertTrue(any('просрочена' in w for w in o['warn']))
        r = cf.quote({'from': 'Иу', 'to': 'Достык (Казахстан)', 'kind': 'ltl', 'kg': '2000', 'm3': '5'}, fx, today='2026-10-17')
        self.assertEqual(r['offers'][0]['amount'], 4000)
        self.assertTrue(r['kz'])
        # рынок: отличие больше 30 % — предупреждение
        with mock.patch.object(ChinaFreight, '_ati', return_value=({'rub': 150000, 'avgRub': None, 'note': ''}, None)):
            r = cf.quote(q, fx, today='2026-10-17')
        self.assertTrue(any('рынка на 67' in w for w in {o['src']: o for o in r['offers']}['А']['warn']))
        js = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'web', 'js', 'features', 'logistics-calc.js'), encoding='utf-8').read()
        key, b0, lo, hi = ChinaFreight.DEV
        self.assertIn("['%s', 'logAti'" % key, js)
        self.assertIn("'num', '%d', {unit:'%%', req:true, min:%d, max:%d" % (b0, lo, hi), js, 'встроенное и пределы — как в «Значениях программы»')
        with self.assertRaises(ValueError):
            cf.quote(dict(q, terms='XXX'), fx)
        with self.assertRaises(ValueError):
            cf.save_rates([{'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ftl', 'price': '1', 'until': '31.12'}])

    def test_rate_file_js(self):
        """Ставки файлом и запрос экспедитору (ChinaRateBook в admin/china-rates.js): node tests/js/china_rates.js."""
        import subprocess
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
        r = subprocess.run([node, os.path.join(repo, 'tests', 'js', 'china_rates.js')], cwd=repo, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-4000:])

    def test_reference_rates(self):
        """Ориентиры из открытых данных (файл поставки): у каждой строки источник-ссылка; сохраняются с пометкой «ориентир»,
        в расчёте — предупреждение «не ставка по договору»."""
        from china_freight import ChinaFreight
        ref = ChinaFreight.ref()
        self.assertGreaterEqual(len(ref['rows']), 5)
        for r in ref['rows']:
            self.assertTrue(r['src'].startswith('https://') and r['who'].startswith('Ориентир'), r)
        cf = ChinaFreight(self.store)
        cf.save_rates([dict(r, ref='1', until='2026-11-16') for r in ref['rows']], 'admin')
        self.assertTrue(all(r['ref'] for r in cf.rates()['rows']))
        fx = {'USD': 90.0, 'CNY': 12.5, 'EUR': 100.0, 'date': '2026-10-17'}
        r = cf.quote({'from': 'Иу', 'to': 'Забайкальск', 'dest': 'Москва', 'kind': 'ltl', 'kg': '300', 'm3': '2'}, fx, today='2026-10-17')
        o = r['offers'][0]
        self.assertEqual(o['amount'], 730, 'Free Lines: max(1,22 × 300, 365 × 2, мин. 365) = 730 $')
        self.assertTrue(any('ориентир' in w for w in o['warn']) and o['srcUrl'].startswith('https://'))
        with self.assertRaises(ValueError):
            cf.save_rates([dict(ref['rows'][0], src='javascript:alert(1)')])

    def test_bad_rates(self):
        from china_freight import ChinaFreight
        cf = ChinaFreight(self.store)
        base = {'from': 'Шанхай', 'to': 'Забайкальск', 'kind': 'ftl', 'price': '100', 'cur': 'USD', 'unit': 'trip'}
        for bad in (dict(base, price='0'), dict(base, price='abc'), dict(base, kind='ship'), dict(base, cur='GBP'), dict(base, unit='km'),
                    dict(base, **{'from': ''}), dict(base, days='999'), dict(base, note='x' * 300)):
            with self.assertRaises(ValueError, msg=str(bad)[:80]):
                cf.save_rates([bad])
        with self.assertRaises(ValueError):
            cf.save_rates('x')
        with self.assertRaises(ValueError):
            cf.save_rates([base] * 301)
        self.assertEqual(cf.rates(), {'rows': []})


class JdeTest(unittest.TestCase):
    """ЖелДорЭкспедиция: справочник филиалов, длина места с запятой (иначе сервер ЖДЭ отвечает ошибкой), страхование и
    оформление — сверх price; крупногабаритный груз (больше пределов сборного) считает только ЖДЭ, остальные — нет."""
    def setUp(self):
        from storage import Store
        self.tmp = tempfile.mkdtemp(prefix='kp-jde-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.store = Store(os.path.join(self.tmp, 'kp.sqlite3'))

    def fake(self, url, data=None, headers=None, method=None):
        import urllib.parse as up
        self.urls.append(url)
        if '/geo/search' in url:
            return [{'code': '11', 'city': 'Москва', 'mst_pr_aex': '1', 'max_l_gm': '12'}, {'code': '12', 'city': 'Москва', 'mst_pr_aex': '0', 'max_l_gm': '0'},
                    {'code': '21', 'city': 'Казань', 'mst_pr_aex': '1', 'max_l_gm': '15'}]
        q = dict(up.parse_qsl(up.urlsplit(url).query))
        if '.' in q.get('max_length_gab', ''):
            return {'error': "'9.2' is not a valid floating point value for Double type"}
        return {'type': '1', 'result': '1', 'price': '400000', 'price_cargins': '12500', 'price_doc': '150', 'price_mark': '7', 'mindays': '2', 'maxdays': '4',
                'services': [{'item': 'pickup', 'price': '1'}, {'item': 'terminal', 'price': '1'}, {'item': 'delivery', 'price': '1'}]}

    def test_big_cargo(self):
        import logistics_api as lg
        self.urls = []
        with mock.patch.object(lg.Http, 'call', side_effect=self.fake), \
                mock.patch.object(lg.Pec, 'quote', side_effect=AssertionError('ПЭК не берёт крупногабарит')), \
                mock.patch.object(lg.Nrg, 'quote', side_effect=AssertionError('Энергия не берёт крупногабарит')):
            r = lg.DeliveryQuote(self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Казань'}, 'places': [{'l': 9.2, 'w': 2.4, 'h': 2.5, 'm': 8}], 'declared': 5000000}).run()
        o = next(x for x in r['offers'] if x['src'] == 'ЖелДорЭкспедиция')
        self.assertEqual(o['price'], 412657)                       # 400 000 + страхование 12 500 + документы 150 + маркировка 7
        self.assertEqual(o['ins'], 12500)
        self.assertTrue(o['door'])
        self.assertEqual(o['days'], 4)
        self.assertIn('крупногабарит', o['note'])
        calc = next(u for u in self.urls if '/calculator/price' in u)
        self.assertIn('from=11', calc)                             # филиал с забором груза
        self.assertIn('max_length_gab=9%2C2', calc)
        self.assertIn('insValue=5000000', calc)
        skip = next(e for e in r['errors'] if e.get('skip'))
        self.assertIn('ЖелДорЭкспедиция', skip['msg'])

    def test_heavier_than_20t(self):
        import logistics_api as lg
        self.urls = []
        with mock.patch.object(lg.Http, 'call', side_effect=self.fake):
            r = lg.DeliveryQuote(self.store, {'from': {'name': 'Москва'}, 'to': {'name': 'Казань'}, 'places': [{'l': 6, 'w': 2.4, 'h': 2.5, 'm': 11, 'qty': 2}]}).run()
        self.assertFalse([o for o in r['offers'] if o['src'] == 'ЖелДорЭкспедиция'])
        self.assertFalse(self.urls)                                # тяжелее 20 т — ЖДЭ не спрашивают


if __name__ == '__main__':
    unittest.main()
