# -*- coding: utf-8 -*-
"""Контрагенты: поиск организации по ИНН, проверка через API Checko, справочник сохранённых контрагентов.

Источники реквизитов по ИНН (по очереди, первый успешный):
  1. DaData (dadata.ru)       — нужен бесплатный API-ключ (10 000 запросов в день);
  2. ФНС ЕГРЮЛ (egrul.nalog.ru) — без ключа, открытый сервис налоговой;
  3. Checko (api.checko.ru)  — только если первые не ответили: его запросы берегутся для проверок.

Проверка контрагента — Checko: бесплатно 100 запросов в календарный день (по Москве), полная проверка — 4 запроса
(карточка, финансы, суды, ФССП). Программа ведёт учёт запросов на весь отдел и, когда их не хватает:
  — осталось 1–3 запроса: краткая проверка по карточке Checko (статус, банкротство, недостоверность, массовость,
    дисквалификация, недоимка, реестр недобросовестных поставщиков) — 1 запрос;
  — лимит исчерпан: бесплатная проверка по ФНС ЕГРЮЛ / DaData (статус, ликвидация, возраст, недостоверность)
    и ссылки на официальные сервисы (суды, ФССП, «Прозрачный бизнес», Федресурс);
  в обоих случаях полная проверка ставится в очередь и выполняется сама после обновления лимита (run_queue).
Ключи хранятся в базе программы (вводятся в программе: «Клиент» → «Интеграции»).
Только стандартная библиотека Python (совместимо с 3.8).
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, date, timedelta, timezone

TIMEOUT = 15
CHECK_TTL_DAYS = 7
CHECKO_DAILY = 100       # бесплатный лимит Checko, запросов в календарный день (меняется в «Интеграциях»)
CHECKO_RESERVE = 20      # очередь не тратит последние запросы дня — они остаются для проверок «вручную»
FIN_REUSE_DAYS = 120     # бухотчётность годовая: при повторной проверке берём из прежней (экономия запроса)
MSK = timezone(timedelta(hours=3))


def msk_today():
    return datetime.now(MSK).date().isoformat()


def manual_links(inn):
    """Бесплатные официальные сервисы — проверить вручную то, что не вошло в проверку."""
    q = urllib.parse.quote(inn)
    return [{'name': 'Прозрачный бизнес (ФНС)', 'url': 'https://pb.nalog.ru/search.html#t=1&mode=search-all&queryAll=' + q},
            {'name': 'Арбитражные дела', 'url': 'https://kad.arbitr.ru/'},
            {'name': 'Исполнительные производства (ФССП)', 'url': 'https://fssp.gov.ru/iss/ip/'},
            {'name': 'Банкротство (Федресурс)', 'url': 'https://fedresurs.ru/search/entity?code=' + q},
            {'name': 'Недобросовестные поставщики', 'url': 'https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html?searchString=' + q},
            {'name': 'Checko (сайт)', 'url': 'https://checko.ru/search?query=' + q}]


class LimitError(Exception):
    """Лимит запросов Checko на сегодня исчерпан."""


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
                'convertapi': bool(k.get('convertapiKey')), 'convertapiMask': mask(k.get('convertapiKey', '')),
                'checkoDaily': self._limit(), 'quota': self.quota(),
                'ati': bool(k.get('atiToken')), 'atiMask': mask(k.get('atiToken', '')), 'dellin': bool(k.get('dellinKey')),
                'dellinMask': mask(k.get('dellinKey', '')), 'kit': bool(k.get('kitToken')), 'kitMask': mask(k.get('kitToken', '')),
                'cdek': bool(k.get('cdekId') and k.get('cdekSecret')), 'cdekIdMask': mask(k.get('cdekId', '')),
                'cdekSecretMask': mask(k.get('cdekSecret', '')), 'vozovoz': bool(k.get('vozovozToken')),
                'vozovozMask': mask(k.get('vozovozToken', ''))}

    def save_keys(self, body):
        cur = self.keys()
        new = json.loads(body.decode('utf-8'))
        for k in ('checkoKey', 'dadataKey', 'convertapiKey', 'atiToken', 'dellinKey', 'kitToken', 'cdekId', 'cdekSecret', 'vozovozToken'):
            if k in new:
                v = str(new[k] or '').strip()
                if v:
                    cur[k] = v
                else:
                    cur.pop(k, None)
        if 'checkoDaily' in new:        # бесплатный лимит Checko в день (по тарифу)
            try:
                n = int(new.get('checkoDaily') or 0)
            except (TypeError, ValueError):
                n = 0
            if n > 0:
                cur['checkoDaily'] = min(n, 100000)
            else:
                cur.pop('checkoDaily', None)
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

    def save_client(self, cid, body, by='', base_rev=None):
        c = json.loads(body.decode('utf-8'))
        self._check_id(cid)
        rev_in = c.pop('_rev', None)
        if base_rev is None:
            base_rev = rev_in
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
        c['_rev'] = self.store.client_put(cid, c, by, base_rev)
        return c

    # ---------- поиск по ИНН ----------
    def lookup(self, inn):
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой: проверьте количество цифр (10 или 12) и контрольную сумму'}
        keys = self.keys()
        errors = []
        sources = []
        if keys.get('dadataKey'):
            sources.append(('DaData', self._lookup_dadata))
        sources.append(('ФНС ЕГРЮЛ', self._lookup_egrul))
        if keys.get('checkoKey') and self.quota()['left'] > CHECKO_RESERVE:   # запросы Checko берегутся для проверок
            sources.append(('Checko', self._lookup_checko))
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
        j = self._checko('https://api.checko.ru/v2/%s?%s' % ('entrepreneur' if len(inn) == 12 else 'company',
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
                'okved': d.get('okved') or '', 'invalid': bool(d.get('invalid')),
                'disq': bool(g(d, 'management', 'disqualified')), 'liqDate': g(d, 'state', 'liquidation_date')}

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

    # ---------- учёт запросов Checko (на весь отдел, по московскому календарному дню) ----------
    def _limit(self):
        try:
            return max(1, int(self.keys().get('checkoDaily') or CHECKO_DAILY))
        except (TypeError, ValueError):
            return CHECKO_DAILY

    def quota(self):
        q = self.store.kv_get('checkoQuota') or {}
        today = msk_today()
        used = int(q.get('used') or 0) if q.get('day') == today else 0
        limit = self._limit()
        left = max(0, limit - used)
        queue = self.store.kv_get('checkQueue') or []
        return {'day': today, 'used': used, 'limit': limit, 'left': left, 'checks': left // 4, 'queue': len(queue),
                'key': bool(self.keys().get('checkoKey'))}

    def _spend(self, n=1, meta=None, exhausted=False):
        with self.store.lock:
            q = self.quota()
            used = q['used'] + n
            cnt = (meta or {}).get('today_request_count') if isinstance(meta, dict) else None
            if isinstance(cnt, int) and cnt >= 0:
                used = cnt                     # Checko сам сообщает, сколько запросов сделано сегодня
            if exhausted:
                used = max(used, q['limit'])
            self.store.kv_set('checkoQuota', {'day': q['day'], 'used': used})

    def _checko(self, url):
        """Запрос к Checko с учётом лимита; исчерпан — LimitError."""
        if self.quota()['left'] <= 0:
            raise LimitError('Лимит запросов Checko на сегодня исчерпан')
        try:
            j = _http(url)
        except urllib.error.HTTPError as e:
            self._spend(1, exhausted=e.code in (402, 429))
            if e.code in (402, 429):
                raise LimitError('Лимит запросов Checko на сегодня исчерпан')
            raise
        meta = j.get('meta') or {}
        lim = meta.get('status') == 'error' and re.search(r'лимит|limit|исчерпан|превыш|баланс|balance', str(meta.get('message') or ''), re.I)
        self._spend(1, meta, exhausted=bool(lim))
        if lim:
            raise LimitError(str(meta.get('message') or 'Лимит запросов Checko на сегодня исчерпан'))
        return j

    def queue_add(self, inn, by=''):
        with self.store.lock:
            qu = [x for x in (self.store.kv_get('checkQueue') or []) if x.get('inn') != inn]
            qu.append({'inn': inn, 'at': datetime.now().isoformat(timespec='seconds'), 'by': by})
            self.store.kv_set('checkQueue', qu[-500:])

    def run_queue(self, log=print):
        """Отложенные полные проверки — когда лимит Checko обновился; последние CHECKO_RESERVE запросов не трогаем.
        Результат — в кэш проверок и в карточку клиента (при следующем открытии КП видна полная проверка)."""
        qu = self.store.kv_get('checkQueue') or []
        if not qu or not self.keys().get('checkoKey'):
            return 0
        done = 0
        for x in list(qu):
            q = self.quota()
            if q['left'] - (3 if len(x['inn']) == 12 else 4) < min(CHECKO_RESERVE, q['limit'] // 5):
                break
            try:
                res = self.check(x['inn'], force=True, queue=False)
            except Exception as e:
                log('Отложенная проверка %s: %s' % (x['inn'], e))
                break
            if res.get('partial') or res.get('error'):
                break                     # лимит кончился посередине — продолжим, когда обновится
            with self.store.lock:
                self.store.kv_set('checkQueue', [y for y in (self.store.kv_get('checkQueue') or []) if y.get('inn') != x['inn']])
            cl = self.store.client_get('inn' + x['inn'])
            if cl is not None:
                cl['check'] = res
                self.store.client_put('inn' + x['inn'], cl, 'Программа (очередь проверок)')
            done += 1
        return done

    # ---------- проверка контрагента ----------
    def check(self, inn, force=False, queue=True, by=''):
        inn = re.sub(r'\D', '', inn or '')
        if not valid_inn(inn):
            return {'error': 'ИНН указан с ошибкой'}
        ip = len(inn) == 12
        cost = 3 if ip else 4
        cached = self.store.check_get(inn)
        q = self.quota()
        if cached and not force:
            try:
                age = (datetime.now() - datetime.fromisoformat(cached.get('checkedAt'))).days
            except Exception:
                age = 999
            # краткую / бесплатную проверку заменяем полной, как только хватает запросов
            if age < CHECK_TTL_DAYS and not (cached.get('partial') and q['key'] and q['left'] >= cost):
                cached['cached'] = True
                cached['quotaNow'] = q
                return cached
        key = self.keys().get('checkoKey')
        if not key:
            res = self._free_check(inn, 'Для полной проверки (суды, ФССП, финансы, налоги) укажите API-ключ Checko в «Интеграциях».')
            res['nokey'] = True
            return self._finish(inn, res, q, keep_full=cached)
        reuse = None   # финансы — из прежней полной проверки (годовая отчётность не меняется неделями)
        if cached and not cached.get('partial') and cached.get('finances'):
            try:
                if (datetime.now() - datetime.fromisoformat(cached.get('checkedAt'))).days < FIN_REUSE_DAYS:
                    reuse = cached
            except Exception:
                pass
        if reuse:
            cost -= 1
        if q['left'] < 1:
            if queue:
                self.queue_add(inn, by)
            res = self._free_check(inn, 'Лимит Checko на сегодня исчерпан (%d запросов в день). Полная проверка выполнится автоматически '
                                        'после 00:00 по Москве.' % q['limit'] if queue else '')
            res['queued'] = bool(queue)
            return self._finish(inn, res, q, keep_full=cached)
        short = q['left'] < cost
        qurl = lambda ep, **extra: 'https://api.checko.ru/v2/%s?%s' % (ep, urllib.parse.urlencode(dict({'key': key, 'inn': inn}, **extra)))
        plan = [('company', qurl('entrepreneur' if ip else 'company'))]
        if not short:
            if not ip and not reuse:
                plan.append(('finances', qurl('finances')))
            plan += [('courts', qurl('legal-cases', role='defendant')), ('fssp', qurl('enforcements'))]
        raw, errors, limited = {}, [], False
        for name, url in plan:
            try:
                j = self._checko(url)
                if g(j, 'meta', 'status') == 'error':
                    errors.append('%s: %s' % (name, g(j, 'meta', 'message', default='ошибка')))
                raw[name] = j.get('data') or {}
                raw['_meta'] = j.get('meta') or raw.get('_meta')
            except LimitError as e:
                limited = True
                errors.append(str(e))
                break
            except Exception as e:
                errors.append('%s: %s' % (name, e))
        if not raw.get('company'):
            if limited:     # лимит кончился раньше, чем показывал наш учёт (запросы с другого компьютера / сайта)
                if queue:
                    self.queue_add(inn, by)
                res = self._free_check(inn, 'Лимит Checko на сегодня исчерпан. Полная проверка выполнится автоматически после 00:00 по Москве.'
                                       if queue else '')
                res['queued'] = bool(queue)
                return self._finish(inn, res, self.quota(), keep_full=cached)
            return {'error': 'Checko не вернул данные. ' + '; '.join(errors), 'url': 'https://checko.ru/search?query=' + inn}
        if reuse:
            raw['finances_reused'] = reuse.get('finances')
        res = self._summarize(inn, raw, ip)
        res['errors'] = errors
        missing = [n for n, _ in (('finances', 0), ('courts', 0), ('fssp', 0)) if n not in raw and not (n == 'finances' and (ip or reuse))]
        if missing:
            res['partial'] = True
            res['missing'] = [{'finances': 'финансовая отчётность', 'courts': 'арбитражные суды', 'fssp': 'исполнительные производства'}[n] for n in missing]
            res['note'] = ('Краткая проверка: на сегодня осталось меньше %d запросов Checko. ' % cost) + \
                ('Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else '')
            if queue:
                self.queue_add(inn, by)
                res['queued'] = True
            res['links'] = manual_links(inn)
            prev = cached if cached and not cached.get('partial') else None
            try:
                fresh = prev and (datetime.now() - datetime.fromisoformat(prev.get('checkedAt'))).days < 30
            except Exception:
                fresh = False
            if fresh:     # суды, ФССП, финансы — из недавней полной проверки (с датой), карточка — свежая
                for k in ('courts', 'fssp', 'finances'):
                    res[k] = prev.get(k)
                have = {f.get('text') for f in res['flags']}
                old = [f for f in (prev.get('flags') or []) if re.match(r'Арбитраж|Исполнительн|Убыток|Есть выручка', f.get('text', ''))
                       and f.get('text') not in have]
                dt = '.'.join(reversed(prev['checkedAt'][:10].split('-')))
                res['flags'] = res['flags'] + [dict(f, text=f['text'] + ' (на %s)' % dt) for f in old]
                lv = [f['level'] for f in res['flags']]
                res['score'] = 'bad' if 'red' in lv else ('warn' if 'yellow' in lv else 'ok')
                res['missing'] = []
                res['note'] = 'Карточка обновлена сегодня; суды, ФССП и финансы — из полной проверки от %s. ' % dt + \
                    ('Полная проверка выполнится автоматически после 00:00 по Москве.' if queue else '')
        return self._finish(inn, res, self.quota())

    def _finish(self, inn, res, q, keep_full=None):
        res['checkedAt'] = datetime.now().isoformat(timespec='seconds')
        res['quotaNow'] = q
        # прежнюю полную проверку не затираем краткой / бесплатной: она остаётся в кэше, пока не устарела
        if res.get('partial') and keep_full and not keep_full.get('partial') and not res.get('nokey'):
            try:
                if (datetime.now() - datetime.fromisoformat(keep_full.get('checkedAt'))).days < 30:
                    keep_full['cached'] = True
                    keep_full['quotaNow'] = q
                    keep_full['note'] = res.get('note') or ''
                    keep_full['queued'] = res.get('queued')
                    return keep_full
            except Exception:
                pass
        self.store.check_put(inn, res)
        return res

    def _free_check(self, inn, note):
        """Бесплатная проверка без Checko: DaData (если есть ключ) или ФНС ЕГРЮЛ — статус, ликвидация, возраст,
        недостоверность сведений; остальное — ссылками на официальные сервисы."""
        keys = self.keys()
        info, src, errs = None, '', []
        for name, fn in ((('DaData', self._lookup_dadata),) if keys.get('dadataKey') else ()) + (('ФНС ЕГРЮЛ', self._lookup_egrul),):
            try:
                info = fn(inn, keys)
                if info:
                    src = name
                    break
            except Exception as e:
                errs.append('%s: %s' % (name, e))
        flags = []
        add = lambda lvl, text: flags.append({'level': lvl, 'text': text})
        age = None
        if info:
            (add('green', 'Организация действует') if info.get('active') else add('red', 'Статус: ' + (info.get('status') or 'не действует')))
            try:
                age = (date.today() - date.fromisoformat((info.get('regDate') or '')[:10])).days / 365.25
                if age < 1:
                    add('yellow', 'Зарегистрирована менее года назад')
                elif age >= 3:
                    add('green', 'Работает более %d лет' % int(age))
            except Exception:
                pass
            if info.get('invalid'):
                add('red', 'Недостоверные сведения в ЕГРЮЛ (отметка ФНС)')
            if info.get('disq'):
                add('red', 'Руководитель — дисквалифицированное лицо')
        levels = [f['level'] for f in flags]
        return {'inn': inn, 'ogrn': (info or {}).get('ogrn', ''), 'name': (info or {}).get('short', ''), 'status': (info or {}).get('status', ''),
                'active': (info or {}).get('active'), 'regDate': (info or {}).get('regDate', ''),
                'ageYears': round(age, 1) if age is not None else None, 'okved': (info or {}).get('okved', ''),
                'flags': flags, 'score': 'bad' if 'red' in levels else ('warn' if 'yellow' in levels else ('ok' if info else 'warn')),
                'source': src or 'нет данных', 'partial': True, 'free': True,
                'missing': ['арбитражные суды', 'исполнительные производства', 'финансовая отчётность', 'налоговая недоимка', 'банкротство', 'массовый адрес и руководитель'],
                'note': note, 'errors': errs, 'links': manual_links(inn), 'url': 'https://checko.ru/search?query=' + inn,
                'courts': {'count': None, 'sum': None}, 'fssp': {'count': None, 'sum': None}, 'finances': []}

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
        if raw.get('finances_reused'):
            fin = list(raw['finances_reused'])
            fdata = {}
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
