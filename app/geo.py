"""Адреса и расстояния для доставки по России: подсказки DaData или Nominatim, маршруты OSRM, короткие ссылки карт."""

import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from counterparty import http_json

DADATA = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs'
NOMINATIM = 'https://nominatim.openstreetmap.org'
OSRM = 'https://router.project-osrm.org/route/v1/driving/'
SHORT_HOSTS = ('goo.gl', 'maps.app.goo.gl', 'g.co', 'yandex.ru', 'yandex.com', 'ya.ru', 'yandex.kz', 'yandex.by')
_nom_lock = threading.Lock()
_nom_last = [0.0]


def _key(store) -> str:
    return (store.kv_get('integrations', {}) or {}).get('dadataKey', '')


def _nom(path: str, params: dict):
    """Nominatim: не чаще запроса в секунду, свой User-Agent."""
    with _nom_lock:
        wait = 1.05 - (time.time() - _nom_last[0])
        if wait > 0:
            time.sleep(wait)
        _nom_last[0] = time.time()
    params = dict(params, format='jsonv2', addressdetails=1)
    params.setdefault('accept-language', 'ru')
    return http_json(
        NOMINATIM + path + '?' + urllib.parse.urlencode(params),
        headers={'User-Agent': 'KP-Pnevmotekh/3 (konstruktor KP)'},
    )


def _f(v) -> float | None:
    try:
        return round(float(v), 6)
    except (TypeError, ValueError):
        return None


def _dd_item(s: dict) -> dict:
    d = s.get('data') or {}
    city = d.get('city') or d.get('settlement') or d.get('area') or d.get('region') or ''
    return {
        'value': s.get('value') or '',
        'lat': _f(d.get('geo_lat')),
        'lon': _f(d.get('geo_lon')),
        'city': city,
        'region': d.get('region_with_type') or '',
        'exact': str(d.get('qc_geo')) in ('0', '1'),
        'src': 'DaData',
    }


def _nom_item(r: dict) -> dict:
    a = r.get('address') or {}
    city = (
        a.get('city') or a.get('town') or a.get('village') or a.get('hamlet') or a.get('county') or a.get('state') or ''
    )
    parts = [a.get('state'), city if city != a.get('state') else '', a.get('road'), a.get('house_number')]
    value = ', '.join(p for p in parts if p) or r.get('display_name', '')
    return {
        'value': value,
        'lat': _f(r.get('lat')),
        'lon': _f(r.get('lon')),
        'city': city,
        'region': a.get('state') or '',
        'exact': bool(a.get('house_number')),
        'src': 'OpenStreetMap',
    }


def suggest(store, q: str) -> dict:
    q = str(q or '').strip()[:200]
    if len(q) < 3:
        return {'items': [], 'src': ''}
    k = _key(store)
    if k:
        j = http_json(
            DADATA + '/suggest/address',
            data={'query': q, 'count': 8, 'locations': [{'country_iso_code': 'RU'}]},
            headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + k},
        )
        return {'items': [_dd_item(s) for s in j.get('suggestions') or []], 'src': 'DaData'}
    j = _nom('/search', {'q': q, 'countrycodes': 'ru', 'limit': 8})
    return {
        'items': [_nom_item(r) for r in j if isinstance(r, dict)] if isinstance(j, list) else [],
        'src': 'OpenStreetMap',
    }


def locate(store, q: str) -> dict:
    """Координаты по адресу через OpenStreetMap (у подсказки DaData их может не быть)."""
    q = str(q or '').strip()[:300]
    if not q:
        raise ValueError('Пустой адрес')
    j = _nom('/search', {'q': q, 'countrycodes': 'ru', 'limit': 1})
    if isinstance(j, list) and j:
        return _nom_item(j[0])
    raise ValueError('Адрес не найден на карте')


def reverse(store, lat, lon) -> dict:
    lat, lon = _f(lat), _f(lon)
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError('Неверные координаты')
    k = _key(store)
    if k:
        try:
            j = http_json(
                DADATA + '/geolocate/address',
                data={'lat': lat, 'lon': lon, 'count': 1, 'radius_meters': 200},
                headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + k},
            )
            s = (j.get('suggestions') or [None])[0]
            if s:
                return dict(_dd_item(s), lat=lat, lon=lon, exact=True)
        except Exception:
            pass
    j = _nom('/reverse', {'lat': lat, 'lon': lon, 'zoom': 18})
    if isinstance(j, dict) and j.get('address'):
        return dict(_nom_item(j), lat=lat, lon=lon, exact=True)
    raise ValueError('По этим координатам адрес не найден')


class RoadRoute:
    """Расстояние по дорогам (OSRM) с кэшем в kv «georoute» по точкам, округлённым до ~100 м."""

    URL = OSRM
    MAX = 2000

    @classmethod
    def km(cls, store, a: tuple, b: tuple) -> dict:
        """a, b — (lat, lon) → {km, hours, src}."""
        a, b = (_f(a[0]), _f(a[1])), (_f(b[0]), _f(b[1]))
        if None in a or None in b or not all(-90 <= p[0] <= 90 and -180 <= p[1] <= 180 for p in (a, b)):
            raise ValueError('Неверные координаты')
        key = '%.3f,%.3f|%.3f,%.3f' % (a + b)
        cache = store.kv_get('georoute') or {}
        if key in cache:
            return dict(cache[key], cached=True)
        try:
            j = http_json(cls.URL + f'{a[1]},{a[0]};{b[1]},{b[0]}?overview=false')
        except (urllib.error.URLError, OSError, ValueError):
            raise ValueError('сервис маршрутов OSRM не ответил — расстояние по прямой с поправкой на дороги') from None
        r = (j.get('routes') or [None])[0] if isinstance(j, dict) else None
        if not r or j.get('code') not in (None, 'Ok'):
            raise ValueError('маршрут по дорогам не найден — расстояние по прямой с поправкой на дороги')
        out = {
            'km': max(1, round(r['distance'] / 1000)),
            'hours': round(r.get('duration', 0) / 3600, 1),
            'src': 'по дорогам (OSRM, OpenStreetMap)',
        }
        if len(cache) > cls.MAX:
            cache = dict(list(cache.items())[-(cls.MAX * 3 // 4) :])
        cache[key] = out
        store.kv_set('georoute', cache)
        return out


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k) -> None:
        return None


def unshort(url: str) -> str:
    """Раскрыть короткую ссылку Google или Яндекс Карт (только их адреса)."""
    u = urllib.parse.urlsplit(str(url or '').strip())
    host = (u.hostname or '').lower()
    if u.scheme not in ('http', 'https') or not any(host == h or host.endswith('.' + h) for h in SHORT_HOSTS):
        raise ValueError('Это не ссылка Google или Яндекс Карт')
    cur = u.geturl()
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(5):
        req = urllib.request.Request(cur, headers={'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh)'}, method='GET')
        try:
            with opener.open(req, timeout=10) as r:
                body = r.read(200000).decode('utf-8', 'ignore')
                m = re.search(r'https://(?:www\.)?google\.[a-z.]+/maps[^"\'\s<>]+', body) or re.search(
                    r'https://yandex\.[a-z]+/maps[^"\'\s<>]+', body
                )
                return m.group(0) if m else cur
        except urllib.error.HTTPError as e:
            loc = e.headers.get('Location')
            if e.code in (301, 302, 303, 307, 308) and loc:
                nxt = urllib.parse.urljoin(cur, loc)
                nh = (urllib.parse.urlsplit(nxt).hostname or '').lower()
                if not any(nh == h or nh.endswith('.' + h) for h in (*SHORT_HOSTS, 'google.com', 'google.ru')):
                    raise ValueError('Ссылка ведёт не на карты') from None
                cur = nxt
                if re.search(r'@-?\d|[?&](ll|pt|q)=|!3d', cur):
                    return cur
                continue
            raise
    return cur
