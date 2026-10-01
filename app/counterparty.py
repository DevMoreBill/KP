# -*- coding: utf-8 -*-
"""Контрагенты: поиск организации по ИНН, проверка через API Checko, справочник сохранённых контрагентов.

Источники данных по ИНН (по очереди, первый успешный):
  1. Checko (api.checko.ru)  — нужен API-ключ, даёт и реквизиты, и данные для проверки;
  2. DaData (dadata.ru)       — нужен бесплатный API-ключ;
  3. ФНС ЕГРЮЛ (egrul.nalog.ru) — без ключа, открытый сервис налоговой.
Ключи хранятся в базе программы (вводятся в программе: «Клиент» → «Интеграции»).
Только стандартная библиотека Python (совместимо с 3.8).
"""
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, date

TIMEOUT = 15
CHECK_TTL_DAYS = 7


def _http(url, data=None, headers=None, method=None):
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
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
    return json.loads(raw.decode('utf-8-sig'))


def valid_inn(inn):
    """Проверка ИНН по контрольным цифрам (10 — организация, 12 — ИП)."""
    s = re.sub(r'\D', '', str(inn or ''))
    def ctl(digits, coefs):
        return sum(int(d) * c for d, c in zip(digits, coefs)) % 11 % 10
    if len(s) == 10:
        return ctl(s, [2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(s[9])
    if len(s) == 12:
        return (ctl(s, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(s[10]) and
                ctl(s, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == int(s[11]))
    return False


def g(d, *path, default=None):
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


def _num(v):
    try:
        return float(str(v).replace(' ', '').replace(',', '.'))
    except Exception:
        return None


class Counterparties:
    def __init__(self, store):
        self.store = store          # SQLite (storage.Store): контрагенты, проверки, ключи API

    # ---------- ключи API ----------
    def keys(self):
        return self.store.kv_get('integrations', {}) or {}

    def keys_public(self):
        k = self.keys()
        mask = lambda v: (v[:4] + '…' + v[-4:]) if v and len(v) > 10 else ('задан' if v else '')
        return {'checko': bool(k.get('checkoKey')), 'checkoMask': mask(k.get('checkoKey', '')),
                'dadata': bool(k.get('dadataKey')), 'dadataMask': mask(k.get('dadataKey', '')),
                'convertapi': bool(k.get('convertapiKey')), 'convertapiMask': mask(k.get('convertapiKey', ''))}

    def save_keys(self, body):
        cur = self.keys()
        new = json.loads(body.decode('utf-8'))
        for k in ('checkoKey', 'dadataKey', 'convertapiKey'):
            if k in new:
                v = str(new[k] or '').strip()
                if v:
                    cur[k] = v
                else:
                    cur.pop(k, None)
        self.store.kv_set('integrations', cur)
        return self.keys_public()

    # ---------- справочник контрагентов ----------
    @staticmethod
    def _check_id(cid):
        if not re.match(r'^[A-Za-z0-9_-]{1,64}$', cid or ''):
            raise ValueError('Некорректный идентификатор контрагента')

    def list_clients(self):
        out = self.store.clients_all()
        out.sort(key=lambda c: c.get('usedAt') or c.get('updatedAt') or '', reverse=True)
        return out

    def save_client(self, cid, body):
        c = json.loads(body.decode('utf-8'))
        self._check_id(cid)
        old = self.store.client_get(cid) or {}
        # объекты и контакты накапливаются, повторы не дублируются
        def merge(a, b, key):
            res = list(a or [])
            seen = set(key(x) for x in res)
            for x in (b or []):
                k = key(x)
                if k and k not in seen:
                    res.insert(0, x)
                    seen.add(k)
            return res[:30]
        norm = lambda s: re.sub(r'\s+', ' ', str(s or '')).strip().lower()
        c['objects'] = merge(old.get('objects'), c.get('objects'), lambda o: norm(o.get('purpose')) + '|' + norm(o.get('address')))
        c['contacts'] = merge(old.get('contacts'), c.get('contacts'), lambda o: norm(o.get('name')))
        c['kpCount'] = int(old.get('kpCount', 0)) + (1 if c.pop('_usedInKp', False) else 0)
        c['id'] = cid
        c['createdAt'] = old.get('createdAt') or datetime.now().isoformat(timespec='seconds')
        c['updatedAt'] = datetime.now().isoformat(timespec='seconds')
        if not c.get('check') and old.get('check'):
            c['check'] = old['check']
        self.store.client_put(cid, c)
        return c

    def delete_client(self, cid):
        self._check_id(cid)
        self.store.client_delete(cid)

    # ---------- поиск по ИНН ----------
    def lookup(self, inn):
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой: проверьте количество цифр (10 или 12) и контрольную сумму'}
        keys = self.keys()
        errors = []
        sources = []
        if keys.get('checkoKey'):
            sources.append(('Checko', self._lookup_checko))
        if keys.get('dadataKey'):
            sources.append(('DaData', self._lookup_dadata))
        sources.append(('ФНС ЕГРЮЛ', self._lookup_egrul))
        for name, fn in sources:
            try:
                r = fn(inn, keys)
                if r:
                    r['source'] = name
                    return r
                errors.append(name + ': организация не найдена')
            except Exception as e:
                errors.append('%s: %s' % (name, e))
        return {'error': 'Не удалось получить данные. ' + '; '.join(errors)}

    def _lookup_checko(self, inn, keys):
        j = _http('https://api.checko.ru/v2/%s?%s' % ('entrepreneur' if len(inn) == 12 else 'company',
                  urllib.parse.urlencode({'key': keys['checkoKey'], 'inn': inn})))
        d = j.get('data') or {}
        if not d:
            return None
        if len(inn) == 12:
            fio = d.get('ФИО') or ''
            return {'inn': inn, 'ogrn': d.get('ОГРНИП', ''), 'kpp': '', 'short': 'ИП ' + fio, 'full': 'Индивидуальный предприниматель ' + fio,
                    'address': g(d, 'Регион', 'Наим', default=''), 'director': fio, 'directorPost': 'Индивидуальный предприниматель',
                    'status': g(d, 'Статус', 'Наим', default=''), 'active': not g(d, 'ДатаЛикв'), 'regDate': d.get('ДатаРег', ''),
                    'okved': ' '.join(x for x in [g(d, 'ОКВЭД', 'Код', default=''), g(d, 'ОКВЭД', 'Наим', default='')] if x)}
        boss = (d.get('Руковод') or [{}])[0] if isinstance(d.get('Руковод'), list) else {}
        return {'inn': inn, 'kpp': d.get('КПП', ''), 'ogrn': d.get('ОГРН', ''), 'short': d.get('НаимСокр') or d.get('НаимПолн', ''),
                'full': d.get('НаимПолн', ''), 'address': g(d, 'ЮрАдрес', 'АдресРФ', default=''),
                'director': boss.get('ФИО', ''), 'directorPost': boss.get('НаимДолжн', ''),
                'status': g(d, 'Статус', 'Наим', default=''), 'active': not d.get('ДатаЛикв'), 'regDate': d.get('ДатаРег', ''),
                'okved': ' '.join(x for x in [g(d, 'ОКВЭД', 'Код', default=''), g(d, 'ОКВЭД', 'Наим', default='')] if x),
                'phones': g(d, 'Контакты', 'Тел', default=[]) or [], 'emails': g(d, 'Контакты', 'Емэйл', default=[]) or [],
                'site': g(d, 'Контакты', 'ВебСайт', default='') or ''}

    def _lookup_dadata(self, inn, keys):
        j = _http('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', data={'query': inn, 'count': 1},
                  headers={'Content-Type': 'application/json', 'Authorization': 'Token ' + keys['dadataKey']})
        s = (j.get('suggestions') or [None])[0]
        if not s:
            return None
        d = s.get('data') or {}
        reg = g(d, 'state', 'registration_date')
        return {'inn': inn, 'kpp': d.get('kpp') or '', 'ogrn': d.get('ogrn') or '',
                'short': g(d, 'name', 'short_with_opf', default='') or s.get('value', ''), 'full': g(d, 'name', 'full_with_opf', default=''),
                'address': g(d, 'address', 'unrestricted_value', default='') or g(d, 'address', 'value', default=''),
                'director': g(d, 'management', 'name', default=''), 'directorPost': (g(d, 'management', 'post', default='') or '').capitalize(),
                'status': {'ACTIVE': 'Действует', 'LIQUIDATING': 'В процессе ликвидации', 'LIQUIDATED': 'Ликвидирована',
                           'BANKRUPT': 'Банкротство', 'REORGANIZING': 'Реорганизация'}.get(g(d, 'state', 'status', default=''), ''),
                'active': g(d, 'state', 'status') == 'ACTIVE',
                'regDate': datetime.utcfromtimestamp(reg / 1000).strftime('%Y-%m-%d') if isinstance(reg, (int, float)) else '',
                'okved': d.get('okved') or ''}

    def _lookup_egrul(self, inn, keys):
        t = _http('https://egrul.nalog.ru/', data={'query': inn, 'nameEq': 'on', 'region': '', 'PreventChromeAutocomplete': ''},
                  headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://egrul.nalog.ru/index.html'}).get('t')
        if not t:
            return None
        rows = None
        for _ in range(8):
            res = _http('https://egrul.nalog.ru/search-result/%s?r=%d' % (t, int(time.time() * 1000)),
                        headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://egrul.nalog.ru/index.html'})
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
        return {'inn': r.get('i') or inn, 'kpp': r.get('p') or '', 'ogrn': r.get('o') or '', 'short': short, 'full': full,
                'address': r.get('a') or '', 'director': fio.strip().title() if fio else '', 'directorPost': post.strip().capitalize() if fio else '',
                'status': 'Ликвидирована' if r.get('e') else 'Действует', 'active': not r.get('e'),
                'regDate': self._ru2iso(r.get('r')), 'okved': ''}

    @staticmethod
    def _ru2iso(s):
        m = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', s or '')
        return '%s-%s-%s' % (m.group(3), m.group(2), m.group(1)) if m else (s or '')

    # ---------- проверка контрагента (Checko) ----------
    def check(self, inn, force=False):
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой'}
        cached = self.store.check_get(inn)
        if cached and not force:
            try:
                age = (datetime.now() - datetime.fromisoformat(cached.get('checkedAt'))).days
            except Exception:
                age = 999
            if age < CHECK_TTL_DAYS:
                cached['cached'] = True
                return cached
        key = self.keys().get('checkoKey')
        if not key:
            return {'error': 'nokey', 'message': 'Для проверки нужен API-ключ Checko: «Интеграции» → ключ Checko. '
                                                 'Получить ключ: checko.ru → Личный кабинет → API.',
                    'url': 'https://checko.ru/search?query=' + inn}
        q = lambda ep, **extra: 'https://api.checko.ru/v2/%s?%s' % (ep, urllib.parse.urlencode(dict({'key': key, 'inn': inn}, **extra)))
        ip = len(inn) == 12
        raw = {}
        errors = []
        for name, url in (('company', q('entrepreneur' if ip else 'company')), ('finances', q('finances')),
                          ('courts', q('legal-cases', role='defendant')), ('fssp', q('enforcements'))):
            if ip and name == 'finances':
                continue
            try:
                j = _http(url)
                if g(j, 'meta', 'status') == 'error':
                    errors.append('%s: %s' % (name, g(j, 'meta', 'message', default='ошибка')))
                raw[name] = j.get('data') or {}
                raw['_meta'] = j.get('meta') or raw.get('_meta')
            except Exception as e:
                errors.append('%s: %s' % (name, e))
        if not raw.get('company'):
            return {'error': 'Checko не вернул данные. ' + '; '.join(errors)}
        res = self._summarize(inn, raw, ip)
        res['errors'] = errors
        res['checkedAt'] = datetime.now().isoformat(timespec='seconds')
        self.store.check_put(inn, res)
        return res

    def _summarize(self, inn, raw, ip):
        c = raw.get('company') or {}
        flags = []
        add = lambda lvl, text: flags.append({'level': lvl, 'text': text})
        status = g(c, 'Статус', 'Наим', default='') or ('Ликвидирована' if c.get('ДатаЛикв') else 'Действует')
        active = not c.get('ДатаЛикв') and not re.search(r'ликвид|прекращ|банкрот|исключ', status, re.I)
        (add('green', 'Организация действует') if active else add('red', 'Статус: ' + status))
        reg = c.get('ДатаРег') or ''
        age = None
        try:
            age = (date.today() - date.fromisoformat(reg[:10])).days / 365.25
            if age < 1:
                add('yellow', 'Зарегистрирована менее года назад')
            elif age >= 3:
                add('green', 'Работает более %d лет' % int(age))
        except Exception:
            pass
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
            add('yellow', 'Налоговая недоимка: %s руб.' % '{:,.0f}'.format(debt).replace(',', ' '))
        # финансы: последние 3 года
        fin = []
        fdata = raw.get('finances') or {}
        for y in sorted([k for k in fdata.keys() if re.match(r'^\d{4}$', str(k))], reverse=True)[:3]:
            row = fdata.get(y) or {}
            fin.append({'year': y, 'revenue': _num(row.get('2110')), 'profit': _num(row.get('2400')),
                        'assets': _num(row.get('1600'))})
        if fin and fin[0]['profit'] is not None and fin[0]['profit'] < 0:
            add('yellow', 'Убыток за %s год' % fin[0]['year'])
        if fin and fin[0]['revenue'] and fin[0]['revenue'] > 0:
            add('green', 'Есть выручка за %s год' % fin[0]['year'])
        courts = raw.get('courts') or {}
        c_cnt = _num(courts.get('ЗапВсего')) or 0
        c_sum = _num(courts.get('ОбщСуммИск')) or 0
        if c_cnt:
            rev = fin[0]['revenue'] if fin and fin[0]['revenue'] else None
            add('red' if (rev and c_sum > rev * 0.1) else 'yellow',
                'Арбитражные дела в роли ответчика: %d на %s руб.' % (c_cnt, '{:,.0f}'.format(c_sum).replace(',', ' ')))
        fssp = raw.get('fssp') or {}
        f_cnt = _num(fssp.get('ЗапВсего')) or 0
        f_sum = _num(fssp.get('ОбщСумДолг') or fssp.get('ОбщСум')) or 0
        if f_cnt:
            add('yellow', 'Исполнительные производства: %d%s' % (f_cnt, (' на %s руб.' % '{:,.0f}'.format(f_sum).replace(',', ' ')) if f_sum else ''))
        levels = [f['level'] for f in flags]
        score = 'bad' if 'red' in levels else ('warn' if 'yellow' in levels else 'ok')
        ogrn = c.get('ОГРН') or c.get('ОГРНИП') or ''
        return {'inn': inn, 'ogrn': ogrn, 'name': c.get('НаимСокр') or c.get('НаимПолн') or c.get('ФИО') or '',
                'status': status, 'active': active, 'regDate': reg, 'ageYears': round(age, 1) if age is not None else None,
                'capital': _num(g(c, 'УстКап', 'Сумма')), 'employees': _num(c.get('СЧР')),
                'okved': ' '.join(x for x in [g(c, 'ОКВЭД', 'Код', default=''), g(c, 'ОКВЭД', 'Наим', default='')] if x),
                'msp': g(c, 'РМСП', 'Кат', default=''), 'taxDebt': debt, 'finances': fin,
                'courts': {'count': c_cnt, 'sum': c_sum}, 'fssp': {'count': f_cnt, 'sum': f_sum},
                'flags': flags, 'score': score, 'source': 'Checko',
                'url': 'https://checko.ru/search?query=' + inn,
                'quota': raw.get('_meta') or {}}
