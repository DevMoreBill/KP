# -*- coding: utf-8 -*-
"""Цены перевозчиков для расчёта доставки по России и автообновление ставок.

Источники (ключи — «Интеграции» в программе, хранятся в базе, kv «integrations»):
  ATI.SU «Средние ставки» (atiToken, платная лицензия «API Средних ставок»)
      https://api.ati.su/priceline/license/v2/all_directions   — направления (FromCityId, FromCity, ToCityId, ToCity)
      https://api.ati.su/priceline/license/v2/average_prices   — средняя ставка и разброс: ₽/км и за рейс (PricesInRub:
      UpperPrice / BottomPrice / AveragePrice). Берём верхнюю границу — отдельная машина (FTL).
  ПЭК — открытый калькулятор без ключа (сборный груз, терминал — терминал)
      https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php, города — https://pecom.ru/ru/calc/towns.php
  Деловые Линии (dellinKey — appkey, бесплатно после регистрации на dev.dellin.ru)
      https://api.dellin.ru/v2/calculator.json — сборный груз от адреса до адреса
  КИТ (kitToken — Bearer, личный кабинет tk-kit.ru)
      https://capi.tk-kit.com/2.0/order/calculate (тариф 01 «Стандарт», забор и доставка), города — /1.1/tdd/city/get-list
      и /1.1/tdd/search/by-name; ошибки: 401 — токен, 429 — лимит по токену, 422 — поля
  Энергия, СДЭК, Возовоз, ЖелДорЭкспедиция — адреса и документация в CarrierApi.LIST.

Итог расчёта — максимальное из полных предложений (включая расчёт по тарифам «Настроек») со сноской, откуда цена.
Ответы сервисов разбираются терпимо к мелким отличиям формата; ошибка сервиса показывается как есть и не мешает остальным.
"""
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
from datetime import date, datetime, timedelta

import defaults
from counterparty import http_json

# защита сайтов СДЭК и Энергии отклоняет (403) запросы с «неизвестным» браузером — представляемся обычным
BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
# коды ответов сервисов → понятное объяснение (сам код — в скобках)
HTTP_WHY = {400: 'сервис не принял запрос', 401: 'ключ не принят — проверьте «Настройки → Ключи API»', 403: 'сервис отклонил запрос (защита сайта или доступ по ключу)',
            404: 'адрес сервиса изменился или токен не подходит к этому адресу — проверьте «Настройки → Внешние сервисы → Перевозчики: адреса API» и ключ', 429: 'исчерпан лимит запросов — повторите позже', 500: 'ошибка на стороне сервиса',
            502: 'сервис временно недоступен', 503: 'сервис временно недоступен', 504: 'сервис не ответил вовремя'}

# опорные направления автообновления ставок ₽/км (администратор может задать свои)
REF_ROUTES = ['Москва — Санкт-Петербург', 'Москва — Казань', 'Москва — Екатеринбург', 'Москва — Краснодар', 'Москва — Новосибирск']


class LtlLimits:
    """Сборный груз: место не тяжелее и не больше — иначе только отдельной машиной. Пределы правит администратор
    («Настройки → Значения программы → Логистика»; описание — LgValues в app/web/js/features/logistics-calc.js):
    в килограммах и миллиметрах, для расчёта — в тоннах и метрах. Встроенные значения — как в logistics-calc.js."""
    # поле → (ключ «Значений программы», встроенное в кг / мм, наименьшее, наибольшее)
    KEYS = {'m': ('log.ltlKg', 3000, 100, 20000), 'l': ('log.ltlL', 6000, 1000, 13600), 'w': ('log.ltlW', 2400, 500, 2550),
            'h': ('log.ltlH', 2500, 500, 3000), 'total': ('log.ltlTotal', 20000, 1000, 40000)}
    ATI_DAYS = ('log.atiDays', 30, 7, 90)

    @classmethod
    def get(cls, store=None):
        """{'m': т, 'l': м, 'w': м, 'h': м, 'total': т}"""
        return {k: (defaults.num(store, key, b, lo, hi) if store is not None else b) / 1000.0 for k, (key, b, lo, hi) in cls.KEYS.items()}

    @classmethod
    def ati_days(cls, store=None):
        key, b, lo, hi = cls.ATI_DAYS
        return int(defaults.num(store, key, b, lo, hi)) if store is not None else b

    @classmethod
    def fits(cls, places, store=None):
        """(можно ли сборным грузом, почему нет): каждое место и весь груз — в пределах."""
        units = Carrier.units(places)
        if not units:
            return False, 'нет груза'
        lim = cls.get(store)
        eps = 1e-9
        big = [u for u in units if u['m'] > lim['m'] + eps or max(u['l'], u['w']) > lim['l'] + eps or min(u['l'], u['w']) > lim['w'] + eps
               or u['h'] > lim['h'] + eps]
        kg = lambda t: '{:,.0f}'.format(t * 1000).replace(',', ' ')      # т → кг, м → мм
        if big:
            return False, 'есть место тяжелее %s кг или больше %s × %s × %s мм — сборным грузом не принимают' % (kg(lim['m']), kg(lim['l']), kg(lim['w']), kg(lim['h']))
        if sum(u['m'] for u in units) > lim['total'] + eps:
            return False, 'груз тяжелее %s кг — нужна отдельная машина' % kg(lim['total'])
        return True, ''


class CarrierApi:
    """Перевозчики: включение и адреса API — правит администратор («Настройки → Внешние сервисы → Перевозчики: адреса API»).
    Перевозчик сменил адрес — новый вписывается в «Настройках», без выпуска программы. Сам разбор запроса и ответа —
    в функциях перевозчиков ниже (исполняемый код из «Настроек» не принимается — это дыра в безопасности)."""
    KV = 'carrierApi'
    # (код, название, сайт с документацией API, ((поле, подпись, адрес по умолчанию), …))
    LIST = (
        ('ati', 'ATI.SU «Средние ставки»', 'https://ati.su/developers', (('base', 'Адрес API', 'https://api.ati.su/priceline/license/v2'),)),
        ('pec', 'ПЭК', 'https://pecom.ru/business/developers/', (('calc', 'Расчёт стоимости', 'https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php'),
                                                                  ('towns', 'Справочник городов', 'https://pecom.ru/ru/calc/towns.php'))),
        ('dellin', 'Деловые Линии', 'https://dev.dellin.ru/api/', (('calc', 'Расчёт стоимости', 'https://api.dellin.ru/v2/calculator.json'),)),
        ('nrg', 'Энергия', 'https://api2.nrg-tk.ru/', (('base', 'Адрес API', 'https://api2.nrg-tk.pro/v2'),
                                                        ('reserve', 'Резервный адрес', 'https://api2.nrg-tk.ru/v2'))),
        ('cdek', 'СДЭК', 'https://api-docs.cdek.ru/', (('base', 'Адрес API', 'https://api.cdek.ru/v2'),)),
        ('vozovoz', 'Возовоз', 'https://github.com/vozovoz/apiv2', (('url', 'Адрес API', 'https://vozovoz.ru/api/'),)),
        ('kit', 'КИТ', 'https://tk-kit.ru/developers', (('base', 'Адрес API', 'https://capi.tk-kit.com'),)),
        ('jde', 'ЖелДорЭкспедиция', 'https://api.jde.ru/dev/', (('base', 'Адрес API', 'https://api.jde.ru/vD'),)),
    )
    # только https и имя сайта (не IP и не localhost): адрес уходит в запрос сервера
    URL = re.compile(r'^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(:\d{2,5})?(/[^\s<>"\'\\]*)?$')

    @classmethod
    def _raw(cls, store):
        s = store.kv_get(cls.KV) if store is not None else None
        return s if isinstance(s, dict) else {}

    @classmethod
    def _default(cls, cid, field):
        for c, _n, _d, fields in cls.LIST:
            if c == cid:
                for f, _l, url in fields:
                    if f == field:
                        return url
        raise KeyError(cid + '.' + field)

    @classmethod
    def url(cls, store, cid, field):
        own = ((cls._raw(store).get(cid) or {}).get('urls') or {}).get(field)
        return own if own and cls.URL.match(own) else cls._default(cid, field)

    @classmethod
    def on(cls, store, cid):
        return (cls._raw(store).get(cid) or {}).get('on', True) is not False

    @classmethod
    def public(cls, store):
        raw = cls._raw(store)
        return {'carriers': [{'id': c, 'name': n, 'docs': d, 'on': cls.on(store, c), 'at': (raw.get(c) or {}).get('at'), 'by': (raw.get(c) or {}).get('by'),
                              'fields': [{'id': f, 'label': lb, 'default': url, 'value': ((raw.get(c) or {}).get('urls') or {}).get(f) or ''}
                                         for f, lb, url in fs]} for c, n, d, fs in cls.LIST]}

    @classmethod
    def save(cls, store, d, by=''):
        """d: {код: {on: bool, urls: {поле: адрес или '' — по умолчанию}}}; неизвестное — ошибка."""
        if not isinstance(d, dict):
            raise ValueError('Неверный формат настроек перевозчиков')
        known = {c: {f for f, _l, _u in fs} for c, _n, _d, fs in cls.LIST}
        raw = cls._raw(store)
        for cid, v in d.items():
            if cid not in known or not isinstance(v, dict):
                raise ValueError('Неизвестный перевозчик: %s' % str(cid)[:40])
            cur = dict(raw.get(cid) or {})
            if 'on' in v:
                cur['on'] = bool(v['on'])
            urls = dict(cur.get('urls') or {})
            for f, u in (v.get('urls') or {}).items():
                if f not in known[cid]:
                    raise ValueError('Неизвестное поле адреса: %s' % str(f)[:40])
                u = str(u or '').strip()
                if not u or u == cls._default(cid, f):
                    urls.pop(f, None)
                    continue
                if len(u) > 300 or not cls.URL.match(u):
                    raise ValueError('%s: адрес должен начинаться с https:// и вести на сайт перевозчика (не IP-адрес), до 300 знаков' % dict((c, n) for c, n, _d, _f in cls.LIST)[cid])
                urls[f] = u
            cur['urls'], cur['at'], cur['by'] = urls, _now(), str(by or '')[:80]
            raw[cid] = cur
        store.kv_set(cls.KV, raw)
        for cid in d:                      # справочники городов прежнего адреса — заново с нового
            store.kv_set('lgdict:' + cid, {})
        return cls.public(store)

    SAMPLE = [{'l': 1.2, 'w': 1.0, 'h': 1.0, 'm': 0.3, 'qty': 1}]      # пробное место: 1,2 × 1 × 1 м, 300 кг

    @classmethod
    def test(cls, store, cid):
        """Пробный расчёт одного перевозчика Москва → Санкт-Петербург: {ok, msg} — без ключа в тексте."""
        carrier = CARRIERS.get(cid)
        if not carrier:
            raise ValueError('Неизвестный перевозчик')
        if not carrier.has_keys(store):
            return {'ok': False, 'msg': 'ключ не задан — впишите его выше, в «Доставка по России»'}
        frm, to = {'name': 'Москва'}, {'name': 'Санкт-Петербург'}
        try:
            if carrier is Ati:
                d = AtiDirections(store).find(frm['name'], to['name'])
                return {'ok': bool(d), 'msg': 'отвечает: направление Москва → Санкт-Петербург есть' if d else 'отвечает, но направления Москва → Санкт-Петербург нет'}
            r = carrier.quote(store, frm, to, cls.SAMPLE, 0)
            return {'ok': True, 'msg': 'отвечает: Москва → Санкт-Петербург, 300 кг — %s ₽' % '{:,.0f}'.format(r['price']).replace(',', ' ')}
        except Exception as e:
            return {'ok': False, 'msg': Http.error(e)}


_lock = threading.Lock()


def _now():
    return datetime.now().isoformat(timespec='seconds')


def cnorm(s):
    """Название города для сравнения: «г. Санкт-Петербург, …» → «санкт петербург»."""
    s = str(s or '').lower().replace('ё', 'е')
    s = re.split(r'[,(]', s)[0]
    s = re.sub(r'^(г\.?|город)\s+', '', s.strip())
    return re.sub(r'[\s\-‐–—]+', ' ', s).strip()


def keys(store):
    return store.kv_get('integrations') or {}


def number(v):
    """Число из ответа сервиса («1 234,5», 1234.5) или None."""
    try:
        x = float(str(v).replace(' ', '').replace('\xa0', '').replace(',', '.'))
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def _find(obj, pred, depth=0):
    """Первый вложенный объект, для которого pred(obj) истинно (обход словарей и списков вглубь до 6 уровней)."""
    if depth > 6:
        return None
    if pred(obj):
        return obj
    items = obj.values() if isinstance(obj, dict) else obj if isinstance(obj, list) else []
    for v in items:
        if isinstance(v, (dict, list)):
            r = _find(v, pred, depth + 1)
            if r is not None:
                return r
    return None


class Http:
    """Запрос к сервису перевозчика и понятный текст его ошибки (ключи и токены из текста убраны)."""
    # ключи и токены в адресе (?token=…) и в тексте ответа не показываются и не пишутся в журнал
    SECRET = re.compile(r'(?i)((?:token|access_token|appkey|api_?key|key|secret|password|client_secret)=)[^&\s"\'<>]+')

    @staticmethod
    def call(url, data=None, headers=None, method=None):
        """Запрос с переходом по 307/308: перевозчик переехал на новый адрес — POST повторяется туда же (urllib сам этого не делает)."""
        for _ in range(3):
            try:
                return http_json(url, data=data, headers=headers, method=method)
            except urllib.error.HTTPError as e:
                loc = e.headers.get('Location') if e.code in (301, 302, 307, 308) and e.headers else None
                nxt = urllib.parse.urljoin(url, loc) if loc else ''
                if not nxt.startswith('https://') or nxt == url:
                    raise
                url = nxt
        raise ValueError('сервис перенаправляет запрос по кругу — проверьте адрес API в «Настройках»')

    @classmethod
    def hide(cls, text):
        return cls.SECRET.sub(r'\1***', str(text or ''))

    @classmethod
    def error(cls, e):
        """Текст ошибки для менеджера и журнала."""
        return cls.hide(cls._explain(e))

    @classmethod
    def _explain(cls, e):
        if isinstance(e, urllib.error.HTTPError):
            try:
                text = cls._body_text(e.read().decode('utf-8', 'replace')[:2000])
            except Exception:
                text = ''
            why = HTTP_WHY.get(e.code) or 'сервис ответил ошибкой'
            return '%s, HTTP %s%s' % (why, e.code, (' — ' + text) if text else '')
        if isinstance(e, (socket.timeout, TimeoutError)) or 'timed out' in str(e):
            return 'сервис не ответил вовремя — повторите позже'
        if isinstance(e, urllib.error.URLError):
            return 'нет связи с сервисом: %s' % (str(e.reason)[:120] if e.reason else 'проверьте интернет')
        return str(e)[:300] or e.__class__.__name__

    @staticmethod
    def _body_text(body):
        """Из тела ошибки — коротко и по-человечески: message из JSON, иначе текст без HTML-разметки."""
        body = (body or '').strip()
        if not body:
            return ''
        try:
            j = json.loads(body)
        except ValueError:
            j = None
        else:
            if isinstance(j, dict):
                m = j.get('message') or j.get('error_description') or j.get('error') or j.get('detail')
                if isinstance(m, (str, int, float)):
                    return str(m)[:200]
                errs = j.get('errors')
                if isinstance(errs, list) and errs:
                    return '; '.join(str((x or {}).get('message') if isinstance(x, dict) else x) for x in errs)[:200]
            return ''
        if '<' in body and '>' in body:                 # страница-заглушка (nginx, защита сайта) — её текст не нужен
            return ''
        return re.sub(r'\s+', ' ', body)[:200]


class Carrier:
    """Перевозчик: код (как в CarrierApi.LIST), нужные ключи API, справочник городов. У перевозчиков сборного груза —
    quote(store, frm, to, places, declared): frm и to — точки {name, addr, alt (ближайшие крупные города)}, places —
    [{l, w, h (м), m (т), qty}], declared — объявленная стоимость для страхования. Ответ — {price, ins, days, door, note},
    ошибка — ValueError с понятным текстом."""
    ID = ''
    NAME = ''           # подпись предложения
    SITE = ''           # страница заявки или калькулятора на сайте
    WHOSE = ''          # «город не найден в справочнике …»
    KEYS = ()           # ключи «Интеграций», без которых перевозчик не считает
    HINT_403 = ''       # пояснение к отказу 403
    DICT_DAYS = 7       # справочник городов обновляется раз в неделю

    @classmethod
    def has_keys(cls, store):
        k = keys(store)
        return all(k.get(name) for name in cls.KEYS)

    @classmethod
    def _url(cls, store, field):
        return CarrierApi.url(store, cls.ID, field)

    @staticmethod
    def units(places):
        """[{l, w, h, m, qty}] → по месту на каждую штуку."""
        return [p for p in places for _ in range(int(p['qty']))]

    @staticmethod
    def candidates(point):
        """Город точки и ближайшие крупные — по порядку, для поиска в справочнике перевозчика."""
        return [point.get('name')] + list(point.get('alt') or [])

    @staticmethod
    def pick(cities, names):
        """(код, город): первый из городов, который есть в справочнике {город: код}; нет ни одного — (None, первый)."""
        for n in names:
            if cities.get(cnorm(n)):
                return cities[cnorm(n)], n
        return None, names[0] if names else ''

    @classmethod
    def _both(cls, frm_hit, to_hit):
        """Коды городов отправления и назначения; какого нет в справочнике — ValueError."""
        (a, fa), (b, tb) = frm_hit, to_hit
        if not a or not b:
            raise ValueError('город не найден в справочнике %s: %s' % (cls.WHOSE, fa if not a else tb))
        return a, b

    @staticmethod
    def via(frm_hit, to_hit, frm, to):
        """« (Тверь → Казань)» — если в справочнике перевозчика нашёлся не сам город, а ближайший крупный."""
        fa, tb = frm_hit[1], to_hit[1]
        return '' if (fa, tb) == (frm.get('name'), to.get('name')) else ' (%s → %s)' % (fa, tb)

    @classmethod
    def _cached(cls, store, name, loader):
        """Справочник из kv «lgdict:<name>»; старше DICT_DAYS — загружается заново."""
        c = store.kv_get('lgdict:' + name) or {}
        try:
            fresh = c.get('at') and datetime.fromisoformat(c['at']) > datetime.now() - timedelta(days=cls.DICT_DAYS)
        except ValueError:
            fresh = False
        if fresh and c.get('items'):
            return c['items']
        items = loader()
        if not items:                   # пустой справочник не запоминаем — иначе каждый город будет «не найден»
            raise ValueError('справочник городов не загрузился (сервис ответил без данных) — повторите позже')
        store.kv_set('lgdict:' + name, {'at': _now(), 'items': items})
        return items

    @staticmethod
    def _insurance(items):
        """Сумма строк страхования (по названию «страхов…») в детализации перевозчика."""
        return sum(number(x.get('price')) or 0 for x in (items or []) if isinstance(x, dict) and re.search(r'страхов', str(x.get('name') or ''), re.I))

    @staticmethod
    def _last_number(values):
        """Последнее число из значения или списка значений ответа (ПЭК отдаёт [подпись, …, сумма])."""
        found = [n for n in (number(v) for v in (values if isinstance(values, list) else [values])) if n is not None]
        return found[-1] if found else None


# ---------------------------------------------------------------- ATI.SU «Средние ставки»
class Ati(Carrier):
    """Отдельная машина (FTL): верхняя граница средних ставок ATI.SU по направлению — за рейс (₽) и за км (₽/км), с НДС."""
    ID, KEYS = 'ati', ('atiToken',)
    # класс машины в тарифах → тип кузова и тоннаж «Средних ставок»
    CAR_CLASSES = {'gazel': ('tent', 1.5), 't5': ('tent', 5), 't10': ('tent', 10), 'tent20': ('tent', 20),
                   'flat': ('open', 20), 'lowbed': ('tral', 20)}
    BODY = {'tent': 'тент', 'open': 'открытая', 'tral': 'трал'}

    @classmethod
    def _headers(cls, store):
        return {'Authorization': 'Bearer ' + keys(store).get('atiToken', ''), 'Content-Type': 'application/json'}

    @classmethod
    def directions(cls, store):
        """[{fromId, from, toId, to, info}] — все направления «Средних ставок»."""
        def load():
            j = Http.call(cls._url(store, 'base') + '/all_directions', headers=cls._headers(store))
            rows = j if isinstance(j, list) else (_find(j, lambda o: isinstance(o, list) and o and isinstance(o[0], dict) and 'FromCityId' in o[0]) or [])
            return [{'fromId': r.get('FromCityId'), 'from': r.get('FromCity') or '', 'toId': r.get('ToCityId'), 'to': r.get('ToCity') or '',
                     'info': r.get('DirectionInfo')} for r in rows if isinstance(r, dict) and r.get('FromCityId') and r.get('ToCityId')]
        return cls._cached(store, 'ati', load)

    @classmethod
    def price(cls, store, d, car, tonnage, days=None):
        """Ставки по направлению d за последние days дней: {upperRub, avgRub, lowRub, upperKm, avgKm, count}."""
        end = date.today()
        days = days or LtlLimits.ati_days(store)
        body = {'From': {'CityId': d['fromId']}, 'To': {'CityId': d['toId']}, 'FromCityId': d['fromId'], 'ToCityId': d['toId'],
                'CarType': car, 'Tonnage': tonnage, 'DateFrom': (end - timedelta(days=days)).isoformat() + 'T00:00:00',
                'DateTo': end.isoformat() + 'T23:59:59', 'WithNds': True}
        j = Http.call(cls._url(store, 'base') + '/average_prices', data=body, headers=cls._headers(store), method='POST')
        rec = j[0] if isinstance(j, list) and j else j
        # ставка за рейс — в PricesInRub (или во вложенном объекте с UpperPrice), за км — в самой записи
        rub = _find(rec, lambda o: isinstance(o, dict) and 'UpperPrice' in o and o is not rec) if isinstance(rec, dict) else None
        rub = (rec or {}).get('PricesInRub') or rub or {}
        per_km = rec if isinstance(rec, dict) and 'UpperPrice' in rec else (_find(rec, lambda o: isinstance(o, dict) and 'UpperPrice' in o and o is not rub) or {})
        out = {'upperRub': number(rub.get('UpperPrice')), 'avgRub': number(rub.get('AveragePrice')), 'lowRub': number(rub.get('BottomPrice')),
               'upperKm': number(per_km.get('UpperPrice')), 'avgKm': number(per_km.get('AveragePrice')),
               'count': None}
        cnt = _find(rec, lambda o: isinstance(o, dict) and any(k in o for k in ('LoadsCount', 'CargoCount', 'Count')))
        if cnt:
            out['count'] = number(next(cnt[k] for k in ('LoadsCount', 'CargoCount', 'Count') if k in cnt))
        if out['upperRub'] is None and out['upperKm'] is None:
            raise ValueError('в ответе ATI.SU нет ставок по направлению (%s → %s, %s %s т)' % (d['from'], d['to'], car, tonnage))
        return out


class AtiDirections:
    """Поиск направления «Средних ставок» ATI.SU по городам: справочник читается один раз на расчёт (а не на каждую пару
    городов), поиск — по словарю; при одинаковых названиях — первое направление справочника."""

    def __init__(self, store):
        self.store, self._idx = store, None

    def find(self, frm, to):
        if self._idx is None:
            idx = {}
            for d in Ati.directions(self.store):
                idx.setdefault((cnorm(d['from']), cnorm(d['to'])), d)
            self._idx = idx
        return self._idx.get((cnorm(frm), cnorm(to)))


# ---------------------------------------------------------------- ПЭК (открытый калькулятор)
class Pec(Carrier):
    """Сборный груз терминал — терминал; забор и доставка — если калькулятор их посчитал."""
    ID, NAME, SITE, WHOSE = 'pec', 'ПЭК', 'https://pecom.ru/services-are/shipping-request/', 'ПЭК'

    @classmethod
    def cities(cls, store):
        def load():
            j = Http.call(cls._url(store, 'towns'))
            out = {}
            for _region, towns in (j.items() if isinstance(j, dict) else []):
                if isinstance(towns, dict):
                    for tid, name in towns.items():
                        n = cnorm(name)
                        if n and n not in out:
                            out[n] = tid
            return out
        return cls._cached(store, 'pec', load)

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        cities = cls.cities(store)
        frm_hit, to_hit = cls.pick(cities, cls.candidates(frm)), cls.pick(cities, cls.candidates(to))
        a, b = cls._both(frm_hit, to_hit)
        q = [('take[town]', a), ('deliver[town]', b)]
        if declared:
            q.append(('strah', int(round(declared))))   # объявленная стоимость — ПЭК считает своё страхование
        for k, p in enumerate(cls.units(places)):   # место: ширина, длина, высота (м), объём (м³), вес (кг), негабарит, жёсткая упаковка
            oversize = 1 if max(p['l'], p['w'], p['h']) > 3 or p['m'] > 0.5 else 0
            q += [('places[%d][]' % k, v) for v in (p['w'], p['l'], p['h'], round(p['l'] * p['w'] * p['h'], 3), round(p['m'] * 1000), oversize, 0)]
        j = Http.call(cls._url(store, 'calc') + '?' + urllib.parse.urlencode(q))
        auto = j.get('auto') if isinstance(j, dict) else None
        if not auto:
            raise ValueError('ПЭК: автоперевозка недоступна для этого груза' + ((' — ' + str(j.get('error'))) if isinstance(j, dict) and j.get('error') else ''))
        total = cls._last_number(auto)
        if total is None:
            raise ValueError('ПЭК: в ответе нет стоимости')
        ins = 0
        for k, v in j.items():                      # обязательные надбавки (ADD…: негабарит, страхование)
            if re.match(r'^(ADD|add)', str(k)) and isinstance(v, list):
                n = cls._last_number(v)
                if n is not None:
                    total += n
                    if re.search(r'страх', ' '.join(str(y) for y in v[:2]), re.I):
                        ins += n
        door = 0
        for k in ('take', 'deliver'):                # забор груза у отправителя и доставка получателю
            n = cls._last_number(j[k]) if j.get(k) is not None else None
            if n is not None:
                total += n
                door += 1
        days = None
        per = _find(j, lambda o: isinstance(o, dict) and any(k in o for k in ('periods_days', 'periods')))
        if per:
            m = re.findall(r'\d+', str(per.get('periods_days') or per.get('periods')))
            days = int(m[-1]) if m else None
        return {'price': round(total), 'ins': round(ins), 'days': days, 'door': door == 2,
                'note': ('сборный груз, дверь в дверь (забор и доставка ПЭК)' if door == 2 else 'сборный груз, межтерминальная перевозка ПЭК')
                + cls.via(frm_hit, to_hit, frm, to)}


# ---------------------------------------------------------------- Деловые Линии
class Dellin(Carrier):
    """Сборный груз от адреса до адреса (адрес ищет сам сервис)."""
    ID, NAME, SITE, KEYS = 'dellin', 'Деловые Линии', 'https://www.dellin.ru/requests/', ('dellinKey',)
    WORK_TIME = {'worktimeStart': '09:00', 'worktimeEnd': '18:00'}

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        units = cls.units(places)
        over = [u for u in units if max(u['l'], u['w'], u['h']) > 3 or u['m'] > 0.1]
        body = {'appkey': keys(store).get('dellinKey', ''),
                'delivery': {'deliveryType': {'type': 'auto'},
                             'derival': {'produceDate': (date.today() + timedelta(days=1)).isoformat(), 'variant': 'address',
                                         'address': {'search': frm.get('addr') or frm.get('name')}, 'time': cls.WORK_TIME},
                             'arrival': {'variant': 'address', 'address': {'search': to.get('addr') or to.get('name')}, 'time': cls.WORK_TIME}},
                'cargo': {'quantity': len(units), 'length': max(u['l'] for u in units), 'width': max(u['w'] for u in units),
                          'height': max(u['h'] for u in units), 'weight': round(max(u['m'] for u in units) * 1000, 1),
                          'totalVolume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3), 'totalWeight': round(sum(u['m'] for u in units) * 1000, 1),
                          'oversizedWeight': round(sum(u['m'] for u in over) * 1000, 1), 'oversizedVolume': round(sum(u['l'] * u['w'] * u['h'] for u in over), 3),
                          'hazardClass': 0}}
        if declared:                                 # страхование груза Деловыми Линиями по объявленной стоимости
            body['cargo']['insurance'] = {'statedValue': int(round(declared)), 'term': True}
        try:
            j = Http.call(cls._url(store, 'calc'), data=body, headers={'Content-Type': 'application/json'}, method='POST')
        except urllib.error.HTTPError as e:        # ошибка проверки полей приходит телом ответа с кодом 4xx
            try:
                j = json.loads(e.read().decode('utf-8', 'replace'))
            except Exception:
                raise ValueError(Http.error(e))
        errs = j.get('errors') if isinstance(j, dict) else None
        if errs:
            msg = '; '.join(str((x or {}).get('detail') or (x or {}).get('title') or x) for x in (errs if isinstance(errs, list) else [errs]))[:300]
            raise ValueError('Деловые Линии: ' + msg)
        d = (j or {}).get('data') or {}
        price = number(d.get('price'))
        if price is None:
            parts = [number((d.get(k) or {}).get('price')) for k in ('derival', 'intercity', 'arrival')]
            price = sum(x for x in parts if x) or None
        if not price:
            raise ValueError('Деловые Линии: в ответе нет стоимости')
        iv = d.get('insurance')
        ins = number(iv.get('price') if isinstance(iv, dict) else iv) or 0
        return {'price': round(price), 'ins': round(ins), 'days': cls._days(d.get('orderDates') or {}), 'door': True,
                'note': 'сборный груз, от адреса до адреса'}

    @staticmethod
    def _days(dates):
        """Срок в днях от забора до выдачи по датам заказа (включительно)."""
        start = dates.get('pickup') or dates.get('derivalFromOspSender')
        end = dates.get('arrivalToOspReceiver') or dates.get('giveoutFromOspReceiver')
        if not start or not end:
            return None
        try:
            return (datetime.fromisoformat(str(end)[:10]) - datetime.fromisoformat(str(start)[:10])).days + 1
        except ValueError:
            return None


# ---------------------------------------------------------------- КИТ
class Kit(Carrier):
    """KIT.API: /2.0/order/calculate — забор и доставка по адресу (дверь — дверь), тариф «Стандарт» (01); города —
    /1.1/tdd/city/get-list и /1.1/tdd/search/by-name. Страхование КИТ по объявленной стоимости (строки «страхован…»
    в детализации) входит в цену и показывается отдельно."""
    ID, NAME, SITE, WHOSE, KEYS = 'kit', 'КИТ', 'https://tk-kit.ru/calculate', 'КИТ', ('kitToken',)
    TYPES = {'01': 'Стандарт', '03': 'Экспресс'}
    DOCS_FROM = 50000       # ₽: от этой объявленной стоимости КИТ требует признак документов, подтверждающих стоимость

    @classmethod
    def _call(cls, store, path, body):
        """POST JSON с токеном Bearer. Ошибки — понятным текстом: 401 — токен, 429 — лимит, 422 — поля."""
        headers = {'Authorization': 'Bearer ' + keys(store).get('kitToken', ''), 'Content-Type': 'application/json'}
        try:
            return Http.call(cls._url(store, 'base') + path, data=body, headers=headers, method='POST')
        except urllib.error.HTTPError as e:
            try:
                j = json.loads(e.read().decode('utf-8', 'replace') or 'null')
            except Exception:
                j = None
            if e.code == 401:
                raise ValueError('КИТ: токен не принят — создайте новый в личном кабинете tk-kit.ru («Разработчикам» → «Получение ключа API»)')
            if e.code == 429:
                raise ValueError('КИТ: превышен лимит запросов по токену — повторите позже')
            if isinstance(j, list):         # ошибки проверки полей: [{"field": …, "message": …}]
                msg = '; '.join(str(x.get('message') or x) for x in j if isinstance(x, dict))
            elif isinstance(j, dict):
                msg = str(j.get('message') or j.get('name') or '')
            else:
                msg = ''
            raise ValueError('КИТ: %s, HTTP %s%s' % (HTTP_WHY.get(e.code) or 'сервис ответил ошибкой', e.code, (' — ' + msg[:300]) if msg else ''))

    @staticmethod
    def _name(row):
        return cnorm(row.get('name')) if isinstance(row, dict) else ''

    @staticmethod
    def _is_city(row):
        return str(row.get('type') or '').startswith('гор')

    @classmethod
    def cities(cls, store):
        """Справочник населённых пунктов: имя → код. При совпадении имён — город («гор.»)."""
        def load():
            j = cls._call(store, '/1.1/tdd/city/get-list', {'country_code': 'RU'})
            rows = j if isinstance(j, list) else (_find(j, lambda o: isinstance(o, list) and o and isinstance(o[0], dict) and 'code' in o[0]) or [])
            out, city = {}, set()
            for r in rows:
                n, is_city = cls._name(r), cls._is_city(r)
                if n and r.get('code') and n not in city and (n not in out or is_city):
                    out[n] = r['code']
                    if is_city:
                        city.add(n)
            return out
        return cls._cached(store, 'kit', load)

    @classmethod
    def city(cls, store, names):
        """(код, город): по справочнику, а если там нет — поиском по имени, с запоминанием в справочнике."""
        cities = cls.cities(store)
        for n in names:
            key = cnorm(n)
            if not key:
                continue
            if key not in cities:
                try:
                    rows = cls._call(store, '/1.1/tdd/search/by-name', {'title': n})
                except ValueError as e:
                    if 'токен' in str(e):      # неверный токен — дальше искать бессмысленно
                        raise
                    continue                    # поиск не ответил — берём следующий (ближайший крупный) город
                # в ответах КИТ встречается и country_сode с русской «с»
                rows = [r for r in (rows if isinstance(rows, list) else []) if cls._name(r) == key and r.get('code')
                        and str(r.get('country_code') or r.get('country_сode') or 'RU') == 'RU']
                hit = next((r for r in rows if cls._is_city(r)), rows[0] if rows else None)
                cities[key] = hit['code'] if hit else None
                store.kv_set('lgdict:kit', dict(store.kv_get('lgdict:kit') or {'at': _now()}, items=cities))
            if cities.get(key):
                return cities[key], n
        return None, names[0] if names else ''

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        frm_hit, to_hit = cls.city(store, cls.candidates(frm)), cls.city(store, cls.candidates(to))
        a, b = cls._both(frm_hit, to_hit)
        price = max(1, int(round(declared or 0)))
        body = {'city_pickup_code': a, 'city_delivery_code': b, 'declared_price': price, 'type': '01',
                'pick_up': 1, 'delivery': 1, 'currency_code': ['RUB'],
                'places': [{'count_place': 1, 'length': round(u['l'] * 100, 2), 'width': round(u['w'] * 100, 2),
                            'height': round(u['h'] * 100, 2), 'weight': round(u['m'] * 1000, 2)} for u in cls.units(places)]}
        if price >= cls.DOCS_FROM:
            body.update(confirmation_price=1, have_doc=1)
        j = cls._call(store, '/2.0/order/calculate', body)
        found = {}                      # код тарифа → расчёт
        for el in (j if isinstance(j, list) else [j]):
            if isinstance(el, dict):
                for k, v in el.items():
                    if isinstance(v, dict) and number(v.get('cost')) is not None:
                        found[str(k)] = v
        if not found:
            msg = ''
            if isinstance(j, dict):
                msg = j.get('message') or '; '.join(str(x) for x in (j.get('messages_log') or []))
            raise ValueError('КИТ: в ответе нет стоимости' + (' — ' + str(msg)[:300] if msg else ''))
        code = '01' if '01' in found else sorted(found)[0]
        t = found[code]
        days = re.findall(r'\d+', str(t.get('time') or ''))
        return {'price': round(number(t['cost'])), 'ins': round(cls._insurance(t.get('detail'))), 'days': int(days[-1]) if days else None, 'door': True,
                'note': 'дверь в дверь (забор и доставка КИТ), тариф «%s»%s' % (t.get('name') or cls.TYPES.get(code, code), cls.via(frm_hit, to_hit, frm, to))}


# ---------------------------------------------------------------- СДЭК (API v2, OAuth client_credentials)
class Cdek(Carrier):
    """Тарифы «дверь — дверь» (delivery_mode 1), самый дешёвый; страхование — услугой INSURANCE выбранного тарифа."""
    ID, NAME, SITE, WHOSE, KEYS = 'cdek', 'СДЭК', 'https://www.cdek.ru/ru/calculate', 'СДЭК', ('cdekId', 'cdekSecret')
    HINT_403 = '. Если ключи верны — защита сайта СДЭК не пропускает запросы с этого компьютера'
    _tokens = {}            # идентификатор клиента → (токен, годен до)

    @classmethod
    def _headers(cls, store):
        k = keys(store)
        t = cls._tokens.get(k.get('cdekId'))
        if not t or t[1] < datetime.now():
            j = Http.call(cls._url(store, 'base') + '/oauth/token', data={'grant_type': 'client_credentials', 'client_id': k.get('cdekId', ''),
                                                                          'client_secret': k.get('cdekSecret', '')}, headers={'User-Agent': BROWSER_UA}, method='POST')
            if not j.get('access_token'):
                raise ValueError('СДЭК: не выдан токен — проверьте идентификатор и секретный ключ')
            t = (j['access_token'], datetime.now() + timedelta(seconds=int(j.get('expires_in') or 3600) - 60))
            cls._tokens[k.get('cdekId')] = t
        return {'Authorization': 'Bearer ' + t[0], 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA}

    @classmethod
    def city(cls, store, names, headers):
        """(код, город) по поиску СДЭК с запоминанием в kv «lgdict:cdek»: точный город, затем ближайшие крупные."""
        c = store.kv_get('lgdict:cdek') or {}
        items = c.get('items') or {}
        for n in names:
            key = cnorm(n)
            if not key:
                continue
            if key not in items:
                q = urllib.parse.urlencode({'city': n, 'country_codes': 'RU', 'size': 10})
                j = Http.call(cls._url(store, 'base') + '/location/cities?' + q, headers=headers)
                rows = j if isinstance(j, list) else []
                hit = next((r for r in rows if cnorm(r.get('city')) == key), None)
                items[key] = hit.get('code') if hit else None
                store.kv_set('lgdict:cdek', {'at': _now(), 'items': items})
            if items.get(key):
                return items[key], n
        return None, names[0] if names else ''

    @staticmethod
    def _location(code, addr):
        return dict({'code': code}, **({'address': addr} if addr else {}))

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        h = cls._headers(store)
        frm_hit, to_hit = cls.city(store, cls.candidates(frm), h), cls.city(store, cls.candidates(to), h)
        a, b = cls._both(frm_hit, to_hit)
        route = {'from_location': cls._location(a, frm.get('addr')), 'to_location': cls._location(b, to.get('addr')),
                 'packages': [{'weight': int(round(p['m'] * 1000)), 'length': int(round(p['l'] * 100)), 'width': int(round(p['w'] * 100)),
                               'height': int(round(p['h'] * 100))} for p in cls.units(places)]}
        j = Http.call(cls._url(store, 'base') + '/calculator/tarifflist', data=dict({'type': 2, 'currency': 1, 'lang': 'rus'}, **route),
                      headers=h, method='POST')
        if isinstance(j, dict) and j.get('errors'):
            raise ValueError('СДЭК: ' + '; '.join(str((e or {}).get('message') or e) for e in j['errors'])[:300])
        rows = [r for r in (j.get('tariff_codes') if isinstance(j, dict) else []) or [] if number(r.get('delivery_sum'))]
        door = [r for r in rows if r.get('delivery_mode') == 1]       # 1 — дверь-дверь
        if not door:
            raise ValueError('СДЭК: нет тарифов «дверь — дверь» для такого груза' + (' (есть только до пункта выдачи)' if rows else ''))
        r = min(door, key=lambda x: number(x['delivery_sum']))
        ins = cls._insurance_of(store, h, r.get('tariff_code'), route, declared) if declared else 0
        return {'price': round(number(r['delivery_sum']) + ins), 'ins': round(ins), 'days': r.get('period_max') or r.get('period_min'), 'door': True,
                'note': 'дверь в дверь, тариф «%s»%s' % (r.get('tariff_name') or r.get('tariff_code'), cls.via(frm_hit, to_hit, frm, to))}

    @classmethod
    def _insurance_of(cls, store, h, tariff, route, declared):
        """Страхование СДЭК по объявленной стоимости — расчёт тарифа с услугой INSURANCE; не посчиталось — 0
        (тогда в сделке будет своё, единое страхование)."""
        try:
            t = Http.call(cls._url(store, 'base') + '/calculator/tariff', headers=h, method='POST',
                          data=dict({'type': 2, 'currency': 1, 'tariff_code': tariff,
                                     'services': [{'code': 'INSURANCE', 'parameter': str(int(round(declared)))}]}, **route))
            if not isinstance(t, dict):
                return 0
            svc = [x for x in (t.get('services') or []) if isinstance(x, dict) and x.get('code') == 'INSURANCE']
            ins = sum(number(x.get('total_sum') if x.get('total_sum') is not None else x.get('sum')) or 0 for x in svc)
            if not ins and number(t.get('total_sum')) and number(t.get('delivery_sum')):
                ins = max(0, number(t['total_sum']) - number(t['delivery_sum']))
            return ins
        except Exception:
            return 0


# ---------------------------------------------------------------- Возовоз (API 2.5: object/action, токен в GET-параметре)
class Vozovoz(Carrier):
    """Дверь в дверь, если у обеих точек есть адрес с улицей и домом, иначе — от терминала до терминала."""
    ID, NAME, SITE, KEYS = 'vozovoz', 'Возовоз', 'https://vozovoz.ru/calculate/', ('vozovozToken',)

    @staticmethod
    def _has_street(addr):
        return bool(re.search(r'\d', str(addr or ''))) and ',' in str(addr or '')

    @classmethod
    def _point(cls, point):
        addr = point.get('addr')
        return dict({'location': point.get('name')}, **({'address': addr} if cls._has_street(addr) else {'terminal': 'default'}))

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        units = cls.units(places)
        cargo = {'dimension': {'quantity': len(units), 'volume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3),
                               'weight': round(sum(u['m'] for u in units) * 1000, 1),
                               'max': {'length': max(u['l'] for u in units), 'width': max(u['w'] for u in units),
                                       'height': max(u['h'] for u in units), 'weight': round(max(u['m'] for u in units) * 1000, 1)}}}
        if declared:
            cargo['insurance'] = int(round(declared))
        body = {'object': 'price', 'action': 'get', 'params': {
            'cargo': cargo, 'gateway': {'dispatch': {'point': cls._point(frm)}, 'destination': {'point': cls._point(to)}}}}
        url = cls._url(store, 'url') + '?' + urllib.parse.urlencode({'token': keys(store).get('vozovozToken', '')})
        j = Http.call(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
        if isinstance(j, dict) and j.get('error'):
            e = j['error']
            raise ValueError('Возовоз: ' + Http.hide(str((e or {}).get('message') if isinstance(e, dict) else e)[:300]))
        r = (j or {}).get('response') or {}
        price = number(r.get('price'))
        if not price:
            raise ValueError('Возовоз: в ответе нет стоимости')
        door = cls._has_street(frm.get('addr')) and cls._has_street(to.get('addr'))
        dt = r.get('deliveryTime') or {}
        return {'price': round(price), 'ins': round(cls._insurance(r.get('service'))), 'days': dt.get('to') or dt.get('from'), 'door': door,
                'note': 'дверь в дверь' if door else 'от терминала до терминала'}


# ---------------------------------------------------------------- Энергия (открытый расчёт без ключа)
class Nrg(Carrier):
    """Автоперевозка (иначе самая дешёвая); забор и доставка, страхование — отдельными строками ответа."""
    ID, NAME, SITE, WHOSE = 'nrg', 'Энергия', 'https://nrg-tk.ru/client/calculator/', 'Энергии'
    RETRY_PAUSE = 1.5       # с — их API временами отвечает 502

    @classmethod
    def _call(cls, store, path, data=None):
        """Основной и резервный адреса API; при 5xx / обрыве связи — повтор через паузу."""
        err = None
        h = {'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': BROWSER_UA}
        bases = list(dict.fromkeys(cls._url(store, f) for f in ('base', 'reserve')))
        for _attempt in range(2):
            for base in bases:
                try:
                    return Http.call(base + path, data=data, headers=h, method='POST' if data is not None else None)
                except urllib.error.HTTPError as e:
                    err = e
                    if e.code < 500 and e.code not in (403, 404):     # 403/404 у одного адреса — пробуется другой
                        raise
                except Exception as e:
                    err = e
            time.sleep(cls.RETRY_PAUSE)
        raise err

    @classmethod
    def cities(cls, store):
        def load():
            j = cls._call(store, '/cities?lang=ru')
            rows = j if isinstance(j, list) else (_find(j, lambda o: isinstance(o, list) and o and isinstance(o[0], dict) and 'id' in o[0] and 'name' in o[0]) or [])
            out = {}
            for r in rows:
                n = cnorm(r.get('name'))
                if n and n not in out:
                    out[n] = r.get('id')
            return out
        return cls._cached(store, 'nrg', load)

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        cities = cls.cities(store)
        a, b = cls._both(cls.pick(cities, cls.candidates(frm)), cls.pick(cities, cls.candidates(to)))
        items = [{'weight': round(p['m'] * 1000, 1), 'width': p['w'], 'height': p['h'], 'length': p['l']} for p in cls.units(places)]
        j = cls._call(store, '/price', {'idCityFrom': a, 'idCityTo': b, 'cover': 0, 'idCurrency': 0, 'items': items,
                                        'declaredCargoPrice': int(round(declared or 0)), 'idClient': 0})
        if isinstance(j, dict) and (j.get('message') or j.get('error')) and not j.get('transfer'):
            raise ValueError('Энергия: ' + str(j.get('message') or j.get('error'))[:300])
        tr = [t for t in ((j or {}).get('transfer') or []) if isinstance(t, dict) and number(t.get('price'))]
        if not tr:
            raise ValueError('Энергия: в ответе нет стоимости перевозки')
        t = next((x for x in tr if re.search(r'авто', str(x.get('type') or ''), re.I)), None) or min(tr, key=lambda x: number(x['price']))
        price, door = number(t['price']), 0
        for k in ('request', 'delivery'):            # забор у отправителя и доставка получателю
            v = (j or {}).get(k)
            n = number(v.get('price')) if isinstance(v, dict) else None
            if n:
                price += n
                door += 1
        ins = 0
        for k, v in (j or {}).items() if isinstance(j, dict) else []:   # страхование Энергии по объявленной стоимости
            if re.search(r'insur', str(k), re.I):
                ins += (number(v.get('price')) if isinstance(v, dict) else number(v)) or 0
        price += ins
        days = re.findall(r'\d+', str(t.get('interval') or ''))
        return {'price': round(price), 'ins': round(ins), 'days': int(days[-1]) if days else None, 'door': door == 2,
                'note': ('дверь в дверь (забор и доставка Энергии)' if door == 2 else 'от терминала до терминала') + ', ' + str(t.get('type') or 'авто').lower()}


# ---------------------------------------------------------------- ЖелДорЭкспедиция (открытый расчёт без ключа, в т. ч. негабарит)
class Jde(Carrier):
    """ЖелДорЭкспедиция: публичный расчёт GET /calculator/price (ключ не нужен) и справочник филиалов /geo/search (mode=1 —
    приём груза, 2 — выдача). Крупногабаритный груз и длинномеры (место до 12 м по справочнику филиалов) ЖДЭ принимает
    сборным грузом и сама добавляет надбавку за негабарит по размерам места — флаг «негабарит» не передаётся (иначе надбавка
    и на обычный груз). Забор и доставка — по городу (pickup / delivery); страхование — по объявленной стоимости."""
    ID, NAME, SITE, WHOSE = 'jde', 'ЖелДорЭкспедиция', 'https://www.jde.ru/', 'ЖелДорЭкспедиции'
    MAX_T = 20.0          # весь груз, т: больше — только отдельной машиной (ATI.SU и тарифы)

    @classmethod
    def branches(cls, store, mode):
        """{город: код филиала}: в городе — филиал с забором / доставкой и самым длинным допустимым местом."""
        def load():
            j = Http.call(cls._url(store, 'base') + '/geo/search?mode=%d' % mode)
            best = {}
            for r in j if isinstance(j, list) else []:
                n = cnorm((r or {}).get('city'))
                if not n or not r.get('code'):
                    continue
                length = number(str(r.get('max_l_gm') or '0').replace(',', '.')) or 99     # 0 — ограничений нет
                score = (1 if str(r.get('mst_pr_aex')) == '1' else 0, length)
                if n not in best or score > best[n][0]:
                    best[n] = (score, str(r['code']))
            return {n: v[1] for n, v in best.items()}
        return cls._cached(store, 'jde%d' % mode, load)

    @classmethod
    def quote(cls, store, frm, to, places, declared=0):
        units = cls.units(places)
        if sum(u['m'] for u in units) > cls.MAX_T + 1e-9:
            raise ValueError('ЖелДорЭкспедиция: груз тяжелее 20 000 кг — только отдельной машиной')
        frm_hit, to_hit = cls.pick(cls.branches(store, 1), cls.candidates(frm)), cls.pick(cls.branches(store, 2), cls.candidates(to))
        a, b = cls._both(frm_hit, to_hit)
        big = max(units, key=lambda u: u['l'] * u['w'] * u['h'])
        q = {'from': a, 'to': b, 'type': 1, 'weight': round(sum(u['m'] for u in units) * 1000, 1),
             'volume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3), 'length': big['l'], 'width': big['w'], 'height': big['h'],
             'quantity': len(units), 'pickup': 1, 'delivery': 1,
             # max_length_gab сервер ЖДЭ читает только с запятой («9,2»), остальные числа — с точкой
             'max_length_gab': ('%g' % max(max(u['l'], u['w'], u['h']) for u in units)).replace('.', ','),
             'pr_ins': 1 if declared else 0}
        if declared:
            q['insValue'] = int(round(declared))
        j = Http.call(cls._url(store, 'base') + '/calculator/price?' + urllib.parse.urlencode(q))
        if not isinstance(j, dict) or str(j.get('result')) != '1':
            err = '; '.join(str(x.get('error')) for x in ((j or {}).get('services') or []) if isinstance(x, dict) and x.get('error')) or str((j or {}).get('error') or '')
            raise ValueError('ЖелДорЭкспедиция: ' + (err or 'расчёт не выполнен')[:300])
        price = number(j.get('price'))
        if not price:
            raise ValueError('ЖелДорЭкспедиция: в ответе нет стоимости')
        ins = number(j.get('price_cargins')) or 0                       # страхование, оформление и маркировка — сверх price
        extra = sum(number(j.get(k)) or 0 for k in ('price_doc', 'price_mark'))
        items = {x.get('item') for x in (j.get('services') or []) if isinstance(x, dict)}
        door = {'pickup', 'delivery'} <= items
        ok, _why = LtlLimits.fits(places, store)
        days = number(j.get('maxdays')) or number(j.get('mindays'))
        return {'price': round(price + ins + extra), 'ins': round(ins), 'days': int(days) if days else None, 'door': door,
                'note': ('сборный груз' if ok else 'крупногабаритный груз сборной отправкой (негабарит по размерам места)')
                + (', дверь в дверь (забор и доставка ЖДЭ)' if door else ', от терминала до терминала') + cls.via(frm_hit, to_hit, frm, to)}


# сборный груз: порядок — порядок предложений в расчёте; ЖДЭ берёт и крупногабаритный груз
LTL_CARRIERS = (Jde, Pec, Dellin, Nrg, Cdek, Vozovoz, Kit)
CARRIERS = {c.ID: c for c in (Ati, Pec, Dellin, Kit, Cdek, Vozovoz, Nrg, Jde)}


def providers(store):
    """{код: считает ли}: перевозчик включён в «Настройках» и задан его ключ (ПЭК, Энергия и ЖДЭ — без ключа)."""
    return {cid: c.has_keys(store) and CarrierApi.on(store, cid) for cid, c in CARRIERS.items()}


# ---------------------------------------------------------------- сводка предложений
class DeliveryQuote:
    """Доставка по России: тарифы «Настроек» (цена посчитана в браузере), отдельная машина по ATI.SU и сборный груз
    у перевозчиков (параллельно). Ответ — все предложения, ошибки по источникам и выбранное — максимальное полное.
    req: from{name, addr, alt}, to{…}, km, places[{l,w,h,m,qty}], vehicles[{id, name, extras}], unload, model, modelNote, declared."""
    WAIT = 40           # с — ожидание ответа перевозчика сборного груза

    def __init__(self, store, req):
        self.store, self.req = store, req
        self.frm, self.to = req.get('from') or {}, req.get('to') or {}
        self.places = [{'l': float(p['l']), 'w': float(p['w']), 'h': float(p['h']), 'm': float(p['m']), 'qty': int(p.get('qty') or 1)}
                       for p in (req.get('places') or []) if all(number(p.get(k)) for k in ('l', 'w', 'h', 'm'))]
        self.unload = number(req.get('unload')) or 0
        self.providers = providers(store)
        self.offers, self.errors, self.at = [], [], _now()

    def run(self):
        model = number(self.req.get('model'))
        if model:
            self.offers.append({'src': 'Тарифы «Настроек»', 'kind': 'model', 'price': round(model), 'complete': True,
                                'note': self.req.get('modelNote') or 'расчёт по тарифам программы', 'at': self.at})
        if self.providers['ati'] and self.req.get('vehicles'):
            try:
                self.offers.append(self._ftl(self.req['vehicles']))
            except Exception as e:
                self.errors.append({'src': 'ATI.SU', 'msg': Http.error(e)})
        if self.places:
            self._ltl()
        full = [o for o in self.offers if o.get('complete')]
        best = max(full, key=lambda o: o['price']) if full else None
        return {'offers': self.offers, 'errors': self.errors, 'best': best, 'at': self.at, 'providers': self.providers}

    def _ati_direction(self):
        """Направление «Средних ставок» и признак «взяты ближайшие крупные города»: направления там — между крупными
        городами, нет точного — пробуются города из alt."""
        ati = AtiDirections(self.store)
        for fa in Carrier.candidates(self.frm):
            for tb in Carrier.candidates(self.to):
                d = ati.find(fa, tb)
                if d:
                    return d, (fa, tb) != (self.frm.get('name'), self.to.get('name'))
        raise ValueError('направления %s → %s нет в «Средних ставках» ATI.SU' % (self.frm.get('name'), self.to.get('name')))

    def _ftl(self, vehicles):
        """Отдельные машины: по каждой — верхняя граница средних ставок за рейс или за км × расстояние, плюс надбавки."""
        d, nearby = self._ati_direction()
        km = number(self.req.get('km')) or 0
        total, parts = 0, []
        for v in vehicles:
            car, ton = Ati.CAR_CLASSES.get(v.get('id'), ('tent', 20))
            p = Ati.price(self.store, d, car, ton)
            trip = max(p['upperRub'] or 0, (p['upperKm'] or 0) * km)
            total += trip + (number(v.get('extras')) or 0)
            per_km = ', %s ₽/км' % '{:,.0f}'.format(p['upperKm']).replace(',', ' ') if p['upperKm'] else ''
            parts.append('%s: %s ₽ (верх средних ставок ATI.SU, %s %s т%s)' % (v.get('name') or v.get('id'), '{:,.0f}'.format(trip).replace(',', ' '),
                                                                             Ati.BODY.get(car, car), str(ton).replace('.', ','), per_km))
        note = '; '.join(parts)
        if nearby:
            note = 'ставка по направлению %s → %s (ближайшие крупные города): %s' % (d['from'], d['to'], note)
        if self.unload or any(number(v.get('extras')) for v in vehicles):
            note += '; разгрузка и разрешения — по тарифам программы'
        return {'src': 'ATI.SU «Средние ставки»', 'kind': 'ftl', 'price': round(total + self.unload), 'base': round(total), 'unload': round(self.unload),
                'door': True, 'complete': True, 'at': self.at, 'note': note, 'url': 'https://ati.su/rates'}

    def _ltl(self):
        """Сборный груз — если место и общий вес в пределах; иначе только ЖДЭ (берёт и крупногабарит, до 20 т)."""
        ok, why = LtlLimits.fits(self.places, self.store)
        if not ok:
            big_ok = self.providers['jde'] and sum(u['m'] for u in Carrier.units(self.places)) <= Jde.MAX_T + 1e-9
            self.errors.append({'src': 'Сборный груз (ПЭК, Деловые Линии, КИТ, СДЭК, Возовоз, Энергия)', 'skip': True,
                                'msg': why + ('; крупногабаритный груз считает ЖелДорЭкспедиция' if big_ok else '')})
            if not big_ok:
                return
        declared = number(self.req.get('declared')) or 0     # объявленная стоимость груза — для страхования перевозчика
        carriers = [c for c in LTL_CARRIERS if self.providers[c.ID] and (ok or c is Jde)]
        results = {}

        def run(carrier):
            try:
                results[carrier] = carrier.quote(self.store, self.frm, self.to, self.places, declared)
            except Exception as e:
                results[carrier] = e
        threads = [threading.Thread(target=run, args=(c,), daemon=True) for c in carriers]
        for t in threads:
            t.start()
        for t in threads:
            t.join(self.WAIT)
        for c in carriers:
            self._add_ltl(c, results.get(c))

    def _add_ltl(self, carrier, r):
        if isinstance(r, dict):
            ins = round(r.get('ins') or 0)    # страхование перевозчика (входит в его цену) — берётся вместо своего
            self.offers.append({'src': carrier.NAME, 'kind': 'ltl', 'price': round(r['price'] + self.unload), 'base': round(r['price'] - ins), 'ins': ins,
                                'unload': round(self.unload), 'door': bool(r.get('door')),
                                'days': r.get('days'), 'complete': True, 'at': self.at, 'url': carrier.SITE,
                                'note': r.get('note', '') + ('; + разгрузка по тарифам программы' if self.unload else '')})
            return
        msg = Http.error(r) if r else 'нет ответа за %d с' % self.WAIT
        if isinstance(r, urllib.error.HTTPError) and r.code == 403:
            msg += carrier.HINT_403
        self.errors.append({'src': carrier.NAME, 'msg': msg, 'url': carrier.SITE})


# ---------------------------------------------------------------- тарифы из «Настроек»: проверка на границе
class TariffInput:
    """Тарифы доставки из «Настроек» (PUT /api/logistics): объект JSON до 100 КБ; счета для сверки тарифов (facts) —
    не больше 300, только известные поля: дата ГГГГ-ММ-ДД, маршрут до 120 знаков, расстояние 1–20 000 км, машина, сумма.
    Ошибка — ValueError с понятным текстом."""
    MAX_BYTES = 100000
    MAX_FACTS = 300

    @classmethod
    def check(cls, d):
        if not isinstance(d, dict) or len(json.dumps(d)) > cls.MAX_BYTES:
            raise ValueError('Неверный формат тарифов')
        facts = d.get('facts')
        if facts is None:
            return d
        if not isinstance(facts, list) or len(facts) > cls.MAX_FACTS:
            raise ValueError('Счетов для сверки тарифов — не больше %d' % cls.MAX_FACTS)
        out = []
        for f in facts:
            if not isinstance(f, dict):
                raise ValueError('Неверный формат счёта для сверки тарифов')
            km, total = number(f.get('km')), number(f.get('sum'))
            if not (km and 0 < km <= 20000) or not (total and 0 < total <= 1e9):
                raise ValueError('Счёт для сверки тарифов: расстояние от 1 до 20 000 км и сумма больше нуля')
            at = str(f.get('at') or '')[:10]
            if at and not re.match(r'^\d{4}-\d{2}-\d{2}$', at):
                raise ValueError('Дата счёта для сверки тарифов — в формате ГГГГ-ММ-ДД')
            out.append({'at': at, 'route': str(f.get('route') or '')[:120], 'km': km, 'cls': str(f.get('cls') or '')[:40], 'sum': total})
        d['facts'] = out
        return d


# ---------------------------------------------------------------- автообновление ставок по ATI.SU
def auto_settings(store):
    t = store.kv_get('logistics') or {}
    a = t.get('auto') or {}
    return {'on': a.get('on', True), 'days': int(a.get('days') or 1), 'routes': a.get('routes') or REF_ROUTES, 'period': int(a.get('period') or 30)}


def auto_refresh(store, force=False, log=print):
    """Ставки ₽/км классов машин — верхняя граница средних ставок ATI.SU по опорным направлениям (максимум по направлениям).
    Результат — kv «logisticsAuto»: {at, classes:{id:{km, src, routes:[{route, km, avg, trip, dist}]}}, errors}. По длине направлений
    и цене рейса программа делит ставку на два участка — до 1 000 км и дальше (Freight.fromAuto). Ставки, закреплённые вручную,
    не меняются (это делает интерфейс)."""
    if not providers(store)['ati']:
        return None
    cfg = auto_settings(store)
    last = store.kv_get('logisticsAuto') or {}
    if not force:
        if not cfg['on']:
            return None
        try:
            if last.get('at') and datetime.fromisoformat(last['at']) > datetime.now() - timedelta(days=cfg['days']):
                return None
        except ValueError:
            pass
    if not _lock.acquire(blocking=False):
        return None
    try:
        out, errors, ati = {}, [], AtiDirections(store)
        for cid, (car, ton) in Ati.CAR_CLASSES.items():
            best, rows = None, []
            for r in cfg['routes']:
                a, _, b = str(r).partition('—')
                if not b:
                    a, _, b = str(r).partition('-')
                try:
                    d = ati.find(a.strip(), b.strip())
                    if not d:
                        raise ValueError('направления нет в «Средних ставках»')
                    p = Ati.price(store, d, car, ton, cfg['period'])
                    if p['upperKm']:
                        # длина направления и цена рейса — для тарифа в два участка (ставка до 1 000 км и дальше считается в программе)
                        dist = round(p['upperRub'] / p['upperKm']) if p['upperRub'] and p['upperKm'] else None
                        rows.append({'route': r.strip(), 'km': round(p['upperKm'], 1), 'avg': p['avgKm'] and round(p['avgKm'], 1),
                                     'trip': round(p['upperRub']) if p['upperRub'] else None, 'dist': dist})
                        best = max(best or 0, p['upperKm'])
                except Exception as e:
                    errors.append('%s, %s: %s' % (r.strip(), cid, Http.error(e)))
            if best:
                out[cid] = {'km': round(best), 'routes': rows,
                            'src': 'ATI.SU «Средние ставки»: верхняя граница за %d дн., максимум по %d направл., с НДС' % (cfg['period'], len(rows))}
        rec = {'at': _now(), 'classes': out, 'errors': errors[:30]}
        store.kv_set('logisticsAuto', rec)
        return rec
    finally:
        _lock.release()
