# -*- coding: utf-8 -*-
"""Связь кабинета менеджера с Битрикс24 (коробка или облако) — без правок кода в Битриксе: входящий вебхук (REST API).

• BitrixApi — запросы к REST по адресу вебхука https://<портал>/rest/<пользователь>/<ключ>/; ошибки — понятным текстом,
  адрес с ключом в текстах и журналах не появляется.
• BitrixConf — настройка (kv «bitrix»): адрес вебхука, включено, воронка, «наш этап → стадия Битрикса», «менеджер →
  пользователь Битрикса», как часто спрашивать изменения. В ответах «Настроек» ключ скрыт.
• BitrixQueue — очередь отправки (таблица bx_queue): события программы (сделка, КП, дело) ставят запись, фоновая задача
  отправляет; Битрикс недоступен — повтор позже. BitrixLinks — соответствие записей (bx_link) и последние согласованные
  значения полей (по ним видно, кто что поменял). BitrixLog — журнал обмена (bx_log).
• BitrixSync — обмен (решения владельца 17.10, `.claude/rules/70-crm.md`):
  - из программы: сделка (название, сумма, стадия, ожидаемая дата, ответственный, заметка, экономика полностью — свои поля
    сделки UF_CRM_KP_*), компания по ИНН (без дублей, реквизиты, адрес, контакт), товары последнего КП, файлы Word и PDF,
    справочные документы КП, Excel экономики сделки — записью в ленте сделки; дела (звонок, встреча, письмо, задача);
  - из Битрикса (опрос раз в 1–2 мин): стадия, ожидаемая дата, ответственный, название и заметка, новые сделки выбранной
    воронки, дела по связанным сделкам, контакты и адрес компании;
  - одновременная правка: сумма по КП, товары, экономика и файлы — всегда из программы; остальное — последняя правка.
• Тонкая настройка (19.10, bitrix_rules.BitrixRules): направления обмена (общее, по видам данных, по менеджерам), воронки
  со своими этапами, карта полей, товары и файлы, компании, дела, расписание; BitrixDry — пробный прогон на копии базы
  без записи; BitrixImport — сделки Битрикса, созданные до включения связи, — с даты, с предпросмотром.
"""
import base64
import hashlib
import json
import os
import re
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from bitrix_rules import BitrixRules
from crm import DealBook, Stages, TaskBook
from kp_track import Val


class BitrixError(RuntimeError):
    def __init__(self, text, code=''):
        RuntimeError.__init__(self, text)
        self.code = code


class BitrixApi:
    """REST Битрикс24 через входящий вебхук."""
    URL = re.compile(r'^https?://[A-Za-z0-9.-]{1,200}(:\d{1,5})?(/[A-Za-z0-9._~%-]{1,100}){0,3}/rest/\d{1,9}/[A-Za-z0-9]{6,64}/?$')
    TIMEOUT = 30
    PAGE = 50

    def __init__(self, url, opener=None):
        url = str(url or '').strip()
        if not self.URL.match(url):
            raise BitrixError('Адрес вебхука — вида https://bitrix24.kompr.ru/rest/1/ключ/ (в Битриксе: Разработчикам → '
                              'Другое → Входящий вебхук)')
        self.url = url.rstrip('/') + '/'
        self.host = re.match(r'^(https?://[^/]+)', url).group(1)
        self.opener = opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    @staticmethod
    def mask(url):
        """Адрес для показа: ключ скрыт."""
        m = re.match(r'^(https?://.+/rest/\d+/)([A-Za-z0-9]+)/?$', str(url or ''))
        return (m.group(1) + '••••' + m.group(2)[-3:] + '/') if m else ''

    def call(self, method, params=None):
        """Результат метода (result); список — (result, next) через call_raw. BitrixError — понятным текстом."""
        return self.call_raw(method, params).get('result')

    def call_raw(self, method, params=None):
        if not re.match(r'^[a-z][a-z0-9_.]{2,80}$', method):
            raise BitrixError('Неверный метод')
        body = json.dumps(params or {}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(self.url + method + '.json', data=body, method='POST',
                                     headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'KP-PNEVMOTEH'})
        try:
            with self.opener.open(req, timeout=self.TIMEOUT) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            raw = e.read() or b''
            d = self._json(raw)
            if d.get('error'):
                raise self._error(d)
            if e.code in (401, 403):
                raise BitrixError('Битрикс24 не принял вебхук (HTTP %d): проверьте адрес, ключ и права вебхука' % e.code, 'AUTH')
            raise BitrixError('Битрикс24 ответил ошибкой HTTP %d' % e.code, 'HTTP')
        except (urllib.error.URLError, OSError) as e:
            why = getattr(e, 'reason', e)
            raise BitrixError('Битрикс24 недоступен: %s' % str(why)[:160].replace(self.url, self.host + '/…'), 'NET')
        d = self._json(raw)
        if d.get('error'):
            raise self._error(d)
        if 'result' not in d:
            raise BitrixError('Битрикс24 прислал непонятный ответ', 'BAD')
        return d

    @staticmethod
    def _json(raw):
        try:
            d = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            return {}
        return d if isinstance(d, dict) else {}

    @staticmethod
    def _error(d):
        code = str(d.get('error') or '')
        text = str(d.get('error_description') or code)[:300]
        human = {'ERROR_METHOD_NOT_FOUND': 'метод не найден (старая версия Битрикса или у вебхука нет прав на этот раздел)',
                 'insufficient_scope': 'у вебхука нет прав на этот раздел — добавьте права CRM, Диск, Пользователи',
                 'INVALID_CREDENTIALS': 'неверный ключ вебхука', 'NO_AUTH_FOUND': 'неверный ключ вебхука',
                 'QUERY_LIMIT_EXCEEDED': 'слишком много запросов — повторю позже'}.get(code)
        return BitrixError('Битрикс24: %s' % (human or text), code)

    def list(self, method, params=None, limit=5000):
        """Все строки списка (по 50 за запрос, не больше limit)."""
        out, start = [], 0
        while True:
            d = self.call_raw(method, dict(params or {}, start=start))
            res = d.get('result')
            if isinstance(res, dict):            # новые методы: {items: […]} или {categories: […]}
                res = next((v for k, v in res.items() if isinstance(v, list)), [])
            out += res if isinstance(res, list) else []
            nxt = d.get('next')
            if not nxt or len(out) >= limit:
                return out[:limit]
            start = nxt


class BitrixConf:
    """Настройка связи (kv «bitrix»)."""
    KEY = 'bitrix'
    POLL = (30, 3600, 90)            # опрос изменений: от, до, по умолчанию — секунды

    def __init__(self, store):
        self.store = store

    def get(self):
        d = self.store.kv_get(self.KEY) or {}
        return d if isinstance(d, dict) else {}

    def on(self):
        d = self.get()
        return bool(d.get('on') and d.get('url'))

    def api(self, opener=None):
        d = self.get()
        if not d.get('url'):
            raise BitrixError('Адрес вебхука не задан — «Настройки → Сотрудники и система → Подключения и ключи → Битрикс24»')
        return BitrixApi(d['url'], opener)

    def poll(self):
        try:
            v = int(self.get().get('pollSec') or self.POLL[2])
        except (TypeError, ValueError):
            v = self.POLL[2]
        return min(max(v, self.POLL[0]), self.POLL[1])

    def view(self):
        """Для «Настроек»: без ключа."""
        d = self.get()
        out = {k: d.get(k) for k in ('on', 'category', 'stages', 'users', 'since', 'lastPull', 'lastRun', 'at', 'by', 'portal')}
        out.update(url=BitrixApi.mask(d.get('url')), hasUrl=bool(d.get('url')), pollSec=self.poll(), rules=BitrixRules(d).view())
        return out

    def rules(self):
        return BitrixRules(self.get())

    def save(self, d, by):
        """Изменить настройку: url, on, category, stages, users, pollSec и правила обмена (BitrixRules.check). ValueError — понятным текстом."""
        if not isinstance(d, dict):
            raise ValueError('Нет данных')
        cur = self.get()
        new = dict(cur)
        if 'url' in d:
            u = str(d.get('url') or '').strip()
            if u:
                BitrixApi(u)                  # проверка вида адреса
                new['url'] = u
                new['portal'] = re.match(r'^(https?://[^/]+)', u).group(1)
            else:
                new.pop('url', None)
                new['on'] = False
        if 'category' in d:
            c = str(d.get('category') if d.get('category') is not None else '')
            if c and not re.match(r'^\d{1,9}$', c):
                raise ValueError('Неверная воронка')
            old = str(cur.get('category') or '0')
            if (c or '0') != old:            # этапы прежней основной воронки остаются за ней; у новой — свои (если были)
                sb = dict(new.get('stagesBy') or {})
                if cur.get('stages'):
                    sb.setdefault(old, cur['stages'])
                new['stagesBy'] = sb
                new['stages'] = sb.get(c or '0', {})
            new['category'] = c
        if 'stages' in d:
            st = d.get('stages')
            if not isinstance(st, dict):
                raise ValueError('Неверное соответствие этапов')
            keys = Stages.keys(self.store)
            new['stages'] = {k: str(v)[:60] for k, v in st.items() if k in keys and v and re.match(r'^[A-Za-z0-9_:]{1,60}$', str(v))}
            new['stagesBy'] = dict(new.get('stagesBy') or {}, **{str(new.get('category') or '0'): new['stages']})
        if 'users' in d:
            us = d.get('users')
            if not isinstance(us, dict):
                raise ValueError('Неверное соответствие менеджеров')
            new['users'] = {str(k)[:64]: str(v) for k, v in us.items() if re.match(r'^[A-Za-z0-9_-]{1,64}$', str(k)) and re.match(r'^\d{1,9}$', str(v or ''))}
        if 'pollSec' in d:
            try:
                p = int(d.get('pollSec'))
            except (TypeError, ValueError):
                raise ValueError('Как часто спрашивать изменения — число секунд')
            if not (self.POLL[0] <= p <= self.POLL[1]):
                raise ValueError('Как часто спрашивать изменения — от %d до %d с' % self.POLL[:2])
            new['pollSec'] = p
        mids = {r[0] for r in self.store.all('SELECT id FROM managers')}
        BitrixRules.check(new, d, mids, Stages.keys(self.store))       # тонкая настройка: направления, менеджеры, поля, воронки…
        if 'on' in d:
            on = bool(d.get('on'))
            if on and not new.get('url'):
                raise ValueError('Сначала задайте адрес вебхука')
            if on and not new.get('category'):
                new['category'] = '0'
            if on and not cur.get('on'):
                new['since'] = new.get('since') or BitrixTime.now()       # новые сделки Битрикса — созданные после включения
            new['on'] = on
        new.update(at=Val.now(), by=str(by or '')[:120])
        self.store.kv_set(self.KEY, new)
        return new

    def mark(self, **kw):
        d = self.get()
        d.update(kw)
        self.store.kv_set(self.KEY, d)


class BitrixTime:
    """Время Битрикса: ISO с поясом ↔ местное время программы."""

    @staticmethod
    def now():
        return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')

    @staticmethod
    def local(s):
        """'2026-10-17T15:00:00+03:00' → местное 'ГГГГ-ММ-ДДTЧЧ:ММ:СС' (для сравнения с правками программы)."""
        try:
            t = datetime.fromisoformat(str(s or '').strip())
        except ValueError:
            return ''
        if t.tzinfo:
            t = t.astimezone().replace(tzinfo=None)
        return t.isoformat(timespec='seconds')

    @staticmethod
    def day(s):
        return str(s or '')[:10] if re.match(r'^\d{4}-\d{2}-\d{2}', str(s or '')) else ''


class BitrixLinks:
    """Соответствие записей программы и Битрикса: (вид, id в программе) ↔ id в Битриксе и согласованные значения полей."""

    def __init__(self, store):
        self.store = store

    def get(self, kind, local):
        r = self.store.one('SELECT bx_id, sent, at FROM bx_link WHERE kind=? AND local_id=?', (kind, str(local)))
        if not r:
            return None
        try:
            sent = json.loads(r[1]) if r[1] else {}
        except ValueError:
            sent = {}
        return {'bx': r[0], 'sent': sent if isinstance(sent, dict) else {}, 'at': r[2]}

    def local(self, kind, bx):
        r = self.store.one('SELECT local_id FROM bx_link WHERE kind=? AND bx_id=?', (kind, str(bx)))
        return r[0] if r else None

    def put(self, kind, local, bx, sent=None):
        self.store.write('INSERT OR REPLACE INTO bx_link (kind, local_id, bx_id, sent, at) VALUES (?,?,?,?,?)',
                         (kind, str(local), str(bx), json.dumps(sent or {}, ensure_ascii=False), Val.now()))

    def count(self, kind):
        return self.store.one('SELECT COUNT(*) FROM bx_link WHERE kind=?', (kind,))[0]


class BitrixQueue:
    """Что отправить в Битрикс: (вид, id). Повтор с паузой; после 20 неудач — ждёт «Отправить снова» в «Настройках»."""
    MAX_TRIES = 20
    _quiet = threading.local()           # изменения, пришедшие из Битрикса, обратно не отправляются

    def __init__(self, store):
        self.store = store

    @classmethod
    def quiet(cls):
        return getattr(cls._quiet, 'on', False)

    @classmethod
    def touch(cls, store, kind, local):
        """Событие программы: поставить в очередь, если связь включена (ошибка здесь не мешает работе программы)."""
        if cls.quiet() or not local:
            return
        try:
            if not BitrixConf(store).on():
                return
            store.write('INSERT INTO bx_queue (kind, local_id, added, tries, next_at) VALUES (?,?,?,0,?) '
                        'ON CONFLICT(kind, local_id) DO UPDATE SET added=excluded.added, tries=0, error=NULL, next_at=excluded.next_at',
                        (kind, str(local), Val.now(), Val.now()))
        except Exception:
            pass

    def due(self, limit=200, tries=None):
        return self.store.all('SELECT kind, local_id, tries FROM bx_queue WHERE tries < ? AND (next_at IS NULL OR next_at <= ?) '
                              "ORDER BY CASE kind WHEN 'deal' THEN 0 ELSE 1 END, added LIMIT ?", (tries or self.MAX_TRIES, Val.now(), limit))

    def done(self, kind, local):
        self.store.write('DELETE FROM bx_queue WHERE kind=? AND local_id=?', (kind, str(local)))

    def fail(self, kind, local, tries, err):
        wait = min(60 * (2 ** min(tries, 6)), 3600)
        nxt = (datetime.now() + timedelta(seconds=wait)).isoformat(timespec='seconds')
        self.store.write('UPDATE bx_queue SET tries=?, error=?, next_at=? WHERE kind=? AND local_id=?', (tries + 1, str(err)[:300], nxt, kind, str(local)))

    def retry_all(self):
        self.store.write('UPDATE bx_queue SET tries=0, next_at=NULL, error=NULL')

    def retry(self, kind, local):
        """Одну запись — отправить при следующем обмене. → была ли такая запись."""
        if not self.store.one('SELECT 1 FROM bx_queue WHERE kind=? AND local_id=?', (kind, str(local))):
            return False
        self.store.write('UPDATE bx_queue SET tries=0, next_at=NULL, error=NULL WHERE kind=? AND local_id=?', (kind, str(local)))
        return True

    def failed(self, limit=50):
        """Не отправленное с ошибкой: [{kind, id, title, error, tries, added}] — для «Повторить» в «Настройках»."""
        out = []
        for kind, local, tries, err, added in self.store.all('SELECT kind, local_id, tries, error, added FROM bx_queue WHERE error IS NOT NULL '
                                                              'ORDER BY added DESC LIMIT ?', (limit,)):
            if kind == 'deal':
                d = DealBook(self.store).get(local) or {}
                title = 'Сделка № %s «%s»' % (d.get('number') or local, d.get('title') or d.get('client') or '')
            else:
                t = TaskBook(self.store).get(int(local)) if str(local).isdigit() else None
                title = 'Дело «%s»' % ((t or {}).get('title') or local)
            out.append({'kind': kind, 'id': local, 'title': title, 'error': err or '', 'tries': tries or 0, 'added': added or ''})
        return out

    def stats(self):
        n, bad = self.store.one('SELECT COUNT(*), SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) FROM bx_queue')
        last = self.store.one('SELECT error FROM bx_queue WHERE error IS NOT NULL ORDER BY added DESC LIMIT 1')
        return {'queued': n or 0, 'failed': bad or 0, 'lastError': last[0] if last else ''}


class BitrixLog:
    KEEP = 1000

    def __init__(self, store):
        self.store = store

    def add(self, text, level='info', mid=None):
        """Запись журнала; mid — менеджер сделки или дела (отбор журнала по менеджеру в «Настройках»)."""
        self.store.write('INSERT INTO bx_log (at, level, text, mid) VALUES (?,?,?,?)', (Val.now(), level, str(text)[:600], str(mid or '') or None))
        self.store.write('DELETE FROM bx_log WHERE id NOT IN (SELECT id FROM bx_log ORDER BY id DESC LIMIT ?)', (self.KEEP,))

    def tail(self, n=60):
        return [{'at': a, 'level': lv, 'text': t, 'mid': m or ''} for a, lv, t, m in self.store.all('SELECT at, level, text, mid FROM bx_log ORDER BY id DESC LIMIT ?', (n,))]

    def last_id(self):
        return self.store.one('SELECT COALESCE(MAX(id), 0) FROM bx_log')[0]

    def since(self, i):
        return [{'level': lv, 'text': t} for lv, t in self.store.all('SELECT level, text FROM bx_log WHERE id > ? ORDER BY id', (i,))]


class BitrixFields:
    """Свои поля сделки в Битриксе для экономики и номеров КП (создаются программой один раз)."""
    LIST = (('KP_NUMBER', 'string', 'КП (номера)'), ('KP_PRICE', 'double', 'Цена для заказчика с НДС, ₽'),
            ('KP_REVENUE', 'double', 'Выручка без НДС, ₽'), ('KP_COST', 'double', 'Себестоимость с финансированием, ₽'),
            ('KP_FINANCE', 'double', 'Финансирование, ₽'), ('KP_PROFIT', 'double', 'Прибыль до налога, ₽'),
            ('KP_NET', 'double', 'Чистая прибыль, ₽'), ('KP_MARGIN', 'double', 'Маржинальность, %'),
            ('KP_MARKUP', 'double', 'Наценка, %'), ('KP_ECON', 'string', 'Экономика сделки: структура затрат и график платежей'))

    @staticmethod
    def name(code):
        return 'UF_CRM_' + code

    @classmethod
    def ensure(cls, api, want=None):
        """Создать недостающие свои поля сделки: want — [(код без UF_CRM_, тип, подпись)] (по умолчанию — поля экономики)."""
        have = {f.get('FIELD_NAME') for f in api.list('crm.deal.userfield.list', {'filter': {}})}
        made = 0
        for code, typ, label in (cls.LIST if want is None else want):
            if cls.name(code) in have:
                continue
            f = {'FIELD_NAME': code, 'USER_TYPE_ID': typ, 'EDIT_FORM_LABEL': label, 'LIST_COLUMN_LABEL': label, 'LIST_FILTER_LABEL': label,
                 'XML_ID': code}
            if code == 'KP_ECON':
                f['SETTINGS'] = {'ROWS': 12}
            api.call('crm.deal.userfield.add', {'fields': f})
            made += 1
        return made


class BitrixSync:
    """Обмен с Битрикс24: очередь отправки и опрос изменений."""
    LOCK = threading.Lock()
    KIND = BitrixRules.TASK_KINDS
    SHARED = BitrixRules.SHARED      # правка с обеих сторон: кто главный — по правилу поля (по умолчанию последняя правка)
    STD = {'title': 'TITLE', 'stage': 'STAGE_ID', 'expected': 'CLOSEDATE', 'manager': 'ASSIGNED_BY_ID'}
    WHO = 'Битрикс24'

    def __init__(self, store, opener=None, files=None):
        self.store, self.conf = store, BitrixConf(store)
        self.links, self.queue, self.log = BitrixLinks(store), BitrixQueue(store), BitrixLog(store)
        self.opener = opener
        self.files = files or self._kp_files
        self._api = None
        self._rules = None

    @property
    def R(self):
        """Правила обмена (bitrix_rules) — читаются один раз за обмен."""
        if self._rules is None:
            self._rules = self.conf.rules()
        return self._rules

    @property
    def api(self):
        if self._api is None:
            self._api = self.conf.api(self.opener)
        return self._api

    # ---------------------------------------------------------------- проверка и справочники для «Настроек»
    def check(self):
        """Связь, воронки, стадии выбранной и загружаемых воронок, поля сделки, пользователи и подсказка «менеджер → пользователь»."""
        api = self.api
        prof = api.call('profile') or {}
        cats = self.categories()
        cat = str(self.conf.get().get('category') or '0')
        users = self.users()
        mgrs = self._managers()
        by_mail = {u['email'].lower(): u['id'] for u in users if u.get('email')}
        auto = {m['id']: by_mail[m['email'].lower()] for m in mgrs if m.get('email') and m['email'].lower() in by_mail}
        R = self.conf.rules()
        stages_by = {c['id']: self.stage_list(c['id']) for c in cats if c['id'] in set(R.pull_cats() + [cat])}
        return {'ok': True, 'user': ' '.join(x for x in (prof.get('NAME'), prof.get('LAST_NAME')) if x) or str(prof.get('ID') or ''),
                'admin': bool(prof.get('ADMIN')), 'categories': cats, 'stages': stages_by.get(cat) or self.stage_list(cat), 'stagesBy': stages_by,
                'users': users, 'managers': mgrs, 'auto': auto, 'portal': api.host, 'fields': self.deal_fields()}

    def deal_fields(self):
        """Поля сделки портала для карты полей: свои (UF_*) и текстовые стандартные — [{code, title, type}]."""
        try:
            raw = self.api.call('crm.deal.fields') or {}
        except BitrixError:
            return []
        out = []
        for code, f in raw.items() if isinstance(raw, dict) else []:
            if not isinstance(f, dict) or f.get('isReadOnly') or not (code.startswith('UF_') or code in ('COMMENTS', 'SOURCE_DESCRIPTION', 'ADDITIONAL_INFO')):
                continue
            title = f.get('formLabel') or f.get('listLabel') or f.get('title') or code
            out.append({'code': code, 'title': str(title)[:120], 'type': str(f.get('type') or '')})
        return sorted(out, key=lambda x: x['title'].lower())

    def stages_all(self, cat):
        """Стадии воронки cat (для «Настроек», при выборе другой воронки)."""
        return self.stage_list(cat)

    def categories(self):
        try:
            rows = self.api.list('crm.category.list', {'entityTypeId': 2})
            out = [{'id': str(r.get('id')), 'name': r.get('name') or ''} for r in rows]
        except BitrixError as e:
            if e.code not in ('ERROR_METHOD_NOT_FOUND', 'NOT_FOUND'):
                raise
            out = [{'id': '0', 'name': 'Общая'}] + [{'id': str(r.get('ID')), 'name': r.get('NAME') or ''} for r in self.api.list('crm.dealcategory.list')]
        if not any(c['id'] == '0' for c in out):
            out.insert(0, {'id': '0', 'name': 'Общая'})
        return out

    def stage_list(self, cat):
        ent = 'DEAL_STAGE' if str(cat or '0') == '0' else 'DEAL_STAGE_%s' % cat
        rows = self.api.list('crm.status.list', {'filter': {'ENTITY_ID': ent}, 'order': {'SORT': 'ASC'}})
        out = []
        for r in rows:
            sem = (r.get('EXTRA') or {}).get('SEMANTICS') if isinstance(r.get('EXTRA'), dict) else r.get('SEMANTICS')
            out.append({'id': r.get('STATUS_ID'), 'name': r.get('NAME') or '', 'sem': {'success': 'S', 'failure': 'F'}.get(sem, sem or '')})
        return out

    def users(self):
        rows = self.api.list('user.get', {'FILTER': {'ACTIVE': True}}, limit=2000)
        return [{'id': str(u.get('ID')), 'name': ' '.join(x for x in (u.get('LAST_NAME'), u.get('NAME')) if x) or u.get('EMAIL') or str(u.get('ID')),
                 'email': u.get('EMAIL') or ''} for u in rows]

    def _managers(self):
        out = []
        for mid, doc in self.store.all('SELECT id, doc FROM managers ORDER BY name COLLATE NOCASE'):
            try:
                d = json.loads(doc)
            except ValueError:
                continue
            if d.get('name'):
                out.append({'id': mid, 'name': d['name'], 'email': str(d.get('email') or '').strip()})
        return out

    # ---------------------------------------------------------------- цикл
    def run(self, pull=True, budget=None, manual=False, push=True):
        """Отправить очередь (push) и забрать изменения (pull). → {sent, failed, pulled}. Один обмен за раз; фоновый — только в
        часы обмена (расписание), кнопкой (manual) — всегда."""
        if not self.conf.on():
            return {'off': True}
        self._rules = None
        if not manual and not self.R.in_hours():
            return {'hours': True}
        if not self.LOCK.acquire(blocking=False):
            return {'busy': True}
        try:
            res = {'sent': 0, 'failed': 0, 'pulled': 0, 'created': 0, 'tasks': 0}
            try:
                self._prepare()
            except BitrixError as e:
                self.log.add('Нет связи с Битрикс24: %s' % e, 'error')
                res['error'] = str(e)
                return res
            sc = self.R.sched()
            for kind, local, tries in (self.queue.due(sc['batch'], sc['tries']) if push else []):
                try:
                    if kind == 'deal':
                        self.push_deal(local)
                    elif kind == 'task':
                        self.push_task(int(local))
                    self.queue.done(kind, local)
                    res['sent'] += 1
                except BitrixError as e:
                    self.queue.fail(kind, local, tries, e)
                    what = ('Сделка № %s' % ((DealBook(self.store).get(local) or {}).get('number') or local)) if kind == 'deal' else 'Дело %s' % local
                    self.log.add('%s не отправлена: %s' % (what, e) if kind == 'deal' else '%s не отправлено: %s' % (what, e), 'error')
                    res['failed'] += 1
                    if e.code == 'NET':
                        res['error'] = str(e)
                        return res
                except Exception as e:       # ошибка не связи (этап убрали из списка и т. п.) — запись не держит очередь
                    self.queue.fail(kind, local, tries, e)
                    self.log.add('%s %s не отправлено: %s' % ('Сделка' if kind == 'deal' else 'Дело', local, e), 'error')
                    res['failed'] += 1
            if pull:
                try:
                    res.update(self.pull())
                except Exception as e:
                    self.log.add('Изменения из Битрикс24 не получены: %s' % e, 'error')
                    res['error'] = str(e)
            return res
        finally:
            self.LOCK.release()

    def _prepare(self):
        """Свои поля сделки, включённые в карте полей, — создать в Битриксе один раз (новые — когда их включат)."""
        d = self.conf.get()
        if not self.R.can('deal', 'out'):
            return                           # только из Битрикса — в Битриксе ничего не создаём
        want = self.R.own_fields()
        codes = sorted(c for c, _t, _l in want)
        made = d.get('fieldsMade') if isinstance(d.get('fieldsMade'), list) else ([c for c, _t, _l in BitrixFields.LIST] if d.get('fieldsOk') else [])
        if set(codes) - set(made):
            n = BitrixFields.ensure(self.api, want)
            if n:
                self.log.add('В сделках Битрикс24 созданы поля программы: %d' % n)
            self.conf.mark(fieldsOk=True, fieldsMade=sorted(set(made) | set(codes)))

    # ---------------------------------------------------------------- компания
    def company(self, d):
        """Компания сделки в Битриксе: по ИНН в реквизитах (дублей не создаётся), иначе по названию; нет — создаётся."""
        inn = re.sub(r'\D', '', str(d.get('clientInn') or ''))
        name = str(d.get('client') or '').strip()
        key = inn or name.lower()
        if not key:
            return None
        ln = self.links.get('company', key)
        if ln:
            return ln['bx']
        C = self.R.company()
        cid = None
        if inn and C['find'] in ('inn', 'inn_name'):
            rq = self.api.list('crm.requisite.list', {'filter': {'RQ_INN': inn, 'ENTITY_TYPE_ID': 4}, 'select': ['ID', 'ENTITY_ID']}, limit=5)
            cid = rq[0].get('ENTITY_ID') if rq else None
        if not cid and name and C['find'] in ('inn_name', 'name'):
            found = self.api.list('crm.company.list', {'filter': {'TITLE': name}, 'select': ['ID']}, limit=2)
            cid = found[0].get('ID') if found else None
        if not cid:
            if not C['create'] or not self.R.can('company', 'out'):    # создавать компании в Битриксе — нельзя
                return None
            cid = self._company_add(d, inn, name)
            self.log.add('В Битрикс24 создана компания «%s»%s' % (name, ' (ИНН %s)' % inn if inn else ''), mid=d.get('managerId'))
        self.links.put('company', key, cid)
        return str(cid)

    def _client(self, inn, name):
        doc = None
        if inn:
            doc = self.store.client_get('inn' + inn)
            if not doc:
                r = self.store.one('SELECT doc FROM clients WHERE inn=? LIMIT 1', (inn,))
                doc = json.loads(r[0]) if r and r[0] else None
        return doc if isinstance(doc, dict) else {}

    def _company_add(self, d, inn, name):
        c = self._client(inn, name)
        cons = [x for x in (c.get('contacts') or []) if isinstance(x, dict) and x.get('name')]
        phones = [x['phone'] for x in cons if x.get('phone')][:3]
        mails = [x['email'] for x in cons if x.get('email')][:3]
        fields = {'TITLE': c.get('name') or name, 'OPENED': 'Y', 'COMPANY_TYPE': 'CUSTOMER',
                  'PHONE': [{'VALUE': p, 'VALUE_TYPE': 'WORK'} for p in phones], 'EMAIL': [{'VALUE': m, 'VALUE_TYPE': 'WORK'} for m in mails]}
        uid = self._user_of(d.get('managerId'))
        if uid:
            fields['ASSIGNED_BY_ID'] = uid
        cid = self.api.call('crm.company.add', {'fields': fields})
        C = self.R.company()
        if inn and C['reqs']:
            preset = self._preset()
            rq = {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': cid, 'PRESET_ID': preset, 'NAME': 'Реквизиты', 'RQ_INN': inn,
                  'RQ_KPP': c.get('kpp') or '', 'RQ_OGRN': c.get('ogrn') or '', 'RQ_COMPANY_NAME': c.get('name') or name,
                  'RQ_COMPANY_FULL_NAME': c.get('full') or '', 'RQ_DIRECTOR': c.get('director') or ''}
            rid = self.api.call('crm.requisite.add', {'fields': rq})
            if c.get('address') and rid:
                try:
                    self.api.call('crm.address.add', {'fields': {'TYPE_ID': 6, 'ENTITY_TYPE_ID': 8, 'ENTITY_ID': rid, 'ADDRESS_1': c['address'][:250]}})
                except BitrixError:
                    pass                   # адрес — не главное: компания и реквизиты уже есть
        for x in (cons[:3] if self.R.allow(C['contacts'], 'out') else []):
            parts = str(x['name']).split()
            self.api.call('crm.contact.add', {'fields': {
                'LAST_NAME': parts[0] if len(parts) > 1 else '', 'NAME': ' '.join(parts[1:]) if len(parts) > 1 else parts[0], 'POST': x.get('post') or '',
                'COMPANY_ID': cid, 'OPENED': 'Y', 'PHONE': [{'VALUE': x['phone'], 'VALUE_TYPE': 'WORK'}] if x.get('phone') else [],
                'EMAIL': [{'VALUE': x['email'], 'VALUE_TYPE': 'WORK'}] if x.get('email') else []}})
        return cid

    def _preset(self):
        d = self.conf.get()
        if d.get('preset'):
            return d['preset']
        rows = self.api.list('crm.requisite.preset.list', {'select': ['ID', 'NAME', 'ENTITY_TYPE_ID']}, limit=50)
        pid = next((r['ID'] for r in rows if 'организац' in str(r.get('NAME') or '').lower()), rows[0]['ID'] if rows else 1)
        self.conf.mark(preset=pid)
        return pid

    # ---------------------------------------------------------------- сделка → Битрикс
    def _user_of(self, mid):
        return (self.conf.get().get('users') or {}).get(str(mid or ''))

    def _mid_of(self, uid):
        return next((m for m, u in (self.conf.get().get('users') or {}).items() if str(u) == str(uid)), None)

    def _stage_of(self, key, cat=None):
        return self.R.stages(cat).get(key)

    def _key_of(self, stage_id, sem='', cat=None):
        if cat is None and ':' in str(stage_id or ''):
            cat = str(stage_id).split(':')[0][1:]            # «C3:NEW» — стадия воронки 3
        st = self.R.stages(cat if cat is not None else None)
        k = next((k for k, v in st.items() if v == stage_id), None)
        if k:
            return k
        return {'S': 'won', 'F': 'lost'}.get(sem)

    @staticmethod
    def _econ(kps):
        """Экономика последнего КП с расчётом сделки → поля UF (полностью, решение владельца 17.10)."""
        k = next((x for x in kps if isinstance(x.get('deal'), dict) and x['deal'].get('full')), None)
        if not k:
            return {}
        e, f = k['deal'], k['deal']['full']
        num = lambda v: round(float(v), 2) if isinstance(v, (int, float)) else ''
        lines = ['Экономика по КП № %s' % k['number']]
        for n, s in (f.get('parts') or [])[:30]:
            lines.append('%s: %s ₽' % (n, '{:,.0f}'.format(float(s or 0)).replace(',', ' ')))
        if f.get('pays'):
            lines.append('')
            lines.append('График платежей:')
            for p in f['pays'][:40]:
                lines.append('%s — %s: %s ₽' % (p.get('d') or 'день %s' % p.get('day'), p.get('t') or '', '{:,.0f}'.format(float(p.get('a') or 0)).replace(',', ' ')))
        if not e.get('confirmed'):
            lines.append('')
            lines.append('Прибыль — диапазоном: не указан ввозной НДС к вычету')
        return {'KP_PRICE': num(f.get('price')), 'KP_REVENUE': num(f.get('revenue')), 'KP_COST': num(f.get('cost')), 'KP_FINANCE': num(f.get('fin')),
                'KP_PROFIT': num(e.get('profit') if e.get('confirmed') else e.get('lo')), 'KP_NET': num(e.get('net')),
                'KP_MARGIN': num(e.get('margin') if e.get('confirmed') else e.get('marginLo')), 'KP_MARKUP': num(e.get('markup')),
                'KP_ECON': '\n'.join(lines)[:6000]}

    def _extra(self, d, kps):
        """Прочие поля программы для карты полей (по умолчанию не передаются): номер сделки, клиент, ИНН, оборудование…"""
        k = kps[0] if kps else {}
        m = k.get('meta') or {}
        status = {'new': 'Новое', 'sent': 'Отправлено', 'talks': 'Переговоры', 'won': 'Выиграно', 'lost': 'Проиграно'}
        return {'dealNo': str(d.get('number') or ''), 'client': d.get('client') or '', 'inn': d.get('clientInn') or '',
                'items': '; '.join(str(x) for x in (m.get('items') or [])[:30])[:1000], 'kpDate': str(m.get('date') or '')[:10],
                'kpStatus': status.get(k.get('status'), k.get('status') or '') if k else '', 'mgrName': d.get('manager') or ''}

    def _kps(self, did):
        from admin import econ_rub
        out = []
        for kid, meta, track in self.store.all('SELECT k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id '
                                               'WHERE l.deal_id=? AND k.meta IS NOT NULL', (did,)):
            try:
                m = json.loads(meta)
            except ValueError:
                continue
            try:
                tr = json.loads(track) if track else {}
            except ValueError:
                tr = {}
            out.append({'id': kid, 'number': m.get('number') or kid, 'savedAt': m.get('savedAt') or m.get('date') or '', 'meta': m,
                        'status': (tr or {}).get('status') or 'new', 'deal': m.get('deal'), 'lines': m.get('lines'), 'sum': econ_rub(m)[0]})
        out.sort(key=lambda x: (x['savedAt'], x['id']), reverse=True)
        return out

    @staticmethod
    def _rows(k):
        """Товары сделки: позиции последнего КП (цены — за единицу со скидкой, с НДС, в рублях по курсу КП)."""
        L = k.get('lines') if isinstance(k.get('lines'), dict) else None
        if not L or not isinstance(L.get('rows'), list):
            return None
        rate = float(L.get('rate') or 1) or 1
        vat = float(L.get('vat') or 0)
        out = []
        for r in L['rows'][:200]:
            if not isinstance(r, dict) or not r.get('n'):
                continue
            out.append({'PRODUCT_NAME': str(r['n'])[:250], 'PRICE': round(float(r.get('p') or 0) / 100 * rate, 2),
                        'QUANTITY': float(r.get('q') or 1), 'TAX_RATE': vat, 'TAX_INCLUDED': 'Y', 'MEASURE_NAME': str(r.get('u') or 'шт')[:20]})
        return out

    def _ours(self, d, kps):
        mid = d.get('managerId')
        return {'title': d.get('title') or d.get('client') or 'Сделка № %s' % d.get('number'), 'stage': d.get('stage'),
                'expected': d.get('expected') or '', 'manager': self._user_of(mid) or '', 'note': d.get('note') or '',
                'lostReason': d.get('lostReason') or '' if d.get('stage') == 'lost' else ''}

    def _bx(self, key):
        """Поле Битрикса для общего поля программы (по карте полей)."""
        return self.STD.get(key) or self.R.field(key)['bx']

    def _theirs(self, b):
        return {'title': b.get('TITLE') or '', 'stage': b.get('STAGE_ID') or '', 'expected': BitrixTime.day(b.get('CLOSEDATE')),
                'manager': str(b.get('ASSIGNED_BY_ID') or ''), 'note': str(b.get(self._bx('note')) or ''),
                'lostReason': str(b.get(self._bx('lostReason')) or '')}

    def push_deal(self, did):
        """Сделка программы → Битрикс: создать или обновить (общие поля — по последней правке), товары, экономика, файлы."""
        d = DealBook(self.store).get(did)
        if not d:
            return
        R, mid = self.R, d.get('managerId')
        ln = self.links.get('deal', did)
        if not R.can('deal', 'out', mid):
            return                           # обмен только из Битрикса (весь или у этого менеджера) — в Битрикс не пишем
        kps = self._kps(did)
        out = lambda k: R.allow(R.field(k)['dir'], 'out')
        fields = {}
        if out('sum'):
            fields.update(OPPORTUNITY=round((d.get('sum') or 0) / 100, 2), CURRENCY_ID='RUB')
        if R.flow('company') != 'off':
            cid = self.company(d)
            if cid:
                fields['COMPANY_ID'] = cid
        uf = self._econ(kps)
        if kps:
            uf['KP_NUMBER'] = ', '.join(str(k['number']) for k in kps)[:250]
        uf.update(self._extra(d, kps))
        for k, v in uf.items():
            x = R.field(k)
            if x['dir'] == 'out' and x['bx']:
                fields[x['bx']] = v
        cat = str((ln or {}).get('sent', {}).get('cat') or R.cat_of(mid))
        ours = self._ours(d, kps)
        ours['stage'] = self._stage_of(d['stage'], cat) or ''
        if not ln:
            fields.update({'CATEGORY_ID': int(cat), 'OPENED': 'Y', 'SOURCE_DESCRIPTION': 'Конструктор КП, сделка № %s' % d.get('number')})
            sent = {'cat': cat}
            for k in self.SHARED:
                if out(k) and ours.get(k) and self._bx(k):
                    fields[self._bx(k)] = ours[k]
                    sent[k] = ours[k]
            fields.setdefault('TITLE', ours['title'])          # без названия Битрикс сделку не создаст
            bid = str(self.api.call('crm.deal.add', {'fields': fields, 'params': {'REGISTER_SONET_EVENT': 'N'}}))
            self.links.put('deal', did, bid, sent)
            self.log.add('Сделка № %s «%s» → Битрикс24 (сделка %s)' % (d.get('number'), ours['title'], bid), mid=mid)
        else:
            bid = ln['bx']
            b = self.api.call('crm.deal.get', {'id': bid}) or {}
            cat = str(b.get('CATEGORY_ID') or cat)
            ours['stage'] = self._stage_of(d['stage'], cat) or ''
            sent, upd, back = self._merge(d, ours, self._theirs(b), ln['sent'], BitrixTime.local(b.get('DATE_MODIFY')))
            sent['cat'] = cat
            for k, v in upd.items():
                fields[self._bx(k)] = v
            if upd:
                self.log.add('Сделка № %s → Битрикс24: %s' % (d.get('number'), self._said(upd, ln['sent'], cat)), mid=mid)
            if fields:
                self.api.call('crm.deal.update', {'id': bid, 'fields': fields, 'params': {'REGISTER_SONET_EVENT': 'N'}})
            if back:
                self._apply(d, back, b, ln['sent'])
            self.links.put('deal', did, bid, sent)
        S = R.send()
        rows = (self._rows(kps[0]) if S['rowsHow'] == 'kp' else self._rows_sum(d, kps[0])) if kps and S['rows'] else None
        if rows is not None:
            h = hashlib.sha1(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            lr = self.links.get('rows', did)
            if not lr or lr['sent'].get('h') != h:
                self.api.call('crm.deal.productrows.set', {'id': bid, 'rows': rows})
                self.links.put('rows', did, bid, {'h': h})
        for k in kps:
            self._files(bid, k)
        for t in TaskBook(self.store).list(deal=did):
            if not self.links.get('task', t['id']):
                self.push_task(t['id'], bid)

    @staticmethod
    def _rows_sum(d, k):
        """Товары сделки одной строкой: итог последнего КП (правило «товары — только итог»)."""
        L = k.get('lines') if isinstance(k.get('lines'), dict) else {}
        return [{'PRODUCT_NAME': 'Оборудование по КП № %s' % k['number'], 'PRICE': round((d.get('sum') or 0) / 100, 2), 'QUANTITY': 1,
                 'TAX_RATE': float(L.get('vat') or 0), 'TAX_INCLUDED': 'Y', 'MEASURE_NAME': 'компл'}]

    def _said(self, vals, base, cat=None):
        """«этап: Переговоры → Договор, ожидаемая дата: — → 2026-11-01» — для журнала (значения Битрикса — понятными словами)."""
        names = {'title': 'название', 'stage': 'этап', 'expected': 'ожидаемая дата', 'manager': 'ответственный', 'note': 'заметка', 'lostReason': 'причина'}
        stg = {v: k for k, v in self.R.stages(cat).items()}
        labels = {s['key']: s['label'] for s in Stages.all(self.store)}
        mg = {m['id']: m['name'] for m in self._managers()}

        def show(k, v):
            if not v:
                return '—'
            if k == 'stage':
                return labels.get(stg.get(v, v), v)
            if k == 'manager':
                return mg.get(self._mid_of(v) or '', 'пользователь %s' % v)
            v = str(v)
            return v if len(v) <= 40 else v[:38] + '…'
        return ', '.join('%s: %s → %s' % (names.get(k, k), show(k, (base or {}).get(k)), show(k, v)) for k, v in vals.items())

    def _merge(self, d, ours, theirs, base, their_at):
        """Общие поля по карте полей: направление «в Битрикс» — программа главная (отправить, если отличается), «из Битрикса» —
        Битрикс главный (взять его изменение, правка в программе остаётся в программе), «в обе стороны»: изменили только мы —
        отправить, только в Битриксе — взять, оба — кто главный по правилу поля (по умолчанию последняя правка); «не передавать» —
        ничего. → (новые согласованные значения, что отправить, что взять)."""
        upd, back, agreed = {}, {}, dict(base)
        for k in self.SHARED:
            x = self.R.field(k)
            if x['dir'] == 'off' or not self._bx(k):
                continue
            o, t, b = ours.get(k) or '', theirs.get(k) or '', base.get(k) or ''
            if k == 'stage' and not o:
                o = t                         # этап без соответствия стадии — стадию Битрикса не трогаем
            if k == 'manager' and not o:
                o = t                         # менеджер без пользователя Битрикса — ответственного не трогаем
            if o == t:
                agreed[k] = o
                continue
            mine, their = o != b, t != b
            if x['dir'] == 'out':
                upd[k], agreed[k] = o, o
            elif x['dir'] == 'in':
                if their:
                    back[k] = t
                agreed[k] = t
            elif mine and their:
                ours_win = x['win'] == 'ours' or (x['win'] == 'last' and (d.get('updated') or '') >= (their_at or ''))
                if ours_win:
                    upd[k], agreed[k] = o, o
                else:
                    back[k], agreed[k] = t, t
            elif mine:
                upd[k], agreed[k] = o, o
            else:
                back[k], agreed[k] = t, t
        return agreed, upd, back

    def _apply(self, d, back, b=None, base=None):
        """Значения из Битрикса — в сделку программы (без отправки обратно); в журнал — «поле: было → стало»."""
        if not self.R.can('deal', 'in', d.get('managerId')):
            return
        body = {}
        if 'title' in back and back['title']:
            body['title'] = back['title']
        if 'note' in back:
            body['note'] = back['note']
        if 'expected' in back:
            body['expected'] = back['expected']
        if 'stage' in back:
            key = self._key_of(back['stage'], (b or {}).get('STAGE_SEMANTIC_ID') or '', str((b or {}).get('CATEGORY_ID') or '') or None)
            if key and key != d.get('stage'):
                body['stage'] = key
                if key == 'lost':
                    body['lostReason'] = back.get('lostReason') or d.get('lostReason') or 'Проиграно в Битрикс24'
        if back.get('lostReason') and (body.get('stage') or d.get('stage')) == 'lost':
            body['lostReason'] = back['lostReason']
        mgr = None
        if 'manager' in back:
            mid = self._mid_of(back['manager'])
            if mid and mid != d.get('managerId'):
                m = next((x for x in self._managers() if x['id'] == mid), None)
                mgr = (mid, m['name']) if m else None
        if not body and not mgr:
            return
        BitrixQueue._quiet.on = True
        try:
            DealBook(self.store).update(d['id'], body, self.WHO, None, mgr)
            if mgr:
                TaskBook(self.store).move_deal(d['id'], mgr[0])
        finally:
            BitrixQueue._quiet.on = False
        shown = {k: back[k] for k in back if k in body or (k == 'manager' and mgr)}
        self.log.add('Сделка № %s ← Битрикс24: %s' % (d.get('number'), self._said(shown, base, str((b or {}).get('CATEGORY_ID') or '') or None)),
                     mid=mgr[0] if mgr else d.get('managerId'))

    def _files(self, bid, k):
        """Файлы КП (Word, PDF, справочные документы, Excel экономики) → лента сделки; каждый файл — один раз на версию."""
        S = self.R.send()
        on = {v: S['files'][k] for k, v in BitrixRules.FILES.items()}
        for name, path_or_data, what in self.files(k['id']):
            if not on.get(what, True):
                continue
            try:
                data = path_or_data if isinstance(path_or_data, bytes) else open(path_or_data, 'rb').read()
            except OSError:
                continue
            if len(data) > S['fileMB'] * 1024 * 1024:
                self.log.add('Файл «%s» больше %d МБ — в Битрикс24 не отправлен' % (name, S['fileMB']), 'warn')
                continue
            h = hashlib.sha1(data).hexdigest()
            key = '%s|%s' % (k['id'], name)
            ln = self.links.get('file', key)
            if ln and ln['sent'].get('h') == h and ln['bx'] == bid:
                continue
            cid = self.api.call('crm.timeline.comment.add', {'fields': {
                'ENTITY_ID': int(bid), 'ENTITY_TYPE': 'deal', 'COMMENT': '%s — КП № %s%s' % (what, k['number'], ' (новая версия)' if ln else ''),
                'FILES': [[name, base64.b64encode(data).decode('ascii')]]}})
            self.links.put('file', key, bid, {'h': h, 'c': cid})

    def _kp_files(self, kid):
        """[(имя, путь или байты, подпись)] — файлы КП для ленты сделки."""
        from config import docs_path
        from kp_files import KpFiles
        out = []
        rel = self.store.kp_get(kid, 'docx')
        if rel:
            try:
                f = docs_path(rel.strip())
            except ValueError:
                f = ''
            if f and os.path.isfile(f):
                out.append((os.path.basename(f), f, 'КП (Word)'))
                pdf = os.path.splitext(f)[0] + '.pdf'
                if os.path.isfile(pdf):
                    out.append((os.path.basename(pdf), pdf, 'КП (PDF)'))
        x = EconXlsx(self.store).path(kid)
        if x:
            out.append(('Экономика_КП_%s.xlsx' % kid, x, 'Экономика сделки (Excel)'))
        kf = KpFiles.of(self.store)
        for r in kf.list(kid):
            got = kf.read(kid, r['id'])
            if got:
                out.append((r['name'], got[1], 'Справочный документ'))
        return out

    # ---------------------------------------------------------------- дела
    def push_task(self, tid, bid=None):
        t = TaskBook(self.store).get(tid)
        if not t or not t.get('deal'):
            return
        T = self.R.tasks()
        how = T['kinds'].get(t['kind'], 'todo')
        if how == 'off' or not self.R.can('task', 'out', t.get('managerId')):
            return                              # этот вид дел (или дела этого менеджера) в Битрикс не передаются
        if t['state'] == 'cancel' and not T['cancel'] and not self.links.get('task', tid):
            return
        if not bid:
            ln = self.links.get('deal', t['deal'])
            if not ln:
                self.push_deal(t['deal'])          # сделка ещё не в Битриксе — её дела уйдут вместе с ней
                return
            bid = ln['bx']
        subj = '%s: %s' % (self.KIND.get(t['kind'], 'Задача'), t['title'])
        if t['state'] == 'cancel':
            subj = 'Отменено — ' + subj
        when = '%sT%s:00' % (t['due'], t.get('time') or '18:00')
        uid = self._user_of(t.get('managerId'))
        ln = self.links.get('task', tid)
        done = 'Y' if t['state'] != 'open' else 'N'
        sent = {'subj': subj, 'when': when, 'done': done}
        if ln:
            if ln['sent'] == sent or (t['state'] == 'cancel' and not T['cancel']):
                return
            self.api.call('crm.activity.update', {'id': ln['bx'], 'fields': {'SUBJECT': subj, 'DEADLINE': when, 'END_TIME': when,
                                                                            'COMPLETED': done, 'DESCRIPTION': t.get('note') or ''}})
            self.links.put('task', tid, ln['bx'], sent)
            return
        try:
            if how != 'todo':
                raise BitrixError('звонок или встреча', 'NOT_FOUND')     # по правилу — дело-звонок или дело-встреча
            aid = self.api.call('crm.activity.todo.add', {'ownerTypeId': 2, 'ownerId': int(bid), 'deadline': when, 'title': subj,
                                                          'description': t.get('note') or '', **({'responsibleId': int(uid)} if uid else {})})
            aid = aid.get('id') if isinstance(aid, dict) else aid
        except BitrixError as e:
            if e.code not in ('ERROR_METHOD_NOT_FOUND', 'NOT_FOUND'):
                raise
            meet = how == 'meet' or (how == 'todo' and t['kind'] == 'meet')
            aid = self.api.call('crm.activity.add', {'fields': {           # старый Битрикс или правило: дело «встреча» / «звонок»
                'OWNER_TYPE_ID': 2, 'OWNER_ID': int(bid), 'TYPE_ID': 1 if meet else 2, 'SUBJECT': subj,
                'START_TIME': when, 'END_TIME': when, 'DEADLINE': when, 'COMPLETED': 'N', 'DESCRIPTION': t.get('note') or '',
                'COMMUNICATIONS': [{'VALUE': '', 'ENTITY_TYPE_ID': 2, 'ENTITY_ID': int(bid)}], **({'RESPONSIBLE_ID': int(uid)} if uid else {})}})
        if done == 'Y':
            self.api.call('crm.activity.update', {'id': aid, 'fields': {'COMPLETED': 'Y'}})
        self.links.put('task', tid, aid, sent)

    # ---------------------------------------------------------------- из Битрикса
    def pull(self):
        conf = self.conf.get()
        since = conf.get('lastPull') or conf.get('since') or BitrixTime.now()
        try:
            t0 = datetime.fromisoformat(since) - timedelta(minutes=3)       # запас на разницу часов и запись в ту же секунду
        except ValueError:
            t0 = datetime.now(timezone.utc).astimezone() - timedelta(hours=1)
        R = self.R
        res = {'pulled': 0, 'created': 0, 'tasks': 0, 'skipped': 0}
        last = since
        if not R.can('deal', 'in') and not R.can('deal', 'out'):
            self.conf.mark(lastPull=last, lastRun=Val.now())
            return res
        deals = []
        for cat in R.pull_cats():             # воронки обмена: основная, отмеченные и воронки менеджеров
            flt = {'CATEGORY_ID': int(cat), '>DATE_MODIFY': t0.isoformat(timespec='seconds')}
            deals += self.api.list('crm.deal.list', {'filter': flt, 'select': ['*'], 'order': {'DATE_MODIFY': 'ASC'}}, limit=2000)
        for b in sorted(deals, key=lambda x: str(x.get('DATE_MODIFY') or '')):
            last = max(last, str(b.get('DATE_MODIFY') or ''))
            did = self.links.local('deal', b.get('ID'))
            if did:
                d = DealBook(self.store).get(did)
                ln = self.links.get('deal', did)
                if d and ln:
                    cat = str(b.get('CATEGORY_ID') or ln['sent'].get('cat') or R.category())
                    ours = self._ours(d, [])
                    ours['stage'] = self._stage_of(d['stage'], cat) or ''
                    agreed, upd, back = self._merge(d, ours, self._theirs(b), ln['sent'], BitrixTime.local(b.get('DATE_MODIFY')))
                    agreed['cat'] = cat
                    if back and R.can('deal', 'in', d.get('managerId')):
                        self._apply(d, back, b, ln['sent'])
                        res['pulled'] += 1
                    self._pull_sum(d, b)
                    self.links.put('deal', did, b['ID'], agreed)
                    if upd and R.can('deal', 'out', d.get('managerId')):
                        BitrixQueue.touch(self.store, 'deal', did)
            elif str(b.get('DATE_CREATE') or '') >= str(conf.get('since') or ''):
                mid = self._who(b)
                if mid is None:
                    res['skipped'] += 1
                    continue
                self._new_deal(b, mid)
                res['created'] += 1
        res['tasks'] = self._pull_tasks(t0)
        self.conf.mark(lastPull=last, lastRun=Val.now())
        return res

    def _who(self, b):
        """Менеджер новой сделки Битрикса: сопоставленный ответственный (если у него загрузка из Битрикса), иначе — по правилу
        «сделки без сопоставленного ответственного»; None — сделку не загружать."""
        R = self.R
        if not R.can('deal', 'in'):
            return None
        mid = self._mid_of(b.get('ASSIGNED_BY_ID'))
        if mid:
            return mid if R.can('deal', 'in', mid) else None
        fb = R.fallback()
        if fb == 'skip':
            return None
        return fb if fb and R.can('deal', 'in', fb) else ''

    def _pull_sum(self, d, b):
        """Сумма из Битрикса: по умолчанию — только у сделки без КП (с КП сумма из программы); правило поля «из Битрикса» —
        всегда; «не передавать» — никогда."""
        x = self.R.field('sum')['dir']
        if x == 'off' or not self.R.can('deal', 'in', d.get('managerId')):
            return
        if x != 'in' and self.store.one('SELECT 1 FROM deal_kp WHERE deal_id=? LIMIT 1', (d['id'],)):
            return
        try:
            rub = float(b.get('OPPORTUNITY') or 0)
        except (TypeError, ValueError):
            return
        if int(round(rub * 100)) == int(d.get('sum') or 0):
            return
        BitrixQueue._quiet.on = True
        try:
            DealBook(self.store).update(d['id'], {'sum': rub}, self.WHO)
        finally:
            BitrixQueue._quiet.on = False

    def _new_deal(self, b, mid=None, flag=True):
        """Новая сделка воронки обмена Битрикса → сделка программы у ответственного (mid — по правилам, _who)."""
        cl = self._company_info(b.get('COMPANY_ID'))
        mid = (self._mid_of(b.get('ASSIGNED_BY_ID')) or '') if mid is None else mid
        m = next((x for x in self._managers() if x['id'] == mid), {})
        key = self._key_of(b.get('STAGE_ID'), b.get('STAGE_SEMANTIC_ID') or '', str(b.get('CATEGORY_ID') or '') or None) or Stages.keys(self.store)[0]
        body = {'title': b.get('TITLE') or cl.get('name') or 'Сделка из Битрикс24', 'client': cl.get('name') or '', 'clientInn': cl.get('inn') or '',
                'expected': BitrixTime.day(b.get('CLOSEDATE')), 'note': b.get('COMMENTS') or '', 'stage': key}
        if key == 'lost':
            body['lostReason'] = 'Проиграно в Битрикс24'
        if b.get('OPPORTUNITY'):
            body['sum'] = b['OPPORTUNITY']
        BitrixQueue._quiet.on = True
        try:
            d = DealBook(self.store).create(body, mid, m.get('name') or '', self.WHO)
        finally:
            BitrixQueue._quiet.on = False
        self.links.put('deal', d['id'], b['ID'], dict(self._theirs(b), cat=str(b.get('CATEGORY_ID') or '0')))
        if flag:
            DealBook(self.store).flag(d['id'], bxNew=True)      # в кабинете — «Новые сделки из Битрикс24», пока ответственный не откроет
        if cl.get('company') and cl.get('inn'):
            self.links.put('company', cl['inn'], cl['company'])
        self.log.add('Новая сделка из Битрикс24 «%s» → кабинет%s' % (body['title'], ' (%s)' % m['name'] if m else ' (ответственный не сопоставлен)'), mid=mid)
        return d

    def _company_info(self, cid):
        """Компания Битрикса: название, ИНН; контакты и адрес — в справочник клиентов программы (без дублей)."""
        if not cid or str(cid) == '0':
            return {}
        c = self.api.call('crm.company.get', {'id': cid}) or {}
        rq = self.api.list('crm.requisite.list', {'filter': {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': cid}, 'select': ['ID', 'RQ_INN', 'RQ_KPP', 'RQ_OGRN']}, limit=3)
        inn = re.sub(r'\D', '', str((rq[0] if rq else {}).get('RQ_INN') or ''))
        out = {'company': str(cid), 'name': c.get('TITLE') or '', 'inn': inn}
        if inn and self.R.can('company', 'in'):             # компании и контакты из Битрикса — в справочник клиентов
            self._merge_client(inn, c, rq[0])
        return out

    def _merge_client(self, inn, c, rq):
        doc = self._client(inn, '')
        new = not doc
        doc = dict(doc) if doc else {'id': 'inn' + inn, 'name': c.get('TITLE') or '', 'inn': inn, 'kpp': rq.get('RQ_KPP') or '',
                                     'ogrn': rq.get('RQ_OGRN') or '', 'source': 'Битрикс24'}
        doc.pop('_rev', None)
        cons = [x for x in (doc.get('contacts') or []) if isinstance(x, dict)]
        have = {str(x.get('phone') or '') for x in cons} | {str(x.get('email') or '').lower() for x in cons}
        changed = new
        take = self.R.allow(self.R.company()['contacts'], 'in')
        for ph in (c.get('PHONE') or [])[:5] if take else []:
            v = str(ph.get('VALUE') or '')
            if v and v not in have:
                cons.append({'name': c.get('TITLE') or 'Телефон', 'phone': v})
                have.add(v)
                changed = True
        for em in (c.get('EMAIL') or [])[:5] if take else []:
            v = str(em.get('VALUE') or '')
            if v and v.lower() not in have:
                cons.append({'name': c.get('TITLE') or 'Почта', 'email': v})
                have.add(v.lower())
                changed = True
        if changed:
            doc['contacts'] = cons[:30]
            self.store.client_put(doc.get('id') or 'inn' + inn, doc, self.WHO)

    def _pull_tasks(self, t0):
        if not self.R.can('task', 'in'):
            return 0
        T = self.R.tasks()
        rows = self.api.list('crm.activity.list', {'filter': {'OWNER_TYPE_ID': 2, '>LAST_UPDATED': t0.isoformat(timespec='seconds')},
                                                   'select': ['ID', 'OWNER_ID', 'SUBJECT', 'DEADLINE', 'COMPLETED', 'TYPE_ID', 'RESPONSIBLE_ID', 'DESCRIPTION', 'PROVIDER_ID']},
                             limit=2000)
        tb, n = TaskBook(self.store), 0
        for a in rows:
            did = self.links.local('deal', a.get('OWNER_ID'))
            if not did:
                continue
            dm = (DealBook(self.store).get(did) or {}).get('managerId')
            if not self.R.can('task', 'in', self._mid_of(a.get('RESPONSIBLE_ID')) or dm):
                continue
            subj = str(a.get('SUBJECT') or '').strip()
            cancel = subj.startswith('Отменено — ')
            subj = subj[len('Отменено — '):] if cancel else subj
            kind = next((k for k, lb in self.KIND.items() if subj.startswith(lb + ': ')), None)
            title = subj[len(self.KIND[kind]) + 2:] if kind else subj
            if not kind and not T['other'] and not self.links.local('task', a.get('ID')):
                continue                        # дела Битрикса, заведённые не программой, — по правилу не загружать
            kind = kind or {'1': 'meet', '2': 'call', '4': 'mail'}.get(str(a.get('TYPE_ID')), 'task')
            if T['kinds'].get(kind) == 'off':
                continue
            due = BitrixTime.local(a.get('DEADLINE')) or Val.now()
            tm = due[11:16] if due[11:16] not in ('', '00:00', '18:00') else ''
            state = 'cancel' if cancel else ('done' if a.get('COMPLETED') == 'Y' else 'open')
            body = {'kind': kind, 'title': title[:200], 'due': due[:10], 'time': tm, 'note': str(a.get('DESCRIPTION') or '')[:1000], 'state': state}
            when = '%sT%s:00' % (body['due'], tm or '18:00')
            sent = {'subj': str(a.get('SUBJECT') or '').strip(), 'when': when, 'done': 'Y' if state != 'open' else 'N'}
            tid = self.links.local('task', a.get('ID'))
            if tid:
                ln = self.links.get('task', tid)
                if ln and ln['sent'].get('subj') == sent['subj'] and ln['sent'].get('done') == sent['done'] and ln['sent'].get('when', '')[:16] == when[:16]:
                    continue                    # своё же дело вернулось без изменений
                cur = tb.get(int(tid))
                if cur:
                    tb.update(int(tid), {k: v for k, v in body.items() if k != 'kind' or kind})
                    self.links.put('task', tid, a['ID'], sent)
                    n += 1
                continue
            d = DealBook(self.store).get(did) or {}
            mid = self._mid_of(a.get('RESPONSIBLE_ID')) or d.get('managerId') or ''
            t = tb.add(dict(body), mid, self.WHO, did)
            if state != 'open':
                tb.update(t['id'], {'state': state})
            self.links.put('task', t['id'], a['ID'], sent)
            n += 1
        return n

    # ---------------------------------------------------------------- для карточки сделки
    def card(self, did):
        ln = self.links.get('deal', did)
        if not ln:
            q = self.store.one("SELECT error FROM bx_queue WHERE kind='deal' AND local_id=?", (did,))
            return {'queued': True, 'error': q[0] or ''} if q else None
        portal = self.conf.get().get('portal') or ''
        return {'id': ln['bx'], 'at': ln['at'], 'url': '%s/crm/deal/details/%s/' % (portal, ln['bx']) if portal else ''}


class BitrixDryApi:
    """Пробный прогон: чтение — из настоящего Битрикса, запись — только описанием «что было бы сделано»."""
    WRITE = re.compile(r'\.(add|update|set|delete)$')
    FAKE = 900000000
    NAMES = {'TITLE': 'название', 'STAGE_ID': 'стадия', 'CLOSEDATE': 'ожидаемая дата', 'ASSIGNED_BY_ID': 'ответственный', 'COMMENTS': 'комментарий',
             'OPPORTUNITY': 'сумма', 'COMPANY_ID': 'компания', 'CATEGORY_ID': 'воронка'}

    def __init__(self, api, labels=None):
        self.api, self.rec, self.n = api, [], 0
        self.host = api.host
        self.labels = labels or {}

    def list(self, method, params=None, limit=5000):
        return self.api.list(method, params, limit)

    def call(self, method, params=None):
        if not self.WRITE.search(method):
            return self.api.call(method, params)
        self.n += 1
        self.rec.append(self.say(method, params or {}))
        i = self.FAKE + self.n
        return {'id': i} if method.endswith('todo.add') else True if method.endswith(('.update', '.set', '.delete')) else i

    def say(self, m, p):
        f = p.get('fields') or {}
        name = lambda k: self.NAMES.get(k) or self.labels.get(k) or k
        if m == 'crm.deal.add':
            return 'Создать сделку «%s»' % (f.get('TITLE') or '') + (': ' + ', '.join(name(k) for k in f if k in self.NAMES or k in self.labels) if f else '')
        if m == 'crm.deal.update':
            return 'Сделка %s: изменить — %s' % (p.get('id'), ', '.join(name(k) for k in f) or 'ничего')
        if m == 'crm.deal.productrows.set':
            return 'Сделка %s: товары — %d стр.' % (p.get('id'), len(p.get('rows') or []))
        if m == 'crm.timeline.comment.add':
            fl = f.get('FILES') or [['']]
            return 'Сделка %s: файл «%s»' % (f.get('ENTITY_ID'), fl[0][0])
        if m == 'crm.company.add':
            return 'Создать компанию «%s»' % (f.get('TITLE') or '')
        if m == 'crm.requisite.add':
            return 'Реквизиты компании (ИНН %s)' % (f.get('RQ_INN') or '—')
        if m == 'crm.contact.add':
            return 'Создать контакт «%s»' % ' '.join(x for x in (f.get('LAST_NAME'), f.get('NAME')) if x)
        if m in ('crm.activity.todo.add', 'crm.activity.add'):
            return 'Дело «%s»' % (p.get('title') or f.get('SUBJECT') or '')
        if m == 'crm.activity.update':
            return 'Дело %s: изменить — %s' % (p.get('id'), ', '.join({'SUBJECT': 'тема', 'DEADLINE': 'срок', 'COMPLETED': 'выполнено'}.get(k, k.lower()) for k in f if k != 'END_TIME'))
        if m == 'crm.address.add':
            return 'Адрес компании'
        if m == 'crm.deal.userfield.add':
            return 'Создать поле сделки «%s»' % (f.get('EDIT_FORM_LABEL') or f.get('FIELD_NAME'))
        return m


class BitrixDry:
    """«Пробный прогон» в «Настройках»: обмен по текущим правилам на копии базы, в Битрикс ничего не пишется —
    → что изменилось бы в Битриксе и в программе. Рабочая база и Битрикс не меняются."""

    def __init__(self, store, opener=None):
        self.store, self.opener = store, opener

    def run(self):
        import shutil
        import tempfile
        from storage import Store
        tmp = tempfile.mkdtemp(prefix='kp-bxdry-')
        st2 = None
        try:
            dst = os.path.join(tmp, 'dry.sqlite3')
            self.store.backup(dst)
            st2 = Store(dst)
            real = BitrixSync(self.store, self.opener)
            labels = {x['bx']: x['label'] for x in real.R.view()['fields'].values()}
            s = BitrixSync(st2, self.opener, files=real._kp_files)
            s._api = BitrixDryApi(real.api, labels)
            i0 = BitrixLog(st2).last_id()
            res = s.run(manual=True)
            log = BitrixLog(st2).since(i0)
            prog = [x['text'] for x in log if '←' in x['text'] or x['text'].startswith('Новая сделка')]
            return {'result': res, 'bitrix': s._api.rec[:500], 'program': prog[:500], 'errors': [x['text'] for x in log if x['level'] == 'error'][:50],
                    'more': max(0, len(s._api.rec) - 500)}
        finally:
            if st2 is not None:
                try:
                    st2.conn().close()
                except Exception:
                    pass
            shutil.rmtree(tmp, ignore_errors=True)


class BitrixImport:
    """Сделки Битрикса, созданные до включения связи (новые приходят сами), — с даты, по воронкам обмена: предпросмотр (что будет:
    новая сделка в программе / связать с открытой сделкой того же клиента по ИНН / пропустить), затем загрузка отмеченных."""
    MAX = 500

    def __init__(self, store, opener=None):
        self.store, self.sync = store, BitrixSync(store, opener)

    def preview(self, since, cats=None):
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(since or '')):
            raise ValueError('Дата — ГГГГ-ММ-ДД')
        s, R = self.sync, self.sync.R
        allowed = R.pull_cats()
        cats = [str(c) for c in (cats or allowed) if str(c) in allowed] or allowed
        until = str(s.conf.get().get('since') or BitrixTime.now())
        rows = []
        for cat in cats:
            rows += s.api.list('crm.deal.list', {'filter': {'CATEGORY_ID': int(cat), '>DATE_CREATE': since + 'T00:00:00'},
                                                 'select': ['ID', 'TITLE', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID', 'OPPORTUNITY', 'ASSIGNED_BY_ID',
                                                            'COMPANY_ID', 'DATE_CREATE', 'CLOSEDATE', 'COMMENTS'], 'order': {'DATE_CREATE': 'ASC'}}, limit=self.MAX * 2)
        rows = [b for b in rows if str(b.get('DATE_CREATE') or '') < until and not s.links.local('deal', b.get('ID'))][:self.MAX]
        inns = self._inns([b.get('COMPANY_ID') for b in rows])
        mg = {m['id']: m['name'] for m in s._managers()}
        labels = {x['key']: x['label'] for x in Stages.all(self.store)}
        out = []
        for b in rows:
            mid = s._who(b)
            inn = inns.get(str(b.get('COMPANY_ID') or ''), '')
            key = s._key_of(b.get('STAGE_ID'), b.get('STAGE_SEMANTIC_ID') or '', str(b.get('CATEGORY_ID') or '') or None)
            item = {'id': str(b['ID']), 'title': b.get('TITLE') or '', 'created': BitrixTime.day(b.get('DATE_CREATE')), 'sum': b.get('OPPORTUNITY') or '',
                    'stage': labels.get(key, '—'), 'manager': mg.get(mid or '', '—'), 'inn': inn}
            if mid is None:
                item.update(act='skip', why='ответственный не участвует в загрузке из Битрикса')
            else:
                same = self._open_unlinked(inn) if inn else []
                if len(same) == 1:
                    item.update(act='link', deal=same[0]['id'], why='сделка № %s того же клиента (ИНН %s)' % (same[0].get('number'), inn))
                else:
                    item.update(act='new', why='новая сделка в программе' + (' (у клиента несколько открытых сделок — не связываю)' if len(same) > 1 else ''))
            out.append(item)
        return {'items': out, 'cats': cats, 'until': until[:10], 'max': self.MAX}

    def _inns(self, cids):
        ids = sorted({str(c) for c in cids if c and str(c) != '0'})
        out = {}
        for i in range(0, len(ids), 50):
            for r in self.sync.api.list('crm.requisite.list', {'filter': {'ENTITY_TYPE_ID': 4, 'ENTITY_ID': ids[i:i + 50]}, 'select': ['ENTITY_ID', 'RQ_INN']}, limit=200):
                inn = re.sub(r'\D', '', str(r.get('RQ_INN') or ''))
                if inn:
                    out.setdefault(str(r.get('ENTITY_ID')), inn)
        return out

    def _open_unlinked(self, inn):
        out = []
        for (did,) in self.store.all("SELECT id FROM deals WHERE stage NOT IN ('won', 'lost')"):
            d = DealBook(self.store).get(did) or {}
            if re.sub(r'\D', '', str(d.get('clientInn') or '')) == inn and not self.sync.links.get('deal', did):
                out.append(d)
        return out

    def run(self, since, cats, ids):
        """Загрузить отмеченные (ids) из предпросмотра. → {created, linked, skipped}."""
        want = {str(i) for i in (ids or [])}
        pv = self.preview(since, cats)
        res = {'created': 0, 'linked': 0, 'skipped': 0}
        s = self.sync
        for it in pv['items']:
            if it['id'] not in want:
                continue
            if it['act'] == 'skip':
                res['skipped'] += 1
                continue
            b = s.api.call('crm.deal.get', {'id': it['id']}) or {}
            if not b or s.links.local('deal', it['id']):
                res['skipped'] += 1
                continue
            if it['act'] == 'link':
                s.links.put('deal', it['deal'], it['id'], dict(s._theirs(b), cat=str(b.get('CATEGORY_ID') or '0')))
                BitrixQueue.touch(self.store, 'deal', it['deal'])
                s.log.add('Сделка Битрикса %s «%s» связана со сделкой программы (%s)' % (it['id'], it['title'], it['why']))
                res['linked'] += 1
            else:
                s._new_deal(b, s._who(b) or '', flag=False)
                res['created'] += 1
        s.log.add('Загрузка сделок Битрикс24 с %s: новых %d, связано %d, пропущено %d' % (since, res['created'], res['linked'], res['skipped']))
        return res


class EconXlsx:
    """Excel экономики сделки последнего сохранения КП (собирается в браузере автора) — для ленты сделки в Битриксе."""
    FOLDER = 'kp_econ'
    MAX = 15 * 1024 * 1024

    def __init__(self, store):
        self.dir = os.path.join(os.path.dirname(os.path.abspath(store.path)), self.FOLDER)

    def _file(self, kid):
        if not re.match(r'^[A-Za-z0-9_-]{1,64}$', str(kid)):
            raise ValueError('Неверный номер КП')
        return os.path.join(self.dir, '%s.xlsx' % kid)

    def save(self, kid, data):
        if not data or len(data) > self.MAX:
            raise ValueError('Файл экономики пустой или больше 15 МБ')
        if not data.startswith(b'PK'):
            raise ValueError('Нужен файл Excel (.xlsx)')
        os.makedirs(self.dir, exist_ok=True)
        f = self._file(kid)
        with open(f + '.tmp', 'wb') as fh:
            fh.write(data)
        os.replace(f + '.tmp', f)

    def path(self, kid):
        try:
            f = self._file(kid)
        except ValueError:
            return None
        return f if os.path.isfile(f) else None


class BitrixDesk:
    """«Настройки → Подключения и ключи → Битрикс24» (/api/admin/bitrix…): только администратор, изменения — с CSRF."""

    def __init__(self, h, store, log_fn, opener=None):
        self.h, self.store, self.log_fn, self.opener = h, store, log_fn, opener

    def send(self, obj, code=200):
        return self.h.send(code, 'application/json; charset=utf-8', json.dumps(obj, ensure_ascii=False))

    def text(self, code, t):
        return self.h.send(code, 'text/plain; charset=utf-8', t)

    def body(self):
        try:
            d = json.loads(self.h.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            d = None
        return d if isinstance(d, dict) else {}

    def view(self):
        st = self.store
        return dict(BitrixConf(st).view(), queue=BitrixQueue(st).stats(), log=BitrixLog(st).tail(100), failed=BitrixQueue(st).failed(),
                    linked={'deals': BitrixLinks(st).count('deal'), 'companies': BitrixLinks(st).count('company'), 'tasks': BitrixLinks(st).count('task')},
                    stagesOur=Stages.all(st), managers=BitrixSync(st, self.opener)._managers())

    def route(self, m, sub, by):
        st = self.store
        if sub == 'bitrix' and m == 'GET':
            return self.send(self.view())
        if sub == 'bitrix' and m == 'POST':
            d = self.body()
            was = BitrixConf(st).get()
            try:
                new = BitrixConf(st).save(d, by)
            except (ValueError, BitrixError) as e:
                return self.text(400, str(e))
            info = {k: d[k] for k in ('on', 'category', 'pollSec', 'mode', 'fallback') if k in d}
            info.update({k: 'изменено' for k in ('flow', 'mgr', 'cats', 'stagesBy', 'fields', 'send', 'company', 'tasks', 'sched') if k in d})
            if 'url' in d:
                info['url'] = 'изменён' if d.get('url') else 'удалён'
            if 'stages' in d:
                info['stages'] = len(new.get('stages') or {})
            if 'users' in d:
                info['users'] = len(new.get('users') or {})
            self.log_fn('edit_settings', 'settings', 'bitrix', {k: was.get(k) for k in ('on', 'category') if k in info}, info)
            if new.get('on') and not was.get('on'):       # включили — открытые сделки программы уходят в Битрикс
                DealBook(st).adopt()
                for (did,) in st.all("SELECT id FROM deals WHERE stage NOT IN ('won', 'lost')"):
                    BitrixQueue.touch(st, 'deal', did)
            return self.send(self.view())
        if sub == 'bitrix/test' and m == 'POST':
            try:
                d = self.body()
                if d.get('category') is not None:
                    BitrixConf(st).save({'category': d['category']}, by)
                return self.send(BitrixSync(st, self.opener).check())
            except (BitrixError, ValueError) as e:
                return self.text(422, str(e))
        if sub == 'bitrix/run' and m == 'POST':
            res = BitrixSync(st, self.opener).run(manual=True)
            return self.send(dict(self.view(), result=res))
        if sub == 'bitrix/pull' and m == 'POST':          # «Загрузить из Битрикса сейчас» — без отправки очереди
            res = BitrixSync(st, self.opener).run(manual=True, push=False)
            return self.send(dict(self.view(), result=res))
        if sub == 'bitrix/push' and m == 'POST':          # «Выгрузить сделку № …» — сразу
            num = str(self.body().get('number') or '').strip()
            r = st.one("SELECT id FROM deals WHERE CAST(json_extract(doc, '$.number') AS TEXT)=?", (num,)) if num else None
            if not r:
                return self.text(404, 'Сделки с таким номером нет')
            BitrixQueue.touch(st, 'deal', r[0])
            if not st.one("SELECT 1 FROM bx_queue WHERE kind='deal' AND local_id=?", (r[0],)):
                return self.text(400, 'Связь выключена — сделка не отправлена')
            res = BitrixSync(st, self.opener).run(manual=True, pull=False)
            return self.send(dict(self.view(), result=res))
        if sub == 'bitrix/stages' and m == 'POST':        # стадии другой воронки — для соответствия этапов
            cat = str(self.body().get('category') or '0')
            if not re.match(r'^\d{1,9}$', cat):
                return self.text(400, 'Неверная воронка')
            try:
                return self.send({'category': cat, 'stages': BitrixSync(st, self.opener).stages_all(cat)})
            except BitrixError as e:
                return self.text(422, str(e))
        if sub == 'bitrix/dry' and m == 'POST':           # пробный прогон: ничего не записывается
            if not BitrixConf(st).on():
                return self.text(400, 'Сначала включите связь — пробный прогон идёт по её правилам')
            try:
                return self.send(BitrixDry(st, self.opener).run())
            except BitrixError as e:
                return self.text(422, str(e))
        if sub in ('bitrix/import/preview', 'bitrix/import') and m == 'POST':
            if not BitrixConf(st).on():
                return self.text(400, 'Сначала включите связь')
            d = self.body()
            cats = [str(x) for x in d.get('cats') or []] if isinstance(d.get('cats'), list) else None
            try:
                if sub == 'bitrix/import/preview':
                    return self.send(BitrixImport(st, self.opener).preview(d.get('from'), cats))
                ids = [str(x)[:20] for x in d.get('ids') or []][:BitrixImport.MAX] if isinstance(d.get('ids'), list) else []
                res = BitrixImport(st, self.opener).run(d.get('from'), cats, ids)
                self.log_fn('edit_settings', 'settings', 'bitrix', None, dict(res, importFrom=d.get('from')))
                return self.send(dict(self.view(), result=res))
            except ValueError as e:
                return self.text(400, str(e))
            except BitrixError as e:
                return self.text(422, str(e))
        if sub == 'bitrix/resend' and m == 'POST':
            body = self.body()
            what = body.get('what')
            if body.get('kind') in ('deal', 'task') and body.get('id'):        # «Повторить» у одной записи
                if not BitrixQueue(st).retry(body['kind'], str(body['id'])[:64]):
                    return self.text(404, 'Записи уже нет в очереди — она отправлена')
                return self.send(dict(self.view(), result=BitrixSync(st, self.opener).run(pull=False)))
            BitrixQueue(st).retry_all()
            n = 0
            if what == 'all':
                for (did,) in st.all('SELECT id FROM deals'):
                    BitrixQueue.touch(st, 'deal', did)
                    n += 1
            self.log_fn('edit_settings', 'settings', 'bitrix', None, {'resend': what or 'failed', 'deals': n})
            return self.send(dict(self.view(), queued=n))
        return self.text(404, 'not found')
