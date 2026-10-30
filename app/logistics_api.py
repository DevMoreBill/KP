"""Цены перевозчиков для доставки по России (ATI.SU, ПЭК, Деловые Линии, КИТ, СДЭК, Энергия, ЖДЭ) и автообновление ставок."""

import json
import math
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
from datetime import date, datetime, timedelta
from typing import Any

import defaults
import workcal
from counterparty import http_json
from server_log import ErrorText, LogMask

FIND_DEPTH = 6

# защита сайтов СДЭК и Энергии отклоняет (403) запросы с «неизвестным» браузером — представляемся обычным
BROWSER_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
)
# коды ответов сервисов → понятное объяснение (сам код — в скобках)
HTTP_WHY = {
    400: 'сервис не принял запрос',
    401: 'ключ не принят — проверьте «Настройки → Ключи API»',
    403: 'сервис отклонил запрос (защита сайта или доступ по ключу)',
    404: 'адрес сервиса изменился или токен не подходит к этому адресу — проверьте «Настройки → Внешние сервисы → Перевозчики: адреса API» и ключ',
    429: 'исчерпан лимит запросов — повторите позже',
    500: 'ошибка на стороне сервиса',
    502: 'сервис временно недоступен',
    503: 'сервис временно недоступен',
    504: 'сервис не ответил вовремя',
}

# опорные направления автообновления ставок ₽/км (администратор может задать свои)
REF_ROUTES = [
    'Москва — Санкт-Петербург',
    'Москва — Казань',
    'Москва — Екатеринбург',
    'Москва — Краснодар',
    'Москва — Новосибирск',
]


class LtlLimits:
    """Сборный груз: место не тяжелее и не больше — иначе только отдельной машиной."""

    # поле → (ключ «Значений программы», встроенное в кг / мм, наименьшее, наибольшее)
    KEYS = {
        'm': ('log.ltlKg', 3000, 100, 20000),
        'l': ('log.ltlL', 6000, 1000, 13600),
        'w': ('log.ltlW', 2400, 500, 2550),
        'h': ('log.ltlH', 2500, 500, 3000),
        'total': ('log.ltlTotal', 20000, 1000, 40000),
    }
    ATI_DAYS = ('log.atiDays', 30, 7, 90)

    @classmethod
    def get(cls, store=None) -> dict:
        """{'m': т, 'l': м, 'w': м, 'h': м, 'total': т}"""
        return {
            k: (defaults.num(store, key, builtin, low, high) if store is not None else builtin) / 1000.0
            for k, (key, builtin, low, high) in cls.KEYS.items()
        }

    @classmethod
    def ati_days(cls, store=None) -> int:
        key, builtin, low, high = cls.ATI_DAYS
        return int(defaults.num(store, key, builtin, low, high)) if store is not None else builtin

    @classmethod
    def fits(cls, places, store=None) -> tuple:
        """(можно ли сборным грузом, почему нет): каждое место и весь груз — в пределах."""
        units = Carrier.units(places)
        if not units:
            return False, 'нет груза'
        lim = cls.get(store)
        eps = 1e-9
        big = [
            u
            for u in units
            if u['m'] > lim['m'] + eps
            or max(u['l'], u['w']) > lim['l'] + eps
            or min(u['l'], u['w']) > lim['w'] + eps
            or u['h'] > lim['h'] + eps
        ]

        def _kilos(tons) -> str:
            return f'{tons * 1000:,.0f}'.replace(',', ' ')  # т → кг, м → мм

        if big:
            return False, 'есть место тяжелее {} кг или больше {} × {} × {} мм — сборным грузом не принимают'.format(
                _kilos(lim['m']),
                _kilos(lim['l']),
                _kilos(lim['w']),
                _kilos(lim['h']),
            )
        if sum(u['m'] for u in units) > lim['total'] + eps:
            return False, 'груз тяжелее {} кг — нужна отдельная машина'.format(_kilos(lim['total']))
        return True, ''


class CarrierApi:
    """Включение перевозчиков и адреса их API — правит администратор, без выпуска программы."""

    URL_MAX = 300

    KV_KEY = 'carrierApi'
    # (код, название, сайт с документацией API, ((поле, подпись, адрес по умолчанию), …))
    LIST = (
        (
            'ati',
            'ATI.SU «Средние ставки»',
            'https://ati.su/developers',
            (('base', 'Адрес API', 'https://api.ati.su/priceline/license/v2'),),
        ),
        (
            'pec',
            'ПЭК',
            'https://pecom.ru/business/developers/',
            (
                ('calc', 'Расчёт стоимости', 'https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php'),
                ('towns', 'Справочник городов', 'https://pecom.ru/ru/calc/towns.php'),
            ),
        ),
        (
            'dellin',
            'Деловые Линии',
            'https://dev.dellin.ru/api/',
            (('calc', 'Расчёт стоимости', 'https://api.dellin.ru/v2/calculator.json'),),
        ),
        (
            'nrg',
            'Энергия',
            'https://api2.nrg-tk.ru/',
            (
                ('base', 'Адрес API', 'https://api2.nrg-tk.pro/v2'),
                ('reserve', 'Резервный адрес', 'https://api2.nrg-tk.ru/v2'),
                ('v4', 'API v4 (с токеном разработчика)', 'https://mainapi.nrg-tk.pro/api/v4'),
            ),
        ),
        ('cdek', 'СДЭК', 'https://api-docs.cdek.ru/', (('base', 'Адрес API', 'https://api.cdek.ru/v2'),)),
        ('vozovoz', 'Возовоз', 'https://github.com/vozovoz/apiv2', (('url', 'Адрес API', 'https://vozovoz.ru/api/'),)),
        ('kit', 'КИТ', 'https://tk-kit.ru/developers', (('base', 'Адрес API', 'https://capi.tk-kit.com'),)),
        ('jde', 'ЖелДорЭкспедиция', 'https://api.jde.ru/dev/', (('base', 'Адрес API', 'https://api.jde.ru/vD'),)),
    )
    # только https и имя сайта (не IP и не localhost): адрес уходит в запрос сервера
    URL = re.compile(r'^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(:\d{2,5})?(/[^\s<>"\'\\]*)?$')

    @classmethod
    def _raw(cls, store) -> dict:
        raw = store.kv_get(cls.KV_KEY) if store is not None else None
        return raw if isinstance(raw, dict) else {}

    @classmethod
    def _default(cls, cid, field) -> str:
        for code, _name, _doc, fields in cls.LIST:
            if code == cid:
                for key, _label, url in fields:
                    if key == field:
                        return url
        raise KeyError(cid + '.' + field)

    @classmethod
    def url(cls, store, cid, field) -> str:
        own = ((cls._raw(store).get(cid) or {}).get('urls') or {}).get(field)
        return own if own and cls.URL.match(own) else cls._default(cid, field)

    @classmethod
    def enabled(cls, store, cid) -> bool:
        return (cls._raw(store).get(cid) or {}).get('on', True) is not False

    @classmethod
    def public(cls, store) -> dict:
        raw = cls._raw(store)
        return {
            'carriers': [
                {
                    'id': cid,
                    'name': name,
                    'docs': direction,
                    'on': cls.enabled(store, cid),
                    'at': (raw.get(cid) or {}).get('at'),
                    'by': (raw.get(cid) or {}).get('by'),
                    'fields': [
                        {
                            'id': field,
                            'label': label,
                            'default': url,
                            'value': ((raw.get(cid) or {}).get('urls') or {}).get(field) or '',
                        }
                        for field, label, url in fields
                    ],
                }
                for cid, name, direction, fields in cls.LIST
            ]
        }

    @classmethod
    def moved(cls, store, direction: Any) -> dict:
        """Адреса API, которые запрос меняет (ключи перевозчиков уйдут на них): {код: {поле: адрес}}."""
        out: dict = {}
        if not isinstance(direction, dict):
            return out
        for cid, v in direction.items():
            urls = v.get('urls') if isinstance(v, dict) else None
            for field, url in (urls if isinstance(urls, dict) else {}).items():
                new = str(url or '').strip()
                if new and new != cls._default(cid, field) and new != cls.url(store, cid, field):
                    out.setdefault(str(cid), {})[str(field)] = new
        return out

    @classmethod
    def save(cls, store, direction, author: str = '') -> dict:
        """d: {код: {on: bool, urls: {поле: адрес или '' — по умолчанию}}}; неизвестное — ошибка."""
        if not isinstance(direction, dict):
            raise ValueError('Неверный формат настроек перевозчиков')
        known = {code: {field for field, _label, _u in fields} for code, _name, _doc, fields in cls.LIST}
        raw = cls._raw(store)
        for cid, v in direction.items():
            if cid not in known or not isinstance(v, dict):
                raise ValueError(f'Неизвестный перевозчик: {str(cid)[:40]}')
            cur = dict(raw.get(cid) or {})
            if 'on' in v:
                cur['on'] = bool(v['on'])
            urls = dict(cur.get('urls') or {})
            for field, raw_url in (v.get('urls') or {}).items():
                if field not in known[cid]:
                    raise ValueError(f'Неизвестное поле адреса: {str(field)[:40]}')
                u = str(raw_url or '').strip()
                if not u or u == cls._default(cid, field):
                    urls.pop(field, None)
                    continue
                if len(u) > cls.URL_MAX or not cls.URL.match(u):
                    raise ValueError(
                        f'{ {code: title for code, title, _doc, _fields in cls.LIST}[cid] }: адрес должен начинаться с https:// и вести на сайт перевозчика (не IP-адрес), до 300 знаков'
                    )
                urls[field] = u
            cur['urls'], cur['at'], cur['by'] = urls, _now(), str(author or '')[:80]
            raw[cid] = cur
        store.kv_set(cls.KV_KEY, raw)
        for cid in direction:  # справочники городов прежнего адреса — заново с нового
            store.kv_set('lgdict:' + cid, {})
        return cls.public(store)

    SAMPLE = [{'l': 1.2, 'w': 1.0, 'h': 1.0, 'm': 0.3, 'qty': 1}]  # пробное место: 1,2 × 1 × 1 м, 300 кг

    @classmethod
    def test(cls, store, cid) -> dict:
        """Пробный расчёт одного перевозчика Москва → Санкт-Петербург: {ok, msg} — без ключа в тексте."""
        carrier = CARRIERS.get(cid)
        if not carrier:
            raise ValueError('Неизвестный перевозчик')
        if not carrier.has_keys(store):
            return {'ok': False, 'msg': 'ключ не задан — впишите его выше, в «Доставка по России»'}
        frm, dst = {'name': 'Москва'}, {'name': 'Санкт-Петербург'}
        try:
            if carrier is Ati:
                direction = AtiDirections(store).find(frm['name'], dst['name'])
                return {
                    'ok': bool(direction),
                    'msg': 'отвечает: направление Москва → Санкт-Петербург есть'
                    if direction
                    else 'отвечает, но направления Москва → Санкт-Петербург нет',
                }
            res = carrier.quote(store, frm, dst, cls.SAMPLE, 0)
            return {
                'ok': True,
                'msg': 'отвечает: Москва → Санкт-Петербург, 300 кг — {} ₽'.format(
                    '{:,.0f}'.format(res['price']).replace(',', ' ')
                ),
            }
        except Exception as exc:
            return {'ok': False, 'msg': Http.error(exc)}


_lock = threading.Lock()


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def cnorm(raw) -> str:
    """Название города для сравнения: «г. Санкт-Петербург, …» → «санкт петербург»."""
    raw = str(raw or '').lower().replace('ё', 'е')
    raw = re.split(r'[,(]', raw)[0]
    raw = re.sub(r'^(г\.?|город)\s+', '', raw.strip())
    return re.sub(r'[\s\-‐–—]+', ' ', raw).strip()


def keys(store) -> dict:
    return store.kv_get('integrations') or {}


def number(v) -> float | None:
    """Число из ответа сервиса («1 234,5», 1234.5) или None."""
    try:
        x = float(str(v).replace(' ', '').replace('\xa0', '').replace(',', '.'))
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _find(obj, pred, depth=0) -> Any:
    """Первый вложенный объект, для которого pred(obj) истинно (обход словарей и списков вглубь до 6 уровней)."""
    if depth > FIND_DEPTH:
        return None
    if pred(obj):
        return obj
    items = obj.values() if isinstance(obj, dict) else obj if isinstance(obj, list) else []
    for v in items:
        if isinstance(v, (dict, list)):
            res = _find(v, pred, depth + 1)
            if res is not None:
                return res
    return None


class Http:
    """Запрос к сервису перевозчика и понятный текст его ошибки (ключи и токены из текста убраны)."""

    # ключи и токены в адресе (?token=…) и в тексте ответа не показываются и не пишутся в журнал
    SECRET = LogMask.QUERY

    @staticmethod
    def call(url, data=None, headers=None, method=None) -> Any:
        """Запрос с переходом по 307/308: перевозчик переехал на новый адрес — POST повторяется туда же (urllib сам этого не делает)."""
        for _ in range(3):
            try:
                return http_json(url, data=data, headers=headers, method=method)
            except urllib.error.HTTPError as exc:
                loc = exc.headers.get('Location') if exc.code in (301, 302, 307, 308) and exc.headers else None
                nxt = urllib.parse.urljoin(url, loc) if loc else ''
                if not nxt.startswith('https://') or nxt == url:
                    raise
                url = nxt
        raise ValueError('сервис перенаправляет запрос по кругу — проверьте адрес API в «Настройках»')

    @classmethod
    def hide(cls, text) -> str:
        return cls.SECRET.sub(r'\1***', str(text or ''))

    @classmethod
    def error(cls, exc) -> str:
        """Текст ошибки для менеджера и журнала."""
        return cls.hide(cls._explain(exc))

    @classmethod
    def _explain(cls, exc) -> str:
        if isinstance(exc, urllib.error.HTTPError):
            try:
                text = cls._body_text(exc.read().decode('utf-8', 'replace')[:2000])
            except Exception:
                text = ''
            why = HTTP_WHY.get(exc.code) or 'сервис ответил ошибкой'
            return f'{why}, HTTP {exc.code}{(" — " + text) if text else ""}'
        if isinstance(exc, (socket.timeout, TimeoutError)) or 'timed out' in str(exc):
            return 'сервис не ответил вовремя — повторите позже'
        if isinstance(exc, urllib.error.URLError):
            return f'нет связи с сервисом: {str(exc.reason)[:120] if exc.reason else "проверьте интернет"}'
        return ErrorText.of(exc)[:300] or exc.__class__.__name__

    @staticmethod
    def _body_text(body) -> str:
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
                msg = j.get('message') or j.get('error_description') or j.get('error') or j.get('detail')
                if isinstance(msg, (str, int, float)):
                    return str(msg)[:200]
                errs = j.get('errors')
                if isinstance(errs, list) and errs:
                    return '; '.join(str((x or {}).get('message') if isinstance(x, dict) else x) for x in errs)[:200]
            return ''
        if '<' in body and '>' in body:  # страница-заглушка (nginx, защита сайта) — её текст не нужен
            return ''
        return re.sub(r'\s+', ' ', body)[:200]


class Carrier:
    """Перевозчик: код (как в CarrierApi.LIST), нужные ключи API, справочник городов."""

    CODE = ''
    NAME = ''  # подпись предложения
    SITE = ''  # страница заявки или калькулятора на сайте
    WHOSE = ''  # «город не найден в справочнике …»
    KEYS: tuple[str, ...] = ()  # ключи «Интеграций», без которых перевозчик не считает
    HINT_403 = ''  # пояснение к отказу 403
    DICT_DAYS = 7  # справочник городов обновляется раз в неделю

    @classmethod
    def has_keys(cls, store) -> bool:
        k = keys(store)
        return all(k.get(key_name) for key_name in cls.KEYS)

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        """Предложение перевозчика: {price, ins, days, …}."""
        raise NotImplementedError(cls.CODE)

    @classmethod
    def _url(cls, store, field) -> str:
        return CarrierApi.url(store, cls.CODE, field)

    @staticmethod
    def units(places) -> list:
        """[{l, w, h, m, qty}] → по месту на каждую штуку."""
        return [place for place in places for _ in range(int(place['qty']))]

    @staticmethod
    def candidates(point) -> list:
        """Город точки и ближайшие крупные — по порядку, для поиска в справочнике перевозчика."""
        return [point.get('name'), *list(point.get('alt') or [])]

    @staticmethod
    def pick(cities, names) -> tuple:
        """(код, город): первый из городов, который есть в справочнике {город: код}; нет ни одного — (None, первый)."""
        for name in names:
            if cities.get(cnorm(name)):
                return cities[cnorm(name)], name
        return None, names[0] if names else ''

    @classmethod
    def _both(cls, frm_hit, to_hit) -> tuple:
        """Коды городов отправления и назначения; какого нет в справочнике — ValueError."""
        (frm_code, frm_alt), (dst_code, dst_alt) = frm_hit, to_hit
        if not frm_code or not dst_code:
            raise ValueError(f'город не найден в справочнике {cls.WHOSE}: {frm_alt if not frm_code else dst_alt}')
        return frm_code, dst_code

    @staticmethod
    def via(frm_hit, to_hit, frm, dst) -> str:
        """« (Тверь → Казань)» — если в справочнике перевозчика нашёлся не сам город, а ближайший крупный."""
        frm_alt, dst_alt = frm_hit[1], to_hit[1]
        return '' if (frm_alt, dst_alt) == (frm.get('name'), dst.get('name')) else f' ({frm_alt} → {dst_alt})'

    @classmethod
    def _cached(cls, store, name, loader) -> Any:
        """Справочник из kv «lgdict:<name>»; старше DICT_DAYS — загружается заново."""
        cid = store.kv_get('lgdict:' + name) or {}
        try:
            fresh = cid.get('at') and datetime.fromisoformat(cid['at']) > datetime.now() - timedelta(days=cls.DICT_DAYS)
        except ValueError:
            fresh = False
        if fresh and cid.get('items'):
            return cid['items']
        items = loader()
        if not items:  # пустой справочник не запоминаем — иначе каждый город будет «не найден»
            raise ValueError('справочник городов не загрузился (сервис ответил без данных) — повторите позже')
        store.kv_set('lgdict:' + name, {'at': _now(), 'items': items})
        return items

    @staticmethod
    def _insurance(items) -> float:
        """Сумма строк страхования (по названию «страхов…») в детализации перевозчика."""
        return sum(
            number(x.get('price')) or 0
            for x in (items or [])
            if isinstance(x, dict) and re.search(r'страхов', str(x.get('name') or ''), re.I)
        )

    @staticmethod
    def _last_number(values) -> float | None:
        """Последнее число из значения или списка значений ответа (ПЭК отдаёт [подпись, …, сумма])."""
        found = [
            name for name in (number(v) for v in (values if isinstance(values, list) else [values])) if name is not None
        ]
        return found[-1] if found else None


class Ati(Carrier):
    """Отдельная машина (FTL): верхняя граница средних ставок ATI.SU по направлению — за рейс (₽) и за км (₽/км), с НДС."""

    CODE, KEYS = 'ati', ('atiToken',)
    # класс машины в тарифах → тип кузова и тоннаж «Средних ставок»
    CAR_CLASSES = {
        'gazel': ('tent', 1.5),
        't5': ('tent', 5),
        't10': ('tent', 10),
        'tent20': ('tent', 20),
        'flat': ('open', 20),
        'lowbed': ('tral', 20),
    }
    BODY = {'tent': 'тент', 'open': 'открытая', 'tral': 'трал'}

    @classmethod
    def _headers(cls, store) -> dict:
        return {'Authorization': 'Bearer ' + keys(store).get('atiToken', ''), 'Content-Type': 'application/json'}

    @classmethod
    def directions(cls, store) -> list:
        """[{fromId, from, toId, to, info}] — все направления «Средних ставок»."""

        def load() -> list:
            j = Http.call(cls._url(store, 'base') + '/all_directions', headers=cls._headers(store))
            rows = (
                j
                if isinstance(j, list)
                else (
                    _find(
                        j,
                        lambda obj: (
                            isinstance(obj, list) and obj and isinstance(obj[0], dict) and 'FromCityId' in obj[0]
                        ),
                    )
                    or []
                )
            )
            return [
                {
                    'fromId': res.get('FromCityId'),
                    'from': res.get('FromCity') or '',
                    'toId': res.get('ToCityId'),
                    'to': res.get('ToCity') or '',
                    'info': res.get('DirectionInfo'),
                }
                for res in rows
                if isinstance(res, dict) and res.get('FromCityId') and res.get('ToCityId')
            ]

        return cls._cached(store, 'ati', load)

    @classmethod
    def price(cls, store, direction, car, tonnage, days=None) -> dict:
        """Ставки по направлению d за последние days дней: {upperRub, avgRub, lowRub, upperKm, avgKm, count}."""
        end = date.today()
        days = days or LtlLimits.ati_days(store)
        body = {
            'From': {'CityId': direction['fromId']},
            'To': {'CityId': direction['toId']},
            'FromCityId': direction['fromId'],
            'ToCityId': direction['toId'],
            'CarType': car,
            'Tonnage': tonnage,
            'DateFrom': (end - timedelta(days=days)).isoformat() + 'T00:00:00',
            'DateTo': end.isoformat() + 'T23:59:59',
            'WithNds': True,
        }
        j = Http.call(
            cls._url(store, 'base') + '/average_prices', data=body, headers=cls._headers(store), method='POST'
        )
        rec = j[0] if isinstance(j, list) and j else j
        # ставка за рейс — в PricesInRub (или во вложенном объекте с UpperPrice), за км — в самой записи
        rub = (
            _find(rec, lambda obj: isinstance(obj, dict) and 'UpperPrice' in obj and obj is not rec)
            if isinstance(rec, dict)
            else None
        )
        rub = (rec or {}).get('PricesInRub') or rub or {}
        per_km = (
            rec
            if isinstance(rec, dict) and 'UpperPrice' in rec
            else (_find(rec, lambda node: isinstance(node, dict) and 'UpperPrice' in node and node is not rub) or {})
        )
        out = {
            'upperRub': number(rub.get('UpperPrice')),
            'avgRub': number(rub.get('AveragePrice')),
            'lowRub': number(rub.get('BottomPrice')),
            'upperKm': number(per_km.get('UpperPrice')),
            'avgKm': number(per_km.get('AveragePrice')),
            'count': None,
        }
        cnt = _find(
            rec,
            lambda entry: isinstance(entry, dict) and any(k in entry for k in ('LoadsCount', 'CargoCount', 'Count')),
        )
        if cnt:
            out['count'] = number(next(cnt[k] for k in ('LoadsCount', 'CargoCount', 'Count') if k in cnt))
        if out['upperRub'] is None and out['upperKm'] is None:
            raise ValueError(
                'в ответе ATI.SU нет ставок по направлению ({} → {}, {} {} т)'.format(
                    direction['from'], direction['to'], car, tonnage
                )
            )
        return out


class AtiDirections:
    """Направления «Средних ставок» ATI.SU по городам: справочник читается один раз на расчёт."""

    def __init__(self, store) -> None:
        self.store = store
        self._idx: dict | None = None

    def find(self, frm, dst) -> dict | None:
        if self._idx is None:
            idx: dict = {}
            for direction in Ati.directions(self.store):
                idx.setdefault((cnorm(direction['from']), cnorm(direction['to'])), direction)
            self._idx = idx
        return self._idx.get((cnorm(frm), cnorm(dst)))


class Pec(Carrier):
    """Сборный груз терминал — терминал; забор и доставка — если калькулятор их посчитал."""

    OVERSIZE_M = 3
    OVERSIZE_T = 0.5
    BOTH_ENDS = 2

    CODE, NAME, SITE, WHOSE = 'pec', 'ПЭК', 'https://pecom.ru/services-are/shipping-request/', 'ПЭК'

    @classmethod
    def cities(cls, store) -> dict:
        def load() -> dict:
            j = Http.call(cls._url(store, 'towns'))
            out = {}
            for _region, towns in j.items() if isinstance(j, dict) else []:
                if isinstance(towns, dict):
                    for tid, name in towns.items():
                        norm = cnorm(name)
                        if norm and norm not in out:
                            out[norm] = tid
            return out

        return cls._cached(store, 'pec', load)

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        cities = cls.cities(store)
        frm_hit, to_hit = cls.pick(cities, cls.candidates(frm)), cls.pick(cities, cls.candidates(dst))
        frm_code, dst_code = cls._both(frm_hit, to_hit)
        query = [('take[town]', frm_code), ('deliver[town]', dst_code)]
        if declared:
            query.append(('strah', round(declared)))  # объявленная стоимость — ПЭК считает своё страхование
        for k, place in enumerate(
            cls.units(places)
        ):  # место: ширина, длина, высота (м), объём (м³), вес (кг), негабарит, жёсткая упаковка
            oversize = (
                1 if max(place['l'], place['w'], place['h']) > cls.OVERSIZE_M or place['m'] > cls.OVERSIZE_T else 0
            )
            query += [
                (f'places[{k}][]', v)
                for v in (
                    place['w'],
                    place['l'],
                    place['h'],
                    round(place['l'] * place['w'] * place['h'], 3),
                    round(place['m'] * 1000),
                    oversize,
                    0,
                )
            ]
        j = Http.call(cls._url(store, 'calc') + '?' + urllib.parse.urlencode(query))
        auto = j.get('auto') if isinstance(j, dict) else None
        if not auto:
            raise ValueError(
                'ПЭК: автоперевозка недоступна для этого груза'
                + ((' — ' + str(j.get('error'))) if isinstance(j, dict) and j.get('error') else '')
            )
        total = cls._last_number(auto)
        if total is None:
            raise ValueError('ПЭК: в ответе нет стоимости')
        ins = 0.0
        for k, v in j.items():  # обязательные надбавки (ADD…: негабарит, страхование)
            if re.match(r'^(ADD|add)', str(k)) and isinstance(v, list):
                num = cls._last_number(v)
                if num is not None:
                    total += num
                    if re.search(r'страх', ' '.join(str(y) for y in v[:2]), re.I):
                        ins += num
        door = 0
        for side in ('take', 'deliver'):  # забор груза у отправителя и доставка получателю
            num = cls._last_number(j[side]) if j.get(side) is not None else None
            if num is not None:
                total += num
                door += 1
        days = None
        per = _find(j, lambda obj: isinstance(obj, dict) and any(k in obj for k in ('periods_days', 'periods')))
        if per:
            nums = re.findall(r'\d+', str(per.get('periods_days') or per.get('periods')))
            days = int(nums[-1]) if nums else None
        return {
            'price': round(total),
            'ins': round(ins),
            'days': days,
            'door': door == cls.BOTH_ENDS,
            'note': (
                'сборный груз, дверь в дверь (забор и доставка ПЭК)'
                if door == cls.BOTH_ENDS
                else 'сборный груз, межтерминальная перевозка ПЭК'
            )
            + cls.via(frm_hit, to_hit, frm, dst),
        }


class Dellin(Carrier):
    """Сборный груз от адреса до адреса (адрес ищет сам сервис)."""

    OVERSIZE_M = 3
    OVERSIZE_T = 0.1
    WORKDAYS = 5

    CODE, NAME, SITE, KEYS = 'dellin', 'Деловые Линии', 'https://www.dellin.ru/requests/', ('dellinKey',)
    WORK_TIME = {'worktimeStart': '09:00', 'worktimeEnd': '18:00'}

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        units = cls.units(places)
        over = [u for u in units if max(u['l'], u['w'], u['h']) > cls.OVERSIZE_M or u['m'] > cls.OVERSIZE_T]
        body = {
            'appkey': keys(store).get('dellinKey', ''),
            'delivery': {
                'deliveryType': {'type': 'auto'},
                'derival': {
                    'produceDate': '',
                    'variant': 'address',
                    'address': {'search': frm.get('addr') or frm.get('name')},
                    'time': cls.WORK_TIME,
                },
                'arrival': {
                    'variant': 'address',
                    'address': {'search': dst.get('addr') or dst.get('name')},
                    'time': cls.WORK_TIME,
                },
            },
            'cargo': {
                'quantity': len(units),
                'length': max(u['l'] for u in units),
                'width': max(u['w'] for u in units),
                'height': max(u['h'] for u in units),
                'weight': round(max(u['m'] for u in units) * 1000, 1),
                'totalVolume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3),
                'totalWeight': round(sum(u['m'] for u in units) * 1000, 1),
                'oversizedWeight': round(sum(u['m'] for u in over) * 1000, 1),
                'oversizedVolume': round(sum(u['l'] * u['w'] * u['h'] for u in over), 3),
                'hazardClass': 0,
            },
        }
        if declared:  # страхование груза Деловыми Линиями по объявленной стоимости
            body['cargo']['insurance'] = {'statedValue': round(declared), 'term': True}
        # дата забора: ближайший рабочий день; если с этого адреса в эту дату не забирают («Выбранная дата недоступна
        # для выбранного адреса») — следующий рабочий, до DATE_TRIES дней
        for day in cls.pickup_days(store):
            body['delivery']['derival']['produceDate'] = day.isoformat()
            j, msg = cls._calc(store, body)
            if not msg or not cls.DATE_ERR.search(msg):
                break
        if msg and cls.DATE_ERR.search(msg):
            raise ValueError(
                f'Деловые Линии: с адреса отправки не забирают груз в ближайшие {cls.DATE_TRIES} рабочих дней — '
                f'проверьте адрес ({msg})'
            )
        if msg:
            raise ValueError('Деловые Линии: ' + msg)
        data = (j or {}).get('data') or {}
        price = number(data.get('price'))
        if price is None:
            parts = [number((data.get(k) or {}).get('price')) for k in ('derival', 'intercity', 'arrival')]
            price = sum(x for x in parts if x) or None
        if not price:
            raise ValueError('Деловые Линии: в ответе нет стоимости')
        insurance = data.get('insurance')
        ins = number(insurance.get('price') if isinstance(insurance, dict) else insurance) or 0
        return {
            'price': round(price),
            'ins': round(ins),
            'days': cls._days(data.get('orderDates') or {}),
            'door': True,
            'note': 'сборный груз, от адреса до адреса, забор ' + day.strftime('%d.%m'),
        }

    DATE_TRIES = 7
    DATE_ERR = re.compile(r'дат[аы]\b.*недоступн|недоступн.*дат|produceDate', re.I)

    @classmethod
    def pickup_days(cls, store=None) -> list:
        """Ближайшие рабочие дни начиная с завтрашнего: по производственному календарю (праздники, переносы), без него — пн–пт."""
        day = date.today()
        out: list = []
        cal = {}
        while len(out) < cls.DATE_TRIES:
            day += timedelta(days=1)
            if day.year not in cal:
                try:
                    cal[day.year] = workcal.year(store, day.year)['days'] if store is not None else ''
                except Exception:
                    cal[day.year] = ''
            days, i = cal[day.year], day.timetuple().tm_yday - 1
            if (days[i] == '0') if i < len(days) else day.weekday() < cls.WORKDAYS:
                out.append(day)
        return out

    @classmethod
    def _calc(cls, store, body) -> tuple:
        """Запрос калькулятора: (ответ, текст ошибки или '')."""
        try:
            j = Http.call(
                cls._url(store, 'calc'), data=body, headers={'Content-Type': 'application/json'}, method='POST'
            )
        except urllib.error.HTTPError as exc:  # ошибка проверки полей приходит телом ответа с кодом 4xx
            try:
                j = json.loads(exc.read().decode('utf-8', 'replace'))
            except Exception:
                raise ValueError(Http.error(exc)) from None
        errs = j.get('errors') if isinstance(j, dict) else None
        if not errs:
            return j, ''
        return j, '; '.join(
            str((x or {}).get('detail') or (x or {}).get('title') or x)
            for x in (errs if isinstance(errs, list) else [errs])
        )[:300]

    @staticmethod
    def _days(dates) -> int | None:
        """Срок в днях от забора до выдачи по датам заказа (включительно)."""
        start = dates.get('pickup') or dates.get('derivalFromOspSender')
        end = dates.get('arrivalToOspReceiver') or dates.get('giveoutFromOspReceiver')
        if not start or not end:
            return None
        try:
            return (datetime.fromisoformat(str(end)[:10]) - datetime.fromisoformat(str(start)[:10])).days + 1
        except ValueError:
            return None


class Kit(Carrier):
    """КИТ: расчёт дверь — дверь (тариф «Стандарт»), справочник городов, страхование по объявленной стоимости."""

    HTTP_UNAUTHORIZED = 401
    HTTP_TOO_MANY = 429

    CODE, NAME, SITE, WHOSE, KEYS = 'kit', 'КИТ', 'https://tk-kit.ru/calculate', 'КИТ', ('kitToken',)
    TYPES = {'01': 'Стандарт', '03': 'Экспресс'}
    DOCS_FROM = 50000  # ₽: от этой объявленной стоимости КИТ требует признак документов, подтверждающих стоимость

    @classmethod
    def _call(cls, store, path, body) -> Any:
        """POST JSON с токеном Bearer. Ошибки — понятным текстом: 401 — токен, 429 — лимит, 422 — поля."""
        headers = {'Authorization': 'Bearer ' + keys(store).get('kitToken', ''), 'Content-Type': 'application/json'}
        try:
            return Http.call(cls._url(store, 'base') + path, data=body, headers=headers, method='POST')
        except urllib.error.HTTPError as exc:
            try:
                j = json.loads(exc.read().decode('utf-8', 'replace') or 'null')
            except Exception:
                j = None
            if exc.code == cls.HTTP_UNAUTHORIZED:
                raise ValueError(
                    'КИТ: токен не принят — создайте новый в личном кабинете tk-kit.ru («Разработчикам» → «Получение ключа API»)'
                ) from exc
            if exc.code == cls.HTTP_TOO_MANY:
                raise ValueError('КИТ: превышен лимит запросов по токену — повторите позже') from exc
            if isinstance(j, list):  # ошибки проверки полей: [{"field": …, "message": …}]
                msg = '; '.join(str(x.get('message') or x) for x in j if isinstance(x, dict))
            elif isinstance(j, dict):
                msg = str(j.get('message') or j.get('name') or '')
            else:
                msg = ''
            raise ValueError(
                f'КИТ: {HTTP_WHY.get(exc.code) or "сервис ответил ошибкой"}, HTTP {exc.code}'
                + ((' — ' + msg[:300]) if msg else '')
            ) from exc

    @staticmethod
    def _name(row) -> str:
        return cnorm(row.get('name')) if isinstance(row, dict) else ''

    @staticmethod
    def _is_city(row) -> bool:
        return str(row.get('type') or '').startswith('гор')

    @classmethod
    def cities(cls, store) -> dict:
        """Справочник населённых пунктов: имя → код. При совпадении имён — город («гор.»)."""

        def load() -> dict:
            j = cls._call(store, '/1.1/tdd/city/get-list', {'country_code': 'RU'})
            rows = (
                j
                if isinstance(j, list)
                else (
                    _find(
                        j, lambda obj: isinstance(obj, list) and obj and isinstance(obj[0], dict) and 'code' in obj[0]
                    )
                    or []
                )
            )
            out, city = {}, set()
            for row in rows:
                name, is_city = cls._name(row), cls._is_city(row)
                if name and row.get('code') and name not in city and (name not in out or is_city):
                    out[name] = row['code']
                    if is_city:
                        city.add(name)
            return out

        return cls._cached(store, 'kit', load)

    @classmethod
    def city(cls, store, names) -> tuple:
        """(код, город): по справочнику, а если там нет — поиском по имени, с запоминанием в справочнике."""
        cities = cls.cities(store)
        for name in names:
            key = cnorm(name)
            if not key:
                continue
            if key not in cities:
                try:
                    rows = cls._call(store, '/1.1/tdd/search/by-name', {'title': name})
                except ValueError as exc:
                    if 'токен' in str(exc):  # неверный токен — дальше искать бессмысленно
                        raise
                    continue  # поиск не ответил — берём следующий (ближайший крупный) город
                # в ответах КИТ встречается и country_сode с русской «с»
                rows = [
                    row
                    for row in (rows if isinstance(rows, list) else [])
                    if cls._name(row) == key
                    and row.get('code')
                    and str(row.get('country_code') or row.get('country_сode') or 'RU') == 'RU'
                ]
                hit = next((row for row in rows if cls._is_city(row)), rows[0] if rows else None)
                cities[key] = hit['code'] if hit else None
                store.kv_set('lgdict:kit', dict(store.kv_get('lgdict:kit') or {'at': _now()}, items=cities))
            if cities.get(key):
                return cities[key], name
        return None, names[0] if names else ''

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        frm_hit, to_hit = cls.city(store, cls.candidates(frm)), cls.city(store, cls.candidates(dst))
        frm_code, dst_code = cls._both(frm_hit, to_hit)
        price = max(1, round(declared or 0))
        body = {
            'city_pickup_code': frm_code,
            'city_delivery_code': dst_code,
            'declared_price': price,
            'type': '01',
            'pick_up': 1,
            'delivery': 1,
            'currency_code': ['RUB'],
            'places': [
                {
                    'count_place': 1,
                    'length': round(u['l'] * 100, 2),
                    'width': round(u['w'] * 100, 2),
                    'height': round(u['h'] * 100, 2),
                    'weight': round(u['m'] * 1000, 2),
                }
                for u in cls.units(places)
            ],
        }
        if price >= cls.DOCS_FROM:
            body.update(confirmation_price=1, have_doc=1)
        j = cls._call(store, '/2.0/order/calculate', body)
        found = {}  # код тарифа → расчёт
        for el in j if isinstance(j, list) else [j]:
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
        tariff = found[code]
        days = re.findall(r'\d+', str(tariff.get('time') or ''))
        return {
            'price': round(number(tariff['cost']) or 0),
            'ins': round(cls._insurance(tariff.get('detail'))),
            'days': int(days[-1]) if days else None,
            'door': True,
            'note': 'дверь в дверь (забор и доставка КИТ), тариф «{}»{}'.format(
                tariff.get('name') or cls.TYPES.get(code, code), cls.via(frm_hit, to_hit, frm, dst)
            ),
        }


class Cdek(Carrier):
    """Тарифы «дверь — дверь» (delivery_mode 1), самый дешёвый; страхование — услугой INSURANCE выбранного тарифа."""

    CODE, NAME, SITE, WHOSE, KEYS = 'cdek', 'СДЭК', 'https://www.cdek.ru/ru/calculate', 'СДЭК', ('cdekId', 'cdekSecret')
    HINT_403 = '. Если ключи верны — защита сайта СДЭК не пропускает запросы с этого компьютера'
    _tokens: dict = {}  # идентификатор клиента → (токен, годен до)

    @classmethod
    def _headers(cls, store) -> dict:
        k = keys(store)
        token = cls._tokens.get(k.get('cdekId'))
        if not token or token[1] < datetime.now():
            j = Http.call(
                cls._url(store, 'base') + '/oauth/token',
                data={
                    'grant_type': 'client_credentials',
                    'client_id': k.get('cdekId', ''),
                    'client_secret': k.get('cdekSecret', ''),
                },
                headers={'User-Agent': BROWSER_UA},
                method='POST',
            )
            if not j.get('access_token'):
                raise ValueError('СДЭК: не выдан токен — проверьте идентификатор и секретный ключ')
            token = (j['access_token'], datetime.now() + timedelta(seconds=int(j.get('expires_in') or 3600) - 60))
            cls._tokens[k.get('cdekId')] = token
        return {'Authorization': 'Bearer ' + token[0], 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA}

    @classmethod
    def city(cls, store, names, headers) -> tuple:
        """(код, город) по поиску СДЭК с запоминанием в kv «lgdict:cdek»: точный город, затем ближайшие крупные."""
        cache = store.kv_get('lgdict:cdek') or {}
        items = cache.get('items') or {}
        for name in names:
            key = cnorm(name)
            if not key:
                continue
            if key not in items:
                query = urllib.parse.urlencode({'city': name, 'country_codes': 'RU', 'size': 10})
                j = Http.call(cls._url(store, 'base') + '/location/cities?' + query, headers=headers)
                rows = j if isinstance(j, list) else []
                hit = next((row for row in rows if cnorm(row.get('city')) == key), None)
                items[key] = hit.get('code') if hit else None
                store.kv_set('lgdict:cdek', {'at': _now(), 'items': items})
            if items.get(key):
                return items[key], name
        return None, names[0] if names else ''

    @staticmethod
    def _location(code, addr) -> dict:
        return dict({'code': code}, **({'address': addr} if addr else {}))

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        headers = cls._headers(store)
        frm_hit, to_hit = cls.city(store, cls.candidates(frm), headers), cls.city(store, cls.candidates(dst), headers)
        frm_code, dst_code = cls._both(frm_hit, to_hit)
        # места: масса — в граммах, габариты — в сантиметрах (API СДЭК v2, calculator/tarifflist); у нас — тонны и метры
        route = {
            'from_location': cls._location(frm_code, frm.get('addr')),
            'to_location': cls._location(dst_code, dst.get('addr')),
            'packages': [
                {
                    'weight': round(place['m'] * 1000000),
                    'length': round(place['l'] * 100),
                    'width': round(place['w'] * 100),
                    'height': round(place['h'] * 100),
                }
                for place in cls.units(places)
            ],
        }
        j = Http.call(
            cls._url(store, 'base') + '/calculator/tarifflist',
            data=dict({'type': 2, 'currency': 1, 'lang': 'rus'}, **route),
            headers=headers,
            method='POST',
        )
        if isinstance(j, dict) and j.get('errors'):
            raise ValueError('СДЭК: ' + '; '.join(str((err or {}).get('message') or err) for err in j['errors'])[:300])
        rows = [
            tariff
            for tariff in (j.get('tariff_codes') if isinstance(j, dict) else []) or []
            if number(tariff.get('delivery_sum'))
        ]
        door = [tariff for tariff in rows if tariff.get('delivery_mode') == 1]  # 1 — дверь-дверь
        if not door:
            raise ValueError(
                'СДЭК: нет тарифов «дверь — дверь» для такого груза'
                + (' (есть только до пункта выдачи)' if rows else '')
            )
        tariff = min(door, key=lambda x: number(x['delivery_sum']) or 0)
        ins = cls._insurance_of(store, headers, tariff.get('tariff_code'), route, declared) if declared else 0
        return {
            'price': round((number(tariff['delivery_sum']) or 0) + ins),
            'ins': round(ins),
            'days': tariff.get('period_max') or tariff.get('period_min'),
            'door': True,
            'note': 'дверь в дверь, тариф «{}»{}'.format(
                tariff.get('tariff_name') or tariff.get('tariff_code'), cls.via(frm_hit, to_hit, frm, dst)
            ),
        }

    @classmethod
    def _insurance_of(cls, store, headers, tariff, route, declared) -> float:
        """Страхование СДЭК по объявленной стоимости; не посчиталось — 0."""
        try:
            ins_resp = Http.call(
                cls._url(store, 'base') + '/calculator/tariff',
                headers=headers,
                method='POST',
                data=dict(
                    {
                        'type': 2,
                        'currency': 1,
                        'tariff_code': tariff,
                        'services': [{'code': 'INSURANCE', 'parameter': str(round(declared))}],
                    },
                    **route,
                ),
            )
            if not isinstance(ins_resp, dict):
                return 0
            svc = [x for x in (ins_resp.get('services') or []) if isinstance(x, dict) and x.get('code') == 'INSURANCE']
            ins = sum(number(x.get('total_sum') if x.get('total_sum') is not None else x.get('sum')) or 0 for x in svc)
            if not ins and number(ins_resp.get('total_sum')) and number(ins_resp.get('delivery_sum')):
                ins = max(0, (number(ins_resp['total_sum']) or 0) - (number(ins_resp['delivery_sum']) or 0))
            return ins
        except Exception:
            return 0


class Vozovoz(Carrier):
    """Дверь в дверь, если у обеих точек есть адрес с улицей и домом, иначе — от терминала до терминала."""

    CODE, NAME, SITE, KEYS = 'vozovoz', 'Возовоз', 'https://vozovoz.ru/calculate/', ('vozovozToken',)

    @staticmethod
    def _has_street(addr) -> bool:
        return bool(re.search(r'\d', str(addr or ''))) and ',' in str(addr or '')

    @classmethod
    def _point(cls, point) -> dict:
        addr = point.get('addr')
        return dict(
            {'location': point.get('name')}, **({'address': addr} if cls._has_street(addr) else {'terminal': 'default'})
        )

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        units = cls.units(places)
        cargo = {
            'dimension': {
                'quantity': len(units),
                'volume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3),
                'weight': round(sum(u['m'] for u in units) * 1000, 1),
                'max': {
                    'length': max(u['l'] for u in units),
                    'width': max(u['w'] for u in units),
                    'height': max(u['h'] for u in units),
                    'weight': round(max(u['m'] for u in units) * 1000, 1),
                },
            }
        }
        if declared:
            cargo['insurance'] = round(declared)
        body = {
            'object': 'price',
            'action': 'get',
            'params': {
                'cargo': cargo,
                'gateway': {'dispatch': {'point': cls._point(frm)}, 'destination': {'point': cls._point(dst)}},
            },
        }
        url = cls._url(store, 'url') + '?' + urllib.parse.urlencode({'token': keys(store).get('vozovozToken', '')})
        j = Http.call(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
        if isinstance(j, dict) and j.get('error'):
            err = j['error']
            raise ValueError(
                'Возовоз: ' + Http.hide(str((err or {}).get('message') if isinstance(err, dict) else err)[:300])
            )
        resp = (j or {}).get('response') or {}
        price = number(resp.get('price'))
        if not price:
            raise ValueError('Возовоз: в ответе нет стоимости')
        door = cls._has_street(frm.get('addr')) and cls._has_street(dst.get('addr'))
        delivery = resp.get('deliveryTime') or {}
        return {
            'price': round(price),
            'ins': round(cls._insurance(resp.get('service'))),
            'days': delivery.get('to') or delivery.get('from'),
            'door': door,
            'note': 'дверь в дверь' if door else 'от терминала до терминала',
        }


class Nrg(Carrier):
    """Автоперевозка (иначе самая дешёвая); забор и доставка, страхование — отдельными строками ответа."""

    HTTP_SERVER = 500
    BOTH_ENDS = 2

    CODE, NAME, SITE, WHOSE = 'nrg', 'Энергия', 'https://nrg-tk.ru/client/calculator/', 'Энергии'
    RETRY_PAUSE = 1.5  # с — их API временами отвечает 502
    RUB = 1  # idCurrency v4: 1 — рубли (/currencies)

    @staticmethod
    def token(store) -> str:
        return (keys(store).get('nrgToken') or '').strip()

    @staticmethod
    def rub(v) -> str:
        return f'{v or 0:,.0f} ₽'.replace(',', ' ')

    @classmethod
    def _call(cls, store, path, data=None) -> Any:
        """v4 с токеном — один адрес; v2 — основной и резервный. При 5xx / обрыве связи — повтор через паузу."""
        err: Any = None
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': BROWSER_UA}
        tok = cls.token(store)
        if tok:
            headers['NrgApi-DevToken'] = tok
            bases = [cls._url(store, 'v4')]
        else:
            bases = list(dict.fromkeys(cls._url(store, kind) for kind in ('base', 'reserve')))
        for _attempt in range(2):
            for base in bases:
                try:
                    return Http.call(
                        base + path, data=data, headers=headers, method='POST' if data is not None else None
                    )
                except urllib.error.HTTPError as exc:
                    err = exc
                    if tok and exc.code in (401, 403):
                        raise ValueError(
                            f'Энергия: токен не принят (HTTP {exc.code}) — проверьте «Энергия — токен разработчика» в «Ключах API»'
                        ) from exc
                    if exc.code < cls.HTTP_SERVER and exc.code not in (
                        403,
                        404,
                    ):  # 403/404 у одного адреса — пробуется другой
                        raise
                except Exception as exc:
                    err = exc
            time.sleep(cls.RETRY_PAUSE)
        raise err

    @classmethod
    def cities(cls, store) -> dict:
        api_v4 = bool(cls.token(store))

        def load() -> dict:
            j = cls._call(store, '/cities?lang=ru')
            rows = (
                j
                if isinstance(j, list)
                else (
                    _find(
                        j,
                        lambda obj: (
                            isinstance(obj, list)
                            and obj
                            and isinstance(obj[0], dict)
                            and 'id' in obj[0]
                            and 'name' in obj[0]
                        ),
                    )
                    or []
                )
            )
            out = {}
            for row in rows:
                name = cnorm(row.get('name'))
                if name and name not in out:
                    out[name] = row.get('id')
            return out

        return cls._cached(store, 'nrg4' if api_v4 else 'nrg', load)

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        api_v4 = bool(cls.token(store))
        cities = cls.cities(store)
        frm_code, dst_code = cls._both(cls.pick(cities, cls.candidates(frm)), cls.pick(cities, cls.candidates(dst)))
        items = [
            {'weight': round(place['m'] * 1000, 1), 'width': place['w'], 'height': place['h'], 'length': place['l']}
            for place in cls.units(places)
        ]
        if api_v4:
            for item in items:
                item['isStandardSize'] = False
            body = {
                'idCityFrom': frm_code,
                'idCityTo': dst_code,
                'cover': False,
                'idCurrency': cls.RUB,
                'items': items,
                'declaredCargoPrice': round(float(declared or 0), 2),
            }
        else:
            body = {
                'idCityFrom': frm_code,
                'idCityTo': dst_code,
                'cover': 0,
                'idCurrency': 0,
                'items': items,
                'declaredCargoPrice': round(declared or 0),
                'idClient': 0,
            }
        j = cls._call(store, '/prices' if api_v4 else '/price', body)
        if isinstance(j, dict) and (j.get('message') or j.get('error')) and not j.get('transfer'):
            raise ValueError('Энергия: ' + str(j.get('message') or j.get('error'))[:300])
        transfers = [
            transfer
            for transfer in ((j or {}).get('transfer') or [])
            if isinstance(transfer, dict) and number(transfer.get('price'))
        ]
        if not transfers:
            raise ValueError('Энергия: в ответе нет стоимости перевозки')
        transfer = next(
            (x for x in transfers if str(x.get('typeId')) == '1' or re.search(r'авто', str(x.get('type') or ''), re.I)),
            None,
        ) or min(transfers, key=lambda x: number(x['price']) or 0)
        price, door = number(transfer['price']) or 0, 0
        parts = ['перевозка ' + Nrg.rub(price)]  # раскладка цены — в строку предложения (сверить с сайтом Энергии)
        over = picked if isinstance(picked := transfer.get('oversize'), dict) else {}
        if oversize := number(over.get('price')):  # надбавка за негабарит (v4)
            price += oversize
            parts.append('негабарит ' + Nrg.rub(oversize))
        for k, name in (('request', 'забор'), ('delivery', 'доставка')):  # забор у отправителя и доставка получателю
            v = (j or {}).get(k)
            cost = number(v.get('price')) if isinstance(v, dict) else None
            if cost:
                price += cost
                door += 1
                parts.append(name + ' ' + Nrg.rub(cost))
        ins = 0.0
        for k, v in (j or {}).items() if isinstance(j, dict) else []:  # страхование Энергии по объявленной стоимости
            if re.search(r'insur', str(k), re.I):
                ins += (number(v.get('price')) if isinstance(v, dict) else number(v)) or 0
        price += ins
        days = number(transfer.get('maxTransferTimeDays'))
        if not days:
            interval = re.findall(r'\d+', str(transfer.get('interval') or ''))
            days = int(interval[-1]) if interval else None
        return {
            'price': round(price),
            'ins': round(ins),
            'days': int(days) if days else None,
            'door': door == cls.BOTH_ENDS,
            'note': ('дверь в дверь' if door == cls.BOTH_ENDS else 'от терминала до терминала')
            + ', '
            + str(transfer.get('type') or 'авто').lower()
            + ': '
            + ' + '.join(parts),
        }


class Jde(Carrier):
    """ЖелДорЭкспедиция: публичный расчёт без ключа, в т. ч. крупногабаритный груз."""

    CODE, NAME, SITE, WHOSE = 'jde', 'ЖелДорЭкспедиция', 'https://www.jde.ru/', 'ЖелДорЭкспедиции'
    MAX_T = 20.0  # весь груз, т: больше — только отдельной машиной (ATI.SU и тарифы)

    @classmethod
    def branches(cls, store, mode) -> dict:
        """{город: код филиала}: в городе — филиал с забором / доставкой и самым длинным допустимым местом."""

        def load() -> dict:
            j = Http.call(cls._url(store, 'base') + f'/geo/search?mode={mode}')
            best: dict = {}
            for row in j if isinstance(j, list) else []:
                name = cnorm((row or {}).get('city'))
                if not name or not row.get('code'):
                    continue
                length = number(str(row.get('max_l_gm') or '0').replace(',', '.')) or 99  # 0 — ограничений нет
                score = (1 if str(row.get('mst_pr_aex')) == '1' else 0, length)
                if name not in best or score > best[name][0]:
                    best[name] = (score, str(row['code']))
            return {name: v[1] for name, v in best.items()}

        return cls._cached(store, f'jde{mode}', load)

    @classmethod
    def quote(cls, store, frm, dst, places, declared=0) -> dict:
        units = cls.units(places)
        if sum(u['m'] for u in units) > cls.MAX_T + 1e-9:
            raise ValueError('ЖелДорЭкспедиция: груз тяжелее 20 000 кг — только отдельной машиной')
        frm_hit, to_hit = (
            cls.pick(cls.branches(store, 1), cls.candidates(frm)),
            cls.pick(cls.branches(store, 2), cls.candidates(dst)),
        )
        frm_code, dst_code = cls._both(frm_hit, to_hit)
        big = max(units, key=lambda u: u['l'] * u['w'] * u['h'])
        query = {
            'from': frm_code,
            'to': dst_code,
            'type': 1,
            'weight': round(sum(u['m'] for u in units) * 1000, 1),
            'volume': round(sum(u['l'] * u['w'] * u['h'] for u in units), 3),
            'length': big['l'],
            'width': big['w'],
            'height': big['h'],
            'quantity': len(units),
            'pickup': 1,
            'delivery': 1,
            # max_length_gab сервер ЖДЭ читает только с запятой («9,2»), остальные числа — с точкой
            'max_length_gab': ('{:g}'.format(max(max(u['l'], u['w'], u['h']) for u in units))).replace('.', ','),
            'pr_ins': 1 if declared else 0,
        }
        if declared:
            query['insValue'] = round(declared)
        j = Http.call(cls._url(store, 'base') + '/calculator/price?' + urllib.parse.urlencode(query))
        if not isinstance(j, dict) or str(j.get('result')) != '1':
            err = '; '.join(
                str(x.get('error')) for x in ((j or {}).get('services') or []) if isinstance(x, dict) and x.get('error')
            ) or str((j or {}).get('error') or '')
            raise ValueError('ЖелДорЭкспедиция: ' + (err or 'расчёт не выполнен')[:300])
        price = number(j.get('price'))
        if not price:
            raise ValueError('ЖелДорЭкспедиция: в ответе нет стоимости')
        ins = number(j.get('price_cargins')) or 0  # страхование, оформление и маркировка — сверх price
        extra = sum(number(j.get(k)) or 0 for k in ('price_doc', 'price_mark'))
        items = {x.get('item') for x in (j.get('services') or []) if isinstance(x, dict)}
        door = {'pickup', 'delivery'} <= items
        ok, _why = LtlLimits.fits(places, store)
        days = number(j.get('maxdays')) or number(j.get('mindays'))
        return {
            'price': round(price + ins + extra),
            'ins': round(ins),
            'days': int(days) if days else None,
            'door': door,
            'note': ('сборный груз' if ok else 'крупногабаритный груз сборной отправкой (негабарит по размерам места)')
            + (', дверь в дверь (забор и доставка ЖДЭ)' if door else ', от терминала до терминала')
            + cls.via(frm_hit, to_hit, frm, dst),
        }


# сборный груз: порядок — порядок предложений в расчёте; ЖДЭ берёт и крупногабаритный груз
LTL_CARRIERS = (Jde, Pec, Dellin, Nrg, Cdek, Vozovoz, Kit)
CARRIERS = {cls_carrier.CODE: cls_carrier for cls_carrier in (Ati, Pec, Dellin, Kit, Cdek, Vozovoz, Nrg, Jde)}


def providers(store) -> dict:
    """{код: считает ли}: перевозчик включён в «Настройках» и задан его ключ (ПЭК, Энергия и ЖДЭ — без ключа)."""
    return {cid: carrier.has_keys(store) and CarrierApi.enabled(store, cid) for cid, carrier in CARRIERS.items()}


class DeliveryQuote:
    """Доставка по России: тарифы «Настроек», машина по ATI.SU и сборный груз перевозчиков — параллельно."""

    HTTP_FORBIDDEN = 403

    WAIT = 40  # с — ожидание ответа перевозчика сборного груза

    def __init__(self, store, req) -> None:
        self.store, self.req = store, req
        self.frm, self.dst = req.get('from') or {}, req.get('to') or {}
        self.places = self.cargo(req.get('places'))
        self.unload = number(req.get('unload')) or 0
        self.providers = providers(store)
        self.offers: list = []
        self.errors: list = []
        self.stamp = _now()

    # пределы груза в запросе (в запросе размеры места — м, масса — т): больше — ошибка ввода (400), а не расчёт на миллионы мест
    MAX_ROWS, MAX_UNITS, MAX_M, MAX_T = 100, 1000, 30, 100

    @classmethod
    def cargo(cls, places) -> list:
        """Места груза [{l, w, h, m, qty}] из запроса: неполные пропускаются, неверные — ValueError с понятным текстом."""
        if places is None:
            return []
        if not isinstance(places, list) or len(places) > cls.MAX_ROWS:
            raise ValueError(f'Груз: нужен список до {cls.MAX_ROWS} строк')
        out: list[dict] = []
        for place in places:
            if not isinstance(place, dict):
                raise ValueError('Груз: неверная строка')
            v = {k: number(place.get(k)) or 0 for k in ('l', 'w', 'h', 'm')}
            if not all(v.values()):
                continue
            qty = number(place.get('qty') or 1)
            if not all(0 < x <= (cls.MAX_T if k == 'm' else cls.MAX_M) for k, x in v.items()):
                raise ValueError(f'Груз: размеры места — до {cls.MAX_M} м, масса — до {cls.MAX_T} т')
            if qty is None or qty != int(qty) or not 1 <= qty <= cls.MAX_UNITS:
                raise ValueError(f'Груз: количество мест — целое число от 1 до {cls.MAX_UNITS}')
            out.append(dict(v, qty=int(qty)))
        if sum(place['qty'] for place in out) > cls.MAX_UNITS:
            raise ValueError(f'Груз: всего не больше {cls.MAX_UNITS} мест')
        return out

    def run(self) -> dict:
        model = number(self.req.get('model'))
        if model:
            self.offers.append(
                {
                    'src': 'Тарифы «Настроек»',
                    'kind': 'model',
                    'price': round(model),
                    'complete': True,
                    'note': self.req.get('modelNote') or 'расчёт по тарифам программы',
                    'at': self.stamp,
                }
            )
        if self.providers['ati'] and self.req.get('vehicles'):
            try:
                self.offers.append(self._ftl(self.req['vehicles']))
            except Exception as exc:
                self.errors.append({'src': 'ATI.SU', 'msg': Http.error(exc)})
        if self.places and self.req.get('ltl') is False:  # станция в сборе — только отдельной открытой машиной
            self.errors.append(
                {'src': 'Сборный груз', 'skip': True, 'msg': 'станция в сборе — только отдельной открытой машиной'}
            )
        elif self.places:
            self._ltl()
        full = [offer for offer in self.offers if offer.get('complete')]
        best = max(full, key=lambda item: item['price']) if full else None
        return {
            'offers': self.offers,
            'errors': self.errors,
            'best': best,
            'at': self.stamp,
            'providers': self.providers,
        }

    def _ati_direction(self) -> tuple:
        """Направление «Средних ставок» и признак «взяты ближайшие крупные города» (из alt)."""
        ati = AtiDirections(self.store)
        for frm_alt in Carrier.candidates(self.frm):
            for dst_alt in Carrier.candidates(self.dst):
                direction = ati.find(frm_alt, dst_alt)
                if direction:
                    return direction, (frm_alt, dst_alt) != (self.frm.get('name'), self.dst.get('name'))
        raise ValueError(
            'направления {} → {} нет в «Средних ставках» ATI.SU'.format(self.frm.get('name'), self.dst.get('name'))
        )

    def _ftl(self, vehicles) -> dict:
        """Отдельные машины: по каждой — верхняя граница средних ставок за рейс или за км × расстояние, плюс надбавки."""
        direction, nearby = self._ati_direction()
        distance = number(self.req.get('km')) or 0
        total, parts = 0.0, []
        for v in vehicles:
            car, ton = Ati.CAR_CLASSES.get(v.get('id'), ('tent', 20))
            price = Ati.price(self.store, direction, car, ton)
            trip = max(price['upperRub'] or 0, (price['upperKm'] or 0) * distance)
            total += trip + (number(v.get('extras')) or 0)
            per_km = (
                ', {} ₽/км'.format('{:,.0f}'.format(price['upperKm']).replace(',', ' ')) if price['upperKm'] else ''
            )
            parts.append(
                '{}: {} ₽ (верх средних ставок ATI.SU, {} {} т{})'.format(
                    v.get('name') or v.get('id'),
                    f'{trip:,.0f}'.replace(',', ' '),
                    Ati.BODY.get(car, car),
                    str(ton).replace('.', ','),
                    per_km,
                )
            )
        note = '; '.join(parts)
        if nearby:
            note = 'ставка по направлению {} → {} (ближайшие крупные города): {}'.format(
                direction['from'], direction['to'], note
            )
        if self.unload or any(number(v.get('extras')) for v in vehicles):
            note += '; разгрузка и разрешения — по тарифам программы'
        return {
            'src': 'ATI.SU «Средние ставки»',
            'kind': 'ftl',
            'price': round(total + self.unload),
            'base': round(total),
            'unload': round(self.unload),
            'door': True,
            'complete': True,
            'at': self.stamp,
            'note': note,
            'url': 'https://ati.su/rates',
        }

    def _ltl(self) -> None:
        """Сборный груз — если место и общий вес в пределах; иначе только ЖДЭ (берёт и крупногабарит, до 20 т)."""
        ok, why = LtlLimits.fits(self.places, self.store)
        if not ok:
            big_ok = self.providers['jde'] and sum(u['m'] for u in Carrier.units(self.places)) <= Jde.MAX_T + 1e-9
            self.errors.append(
                {
                    'src': 'Сборный груз (ПЭК, Деловые Линии, КИТ, СДЭК, Возовоз, Энергия)',
                    'skip': True,
                    'msg': why + ('; крупногабаритный груз считает ЖелДорЭкспедиция' if big_ok else ''),
                }
            )
            if not big_ok:
                return
        declared = number(self.req.get('declared')) or 0  # объявленная стоимость груза — для страхования перевозчика
        carriers = [
            cls_carrier
            for cls_carrier in LTL_CARRIERS
            if self.providers[cls_carrier.CODE] and (ok or cls_carrier is Jde)
        ]
        results = {}

        def run(carrier) -> None:
            try:
                results[carrier] = carrier.quote(self.store, self.frm, self.dst, self.places, declared)
            except Exception as exc:
                results[carrier] = exc

        threads = [threading.Thread(target=run, args=(cls_carrier,), daemon=True) for cls_carrier in carriers]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(self.WAIT)
        for cls_carrier in carriers:
            self._add_ltl(cls_carrier, results.get(cls_carrier))

    def _add_ltl(self, carrier, res) -> None:
        if isinstance(res, dict):
            ins = round(res.get('ins') or 0)  # страхование перевозчика (входит в его цену) — берётся вместо своего
            self.offers.append(
                {
                    'src': carrier.NAME,
                    'kind': 'ltl',
                    'price': round(res['price'] + self.unload),
                    'base': round(res['price'] - ins),
                    'ins': ins,
                    'unload': round(self.unload),
                    'door': bool(res.get('door')),
                    'days': res.get('days'),
                    'complete': True,
                    'at': self.stamp,
                    'url': carrier.SITE,
                    'note': res.get('note', '') + ('; + разгрузка по тарифам программы' if self.unload else ''),
                }
            )
            return
        msg = Http.error(res) if res else f'нет ответа за {self.WAIT} с'
        if isinstance(res, urllib.error.HTTPError) and res.code == self.HTTP_FORBIDDEN:
            msg += carrier.HINT_403
        self.errors.append({'src': carrier.NAME, 'msg': msg, 'url': carrier.SITE})


class TariffInput:
    """Тарифы доставки из «Настроек»: JSON до 100 КБ, счета для сверки — только известные поля."""

    KM_MAX = 20000
    RUB_MAX = 1e9

    MAX_BYTES = 100000
    MAX_FACTS = 300

    @classmethod
    def check(cls, data) -> dict:
        if not isinstance(data, dict) or len(json.dumps(data)) > cls.MAX_BYTES:
            raise ValueError('Неверный формат тарифов')
        facts = data.get('facts')
        if facts is None:
            return data
        if not isinstance(facts, list) or len(facts) > cls.MAX_FACTS:
            raise ValueError(f'Счетов для сверки тарифов — не больше {cls.MAX_FACTS}')
        out = []
        for fact in facts:
            if not isinstance(fact, dict):
                raise ValueError('Неверный формат счёта для сверки тарифов')
            distance, total = number(fact.get('km')), number(fact.get('sum'))
            if not (distance and 0 < distance <= cls.KM_MAX) or not (total and 0 < total <= cls.RUB_MAX):
                raise ValueError('Счёт для сверки тарифов: расстояние от 1 до 20 000 км и сумма больше нуля')
            stamp = str(fact.get('at') or '')[:10]
            if stamp and not re.match(r'^\d{4}-\d{2}-\d{2}$', stamp):
                raise ValueError('Дата счёта для сверки тарифов — в формате ГГГГ-ММ-ДД')
            out.append(
                {
                    'at': stamp,
                    'route': str(fact.get('route') or '')[:120],
                    'km': distance,
                    'cls': str(fact.get('cls') or '')[:40],
                    'sum': total,
                }
            )
        data['facts'] = out
        return data


def auto_settings(store) -> dict:
    logistics = store.kv_get('logistics') or {}
    auto = picked if isinstance(picked := logistics.get('auto'), dict) else {}

    def whole(v, default, high) -> int:
        return min(high, max(1, int(number(v) or default)))  # «x», 0, NaN — значение по умолчанию

    routes = picked if isinstance(picked := auto.get('routes'), list) and auto.get('routes') else REF_ROUTES
    return {
        'on': auto.get('on', True),
        'days': whole(auto.get('days'), 1, 365),
        'routes': routes,
        'period': whole(auto.get('period'), 30, 365),
    }


class AutoRates:
    """Ставки ₽/км классов машин — верхняя граница средних ставок ATI.SU → kv «logisticsAuto»."""

    @classmethod
    def scheduled(cls, store) -> dict | None:
        """Плановое обновление: если включено и прошлое старше срока из настроек."""
        if not providers(store)['ati']:
            return None
        cfg = auto_settings(store)
        if not cfg['on']:
            return None
        last = store.kv_get('logisticsAuto') or {}
        try:
            if last.get('at') and datetime.fromisoformat(last['at']) > datetime.now() - timedelta(days=cfg['days']):
                return None
        except ValueError:
            pass
        return cls._refresh(store, cfg)

    @classmethod
    def now(cls, store) -> dict | None:
        """Обновление по кнопке — сразу."""
        if not providers(store)['ati']:
            return None
        return cls._refresh(store, auto_settings(store))

    @staticmethod
    def _refresh(store, cfg: dict) -> dict | None:
        if not _lock.acquire(blocking=False):
            return None
        try:
            out, errors, ati = {}, [], AtiDirections(store)
            for cid, (car, ton) in Ati.CAR_CLASSES.items():
                best, rows = None, []
                for route in cfg['routes']:
                    frm_name, _, dst_name = str(route).partition('—')
                    if not dst_name:
                        frm_name, _, dst_name = str(route).partition('-')
                    try:
                        direction = ati.find(frm_name.strip(), dst_name.strip())
                        if not direction:
                            raise ValueError('направления нет в «Средних ставках»')
                        price = Ati.price(store, direction, car, ton, cfg['period'])
                        if price['upperKm']:
                            # длина направления и цена рейса — для тарифа в два участка (ставка до 1 000 км и дальше считается в программе)
                            dist = (
                                round(price['upperRub'] / price['upperKm'])
                                if price['upperRub'] and price['upperKm']
                                else None
                            )
                            rows.append(
                                {
                                    'route': route.strip(),
                                    'km': round(price['upperKm'], 1),
                                    'avg': price['avgKm'] and round(price['avgKm'], 1),
                                    'trip': round(price['upperRub']) if price['upperRub'] else None,
                                    'dist': dist,
                                }
                            )
                            best = max(best or 0, price['upperKm'])
                    except Exception as exc:
                        errors.append(f'{route.strip()}, {cid}: {Http.error(exc)}')
                if best:
                    out[cid] = {
                        'km': round(best),
                        'routes': rows,
                        'src': f'ATI.SU «Средние ставки»: верхняя граница за {cfg["period"]} дн., '
                        f'максимум по {len(rows)} направл., с НДС',
                    }
            rec = {'at': _now(), 'classes': out, 'errors': errors[:30]}
            store.kv_set('logisticsAuto', rec)
            return rec
        finally:
            _lock.release()
