"""Адреса и расстояния для доставки по России: подсказки DaData или Nominatim, маршруты OSRM, короткие ссылки карт."""

import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from counterparty import http_json
from server_log import ServerLog

QUERY_MIN = 3
LAT_MAX = 90
LON_MAX = 180

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


def _num(v) -> float | None:
    try:
        return round(float(v), 6)
    except (TypeError, ValueError):
        return None


def _dd_item(sugg: dict) -> dict:
    data = sugg.get('data') or {}
    city = data.get('city') or data.get('settlement') or data.get('area') or data.get('region') or ''
    return {
        'value': sugg.get('value') or '',
        'lat': _num(data.get('geo_lat')),
        'lon': _num(data.get('geo_lon')),
        'city': city,
        'region': data.get('region_with_type') or '',
        'exact': str(data.get('qc_geo')) in ('0', '1'),
        'src': 'DaData',
    }


def _nom_item(rec: dict) -> dict:
    addr = rec.get('address') or {}
    city = (
        addr.get('city')
        or addr.get('town')
        or addr.get('village')
        or addr.get('hamlet')
        or addr.get('county')
        or addr.get('state')
        or ''
    )
    parts = [addr.get('state'), city if city != addr.get('state') else '', addr.get('road'), addr.get('house_number')]
    value = ', '.join(part for part in parts if part) or rec.get('display_name', '')
    return {
        'value': value,
        'lat': _num(rec.get('lat')),
        'lon': _num(rec.get('lon')),
        'city': city,
        'region': addr.get('state') or '',
        'exact': bool(addr.get('house_number')),
        'src': 'OpenStreetMap',
    }


def suggest(store, query: str) -> dict:
    query = str(query or '').strip()[:200]
    if len(query) < QUERY_MIN:
        return {'items': [], 'src': ''}
    k = _key(store)
    if k:
        j = http_json(
            DADATA + '/suggest/address',
            data={'query': query, 'count': 8, 'locations': [{'country_iso_code': 'RU'}]},
            headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + k},
        )
        return {'items': [_dd_item(sugg) for sugg in j.get('suggestions') or []], 'src': 'DaData'}
    j = _nom('/search', {'q': query, 'countrycodes': 'ru', 'limit': 8})
    return {
        'items': [_nom_item(rec) for rec in j if isinstance(rec, dict)] if isinstance(j, list) else [],
        'src': 'OpenStreetMap',
    }


def locate(store, query: str) -> dict:
    """Координаты по адресу через OpenStreetMap (у подсказки DaData их может не быть)."""
    query = str(query or '').strip()[:300]
    if not query:
        raise ValueError('Пустой адрес')
    j = _nom('/search', {'q': query, 'countrycodes': 'ru', 'limit': 1})
    if isinstance(j, list) and j:
        return _nom_item(j[0])
    raise ValueError('Адрес не найден на карте')


def reverse(store, lat, lon) -> dict:
    lat, lon = _num(lat), _num(lon)
    if lat is None or lon is None or not (-LAT_MAX <= lat <= LAT_MAX and -LON_MAX <= lon <= LON_MAX):
        raise ValueError('Неверные координаты')
    k = _key(store)
    if k:
        try:
            j = http_json(
                DADATA + '/geolocate/address',
                data={'lat': lat, 'lon': lon, 'count': 1, 'radius_meters': 200},
                headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + k},
            )
            sugg = (j.get('suggestions') or [None])[0]
            if sugg:
                return dict(_dd_item(sugg), lat=lat, lon=lon, exact=True)
        except Exception as exc:  # ответит запасной сервис; сбой DaData (например, ключ) — в журнал сервера
            ServerLog.note(f'DaData: адрес по координатам не получен — {exc}')
    j = _nom('/reverse', {'lat': lat, 'lon': lon, 'zoom': 18})
    if isinstance(j, dict) and j.get('address'):
        return dict(_nom_item(j), lat=lat, lon=lon, exact=True)
    raise ValueError('По этим координатам адрес не найден')


class RoadRoute:
    """Расстояние по дорогам (OSRM) с кэшем в kv «georoute» по точкам, округлённым до ~100 м."""

    LAT_MAX = 90
    LON_MAX = 180

    URL = OSRM
    MAX = 2000

    @classmethod
    def distance_km(cls, store, src: tuple | list, dst: tuple | list) -> dict:
        """src, dst — (lat, lon) → {km, hours, src}."""
        coords = [_num(src[0]), _num(src[1]), _num(dst[0]), _num(dst[1])]
        nums = [coord for coord in coords if coord is not None]
        if len(nums) != len(coords) or not all(
            -cls.LAT_MAX <= nums[k] <= cls.LAT_MAX and -cls.LON_MAX <= nums[k + 1] <= cls.LON_MAX for k in (0, 2)
        ):
            raise ValueError('Неверные координаты')
        src, dst = (nums[0], nums[1]), (nums[2], nums[3])
        key = '%.3f,%.3f|%.3f,%.3f' % (src + dst)
        cache = store.kv_get('georoute') or {}
        if key in cache:
            return dict(cache[key], cached=True)
        try:
            j = http_json(cls.URL + f'{src[1]},{src[0]};{dst[1]},{dst[0]}?overview=false')
        except (urllib.error.URLError, OSError, ValueError):
            raise ValueError('сервис маршрутов OSRM не ответил — расстояние по прямой с поправкой на дороги') from None
        route = (j.get('routes') or [None])[0] if isinstance(j, dict) else None
        if not route or j.get('code') not in (None, 'Ok'):
            raise ValueError('маршрут по дорогам не найден — расстояние по прямой с поправкой на дороги')
        out = {
            'km': max(1, round(route['distance'] / 1000)),
            'hours': round(route.get('duration', 0) / 3600, 1),
            'src': 'по дорогам (OSRM, OpenStreetMap)',
        }
        if len(cache) > cls.MAX:
            cache = dict(list(cache.items())[-(cls.MAX * 3 // 4) :])
        cache[key] = out
        store.kv_set('georoute', cache)
        return out


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **k) -> None:
        return None


def unshort(url: str) -> str:
    """Раскрыть короткую ссылку Google или Яндекс Карт (только их адреса)."""
    u = urllib.parse.urlsplit(str(url or '').strip())
    host = (u.hostname or '').lower()
    if u.scheme not in ('http', 'https') or not any(
        host == short or host.endswith('.' + short) for short in SHORT_HOSTS
    ):
        raise ValueError('Это не ссылка Google или Яндекс Карт')
    cur = u.geturl()
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(5):
        req = urllib.request.Request(cur, headers={'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh)'}, method='GET')
        try:
            with opener.open(req, timeout=10) as resp:
                body = resp.read(200000).decode('utf-8', 'ignore')
                match = re.search(r'https://(?:www\.)?google\.[a-z.]+/maps[^"\'\s<>]+', body) or re.search(
                    r'https://yandex\.[a-z]+/maps[^"\'\s<>]+', body
                )
                return match.group(0) if match else cur
        except urllib.error.HTTPError as exc:
            loc = exc.headers.get('Location')
            if exc.code in (301, 302, 303, 307, 308) and loc:
                nxt = urllib.parse.urljoin(cur, loc)
                next_host = (urllib.parse.urlsplit(nxt).hostname or '').lower()
                if not any(
                    next_host == known or next_host.endswith('.' + known)
                    for known in (*SHORT_HOSTS, 'google.com', 'google.ru')
                ):
                    raise ValueError('Ссылка ведёт не на карты') from None
                cur = nxt
                if re.search(r'@-?\d|[?&](ll|pt|q)=|!3d', cur):
                    return cur
                continue
            raise
    return cur
