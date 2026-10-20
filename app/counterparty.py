"""Контрагенты: реквизиты по ИНН (DaData, ФНС), проверка (Checko, OFData, ГИР БО), справочник клиентов."""

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

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
    q = urllib.parse.quote(inn)
    return [
        {'name': 'Rusprofile', 'url': Rusprofile.url(inn)},
        {'name': 'Прозрачный бизнес (ФНС)', 'url': 'https://pb.nalog.ru/search.html#t=1&mode=search-all&queryAll=' + q},
        {'name': 'Бухотчётность (ГИР БО)', 'url': GirBo.search_url(inn)},
        {'name': 'Арбитражные дела', 'url': 'https://kad.arbitr.ru/'},
        {'name': 'Исполнительные производства (ФССП)', 'url': 'https://fssp.gov.ru/iss/ip/'},
        {'name': 'Банкротство (Федресурс)', 'url': 'https://fedresurs.ru/search/entity?code=' + q},
        {
            'name': 'Недобросовестные поставщики',
            'url': 'https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html?searchString=' + q,
        },
        {'name': 'Checko (сайт)', 'url': CheckoApi.site(inn)},
    ]


class LimitError(Exception):
    """Лимит запросов сервиса проверки на сегодня исчерпан."""


def http_json(url, data=None, headers=None, method=None) -> object:
    """Запрос к API → разобранный JSON. data: dict/list — JSON (если Content-Type: application/json) или форма; bytes — как есть."""
    h = {'User-Agent': 'Mozilla/5.0 (KP-Pnevmotekh)', 'Accept': 'application/json'}
    h.update(headers or {})
    body = None
    if data is not None:
        if isinstance(data, (dict, list)) and h.get('Content-Type', '').startswith('application/json'):
            body = json.dumps(data).encode('utf-8')
        elif isinstance(data, dict):
            body = urllib.parse.urlencode(data).encode('utf-8')
            h.setdefault('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
        else:
            body = data
    raw = Net.request(url, data=body, headers=h, method=method, timeout=TIMEOUT)  # предел ответа и повтор GET — Net
    return json.loads(raw.decode('utf-8-sig'))


def valid_inn(inn) -> bool:
    """Проверка ИНН по контрольным цифрам (10 — организация, 12 — ИП)."""
    s = re.sub(r'\D', '', str(inn or ''))

    def ctl(digits, coefs) -> int:
        return sum(int(d) * c for d, c in zip(digits, coefs, strict=False)) % 11 % 10

    if len(s) == 10:
        return ctl(s, [2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(s[9])
    if len(s) == 12:
        return ctl(s, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(s[10]) and ctl(
            s, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
        ) == int(s[11])
    return False


def g(d, *path, default=None) -> object:
    """Безопасное чтение вложенных полей: g(d, 'Статус', 'Наим')."""
    cur = d
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
    EP = {'finances': ('finances', {}), 'courts': ('legal-cases', {'role': 'defendant'}), 'fssp': ('enforcements', {})}
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
        q = self.store.kv_get(self.QUOTA) or {}
        today = msk_today()
        used = int(q.get('used') or 0) if q.get('day') == today else 0
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

    def spend(self, n=1, meta=None, exhausted=False) -> None:
        with self.store.lock:
            q = self.quota()
            used = q['used'] + n
            cnt = (meta or {}).get('today_request_count') if isinstance(meta, dict) else None
            if isinstance(cnt, int) and cnt >= 0:
                used = cnt  # сервис сам сообщает, сколько запросов сделано сегодня
            if exhausted:
                used = max(used, q['limit'])
            self.store.kv_set(self.QUOTA, {'day': q['day'], 'used': used})

    def get(self, ep, inn, **extra) -> dict:
        """Запрос с учётом лимита; лимит исчерпан — LimitError, другая ошибка — RuntimeError с понятным текстом."""
        if self.quota()['left'] <= 0:
            raise LimitError(f'Лимит запросов {self.NAME} на сегодня исчерпан')
        url = self.BASE + ep + '?' + urllib.parse.urlencode(dict({'key': self.key(), 'inn': inn}, **extra))
        try:
            j = http_json(url)
        except urllib.error.HTTPError as e:
            self.spend(1, exhausted=e.code in (402, 429))
            if e.code in (402, 429):
                raise LimitError(f'Лимит запросов {self.NAME} на сегодня исчерпан') from e
            raise RuntimeError(
                'ключ не принят — проверьте его в «Ключах API»'
                if e.code in (401, 403)
                else f'ошибка сервиса (HTTP {e.code})'
            ) from e
        except (urllib.error.URLError, OSError) as e:
            slow = isinstance(e, socket.timeout) or isinstance(getattr(e, 'reason', None), socket.timeout)
            raise RuntimeError(f'сервис не ответил за {TIMEOUT} с' if slow else 'нет связи с сервисом') from e
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
            ep, extra = (('entrepreneur' if len(inn) == 12 else 'company'), {}) if name == 'company' else self.EP[name]
            try:
                j = self.get(ep, inn, **extra)
            except LimitError as e:
                limited = True
                errors.append(str(e))
                break
            except Exception as e:
                errors.append(f'{self.NAME}, {self.PART.get(name, name)}: {e}')
                if name == 'company':
                    break  # без карточки остальное не нужно — дальше резерв или бесплатная проверка
                continue
            meta = j.get('meta') or meta
            if g(j, 'meta', 'status') == 'error':
                errors.append(
                    '{}, {}: {}'.format(self.NAME, self.PART.get(name, name), g(j, 'meta', 'message', default='ошибка'))
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
    UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
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
            except Exception as e:
                err = e
        raise RuntimeError(cls._why(err))

    @staticmethod
    def _why(e) -> str:
        """Причина сбоя для человека — без адресов и технических подробностей."""
        if isinstance(e, urllib.error.HTTPError):
            return f'сервис ответил ошибкой (HTTP {e.code})'
        if isinstance(e, (urllib.error.URLError, OSError)):
            slow = isinstance(getattr(e, 'reason', e), (socket.timeout, TimeoutError)) or 'timed out' in str(e)
            return f'сервис не ответил за {TIMEOUT} с' if slow else 'нет связи с сервисом'
        if isinstance(e, ValueError) and str(e).startswith(('поиск ГИР БО', 'отчётность ГИР БО')):
            return str(e)
        return 'ответ в неожиданном формате'

    @classmethod
    def _get(cls, host, path, params=None) -> object:
        return http_json(
            host + path + ('?' + urllib.parse.urlencode(params) if params else ''),
            headers={
                'User-Agent': cls.UA,
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
        for r in reports:
            year = str((r or {}).get('period') or '') if isinstance(r, dict) else ''
            if not re.match(r'^(19|20)\d\d$', year):
                continue
            c = cls._correction(r)
            fr, bal = c.get('financialResult') or {}, c.get('balance') or {}
            row = {
                'year': year,
                'revenue': cls._rub(fr.get('current2110'), r.get('gainSum')),
                'profit': cls._rub(fr.get('current2400')),
                'assets': cls._rub(bal.get('current1600'), r.get('actives')),
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
        cand = [c for c in cand if isinstance(c, dict)]
        if not cand:
            return {}
        return max(
            cand,
            key=lambda c: (
                _num(c.get('correctionVersion')) or 0,
                1 if c.get('lastCorrection') else 0,
                _num(c.get('id')) or 0,
            ),
        )

    @classmethod
    def _rub(cls, *vals) -> float | None:
        for v in vals:
            n = _num(v) if v is not None else None
            if n is not None:
                return n * cls.THOUSAND
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
        return [a for a in (self.checko, self.ofdata) if a.key()]

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
                    n = int(new.get(k) or 0)
                except (TypeError, ValueError):
                    raise ValueError('Лимит запросов в день — целое число от 1 до 100 000') from None
                if n > 0:
                    cur[k] = min(n, 100000)
                else:
                    cur.pop(k, None)
        self.store.kv_set('integrations', cur)
        return self.keys_public()

    @staticmethod
    def _check_id(cid) -> None:
        if not re.match(r'^[A-Za-z0-9_-]{1,64}$', cid or ''):
            raise ValueError('Некорректный идентификатор контрагента')

    def save_client(self, cid, body, by: str = '', base_rev=None) -> dict:
        c = json.loads(body.decode('utf-8'))
        self._check_id(cid)
        rev_in = c.pop('_rev', None)
        if base_rev is None:
            base_rev = rev_in
        if not isinstance(c, dict):
            raise ValueError('Ожидался объект клиента')
        old = self.store.client_get(cid) or {}
        replace = bool(
            c.pop('_replace', False)
        )  # из справочника «Настроек»: списки — как в карточке (удалённое удаляется)

        def dicts(v) -> list:
            return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []

        # из КП объекты и контакты накапливаются: повторы не дублируются, у того же контакта — новые телефон, e-mail
        def merge(a, b, key) -> list:
            res = [dict(x) for x in dicts(a)]
            at = {key(x): x for x in res}
            for x in dicts(b):
                k = key(x)
                if not k:
                    continue
                if k in at:
                    at[k].update({f: v for f, v in x.items() if str(v if v is not None else '').strip()})
                else:
                    res.insert(0, x)
                    at[k] = x
            return res[:30]

        def norm(s) -> str:
            return re.sub(r'\s+', ' ', str(s or '')).strip().lower()

        if replace:
            c['objects'], c['contacts'] = dicts(c.get('objects'))[:30], dicts(c.get('contacts'))[:30]
        else:
            c['objects'] = merge(
                old.get('objects'), c.get('objects'), lambda o: norm(o.get('purpose')) + '|' + norm(o.get('address'))
            )
            c['contacts'] = merge(old.get('contacts'), c.get('contacts'), lambda o: norm(o.get('name')))
        c['kpCount'] = int(old.get('kpCount', 0)) + (1 if c.pop('_usedInKp', False) else 0)
        c['id'] = cid
        c['createdAt'] = old.get('createdAt') or datetime.now().isoformat(timespec='seconds')
        c['updatedAt'] = datetime.now().isoformat(timespec='seconds')
        if not c.get('check') and old.get('check'):
            c['check'] = old['check']
        c['notes'] = old.get('notes') or []  # заметки о клиенте ведёт карточка клиента (/api/clientcard/note)
        c['_rev'] = self.store.client_put(cid, c, by, base_rev)
        return c

    def lookup(self, inn) -> dict:
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой: проверьте количество цифр (10 или 12) и контрольную сумму'}
        keys = self.keys()
        errors = []
        sources = []
        if keys.get('dadataKey'):
            sources.append(('DaData', self._lookup_dadata))
        sources.append(('ФНС ЕГРЮЛ', self._lookup_egrul))
        for a in self.apis():  # Checko, затем OFData — их запросы берегутся для проверок
            if a.quota()['left'] > SrvVal.get(self.store, 'cp.reserve'):
                sources.append((a.NAME, lambda inn, keys, a=a: self._lookup_api(a, inn)))
        for name, fn in sources:
            try:
                r = fn(inn, keys)
                if r:
                    r['source'] = name
                    return r
                errors.append(name + ': организация не найдена')
            except Exception as e:
                errors.append(f'{name}: {e}')
        return {'error': 'Не удалось получить данные. ' + '; '.join(errors)}

    @staticmethod
    def _lookup_api(api, inn) -> dict | None:
        """Реквизиты по карточке Checko / OFData (формат одинаковый)."""
        j = api.get('entrepreneur' if len(inn) == 12 else 'company', inn)
        d = j.get('data') or {}
        if not d:
            return None
        if len(inn) == 12:
            fio = d.get('ФИО') or ''
            return {
                'inn': inn,
                'ogrn': d.get('ОГРНИП', ''),
                'kpp': '',
                'short': 'ИП ' + fio,
                'full': 'Индивидуальный предприниматель ' + fio,
                'address': g(d, 'Регион', 'Наим', default=''),
                'director': fio,
                'directorPost': 'Индивидуальный предприниматель',
                'status': g(d, 'Статус', 'Наим', default=''),
                'active': not g(d, 'ДатаЛикв'),
                'regDate': d.get('ДатаРег', ''),
                'okved': Counterparties._okved(d),
            }
        boss = (d.get('Руковод') or [{}])[0] if isinstance(d.get('Руковод'), list) else {}
        return {
            'inn': inn,
            'kpp': d.get('КПП', ''),
            'ogrn': d.get('ОГРН', ''),
            'short': d.get('НаимСокр') or d.get('НаимПолн', ''),
            'full': d.get('НаимПолн', ''),
            'address': g(d, 'ЮрАдрес', 'АдресРФ', default=''),
            'director': boss.get('ФИО', ''),
            'directorPost': boss.get('НаимДолжн', ''),
            'status': g(d, 'Статус', 'Наим', default=''),
            'active': not d.get('ДатаЛикв'),
            'regDate': d.get('ДатаРег', ''),
            'okved': Counterparties._okved(d),
            'phones': g(d, 'Контакты', 'Тел', default=[]) or [],
            'emails': g(d, 'Контакты', 'Емэйл', default=[]) or [],
            'site': g(d, 'Контакты', 'ВебСайт', default='') or '',
        }

    def _lookup_dadata(self, inn, keys) -> dict | None:
        j = http_json(
            'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party',
            data={'query': inn, 'count': 1},
            headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + keys['dadataKey']},
        )
        s = (j.get('suggestions') or [None])[0]
        if not s:
            return None
        d = s.get('data') or {}
        reg = g(d, 'state', 'registration_date')
        return {
            'inn': inn,
            'kpp': d.get('kpp') or '',
            'ogrn': d.get('ogrn') or '',
            'short': g(d, 'name', 'short_with_opf', default='') or s.get('value', ''),
            'full': g(d, 'name', 'full_with_opf', default=''),
            'address': g(d, 'address', 'unrestricted_value', default='') or g(d, 'address', 'value', default=''),
            'director': g(d, 'management', 'name', default=''),
            'directorPost': (g(d, 'management', 'post', default='') or '').capitalize(),
            'status': {
                'ACTIVE': 'Действует',
                'LIQUIDATING': 'В процессе ликвидации',
                'LIQUIDATED': 'Ликвидирована',
                'BANKRUPT': 'Банкротство',
                'REORGANIZING': 'Реорганизация',
            }.get(g(d, 'state', 'status', default=''), ''),
            'active': g(d, 'state', 'status') == 'ACTIVE',
            'regDate': datetime.utcfromtimestamp(reg / 1000).strftime('%Y-%m-%d')
            if isinstance(reg, (int, float))
            else '',
            'okved': d.get('okved') or '',
            'invalid': bool(d.get('invalid')),
            'disq': bool(g(d, 'management', 'disqualified')),
            'liqDate': g(d, 'state', 'liquidation_date'),
        }

    def _lookup_egrul(self, inn, keys) -> dict | None:
        t = http_json(
            'https://egrul.nalog.ru/',
            data={'query': inn, 'nameEq': 'on', 'region': '', 'PreventChromeAutocomplete': ''},
            headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://egrul.nalog.ru/index.html'},
        ).get('t')
        if not t:
            return None
        rows = None
        for _ in range(8):
            res = http_json(
                f'https://egrul.nalog.ru/search-result/{t}?r={int(time.time() * 1000)}',
                headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://egrul.nalog.ru/index.html'},
            )
            if res.get('status') == 'wait':
                time.sleep(0.8)
                continue
            rows = res.get('rows') or []
            break
        if not rows:
            return None
        r = rows[0]
        boss = r.get('g') or ''
        post, _, fio = boss.partition(':')
        full = r.get('n') or ''
        short = r.get('c') or full
        return {
            'inn': r.get('i') or inn,
            'kpp': r.get('p') or '',
            'ogrn': r.get('o') or '',
            'short': short,
            'full': full,
            'address': r.get('a') or '',
            'director': fio.strip().title() if fio else '',
            'directorPost': post.strip().capitalize() if fio else '',
            'status': 'Ликвидирована' if r.get('e') else 'Действует',
            'active': not r.get('e'),
            'regDate': self._ru2iso(r.get('r')),
            'okved': '',
        }

    @staticmethod
    def _okved(d) -> str:
        """«28.13 Производство насосов» — код и название основного ОКВЭД из карточки Checko / OFData."""
        return ' '.join(x for x in [g(d, 'ОКВЭД', 'Код', default=''), g(d, 'ОКВЭД', 'Наим', default='')] if x)

    @staticmethod
    def _ru2iso(s) -> str:
        m = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', s or '')
        return f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else (s or '')

    def quota(self) -> dict:
        """Остаток Checko на сегодня (поля — как раньше) + резерв OFData, если задан его ключ."""
        q = self.checko.quota()
        q['queue'] = len(self.store.kv_get('checkQueue') or [])
        q['cost'] = CHECK_COST
        if self.ofdata.key():
            q['reserve'] = self.ofdata.quota()
        return q

    def queue_add(self, inn, by: str = '') -> None:
        with self.store.lock:
            qu = [x for x in (self.store.kv_get('checkQueue') or []) if x.get('inn') != inn]
            qu.append({'inn': inn, 'at': datetime.now().isoformat(timespec='seconds'), 'by': by})
            self.store.kv_set('checkQueue', qu[-500:])

    def _spare(self, api) -> int:
        """Сколько запросов дня очередь оставляет для проверок «вручную»."""
        return min(SrvVal.get(self.store, 'cp.reserve'), api.limit() // 5)

    def run_queue(self, log=print) -> int:
        """Отложенные полные проверки, когда лимит обновился; последние cp.reserve запросов не трогаются."""
        qu = self.store.kv_get('checkQueue') or []
        if not qu or not self.apis():
            return 0
        done = 0
        for x in list(qu):
            if not any(a.quota()['left'] - CHECK_COST - 1 >= self._spare(a) for a in self.apis()):
                break
            try:
                res = self.check(x['inn'], force=True, queue=False, spare=True)
            except Exception as e:
                log('Отложенная проверка {}: {}'.format(x['inn'], e))
                break
            if res.get('partial') or res.get('error'):
                break  # лимит кончился посередине — продолжим, когда обновится
            with self.store.lock:
                self.store.kv_set(
                    'checkQueue', [y for y in (self.store.kv_get('checkQueue') or []) if y.get('inn') != x['inn']]
                )
            cl = self.store.client_get('inn' + x['inn'])
            if cl is not None:
                cl['check'] = res
                self.store.client_put('inn' + x['inn'], cl, 'Программа (очередь проверок)')
            done += 1
        return done

    @staticmethod
    def _age(doc) -> float:
        try:
            return (datetime.now() - datetime.fromisoformat((doc or {}).get('checkedAt'))).days
        except Exception:
            return 999

    def check(self, inn, force: bool = False, queue=True, by: str = '', spare=False) -> dict:
        """Проверка по ИНН. spare=True (очередь) — не трогать последние запросы дня и не делать краткую проверку."""
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой'}
        ip = len(inn) == 12
        cached = self.store.check_get(inn)
        apis = self.apis()
        # краткую / бесплатную проверку заменяем полной, как только хватает запросов
        if (
            cached
            and not force
            and self._age(cached) < SrvVal.get(self.store, 'cp.ttlDays')
            and not (cached.get('partial') and any(a.quota()['left'] >= CHECK_COST for a in apis))
        ):
            cached['cached'] = True
            cached['quotaNow'] = self.quota()
            return cached
        # бухотчётность (у ИП её нет): из прежней полной проверки (годовая — не меняется неделями) или бесплатно из ГИР БО
        fin = None
        if not ip:
            if (
                cached
                and not cached.get('partial')
                and cached.get('finances')
                and self._age(cached) < SrvVal.get(self.store, 'cp.finReuseDays')
            ):
                dt = '.'.join(reversed(str(cached.get('checkedAt') or '')[:10].split('-')))
                fin = {
                    'finances': cached['finances'],
                    'src': f'из проверки от {dt}',
                    'url': cached.get('finUrl') or '',
                }
            else:
                gb = GirBo.finances(inn)
                if gb is not None:
                    fin = {'finances': gb['finances'], 'src': GirBo.NAME, 'url': gb['url']}
        need = ['company', 'courts', 'fssp'] + (['finances'] if not ip and fin is None else [])

        def parts(a) -> list:
            return [p for p in need if p != 'finances' or a.FINANCES]

        def floor(a) -> int:
            return self._spare(a) if spare else 0

        raw, meta, errors, limited, used, failed, short = {}, None, [], False, None, set(), False
        # 1) полная проверка — первым сервисом, у которого хватает запросов: Checko, затем резерв OFData
        for a in apis:
            if a.quota()['left'] - len(parts(a)) < floor(a):
                continue
            r, m, errs, lim = a.fetch(inn, parts(a))
            errors += errs
            limited = limited or lim
            if r.get('company'):
                raw, meta, used = r, m, a
                break
            if not lim:
                failed.add(a.NAME)
        # 2) краткая — одна карточка (1 запрос), если на полную не хватило ни у одного сервиса
        if not used and not spare:
            for a in apis:
                if a.NAME in failed or a.quota()['left'] < 1:
                    continue
                r, m, errs, lim = a.fetch(inn, ['company'])
                errors += errs
                limited = limited or lim
                if r.get('company'):
                    raw, meta, used, short = r, m, a, True
                    break
                if not lim:
                    failed.add(a.NAME)
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
            out = [a.NAME for a in apis if a.NAME not in failed]  # не хватило запросов (или кончились по ходу)
            exhausted = bool(out)
            if exhausted and queue:
                self.queue_add(inn, by)
            note = ''
            if failed:
                note = 'Не ответили: {}. '.format('; '.join(e for e in errors if not re.search(r'[Лл]имит', e)))
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
        for b in apis:
            miss = [p for p in need if p != 'company' and p not in raw and (p != 'finances' or b.FINANCES)]
            if (b is used and not short) or b.NAME in failed or not miss or b.quota()['left'] < 1:
                continue
            if not short and b.quota()['left'] - len(miss) < floor(b):
                continue
            r, m, errs, lim = b.fetch(inn, miss[: max(0, b.quota()['left'] - floor(b))] if short else miss)
            errors += errs
            for k, v in r.items():
                raw.setdefault(k, v)
                if b is not used:
                    raw.setdefault('_by', {})[k] = b.NAME
        res = self._summarize(inn, raw, ip, used.NAME, fin)
        res['quota'] = meta or {}
        res['errors'] = errors
        helpers = sorted(set((raw.get('_by') or {}).values()))
        if helpers:
            res['source'] = used.NAME + ' + ' + ', '.join(helpers)
        missing = [n for n in ('courts', 'fssp') if n not in raw]
        if not ip and fin is None and 'finances' not in raw:
            tail = '' if any(a.FINANCES for a in apis) else ', а у OFData в бесплатном тарифе её нет'
            res['finNote'] = f'Бухотчётность не получена: ГИР БО ФНС не ответил{tail}.'
        if missing:
            res['partial'] = True
            res['missing'] = [{'courts': 'арбитражные суды', 'fssp': 'исполнительные производства'}[n] for n in missing]
            res['note'] = (f'Краткая проверка: на сегодня осталось меньше {CHECK_COST} запросов. ') + (
                'Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else ''
            )
            if queue:
                self.queue_add(inn, by)
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
                have = {f.get('text') for f in res['flags']}
                pat = '|'.join(
                    [{'courts': 'Арбитраж', 'fssp': 'Исполнительн'}[k] for k in missing]
                    + ([] if fresh_fin else ['Убыток', 'Есть выручка'])
                )
                old = [
                    f
                    for f in (prev.get('flags') or [])
                    if re.match(pat, f.get('text', '')) and f.get('text') not in have
                ]
                dt = '.'.join(reversed(prev['checkedAt'][:10].split('-')))
                res['flags'] = res['flags'] + [dict(f, text=f['text'] + f' (на {dt})') for f in old]
                res['score'] = self._score(res['flags'])
                res['missing'] = []
                what = ' и '.join({'courts': 'суды', 'fssp': 'ФССП'}[k] for k in missing)
                res['note'] = f'Карточка обновлена сегодня; {what} — из полной проверки от {dt}. ' + (
                    'Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else ''
                )
        return self._finish(inn, res, self.quota())

    def _finish(self, inn, res, q, keep_full=None) -> dict:
        res['checkedAt'] = datetime.now().isoformat(timespec='seconds')
        res['quotaNow'] = q
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
            keep_full['quotaNow'] = q
            keep_full['note'] = res.get('note') or ''
            keep_full['queued'] = res.get('queued')
            keep_full['rusprofile'] = Rusprofile.url(inn)
            return keep_full
        self.store.check_put(inn, res)
        return res

    @staticmethod
    def _score(flags, empty='ok') -> str:
        """Итог проверки по отметкам: красная — bad, жёлтая — warn, иначе empty."""
        lv = [f['level'] for f in flags]
        return 'bad' if 'red' in lv else ('warn' if 'yellow' in lv else empty)

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
        for name, fn in ((('DaData', self._lookup_dadata),) if keys.get('dadataKey') else ()) + (
            ('ФНС ЕГРЮЛ', self._lookup_egrul),
        ):
            try:
                info = fn(inn, keys)
                if info:
                    src = name
                    break
            except Exception as e:
                errs.append(f'{name}: {e}')
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

    def _summarize(self, inn, raw, ip, src='Checko', fin_in=None) -> dict:
        c = raw.get('company') or {}
        flags = []

        def add(lvl, text) -> None:
            return flags.append({'level': lvl, 'text': text})

        status = g(c, 'Статус', 'Наим', default='') or ('Ликвидирована' if c.get('ДатаЛикв') else 'Действует')
        active = not c.get('ДатаЛикв') and not re.search(r'ликвид|прекращ|банкрот|исключ', status, re.I)
        if active:
            add('green', 'Организация действует')
        else:
            add('red', 'Статус: ' + status)
        reg = c.get('ДатаРег') or ''
        age = self._reg_age(reg, add)
        if c.get('НедобПост'):
            add('red', 'Состоит в реестре недобросовестных поставщиков')
        if c.get('ЕФРСБ'):
            add('red', 'Есть сообщения о банкротстве (ЕФРСБ)')
        if g(c, 'ЮрАдрес', 'Недост'):
            add('red', 'Недостоверный юридический адрес (отметка ФНС)')
        if g(c, 'ЮрАдрес', 'МассАдрес'):
            add('yellow', 'Массовый юридический адрес')
        bosses = c.get('Руковод') if isinstance(c.get('Руковод'), list) else []
        if any(b.get('ДисквЛицо') for b in bosses):
            add('red', 'Руководитель — дисквалифицированное лицо')
        if any(b.get('МассРуковод') for b in bosses):
            add('yellow', 'Массовый руководитель')
        if any(b.get('Недост') for b in bosses):
            add('red', 'Недостоверные сведения о руководителе')
        debt = _num(g(c, 'Налоги', 'СумНедоим'))
        if debt:
            add('yellow', f'Налоговая недоимка: {self._money(debt)} руб.')
        # бухотчётность: последние 3 года — из ответа сервиса (суммы в рублях) или из ГИР БО / прежней проверки
        fin, fin_src, fin_url = [], '', ''
        fdata = raw.get('finances') if isinstance(raw.get('finances'), dict) else {}
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
            recs = (fssp or {}).get('Записи') if isinstance((fssp or {}).get('Записи'), list) else []
            vals = [
                _num(r.get('ОстЗадолж') if r.get('ОстЗадолж') is not None else r.get('СумДолг'))
                for r in recs
                if isinstance(r, dict)
            ]
            f_sum = sum(v for v in vals if v) if len(recs) >= f_cnt else 0
        if f_cnt:
            add(
                'yellow',
                f'Исполнительные производства: {f_cnt}' + (f' на {self._money(f_sum)} руб.' if f_sum else ''),
            )
        score = self._score(flags)
        ogrn = c.get('ОГРН') or c.get('ОГРНИП') or ''
        return {
            'inn': inn,
            'ogrn': ogrn,
            'name': c.get('НаимСокр') or c.get('НаимПолн') or c.get('ФИО') or '',
            'status': status,
            'active': active,
            'regDate': reg,
            'ageYears': round(age, 1) if age is not None else None,
            'capital': _num(g(c, 'УстКап', 'Сумма')),
            'employees': _num(c.get('СЧР')),
            'okved': self._okved(c),
            'msp': g(c, 'РМСП', 'Кат', default=''),
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
