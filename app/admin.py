# -*- coding: utf-8 -*-
"""Админ-панель «Настройки»: пароль администратора, сессии, права, журнал действий, корзина, модерация правок,
резервные копии и статистика.

• Вход — логин и пароль администратора; администраторов может быть несколько (kv «admins»: логин, имя, хеш пароля).
  Пароль хранится только хешем (scrypt; если в Python нет scrypt — PBKDF2-SHA256). Прежний единственный пароль
  (kv «admin») при первом обращении переносится в учётную запись с логином «admin».
  Первая учётная запись создаётся на компьютере, где работает программа. Сброс: создать файл data/admin-reset.txt
  и перезапустить программу — все учётные записи администраторов удаляются, первую нужно создать заново.
• Сессия администратора — cookie kp_admin (HttpOnly, SameSite=Strict) + CSRF-токен в заголовке X-CSRF-Token
  для всех изменяющих запросов; 15 минут бездействия — выход. Неверный пароль 5 раз за 10 минут — пауза 10 минут.
• Удаление (КП, товары, менеджеры, клиенты) — только из «Настроек», в корзину (data хранится 30 дней, можно восстановить).
• Числа выше (бездействие, попытки входа, срок корзины, длина пароля, статистика) — «Настройки → Значения программы»
  (defaults.SrvVal: srv.adminIdleMin, srv.loginFails, srv.loginLockMin, srv.trashDays, srv.adminPwMin, srv.statTop…).
• Журнал действий (таблица audit): кто (менеджер из заголовков X-KP-User-Id / X-KP-User — обычные сотрудники
  не входят по паролю), что, над чем, до/после (только изменённые поля), IP, браузер, результат.
• Модерация правок товаров (kv «settings».productEditModeration): включена — правка товара сохраняется в
  pending_edits и ждёт решения администратора; выключена — пишется сразу, но всё равно попадает в журнал.
"""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import threading
import time
import urllib.parse
from datetime import datetime, timedelta

import auth_users
from config import BadRequest
from defaults import SrvVal
from storage import Conflict

DENIED = 'Удаление и настройки — только в разделе «Настройки» (нужен пароль администратора)'
# поля товара, которые меняет само сохранение КП (цены и история): такие правки не модерируются
AUTO_KEYS = {'price', 'priceCur', 'cost', 'costCur', 'margin', 'mmode', 'prices', 'updatedAt', 'pricesCount'}
LABELS = {'name': 'Наименование', 'spec': 'Краткие характеристики', 'price': 'Цена', 'priceCur': 'Валюта цены', 'cost': 'Закупка',
          'costCur': 'Валюта закупки', 'pageTitle': 'Заголовок страницы', 'photoCaption': 'Подпись к фото', 'features': 'Описание',
          'groups': 'Характеристики', 'hint': 'Титул', 'attrs': 'Параметры и категория', 'photo': 'Главное фото', 'logo': 'Логотип',
          'gallery': 'Изображения', 'options': 'Опции', 'prices': 'История цен'}


def _now():
    return datetime.now().isoformat(timespec='seconds')


# ---------------------------------------------------------------- пароль
def hash_password(pw):
    salt = secrets.token_bytes(16)
    if hasattr(hashlib, 'scrypt'):
        h = hashlib.scrypt(pw.encode('utf-8'), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
        return {'algo': 'scrypt', 'n': 2 ** 14, 'r': 8, 'p': 1, 'salt': salt.hex(), 'hash': h.hex(), 'updatedAt': _now()}
    h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, 310000)
    return {'algo': 'pbkdf2', 'iter': 310000, 'salt': salt.hex(), 'hash': h.hex(), 'updatedAt': _now()}


def verify_password(pw, rec):
    try:
        salt = bytes.fromhex(rec['salt'])
        if rec['algo'] == 'scrypt':
            h = hashlib.scrypt(pw.encode('utf-8'), salt=salt, n=rec['n'], r=rec['r'], p=rec['p'], dklen=32)
        else:
            h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, rec['iter'])
        return hmac.compare_digest(h.hex(), rec['hash'])
    except Exception:
        return False


LOGIN_RE = re.compile(r'^[A-Za-z0-9А-Яа-яЁё._@-]{2,40}$')


def accounts(store):
    """Учётные записи администраторов [{login, name, pw, created, by, lastLogin}] (с переносом прежнего пароля)."""
    rec = store.kv_get('admins')
    if rec is None:
        old = store.kv_get('admin')
        rec = {'users': [{'login': 'admin', 'name': 'Администратор', 'pw': old, 'created': _now(), 'by': 'перенос'}] if old else []}
        if old:
            store.kv_set('admins', rec)
            store.write("DELETE FROM kv WHERE key='admin'")
    return rec.get('users') or []


def save_accounts(store, users):
    store.kv_set('admins', {'users': users})


def find_account(users, login):
    lo = (login or '').strip().lower()
    return next((u for u in users if u['login'].lower() == lo), None)


def check_login(login):
    if not LOGIN_RE.match(login or ''):
        raise ValueError('Логин — от 2 до 40 символов: буквы, цифры, точка, дефис, @')


def public_account(u):
    return {k: u.get(k) for k in ('login', 'name', 'created', 'by', 'lastLogin')}


def check_new_password(pw):
    n = SrvVal.now('srv.adminPwMin')
    if len(pw or '') < n:
        raise ValueError('Пароль — не короче %d символов' % n)
    if not (re.search(r'\d', pw) and re.search(r'[^\d]', pw)):
        raise ValueError('В пароле нужны и буквы, и цифры')


# ---------------------------------------------------------------- сессии и попытки входа
LOCK = threading.RLock()


class AdminSessions:
    """Сессии администраторов «Настроек»: в памяти и в базе (kv adminSessions — хеш токена, а не сам токен), поэтому
    перезапуск программы (обновление, «Перезапустить») не выводит администратора из «Настроек». 15 минут бездействия —
    сессия закрывается; время последнего действия записывается в базу не чаще раза в минуту. При загрузке из базы
    сессии удалённых учётных записей не восстанавливаются."""
    KV = 'adminSessions'
    SAVE_EVERY = 60
    FIELDS = ('csrf', 'last', 'ip', 'login', 'name')
    items = None          # {хеш токена: {csrf, last, ip, login, name, saved}}

    @staticmethod
    def key(tok):
        return hashlib.sha256(tok.encode('utf-8')).hexdigest() if tok else ''

    @staticmethod
    def _store():
        from config import store
        return store()

    @classmethod
    def _all(cls):
        if cls.items is None:
            st, now = cls._store(), time.time()
            idle = SrvVal.get(st, 'srv.adminIdleMin') * 60
            logins = {u['login'].lower() for u in accounts(st)}
            raw = st.kv_get(cls.KV) or {}
            cls.items = {k: dict(v, saved=v.get('last', 0)) for k, v in (raw.items() if isinstance(raw, dict) else [])
                         if isinstance(v, dict) and now - float(v.get('last') or 0) <= idle
                         and (not v.get('login') or v['login'].lower() in logins)}
        return cls.items

    @classmethod
    def _save(cls):
        cls._store().kv_set(cls.KV, {k: {f: v.get(f) for f in cls.FIELDS} for k, v in cls.items.items()})
        for v in cls.items.values():
            v['saved'] = v['last']

    @classmethod
    def get(cls, tok, touch=True):
        """Действующая сессия по токену из cookie или None."""
        if not tok:
            return None
        k = cls.key(tok)
        with LOCK:
            s = cls._all().get(k)
            if not s:
                return None
            now = time.time()
            if now - s['last'] > SrvVal.get(cls._store(), 'srv.adminIdleMin') * 60:
                cls.items.pop(k, None)
                cls._save()
                return None
            if touch:
                s['last'] = now
                if now - s.get('saved', 0) > cls.SAVE_EVERY:
                    cls._save()
            return s

    @classmethod
    def start(cls, h, user=None):
        tok, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        with LOCK:
            cls._all()[cls.key(tok)] = {'csrf': csrf, 'last': time.time(), 'ip': _ip(h), 'login': (user or {}).get('login', ''),
                                        'name': (user or {}).get('name') or (user or {}).get('login') or 'Администратор'}
            cls._save()
        return tok, csrf

    @classmethod
    def drop(cls, tok):
        with LOCK:
            if cls._all().pop(cls.key(tok), None) is not None:
                cls._save()

    @classmethod
    def drop_login(cls, login, keep=''):
        """Закрыть сессии учётной записи (удалена, сменён пароль), кроме сессии с токеном keep."""
        lo, kk = (login or '').lower(), cls.key(keep)
        with LOCK:
            gone = [k for k, s in cls._all().items() if s.get('login', '').lower() == lo and k != kk]
            for k in gone:
                cls.items.pop(k, None)
            if gone:
                cls._save()

    @classmethod
    def rename(cls, old, login, name):
        with LOCK:
            for s in cls._all().values():
                if s.get('login', '').lower() == (old or '').lower():
                    s['login'], s['name'] = login, name
            cls._save()

    @classmethod
    def reset(cls, store):
        """Учётные записи сброшены (data/admin-reset.txt) — все сессии закрыты."""
        store.kv_set(cls.KV, {})
        with LOCK:
            cls.items = None


def _cookie_token(h):
    for part in (h.headers.get('Cookie') or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == 'kp_admin':
            return v
    return ''


def session(h, touch=True):
    """Действующая сессия администратора или None (по cookie; 15 минут бездействия — сессия закрывается)."""
    return AdminSessions.get(_cookie_token(h), touch)


def is_admin(h, need_csrf=True):
    s = session(h)
    if not s:
        return False
    return not need_csrf or hmac.compare_digest((h.headers.get('X-CSRF-Token') or '').encode('utf-8'), str(s['csrf']).encode('utf-8'))


class LoginGuard:
    """Защита входа от подбора паролей (менеджеры и администраторы): неверные попытки считаются по адресу компьютера.
    srv.loginFails ошибок подряд (без перерыва дольше srv.loginLockMin мин) — вход с этого адреса закрыт на srv.loginLockMin
    минут после последней ошибки. Ответ говорит, сколько ждать (заголовок Retry-After) и сколько попыток осталось, но не
    говорит, есть ли такой логин: неизвестный логин проверяется по «пустому» хешу — время ответа то же."""
    FAILS = {}
    WRONG = 'Неверный логин или пароль'
    _dummy = None

    @classmethod
    def _limits(cls):
        return SrvVal.now('srv.loginLockMin') * 60, SrvVal.now('srv.loginFails')

    @classmethod
    def _tries(cls, ip):
        """Неверные попытки с адреса (старые — забываются)."""
        now = time.time()
        window = cls._limits()[0]
        with LOCK:
            for k in [k for k, v in cls.FAILS.items() if not v or now - v[-1] >= window]:
                del cls.FAILS[k]
            return list(cls.FAILS.get(ip, []))

    @classmethod
    def ok(cls, ip):
        """Верный вход или смена пароля: прежние ошибки с этого адреса забываются (иначе одна опечатка позже закрывала
        бы вход сразу на всю паузу)."""
        with LOCK:
            cls.FAILS.pop(ip, None)

    @classmethod
    def left(cls, ip):
        """Сколько секунд вход с адреса ещё закрыт; 0 — открыт."""
        window, limit = cls._limits()
        v = cls._tries(ip)
        return max(1, math.ceil(v[-1] + window - time.time())) if len(v) >= limit else 0

    @classmethod
    def verify(cls, pw, rec):
        """Пароль подходит к хешу; нет хеша (нет такого логина) — та же работа впустую и False."""
        if not rec:
            if cls._dummy is None:
                cls._dummy = hash_password(secrets.token_hex(8))
            verify_password(str(pw or ''), cls._dummy)
            return False
        return verify_password(str(pw or ''), rec)

    @staticmethod
    def wait_text(sec):
        return '%d мин' % math.ceil(sec / 60) if sec > 30 else '%d с' % sec

    @classmethod
    def refuse(cls, h, sec):
        """429: вход закрыт — сколько ждать."""
        return h.send(429, 'text/plain; charset=utf-8', 'Слишком много неверных попыток — вход с этого компьютера снова через %s'
                      % cls.wait_text(sec), {'Retry-After': str(sec)})

    @classmethod
    def wrong(cls, h, ip, text=None):
        """Неверный логин или пароль (text — свой текст, например «Текущий пароль указан неверно» при смене пароля):
        попытка засчитана; последняя — сразу 429, предпоследние — сколько осталось."""
        text = text or cls.WRONG
        with LOCK:
            cls.FAILS.setdefault(ip, []).append(time.time())
        sec = cls.left(ip)
        if sec:
            return h.send(429, 'text/plain; charset=utf-8', '%s. Вход с этого компьютера закрыт на %s' % (text, cls.wait_text(sec)),
                          {'Retry-After': str(sec)})
        rest = cls._limits()[1] - len(cls._tries(ip))
        return h.send(403, 'text/plain; charset=utf-8', text + ('. Осталось попыток: %d' % rest if rest <= 2 else ''))


# ---------------------------------------------------------------- журнал действий
def _ip(h):
    return (h.client_address or ('',))[0]


def actor(h, admin=None):
    """Кто действует: администратор (по сессии) или менеджер, выбранный в программе (заголовки запроса)."""
    s = session(h, touch=False)
    if admin is None:
        admin = s is not None
    uid = urllib.parse.unquote(h.headers.get('X-KP-User-Id') or '')[:64]
    name = urllib.parse.unquote(h.headers.get('X-KP-User') or '')[:120]
    u = getattr(h, '_kp_user', None)
    if u and not (admin and s):                       # вход по паролю включён — кто работает, знает сервер
        return u['id'], u['name'], 'user'
    if admin and s:                                   # действия в «Настройках» — от имени вошедшего администратора
        return 'admin:' + s.get('login', ''), s.get('name') or 'Администратор', 'admin'
    return uid or None, name or ('Администратор' if admin else 'Не выбран'), 'admin' if admin else 'user'


# ---------- «Экономика сделки»: только автору КП и администратору ----------
# Автор — authorId в состоянии/описании КП (у КП прежних версий — менеджер КП). Пользователь — подпись запроса
# (менеджер, выбранный на устройстве): это не вход по паролю, а защита от случайного просмотра; администратор видит всё.
DEAL_KEYS_STATE = ('deal',)
DEAL_KEYS_META = ('deal', 'econ')


def login_on(h):
    """Вход менеджеров по паролю включён и запрос — не от администратора: права проверяются."""
    return bool(getattr(h, '_kp_login', False)) and session(h, touch=False) is None


def perm(h, key):
    if not login_on(h):
        return True
    u = getattr(h, '_kp_user', None)
    return bool(u and u['perms'].get(key))


def own_kp(h, doc):
    u = getattr(h, '_kp_user', None) or {}
    author = (doc or {}).get('authorId') or (doc or {}).get('managerId')
    if author:
        return author == u.get('id')
    m = str((doc or {}).get('manager') or '').strip().lower()
    return not m or m == str(u.get('name') or '').strip().lower()


def kp_access(h, store, kid):
    """Открыть / сохранить КП: своё — всегда, чужое — с правом «КП других менеджеров»; нового КП ещё нет — можно.
    КП в корзине — только администратору: его версии и документы ждут восстановления, а запись под тем же номером
    сделала бы восстановление невозможным. Описания нет, а версии есть — права по описанию последней версии."""
    meta = _loads(store.kp_get(kid, 'meta')) or _loads(store.kp_get(kid, 'state'))
    if not meta and store.kp_trashed(kid):
        return session(h, touch=False) is not None
    if not login_on(h):
        return True
    meta = meta or _loads(store.kp_last_version_meta(kid))
    return not meta or own_kp(h, meta) or perm(h, 'kpOthers')


def deal_allowed(h, doc):
    if session(h, touch=False) is not None:
        return True
    if login_on(h):
        return perm(h, 'dealView') and (own_kp(h, doc) or perm(h, 'kpOthers'))
    uid, name, _ = actor(h, admin=False)
    author = (doc or {}).get('authorId') or (doc or {}).get('managerId')
    if author:
        return bool(uid) and uid == author
    m = str((doc or {}).get('manager') or '').strip().lower()      # описание КП прежней версии — по имени автора
    return not m or (name or '').strip().lower() == m


def kp_out(h, field, text):
    """Состояние или описание КП для ответа: экономику чужого КП убираем."""
    if not text or field not in ('state', 'meta'):
        return text
    try:
        doc = json.loads(text)
    except ValueError:
        return text
    if deal_allowed(h, doc):
        return text
    for k in (DEAL_KEYS_STATE if field == 'state' else DEAL_KEYS_META):
        doc.pop(k, None)
    doc['locked'] = True
    return json.dumps(doc, ensure_ascii=False)


class KpManagerLock:
    """Вход по паролю: менеджер в КП — только вошедший (код, ФИО, должность и контакты — из его карточки справочника);
    подставить другого менеджера нельзя ни из интерфейса, ни запросом. Администратор («Настройки») — без ограничения."""
    CONTACTS = ('name', 'position', 'phone', 'ext', 'mobile', 'email')

    @classmethod
    def apply(cls, h, store, field, text):
        u = getattr(h, '_kp_user', None)
        if not (login_on(h) and u) or session(h, touch=False) is not None:
            return text
        try:
            d = json.loads(text)
        except ValueError:
            return text
        if not isinstance(d, dict):
            return text
        card = next((x for x in (_loads(store.managers_list()) or []) if x.get('id') == u['id']), None) or {'name': u.get('name') or ''}
        d['managerId'] = u['id']
        if field == 'meta':
            d['manager'], d['managerPost'] = card.get('name') or '', card.get('position') or ''
        else:
            mg = d.get('manager') if isinstance(d.get('manager'), dict) else {}
            d['manager'] = dict(mg, **{k: str(card.get(k) or '') for k in cls.CONTACTS})
        return json.dumps(d, ensure_ascii=False)


def kp_in(h, store, kid, field, text):
    """Сохранение КП не автором: расчёт экономики и автор остаются прежними (их не видно — значит, и не затереть).
    При входе по паролю менеджер в КП — вошедший (KpManagerLock)."""
    if field not in ('state', 'meta'):
        return text
    text = KpManagerLock.apply(h, store, field, text)
    old = store.kp_get(kid, field)
    if not old:
        u = getattr(h, '_kp_user', None)
        if login_on(h) and u:            # новое КП при входе по паролю: автор — вошедший менеджер, а не подпись браузера
            try:
                n = json.loads(text)
                if isinstance(n, dict):
                    n['authorId'] = u['id']
                    return json.dumps(n, ensure_ascii=False)
            except ValueError:
                pass
        return text
    try:
        o, n = json.loads(old), json.loads(text)
    except ValueError:
        return text
    if not isinstance(n, dict) or not isinstance(o, dict):
        return text
    u = getattr(h, '_kp_user', None)
    if login_on(h) and u and session(h, touch=False) is None and o.get('authorId'):
        n['authorId'] = o['authorId']           # автор КП не меняется запросом менеджера («передать» КП коллеге нельзя)
        text = json.dumps(n, ensure_ascii=False)
    if deal_allowed(h, o):
        return text
    for k in (DEAL_KEYS_STATE if field == 'state' else ('deal',)) + ('authorId',):
        if k in o:
            n[k] = o[k]
        else:
            n.pop(k, None)
    n.pop('locked', None)
    return json.dumps(n, ensure_ascii=False)


def _jround(x):
    return int(math.floor(x + 0.5))


def econ_rub(r):
    """Сумма КП в рублях и прибыль в рублях (копейки) для итогов журнала — как jEcon() в интерфейсе.
    Не число (КП из старой копии или файла: «1 000», NaN) — 0 / нет: одно такое КП не ломает журнал и статистику."""
    def num(v):
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            try:
                v = float(str(v).replace(' ', '').replace('\xa0', '').replace(',', '.'))
            except (TypeError, ValueError):
                return 0
        return v if v == v and abs(v) != float('inf') else 0
    a, b = _econ_rub(r)
    return (None if a is None else num(a)), (None if b is None else num(b))


def _econ_rub(r):
    e = r.get('econ') if isinstance(r.get('econ'), dict) else None
    cur = (e or {}).get('cur') or 'RUB'
    base = ((e or {}).get('sum') if e else r.get('sum')) or 0
    if r.get('locked'):
        return ((r.get('sum') or 0) if cur == 'RUB' else None), None
    sum_rub = base if cur == 'RUB' else ((e or {}).get('sumRub') or None)
    dd = r.get('deal') if isinstance(r.get('deal'), dict) else None
    try:
        if dd:
            return sum_rub, (_jround(float(dd.get('profit') or 0) * 100) if dd.get('confirmed') else None)
        if e and e.get('withCost'):
            if cur == 'RUB':
                return sum_rub, e.get('profit')
            if e.get('sumRub') and e.get('sum'):
                return sum_rub, _jround(float(e['profit']) * float(e['sumRub']) / float(e['sum']))
    except (TypeError, ValueError):
        pass
    return sum_rub, None


class KpJournal:
    """Журнал КП с правами: чужие КП — только с правом «КП других менеджеров», экономика чужого КП убирается (locked);
    постраничный вывод с итогами и воронкой по статусам."""

    @staticmethod
    def status(r):
        """Статус хода сделки строки журнала (нет хода сделки — new)."""
        return ((r.get('track') or {}).get('status') if isinstance(r.get('track'), dict) else None) or 'new'

    @staticmethod
    def rows(h, rows):
        """Разобранные описания КП с правами журнала (список меняется на месте)."""
        if login_on(h) and not perm(h, 'kpOthers'):
            rows = [r for r in rows if isinstance(r, dict) and own_kp(h, r)]
        for r in rows:
            if isinstance(r, dict) and not deal_allowed(h, r):
                for k in DEAL_KEYS_META:
                    r.pop(k, None)
                r['locked'] = True
        return rows

    @classmethod
    def out(cls, h, text):
        """Журнал строкой JSON (как его отдаёт база) → строка JSON с правами."""
        try:
            rows = json.loads(text)
        except ValueError:
            return '[]'          # без разбора нельзя убрать чужую экономику — лучше пусто, чем лишнее
        return json.dumps(cls.rows(h, rows), ensure_ascii=False)

    @classmethod
    def page(cls, h, store, q):
        """Журнал КП постранично: поиск и автор — в базе; итоги (сумма, прибыль) — по всему отбору."""
        try:
            limit, offset = max(1, min(int(q.get('limit') or 50), 500)), max(0, min(int(q.get('offset') or 0), 10 ** 9))
        except ValueError:
            limit, offset = 50, 0
        metas = store.kp_metas_where(q.get('q', ''), q.get('author', ''), q.get('kind', ''))
        rows = cls.rows(h, [d for d in map(_loads, metas) if isinstance(d, dict)])     # каждое описание разбирается один раз
        # воронка — по всему отбору без фильтра статуса: сколько КП и на какую сумму в каждом статусе
        funnel = {}
        for r in rows:
            f = funnel.setdefault(cls.status(r), {'n': 0, 'sum': 0})
            f['n'] += 1
            f['sum'] += econ_rub(r)[0] or 0
        want = q.get('status', '')
        if want == 'open':
            rows = [r for r in rows if cls.status(r) not in ('won', 'lost')]
        elif want:
            rows = [r for r in rows if cls.status(r) == want]
        s_sum, s_profit, n_profit = 0, 0, 0
        for r in rows:
            a, p = econ_rub(r)
            s_sum += a or 0
            if p is not None:
                s_profit += p
                n_profit += 1
        return {'total': len(rows), 'items': rows[offset:offset + limit], 'authors': store.kp_authors(),
                'agg': {'sum': s_sum, 'profit': s_profit, 'profitN': n_profit}, 'funnel': funnel}


def log(h, store, action, etype=None, eid=None, before=None, after=None, result='success', admin=None):
    uid, name, role = actor(h, admin)
    try:
        store.audit_add({'userId': uid, 'userName': name, 'userRole': role, 'action': action, 'entityType': etype,
                         'entityId': None if eid is None else str(eid), 'before': before, 'after': after,
                         'ip': _ip(h), 'userAgent': h.headers.get('User-Agent') or '', 'result': result})
    except Exception:
        pass   # журнал не должен мешать работе


ABSENT = '__absent__'


def _short(v, limit=20000):
    t = json.dumps(v, ensure_ascii=False)
    return v if len(t) <= limit else {'__truncated__': len(t)}


def diff(before, after, skip=()):
    """Только изменённые поля: ({поле: было}, {поле: стало}); отсутствующее поле — ABSENT."""
    b, a = before or {}, after or {}
    norm = lambda v: ABSENT if v in (None, '', [], {}) else v      # пустое и отсутствующее поле — одно и то же
    keys = [k for k in sorted(set(b) | set(a)) if k not in skip and not k.startswith('_')
            and json.dumps(norm(b.get(k)), sort_keys=True, ensure_ascii=False) != json.dumps(norm(a.get(k)), sort_keys=True, ensure_ascii=False)]
    return {k: _short(b.get(k, ABSENT)) for k in keys}, {k: _short(a.get(k, ABSENT)) for k in keys}


def _loads(t):
    try:
        return json.loads(t) if t else None
    except Exception:
        return None


def _body_obj(h):
    """Тело запроса — объект JSON или {} (не объект — маршрут сам ответит 400, журнал не падает)."""
    try:
        d = _loads(h.body().decode('utf-8'))
    except UnicodeDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


# ---------------------------------------------------------------- модерация
def moderation(store):
    return ((store.kv_get('settings') or {}).get('productEditModeration') or {'enabled': False})


def _set_moderation(store, enabled, by):
    st = store.kv_get('settings') or {}
    st['productEditModeration'] = {'enabled': bool(enabled), 'updatedAt': _now(), 'updatedBy': by}
    store.kv_set('settings', st)


def _put_product(h, store, cid, admin):
    """Единая точка сохранения товара: модерация (черновик) или сразу в каталог; всё — в журнал."""
    after = _body_obj(h)
    if not after or not isinstance(after.get('attrs', {}), dict):
        return h.send(400, 'text/plain; charset=utf-8', 'Неверный запрос: нужна карточка оборудования (объект JSON)')
    for k in ('name', 'model', 'desc'):
        if k in after and not isinstance(after[k], str):
            after[k] = '' if after[k] is None else str(after[k])
    text = json.dumps(after, ensure_ascii=False)
    before_text = store.catalog_get(cid)
    before = _loads(before_text)
    b, a = diff(before, after)          # что изменилось (одним сравнением на всё сохранение)
    auto = before is not None and set(a) <= AUTO_KEYS     # сохранение КП обновило только цены и историю
    if not admin and login_on(h):
        if not auto and not perm(h, 'catEdit' if before is not None else 'catAdd'):
            log(h, store, 'edit_product' if before else 'create_product', 'product', cid, result='failed')
            return h.send(403, 'text/plain; charset=utf-8', 'Нет права %s оборудование в каталоге — обратитесь к администратору'
                          % ('редактировать' if before is not None else 'добавлять'))
    # модерация не касается администратора и менеджера с правом «Правки без модерации»
    mod = moderation(store).get('enabled') and not admin and not (login_on(h) and perm(h, 'catSelfMod'))
    if mod and before is not None and h.headers.get('X-KP-Edit') == 'auto':
        mod = not auto                   # сохранение КП обновило только цены и историю — без модерации
    if mod:
        uid, name, _ = actor(h, False)
        pid = store.pending_add(cid, 'update' if before else 'create', before_text, text, uid, name)
        pb, pa = diff(before, after, AUTO_KEYS)
        log(h, store, 'submit_edit', 'product', cid, pb, pa, admin=False)
        return h.send_json({'ok': True, 'pending': True, 'pendingId': pid})
    try:
        rev = store.catalog_put(cid, text, actor(h, admin)[1], h.base_rev())
    except Conflict as e:
        return h.conflict(e)
    log(h, store, 'price_sync' if auto else ('edit_product' if before else 'create_product'), 'product', cid,
        b if before else None, a, admin=admin)
    return h.send_json({'ok': True, 'rev': rev})


# ---------------------------------------------------------------- проверка прав перед маршрутом
def _refuse(h, store=None, action=None, etype=None, eid=None, text=DENIED):
    """Отказ (403); попытка изменения (action) — в журнал. Возвращает True — «ответ уже отправлен» для guard."""
    if action:
        log(h, store, action, etype, eid, result='failed')
    h.send(403, 'text/plain; charset=utf-8', text)
    return True


def guard(h, store, m, path):
    """Вызывается до обычного маршрута. True — ответ уже отправлен; функция — вызвать после успешного ответа
    (запись в журнал); None — ничего не нужно."""
    from settings_history import SettingsHistory
    SettingsHistory.actor(actor(h)[1])            # запрос человека: его правки настроек — в историю
    if path.startswith('/api/admin/'):
        AdminApi(h, store).handle(m, path[len('/api/admin/'):])
        return True
    if path.startswith('/api/auth/'):
        auth_api(h, store, m, path[len('/api/auth/'):])
        return True
    # вход менеджеров по паролю: без входа — только экран входа; кто работает — по сессии
    h._kp_login = auth_users.enabled(store)
    h._kp_user = auth_users.current(h, store) if h._kp_login else None
    if h._kp_login and not h._kp_user and session(h, touch=False) is None and path not in ('/api/version', '/api/ping'):
        h.send(401, 'text/plain; charset=utf-8', 'Нужно войти в программу: логин и пароль менеджера')
        return True
    # вошёл с временным паролем от администратора — сначала задать свой (клиент по заголовку показывает форму смены)
    if h._kp_user and h._kp_user.get('mustChange') and session(h, touch=False) is None and path not in ('/api/version', '/api/ping'):
        h.send(403, 'text/plain; charset=utf-8', 'Сначала задайте свой пароль — временный пароль от администратора годится только для входа',
               {'X-KP-Auth': 'change-password'})
        return True
    # выключенная администратором функция («Настройки → Функции программы») — её адреса закрыты
    from features import FeatureAccess
    off = FeatureAccess(store).blocked(m, path, lambda: (session(h, touch=False) is not None, actor(h, admin=False)[0] or ''))
    if off:
        return _refuse(h, text='Функция «%s» выключена администратором' % off)
    r = re.match(r'^/api/kp/([A-Za-z0-9_-]+)/', path)
    if r and not kp_access(h, store, r.group(1)):
        return _refuse(h, text='Это КП другого менеджера — нет доступа. Права выдаёт администратор')
    if path == '/api/types' and m == 'PUT' and not perm(h, 'catEdit'):
        return _refuse(h, text='Нет права менять категории оборудования — обратитесь к администратору')
    from catalog_admin import CatalogDesk
    if CatalogDesk.handles(path):     # особые права менеджеров: в корзину, модерация, выгрузка (и администратор)
        return CatalogDesk(h, store).route(m, path)
    r = re.match(r'^/api/catalog/([A-Za-z0-9_-]{1,64})$', path)
    if r and m == 'PUT' and r.group(1) in ('sources', 'pending', 'trash', 'export', 'moderation', 'search', 'sync'):      # служебные адреса — не карточки
        h.send(400, 'text/plain; charset=utf-8', 'Недопустимый идентификатор')
        return True
    if r and m == 'PUT':
        _put_product(h, store, r.group(1), is_admin(h))
        return True
    if m == 'DELETE':
        return _refuse(h, store, 'delete_attempt', path.split('/')[2] if path.count('/') > 2 else None, path.rsplit('/', 1)[-1])
    # только администратор: тарифы доставки по России
    if path == '/api/logistics/refresh' and m == 'POST':
        if not is_admin(h):
            return _refuse(h)
        return lambda: log(h, store, 'edit_settings', 'settings', 'logistics_refresh', None, {'source': 'ATI.SU'}, admin=True)
    if path.startswith(('/api/logistics/carriers', '/api/logistics/china')):
        what = 'chinaRates' if 'china' in path else 'carrierApi'
        if not is_admin(h, need_csrf=(m != 'GET')):
            return _refuse(h, store, 'edit_settings' if m != 'GET' else None, 'settings', what)
        if m == 'PUT':
            return lambda: log(h, store, 'edit_settings', 'settings', what, None, {what: True}, admin=True)
    if path == '/api/logistics' and m == 'PUT':
        if not is_admin(h):
            return _refuse(h, store, 'edit_settings', 'settings', 'logistics')
        return lambda: log(h, store, 'edit_settings', 'settings', 'logistics', None, {'tariffs': True}, admin=True)
    # только администратор: резервная копия ключей API (ключи целиком)
    if path == '/api/integrations/export':
        if not is_admin(h):
            return _refuse(h, store, 'export_keys', 'settings', 'integrations')
        return lambda: log(h, store, 'export_keys', 'settings', 'integrations', None, None, admin=True)
    # только администратор: тексты интерфейса
    if path == '/api/uitexts' and m == 'PUT':
        if not is_admin(h):
            return _refuse(h, store, 'edit_settings', 'settings', 'uitexts')
        n = len(_body_obj(h))
        return lambda: log(h, store, 'edit_settings', 'settings', 'uitexts', None, {'texts': n}, admin=True)
    # только администратор: шаблоны КП, ключи API
    tpl = re.match(r'^/api/templates/([A-Za-z0-9_-]+)/(file|restore|copy|reset|delete|open)$', path)
    if (tpl and m in ('PUT', 'POST')) or (path == '/api/templates/folder' and m == 'POST') or (path == '/api/integrations' and m == 'PUT'):
        if not is_admin(h):
            return _refuse(h, store, 'edit_settings', 'template' if tpl else 'settings', tpl.group(1) if tpl else path)
        if path == '/api/integrations':
            keys = list(_body_obj(h).keys())
            return lambda: log(h, store, 'edit_settings', 'settings', 'integrations', None, {'keys': keys}, admin=True)
        if tpl.group(2) != 'open':
            info = {'action': tpl.group(2), 'file': urllib.parse.parse_qs(urllib.parse.urlsplit(h.path).query).get('name', [''])[0]}
            return lambda: log(h, store, 'edit_template', 'template', tpl.group(1), None, info, admin=True)
        return None
    # журнал: КП, менеджеры, клиенты, типы оборудования
    r = re.match(r'^/api/kp/([A-Za-z0-9_-]+)/meta$', path)
    if r and m == 'PUT':
        old = _loads(store.kp_get(r.group(1), 'meta'))
        new = _body_obj(h)
        keep = ('number', 'client', 'sum', 'positions', 'manager', 'file')
        b = {k: old.get(k) for k in keep} if old else None
        a = {k: new.get(k) for k in keep}
        return lambda: log(h, store, 'edit_kp' if old else 'create_kp', 'kp', r.group(1), b, a)
    r = re.match(r'^/api/managers/([A-Za-z0-9_-]+)$', path)
    if r and m == 'PUT':
        old = next((x for x in json.loads(store.managers_list()) if x.get('id') == r.group(1)), None)
        new = _body_obj(h)
        b, a = diff(old, dict(new, id=r.group(1)), ('updatedAt',))
        return (lambda: log(h, store, 'edit_manager' if old else 'create_manager', 'manager', r.group(1), b if old else None, a)) if a else None
    r = re.match(r'^/api/clients/([A-Za-z0-9_-]+)$', path)
    if r and m == 'PUT':
        old = store.client_get(r.group(1))
        new = _body_obj(h)
        b, a = diff(old, new, ('updated', 'updatedAt', 'kpCount', 'lastKp'))
        return (lambda: log(h, store, 'edit_client' if old else 'create_client', 'client', r.group(1), b if old else None, a)) if a else None
    r = re.match(r'^/api/suppliers/([A-Za-z0-9_-]+)$', path)
    if r and m == 'PUT':
        old = store.supplier_get(r.group(1))
        new = _body_obj(h)
        b, a = diff(old, dict(new, id=r.group(1)), ('updatedAt',))
        return (lambda: log(h, store, 'edit_supplier' if old else 'create_supplier', 'supplier', r.group(1), b if old else None, a)) if a else None
    if path == '/api/customs' and m == 'PUT':
        new = _body_obj(h)
        old = store.customs_all().get(str(new.get('key') or ''))
        return lambda: log(h, store, 'edit_customs', 'customs', new.get('key'), old and {k: old.get(k) for k in ('code', 'duty')},
                           {k: new.get(k) for k in ('code', 'duty')})
    if path == '/api/types' and m == 'PUT':
        stored = {t.get('id'): t for t in (store.kv_get('types') or {}).get('types', []) if isinstance(t, dict)}
        sent = _body_obj(h).get('types')
        new = {str(t.get('id')) for t in (sent if isinstance(sent, list) else []) if isinstance(t, dict)}
        try:
            from equipment_types import load_types_builtin
            builtin = {t.get('id'): t for t in load_types_builtin() if isinstance(t, dict)}
        except Exception:
            builtin = {}
        # копия стандартной категории без изменений — не удаление (её убирают, чтобы категория обновлялась с программой)
        removed = {i for i in set(stored) - new if not (i in builtin and json.dumps(stored[i], sort_keys=True) == json.dumps(builtin[i], sort_keys=True))}
        if removed and not is_admin(h):    # удалить свою категорию или вернуть стандартные — только администратор
            return _refuse(h, store, 'delete_attempt', 'types', ','.join(sorted(removed)))
        return lambda: log(h, store, 'edit_types', 'types', 'user_types', None,
                           {'types': [t.get('name') for t in (sent if isinstance(sent, list) else []) if isinstance(t, dict)]})
    return None


# ---------------------------------------------------------------- вход менеджеров в конструктор
def auth_api(h, store, m, sub):
    send = lambda code, obj, extra=None: h.send(code, 'application/json; charset=utf-8', json.dumps(obj, ensure_ascii=False), extra)
    if sub == 'status':
        u = auth_users.current(h, store) if auth_users.enabled(store) else None
        return send(200, {'enabled': auth_users.enabled(store), 'user': u, 'admin': session(h, touch=False) is not None,
                          'perms': [{'key': k, 'label': lb} for k, lb, _ in auth_users.PERMS], **auth_users.LoginInfo.public(store)})
    if sub == 'login' and m == 'POST':
        ip = _ip(h)
        sec = LoginGuard.left(ip)
        if sec:
            return LoginGuard.refuse(h, sec)
        d = _body_obj(h)
        mid, rec = auth_users.find_by_login(store, d.get('login'))
        ok = LoginGuard.verify(d.get('password'), (rec or {}).get('pw'))
        expired = ok and auth_users.TempPassword.expired(rec)
        if not ok or rec.get('blocked') or expired:
            store.audit_add({'userId': mid, 'userName': str(d.get('login') or '')[:40], 'userRole': 'user', 'action': 'login', 'entityType': 'user',
                             'entityId': mid, 'after': {'reason': 'временный пароль истёк'} if expired and not rec.get('blocked') else None,
                             'ip': ip, 'userAgent': h.headers.get('User-Agent') or '', 'result': 'failed'})
            if ok and rec.get('blocked'):      # пароль верный, но вход запрещён — говорим только тому, кто знает пароль
                return h.send(403, 'text/plain; charset=utf-8', 'Вход запрещён администратором — обратитесь к нему')
            if expired:
                return h.send(403, 'text/plain; charset=utf-8', 'Срок временного пароля истёк — попросите администратора сбросить пароль ещё раз')
            return LoginGuard.wrong(h, ip)
        remember = d.get('remember', True) is not False
        LoginGuard.ok(ip)
        tok = auth_users.UserSession.start(store, mid, remember)
        auth_users.touch_login(store, mid)
        store.audit_add({'userId': mid, 'userName': rec.get('login'), 'userRole': 'user', 'action': 'login', 'entityType': 'user', 'entityId': mid,
                         'ip': ip, 'userAgent': h.headers.get('User-Agent') or '', 'result': 'success'})
        return send(200, {'ok': True, 'mustChange': auth_users.TempPassword.of(rec) is not None},
                    {'Set-Cookie': auth_users.UserSession.cookie(tok, remember)})
    h._kp_user = auth_users.current(h, store) if auth_users.enabled(store) else None
    if sub == 'logout' and m == 'POST':
        tok = auth_users.cookie_token(h)
        if tok:
            auth_users.drop_sessions(store, tok=tok)
        if h._kp_user:
            log(h, store, 'user_logout', 'user', h._kp_user['id'], admin=False)
        return send(200, {'ok': True}, {'Set-Cookie': auth_users.UserSession.cookie('')})
    if sub in ('password', 'logout-all') and m == 'POST':
        return UserAuthApi(h, store).route(sub)
    return h.send(404, 'text/plain; charset=utf-8', 'Нет такого запроса')


class UserAuthApi:
    """Вошедший менеджер о себе: сменить пароль (в том числе временный — сразу после входа), выйти на всех устройствах.
    Только по своей сессии (cookie kp_user, SameSite=Strict; чужие сайты отсекает проверка Origin сервера). Пароли — ни
    в журнал, ни в ответ."""

    def __init__(self, h, store):
        self.h, self.st = h, store
        self.u = h._kp_user

    def text(self, code, text, extra=None):
        return self.h.send(code, 'text/plain; charset=utf-8', text, extra)

    def route(self, sub):
        if not self.u:
            return self.text(401, 'Нужно войти в программу: логин и пароль менеджера')
        return self.password() if sub == 'password' else self.logout_all()

    def password(self):
        h, st, mid = self.h, self.st, self.u['id']
        ip = _ip(h)
        sec = LoginGuard.left(ip)
        if sec:
            return LoginGuard.refuse(h, sec)
        tok = auth_users.cookie_token(h)
        try:
            temp, closed = auth_users.UserPassword.change(st, mid, _body_obj(h), tok, LoginGuard.verify, hash_password)
        except PermissionError as e:
            log(h, st, 'set_password', 'user', mid, result='failed', admin=False)
            return LoginGuard.wrong(h, ip, str(e))
        except ValueError as e:
            return self.text(400, str(e))
        LoginGuard.ok(ip)
        log(h, st, 'set_password', 'user', mid, None, {'by': 'сам', 'temp': temp, 'closedSessions': closed}, admin=False)
        return h.send_json({'ok': True, 'closed': closed})

    def logout_all(self):
        h, st, mid = self.h, self.st, self.u['id']
        closed = auth_users.UserSession.drop_all(st, mid)
        log(h, st, 'logout_all', 'user', mid, None, {'by': 'сам', 'closedSessions': closed}, admin=False)
        return h.send(200, 'application/json; charset=utf-8', json.dumps({'ok': True, 'closed': closed}),
                      {'Set-Cookie': auth_users.UserSession.cookie('')})


# ---------------------------------------------------------------- API «Настроек»
SECTIONS = ('catalog', 'kp', 'managers', 'clients', 'suppliers', 'audit', 'settings')
SECTION_FILE = {'catalog': 'каталог', 'kp': 'КП', 'managers': 'менеджеры', 'clients': 'клиенты', 'suppliers': 'поставщики',
                'audit': 'журнал', 'settings': 'настройки'}     # части имени файла выгрузки


class AdminApi:
    def __init__(self, h, store):
        self.h, self.st = h, store

    def ok(self, obj=None):
        return self.h.send_json({'ok': True} if obj is None else obj)

    def err(self, code, text):
        return self.h.send(code, 'text/plain; charset=utf-8', text)

    def data(self):
        """Тело запроса — объект JSON (пустое тело — {}); иначе 400 «Неверный запрос»."""
        raw = self.h.body()
        if not raw.strip():
            return {}
        try:
            d = json.loads(raw.decode('utf-8'))
        except ValueError:
            raise BadRequest('Неверный запрос: нужен JSON')
        if d is None:
            return {}
        if not isinstance(d, dict):
            raise BadRequest('Неверный запрос: нужен объект JSON')
        return d

    def log(self, *a, **k):
        log(self.h, self.st, *a, admin=True, **k)

    def handle(self, m, sub):
        h, st = self.h, self.st
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(h.path).query, keep_blank_values=True, encoding='utf-8'))
        users = accounts(st)
        if sub == 'status':
            s = session(h)
            return self.ok({'hasPassword': bool(users), 'admin': bool(s), 'csrf': s['csrf'] if s else '',
                            'login': s.get('login', '') if s else '', 'name': s.get('name', '') if s else '',
                            'canSetup': not users and h.is_local(), 'idleMinutes': SrvVal.get(st, 'srv.adminIdleMin')})
        if sub == 'setup' and m == 'POST':
            if users:
                return self.err(409, 'Администратор уже создан')
            if not h.is_local():
                return self.err(403, 'Первая учётная запись создаётся на компьютере, где работает программа')
            d = self.data()
            login, pw = str(d.get('login') or 'admin').strip(), str(d.get('password') or '')
            try:
                check_login(login)
                check_new_password(pw)
            except ValueError as e:
                return self.err(400, str(e))
            u = {'login': login, 'name': str(d.get('name') or '').strip()[:80] or login, 'pw': hash_password(pw), 'created': _now(), 'by': 'первый вход', 'lastLogin': _now()}
            save_accounts(st, [u])
            tok = self._login_ok(u)
            log(h, st, 'create_admin', 'admin', login, None, {'login': login, 'name': u['name']}, admin=True)
            return tok
        if sub == 'login' and m == 'POST':
            ip = _ip(h)
            if not users:
                return self.err(409, 'Администратор ещё не создан')
            sec = LoginGuard.left(ip)
            if sec:
                log(h, st, 'login', 'admin', None, result='failed', admin=False)
                return LoginGuard.refuse(h, sec)
            d = self.data()
            login = str(d.get('login') or '').strip()
            u = find_account(users, login) if login else (users[0] if len(users) == 1 else None)
            if not LoginGuard.verify(d.get('password'), (u or {}).get('pw')):
                log(h, st, 'login', 'admin', login[:40] or None, result='failed', admin=False)
                return LoginGuard.wrong(h, ip)
            LoginGuard.ok(ip)
            u['lastLogin'] = _now()
            save_accounts(st, users)
            resp = self._login_ok(u)
            log(h, st, 'login', 'admin', u['login'], admin=True)
            return resp
        if sub == 'logout' and m == 'POST':
            AdminSessions.drop(_cookie_token(h))
            log(h, st, 'logout', 'admin', admin=True)
            return h.send(200, 'application/json; charset=utf-8', '{"ok": true}',
                          {'Set-Cookie': 'kp_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'})
        # дальше — только администратор; изменения — с CSRF-токеном
        if not is_admin(h, need_csrf=(m != 'GET')):
            if m != 'GET':
                log(h, st, 'admin_request', 'admin', sub, result='failed', admin=False)
            return self.err(401, 'Войдите в «Настройки» — сессия закрыта или истекла')
        try:
            return self.route(m, sub, q)
        except ValueError as e:
            return self.err(400, str(e))

    def feeds(self, m, sub, q, me):
        import feeds
        from equipment_types import load_types
        st = self.st
        types = load_types()['types']
        if sub == 'feeds' and m == 'GET':
            return self.ok({'items': feeds.status(st), 'types': [{'id': t.get('id'), 'name': t.get('name'), 'group': t.get('group')} for t in types if not t.get('hidden')]})
        if sub == 'feeds' and m == 'POST':
            f = feeds.feed_save(st, self.data())
            self.log('edit_settings', 'settings', 'feed:' + f['id'], None, {'url': f['url'] or f.get('kind'), 'name': f['name']})
            return self.ok(f)
        r = re.match(r'^feeds/([a-z0-9-]{1,40})/(preview|import|check|delete|log|status|upload|file|discounts|plan|loadplan|rebuild|purge|unblock)$', sub)
        if not r:
            return self.err(404, 'Нет такого запроса')
        fid, act = r.group(1), r.group(2)
        f = feeds.feed_get(st, fid)
        if not f:
            return self.err(404, 'Фид не найден')
        if act == 'log':
            return self.ok({'items': feeds.log_of(st, fid)})
        if act == 'status':
            return self.ok({'job': feeds.JOBS.get(fid)})
        if act == 'discounts':      # как сетка скидок разложится по позициям; в теле можно прислать ещё не сохранённую сетку
            d = self.data() if m == 'POST' else {}
            g = dict(f)
            if isinstance(d.get('discounts'), list):
                g['discounts'] = feeds.discount_rules(d['discounts'])
            if isinstance(d.get('driveHints'), dict):
                g['driveHints'] = {k: str(d['driveHints'].get(k) or '')[:400] for k in ('belt', 'direct')}
            if 'discount' in d:
                x = feeds.parse_number(d.get('discount'))
                g['discount'] = x if x and 0 < x < 100 else None
            return self.ok(feeds.discount_plan(st, g))
        if m != 'POST':
            return self.err(405, 'Нужен POST')
        if act == 'loadplan':       # «Что загружать»: план «добавится / изменится / пропущено»; в теле — ещё не сохранённые настройки
            d = self.data()
            g = dict(f)
            if isinstance(d.get('filter'), dict):
                g['filter'] = feeds.FeedRules.clean_filter(d['filter'])
            if isinstance(d.get('fields'), dict):
                g['fields'] = feeds.FeedRules.clean_fields(d['fields'])
            if isinstance(d.get('cats'), dict):
                g['cats'] = feeds._cats_ok(d['cats'])
            try:
                return self.ok(feeds.FeedRules.plan(st, g, types))
            except Exception as e:
                return self.err(422, 'Фид не загрузился: %s' % e)
        if act == 'upload':         # файл фида из файлов: ?kind=pages|price&name=имя, тело — сам файл
            if feeds.busy(fid):
                return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
            meta = feeds.feed_file_put(st, fid, q.get('kind', ''), self.h.body(), q.get('name', ''), q.get('slot') or None)
            self.log('edit_settings', 'settings', 'feed:' + fid, None, {'file': q.get('kind'), 'name': meta['name'], 'rows': meta.get('rows')})
            return self.ok(meta)
        if act == 'file':           # файл фида из файлов: {kind, slot, act: drop | cur, cur, sheet}
            if feeds.busy(fid):
                return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
            d = self.data()
            x = feeds.feed_file_set(st, fid, str(d.get('kind') or ''), str(d.get('slot') or ''), str(d.get('act') or ''),
                                    str(d.get('cur') or ''), str(d.get('sheet') or ''))
            self.log('edit_settings', 'settings', 'feed:' + fid, None, {'file': d.get('kind'), 'slot': d.get('slot'), 'act': d.get('act'), 'cur': d.get('cur')})
            return self.ok(x.get('files') or {})
        if act == 'delete':
            feeds.feed_delete(st, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'url': f['url']}, None)
            return self.ok()
        if feeds.busy(fid):
            return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
        if act == 'purge':          # удалить позиции фида в корзину: {cat, preview, block}
            d = self.data()
            cat = str(d.get('cat') or '')[:80]
            if d.get('preview') is True:
                return self.ok(feeds.FeedPurge.preview(st, f, cat))
            r = feeds.FeedPurge.run(st, f, cat, d.get('block') is not False, actor(self.h, True)[1])
            self.log('delete_catalog', 'catalog', 'feed:' + fid, None, dict(r, feed=f.get('name'), cat=cat or 'все'))
            return self.ok(r)
        if act == 'unblock':        # вернуть удалённые позиции фида в загрузку
            n = feeds.FeedPurge.unblock(st, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'excluded': n}, {'excluded': 0})
            return self.ok({'unblocked': n})
        if act == 'plan':           # фид из файлов: что сделает сборка каталога (без записи)
            try:
                return self.ok(feeds.plan_summary(st, f))
            except Exception as e:
                return self.err(422, 'Фид не загрузился: %s' % e)
        if act == 'rebuild':        # разрешить сборку каталога заново (парс снова перестроит позиции производителя)
            feeds.feed_unbuild(st, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'built': True}, {'built': False})
            return self.ok()
        if act == 'preview':
            try:
                return self.ok(feeds.preview(st, f, types))
            except Exception as e:
                return self.err(422, 'Фид не загрузился: %s' % e)
        who = me or 'администратор'
        if act == 'import':
            d = self.data()
            only = set(d.get('only') or []) or None
            feeds.run_bg(feeds.import_feed, st, f, types, feeds.IMAGE_STORE, who, only, trash_missing=d.get('trashMissing') is True)
            self.log('import_feed', 'catalog', 'feed:' + fid, None, {'url': f['url'], 'only': len(only) if only else 'все'})
        else:
            feeds.run_bg(feeds.check_feed, st, f, who, types=types)
            self.log('check_feed', 'catalog', 'feed:' + fid, None, {'url': f['url']})
        return self.ok({'job': feeds.JOBS.get(fid) or {'state': 'run', 'kind': act}})

    def _login_ok(self, user=None):
        tok, csrf = AdminSessions.start(self.h, user)
        return self.h.send(200, 'application/json; charset=utf-8', json.dumps({'ok': True, 'csrf': csrf}),
                           {'Set-Cookie': 'kp_admin=%s; Path=/; HttpOnly; SameSite=Strict' % tok})

    def route(self, m, sub, q):
        st = self.st
        me = (session(self.h, touch=False) or {}).get('login', '')
        if sub in ('system', 'attention', 'restart', 'folder', 'log', 'log/download', 'alerts', 'alerts/test') or sub == 'update' or sub.startswith('update/'):
            return self.system(m, sub, q, me)
        if sub == 'history' or sub.startswith('history/'):
            return self.history(m, sub, q)
        if sub == 'connections':      # проверить все подключения: почта, нейросеть, ЦБ, контрагенты, перевозчики, GitHub, фиды, PDF
            from config import ROOT
            from connections import ConnectionCheck
            cc = ConnectionCheck(st, os.path.dirname(st.path), ROOT)
            return self.ok(cc.run() if m == 'POST' else cc.last())
        if sub == 'password' and m == 'POST':
            d, users = self.data(), accounts(st)
            u = find_account(users, me) or (users[0] if len(users) == 1 else None)
            if not u or not verify_password(d.get('old') or '', u.get('pw') or {}):
                self.log('set_password', 'admin', me, result='failed')
                return self.err(403, 'Текущий пароль указан неверно')
            check_new_password(d.get('new') or '')
            u['pw'] = hash_password(d['new'])
            save_accounts(st, users)
            self.log('set_password', 'admin', u['login'])
            return self.ok()
        if sub == 'access':      # вход менеджеров в конструктор: режим, логины, пароли, права
            if m == 'POST':
                d = self.data()
                if 'enabled' in d:
                    on = bool(d['enabled'])
                    if on and not any(r.get('login') and r.get('pw') and not r.get('blocked') for r in auth_users.access(st).values()):
                        return self.err(400, 'Сначала задайте логин и пароль хотя бы одному менеджеру')
                    before = auth_users.enabled(st)
                    auth_users.set_enabled(st, on, me or 'admin')
                    self.log('toggle_user_login', 'settings', 'userLogin', {'enabled': before}, {'enabled': on})
                if 'help' in d:      # «Забыли пароль?» на экране входа: к кому обращаться
                    before = auth_users.LoginInfo.help(st)
                    after = auth_users.LoginInfo.set_help(st, d['help'], me or 'admin')
                    if after != before:
                        self.log('edit_settings', 'settings', 'userLogin.help', {'help': before}, {'help': after})
            mgrs = _loads(st.managers_list()) or []
            return self.ok({'enabled': auth_users.enabled(st), 'perms': [{'key': k, 'label': lb, 'def': dv} for k, lb, dv in auth_users.PERMS],
                            'managers': auth_users.public(st, mgrs), 'help': auth_users.LoginInfo.help(st)})
        r = re.match(r'^access/([A-Za-z0-9_-]{1,64})/(reset|logout)$', sub)
        if r and m == 'POST':
            return self.access_act(r.group(1), r.group(2), me)
        r = re.match(r'^access/([A-Za-z0-9_-]{1,64})$', sub)
        if r and m == 'POST':
            mid = r.group(1)
            if not any(x.get('id') == mid for x in (_loads(st.managers_list()) or [])):
                return self.err(404, 'Менеджер не найден')
            d = self.data()
            rec = auth_users.set_access(st, mid, d, hash_password)
            info = {k: d[k] for k in ('login', 'perms', 'blocked', 'clear') if k in d}
            if d.get('password'):
                info['password'] = 'изменён'
            self.log('edit_access', 'manager', mid, None, info)
            return self.ok({'login': rec.get('login') or '', 'hasPassword': bool(rec.get('pw')), 'perms': auth_users.perms_of(rec), 'blocked': bool(rec.get('blocked'))})
        if sub == 'rules/stations':      # инженерные правила станций: своя версия файла администратора или файл поставки
            from station_rules import StationRules
            sr = StationRules(st)
            if m == 'POST':
                before = sr.info()
                res = sr.reset() if q.get('reset') == '1' else sr.save(self.h.body(), me or 'admin')
                self.log('edit_settings', 'settings', 'stationRules', {'version': before['version'], 'own': before['own']},
                         {'version': res['version'], 'own': res['own']})
                return self.ok({'info': res})
            return self.ok({'info': sr.info(), 'layoutDef': sr.layout_defaults()})
        if sub == 'features':    # функции программы: включить / выключить
            from features import FeatureAccess
            fa = FeatureAccess(st)
            if m == 'POST':
                before = fa.config()
                res = fa.save(self.data().get('values'), me or 'admin')
                ch = {k: v for k, v in res.items() if before.get(k) != v}
                if ch:
                    self.log('edit_settings', 'settings', 'features', {k: before.get(k) for k in ch}, ch)
                return self.ok({'config': res})
            return self.ok({'config': fa.config()})
        if sub == 'mail':        # почта для отправки КП клиентам (SMTP)
            from kp_track import Mailer
            if m == 'POST':
                res = Mailer(st).save(self.data(), me or 'admin')
                self.log('edit_settings', 'settings', 'mail', None, {k: res.get(k) for k in ('host', 'port', 'security', 'login', 'fromEmail')})
                return self.ok(res)
            return self.ok(Mailer(st).public())
        if sub == 'mail/test' and m == 'POST':
            from kp_track import Mailer
            try:
                to = Mailer.addresses(self.data().get('to'))
                if not to:
                    return self.err(400, 'Укажите адрес для проверки')
                Mailer(st).send(to, [], 'Проверка почты — Конструктор КП', 'Это проверочное письмо: отправка КП по почте настроена.', [], test=True)
            except RuntimeError as e:
                return self.err(422, str(e))
            self.log('edit_settings', 'settings', 'mail_test', None, {'to': to})
            return self.ok({'ok': True})
        if sub == 'lists':       # списки и выборы: {ключ: [строки]}; None — вернуть встроенный список
            from lists import ListStore
            ls = ListStore(st)
            if m == 'POST':
                d = self.data()
                before = ls.all()
                res = ls.save(d.get('values'), me or 'admin')
                keys = list((d.get('values') or {}).keys())
                self.log('edit_lists', 'settings', 'lists', {k: before.get(k) for k in keys}, {k: res.get(k) for k in keys})
                return self.ok({'values': res})
            return self.ok({'values': ls.all()})
        if sub == 'defaults':    # значения по умолчанию программы: {ключ: {on, v}}; None — вернуть встроенное
            import defaults
            if m == 'POST':
                d = self.data()
                before = defaults.get(st)
                res = defaults.save(st, d.get('values'), me or 'admin')
                ch = {k: res.get(k) for k in (d.get('values') or {})}
                self.log('edit_defaults', 'settings', 'defaults', {k: before.get(k) for k in ch}, ch)
                return self.ok({'values': res})
            return self.ok({'values': defaults.get(st)})
        if sub == 'bitrix' or sub.startswith('bitrix/'):     # связь с Битрикс24 (bitrix.py)
            from bitrix import BitrixDesk
            return BitrixDesk(self.h, self.st, self.log).route(m, sub, me or 'admin')
        if sub == 'ai':          # нейросеть в программе: включить / выключить, ключ, модель, адрес API, расход
            import ai_llm
            if m == 'POST':
                d = self.data()
                before = ai_llm.settings(st)
                res = ai_llm.save(st, d, me or 'admin')
                info = {k: d[k] for k in ('enabled', 'model', 'base') if k in d}
                if 'key' in d:
                    info['key'] = 'изменён' if d.get('key') else 'удалён'
                self.log('edit_ai', 'settings', 'ai', {k: before.get(k) for k in info if k in before}, info)
                return self.ok(res)
            return self.ok(ai_llm.admin_view(st))
        if sub == 'ai/test' and m == 'POST':      # проверка ключа и связи: короткий запрос
            import ai_llm
            try:
                r = ai_llm.ask(st, 'Ответь JSON-объектом {"ok": true, "model": "<название модели>"}', force=True)
            except RuntimeError as e:
                return self.err(422, str(e))
            return self.ok({'ok': True, 'answer': r['text'][:200], 'model': r['model'], 'usage': r['usage']})
        if sub == 'users':
            if m == 'POST':
                return self.ok(self.users(self.data(), me))
            return self.ok({'items': [public_account(u) for u in accounts(st)], 'me': me})
        if sub == 'stats':
            return self.ok(stats(st))
        if sub == 'audit':
            page = max(0, int(q.get('page') or 0))
            res = st.audit_query(q, 50, page * 50)
            res['page'] = page
            return self.ok(res)
        if sub == 'audit/filters':
            return self.ok({'users': st.audit_distinct('user_name'), 'actions': st.audit_distinct('action'),
                            'entities': st.audit_distinct('entity_type')})
        r = re.match(r'^audit/(\d{1,9})/rollback$', sub)
        if r and m == 'POST':
            return self.rollback(int(r.group(1)))
        if sub == 'logos':       # логотипы производителей: закрепить за маркой (на всё её оборудование и в будущем) или снять
            from maker_logos import MakerLogos
            import web_api
            ml = MakerLogos(st, web_api.IMAGES)
            if m == 'POST':
                d = self.data()
                res = ml.unpin(d.get('maker')) if d.get('unpin') else ml.set(d.get('maker'), d.get('image'), me or 'admin')
                self.log('edit_settings', 'settings', 'makerLogo', None, {'maker': res['maker'], 'unpin': bool(d.get('unpin')), 'items': res.get('items', 0)})
                return self.ok(res)
            return self.ok({'items': ml.list()})
        if sub == 'feeds' or sub.startswith('feeds/'):          # товарные фиды поставщиков (feeds.py)
            return self.feeds(m, sub, q, me)
        r = re.match(r'^list/(kp|catalog|manager|client|supplier)$', sub)
        if r:
            return self.ok(self.listing(r.group(1), q.get('q') or ''))
        if sub == 'delete' and m == 'POST':
            return self.delete(self.data())
        r = re.match(r'^kpfiles/([A-Za-z0-9_-]{1,64})/(\d{1,9})/delete$', sub)
        if r and m == 'POST':        # справочный документ КП — удаляет только администратор (у менеджеров кнопки нет)
            from kp_files import KpFiles
            rec = KpFiles.of(st).delete(r.group(1), int(r.group(2)))
            if not rec:
                return self.err(404, 'Документ не найден')
            self.log('delete_kp_file', 'kp', r.group(1), {'name': rec['name'], 'size': rec['size']}, None)
            return self.ok({'ok': True})
        if sub == 'trash' or sub.startswith('trash/'):
            return self.trash(m, sub, q)
        if sub == 'moderation':
            if m == 'POST':
                return self.toggle(self.data())
            desk = self.desk()
            return self.ok({'settings': moderation(st), 'pending': desk.items('pending'),
                            'history': desk.items('approved', 30) + desk.items('rejected', 30),
                            'archived': desk.items('archived')})
        r = re.match(r'^pending/(\d{1,9})$', sub)
        if r:
            return self.ok(self.desk().view(int(r.group(1))))
        r = re.match(r'^pending/(\d{1,9})/(approve|reject)$', sub)
        if r and m == 'POST':     # fields — принять только эти поля (остальные изменения правки отбрасываются)
            d = self.data()
            return self.ok(self.desk().review(int(r.group(1)), r.group(2), d.get('reason') or '',
                                              d.get('fields') if isinstance(d.get('fields'), list) else None))
        if sub == 'pending/approve-all' and m == 'POST':
            n = sum(1 for p in st.pending_list('pending') if self.desk().review(p['id'], 'approve', '')['ok'])
            return self.ok({'approved': n})
        if sub == 'export' and m == 'GET':
            cats = [c for c in (q.get('cats') or '').split(',') if re.match(r'^[A-Za-z0-9_-]{1,64}$', c)] or None
            pick = None
            if q.get('pick'):          # категории, производители, поставщики, фиды — несколько в каждом
                from supplier_scope import ExportScope
                try:
                    pick = ExportScope.clean(json.loads(q['pick'])) or None
                except ValueError as e:
                    return self.err(400, str(e) if 'выбор' in str(e) else 'Неверный выбор позиций каталога')
            flt = None
            if q.get('flt'):           # «Каталог по фильтру»: категория, производитель, поставщик, поиск, с ценой, в наличии
                from supplier_scope import CatalogFilter
                try:
                    flt = CatalogFilter.clean(json.loads(q['flt']))
                except ValueError:
                    return self.err(400, 'Неверный фильтр каталога')
            prices = [x for x in (q.get('prices') or '').split(',') if x in ('price', 'rrc', 'cost', 'stock')]
            return self.export([s for s in (q.get('sections') or ','.join(SECTIONS)).split(',') if s in SECTIONS],
                               cats=cats, images=q.get('images') == '1', sup=(q.get('sup') or '').strip() or None, pick=pick,
                               fmt=q.get('fmt'), flt=flt, prices=prices)
        if sub == 'export/filter' and m == 'GET':      # сколько позиций попадёт в «Каталог по фильтру»
            from supplier_scope import CatalogFilter
            try:
                f = CatalogFilter.clean(json.loads(q.get('flt') or '{}'))
            except ValueError:
                return self.err(400, 'Неверный фильтр каталога')
            return self.ok({'n': len(CatalogFilter(st).ids(f))})
        if sub.startswith('settings-file'):     # все настройки программы одним файлом (ключи API — по галочке, пароли — никогда)
            from data_bundle import SettingsFile
            sf = SettingsFile(st, me or 'admin')
            df = self.data_file()
            if sub == 'settings-file' and m == 'GET':      # любой формат выгрузки (DataFile), как у остальных вариантов
                from data_file import DataFile
                fmt = DataFile.fmt(q.get('fmt'))
                name, body = sf.export(q.get('keys') == '1')
                data, ext, ctype, more = df.dump(body.decode('utf-8'), fmt)
                self.log('export_settings', 'settings', 'file', None, dict(more, keys=q.get('keys') == '1', bytes=len(data), fmt=fmt))
                return self.h.send(200, ctype, data, self.h.attachment(name[:-5] + ext))
            if sub == 'settings-file/preview' and m == 'POST':
                return self.ok(sf.preview(self.settings_doc(df, self.h.body())))
            if sub == 'settings-file' and m == 'POST':
                picked = [x for x in (q.get('sections') or '').split(',') if x] if 'sections' in q else None
                body = self.h.body()
                res = sf.apply(self.settings_doc(df, body), picked)
                res['images'] = self.settings_images(df, body)
                self.log('import_settings', 'settings', 'file', None, res)
                return self.ok(res)
            return self.err(404, 'Нет такого запроса')
        if sub == 'export/cats' and m == 'GET':
            return self.ok(self.export_cats())
        if sub == 'export/scope' and m == 'GET':     # сочетания категория / производитель / поставщик / фид для выбора
            from supplier_scope import ExportScope
            return self.ok(ExportScope(st).summary())
        if sub == 'export/suppliers' and m == 'GET':
            from supplier_scope import SupplierScope
            return self.ok(SupplierScope(st).groups())
        if sub in ('import/file/preview', 'import/file') and m == 'POST':
            return self.ok(self.import_file(self.h.body(), apply=(sub == 'import/file'), sections=q.get('sections'), name=q.get('name') or '',
                                            mode=q.get('mode') if q.get('mode') in ('edits', 'auto') else 'all'))
        if sub == 'export/sqlite' and m == 'GET':
            return self.export_sqlite()
        if sub in ('import/preview', 'import') and m == 'POST':
            return self.ok(self.import_(self.data(), apply=(sub == 'import'), sections=q.get('sections')))
        if sub == 'import/sqlite' and m == 'POST':
            return self.ok(self.import_sqlite(self.h.body(), q.get('name', '')))
        if sub.startswith('maint'):
            return self.maint(m, sub, q)
        if sub == 'migrations':
            from storage import MIGRATIONS
            return self.ok({'applied': st.migrations_applied(), 'all': [x[0] for x in MIGRATIONS], 'last': st.migration_last()})
        r = re.match(r'^migrations/([A-Za-z0-9_.-]+)/down$', sub)
        if r and m == 'POST':
            if r.group(1) != st.migration_last():
                return self.err(400, 'Откатить можно только последнюю миграцию (%s): поздние миграции меняют таблицы ранних' % st.migration_last())
            st.backup(os.path.join(os.path.dirname(st.path), 'backup', 'kp-%s-before-migration-down.zip' % datetime.now().strftime('%Y%m%d-%H%M%S')))
            st.migration_down(r.group(1))
            return self.ok()
        return self.err(404, 'not found')

    # ---------- система: сведения, «требует внимания», обновления, перезапуск, папки ----------
    def system(self, m, sub, q, me):
        import config
        from admin_overview import Attention, SystemInfo
        from app_update import Restarter, UpdateError, Updater
        st, up = self.st, Updater(self.st, config.ROOT, config.DATA_DIR)
        if sub == 'system' and m == 'GET':
            return self.ok(dict(SystemInfo(st, config).get(), local=self.h.is_local()))
        if sub == 'attention' and m == 'GET':
            return self.ok({'items': Attention(st, config).items()})
        if sub == 'log' and m == 'GET':             # журнал сервера: последние ошибки (data/logs/kp.log)
            from server_log import ServerLog
            lg = ServerLog.of(config.DATA_DIR)
            return self.ok({'errors': lg.errors(30), 'day': lg.count_since(24), 'bytes': lg.size(), 'files': len(lg.files()),
                            'dir': lg.folder, 'local': self.h.is_local()})
        if sub == 'log/download' and m == 'GET':
            from server_log import ServerLog
            lg = ServerLog.of(config.DATA_DIR)
            return self.h.send(200, 'text/plain; charset=utf-8', lg.text().encode('utf-8'),
                               self.h.attachment('kp-log_%s.txt' % datetime.now().strftime('%Y-%m-%d_%H%M')))
        if sub.startswith('alerts'):              # письма администратору о проблемах (admin_alerts.py)
            from admin_alerts import AdminAlerts
            al = AdminAlerts(st, config)
            try:
                if sub == 'alerts' and m == 'GET':
                    return self.ok(al.public())
                if sub == 'alerts' and m == 'POST':
                    before = al.public()
                    res = al.save(self.data(), me)
                    self.log('edit_settings', 'settings', 'alerts', {'on': before['on'], 'to': before['to']}, {'on': res['on'], 'to': res['to']})
                    return self.ok(res)
                if sub == 'alerts/test' and m == 'POST':
                    return self.ok(al.test())
            except (ValueError, RuntimeError) as e:
                return self.err(400, str(e))
            return self.err(404, 'not found')
        if sub == 'restart' and m == 'POST':
            self.log('restart', 'system', config.APP_TITLE)
            from server_log import ServerLog
            ServerLog.note('Перезапуск из «Настроек» (%s)' % (me or 'администратор'))
            self.ok({'ok': True, 'delay': Restarter.DELAY})
            Restarter(config.SERVER_MODE).restart(getattr(self.h.server, 'main_server', self.h.server))
            return None
        if sub == 'folder' and m == 'POST':
            if not self.h.is_local():
                return self.err(403, 'Папки открываются только на компьютере, где работает программа')
            from desktop import open_folder
            path = {'data': config.DATA_DIR, 'docs': config.DOCS_DIR, 'root': config.ROOT,
                    'backup': os.path.join(config.DATA_DIR, 'backup'), 'logs': os.path.join(config.DATA_DIR, 'logs')}.get(self.data().get('which'))
            if not path or not os.path.isdir(path):
                return self.err(404, 'Папки нет')
            open_folder(path)
            return self.ok()
        try:
            if sub == 'update' and m == 'GET':
                return self.ok(up.status())
            if sub == 'update' and m == 'POST':
                d = self.data()
                res = up.configure(d, me or 'admin')
                self.log('edit_settings', 'settings', 'update', None, {k: ('задан' if k == 'token' and d[k] else d[k]) for k in d
                                                                       if k in ('repo', 'auto', 'token', 'nightly', 'nightHour')})
                return self.ok(res)
            if sub == 'update/check' and m == 'POST':
                return self.ok(up.check())
            if sub in ('update/download', 'update/upload') and m == 'POST':
                res = up.download_latest(me or 'admin') if sub == 'update/download' else \
                    up.install(self.h.body(), me or 'admin', source='файл ' + str(q.get('name') or '')[:80], force=q.get('force') == '1')
                self.log('update_install', 'system', res['version'], {'version': res['from']}, {'version': res['version'], 'files': res['files']})
                return self.ok(res)
            if sub == 'update/rollback' and m == 'POST':
                res = up.rollback(me or 'admin')
                self.log('update_rollback', 'system', res['version'])
                return self.ok(res)
            if sub == 'update/remove' and m == 'POST':
                res = up.remove(me or 'admin')
                self.log('update_remove', 'system', 'EXE')
                return self.ok(res)
        except UpdateError as e:
            return self.err(422, str(e))
        return self.err(404, 'not found')

    # ---------- история изменений настроек ----------
    def history(self, m, sub, q):
        from settings_history import SettingsHistory
        sh = SettingsHistory(self.st)
        if sub == 'history' and m == 'GET':
            key = q.get('key') if q.get('key') in SettingsHistory.KEYS else None
            limit, offset = max(1, min(int(q.get('limit') or 100), 500)), max(0, min(int(q.get('offset') or 0), SettingsHistory.KEEP))
            return self.ok({'items': sh.items(key, limit, offset),
                            'keys': SettingsHistory.KEYS})
        r = re.match(r'^history/(\d{1,9})(/rollback)?$', sub)
        if r and m == 'GET' and not r.group(2):
            return self.ok(sh.get(r.group(1)))
        if r and m == 'POST' and r.group(2):
            res = sh.rollback(r.group(1), actor(self.h, True)[1])
            self.log('rollback_settings', 'settings', res['key'], None, {'history': res['id'], 'title': res['title']})
            return self.ok(res)
        return self.err(404, 'not found')

    # ---------- обслуживание базы: копии, сжатие, журнал, изображения ----------
    def maint(self, m, sub, q):
        import maintenance as mt
        st = self.st
        data_dir = os.path.dirname(st.path)
        img_dir = os.path.join(data_dir, 'img')
        if sub == 'maint' and m == 'GET':
            return self.ok(mt.summary(st, data_dir))
        if sub == 'maint/overview' and m == 'GET':      # сводка над вкладкой «База и копии»
            from admin_overview import DbOverview
            return self.ok(DbOverview(st, data_dir).get())
        if sub == 'maint/backup' and m == 'POST':
            rec = mt.DbCopy.daily(st, data_dir, force=True)
            self.log('backup_db', 'db', 'auto', None, {'ok': rec.get('ok'), 'file': os.path.basename(rec.get('file') or '')}, result='success' if rec.get('ok') else 'failed')
            from backup_mirror import MirrorBackup
            mb = MirrorBackup(st, data_dir)
            if mb.config()['on'] and not mb.status()['running']:
                threading.Thread(target=mb.run, daemon=True, name='backup-mirror').start()
            return self.ok(mt.summary(st, data_dir))
        if sub.startswith('maint/mirror'):         # вторая папка для копий базы (сетевой диск, флешка, облако)
            from backup_mirror import MirrorBackup
            mb = MirrorBackup(st, data_dir)
            if sub == 'maint/mirror' and m == 'GET':
                return self.ok(mb.status())
            if sub == 'maint/mirror' and m == 'POST':
                res = mb.save(self.data(), actor(self.h, True)[1])
                self.log('edit_settings', 'settings', 'backup2', None, {k: res[k] for k in ('on', 'path', 'keep', 'images')})
                return self.ok(res)
            if sub == 'maint/mirror/check' and m == 'POST':
                return self.ok(mb.check(self.data().get('path')))
            if sub == 'maint/mirror/run' and m == 'POST':
                res = mb.start()
                self.log('backup_db', 'db', 'mirror', None, {'path': res.get('path')})
                return self.ok(res)
        if sub == 'maint/run' and m == 'POST':
            rec = mt.db_maintenance(st, vacuum=True)
            self.log('maintain_db', 'db', 'vacuum', None, rec.get('vacuum'))
            return self.ok(mt.summary(st, data_dir))
        if sub == 'maint/audit' and m == 'POST':
            years = int(self.data().get('years') or 0)
            if years < 1 or years > 20:
                raise ValueError('Срок хранения журнала — от 1 до 20 лет')
            cfg = st.kv_get('settings') or {}
            cfg['auditYears'] = years
            st.kv_set('settings', cfg)
            n = mt.archive_audit(st, data_dir, years)
            self.log('edit_settings', 'settings', 'auditYears', None, {'years': years, 'archived': n})
            return self.ok(dict(mt.summary(st, data_dir), archivedNow=n))
        if sub == 'maint/images' and m == 'GET':
            lst = mt.unused_images(st, img_dir)
            return self.ok({'count': len(lst), 'bytes': sum(x['bytes'] for x in lst), 'sample': [x['rel'] for x in lst[:20]]})
        if sub == 'maint/images' and m == 'POST':
            import feeds           # хранилище изображений: его индекс одинаковых картинок после очистки строится заново
            res = mt.purge_images(st, img_dir, feeds.IMAGE_STORE)
            self.log('purge_images', 'images', 'unused', None, res)
            return self.ok(res)
        return self.err(404, 'not found')

    # ---------- учётные записи администраторов ----------
    def access_act(self, mid, act, me):
        """Менеджер: «Сбросить пароль» — временный пароль (в ответе один раз; в журнал — только факт и срок), все его входы
        закрываются; «Выйти на всех устройствах» — закрыть все его входы."""
        st = self.st
        if not any(x.get('id') == mid for x in (_loads(st.managers_list()) or [])):
            return self.err(404, 'Менеджер не найден')
        if act == 'reset':
            pw, hours, until = auth_users.TempPassword.issue(st, mid, hash_password, me or 'admin')
            self.log('reset_password', 'manager', mid, None, {'temp': True, 'hours': hours, 'until': until})
            return self.ok({'password': pw, 'hours': hours, 'until': until})
        closed = auth_users.UserSession.drop_all(st, mid)
        self.log('logout_all', 'manager', mid, None, {'closedSessions': closed})
        return self.ok({'closed': closed})

    def users(self, d, me):
        st, users, act = self.st, accounts(self.st), d.get('action')
        login = (d.get('login') or '').strip()
        u = find_account(users, login)
        if act == 'add':
            check_login(login)
            if u:
                raise ValueError('Логин «%s» уже занят' % login)
            check_new_password(d.get('password') or '')
            u = {'login': login, 'name': (d.get('name') or '').strip()[:80] or login, 'pw': hash_password(d['password']), 'created': _now(), 'by': me}
            users.append(u)
            save_accounts(st, users)
            self.log('create_admin', 'admin', login, None, {'login': login, 'name': u['name']})
            return {'ok': True}
        if not u:
            raise ValueError('Учётная запись не найдена')
        if act == 'edit':
            before = {'login': u['login'], 'name': u.get('name', '')}
            new_login = (d.get('newLogin') or u['login']).strip()
            if new_login.lower() != u['login'].lower():
                check_login(new_login)
                if find_account(users, new_login):
                    raise ValueError('Логин «%s» уже занят' % new_login)
            u['login'], u['name'] = new_login, (d.get('name') or '').strip()[:80] or new_login
            save_accounts(st, users)
            self.log('edit_admin', 'admin', u['login'], before, {'login': u['login'], 'name': u['name']})
            AdminSessions.rename(login, u['login'], u['name'])
            return {'ok': True}
        if act == 'password':
            check_new_password(d.get('password') or '')
            u['pw'] = hash_password(d['password'])
            save_accounts(st, users)
            AdminSessions.drop_login(u['login'], keep=_cookie_token(self.h))     # сменён пароль — другие входы закрыты
            self.log('set_password', 'admin', u['login'])
            return {'ok': True}
        if act == 'delete':
            if len(users) <= 1:
                raise ValueError('Нельзя удалить единственного администратора')
            if u['login'].lower() == me.lower():
                raise ValueError('Нельзя удалить свою учётную запись — войдите под другим администратором')
            users.remove(u)
            save_accounts(st, users)
            AdminSessions.drop_login(u['login'])
            self.log('delete_admin', 'admin', u['login'], {'login': u['login'], 'name': u.get('name', '')}, None)
            return {'ok': True}
        raise ValueError('Неизвестное действие')

    # ---------- удаление (в корзину) ----------
    def listing(self, etype, qs):
        st, ql = self.st, qs.lower()
        if etype == 'kp':
            from kp_files import KpFiles
            metas = st.kp_all_meta()
            nf = KpFiles.of(st).counts([x.get('id') for x in metas])       # справочные документы — «📎» у КП (удаляет администратор)
            rows = [{'id': x.get('id'), 'title': '№ %s — %s' % (x.get('number', ''), x.get('client', '')), 'files': nf.get(x.get('id'), 0),
                     'sub': '%s · %s · %s' % (x.get('date', ''), x.get('manager') or '—', (x.get('items') or [''])[0])} for x in metas]
            rows.sort(key=lambda r: r['title'], reverse=True)
        elif etype == 'catalog':
            rows = [{'id': x['id'], 'title': x.get('name', ''), 'sub': ' · '.join(str(v) for v in ((x.get('attrs') or {}).get('maker'), x.get('spec')) if v)}
                    for x in json.loads(st.catalog_light())]
        elif etype == 'manager':
            rows = [{'id': x['id'], 'title': x.get('name', ''), 'sub': ' · '.join(v for v in (x.get('position'), x.get('phone')) if v)}
                    for x in json.loads(st.managers_list())]
        elif etype == 'supplier':
            rows = [{'id': x['id'], 'title': x.get('name', ''), 'sub': ' · '.join(v for v in (x.get('country'), x.get('currency')) if v)}
                    for x in st.suppliers_list()]
        else:       # контрагентов тысячи: ищем в базе, показываем первые 300
            found = st.clients_search(qs, 300)
            rows = [{'id': x['id'], 'title': x.get('name', ''), 'sub': 'ИНН %s' % x.get('inn', '')} for x in found['items']]
            return {'total': found['total'], 'items': rows}
        if ql:
            rows = [r for r in rows if ql in (r['title'] + ' ' + r['sub'] + ' ' + str(r['id'])).lower()]
        return {'total': len(rows), 'items': rows if etype != 'catalog' else rows[:300]}

    def delete(self, d):
        etype, ids = d.get('type'), d.get('ids') or []
        if etype not in ('kp', 'catalog', 'manager', 'client', 'supplier') or not isinstance(ids, list) or not ids:
            raise ValueError('Не выбрано, что удалить')
        if etype == 'catalog':       # название позиции — запросом по id, а не разбором всего каталога на каждую позицию
            found = {eid: self.st.one('SELECT name FROM catalog WHERE id=?', (eid,)) for eid in ids if isinstance(eid, str)}
            titles = {eid: found[eid][0] if found.get(eid) else str(eid) for eid in ids}
        elif etype == 'client':      # контрагентов тысячи — по одному, а не списком
            titles = {eid: (self.st.client_get(str(eid)) or {}).get('name') or str(eid) for eid in ids}
        else:
            rows = {r['id']: r['title'] for r in self.listing(etype, '')['items']}
            titles = {eid: rows.get(eid) or str(eid) for eid in ids}
        n = 0
        for eid in ids:
            data = self.st.trash_put(etype, str(eid), titles.get(eid, str(eid)), actor(self.h, True)[1])
            self.log('delete_' + etype, etype, eid, {'title': titles.get(eid, '')} if data else None, None,
                     result='success' if data else 'failed')
            n += bool(data)
        return self.ok({'deleted': n})

    # ---------- модерация и корзина (catalog_admin.py) ----------
    def desk(self):
        from catalog_admin import ModerationDesk
        return ModerationDesk(self.st, actor(self.h, True)[1], self.log)

    def review(self, eid, act, reason):
        return self.desk().review(eid, act, reason)

    def trash(self, m, sub, q):
        """Корзина: список (?type=вид), восстановить, удалить навсегда одну запись, очистить (всё или один вид)."""
        from catalog_admin import TrashBin
        tb = TrashBin(self.st, self.log)
        if sub == 'trash':
            etype = q.get('type') or ''
            return self.ok(dict(tb.items(etype if etype in TrashBin.TYPES else ''), days=SrvVal.get(self.st, 'srv.trashDays')))
        if m != 'POST':
            return self.err(405, 'Нужен POST')
        if sub == 'trash/clear':
            return self.ok({'deleted': tb.clear(str(self.data().get('type') or ''))})
        r = re.match(r'^trash/(\d{1,9})/(restore|purge)$', sub)
        if not r:
            return self.err(404, 'Нет такого запроса')
        tb.restore(int(r.group(1))) if r.group(2) == 'restore' else tb.drop(int(r.group(1)))
        return self.ok()

    def toggle(self, d):
        before = moderation(self.st)
        on = bool(d.get('enabled'))
        pend = self.st.pending_list('pending')
        if not on and pend:
            how = d.get('pending')
            if how not in ('apply', 'reject', 'archive'):
                return self.err(409, 'Есть правки на модерации (%d): выберите, что с ними сделать' % len(pend))
            for p in pend:
                if how == 'archive':
                    self.st.pending_set(p['id'], 'archived', actor(self.h, True)[1], 'Модерация отключена')
                else:
                    self.review(p['id'], 'approve' if how == 'apply' else 'reject', 'Модерация отключена')
        _set_moderation(self.st, on, actor(self.h, True)[1])
        self.log('toggle_moderation', 'settings', 'productEditModeration', before, moderation(self.st))
        return self.ok({'settings': moderation(self.st)})

    def rollback(self, aid):
        e = self.st.audit_get(aid)
        if not e or e['action'] not in ('edit_product', 'approve_edit') or not isinstance(e.get('before'), dict):
            raise ValueError('Эту запись откатить нельзя')
        if any(isinstance(v, dict) and '__truncated__' in v for v in e['before'].values()):
            raise ValueError('Правка слишком большая для отката — исправьте позицию вручную')
        cur = _loads(self.st.catalog_get(e['entityId']))
        if cur is None:
            raise ValueError('Товара больше нет в каталоге')
        new = dict(cur)
        for k, v in e['before'].items():
            if v == ABSENT:
                new.pop(k, None)
            else:
                new[k] = v
        self.st.catalog_put(e['entityId'], json.dumps(new, ensure_ascii=False))
        b, a = diff(cur, new)
        self.log('rollback_edit', 'product', e['entityId'], b, dict(a, __audit__=aid))
        return self.ok()

    # ---------- резервные копии ----------
    def bundle(self):
        from data_bundle import DataBundle
        return DataBundle(os.path.join(os.path.dirname(self.st.path), 'img'))

    def export_cats(self):
        """Категории каталога для выборочной выгрузки: [{cat, count}] (названия и группы — у клиента в справочнике типов)."""
        return [{'cat': c or '', 'count': n} for c, n in self.st.all('SELECT cat, COUNT(*) FROM catalog GROUP BY cat ORDER BY cat')]

    def export(self, sections, cats=None, images=False, sup=None, pick=None, fmt=None, flt=None, prices=None):
        """Выбранные разделы базы файлом в любом формате (DataFile: xlsx, json, xml, yml, zip — решение владельца 18.10).
        cats — только эти категории каталога; images — прежний вызов: архив .zip с изображениями; sup — только позиции этого
        поставщика (SupplierScope), без цен и остатков; pick — категории, производители, поставщики, фиды (ExportScope);
        flt — «Каталог по фильтру» (CatalogFilter): prices — какие группы цен войдут (price, rrc, cost, stock), остальные
        остаются в базе при загрузке (keep). В файле — отпечатки записей (digests): при загрузке «только изменённое»."""
        from data_file import DataFile
        from supplier_scope import SupplierScope
        st, out, items, catalog, keep, ids, docs, src = self.st, {}, 0, '[]', None, None, None, None
        fmt = DataFile.fmt(fmt, 'zip' if images else 'json')
        if fmt == 'yml':
            # YML — каталог для сайтов и маркетплейсов: только каталог и без закупки (она при загрузке остаётся в базе)
            if 'catalog' not in sections and not sup:
                raise ValueError('YML — формат каталога: отметьте раздел «Каталог» или выберите другой формат')
            sections = ['catalog']
        if sup:
            docs = SupplierScope(st).docs(sup)
            sections, cats, items, keep = ['catalog'], None, len(docs), list(SupplierScope.PRICE_KEYS)
            catalog = json.dumps(docs, ensure_ascii=False)
            out['catalog'] = None
        elif 'catalog' in sections and (pick or flt is not None):
            from supplier_scope import CatalogFilter, ExportScope
            if flt is not None:
                ids, keep = CatalogFilter(st).ids(flt), CatalogFilter.keep(prices)
                sections = ['catalog']
            else:
                ids = ExportScope(st).ids(pick)
            out['catalog'] = None
            items = len(ids)
            parts = [st.joined('SELECT doc AS x FROM catalog WHERE id IN (%s) ORDER BY name' % ','.join('?' * len(ids[i:i + 500])), tuple(ids[i:i + 500]))
                     for i in range(0, len(ids), 500)]
            catalog = '[' + ','.join(x for x in parts if x) + ']'
            if keep:
                docs = [SupplierScope.strip(d, keep) for d in json.loads(catalog)]
                catalog = json.dumps(docs, ensure_ascii=False)
            elif fmt != 'yml':
                src = ('WHERE id IN (%s)', ids)
        elif 'catalog' in sections:
            # каталог — готовыми строками из базы, без разбора и повторной сборки: 25 000 позиций занимали 1,3 ГБ памяти сервера
            where, args = ('WHERE cat IN (%s)' % ','.join('?' * len(cats)), tuple(cats)) if cats else ('', ())
            out['catalog'] = None
            items = st.one('SELECT COUNT(*) FROM catalog ' + where, args)[0]
            catalog = '[' + st.joined('SELECT doc AS x FROM catalog %s ORDER BY name' % where, args) + ']'
            src = (where, args)
        if fmt == 'yml' and 'catalog' in out:
            cost = list(SupplierScope.COST_KEYS)
            docs = [SupplierScope.strip(d, cost) for d in (docs if docs is not None else json.loads(catalog))]
            catalog, keep, src = json.dumps(docs, ensure_ascii=False), sorted(set(keep or []) | set(cost)), None
        cur = self.current(sections)
        for k in ('kp', 'managers', 'clients', 'audit', 'suppliers', 'settings'):
            if k in cur:
                out[k] = cur[k]
        digests = self.digests(out, ('catalog' in out) and (docs if docs is not None and src is None else self._rows(src) if src else json.loads(catalog)))
        secs = ','.join('%s:%s' % (json.dumps(k), catalog if k == 'catalog' else json.dumps(v, ensure_ascii=False)) for k, v in out.items())
        extra = (',"cats":%s' % json.dumps(cats, ensure_ascii=False) if cats else '') + (
            ',"pick":%s' % json.dumps({k: sorted(v) for k, v in pick.items()}, ensure_ascii=False) if pick and 'catalog' in sections else '') + (
            ',"supplier":%s' % json.dumps(sup, ensure_ascii=False) if sup else '') + (
            ',"keep":%s' % json.dumps(keep) if keep else '') + (
            ',"filter":%s' % json.dumps(flt, ensure_ascii=False, default=sorted) if flt is not None else '') + (
            ',"digests":%s' % json.dumps(digests, separators=(',', ':')))
        from version import VERSION
        body = '{"format":"kp-backup","version":1,"app":%s,"createdAt":%s,"sections":{%s}%s}' % (json.dumps(VERSION), json.dumps(_now()), secs, extra)
        what = ('+'.join(SECTION_FILE[x] for x in sections) if len(sections) < len(SECTIONS) else 'вся_база') + ('_категорий-%d' % len(cats) if cats else '') + (
            '_выборка-%d' % items if (pick or flt is not None) and 'catalog' in sections else '')
        if sup:
            what = 'каталог_' + (re.sub(r'[^\w.-]+', '_', sup).strip('_')[:60] or 'поставщик')
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        info = {'sections': sections, 'cats': cats, 'items': items, 'fmt': fmt}
        if pick:
            info['pick'] = {k: len(v) for k, v in pick.items()}
        if flt is not None:
            info['filter'] = True
            info['keep'] = keep or []
        if sup:
            info['supplier'] = sup[:120]
        data, ext, ctype, more = self.data_file().dump(body, fmt)
        del body
        self.log('export_db', 'db', ','.join(sections), None, dict(info, bytes=len(data), **more))
        return self.h.send(200, ctype, data, self.h.attachment('КП_выгрузка_%s_%s%s' % (what, stamp, ext)))

    def data_file(self):
        """Форматы выгрузки: подписи столбцов Excel — из справочника категорий, ссылки на фото в YML — адрес программы."""
        from data_file import DataFile
        from equipment_types import load_types
        types = {t.get('id'): t for t in load_types()['types'] if isinstance(t, dict)}
        labels = {}
        for t in types.values():
            for f in t.get('fields') or []:
                if isinstance(f, dict) and f.get('key') and f.get('label'):
                    labels.setdefault('attrs.%s' % f['key'], f['label'] + (', ' + f['unit'] if f.get('unit') else ''))
        host = re.sub(r'[^A-Za-z0-9.:\-\[\]]', '', self.h.headers.get('Host') or '')
        return DataFile(os.path.join(os.path.dirname(self.st.path), 'img'), 'http://' + host if host else '', labels, types)

    def current(self, sections):
        """Разделы базы, кроме каталога, — как в файле выгрузки."""
        st, out = self.st, {}
        if 'kp' in sections:
            out['kp'] = [dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated', 'track'), r))
                         for r in st.all('SELECT id, number, state, meta, docx, updated, track FROM kp')]
        if 'managers' in sections:
            out['managers'] = json.loads(st.managers_list())
        if 'clients' in sections:
            out['clients'] = st.clients_all()
        if 'audit' in sections:
            out['audit'] = st.audit_query({}, 10 ** 7)['items']
        if 'suppliers' in sections:
            out['suppliers'] = {'suppliers': [{k: v for k, v in x.items() if k != '_rev'} for x in st.suppliers_list()],
                                'customs': st.customs_all()}
        if 'settings' in sections:
            from data_bundle import ProgramSettings
            out['settings'] = ProgramSettings(st).export()
        return out

    def _rows(self, src):
        """Позиции каталога по одной (для отпечатков): условие WHERE … или список id."""
        where, args = src
        if '%s' in where:
            for i in range(0, len(args), 500):
                part = tuple(args[i:i + 500])
                for (d,) in self.st.all('SELECT doc FROM catalog ' + where % ','.join('?' * len(part)), part):
                    yield _loads(d) or {}
            return
        for (d,) in self.st.all('SELECT doc FROM catalog ' + where, args):
            yield _loads(d) or {}

    def digests(self, out, catalog):
        """Отпечатки записей на момент выгрузки: {раздел: {id: отпечаток}}; у настроек — {"_": отпечаток}. Каталог —
        без цен и остатков (их при загрузке «только изменённого» программа не меняет)."""
        from data_file import DataFile
        from supplier_scope import SupplierScope
        res = {}
        if catalog:
            res['catalog'] = {x['id']: DataFile.digest(x, SupplierScope.VOLATILE) for x in catalog if isinstance(x, dict) and x.get('id')}
        for k in ('kp', 'managers', 'clients'):
            if isinstance(out.get(k), list):
                res[k] = {str(x.get('id')): DataFile.digest(x) for x in out[k] if isinstance(x, dict) and x.get('id')}
        if isinstance(out.get('suppliers'), dict):
            res['suppliers'] = {str(x.get('id')): DataFile.digest(x) for x in out['suppliers'].get('suppliers') or [] if x.get('id')}
        if 'settings' in out:
            res['settings'] = {'_': DataFile.digest(out['settings'])}
        return res

    def export_sqlite(self):
        """Файл базы целиком — архивом ZIP (kp.sqlite3 внутри): в 15–20 раз меньше, загружается обратно как есть."""
        tmp = os.path.join(os.path.dirname(self.st.path), 'backup', 'export-%s.zip' % secrets.token_hex(4))
        self.st.backup(tmp)
        try:
            with open(tmp, 'rb') as f:
                data = f.read()
        finally:
            os.remove(tmp)
        self.log('export_db', 'db', 'sqlite', None, {'bytes': len(data)})
        return self.h.send(200, 'application/zip', data, self.h.attachment('kp_%s.zip' % datetime.now().strftime('%Y-%m-%d_%H%M')))

    def import_sqlite(self, data, name=''):
        """Файл базы целиком (.sqlite3 или .zip с ним): проверка, копия текущей базы, замена содержимого «на ходу»."""
        import zipfile
        import io
        from storage import DbZip
        if not data:
            raise ValueError('Файл пустой')
        tmp = os.path.join(os.path.dirname(self.st.path), 'backup', 'import-%s.sqlite3' % secrets.token_hex(4))
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        try:
            if data[:2] == b'PK':
                try:
                    DbZip.unpack(io.BytesIO(data), tmp)
                except zipfile.BadZipFile:
                    raise ValueError('Архив повреждён или это не архив ZIP')
            else:
                with open(tmp, 'wb') as f:
                    f.write(data)
            with open(tmp, 'rb') as f:
                if f.read(16) != b'SQLite format 3\x00':
                    raise ValueError('Это не файл базы SQLite (.sqlite3) и не архив с ним')
            bak = self.st.restore_sqlite(tmp)
        finally:
            for ext in ('', '-wal', '-shm', '-journal'):
                try:
                    os.remove(tmp + ext)
                except OSError:
                    pass
        rep = {'catalog': self.st.one('SELECT COUNT(*) FROM catalog')[0], 'kp': self.st.one('SELECT COUNT(*) FROM kp')[0],
               'clients': self.st.one('SELECT COUNT(*) FROM clients')[0], 'backup': bak, 'file': str(name or '')[:120]}
        self.log('import_db', 'db', 'sqlite', None, {'bytes': len(data), 'file': rep['file'], 'backup': bak, 'catalog': rep['catalog'], 'kp': rep['kp']})
        return rep

    def import_(self, d, apply, sections=None, mode='all', fmt='json'):
        """Проверка схемы и предпросмотр (что добавится / обновится); apply — запись после копии базы.
        Ничего не удаляется. Журнал действий не импортируется. mode «edits» (только изменённое в файле): запись, которую в
        файле не меняли, пропускается; изменённую в файле, но уже изменённую и в программе после выгрузки, — тоже (в отчёт);
        у позиций каталога цены и остатки остаются как в базе."""
        if not isinstance(d, dict) or d.get('format') != 'kp-backup' or d.get('version') != 1 or not isinstance(d.get('sections'), dict):
            raise ValueError('Это не выгрузка данных программы: нужен файл «КП_выгрузка_…», выгруженный в «База и копии → Выгрузить»')
        from data_file import DataFile
        sec = d['sections']
        want = [s for s in (sections or 'catalog,kp,managers,clients,suppliers,settings').split(',') if s in sec and s != 'audit' and s in SECTIONS]
        st, rep, errors, conflicts = self.st, {}, [], []
        from supplier_scope import SupplierScope
        keep = SupplierScope.keep_of(d)      # выгрузка без цен и остатков: у имеющихся позиций они остаются как в базе
        digs = d.get('digests') if isinstance(d.get('digests'), dict) else {}
        edits = mode == 'edits' and bool(digs)
        if edits:
            keep = list(SupplierScope.PRICE_KEYS)
        by = actor(self.h, True)[1]
        backup = self.import_backup() if apply else None
        exist = {'catalog': {x['id']: x for x in json.loads(st.catalog_light())},
                 'kp': {r[0]: r for r in st.all('SELECT id, meta FROM kp')},
                 'managers': {x['id']: x for x in json.loads(st.managers_list())},
                 'clients': {x['id']: x for x in st.clients_all()},
                 'suppliers': {x['id']: x for x in st.suppliers_list()}}
        req = {'catalog': ('id', 'name'), 'kp': ('id', 'number'), 'managers': ('id', 'name'), 'clients': ('id',), 'suppliers': ('id', 'name')}
        from data_bundle import ProgramSettings

        def now_of(s, cid):
            """Запись базы сейчас — в том же виде, что в файле выгрузки (для сравнения отпечатков)."""
            if s == 'catalog':
                return _loads(st.catalog_get(cid)) or {}
            if s == 'kp':
                r = st.one('SELECT id, number, state, meta, docx, updated, track FROM kp WHERE id=?', (cid,))
                return dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated', 'track'), r)) if r else {}
            x = exist[s].get(cid) or {}
            return {k: v for k, v in x.items() if k != '_rev'}

        for s in want:
            if s == 'settings':
                n = ProgramSettings(st).count(sec[s])
                if edits and (digs.get('settings') or {}).get('_'):
                    o = digs['settings']['_']
                    if DataFile.digest(sec[s]) == o:
                        rep[s] = {'new': 0, 'updated': 0, 'invalid': 0, 'same': n}
                        want = [x for x in want if x != 'settings']
                        continue
                    if DataFile.digest(ProgramSettings(st).export()) != o:
                        rep[s] = {'new': 0, 'updated': 0, 'invalid': 0, 'conflict': n}
                        conflicts.append('Настройки программы — изменены и в программе после выгрузки')
                        want = [x for x in want if x != 'settings']
                        continue
                rep[s] = {'new': 0, 'updated': n, 'invalid': 0}
                continue
            if s == 'suppliers':     # {suppliers: [...], customs: {ключ: {code, duty, note, name}}}
                rows = (sec[s].get('suppliers') if isinstance(sec[s], dict) else None) or []
            else:
                rows = sec[s] if isinstance(sec[s], list) else []
            for x in rows:
                if isinstance(x, dict) and isinstance(x.get('id'), (int, float)) and not isinstance(x.get('id'), bool):
                    x['id'] = str(int(x['id'])) if float(x['id']).is_integer() else str(x['id'])
            bad = [i for i, x in enumerate(rows) if not isinstance(x, dict) or any(not x.get(k) for k in req[s])
                   or not re.match(r'^[A-Za-z0-9_-]{1,64}$', str(x.get('id')))]
            errors += ['%s: запись %d без обязательных полей %s' % (s, i + 1, ', '.join(req[s])) for i in bad[:5]]
            # то, на чём запись споткнулась бы посередине загрузки, — видно уже в предпросмотре и пропускается
            more = []
            for i, x in enumerate(rows):
                if i in bad:
                    continue
                if s == 'kp' and not st.kp_import_ok(x):
                    more.append(i)
                    errors.append('КП %s: испорченная запись — пропущено' % (x.get('number') or x.get('id')))
                elif s == 'managers':
                    dup = st.manager_dup(x['id'], x)
                    if dup:
                        more.append(i)
                        errors.append('Менеджер «%s»: такой уже есть — %s (совпадает %s), пропущено' % (x.get('name'), dup[0].get('name') or 'без имени', dup[1]))
            bad += more
            skip = set(bad)
            ok = [x for i, x in enumerate(rows) if i not in skip]
            same = conf = 0
            if edits:
                dg, sk, left = digs.get(s) or {}, SupplierScope.VOLATILE if s == 'catalog' else (), []
                for x in ok:
                    o = dg.get(str(x['id']))
                    if o and DataFile.digest(x, sk) == o:
                        same += 1
                        continue
                    if o and x['id'] in exist[s] and DataFile.digest(now_of(s, x['id']), sk) != o:
                        conf += 1
                        if len(conflicts) < 30:
                            conflicts.append('%s «%s» — изменено и в программе после выгрузки' % (
                                {'catalog': 'Позиция', 'kp': 'КП', 'managers': 'Менеджер', 'clients': 'Клиент', 'suppliers': 'Поставщик'}[s],
                                x.get('name') or x.get('number') or x['id']))
                        continue
                    left.append(x)
                ok = left
            rep[s] = {'new': sum(1 for x in ok if x['id'] not in exist[s]), 'updated': sum(1 for x in ok if x['id'] in exist[s]),
                      'invalid': len(bad)}
            if edits:
                rep[s].update(same=same, conflict=conf)
            if apply:
                if s == 'catalog':
                    for x in ok:
                        y = {k: v for k, v in x.items() if k not in ('_light', 'st', 'pricesCount')}
                        if keep and x['id'] in exist[s]:
                            y = SupplierScope.merge(y, _loads(st.catalog_get(x['id'])) or {}, keep)
                        st.catalog_put(x['id'], json.dumps(y, ensure_ascii=False))
                elif s == 'kp':
                    for x in ok:
                        st.kp_import(x)
                elif s == 'managers':
                    for x in ok:
                        st.manager_put(x['id'], json.dumps(x, ensure_ascii=False))
                elif s == 'suppliers':
                    for x in ok:
                        st.supplier_put(x['id'], x, by)
                    customs = sec[s].get('customs') if isinstance(sec[s].get('customs'), dict) else {}
                    now = st.customs_all() if edits else {}
                    for key, c in customs.items():
                        if isinstance(c, dict) and re.match(r'^(cat|item):[\w.-]{1,80}$', str(key)):
                            if edits and all(str(c.get(f) or '') == str((now.get(key) or {}).get(f) or '') for f in ('code', 'duty', 'note', 'name')):
                                continue      # «только изменённое»: такие же коды ТН ВЭД не переписываются
                            st.customs_put(key, c.get('code'), c.get('duty'), c.get('note'), by, c.get('name') or '')
                else:
                    for x in ok:
                        st.client_put(x['id'], x)
        if apply and 'settings' in want and isinstance(sec['settings'], dict):
            ProgramSettings(st).apply(sec['settings'])
        if apply:
            self.log('import_db', 'db', ','.join(want), None, {'report': rep, 'createdAt': d.get('createdAt'), 'backup': backup,
                                                                'fmt': fmt, 'mode': 'edits' if edits else 'all'})
        return {'report': rep, 'errors': errors, 'createdAt': d.get('createdAt'), 'applied': apply, 'keep': bool(keep) and not edits,
                'supplier': str(d.get('supplier') or '')[:120], 'digests': bool(digs), 'mode': 'edits' if edits else 'all',
                'conflicts': conflicts}

    def import_file(self, data, apply, sections=None, name='', mode='all'):
        """Файл любого формата выгрузки (DataFile: .xlsx, .json, .xml, .yml, .zip с изображениями) — предпросмотр или загрузка
        (изображения — только недостающие); книга Excel «для правки» (3.98, CatalogSheet) — как файл правок каталога.
        Файл базы целиком и файл настроек здесь не загружаются — ответ kind подсказывает, куда их загрузить.
        mode «edits» — только записи, изменённые в файле после выгрузки (по отпечаткам digests)."""
        from catalog_patch import CatalogPatch, CatalogSheet
        from data_file import DataFile
        kind = DataFile.sniff(data)
        if kind in ('sqlite', 'sqlite-zip'):
            if apply:
                raise ValueError('Это файл базы целиком — загрузите его в «Загрузить → Файл базы целиком»')
            return {'kind': 'sqlite'}
        if kind == 'xlsx-patch':
            d, z, imgs = CatalogSheet(self.st).patch(data, str(name)[:120]), None, []
        else:
            d, z, imgs = self.data_file().load(data)
        if isinstance(d, dict) and d.get('format') == 'kp-settings':
            if z:
                z.close()
            if apply:
                raise ValueError('Это файл настроек — загрузите его в «Загрузить → Файл настроек»')
            return {'kind': 'settings'}
        b = self.bundle()
        if CatalogPatch.is_patch(d):        # правки каталога: только перечисленные поля позиций, цены и остатки не трогаются
            if z:
                z.close()
            res = CatalogPatch(self.st).run(d, apply, actor(self.h, True)[1], self.import_backup)
            if apply:
                self.log('import_db', 'db', 'catalog-patch', None, {'title': res['patch']['title'], 'items': res['patch']['written'],
                                                                     'fields': res['patch']['fields'], 'skipped': res['patch']['conflictCount']})
            return res
        if mode == 'auto':          # Excel — по умолчанию «только изменённое в файле», остальное — «всё как в файле»
            mode = 'edits' if kind == 'xlsx' else 'all'
        try:
            res = self.import_(d, apply, sections, mode, kind)
            res['images'] = b.plan(imgs) if imgs else None
            res['fmt'] = kind
            if apply and imgs:
                res['images']['written'] = b.write(z, imgs)
                try:
                    import web_api
                    web_api.IMAGES.index = None     # новые файлы — в учёт одинаковых изображений
                except Exception:
                    pass
            return res
        finally:
            if z:
                z.close()

    def settings_doc(self, df, data):
        """Файл настроек любого формата → документ kp-settings (проверку делает SettingsFile.read)."""
        from data_file import DataFile
        kind = DataFile.sniff(data)
        if kind not in ('json', 'zip', 'xlsx', 'xml'):
            raise ValueError('Это не файл настроек программы')
        if kind == 'json':
            return data
        d, z, _ = df.load(data)
        if z:
            z.close()
        return d

    def settings_images(self, df, data):
        """Архив .zip настроек: недостающие изображения (логотипы производителей) — в папку img."""
        from data_file import DataFile
        if DataFile.sniff(data) != 'zip':
            return None
        _, z, imgs = df.load(data)
        try:
            return self.bundle().write(z, imgs) if imgs else 0
        finally:
            z.close()

    def import_backup(self):
        return self.st.backup(os.path.join(os.path.dirname(self.st.path), 'backup', 'kp-%s-before-import.zip' % datetime.now().strftime('%Y%m%d-%H%M%S')))


# ---------------------------------------------------------------- статистика
def stats(st):
    metas = st.kp_all_meta()
    now = datetime.now()
    today = now.date()

    def day(x):
        v = x.get('createdAt') or x.get('savedAt') or x.get('date') or ''
        try:
            return datetime.fromisoformat(v[:19]).date() if len(v) > 10 else datetime.strptime(v[:10], '%Y-%m-%d').date()
        except ValueError:
            return None
    days = [(day(x), x) for x in metas]
    top, active = SrvVal.get(st, 'srv.statTop'), SrvVal.get(st, 'srv.statActiveDays')

    def count(n):
        return sum(1 for d, _ in days if d and (today - d).days < n)

    def rub(x):
        e = x.get('econ') if isinstance(x.get('econ'), dict) else {}
        return econ_rub({'econ': {'cur': 'RUB', 'sum': e.get('sumRub') if e.get('cur') not in (None, 'RUB') else (e.get('sum') or x.get('sum') or 0)}})[0]
    mgr = {}
    for _, x in days:
        k = x.get('manager') or '—'
        m = mgr.setdefault(k, {'name': k, 'count': 0, 'sum': 0})
        m['count'] += 1
        m['sum'] += rub(x) or 0
    prods = sorted(({'name': x.get('name', ''), 'count': x.get('pricesCount') or len(x.get('prices') or [])}
                    for x in json.loads(st.catalog_light())), key=lambda p: -p['count'])
    series = {'day': [], 'week': [], 'month': []}
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        series['day'].append({'label': d.strftime('%d.%m'), 'count': sum(1 for x, _ in days if x == d)})
    monday = today - timedelta(days=today.weekday())
    for i in range(11, -1, -1):
        s = monday - timedelta(weeks=i)
        series['week'].append({'label': s.strftime('%d.%m'), 'count': sum(1 for x, _ in days if x and s <= x < s + timedelta(days=7))})
    for i in range(11, -1, -1):
        y, mo = today.year, today.month - i
        while mo <= 0:
            y, mo = y - 1, mo + 12
        series['month'].append({'label': '%02d.%d' % (mo, y % 100), 'count': sum(1 for x, _ in days if x and (x.year, x.month) == (y, mo))})
    month_ago = (now - timedelta(days=30)).isoformat(timespec='seconds')
    active_ago = (now - timedelta(days=active)).isoformat(timespec='seconds')
    q = lambda sql, *a: st.one(sql, a)[0]
    approved = q("SELECT COUNT(*) FROM pending_edits WHERE status='approved'")
    rejected = q("SELECT COUNT(*) FROM pending_edits WHERE status='rejected'")
    users = {r[0] for r in st.all('SELECT DISTINCT user_name FROM audit WHERE ts >= ? AND user_name IS NOT NULL', (active_ago,))}
    users |= {x.get('manager') for d, x in days if d and (today - d).days < active and x.get('manager')}
    users.discard('Не выбран')
    from maintenance import db_size
    size = db_size(st)
    return {
        'kp': {'total': len(metas), 'today': count(1), 'week': count(7), 'month': count(30),
               'sumMonth': sum((rub(x) or 0) for d, x in days if d and (today - d).days < 30)},
        'managers': sorted(mgr.values(), key=lambda m: -m['count'])[:top],
        'products': [p for p in prods if p['count']][:top],
        'moderation': {'enabled': moderation(st).get('enabled'), 'pending': q("SELECT COUNT(*) FROM pending_edits WHERE status='pending'"),
                       'approved': approved, 'rejected': rejected,
                       'conversion': round(approved * 100 / (approved + rejected), 1) if approved + rejected else None},
        'activeUsers': len(users), 'activeDays': active,
        'deletions': {'month': q("SELECT COUNT(*) FROM audit WHERE action LIKE 'delete\\_%' ESCAPE '\\' AND result='success' AND ts >= ?", month_ago),
                      'total': q("SELECT COUNT(*) FROM audit WHERE action LIKE 'delete\\_%' ESCAPE '\\' AND result='success'"),
                      'trash': q('SELECT COUNT(*) FROM trash')},
        'db': {'bytes': size, 'tables': st.table_counts()},
        'series': series,
    }


def startup(store, data_dir, log_print=print):
    """При запуске: сброс пароля по файлу data/admin-reset.txt, очистка корзины старше srv.trashDays дней («Значения программы»)."""
    reset = os.path.join(data_dir, 'admin-reset.txt')
    if os.path.isfile(reset):
        store.write("DELETE FROM kv WHERE key IN ('admin', 'admins')")
        AdminSessions.reset(store)
        os.remove(reset)
        store.audit_add({'action': 'set_password', 'entityType': 'admin', 'entityId': 'reset', 'userName': 'Компьютер-сервер',
                         'userRole': 'admin', 'after': {'reset': True}})
        log_print('Учётные записи администраторов сброшены (data/admin-reset.txt): создайте новую в «Настройках» на этом компьютере')
    n = store.trash_purge(SrvVal.get(store, 'srv.trashDays'))
    if n:
        store.audit_add({'action': 'purge_trash', 'entityType': 'trash', 'userName': 'Программа', 'userRole': 'admin', 'after': {'count': n}})
