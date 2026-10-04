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
      https://capi.tk-kit.com/1.1/order/calculate, города — /1.1/tdd/city/get-list (коды КЛАДР)

Итог расчёта — максимальное из полных предложений (включая расчёт по тарифам «Настроек») со сноской, откуда цена.
Ответы сервисов разбираются терпимо к мелким отличиям формата; ошибка сервиса показывается как есть и не мешает остальным.
"""
import json
import re
import threading
import urllib.error
import urllib.parse
from datetime import date, datetime, timedelta

from counterparty import _http

ATI_BASE = 'https://api.ati.su/priceline/license/v2'
PEC_CALC = 'https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php'
PEC_TOWNS = 'https://pecom.ru/ru/calc/towns.php'
DELLIN_CALC = 'https://api.dellin.ru/v2/calculator.json'
KIT_BASE = 'https://capi.tk-kit.com'
CDEK_BASE = 'https://api.cdek.ru/v2'
VOZ_URL = 'https://vozovoz.ru/api/'
NRG_BASES = ('https://api2.nrg-tk.ru/v2', 'https://api2.nrg-tk.pro/v2')
DICT_DAYS = 7

# класс машины в тарифах → тип кузова и тоннаж «Средних ставок» ATI.SU
ATI_CLASS = {'gazel': ('tent', 1.5), 't5': ('tent', 5), 't10': ('tent', 10), 'tent20': ('tent', 20),
             'flat': ('open', 20), 'lowbed': ('tral', 20)}
REF_ROUTES = ['Москва — Санкт-Петербург', 'Москва — Казань', 'Москва — Екатеринбург', 'Москва — Краснодар', 'Москва — Новосибирск']
# сборный груз: место не тяжелее и не больше (т, м) — иначе только отдельной машиной
LTL_MAX = {'m': 3.0, 'l': 6.0, 'w': 2.4, 'h': 2.5, 'total': 20.0}

_lock = threading.Lock()


def _now():
    return datetime.now().isoformat(timespec='seconds')


def cnorm(s):
    s = str(s or '').lower().replace('ё', 'е')
    s = re.split(r'[,(]', s)[0]
    s = re.sub(r'^(г\.?|город)\s+', '', s.strip())
    return re.sub(r'[\s\-‐–—]+', ' ', s).strip()


def keys(store):
    return store.kv_get('integrations') or {}


def providers(store):
    k = keys(store)
    return {'ati': bool(k.get('atiToken')), 'pec': True, 'dellin': bool(k.get('dellinKey')), 'kit': bool(k.get('kitToken')),
            'cdek': bool(k.get('cdekId') and k.get('cdekSecret')), 'vozovoz': bool(k.get('vozovozToken')), 'nrg': True}


def _err(e):
    if isinstance(e, urllib.error.HTTPError):
        try:
            body = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            body = ''
        return 'HTTP %s%s' % (e.code, (': ' + body) if body else '')
    return str(e)[:300] or e.__class__.__name__


def _num(v):
    try:
        x = float(str(v).replace(' ', '').replace('\xa0', '').replace(',', '.'))
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def _find(obj, pred, depth=0):
    """Первый вложенный объект, для которого pred(obj) истинно (обход в ширину словарей и списков)."""
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


def _dict_cache(store, name, loader):
    c = store.kv_get('lgdict:' + name) or {}
    try:
        fresh = c.get('at') and datetime.fromisoformat(c['at']) > datetime.now() - timedelta(days=DICT_DAYS)
    except ValueError:
        fresh = False
    if fresh and c.get('items'):
        return c['items']
    items = loader()
    store.kv_set('lgdict:' + name, {'at': _now(), 'items': items})
    return items


# ---------------------------------------------------------------- ATI.SU «Средние ставки»
def _ati_headers(store):
    return {'Authorization': 'Bearer ' + keys(store).get('atiToken', ''), 'Content-Type': 'application/json'}


def ati_directions(store):
    def load():
        j = _http(ATI_BASE + '/all_directions', headers=_ati_headers(store))
        rows = j if isinstance(j, list) else (_find(j, lambda o: isinstance(o, list) and o and isinstance(o[0], dict) and 'FromCityId' in o[0]) or [])
        return [{'fromId': r.get('FromCityId'), 'from': r.get('FromCity') or '', 'toId': r.get('ToCityId'), 'to': r.get('ToCity') or '',
                 'info': r.get('DirectionInfo')} for r in rows if isinstance(r, dict) and r.get('FromCityId') and r.get('ToCityId')]
    return _dict_cache(store, 'ati', load)


def ati_direction(store, frm, to):
    a, b = cnorm(frm), cnorm(to)
    for d in ati_directions(store):
        if cnorm(d['from']) == a and cnorm(d['to']) == b:
            return d
    return None


def ati_price(store, d, car, tonnage, days=30):
    """Средняя ставка и разброс по направлению: верхняя граница за рейс (₽) и за км (₽/км), с НДС."""
    end = date.today()
    body = {'From': {'CityId': d['fromId']}, 'To': {'CityId': d['toId']}, 'FromCityId': d['fromId'], 'ToCityId': d['toId'],
            'CarType': car, 'Tonnage': tonnage, 'DateFrom': (end - timedelta(days=days)).isoformat() + 'T00:00:00',
            'DateTo': end.isoformat() + 'T23:59:59', 'WithNds': True}
    j = _http(ATI_BASE + '/average_prices', data=body, headers=_ati_headers(store), method='POST')
    rec = j[0] if isinstance(j, list) and j else j
    rub = _find(rec, lambda o: isinstance(o, dict) and 'UpperPrice' in o and o is not rec) if isinstance(rec, dict) else None
    rub = (rec or {}).get('PricesInRub') or rub or {}
    per_km = rec if isinstance(rec, dict) and 'UpperPrice' in rec else (_find(rec, lambda o: isinstance(o, dict) and 'UpperPrice' in o and o is not rub) or {})
    out = {'upperRub': _num(rub.get('UpperPrice')), 'avgRub': _num(rub.get('AveragePrice')), 'lowRub': _num(rub.get('BottomPrice')),
           'upperKm': _num(per_km.get('UpperPrice')), 'avgKm': _num(per_km.get('AveragePrice')),
           'count': None}
    cnt = _find(rec, lambda o: isinstance(o, dict) and any(k in o for k in ('LoadsCount', 'CargoCount', 'Count')))
    if cnt:
        out['count'] = _num(next(cnt[k] for k in ('LoadsCount', 'CargoCount', 'Count') if k in cnt))
    if out['upperRub'] is None and out['upperKm'] is None:
        raise ValueError('в ответе ATI.SU нет ставок по направлению (%s → %s, %s %s т)' % (d['from'], d['to'], car, tonnage))
    return out


# ---------------------------------------------------------------- ПЭК (открытый калькулятор)
def pec_towns(store):
    def load():
        j = _http(PEC_TOWNS)
        out = {}
        for region, towns in (j.items() if isinstance(j, dict) else []):
            if isinstance(towns, dict):
                for tid, name in towns.items():
                    n = cnorm(name)
                    if n and n not in out:
                        out[n] = tid
        return out
    return _dict_cache(store, 'pec', load)


def _pick(d, names):
    """Первый из городов (точный, затем ближайшие крупные), который есть в справочнике перевозчика."""
    names = names if isinstance(names, (list, tuple)) else [names]
    for n in names:
        if d.get(cnorm(n)):
            return d[cnorm(n)], n
    return None, names[0] if names else ''


def pec_quote(store, frm, to, places):
    t = pec_towns(store)
    (a, fa), (b, tb) = _pick(t, frm), _pick(t, to)
    if not a or not b:
        raise ValueError('город не найден в справочнике ПЭК: %s' % (fa if not a else tb))
    q = [('take[town]', a), ('deliver[town]', b)]
    units = [p for p in places for _ in range(int(p['qty']))]
    for k, p in enumerate(units):   # место: ширина, длина, высота (м), объём (м³), вес (кг), негабарит, жёсткая упаковка
        q += [('places[%d][]' % k, v) for v in (p['w'], p['l'], p['h'], round(p['l'] * p['w'] * p['h'], 3), round(p['m'] * 1000),
                                                 1 if max(p['l'], p['w'], p['h']) > 3 or p['m'] > 0.5 else 0, 0)]
    j = _http(PEC_CALC + '?' + urllib.parse.urlencode(q))
    auto = j.get('auto') if isinstance(j, dict) else None
    if not auto:
        raise ValueError('ПЭК: автоперевозка недоступна для этого груза' + ((' — ' + str(j.get('error'))) if isinstance(j, dict) and j.get('error') else ''))
    nums = [n for n in (_num(x) for x in (auto if isinstance(auto, list) else [auto])) if n is not None]
    if not nums:
        raise ValueError('ПЭК: в ответе нет стоимости')
    total = nums[-1]
    for k, v in j.items():                      # обязательные надбавки (ADD…, негабарит)
        if re.match(r'^(ADD|add)', str(k)) and isinstance(v, list):
            n = [x for x in (_num(y) for y in v) if x is not None]
            if n:
                total += n[-1]
    door = 0
    for k in ('take', 'deliver'):                # забор груза у отправителя и доставка получателю
        v = j.get(k)
        n = [x for x in (_num(y) for y in (v if isinstance(v, list) else [v])) if x is not None] if v is not None else []
        if n:
            total += n[-1]
            door += 1
    days = None
    per = _find(j, lambda o: isinstance(o, dict) and any(k in o for k in ('periods_days', 'periods')))
    if per:
        m = re.findall(r'\d+', str(per.get('periods_days') or per.get('periods')))
        days = int(m[-1]) if m else None
    via = '' if (fa, tb) == (frm[0] if isinstance(frm, list) else frm, to[0] if isinstance(to, list) else to) else ' (%s → %s)' % (fa, tb)
    return {'price': round(total), 'days': days, 'door': door == 2,
            'note': ('сборный груз, дверь в дверь (забор и доставка ПЭК)' if door == 2 else 'сборный груз, межтерминальная перевозка ПЭК') + via}


# ---------------------------------------------------------------- Деловые Линии
def dellin_quote(store, frm_addr, to_addr, places):
    tw = {'worktimeStart': '09:00', 'worktimeEnd': '18:00'}
    units = [p for p in places for _ in range(int(p['qty']))]
    over = [u for u in units if max(u['l'], u['w'], u['h']) > 3 or u['m'] > 0.1]
    body = {'appkey': keys(store).get('dellinKey', ''),
            'delivery': {'deliveryType': {'type': 'auto'},
                         'derival': {'produceDate': (date.today() + timedelta(days=1)).isoformat(), 'variant': 'address',
                                     'address': {'search': frm_addr}, 'time': tw},
                         'arrival': {'variant': 'address', 'address': {'search': to_addr}, 'time': tw}},
            'cargo': {'quantity': len(units), 'length': max(u['l'] for u in units), 'width': max(u['w'] for u in units),
                      'height': max(u['h'] for u in units), 'weight': round(max(u['m'] for u in units) * 1000, 1),
                      'totalVolume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3), 'totalWeight': round(sum(u['m'] for u in units) * 1000, 1),
                      'oversizedWeight': round(sum(u['m'] for u in over) * 1000, 1), 'oversizedVolume': round(sum(u['l'] * u['w'] * u['h'] for u in over), 3),
                      'hazardClass': 0}}
    try:
        j = _http(DELLIN_CALC, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception:
            raise ValueError(_err(e))
    errs = j.get('errors') if isinstance(j, dict) else None
    if errs:
        msg = '; '.join(str((x or {}).get('detail') or (x or {}).get('title') or x) for x in (errs if isinstance(errs, list) else [errs]))[:300]
        raise ValueError('Деловые Линии: ' + msg)
    d = (j or {}).get('data') or {}
    price = _num(d.get('price'))
    if price is None:
        parts = [_num((d.get(k) or {}).get('price')) for k in ('derival', 'intercity', 'arrival')]
        price = sum(x for x in parts if x) or None
    if not price:
        raise ValueError('Деловые Линии: в ответе нет стоимости')
    days = None
    od = d.get('orderDates') or {}
    try:
        a, b = od.get('pickup') or od.get('derivalFromOspSender'), od.get('arrivalToOspReceiver') or od.get('giveoutFromOspReceiver')
        if a and b:
            days = (datetime.fromisoformat(str(b)[:10]) - datetime.fromisoformat(str(a)[:10])).days + 1
    except ValueError:
        pass
    return {'price': round(price), 'days': days, 'door': True, 'note': 'сборный груз, от адреса до адреса'}


# ---------------------------------------------------------------- КИТ
def _kit_headers(store):
    return {'Authorization': 'Bearer ' + keys(store).get('kitToken', ''), 'Content-Type': 'application/json'}


def kit_cities(store):
    def load():
        j = _http(KIT_BASE + '/1.1/tdd/city/get-list', data={}, headers=_kit_headers(store), method='POST')
        rows = j if isinstance(j, list) else (_find(j, lambda o: isinstance(o, list) and o and isinstance(o[0], dict) and 'code' in o[0]) or [])
        out = {}
        for r in rows:
            n = cnorm(r.get('name'))
            if n and r.get('code') and n not in out:
                out[n] = r['code']
        return out
    return _dict_cache(store, 'kit', load)


def kit_quote(store, frm, to, places, declared):
    c = kit_cities(store)
    (a, fa), (b, tb) = _pick(c, frm), _pick(c, to)
    if not a or not b:
        raise ValueError('город не найден в справочнике КИТ: %s' % (fa if not a else tb))
    body = {'city_pickup_code': a, 'city_delivery_code': b, 'declared_price': round(declared or 0), 'confirmation_price': 1,
            'places': [{'count_place': int(p['qty']), 'height': round(p['h'] * 100), 'width': round(p['w'] * 100), 'length': round(p['l'] * 100),
                        'weight': round(p['m'] * 1000, 1), 'volume': round(p['l'] * p['w'] * p['h'], 3)} for p in places],
            'pick_up': 1, 'delivery': 1, 'insurance': 0, 'currency_code': 'RUB'}   # страхование — своё, единое для всех предложений
    j = _http(KIT_BASE + '/1.1/order/calculate', data=body, headers=_kit_headers(store), method='POST')
    rec = j[0] if isinstance(j, list) and j else j
    tariffs = []
    for name in ('standart', 'economy', 'express'):
        t = (rec or {}).get(name) if isinstance(rec, dict) else None
        if isinstance(t, dict) and _num(t.get('cost')):
            tariffs.append((name, _num(t['cost']), t.get('time')))
    if not tariffs:
        raise ValueError('КИТ: в ответе нет стоимости' + ((' — ' + str((rec or {}).get('message'))) if isinstance(rec, dict) and rec.get('message') else ''))
    name, cost, tm = next((t for t in tariffs if t[0] == 'standart'), tariffs[0])
    days = int(re.findall(r'\d+', str(tm))[-1]) if tm and re.findall(r'\d+', str(tm)) else None
    return {'price': round(cost), 'days': days, 'door': True, 'note': 'сборный груз, от адреса до адреса (тариф %s)' % name}


# ---------------------------------------------------------------- СДЭК (API v2, OAuth client_credentials)
_cdek_tok = {}


def _cdek_headers(store):
    k = keys(store)
    t = _cdek_tok.get(k.get('cdekId'))
    if not t or t[1] < datetime.now():
        j = _http(CDEK_BASE + '/oauth/token', data={'grant_type': 'client_credentials', 'client_id': k.get('cdekId', ''),
                                                    'client_secret': k.get('cdekSecret', '')}, method='POST')
        if not j.get('access_token'):
            raise ValueError('СДЭК: не выдан токен — проверьте идентификатор и секретный ключ')
        t = (j['access_token'], datetime.now() + timedelta(seconds=int(j.get('expires_in') or 3600) - 60))
        _cdek_tok[k.get('cdekId')] = t
    return {'Authorization': 'Bearer ' + t[0], 'Content-Type': 'application/json'}


def cdek_city(store, names, h):
    """Код города СДЭК (кэш в kv «lgdict:cdek»): точный город, затем ближайшие крупные."""
    names = names if isinstance(names, (list, tuple)) else [names]
    c = store.kv_get('lgdict:cdek') or {}
    items = c.get('items') or {}
    for n in names:
        key = cnorm(n)
        if not key:
            continue
        if key not in items:
            j = _http(CDEK_BASE + '/location/cities?' + urllib.parse.urlencode({'city': n, 'country_codes': 'RU', 'size': 10}), headers=h)
            rows = j if isinstance(j, list) else []
            hit = next((r for r in rows if cnorm(r.get('city')) == key), None)
            items[key] = hit.get('code') if hit else None
            store.kv_set('lgdict:cdek', {'at': _now(), 'items': items})
        if items.get(key):
            return items[key], n
    return None, names[0] if names else ''


def cdek_quote(store, frm, to, places, frm_addr='', to_addr=''):
    h = _cdek_headers(store)
    (a, fa), (b, tb) = cdek_city(store, frm, h), cdek_city(store, to, h)
    if not a or not b:
        raise ValueError('город не найден в справочнике СДЭК: %s' % (fa if not a else tb))
    pk = [{'weight': int(round(p['m'] * 1000)), 'length': int(round(p['l'] * 100)), 'width': int(round(p['w'] * 100)),
           'height': int(round(p['h'] * 100))} for p in places for _ in range(int(p['qty']))]
    loc = lambda code, addr: dict({'code': code}, **({'address': addr} if addr else {}))
    j = _http(CDEK_BASE + '/calculator/tarifflist', data={'type': 2, 'currency': 1, 'lang': 'rus', 'from_location': loc(a, frm_addr),
                                                          'to_location': loc(b, to_addr), 'packages': pk}, headers=h, method='POST')
    if isinstance(j, dict) and j.get('errors'):
        raise ValueError('СДЭК: ' + '; '.join(str((e or {}).get('message') or e) for e in j['errors'])[:300])
    rows = [r for r in (j.get('tariff_codes') if isinstance(j, dict) else []) or [] if _num(r.get('delivery_sum'))]
    door = [r for r in rows if r.get('delivery_mode') == 1]       # 1 — дверь-дверь
    if not door:
        raise ValueError('СДЭК: нет тарифов «дверь — дверь» для такого груза' + (' (есть только до пункта выдачи)' if rows else ''))
    r = min(door, key=lambda x: _num(x['delivery_sum']))
    via = '' if (fa, tb) == (frm[0] if isinstance(frm, list) else frm, to[0] if isinstance(to, list) else to) else ' (%s → %s)' % (fa, tb)
    return {'price': round(_num(r['delivery_sum'])), 'days': r.get('period_max') or r.get('period_min'), 'door': True,
            'note': 'дверь в дверь, тариф «%s»%s' % (r.get('tariff_name') or r.get('tariff_code'), via)}


# ---------------------------------------------------------------- Возовоз (API 2.5: object/action, токен в GET-параметре)
def _has_street(addr):
    return bool(re.search(r'\d', str(addr or ''))) and ',' in str(addr or '')


def vozovoz_quote(store, frm, to, frm_addr, to_addr, places):
    units = [p for p in places for _ in range(int(p['qty']))]
    point = lambda city, addr: dict({'location': city}, **({'address': addr} if _has_street(addr) else {'terminal': 'default'}))
    body = {'object': 'price', 'action': 'get', 'params': {
        'cargo': {'dimension': {'quantity': len(units), 'volume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3),
                                'weight': round(sum(u['m'] for u in units) * 1000, 1),
                                'max': {'length': max(u['l'] for u in units), 'width': max(u['w'] for u in units),
                                        'height': max(u['h'] for u in units), 'weight': round(max(u['m'] for u in units) * 1000, 1)}}},
        'gateway': {'dispatch': {'point': point(frm, frm_addr)}, 'destination': {'point': point(to, to_addr)}}}}
    j = _http(VOZ_URL + '?' + urllib.parse.urlencode({'token': keys(store).get('vozovozToken', '')}), data=body,
              headers={'Content-Type': 'application/json'}, method='POST')
    if isinstance(j, dict) and j.get('error'):
        e = j['error']
        raise ValueError('Возовоз: ' + str((e or {}).get('message') if isinstance(e, dict) else e)[:300])
    r = (j or {}).get('response') or {}
    price = _num(r.get('price'))
    if not price:
        raise ValueError('Возовоз: в ответе нет стоимости')
    ins = sum(_num(x.get('price')) or 0 for x in r.get('service') or [] if re.search(r'страхов', str(x.get('name') or ''), re.I))
    door = _has_street(frm_addr) and _has_street(to_addr)
    dt = r.get('deliveryTime') or {}
    return {'price': round(price - ins), 'days': dt.get('to') or dt.get('from'), 'door': door,
            'note': ('дверь в дверь' if door else 'от терминала до терминала') + (' (без их страхования — своё, единое)' if ins else '')}


# ---------------------------------------------------------------- Энергия (открытый расчёт без ключа)
def _nrg(path, data=None):
    err = None
    h = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    for base in NRG_BASES:
        try:
            return _http(base + path, data=data, headers=h, method='POST' if data is not None else None)
        except Exception as e:
            err = e
    raise err


def nrg_cities(store):
    def load():
        j = _nrg('/cities?lang=ru')
        rows = j if isinstance(j, list) else (_find(j, lambda o: isinstance(o, list) and o and isinstance(o[0], dict) and 'id' in o[0] and 'name' in o[0]) or [])
        out = {}
        for r in rows:
            n = cnorm(r.get('name'))
            if n and n not in out:
                out[n] = r.get('id')
        return out
    return _dict_cache(store, 'nrg', load)


def nrg_quote(store, frm, to, places, declared):
    c = nrg_cities(store)
    (a, fa), (b, tb) = _pick(c, frm), _pick(c, to)
    if not a or not b:
        raise ValueError('город не найден в справочнике Энергии: %s' % (fa if not a else tb))
    items = [{'weight': round(p['m'] * 1000, 1), 'width': p['w'], 'height': p['h'], 'length': p['l']} for p in places for _ in range(int(p['qty']))]
    j = _nrg('/price', {'idCityFrom': a, 'idCityTo': b, 'cover': 0, 'idCurrency': 0, 'items': items, 'declaredCargoPrice': 0, 'idClient': 0})
    if isinstance(j, dict) and (j.get('message') or j.get('error')) and not j.get('transfer'):
        raise ValueError('Энергия: ' + str(j.get('message') or j.get('error'))[:300])
    tr = (j or {}).get('transfer') or []
    tr = [t for t in tr if isinstance(t, dict) and _num(t.get('price'))]
    if not tr:
        raise ValueError('Энергия: в ответе нет стоимости перевозки')
    t = next((x for x in tr if re.search(r'авто', str(x.get('type') or ''), re.I)), None) or min(tr, key=lambda x: _num(x['price']))
    price, door = _num(t['price']), 0
    for k in ('request', 'delivery'):            # забор у отправителя и доставка получателю
        v = (j or {}).get(k)
        n = _num(v.get('price')) if isinstance(v, dict) else None
        if n:
            price += n
            door += 1
    days = re.findall(r'\d+', str(t.get('interval') or ''))
    return {'price': round(price), 'days': int(days[-1]) if days else None, 'door': door == 2,
            'note': ('дверь в дверь (забор и доставка Энергии)' if door == 2 else 'от терминала до терминала') + ', ' + str(t.get('type') or 'авто').lower()}


# ---------------------------------------------------------------- сводка предложений
def ltl_ok(places):
    units = [p for p in places for _ in range(int(p['qty']))]
    if not units:
        return False, 'нет груза'
    big = [u for u in units if u['m'] > LTL_MAX['m'] or sorted([u['l'], u['w']])[1] > LTL_MAX['l'] or min(u['l'], u['w']) > LTL_MAX['w'] or u['h'] > LTL_MAX['h']]
    if big:
        return False, 'есть место тяжелее %s т или больше %s × %s × %s м — сборным грузом не принимают' % (
            str(LTL_MAX['m']).replace('.', ','), str(LTL_MAX['l']).replace('.', ','), str(LTL_MAX['w']).replace('.', ','), str(LTL_MAX['h']).replace('.', ','))
    if sum(u['m'] for u in units) > LTL_MAX['total']:
        return False, 'груз тяжелее %d т — нужна отдельная машина' % LTL_MAX['total']
    return True, ''


def quote(store, req):
    """req: from{name, addr}, to{name, addr}, km, places[{l,w,h,m,qty}], vehicles[{id, name, extras}], unload, model, declared.
    Возвращает предложения (полные и частичные), ошибки по источникам и выбранное — максимальное полное."""
    frm, to = req.get('from') or {}, req.get('to') or {}
    km = _num(req.get('km')) or 0
    places = [{'l': float(p['l']), 'w': float(p['w']), 'h': float(p['h']), 'm': float(p['m']), 'qty': int(p.get('qty') or 1)}
              for p in (req.get('places') or []) if all(_num(p.get(k)) for k in ('l', 'w', 'h', 'm'))]
    unload = _num(req.get('unload')) or 0
    pv = providers(store)
    offers, errors, at = [], [], _now()
    model = _num(req.get('model'))
    if model:
        offers.append({'src': 'Тарифы «Настроек»', 'kind': 'model', 'price': round(model), 'complete': True,
                       'note': req.get('modelNote') or 'расчёт по тарифам программы', 'at': at})
    # отдельная машина — ATI.SU: верхняя граница средних ставок по направлению за 30 дней
    if pv['ati'] and req.get('vehicles'):
        try:
            # направления в «Средних ставках» — между крупными городами: нет точного — ближайший крупный город (alt)
            d, via = None, ''
            for fa in [frm.get('name')] + list(frm.get('alt') or []):
                for tb in [to.get('name')] + list(to.get('alt') or []):
                    d = ati_direction(store, fa, tb)
                    if d:
                        if fa != frm.get('name') or tb != to.get('name'):
                            via = ' по направлению %s → %s (ближайшие крупные города)' % (d['from'], d['to'])
                        break
                if d:
                    break
            if not d:
                raise ValueError('направления %s → %s нет в «Средних ставках» ATI.SU' % (frm.get('name'), to.get('name')))
            total, parts = 0, []
            for v in req['vehicles']:
                car, ton = ATI_CLASS.get(v.get('id'), ('tent', 20))
                p = ati_price(store, d, car, ton)
                run = max(p['upperRub'] or 0, (p['upperKm'] or 0) * km)
                total += run + (_num(v.get('extras')) or 0)
                parts.append('%s: %s ₽ (верх средних ставок ATI.SU, %s %s т%s)' % (v.get('name') or v.get('id'), '{:,.0f}'.format(run).replace(',', ' '),
                             {'tent': 'тент', 'open': 'открытая', 'tral': 'трал'}.get(car, car), str(ton).replace('.', ','),
                             ', %s ₽/км' % '{:,.0f}'.format(p['upperKm']).replace(',', ' ') if p['upperKm'] else ''))
            base = total
            total += unload
            offers.append({'src': 'ATI.SU «Средние ставки»', 'kind': 'ftl', 'price': round(total), 'base': round(base), 'unload': round(unload), 'door': True, 'complete': True, 'at': at,
                           'note': ('ставка' + via + ': ' if via else '') + '; '.join(parts) + ('; разгрузка и разрешения — по тарифам программы' if unload or any(_num(v.get('extras')) for v in req['vehicles']) else ''),
                           'url': 'https://ati.su/rates'})
        except Exception as e:
            errors.append({'src': 'ATI.SU', 'msg': _err(e)})
    # сборный груз — если место и общий вес позволяют
    ok, why = ltl_ok(places)
    if places and not ok:
        errors.append({'src': 'Сборный груз (ПЭК, Деловые Линии, КИТ, СДЭК, Возовоз, Энергия)', 'msg': why, 'skip': True})
    if places and ok:
        jobs = [('ПЭК', 'https://pecom.ru/services-are/shipping-request/', lambda: pec_quote(store, [frm.get('name')] + list(frm.get('alt') or []), [to.get('name')] + list(to.get('alt') or []), places))]
        if pv['dellin']:
            jobs.append(('Деловые Линии', 'https://www.dellin.ru/requests/', lambda: dellin_quote(store, frm.get('addr') or frm.get('name'), to.get('addr') or to.get('name'), places)))
        fl, tl = [frm.get('name')] + list(frm.get('alt') or []), [to.get('name')] + list(to.get('alt') or [])
        jobs.append(('Энергия', 'https://nrg-tk.ru/client/calculator/', lambda: nrg_quote(store, fl, tl, places, _num(req.get('declared')))))
        if pv['cdek']:
            jobs.append(('СДЭК', 'https://www.cdek.ru/ru/calculate', lambda: cdek_quote(store, fl, tl, places, frm.get('addr'), to.get('addr'))))
        if pv['vozovoz']:
            jobs.append(('Возовоз', 'https://vozovoz.ru/calculate/', lambda: vozovoz_quote(store, frm.get('name'), to.get('name'), frm.get('addr'), to.get('addr'), places)))
        if pv['kit']:
            jobs.append(('КИТ', 'https://tk-kit.ru/calculate', lambda: kit_quote(store, [frm.get('name')] + list(frm.get('alt') or []), [to.get('name')] + list(to.get('alt') or []), places, _num(req.get('declared')))))
        res = {}

        def run(name, fn):
            try:
                res[name] = fn()
            except Exception as e:
                res[name] = e
        th = [threading.Thread(target=run, args=(n, f), daemon=True) for n, _u, f in jobs]
        for t in th:
            t.start()
        for t in th:
            t.join(40)
        for name, url, _f in jobs:
            r = res.get(name)
            if isinstance(r, dict):
                offers.append({'src': name, 'kind': 'ltl', 'price': round(r['price'] + unload), 'base': round(r['price']), 'unload': round(unload), 'door': bool(r.get('door')),
                               'days': r.get('days'), 'complete': True, 'at': at, 'url': url,
                               'note': r.get('note', '') + ('; + разгрузка по тарифам программы' if unload else '')})
            else:
                errors.append({'src': name, 'msg': _err(r) if r else 'нет ответа за 40 с'})
    full = [o for o in offers if o.get('complete')]
    best = max(full, key=lambda o: o['price']) if full else None
    return {'offers': offers, 'errors': errors, 'best': best, 'at': at, 'providers': pv}


# ---------------------------------------------------------------- автообновление ставок по ATI.SU
def auto_settings(store):
    t = store.kv_get('logistics') or {}
    a = t.get('auto') or {}
    return {'on': a.get('on', True), 'days': int(a.get('days') or 1), 'routes': a.get('routes') or REF_ROUTES, 'period': int(a.get('period') or 30)}


def auto_refresh(store, force=False, log=print):
    """Ставки ₽/км классов машин — верхняя граница средних ставок ATI.SU по опорным направлениям (максимум по направлениям).
    Результат — kv «logisticsAuto»: {at, classes:{id:{km, src, routes}}, errors}. Ставки, закреплённые вручную, не меняются (это делает интерфейс)."""
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
        out, errors = {}, []
        for cid, (car, ton) in ATI_CLASS.items():
            best, rows = None, []
            for r in cfg['routes']:
                a, _, b = str(r).partition('—')
                if not b:
                    a, _, b = str(r).partition('-')
                try:
                    d = ati_direction(store, a.strip(), b.strip())
                    if not d:
                        raise ValueError('направления нет в «Средних ставках»')
                    p = ati_price(store, d, car, ton, cfg['period'])
                    if p['upperKm']:
                        rows.append({'route': r.strip(), 'km': round(p['upperKm'], 1), 'avg': p['avgKm'] and round(p['avgKm'], 1)})
                        best = max(best or 0, p['upperKm'])
                except Exception as e:
                    errors.append('%s, %s: %s' % (r.strip(), cid, _err(e)))
            if best:
                out[cid] = {'km': round(best), 'routes': rows,
                            'src': 'ATI.SU «Средние ставки»: верхняя граница за %d дн., максимум по %d направл., с НДС' % (cfg['period'], len(rows))}
        rec = {'at': _now(), 'classes': out, 'errors': errors[:30]}
        store.kv_set('logisticsAuto', rec)
        return rec
    finally:
        _lock.release()
