"""Контрагенты: реквизиты по ИНН (DaData, ФНС), проверка (Checko, OFData, ГИР БО), справочник клиентов."""

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from defaults import SrvVal
from net import Net

TIMEOUT = 15
CHECKO_DAILY = 100  # бесплатный лимит Checko, запросов в календарный день (меняется в «Ключах API»)
CHECK_COST = 3  # полная проверка: карточка, суды (ответчик), ФССП; бухотчётность — из ГИР БО ФНС
# сроки и пороги проверок — «Значения программы» (cp.*)
MSK = timezone(timedelta(hours=3))


def msk_today() -> str:
    return datetime.now(MSK).date().isoformat()


def manual_links(inn) -> list:
    """Бесплатные официальные сервисы и Rusprofile — проверить вручную то, что не вошло в проверку."""
    quoted = urllib.parse.quote(inn)
    return [
        {'name': 'Rusprofile', 'url': Rusprofile.url(inn)},
        {
            'name': 'Прозрачный бизнес (ФНС)',
            'url': 'https://pb.nalog.ru/search.html#t=1&mode=search-all&queryAll=' + quoted,
        },
        {'name': 'Бухотчётность (ГИР БО)', 'url': GirBo.search_url(inn)},
        {'name': 'Арбитражные дела', 'url': 'https://kad.arbitr.ru/'},
        {'name': 'Исполнительные производства (ФССП)', 'url': 'https://fssp.gov.ru/iss/ip/'},
        {'name': 'Банкротство (Федресурс)', 'url': 'https://fedresurs.ru/search/entity?code=' + quoted},
        {
            'name': 'Недобросовестные поставщики',
            'url': 'https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html?searchString=' + quoted,
        },
        {'name': 'Checko (сайт)', 'url': CheckoApi.site(inn)},
    ]


class LimitError(Exception):
    """Лимит запросов сервиса проверки на сегодня исчерпан."""


def http_json(url, data=None, headers=None, method=None) -> Any:
    """Запрос к API → разобранный JSON. data: dict/list — JSON (если Content-Type: application/json) или форма; bytes — как есть."""
    hdrs = {'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh)', 'Accept': 'application/json'}
    hdrs.update(headers or {})
    body = None
    if data is not None:
        if isinstance(data, (dict, list)) and hdrs.get('Content-Type', '').startswith('application/json'):
            body = json.dumps(data).encode('utf-8')
        elif isinstance(data, dict):
            body = urllib.parse.urlencode(data).encode('utf-8')
            hdrs.setdefault('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
        else:
            body = data
    raw = Net.request(url, data=body, headers=hdrs, method=method, timeout=TIMEOUT)  # предел ответа и повтор GET — Net
    return json.loads(raw.decode('utf-8-sig'))


def valid_inn(inn) -> bool:
    """Проверка ИНН по контрольным цифрам (10 — организация, 12 — ИП)."""
    digits_text = re.sub(r'\D', '', str(inn or ''))

    def ctl(digits, coefs) -> int:
        return sum(int(digit) * coef for digit, coef in zip(digits, coefs, strict=False)) % 11 % 10

    if len(digits_text) == 10:
        return ctl(digits_text, [2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(digits_text[9])
    if len(digits_text) == 12:
        return ctl(digits_text, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(digits_text[10]) and ctl(
            digits_text, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
        ) == int(digits_text[11])
    return False


def dig(data, *path, default=None) -> Any:
    """Безопасное чтение вложенных полей: g(d, 'Статус', 'Наим')."""
    cur = data
    for k in path:
        if isinstance(cur, dict):
            cur = cur.get(k)
        elif isinstance(cur, list) and isinstance(k, int) and len(cur) > k:
            cur = cur[k]
        else:
            return default
        if cur is None:
            return default
    return cur


def _num(v) -> float | None:
    try:
        return float(str(v).replace(' ', '').replace(',', '.'))
    except (TypeError, ValueError):
        return None


class CheckoApi:
    """Checko (api.checko.ru): карточка, бухотчётность, суды, ФССП."""

    NAME = 'Checko'
    BASE = 'https://api.checko.ru/v2/'
    KEY = 'checkoKey'
    DAILY = 'checkoDaily'  # лимит запросов в день (по тарифу) — «Ключи API»
    QUOTA = 'checkoQuota'  # kv: {'day', 'used'}
    FREE_DAILY = CHECKO_DAILY
    FINANCES = True  # бухотчётность входит в бесплатный тариф
    SITE = 'https://checko.ru/search?query='
    ENDPOINTS = {
        'finances': ('finances', {}),
        'courts': ('legal-cases', {'role': 'defendant'}),
        'fssp': ('enforcements', {}),
    }
    PART = {'company': 'карточка', 'finances': 'бухотчётность', 'courts': 'суды', 'fssp': 'ФССП'}

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def site(cls, inn) -> str:
        return cls.SITE + urllib.parse.quote(inn)

    def key(self) -> str:
        return str((self.store.kv_get('integrations', {}) or {}).get(self.KEY) or '').strip()

    def limit(self) -> int:
        try:
            return max(1, int((self.store.kv_get('integrations', {}) or {}).get(self.DAILY) or self.FREE_DAILY))
        except (TypeError, ValueError):
            return self.FREE_DAILY

    def quota(self) -> dict:
        quota = self.store.kv_get(self.QUOTA) or {}
        today = msk_today()
        used = int(quota.get('used') or 0) if quota.get('day') == today else 0
        limit = self.limit()
        left = max(0, limit - used)
        return {
            'name': self.NAME,
            'day': today,
            'used': used,
            'limit': limit,
            'left': left,
            'checks': left // CHECK_COST,
            'key': bool(self.key()),
        }

    def spend(self, count=1, meta=None, exhausted=False) -> None:
        with self.store.lock:
            quota = self.quota()
            used = quota['used'] + count
            cnt = (meta or {}).get('today_request_count') if isinstance(meta, dict) else None
            if isinstance(cnt, int) and cnt >= 0:
                used = cnt  # сервис сам сообщает, сколько запросов сделано сегодня
            if exhausted:
                used = max(used, quota['limit'])
            self.store.kv_set(self.QUOTA, {'day': quota['day'], 'used': used})

    def get(self, endpoint, inn, **extra) -> dict:
        """Запрос с учётом лимита; лимит исчерпан — LimitError, другая ошибка — RuntimeError с понятным текстом."""
        if self.quota()['left'] <= 0:
            raise LimitError(f'Лимит запросов {self.NAME} на сегодня исчерпан')
        url = self.BASE + endpoint + '?' + urllib.parse.urlencode(dict({'key': self.key(), 'inn': inn}, **extra))
        try:
            j = http_json(url)
        except urllib.error.HTTPError as exc:
            self.spend(1, exhausted=exc.code in (402, 429))
            if exc.code in (402, 429):
                raise LimitError(f'Лимит запросов {self.NAME} на сегодня исчерпан') from exc
            raise RuntimeError(
                'ключ не принят — проверьте его в «Ключах API»'
                if exc.code in (401, 403)
                else f'ошибка сервиса (HTTP {exc.code})'
            ) from exc
        except (urllib.error.URLError, OSError) as exc:
            slow = isinstance(exc, socket.timeout) or isinstance(getattr(exc, 'reason', None), socket.timeout)
            raise RuntimeError(f'сервис не ответил за {TIMEOUT} с' if slow else 'нет связи с сервисом') from exc
        except ValueError:
            raise RuntimeError('ответ в неожиданном формате') from None
        if not isinstance(j, dict):
            raise RuntimeError('ответ в неожиданном формате')
        meta = j.get('meta') or {}
        lim = meta.get('status') == 'error' and re.search(
            r'лимит|limit|исчерпан|превыш|баланс|balance', str(meta.get('message') or ''), re.I
        )
        self.spend(1, meta, exhausted=bool(lim))
        if lim:
            raise LimitError(str(meta.get('message') or f'Лимит запросов {self.NAME} на сегодня исчерпан'))
        return j

    def fetch(self, inn, parts) -> tuple:
        """Части проверки ('company', 'finances', 'courts', 'fssp') → (raw, meta, errors, limited)."""
        raw, meta, errors, limited = {}, None, [], False
        for name in parts:
            endpoint, extra = (
                (('entrepreneur' if len(inn) == 12 else 'company'), {}) if name == 'company' else self.ENDPOINTS[name]
            )
            try:
                j = self.get(endpoint, inn, **extra)
            except LimitError as exc:
                limited = True
                errors.append(str(exc))
                break
            except Exception as exc:
                errors.append(f'{self.NAME}, {self.PART.get(name, name)}: {exc}')
                if name == 'company':
                    break  # без карточки остальное не нужно — дальше резерв или бесплатная проверка
                continue
            meta = j.get('meta') or meta
            if dig(j, 'meta', 'status') == 'error':
                errors.append(
                    '{}, {}: {}'.format(
                        self.NAME, self.PART.get(name, name), dig(j, 'meta', 'message', default='ошибка')
                    )
                )
                if name == 'company':
                    break
                continue
            raw[name] = j.get('data') or {}
            if name == 'company' and not raw[name]:
                errors.append(f'{self.NAME}: организация не найдена')
                break
        return raw, meta, errors, limited


class OfDataApi(CheckoApi):
    """OFData — резерв Checko с тем же форматом ответов и своим бесплатным лимитом (без бухотчётности)."""

    NAME = 'OFData'
    BASE = 'https://api.ofdata.ru/v2/'
    KEY = 'ofdataKey'
    DAILY = 'ofdataDaily'
    QUOTA = 'ofdataQuota'
    FREE_DAILY = 100
    FINANCES = False


class GirBo:
    """ГИР БО ФНС: выручка, прибыль и активы за последние годы, бесплатно и без ключа."""

    NAME = 'ГИР БО ФНС'
    HOSTS = ('https://bo.nalog.gov.ru', 'https://bo.nalog.ru')  # витрина переехала на .gov.ru; старый адрес — запасной
    USER_AGENT = (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    )
    YEARS = 3
    THOUSAND = 1000

    @classmethod
    def search_url(cls, inn) -> str:
        return cls.HOSTS[0] + '/search?query=' + urllib.parse.quote(inn)

    @classmethod
    def finances(cls, inn) -> dict | None:
        """{'finances': [{'year', 'revenue', 'profit', 'assets'}, …] (новые годы первыми), 'url'} или None — сервис не ответил."""
        try:
            return cls.load(inn)
        except Exception:
            return None

    @classmethod
    def load(cls, inn) -> dict | None:
        """То же, но ошибка — исключением с понятным текстом (для «Проверить все подключения»)."""
        err = None
        for host in cls.HOSTS:
            try:
                return cls._load(host, inn)
            except Exception as exc:
                err = exc
        raise RuntimeError(cls._why(err))

    @staticmethod
    def _why(exc) -> str:
        """Причина сбоя для человека — без адресов и технических подробностей."""
        if isinstance(exc, urllib.error.HTTPError):
            return f'сервис ответил ошибкой (HTTP {exc.code})'
        if isinstance(exc, (urllib.error.URLError, OSError)):
            slow = isinstance(getattr(exc, 'reason', exc), (socket.timeout, TimeoutError)) or 'timed out' in str(exc)
            return f'сервис не ответил за {TIMEOUT} с' if slow else 'нет связи с сервисом'
        if isinstance(exc, ValueError) and str(exc).startswith(('поиск ГИР БО', 'отчётность ГИР БО')):
            return str(exc)
        return 'ответ в неожиданном формате'

    @classmethod
    def _get(cls, host, path, params=None) -> Any:
        return http_json(
            host + path + ('?' + urllib.parse.urlencode(params) if params else ''),
            headers={
                'User-Agent': cls.USER_AGENT,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'ru-RU,ru;q=0.9',
                'Referer': host + '/',
            },
        )

    @staticmethod
    def _plain(v) -> str:
        return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', str(v if v is not None else ''))).strip()

    @classmethod
    def _load(cls, host, inn) -> dict:
        found = cls._get(host, '/advanced-search/organizations/search', {'query': inn, 'page': 0, 'size': 20})
        if not isinstance(found, dict) or not isinstance(found.get('content'), list):
            raise ValueError('поиск ГИР БО: неожиданный ответ')
        org = next(
            (
                x
                for x in found['content']
                if isinstance(x, dict)
                and re.sub(r'\D', '', cls._plain(x.get('inn'))) == inn
                and x.get('id') is not None
            ),
            None,
        )
        if not org:
            return {'finances': [], 'url': ''}  # нет в ГИР БО: ИП, банк, страховая, организация моложе года
        oid = int(org['id'])
        reports = cls._get(host, f'/nbo/organizations/{oid}/bfo/')
        if isinstance(reports, dict):
            reports = next(
                (
                    reports[k]
                    for k in ('items', 'content', 'data', 'reports', 'results')
                    if isinstance(reports.get(k), list)
                ),
                None,
            )
        if not isinstance(reports, list):
            raise ValueError('отчётность ГИР БО: неожиданный ответ')
        rows = {}
        for report in reports:
            year = str((report or {}).get('period') or '') if isinstance(report, dict) else ''
            if not re.match(r'^(19|20)\d\d$', year):
                continue
            corr = cls._correction(report)
            fin_res, bal = corr.get('financialResult') or {}, corr.get('balance') or {}
            row = {
                'year': year,
                'revenue': cls._rub(fin_res.get('current2110'), report.get('gainSum')),
                'profit': cls._rub(fin_res.get('current2400')),
                'assets': cls._rub(bal.get('current1600'), report.get('actives')),
            }
            if row['revenue'] is not None or row['profit'] is not None or row['assets'] is not None:
                rows[year] = row
        return {
            'finances': [rows[y] for y in sorted(rows, reverse=True)[: cls.YEARS]],
            'url': host + f'/organizations-card/{oid}',
        }

    @staticmethod
    def _correction(report) -> dict:
        """Действующая редакция отчёта за год: из «typeCorrections» (новый формат) или «corrections» — последняя по номеру."""
        cand = [x.get('correction') for x in report.get('typeCorrections') or [] if isinstance(x, dict)]
        cand += list(report.get('corrections') or [])
        valid = [corr for corr in cand if isinstance(corr, dict)]
        if not valid:
            return {}
        return max(
            valid,
            key=lambda corr: (
                _num(corr.get('correctionVersion')) or 0,
                1 if corr.get('lastCorrection') else 0,
                _num(corr.get('id')) or 0,
            ),
        )

    @classmethod
    def _rub(cls, *vals) -> float | None:
        for v in vals:
            num = _num(v) if v is not None else None
            if num is not None:
                return num * cls.THOUSAND
        return None


class Rusprofile:
    """Rusprofile (rusprofile.ru) — резерв Checko «вручную»."""

    SEARCH = 'https://www.rusprofile.ru/search?query='

    @classmethod
    def url(cls, inn) -> str:
        return cls.SEARCH + urllib.parse.quote(re.sub(r'\D', '', str(inn or '')))


class Counterparties:
    KEY_FIELDS = (
        'checkoKey',
        'ofdataKey',
        'dadataKey',
        'convertapiKey',
        'atiToken',
        'dellinKey',
        'kitToken',
        'cdekId',
        'cdekSecret',
        'vozovozToken',
        'nrgToken',
        'deepseekKey',
    )
    DAILY_FIELDS = ('checkoDaily', 'ofdataDaily')  # лимит запросов в день (по тарифу сервиса)
    KEY_RX = re.compile(r'^[\x21-\x7e]{4,300}$')  # ключи и токены — латиница, цифры и знаки, без пробелов

    def __init__(self, store) -> None:
        self.store = store  # SQLite (storage.Store): контрагенты, проверки, ключи API
        self.checko = CheckoApi(store)
        self.ofdata = OfDataApi(store)

    def apis(self) -> list:
        """Сервисы проверки с ключом: Checko — основной, OFData — резерв."""
        return [api for api in (self.checko, self.ofdata) if api.key()]

    def keys(self) -> dict:
        return self.store.kv_get('integrations', {}) or {}

    def keys_public(self) -> dict:
        k = self.keys()

        def mask(v) -> str:
            return (v[:4] + '…' + v[-4:]) if v and len(v) > 10 else ('задан' if v else '')

        return {
            'checko': bool(k.get('checkoKey')),
            'checkoMask': mask(k.get('checkoKey', '')),
            'ofdata': bool(k.get('ofdataKey')),
            'ofdataMask': mask(k.get('ofdataKey', '')),
            'dadata': bool(k.get('dadataKey')),
            'dadataMask': mask(k.get('dadataKey', '')),
            'convertapi': bool(k.get('convertapiKey')),
            'convertapiMask': mask(k.get('convertapiKey', '')),
            'checkoDaily': self.checko.limit(),
            'ofdataDaily': self.ofdata.limit(),
            'quota': self.quota(),
            'ati': bool(k.get('atiToken')),
            'atiMask': mask(k.get('atiToken', '')),
            'dellin': bool(k.get('dellinKey')),
            'dellinMask': mask(k.get('dellinKey', '')),
            'kit': bool(k.get('kitToken')),
            'kitMask': mask(k.get('kitToken', '')),
            'cdek': bool(k.get('cdekId') and k.get('cdekSecret')),
            'cdekIdMask': mask(k.get('cdekId', '')),
            'cdekSecretMask': mask(k.get('cdekSecret', '')),
            'vozovoz': bool(k.get('vozovozToken')),
            'vozovozMask': mask(k.get('vozovozToken', '')),
            'nrg': bool(k.get('nrgToken')),
            'nrgMask': mask(k.get('nrgToken', '')),
            'deepseek': bool(k.get('deepseekKey')),
            'deepseekMask': mask(k.get('deepseekKey', '')),
        }

    def save_keys(self, body) -> dict:
        """Ключи и лимиты из «Настройки → Ключи API»: только известные поля; пустое значение — удалить ключ."""
        cur = self.keys()
        new = json.loads(body.decode('utf-8'))
        if not isinstance(new, dict):
            raise ValueError('Неверный запрос')
        for k in self.KEY_FIELDS:
            if k in new:
                v = str(new[k] if new[k] is not None else '').strip()
                if v and not self.KEY_RX.match(v):
                    raise ValueError(
                        f'Ключ «{k}» не сохранён: в ключе бывают только латинские буквы, цифры и знаки, без пробелов '
                        '(от 4 до 300 символов). Скопируйте его из личного кабинета сервиса ещё раз.'
                    )
                if v:
                    cur[k] = v
                else:
                    cur.pop(k, None)
        for k in self.DAILY_FIELDS:  # бесплатный лимит в день (по тарифу); 0 или пусто — по умолчанию
            if k in new:
                try:
                    num = int(new.get(k) or 0)
                except (TypeError, ValueError):
                    raise ValueError('Лимит запросов в день — целое число от 1 до 100 000') from None
                if num > 0:
                    cur[k] = min(num, 100000)
                else:
                    cur.pop(k, None)
        self.store.kv_set('integrations', cur)
        return self.keys_public()

    @staticmethod
    def _check_id(cid) -> None:
        if not re.match(r'^[A-Za-z0-9_-]{1,64}$', cid or ''):
            raise ValueError('Некорректный идентификатор контрагента')

    def save_client(self, cid, body, author: str = '', base_rev=None) -> dict:
        client = json.loads(body.decode('utf-8'))
        self._check_id(cid)
        rev_in = client.pop('_rev', None)
        if base_rev is None:
            base_rev = rev_in
        if not isinstance(client, dict):
            raise ValueError('Ожидался объект клиента')
        old = self.store.client_get(cid) or {}
        replace = bool(
            client.pop('_replace', False)
        )  # из справочника «Настроек»: списки — как в карточке (удалённое удаляется)

        def dicts(v) -> list:
            return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []

        # из КП объекты и контакты накапливаются: повторы не дублируются, у того же контакта — новые телефон, e-mail
        def merge(old_list, new_list, key) -> list:
            res = [dict(x) for x in dicts(old_list)]
            by_key = {key(x): x for x in res}
            for x in dicts(new_list):
                k = key(x)
                if not k:
                    continue
                if k in by_key:
                    by_key[k].update({field: v for field, v in x.items() if str(v if v is not None else '').strip()})
                else:
                    res.insert(0, x)
                    by_key[k] = x
            return res[:30]

        def norm(text) -> str:
            return re.sub(r'\s+', ' ', str(text or '')).strip().lower()

        if replace:
            client['objects'], client['contacts'] = (
                dicts(client.get('objects'))[:30],
                dicts(client.get('contacts'))[:30],
            )
        else:
            client['objects'] = merge(
                old.get('objects'),
                client.get('objects'),
                lambda obj: norm(obj.get('purpose')) + '|' + norm(obj.get('address')),
            )
            client['contacts'] = merge(old.get('contacts'), client.get('contacts'), lambda obj: norm(obj.get('name')))
        client['kpCount'] = int(old.get('kpCount', 0)) + (1 if client.pop('_usedInKp', False) else 0)
        client['id'] = cid
        client['createdAt'] = old.get('createdAt') or datetime.now().isoformat(timespec='seconds')
        client['updatedAt'] = datetime.now().isoformat(timespec='seconds')
        if not client.get('check') and old.get('check'):
            client['check'] = old['check']
        client['notes'] = old.get('notes') or []  # заметки о клиенте ведёт карточка клиента (/api/clientcard/note)
        client['_rev'] = self.store.client_put(cid, client, author, base_rev)
        return client

    def lookup(self, inn) -> dict:
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой: проверьте количество цифр (10 или 12) и контрольную сумму'}
        keys = self.keys()
        errors = []
        sources: list[tuple[str, Callable[..., Any]]] = []
        if keys.get('dadataKey'):
            sources.append(('DaData', self._lookup_dadata))
        sources.append(('ФНС ЕГРЮЛ', self._lookup_egrul))
        for api in self.apis():  # Checko, затем OFData — их запросы берегутся для проверок
            if api.quota()['left'] > SrvVal.get(self.store, 'cp.reserve'):
                sources.append((api.NAME, lambda inn, keys, src_api=api: self._lookup_api(src_api, inn)))
        for name, func in sources:
            try:
                res = func(inn, keys)
                if res:
                    res['source'] = name
                    return res
                errors.append(name + ': организация не найдена')
            except Exception as exc:
                errors.append(f'{name}: {exc}')
        return {'error': 'Не удалось получить данные. ' + '; '.join(errors)}

    @staticmethod
    def _lookup_api(api, inn) -> dict | None:
        """Реквизиты по карточке Checko / OFData (формат одинаковый)."""
        j = api.get('entrepreneur' if len(inn) == 12 else 'company', inn)
        data = j.get('data') or {}
        if not data:
            return None
        if len(inn) == 12:
            fio = data.get('ФИО') or ''
            return {
                'inn': inn,
                'ogrn': data.get('ОГРНИП', ''),
                'kpp': '',
                'short': 'ИП ' + fio,
                'full': 'Индивидуальный предприниматель ' + fio,
                'address': dig(data, 'Регион', 'Наим', default=''),
                'director': fio,
                'directorPost': 'Индивидуальный предприниматель',
                'status': dig(data, 'Статус', 'Наим', default=''),
                'active': not dig(data, 'ДатаЛикв'),
                'regDate': data.get('ДатаРег', ''),
                'okved': Counterparties._okved(data),
            }
        boss = (data.get('Руковод') or [{}])[0] if isinstance(data.get('Руковод'), list) else {}
        return {
            'inn': inn,
            'kpp': data.get('КПП', ''),
            'ogrn': data.get('ОГРН', ''),
            'short': data.get('НаимСокр') or data.get('НаимПолн', ''),
            'full': data.get('НаимПолн', ''),
            'address': dig(data, 'ЮрАдрес', 'АдресРФ', default=''),
            'director': boss.get('ФИО', ''),
            'directorPost': boss.get('НаимДолжн', ''),
            'status': dig(data, 'Статус', 'Наим', default=''),
            'active': not data.get('ДатаЛикв'),
            'regDate': data.get('ДатаРег', ''),
            'okved': Counterparties._okved(data),
            'phones': dig(data, 'Контакты', 'Тел', default=[]) or [],
            'emails': dig(data, 'Контакты', 'Емэйл', default=[]) or [],
            'site': dig(data, 'Контакты', 'ВебСайт', default='') or '',
        }

    def _lookup_dadata(self, inn, keys) -> dict | None:
        j = http_json(
            'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party',
            data={'query': inn, 'count': 1},
            headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + keys['dadataKey']},
        )
        sugg = (j.get('suggestions') or [None])[0]
        if not sugg:
            return None
        data = sugg.get('data') or {}
        reg = dig(data, 'state', 'registration_date')
        return {
            'inn': inn,
            'kpp': data.get('kpp') or '',
            'ogrn': data.get('ogrn') or '',
            'short': dig(data, 'name', 'short_with_opf', default='') or sugg.get('value', ''),
            'full': dig(data, 'name', 'full_with_opf', default=''),
            'address': dig(data, 'address', 'unrestricted_value', default='')
            or dig(data, 'address', 'value', default=''),
            'director': dig(data, 'management', 'name', default=''),
            'directorPost': (dig(data, 'management', 'post', default='') or '').capitalize(),
            'status': {
                'ACTIVE': 'Действует',
                'LIQUIDATING': 'В процессе ликвидации',
                'LIQUIDATED': 'Ликвидирована',
                'BANKRUPT': 'Банкротство',
                'REORGANIZING': 'Реорганизация',
            }.get(dig(data, 'state', 'status', default=''), ''),
            'active': dig(data, 'state', 'status') == 'ACTIVE',
            'regDate': datetime.utcfromtimestamp(reg / 1000).strftime('%Y-%m-%d')
            if isinstance(reg, (int, float))
            else '',
            'okved': data.get('okved') or '',
            'invalid': bool(data.get('invalid')),
            'disq': bool(dig(data, 'management', 'disqualified')),
            'liqDate': dig(data, 'state', 'liquidation_date'),
        }

    def _lookup_egrul(self, inn, keys) -> dict | None:
        token_resp = http_json(
            'https://egrul.nalog.ru/',
            data={'query': inn, 'nameEq': 'on', 'region': '', 'PreventChromeAutocomplete': ''},
            headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://egrul.nalog.ru/index.html'},
        ).get('t')
        if not token_resp:
            return None
        rows = None
        for _ in range(8):
            res = http_json(
                f'https://egrul.nalog.ru/search-result/{token_resp}?r={int(time.time() * 1000)}',
                headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://egrul.nalog.ru/index.html'},
            )
            if res.get('status') == 'wait':
                time.sleep(0.8)
                continue
            rows = res.get('rows') or []
            break
        if not rows:
            return None
        row = rows[0]
        boss = row.get('g') or ''
        post, _, fio = boss.partition(':')
        full = row.get('n') or ''
        short = row.get('c') or full
        return {
            'inn': row.get('i') or inn,
            'kpp': row.get('p') or '',
            'ogrn': row.get('o') or '',
            'short': short,
            'full': full,
            'address': row.get('a') or '',
            'director': fio.strip().title() if fio else '',
            'directorPost': post.strip().capitalize() if fio else '',
            'status': 'Ликвидирована' if row.get('e') else 'Действует',
            'active': not row.get('e'),
            'regDate': self._ru2iso(row.get('r')),
            'okved': '',
        }

    @staticmethod
    def _okved(data) -> str:
        """«28.13 Производство насосов» — код и название основного ОКВЭД из карточки Checko / OFData."""
        return ' '.join(x for x in [dig(data, 'ОКВЭД', 'Код', default=''), dig(data, 'ОКВЭД', 'Наим', default='')] if x)

    @staticmethod
    def _ru2iso(text) -> str:
        match = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', text or '')
        return f'{match.group(3)}-{match.group(2)}-{match.group(1)}' if match else (text or '')

    def quota(self) -> dict:
        """Остаток Checko на сегодня (поля — как раньше) + резерв OFData, если задан его ключ."""
        quota = self.checko.quota()
        quota['queue'] = len(self.store.kv_get('checkQueue') or [])
        quota['cost'] = CHECK_COST
        if self.ofdata.key():
            quota['reserve'] = self.ofdata.quota()
        return quota

    def queue_add(self, inn, author: str = '') -> None:
        with self.store.lock:
            queue = [x for x in (self.store.kv_get('checkQueue') or []) if x.get('inn') != inn]
            queue.append({'inn': inn, 'at': datetime.now().isoformat(timespec='seconds'), 'by': author})
            self.store.kv_set('checkQueue', queue[-500:])

    def _spare(self, api) -> int:
        """Сколько запросов дня очередь оставляет для проверок «вручную»."""
        return min(SrvVal.get(self.store, 'cp.reserve'), api.limit() // 5)

    def run_queue(self, log=print) -> int:
        """Отложенные полные проверки, когда лимит обновился; последние cp.reserve запросов не трогаются."""
        queue = self.store.kv_get('checkQueue') or []
        if not queue or not self.apis():
            return 0
        done = 0
        for x in list(queue):
            if not any(api.quota()['left'] - CHECK_COST - 1 >= self._spare(api) for api in self.apis()):
                break
            try:
                res = self.check(x['inn'], force=True, queue=False, spare=True)
            except Exception as exc:
                log('Отложенная проверка {}: {}'.format(x['inn'], exc))
                break
            if res.get('partial') or res.get('error'):
                break  # лимит кончился посередине — продолжим, когда обновится
            with self.store.lock:
                self.store.kv_set(
                    'checkQueue', [y for y in (self.store.kv_get('checkQueue') or []) if y.get('inn') != x['inn']]
                )
            client = self.store.client_get('inn' + x['inn'])
            if client is not None:
                client['check'] = res
                self.store.client_put('inn' + x['inn'], client, 'Программа (очередь проверок)')
            done += 1
        return done

    @staticmethod
    def _age(doc) -> float:
        try:
            return (datetime.now() - datetime.fromisoformat(str((doc or {}).get('checkedAt')))).days
        except Exception:
            return 999

    def check(self, inn, force: bool = False, queue=True, author: str = '', spare=False) -> dict:
        """Проверка по ИНН. spare=True (очередь) — не трогать последние запросы дня и не делать краткую проверку."""
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой'}
        is_person = len(inn) == 12
        cached = self.store.check_get(inn)
        apis = self.apis()
        # краткую / бесплатную проверку заменяем полной, как только хватает запросов
        if (
            cached
            and not force
            and self._age(cached) < SrvVal.get(self.store, 'cp.ttlDays')
            and not (cached.get('partial') and any(api.quota()['left'] >= CHECK_COST for api in apis))
        ):
            cached['cached'] = True
            cached['quotaNow'] = self.quota()
            return cached
        # бухотчётность (у ИП её нет): из прежней полной проверки (годовая — не меняется неделями) или бесплатно из ГИР БО
        fin = None
        if not is_person:
            if (
                cached
                and not cached.get('partial')
                and cached.get('finances')
                and self._age(cached) < SrvVal.get(self.store, 'cp.finReuseDays')
            ):
                day = '.'.join(reversed(str(cached.get('checkedAt') or '')[:10].split('-')))
                fin = {
                    'finances': cached['finances'],
                    'src': f'из проверки от {day}',
                    'url': cached.get('finUrl') or '',
                }
            else:
                girbo = GirBo.finances(inn)
                if girbo is not None:
                    fin = {'finances': girbo['finances'], 'src': GirBo.NAME, 'url': girbo['url']}
        need = ['company', 'courts', 'fssp'] + (['finances'] if not is_person and fin is None else [])

        def parts(api) -> list:
            return [part for part in need if part != 'finances' or api.FINANCES]

        def floor(api) -> int:
            return self._spare(api) if spare else 0

        raw, meta, errors, limited, used, failed, short = {}, None, [], False, None, set(), False
        # 1) полная проверка — первым сервисом, у которого хватает запросов: Checko, затем резерв OFData
        for api in apis:
            if api.quota()['left'] - len(parts(api)) < floor(api):
                continue
            res1, meta1, errs, lim = api.fetch(inn, parts(api))
            errors += errs
            limited = limited or lim
            if res1.get('company'):
                raw, meta, used = res1, meta1, api
                break
            if not lim:
                failed.add(api.NAME)
        # 2) краткая — одна карточка (1 запрос), если на полную не хватило ни у одного сервиса
        if not used and not spare:
            for api in apis:
                if api.NAME in failed or api.quota()['left'] < 1:
                    continue
                res1, meta1, errs, lim = api.fetch(inn, ['company'])
                errors += errs
                limited = limited or lim
                if res1.get('company'):
                    raw, meta, used, short = res1, meta1, api, True
                    break
                if not lim:
                    failed.add(api.NAME)
        if not used:
            if not apis:
                res = self._free_check(
                    inn,
                    'Для полной проверки (суды, ФССП, налоги) укажите API-ключ Checko — или OFData (резерв) — '
                    'в «Настройки → Ключи API». Полную проверку можно посмотреть и в Rusprofile.',
                    fin,
                )
                res['nokey'] = True
                return self._finish(inn, res, self.quota(), keep_full=cached)
            out = [api.NAME for api in apis if api.NAME not in failed]  # не хватило запросов (или кончились по ходу)
            exhausted = bool(out)
            if exhausted and queue:
                self.queue_add(inn, author)
            note = ''
            if failed:
                note = 'Не ответили: {}. '.format('; '.join(err for err in errors if not re.search(r'[Лл]имит', err)))
            if exhausted:
                note += ('Лимит запросов {} на сегодня исчерпан. '.format(', '.join(out))) + (
                    'Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else ''
                )
            else:
                note += 'Показана бесплатная проверка по ФНС; полную можно посмотреть в Rusprofile.'
            res = self._free_check(inn, note, fin)
            res['queued'] = bool(exhausted and queue)
            res['errors'] = errors + res.get('errors', [])
            return self._finish(inn, res, self.quota(), keep_full=cached)
        # 3) недостающее (лимит кончился посередине, у сервиса нет бухотчётности) — у другого сервиса с запасом
        for api2 in apis:
            miss = [
                need_part
                for need_part in need
                if need_part != 'company' and need_part not in raw and (need_part != 'finances' or api2.FINANCES)
            ]
            if (api2 is used and not short) or api2.NAME in failed or not miss or api2.quota()['left'] < 1:
                continue
            if not short and api2.quota()['left'] - len(miss) < floor(api2):
                continue
            res1, meta1, errs, lim = api2.fetch(
                inn, miss[: max(0, api2.quota()['left'] - floor(api2))] if short else miss
            )
            errors += errs
            for k, v in res1.items():
                raw.setdefault(k, v)
                if api2 is not used:
                    raw.setdefault('_by', {})[k] = api2.NAME
        res = self._summarize(inn, raw, is_person, used.NAME, fin)
        res['quota'] = meta or {}
        res['errors'] = errors
        helpers = sorted(set((raw.get('_by') or {}).values()))
        if helpers:
            res['source'] = used.NAME + ' + ' + ', '.join(helpers)
        missing = [name for name in ('courts', 'fssp') if name not in raw]
        if not is_person and fin is None and 'finances' not in raw:
            tail = '' if any(api.FINANCES for api in apis) else ', а у OFData в бесплатном тарифе её нет'
            res['finNote'] = f'Бухотчётность не получена: ГИР БО ФНС не ответил{tail}.'
        if missing:
            res['partial'] = True
            res['missing'] = [
                {'courts': 'арбитражные суды', 'fssp': 'исполнительные производства'}[name] for name in missing
            ]
            res['note'] = (f'Краткая проверка: на сегодня осталось меньше {CHECK_COST} запросов. ') + (
                'Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else ''
            )
            if queue:
                self.queue_add(inn, author)
                res['queued'] = True
            res['links'] = manual_links(inn)
            prev = cached if cached and not cached.get('partial') else None
            fresh_fin = bool(res.get('finances'))
            if prev and self._age(prev) < SrvVal.get(
                self.store, 'cp.fullReuseDays'
            ):  # суды и ФССП — из недавней полной проверки (с датой), карточка — свежая
                for k in missing:
                    res[k] = prev.get(k)
                if not res.get('finances') and prev.get('finances'):
                    res['finances'] = prev['finances']
                have = {flag.get('text') for flag in res['flags']}
                pat = '|'.join(
                    [{'courts': 'Арбитраж', 'fssp': 'Исполнительн'}[k] for k in missing]
                    + ([] if fresh_fin else ['Убыток', 'Есть выручка'])
                )
                old = [
                    flag
                    for flag in (prev.get('flags') or [])
                    if re.match(pat, flag.get('text', '')) and flag.get('text') not in have
                ]
                day = '.'.join(reversed(prev['checkedAt'][:10].split('-')))
                res['flags'] = res['flags'] + [dict(flag, text=flag['text'] + f' (на {day})') for flag in old]
                res['score'] = self._score(res['flags'])
                res['missing'] = []
                what = ' и '.join({'courts': 'суды', 'fssp': 'ФССП'}[k] for k in missing)
                res['note'] = f'Карточка обновлена сегодня; {what} — из полной проверки от {day}. ' + (
                    'Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else ''
                )
        return self._finish(inn, res, self.quota())

    def _finish(self, inn, res, quota, keep_full=None) -> dict:
        res['checkedAt'] = datetime.now().isoformat(timespec='seconds')
        res['quotaNow'] = quota
        res['rusprofile'] = Rusprofile.url(inn)
        # прежнюю полную проверку не затираем краткой / бесплатной: она остаётся в кэше, пока не устарела
        if (
            res.get('partial')
            and keep_full
            and not keep_full.get('partial')
            and not res.get('nokey')
            and self._age(keep_full) < SrvVal.get(self.store, 'cp.fullReuseDays')
        ):
            keep_full['cached'] = True
            keep_full['quotaNow'] = quota
            keep_full['note'] = res.get('note') or ''
            keep_full['queued'] = res.get('queued')
            keep_full['rusprofile'] = Rusprofile.url(inn)
            return keep_full
        self.store.check_put(inn, res)
        return res

    @staticmethod
    def _score(flags, empty='ok') -> str:
        """Итог проверки по отметкам: красная — bad, жёлтая — warn, иначе empty."""
        levels = [flag['level'] for flag in flags]
        return 'bad' if 'red' in levels else ('warn' if 'yellow' in levels else empty)

    def _reg_age(self, reg, add) -> float | None:
        """Возраст организации, лет, по дате регистрации; дата не читается — None."""
        try:
            age = (date.today() - date.fromisoformat(str(reg or '')[:10])).days / 365.25
        except Exception:
            return None
        young = SrvVal.get(self.store, 'cp.youngYears')
        if age < young:
            add(
                'yellow',
                'Зарегистрирована менее года назад'
                if young == 1
                else f'Зарегистрирована менее {young} {"года" if young in (2, 3, 4) else "лет"} назад',
            )
        elif age >= 3:
            add('green', f'Работает более {int(age)} лет')
        return age

    @staticmethod
    def _money(v) -> str:
        """12345.6 → «12 346»."""
        return f'{v:,.0f}'.replace(',', ' ')

    @staticmethod
    def _fin_flags(fin, add) -> None:
        if fin and fin[0].get('profit') is not None and fin[0]['profit'] < 0:
            add('yellow', 'Убыток за {} год'.format(fin[0]['year']))
        if fin and fin[0].get('revenue') and fin[0]['revenue'] > 0:
            add('green', 'Есть выручка за {} год'.format(fin[0]['year']))

    def _free_check(self, inn, note, fin=None) -> dict:
        """Бесплатная проверка: DaData или ФНС ЕГРЮЛ, бухотчётность — ГИР БО, остальное — ссылками."""
        keys = self.keys()
        info, src, errs = None, '', []
        for name, func in ((('DaData', self._lookup_dadata),) if keys.get('dadataKey') else ()) + (
            ('ФНС ЕГРЮЛ', self._lookup_egrul),
        ):
            try:
                info = func(inn, keys)
                if info:
                    src = name
                    break
            except Exception as exc:
                errs.append(f'{name}: {exc}')
        flags = []

        def add(lvl, text) -> None:
            return flags.append({'level': lvl, 'text': text})

        age = None
        if info:
            if info.get('active'):
                add('green', 'Организация действует')
            else:
                add('red', 'Статус: ' + (info.get('status') or 'не действует'))
            age = self._reg_age(info.get('regDate'), add)
            if info.get('invalid'):
                add('red', 'Недостоверные сведения в ЕГРЮЛ (отметка ФНС)')
            if info.get('disq'):
                add('red', 'Руководитель — дисквалифицированное лицо')
        finances = list((fin or {}).get('finances') or [])
        self._fin_flags(finances, add)
        missing = [
            'арбитражные суды',
            'исполнительные производства',
            'налоговая недоимка',
            'банкротство',
            'массовый адрес и руководитель',
        ]
        if not finances and len(inn) == 10:
            missing.insert(2, 'финансовая отчётность')
        return {
            'inn': inn,
            'ogrn': (info or {}).get('ogrn', ''),
            'name': (info or {}).get('short', ''),
            'status': (info or {}).get('status', ''),
            'active': (info or {}).get('active'),
            'regDate': (info or {}).get('regDate', ''),
            'ageYears': round(age, 1) if age is not None else None,
            'okved': (info or {}).get('okved', ''),
            'flags': flags,
            'score': self._score(flags, 'ok' if info else 'warn'),
            'source': (src or 'нет данных')
            + (' + ' + GirBo.NAME if finances and (fin or {}).get('src') == GirBo.NAME else ''),
            'partial': True,
            'free': True,
            'missing': missing,
            'note': note,
            'errors': errs,
            'links': manual_links(inn),
            'url': CheckoApi.site(inn),
            'courts': {'count': None, 'sum': None},
            'fssp': {'count': None, 'sum': None},
            'finances': finances,
            'finSource': (fin or {}).get('src', '') if finances else '',
            'finUrl': (fin or {}).get('url', '') if finances else '',
        }

    def _summarize(self, inn, raw, is_person, src='Checko', fin_in=None) -> dict:
        company = raw.get('company') or {}
        flags = []

        def add(lvl, text) -> None:
            return flags.append({'level': lvl, 'text': text})

        status = dig(company, 'Статус', 'Наим', default='') or (
            'Ликвидирована' if company.get('ДатаЛикв') else 'Действует'
        )
        active = not company.get('ДатаЛикв') and not re.search(r'ликвид|прекращ|банкрот|исключ', status, re.I)
        if active:
            add('green', 'Организация действует')
        else:
            add('red', 'Статус: ' + status)
        reg = company.get('ДатаРег') or ''
        age = self._reg_age(reg, add)
        if company.get('НедобПост'):
            add('red', 'Состоит в реестре недобросовестных поставщиков')
        if company.get('ЕФРСБ'):
            add('red', 'Есть сообщения о банкротстве (ЕФРСБ)')
        if dig(company, 'ЮрАдрес', 'Недост'):
            add('red', 'Недостоверный юридический адрес (отметка ФНС)')
        if dig(company, 'ЮрАдрес', 'МассАдрес'):
            add('yellow', 'Массовый юридический адрес')
        bosses = picked if isinstance(picked := company.get('Руковод'), list) else []
        if any(boss.get('ДисквЛицо') for boss in bosses):
            add('red', 'Руководитель — дисквалифицированное лицо')
        if any(boss.get('МассРуковод') for boss in bosses):
            add('yellow', 'Массовый руководитель')
        if any(boss.get('Недост') for boss in bosses):
            add('red', 'Недостоверные сведения о руководителе')
        debt = _num(dig(company, 'Налоги', 'СумНедоим'))
        if debt:
            add('yellow', f'Налоговая недоимка: {self._money(debt)} руб.')
        # бухотчётность: последние 3 года — из ответа сервиса (суммы в рублях) или из ГИР БО / прежней проверки
        fin, fin_src, fin_url = [], '', ''
        fdata = picked if isinstance(picked := raw.get('finances'), dict) else {}
        for y in sorted([k for k in fdata if re.match(r'^\d{4}$', str(k))], reverse=True)[:3]:
            row = fdata.get(y) or {}
            fin.append(
                {
                    'year': y,
                    'revenue': _num(row.get('2110')),
                    'profit': _num(row.get('2400')),
                    'assets': _num(row.get('1600')),
                }
            )
        if fin:
            fin_src = (raw.get('_by') or {}).get('finances') or src
        elif fin_in and fin_in.get('finances'):
            fin, fin_src, fin_url = list(fin_in['finances']), fin_in.get('src', ''), fin_in.get('url', '')
        self._fin_flags(fin, add)
        courts = raw.get('courts')
        c_cnt = _num((courts or {}).get('ЗапВсего')) or 0
        c_sum = _num((courts or {}).get('ОбщСуммИск')) or 0
        if c_cnt:
            rev = fin[0]['revenue'] if fin and fin[0]['revenue'] else None
            add(
                'red' if (rev and c_sum > rev * SrvVal.get(self.store, 'cp.courtsPct') / 100) else 'yellow',
                f'Арбитражные дела в роли ответчика: {c_cnt} на {self._money(c_sum)} руб.',
            )
        fssp = raw.get('fssp')
        f_cnt = _num((fssp or {}).get('ЗапВсего')) or 0
        f_sum = _num((fssp or {}).get('ОбщСумДолг') or (fssp or {}).get('ОбщСум'))
        if f_sum is None:  # общей суммы нет — сумма по записям (остаток долга, иначе сумма долга)
            recs = picked if isinstance(picked := (fssp or {}).get('Записи'), list) else []
            vals = [
                _num(rec.get('ОстЗадолж') if rec.get('ОстЗадолж') is not None else rec.get('СумДолг'))
                for rec in recs
                if isinstance(rec, dict)
            ]
            f_sum = sum(v for v in vals if v) if len(recs) >= f_cnt else 0
        if f_cnt:
            add(
                'yellow',
                f'Исполнительные производства: {f_cnt}' + (f' на {self._money(f_sum)} руб.' if f_sum else ''),
            )
        score = self._score(flags)
        ogrn = company.get('ОГРН') or company.get('ОГРНИП') or ''
        return {
            'inn': inn,
            'ogrn': ogrn,
            'name': company.get('НаимСокр') or company.get('НаимПолн') or company.get('ФИО') or '',
            'status': status,
            'active': active,
            'regDate': reg,
            'ageYears': round(age, 1) if age is not None else None,
            'capital': _num(dig(company, 'УстКап', 'Сумма')),
            'employees': _num(company.get('СЧР')),
            'okved': self._okved(company),
            'msp': dig(company, 'РМСП', 'Кат', default=''),
            'taxDebt': debt,
            'finances': fin,
            'finSource': fin_src,
            'finUrl': fin_url,
            'courts': {'count': c_cnt, 'sum': c_sum} if courts is not None else {'count': None, 'sum': None},
            'fssp': {'count': f_cnt, 'sum': f_sum or 0} if fssp is not None else {'count': None, 'sum': None},
            'flags': flags,
            'score': score,
            'source': src,
            'url': CheckoApi.site(inn),
        }
