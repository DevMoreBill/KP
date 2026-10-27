"""Админ-панель «Настройки»: администраторы и сессии, права, журнал действий, корзина, модерация, копии, статистика."""

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
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any

import auth_users
from admin_rights import AdminRights
from catalog_quality import CardRules, DupFinder
from config import BadRequest
from data_file import Load
from defaults import SrvVal
from storage import Conflict

ENTITY_SLASHES = 2
DATE_LEN = 10
MONTH_DAYS = 30

DENIED = 'Удаление и настройки — только в разделе «Настройки» (нужен пароль администратора)'
# поля товара, которые меняет само сохранение КП (цены и история): такие правки не модерируются
AUTO_KEYS = {'price', 'priceCur', 'cost', 'costCur', 'margin', 'mmode', 'prices', 'updatedAt', 'pricesCount'}
LABELS = {
    'name': 'Наименование',
    'spec': 'Краткие характеристики',
    'price': 'Цена',
    'priceCur': 'Валюта цены',
    'cost': 'Закупка',
    'costCur': 'Валюта закупки',
    'pageTitle': 'Заголовок страницы',
    'photoCaption': 'Подпись к фото',
    'features': 'Описание',
    'groups': 'Характеристики',
    'hint': 'Титул',
    'attrs': 'Параметры и категория',
    'photo': 'Главное фото',
    'logo': 'Логотип',
    'gallery': 'Изображения',
    'options': 'Опции',
    'prices': 'История цен',
}


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def hash_password(password) -> dict:
    salt = secrets.token_bytes(16)
    if hasattr(hashlib, 'scrypt'):
        digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2**14, r=8, p=1, dklen=32)
        return {
            'algo': 'scrypt',
            'n': 2**14,
            'r': 8,
            'p': 1,
            'salt': salt.hex(),
            'hash': digest.hex(),
            'updatedAt': _now(),
        }
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 310000)
    return {'algo': 'pbkdf2', 'iter': 310000, 'salt': salt.hex(), 'hash': digest.hex(), 'updatedAt': _now()}


def verify_password(password, rec) -> bool:
    try:
        salt = bytes.fromhex(rec['salt'])
        if rec['algo'] == 'scrypt':
            digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=rec['n'], r=rec['r'], p=rec['p'], dklen=32)
        else:
            digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, rec['iter'])
        return hmac.compare_digest(digest.hex(), rec['hash'])
    except Exception:
        return False


LOGIN_RE = re.compile(r'^[A-Za-z0-9А-Яа-яЁё._@-]{2,40}$')


def accounts(store) -> list:
    """Учётные записи администраторов [{login, name, pw, created, by, lastLogin}] (с переносом прежнего пароля)."""
    rec = store.kv_get('admins')
    if rec is None:
        old = store.kv_get('admin')
        rec = {
            'users': [{'login': 'admin', 'name': 'Администратор', 'pw': old, 'created': _now(), 'by': 'перенос'}]
            if old
            else []
        }
        if old:
            store.kv_set('admins', rec)
            store.write("DELETE FROM kv WHERE key='admin'")
    return rec.get('users') or []


def save_accounts(store, users) -> None:
    store.kv_set('admins', {'users': users})


def find_account(users, login) -> dict | None:
    login_low = (login or '').strip().lower()
    return next((u for u in users if u['login'].lower() == login_low), None)


def check_login(login) -> None:
    if not LOGIN_RE.match(login or ''):
        raise ValueError('Логин — от 2 до 40 символов: буквы, цифры, точка, дефис, @')


def public_account(u) -> dict:
    out = {k: u.get(k) for k in ('login', 'name', 'created', 'by', 'lastLogin')}
    out['main'] = AdminRights.is_main(u)
    out['rights'] = AdminRights.clean(u.get('rights'))
    return out


def check_new_password(password) -> None:
    minimum = SrvVal.now('srv.adminPwMin')
    if len(password or '') < minimum:
        raise ValueError(f'Пароль — не короче {minimum} символов')
    if not (re.search(r'\d', password) and re.search(r'[^\d]', password)):
        raise ValueError('В пароле нужны и буквы, и цифры')


LOCK = threading.RLock()


class AdminSessions:
    """Сессии администраторов «Настроек»: в памяти и в базе (хеш токена), срок бездействия."""

    KV_KEY = 'adminSessions'
    SAVE_EVERY = 60
    FIELDS = ('csrf', 'last', 'ip', 'login', 'name')
    items = None  # {хеш токена: {csrf, last, ip, login, name, saved}}

    @staticmethod
    def key(tok) -> str:
        return hashlib.sha256(tok.encode('utf-8')).hexdigest() if tok else ''

    @staticmethod
    def _store() -> Any:
        from config import store

        return store()

    @classmethod
    def _all(cls) -> dict:
        if cls.items is None:
            store, now = cls._store(), time.time()
            idle = SrvVal.get(store, 'srv.adminIdleMin') * 60
            logins = {u['login'].lower() for u in accounts(store)}
            raw = store.kv_get(cls.KV_KEY) or {}
            cls.items = {
                k: dict(v, saved=v.get('last', 0))
                for k, v in (raw.items() if isinstance(raw, dict) else [])
                if isinstance(v, dict)
                and now - float(v.get('last') or 0) <= idle
                and (not v.get('login') or v['login'].lower() in logins)
            }
        return cls.items

    @classmethod
    def _save(cls) -> None:
        cls._store().kv_set(
            cls.KV_KEY, {k: {field: v.get(field) for field in cls.FIELDS} for k, v in cls._all().items()}
        )
        for v in cls._all().values():
            v['saved'] = v['last']

    @classmethod
    def get(cls, tok) -> dict | None:
        """Действующая сессия по токену из cookie или None; запрос продлевает сессию."""
        with LOCK:
            sess = cls.peek(tok)
            if sess:
                sess['last'] = time.time()
                if sess['last'] - sess.get('saved', 0) > cls.SAVE_EVERY:
                    cls._save()
            return sess

    @classmethod
    def peek(cls, tok) -> dict | None:
        """Действующая сессия по токену или None, без продления (проверка прав, журнал)."""
        if not tok:
            return None
        k = cls.key(tok)
        with LOCK:
            sess = cls._all().get(k)
            if not sess:
                return None
            if time.time() - sess['last'] > SrvVal.get(cls._store(), 'srv.adminIdleMin') * 60:
                cls._all().pop(k, None)
                cls._save()
                return None
            return sess

    @classmethod
    def of(cls, handler) -> dict | None:
        """Сессия администратора запроса без продления."""
        return cls.peek(_cookie_token(handler))

    @staticmethod
    def allows(handler, method: str) -> bool:
        """Администратор: чтение (GET) — по сессии, изменение — по сессии и токену X-CSRF-Token."""
        return is_admin(handler) if method != 'GET' else session(handler) is not None

    @classmethod
    def start(cls, handler, user=None) -> tuple:
        tok, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        with LOCK:
            cls._all()[cls.key(tok)] = {
                'csrf': csrf,
                'last': time.time(),
                'ip': _client_ip(handler),
                'login': (user or {}).get('login', ''),
                'name': (user or {}).get('name') or (user or {}).get('login') or 'Администратор',
            }
            cls._save()
        return tok, csrf

    @classmethod
    def drop(cls, tok) -> None:
        with LOCK:
            if cls._all().pop(cls.key(tok), None) is not None:
                cls._save()

    @classmethod
    def drop_login(cls, login, keep='') -> None:
        """Закрыть сессии учётной записи (удалена, сменён пароль), кроме сессии с токеном keep."""
        login_low, keep_key = (login or '').lower(), cls.key(keep)
        with LOCK:
            gone = [k for k, sess in cls._all().items() if sess.get('login', '').lower() == login_low and k != keep_key]
            for k in gone:
                cls._all().pop(k, None)
            if gone:
                cls._save()

    @classmethod
    def rename(cls, old, login, name) -> None:
        with LOCK:
            for sess in cls._all().values():
                if sess.get('login', '').lower() == (old or '').lower():
                    sess['login'], sess['name'] = login, name
            cls._save()

    @classmethod
    def reset(cls, store) -> None:
        """Учётные записи сброшены (data/admin-reset.txt) — все сессии закрыты."""
        store.kv_set(cls.KV_KEY, {})
        with LOCK:
            cls.items = None


def _cookie_token(handler) -> str:
    for part in (handler.headers.get('Cookie') or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == 'kp_admin':
            return v
    return ''


def session(handler) -> dict | None:
    """Действующая сессия администратора или None (по cookie; 15 минут бездействия — сессия закрывается)."""
    return AdminSessions.get(_cookie_token(handler))


def is_admin(handler) -> bool:
    """Администратор с токеном X-CSRF-Token — для изменений."""
    sess = session(handler)
    if not sess:
        return False
    return hmac.compare_digest(
        (handler.headers.get('X-CSRF-Token') or '').encode('utf-8'), str(sess['csrf']).encode('utf-8')
    )


class LoginGuard:
    """Защита входа от подбора паролей (менеджеры и администраторы): неверные попытки считаются по адресу компьютера."""

    SHOW_MINUTES_FROM = 30
    REST_WARN = 2

    FAILS: dict = {}
    WRONG = 'Неверный логин или пароль'
    _dummy = None

    @classmethod
    def _limits(cls) -> tuple:
        return SrvVal.now('srv.loginLockMin') * 60, SrvVal.now('srv.loginFails')

    @classmethod
    def _tries(cls, addr) -> list:
        """Неверные попытки с адреса (старые — забываются)."""
        now = time.time()
        window = cls._limits()[0]
        with LOCK:
            for k in [k for k, v in cls.FAILS.items() if not v or now - v[-1] >= window]:
                del cls.FAILS[k]
            return list(cls.FAILS.get(addr, []))

    @classmethod
    def ok(cls, addr) -> None:
        """Верный вход или смена пароля — прежние ошибки с этого адреса забываются."""
        with LOCK:
            cls.FAILS.pop(addr, None)

    @classmethod
    def left(cls, addr) -> int:
        """Сколько секунд вход с адреса ещё закрыт; 0 — открыт."""
        window, limit = cls._limits()
        v = cls._tries(addr)
        return max(1, math.ceil(v[-1] + window - time.time())) if len(v) >= limit else 0

    @classmethod
    def verify(cls, password, rec) -> bool:
        """Пароль подходит к хешу; нет хеша (нет такого логина) — та же работа впустую и False."""
        if not rec:
            if cls._dummy is None:
                cls._dummy = hash_password(secrets.token_hex(8))
            verify_password(str(password or ''), cls._dummy)
            return False
        return verify_password(str(password or ''), rec)

    @staticmethod
    def wait_text(sec) -> str:
        return f'{math.ceil(sec / 60)} мин' if sec > LoginGuard.SHOW_MINUTES_FROM else f'{sec} с'

    @classmethod
    def refuse(cls, handler, sec) -> None:
        """429: вход закрыт — сколько ждать."""
        return handler.send(
            429,
            'text/plain; charset=utf-8',
            f'Слишком много неверных попыток — вход с этого компьютера снова через {cls.wait_text(sec)}',
            {'Retry-After': str(sec)},
        )

    @classmethod
    def wrong(cls, handler, addr, text=None) -> None:
        """Неверный логин или пароль: счётчик попыток, пауза; text — свой текст ответа."""
        text = text or cls.WRONG
        with LOCK:
            cls.FAILS.setdefault(addr, []).append(time.time())
        sec = cls.left(addr)
        if sec:
            return handler.send(
                429,
                'text/plain; charset=utf-8',
                f'{text}. Вход с этого компьютера закрыт на {cls.wait_text(sec)}',
                {'Retry-After': str(sec)},
            )
        rest = cls._limits()[1] - len(cls._tries(addr))
        return handler.send(
            403, 'text/plain; charset=utf-8', text + (f'. Осталось попыток: {rest}' if rest <= cls.REST_WARN else '')
        )


def _client_ip(handler) -> str:
    return (handler.client_address or ('',))[0]


def actor(handler, admin=None) -> tuple:
    """Кто действует: администратор (по сессии) или менеджер, выбранный в программе (заголовки запроса)."""
    sess = AdminSessions.of(handler)
    if admin is None:
        admin = sess is not None
    uid = urllib.parse.unquote(handler.headers.get('X-KP-User-Id') or '')[:64]
    name = urllib.parse.unquote(handler.headers.get('X-KP-User') or '')[:120]
    u = getattr(handler, '_kp_user', None)
    if u and not (admin and sess):  # вход по паролю включён — кто работает, знает сервер
        return u['id'], u['name'], 'user'
    if admin and sess:  # действия в «Настройках» — от имени вошедшего администратора
        return 'admin:' + sess.get('login', ''), sess.get('name') or 'Администратор', 'admin'
    return uid or None, name or ('Администратор' if admin else 'Не выбран'), 'admin' if admin else 'user'


# Автор — authorId в состоянии/описании КП (у КП прежних версий — менеджер КП). Пользователь — подпись запроса
# (менеджер, выбранный на устройстве): это не вход по паролю, а защита от случайного просмотра; администратор видит всё.
DEAL_KEYS_STATE = ('deal',)
DEAL_KEYS_META = ('deal', 'econ')


def login_on(handler) -> bool:
    """Вход менеджеров по паролю включён и запрос — не от администратора: права проверяются."""
    return bool(getattr(handler, '_kp_login', False)) and AdminSessions.of(handler) is None


def perm(handler, key) -> bool:
    if not login_on(handler):
        return True
    u = getattr(handler, '_kp_user', None)
    return bool(u and u['perms'].get(key))


def own_kp(handler, doc) -> bool:
    u = getattr(handler, '_kp_user', None) or {}
    author = (doc or {}).get('authorId') or (doc or {}).get('managerId')
    if author:
        return author == u.get('id')
    mgr = str((doc or {}).get('manager') or '').strip().lower()
    return not mgr or mgr == str(u.get('name') or '').strip().lower()


def kp_access(handler, store, kid: str) -> bool:
    """Открыть / сохранить КП: своё — всегда, чужое — с правом «КП других менеджеров»; нового КП ещё нет — можно."""
    meta = _loads(store.kp_get(kid, 'meta')) or _loads(store.kp_get(kid, 'state'))
    if not meta and store.kp_trashed(kid):
        return AdminSessions.of(handler) is not None
    if not login_on(handler):
        return True
    meta = meta or _loads(store.kp_last_version_meta(kid))
    return not meta or own_kp(handler, meta) or perm(handler, 'kpOthers')


class DealViewer:
    """Кто смотрит экономику КП: сессия, вход и подпись запроса разбираются один раз (журнал проверяет сотни КП)."""

    def __init__(self, handler) -> None:
        self.handler = handler
        self.admin = AdminSessions.of(handler) is not None
        self.login = not self.admin and login_on(handler)
        self.uid, self.name, _ = actor(handler, admin=False)

    def allows(self, doc) -> bool:
        if self.admin:
            return True
        if self.login:
            return perm(self.handler, 'dealView') and (own_kp(self.handler, doc) or perm(self.handler, 'kpOthers'))
        author = (doc or {}).get('authorId') or (doc or {}).get('managerId')
        if author:
            return bool(self.uid) and self.uid == author
        mgr = str((doc or {}).get('manager') or '').strip().lower()  # описание КП прежней версии — по имени автора
        return not mgr or (self.name or '').strip().lower() == mgr


def deal_allowed(handler, doc) -> bool:
    return DealViewer(handler).allows(doc)


def kp_out(handler, field, text) -> str:
    """Состояние или описание КП для ответа: экономику чужого КП убираем."""
    if not text or field not in ('state', 'meta'):
        return text
    try:
        doc = json.loads(text)
    except ValueError:
        return text
    if deal_allowed(handler, doc):
        return text
    for k in DEAL_KEYS_STATE if field == 'state' else DEAL_KEYS_META:
        doc.pop(k, None)
    doc['locked'] = True
    return json.dumps(doc, ensure_ascii=False)


class KpManagerLock:
    """Вход по паролю: менеджер в КП — только вошедший (при правке чужого КП — тот, кто сохранил)."""

    CONTACTS = ('name', 'position', 'phone', 'ext', 'mobile', 'email')

    @classmethod
    def apply(cls, handler, store, field, text) -> str:
        u = getattr(handler, '_kp_user', None)
        if not (login_on(handler) and u) or AdminSessions.of(handler) is not None:
            return text
        try:
            data = json.loads(text)
        except ValueError:
            return text
        if not isinstance(data, dict):
            return text
        card = next((x for x in (_loads(store.managers_list()) or []) if x.get('id') == u['id']), None) or {
            'name': u.get('name') or ''
        }
        data['managerId'] = u['id']
        if field == 'meta':
            data['manager'], data['managerPost'] = card.get('name') or '', card.get('position') or ''
        else:
            mgr = got_value if isinstance(got_value := data.get('manager'), dict) else {}
            data['manager'] = dict(mgr, **{k: str(card.get(k) or '') for k in cls.CONTACTS})
        return json.dumps(data, ensure_ascii=False)


def kp_in(handler, store, kid: str, field, text) -> str:
    """Сохранение КП не автором: расчёт экономики и автор остаются прежними (их не видно — значит, и не затереть)."""
    if field not in ('state', 'meta'):
        return text
    text = KpManagerLock.apply(handler, store, field, text)
    old = store.kp_get(kid, field)
    if not old:
        u = getattr(handler, '_kp_user', None)
        if login_on(handler) and u:  # новое КП при входе по паролю: автор — вошедший менеджер, а не подпись браузера
            try:
                new_doc = json.loads(text)
                if isinstance(new_doc, dict):
                    new_doc['authorId'] = u['id']
                    return json.dumps(new_doc, ensure_ascii=False)
            except ValueError:
                pass
        return text
    try:
        old_doc, new_doc = json.loads(old), json.loads(text)
    except ValueError:
        return text
    if not isinstance(new_doc, dict) or not isinstance(old_doc, dict):
        return text
    u = getattr(handler, '_kp_user', None)
    if login_on(handler) and u and AdminSessions.of(handler) is None and old_doc.get('authorId'):
        new_doc['authorId'] = old_doc[
            'authorId'
        ]  # автор КП не меняется запросом менеджера («передать» КП коллеге нельзя)
        text = json.dumps(new_doc, ensure_ascii=False)
    if deal_allowed(handler, old_doc):
        return text
    for k in (DEAL_KEYS_STATE if field == 'state' else ('deal',)) + ('authorId',):
        if k in old_doc:
            new_doc[k] = old_doc[k]
        else:
            new_doc.pop(k, None)
    new_doc.pop('locked', None)
    return json.dumps(new_doc, ensure_ascii=False)


def _jround(x) -> int:
    return math.floor(x + 0.5)


def econ_rub(rec) -> tuple:
    """Сумма КП в рублях и прибыль в рублях (копейки) для итогов журнала — как jEcon() в интерфейсе."""

    def num(v) -> float:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            try:
                v = float(str(v).replace(' ', '').replace('\xa0', '').replace(',', '.'))
            except (TypeError, ValueError):
                return 0
        return v if math.isfinite(v) else 0

    rub, profit = _econ_rub(rec)
    return (None if rub is None else num(rub)), (None if profit is None else num(profit))


def _econ_rub(rec) -> tuple:
    econ = got_value if isinstance(got_value := rec.get('econ'), dict) else None
    cur = (econ or {}).get('cur') or 'RUB'
    base = ((econ or {}).get('sum') if econ else rec.get('sum')) or 0
    if rec.get('locked'):
        return ((rec.get('sum') or 0) if cur == 'RUB' else None), None
    sum_rub = base if cur == 'RUB' else ((econ or {}).get('sumRub') or None)
    deal = got_value if isinstance(got_value := rec.get('deal'), dict) else None
    try:
        if deal:
            return sum_rub, (_jround(float(deal.get('profit') or 0) * 100) if deal.get('confirmed') else None)
        if econ and econ.get('withCost'):
            if cur == 'RUB':
                return sum_rub, econ.get('profit')
            if econ.get('sumRub') and econ.get('sum'):
                return sum_rub, _jround(float(econ['profit']) * float(econ['sumRub']) / float(econ['sum']))
    except (TypeError, ValueError):
        pass
    return sum_rub, None


class KpJournal:
    """Журнал КП с правами: чужие — с правом «КП других менеджеров», экономика чужого КП убирается."""

    CACHE_MAX = 8

    @staticmethod
    def status(rec) -> str:
        """Статус хода сделки строки журнала (нет хода сделки — new)."""
        return ((rec.get('track') or {}).get('status') if isinstance(rec.get('track'), dict) else None) or 'new'

    @staticmethod
    def rows(handler, rows) -> list:
        """Разобранные описания КП с правами журнала (список меняется на месте)."""
        if login_on(handler) and not perm(handler, 'kpOthers'):
            rows = [rec for rec in rows if isinstance(rec, dict) and own_kp(handler, rec)]
        viewer = DealViewer(handler)
        for rec in rows:
            if isinstance(rec, dict) and not viewer.allows(rec):
                for k in DEAL_KEYS_META:
                    rec.pop(k, None)
                rec['locked'] = True
        return rows

    @classmethod
    def out(cls, handler, text) -> str:
        """Журнал строкой JSON (как его отдаёт база) → строка JSON с правами."""
        try:
            rows = json.loads(text)
        except ValueError:
            return '[]'  # без разбора нельзя убрать чужую экономику — лучше пусто, чем лишнее
        return json.dumps(cls.rows(handler, rows), ensure_ascii=False)

    _cache: dict = {}  # (версия журнала, поиск, автор, вид) → разобранные описания КП; последние 8 отборов
    _lock = threading.Lock()

    @classmethod
    def parsed(cls, store, query, author, kind) -> list:
        """Описания КП под отбором, разобранные один раз на версию журнала (datarev:kpj)."""
        key = (store.data_rev('kpj'), str(query), str(author), str(kind))
        with cls._lock:
            hit = cls._cache.get(key)
        if hit is not None:
            return hit
        rows = [meta for meta in map(_loads, store.kp_metas_where(query, author, kind)) if isinstance(meta, dict)]
        with cls._lock:
            cls._cache = {k: v for k, v in cls._cache.items() if k[0] == key[0]}
            while len(cls._cache) >= cls.CACHE_MAX:
                cls._cache.pop(next(iter(cls._cache)))
            cls._cache[key] = rows
        return rows

    QUIET_DAYS = 3

    @classmethod
    def wanted(cls, store, rec: dict, want: str) -> bool:
        """Подходит ли КП под отбор статуса; быстрые отборы: quiet — отправлено и без ответа дольше QUIET_DAYS дней,
        expiring — срок действия кончается в ближайшие kp.expireAhead дней."""
        status = cls.status(rec)
        if not want:
            return True
        if want == 'open':
            return status not in ('won', 'lost')
        if want == 'quiet':
            moved = str((rec.get('track') or {}).get('at') or '')[:10] if isinstance(rec.get('track'), dict) else ''
            return (
                status == 'sent' and bool(moved) and moved < (date.today() - timedelta(days=cls.QUIET_DAYS)).isoformat()
            )
        if want == 'expiring':
            until = str(rec.get('validUntil') or '')[:10]
            ahead = (date.today() + timedelta(days=SrvVal.get(store, 'kp.expireAhead'))).isoformat()
            return status not in ('won', 'lost') and date.today().isoformat() <= until <= ahead
        return status == want

    @classmethod
    def page(cls, handler, store, query) -> dict:
        """Журнал КП постранично: поиск и автор — в базе; итоги (сумма, прибыль) — по всему отбору."""
        try:
            limit, offset = (
                max(1, min(int(query.get('limit') or 50), 500)),
                max(0, min(int(query.get('offset') or 0), 10**9)),
            )
        except ValueError:
            limit, offset = 50, 0
        rows = cls.rows(
            handler,
            [
                dict(meta)
                for meta in cls.parsed(store, query.get('q', ''), query.get('author', ''), query.get('kind', ''))
            ],
        )
        # воронка — по всему отбору без фильтра статуса: сколько КП и на какую сумму в каждом статусе
        funnel: dict = {}
        for rec in rows:
            stage = funnel.setdefault(cls.status(rec), {'n': 0, 'sum': 0})
            stage['n'] += 1
            stage['sum'] += econ_rub(rec)[0] or 0
        want = query.get('status', '')
        rows = [rec for rec in rows if cls.wanted(store, rec, want)]
        s_sum, s_profit, n_profit = 0, 0, 0
        for rec in rows:
            rub, profit = econ_rub(rec)
            s_sum += rub or 0
            if profit is not None:
                s_profit += profit
                n_profit += 1
        return {
            'total': len(rows),
            'items': rows[offset : offset + limit],
            'authors': store.kp_authors(),
            'agg': {'sum': s_sum, 'profit': s_profit, 'profitN': n_profit},
            'funnel': funnel,
        }


def log(handler, store, action, etype=None, eid=None, before=None, after=None, result='success', admin=None) -> None:
    uid, name, role = actor(handler, admin)
    try:
        store.audit_add(
            {
                'userId': uid,
                'userName': name,
                'userRole': role,
                'action': action,
                'entityType': etype,
                'entityId': None if eid is None else str(eid),
                'before': before,
                'after': after,
                'ip': _client_ip(handler),
                'userAgent': handler.headers.get('User-Agent') or '',
                'result': result,
            }
        )
    except Exception:
        pass  # журнал не должен мешать работе


ABSENT = '__absent__'


def _short(v, limit: int = 20000) -> Any:
    text = json.dumps(v, ensure_ascii=False)
    return v if len(text) <= limit else {'__truncated__': len(text)}


def diff(before, after, skip=()) -> tuple:
    """Только изменённые поля: ({поле: было}, {поле: стало}); отсутствующее поле — ABSENT."""
    before_obj, after_obj = before or {}, after or {}

    def norm(v) -> Any:
        return ABSENT if v in (None, '', [], {}) else v  # пустое и отсутствующее поле — одно и то же

    keys = [
        k
        for k in sorted(set(before_obj) | set(after_obj))
        if k not in skip
        and not k.startswith('_')
        and json.dumps(norm(before_obj.get(k)), sort_keys=True, ensure_ascii=False)
        != json.dumps(norm(after_obj.get(k)), sort_keys=True, ensure_ascii=False)
    ]
    return {k: _short(before_obj.get(k, ABSENT)) for k in keys}, {k: _short(after_obj.get(k, ABSENT)) for k in keys}


def _loads(text) -> Any:
    try:
        return json.loads(text) if text else None
    except Exception:
        return None


def _body_obj(handler) -> dict:
    """Тело запроса — объект JSON или {} (не объект — маршрут сам ответит 400, журнал не падает)."""
    try:
        data = _loads(handler.body().decode('utf-8'))
    except UnicodeDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def moderation(store) -> dict:
    return (store.kv_get('settings') or {}).get('productEditModeration') or {'enabled': False}


def _set_moderation(store, enabled, author: str) -> None:
    settings = store.kv_get('settings') or {}
    settings['productEditModeration'] = {'enabled': bool(enabled), 'updatedAt': _now(), 'updatedBy': author}
    store.kv_set('settings', settings)


class CardSource(Enum):
    """Откуда сохранение карточки: правка человеком или загрузка из файла (заголовок X-KP-Edit: import)."""

    HAND = 'hand'
    FILE = 'import'

    @classmethod
    def of(cls, header: str | None) -> 'CardSource':
        return cls.FILE if header == cls.FILE.value else cls.HAND


class CardQuality:
    """Проверка карточки при сохранении человеком: обязательное у основного оборудования и возможные дубли (функция «catQuality»)."""

    def __init__(self, store, before: dict | None, after: dict, cid: str, source: CardSource = CardSource.HAND) -> None:
        from features import FeatureAccess

        self.store, self.before, self.after, self.cid = store, before, after, cid
        # загрузка каталога из файла (JSON, Excel) — как фиды: не блокируется, неполное видно пометкой в каталоге
        self.enabled = source is not CardSource.FILE and FeatureAccess(store).is_on('catQuality')

    def gaps(self) -> list[str]:
        from equipment_types import load_types

        return CardRules(load_types()['types']).check(self.before, self.after)

    def dups(self) -> list[dict]:
        from equipment_types import load_types

        if not CardRules(load_types()['types']).is_main(self.after) or not DupFinder.changed(self.before, self.after):
            return []
        return DupFinder(self.store).find(self.after, self.cid)


class RefusedCard:
    """Отклонённое сохранение карточки — в журнал: причина, что хотели сохранить и карточка целиком (_card), чтобы
    администратор мог открыть её и добавить сам."""

    CARD_LIMIT = 300000

    @classmethod
    def log(cls, handler, store, before: dict | None, after: dict, cid: str, reason: str) -> None:
        found = after.get('attrs')
        attrs: dict = found if isinstance(found, dict) else {}
        brief = {
            'Причина отказа': reason,
            'Наименование': after.get('name') or '',
            'Категория': attrs.get('cat') or '',
            'Производитель': attrs.get('maker') or '',
            'Модель': attrs.get('model') or '',
            '_card': _short(after, cls.CARD_LIMIT),
        }
        action = 'edit_product' if before else 'create_product'
        log(handler, store, action, 'product', cid, None, {k: v for k, v in brief.items() if v}, result='failed')


def _put_product(handler, store, cid, admin) -> None:
    """Единая точка сохранения товара: модерация (черновик) или сразу в каталог; всё — в журнал."""
    after = _body_obj(handler)
    if not after or not isinstance(after.get('attrs', {}), dict):
        return handler.send(
            400, 'text/plain; charset=utf-8', 'Неверный запрос: нужна карточка оборудования (объект JSON)'
        )
    for k in ('name', 'model', 'desc'):
        if k in after and not isinstance(after[k], str):
            after[k] = '' if after[k] is None else str(after[k])
    text = json.dumps(after, ensure_ascii=False)
    before_text = store.catalog_get(cid)
    before = _loads(before_text)
    before_diff, after_diff = diff(before, after)  # что изменилось (одним сравнением на всё сохранение)
    auto = before is not None and set(after_diff) <= AUTO_KEYS  # сохранение КП обновило только цены и историю
    if (
        not admin
        and login_on(handler)
        and not auto
        and not perm(handler, 'catEdit' if before is not None else 'catAdd')
    ):
        reason = f'Нет права {"редактировать" if before is not None else "добавлять"} оборудование в каталоге — обратитесь к администратору'
        RefusedCard.log(handler, store, before, after, cid, reason)
        return handler.send(403, 'text/plain; charset=utf-8', reason)
    quality = CardQuality(store, before, after, cid, CardSource.of(handler.headers.get('X-KP-Edit')))
    gaps = quality.gaps() if not auto and quality.enabled else []
    from_kp = handler.headers.get('X-KP-Edit') == 'auto'
    if gaps and not from_kp:
        RefusedCard.log(handler, store, before, after, cid, CardRules.text(gaps))
        return handler.send(400, 'text/plain; charset=utf-8', CardRules.text(gaps))
    # модерация не касается администратора и менеджера с правом «Правки без модерации»
    mod = moderation(store).get('enabled') and not admin and not (login_on(handler) and perm(handler, 'catSelfMod'))
    if mod and before is not None and handler.headers.get('X-KP-Edit') == 'auto':
        mod = not auto  # сохранение КП обновило только цены и историю — без модерации
    dups = quality.dups() if not (admin or auto) and quality.enabled else []
    # возможный дубль и неполная позиция из сохранённого КП — на модерацию (КП сохраняется, каталог не засоряется)
    if mod or dups or gaps:
        uid, name, _ = actor(handler, False)
        pid = store.pending_add(cid, 'update' if before else 'create', before_text, text, uid, name)
        before_spec, after_spec = diff(before, after, AUTO_KEYS)
        if dups or gaps:
            after_spec = dict(after_spec or {}, _dups=[dup['name'] for dup in dups], _gaps=gaps)
        log(handler, store, 'submit_edit', 'product', cid, before_spec, after_spec, admin=False)
        return handler.send_json({'ok': True, 'pending': True, 'pendingId': pid, 'dups': dups})
    try:
        rev = store.catalog_put(cid, text, actor(handler, admin)[1], handler.base_rev())
    except Conflict as exc:
        return handler.conflict(exc)
    log(
        handler,
        store,
        'price_sync' if auto else ('edit_product' if before else 'create_product'),
        'product',
        cid,
        before_diff if before else None,
        after_diff,
        admin=admin,
    )
    return handler.send_json({'ok': True, 'rev': rev})


def _refuse(handler, store=None, action=None, etype=None, eid=None, text=DENIED) -> bool:
    """Отказ (403); попытка изменения (action) — в журнал. Возвращает True — «ответ уже отправлен» для guard."""
    if action:
        log(handler, store, action, etype, eid, result='failed')
    handler.send(403, 'text/plain; charset=utf-8', text)
    return True


class RightsCheck:
    """Права вошедшего в «Настройки» администратора (admin_rights): отказ — 403 с причиной, попытка изменения — в журнал."""

    def __init__(self, handler, store) -> None:
        self.handler, self.store = handler, store

    def refused(self, method: str, path: str) -> bool:
        sess = AdminSessions.of(self.handler)
        if sess is None:
            return False
        body = _body_obj(self.handler) if AdminRights.needs_body(method, path) else None
        why = AdminRights(accounts(self.store)).refuse(sess.get('login', ''), method, path, body)
        if not why:
            return False
        if method not in AdminRights.READ:
            log(self.handler, self.store, 'admin_denied', 'admin', path[:120], after={'reason': why}, result='failed')
        self.handler.send(403, 'text/plain; charset=utf-8', why)
        return True


def guard(handler, store, method, path) -> Any:
    """Вызывается до обычного маршрута."""
    from settings_history import SettingsHistory

    SettingsHistory.actor(actor(handler)[1])  # запрос человека: его правки настроек — в историю
    if path.startswith('/api/admin/'):
        AdminApi(handler, store).handle(method, path[len('/api/admin/') :])
        return True
    if path.startswith('/api/auth/'):
        auth_api(handler, store, method, path[len('/api/auth/') :])
        return True
    if RightsCheck(handler, store).refused(method, path):  # права администратора — по вкладкам и действиям
        return True
    # вход менеджеров по паролю: без входа — только экран входа; кто работает — по сессии
    handler._kp_login = auth_users.enabled(store)
    handler._kp_user = auth_users.current(handler, store) if handler._kp_login else None
    if (
        handler._kp_login
        and not handler._kp_user
        and AdminSessions.of(handler) is None
        and path not in ('/api/version', '/api/ping')
    ):
        handler.send(401, 'text/plain; charset=utf-8', 'Нужно войти в программу: логин и пароль менеджера')
        return True
    # вошёл с временным паролем от администратора — сначала задать свой (клиент по заголовку показывает форму смены)
    if (
        handler._kp_user
        and handler._kp_user.get('mustChange')
        and AdminSessions.of(handler) is None
        and path not in ('/api/version', '/api/ping')
    ):
        handler.send(
            403,
            'text/plain; charset=utf-8',
            'Сначала задайте свой пароль — временный пароль от администратора годится только для входа',
            {'X-KP-Auth': 'change-password'},
        )
        return True
    # выключенная администратором функция («Настройки → Функции программы») — её адреса закрыты
    from features import FeatureAccess

    off = FeatureAccess(store).blocked(
        method, path, lambda: (AdminSessions.of(handler) is not None, actor(handler, admin=False)[0] or '')
    )
    if off:
        return _refuse(handler, text=f'Функция «{off}» выключена администратором')
    match = re.match(r'^/api/kp/([A-Za-z0-9_-]+)/', path)
    if match and not kp_access(handler, store, match.group(1)):
        return _refuse(handler, text='Это КП другого менеджера — нет доступа. Права выдаёт администратор')
    if path == '/api/types' and method == 'PUT' and not perm(handler, 'catEdit'):
        return _refuse(handler, text='Нет права менять категории оборудования — обратитесь к администратору')
    from catalog_admin import CatalogDesk

    if CatalogDesk.handles(path):  # особые права менеджеров: в корзину, модерация, выгрузка (и администратор)
        return CatalogDesk(handler, store).route(method, path)
    match = re.match(r'^/api/catalog/([A-Za-z0-9_-]{1,64})$', path)
    if (
        match
        and method == 'PUT'
        and match.group(1) in ('sources', 'pending', 'trash', 'export', 'moderation', 'search', 'sync', 'check')
    ):  # служебные адреса — не карточки
        handler.send(400, 'text/plain; charset=utf-8', 'Недопустимый идентификатор')
        return True
    if match and method == 'PUT':
        _put_product(handler, store, match.group(1), is_admin(handler))
        return True
    if method == 'DELETE':
        return _refuse(
            handler,
            store,
            'delete_attempt',
            path.split('/')[2] if path.count('/') > ENTITY_SLASHES else None,
            path.rsplit('/', 1)[-1],
        )
    # только администратор: тарифы доставки по России
    if path == '/api/logistics/refresh' and method == 'POST':
        if not is_admin(handler):
            return _refuse(handler)
        return lambda: log(
            handler, store, 'edit_settings', 'settings', 'logistics_refresh', None, {'source': 'ATI.SU'}, admin=True
        )
    if path.startswith(('/api/logistics/carriers', '/api/logistics/china')):
        what = 'chinaRates' if 'china' in path else 'carrierApi'
        if not AdminSessions.allows(handler, method):
            return _refuse(handler, store, 'edit_settings' if method != 'GET' else None, 'settings', what)
        if method == 'PUT':
            return lambda: log(handler, store, 'edit_settings', 'settings', what, None, {what: True}, admin=True)
    if path == '/api/logistics' and method == 'PUT':
        if not is_admin(handler):
            return _refuse(handler, store, 'edit_settings', 'settings', 'logistics')
        return lambda: log(
            handler, store, 'edit_settings', 'settings', 'logistics', None, {'tariffs': True}, admin=True
        )
    # только администратор: подключение к 1С (адрес, логин, пароль) и загрузка оплат
    if path.startswith('/api/onec'):
        if not AdminSessions.allows(handler, method):
            return _refuse(handler, store, 'edit_settings' if method != 'GET' else None, 'settings', 'onec')
        if method != 'GET':
            return lambda: log(handler, store, 'edit_settings', 'settings', 'onec', None, {'path': path}, admin=True)
    # только администратор: «Наши реквизиты» и свои шаблоны договора и спецификации
    if path.startswith(('/api/requisites', '/api/doctpl/')) and method != 'GET':
        if not is_admin(handler):
            return _refuse(handler, store, 'edit_settings', 'settings', 'ourDocs')
        return lambda: log(handler, store, 'edit_settings', 'settings', 'ourDocs', None, {'path': path}, admin=True)
    # только администратор: резервная копия ключей API (ключи целиком)
    if path == '/api/integrations/export':
        if not is_admin(handler):
            return _refuse(handler, store, 'export_keys', 'settings', 'integrations')
        return lambda: log(handler, store, 'export_keys', 'settings', 'integrations', None, None, admin=True)
    # только администратор: тексты интерфейса
    if path == '/api/uitexts' and method == 'PUT':
        if not is_admin(handler):
            return _refuse(handler, store, 'edit_settings', 'settings', 'uitexts')
        count = len(_body_obj(handler))
        return lambda: log(handler, store, 'edit_settings', 'settings', 'uitexts', None, {'texts': count}, admin=True)
    # только администратор: шаблоны КП, ключи API
    tpl = re.match(r'^/api/templates/([A-Za-z0-9_-]+)/(file|restore|copy|reset|delete|open)$', path)
    if (
        (tpl and method in ('PUT', 'POST'))
        or (path == '/api/templates/folder' and method == 'POST')
        or (path == '/api/integrations' and method == 'PUT')
    ):
        if not is_admin(handler):
            return _refuse(
                handler, store, 'edit_settings', 'template' if tpl else 'settings', tpl.group(1) if tpl else path
            )
        if path == '/api/integrations':
            keys = list(_body_obj(handler).keys())
            return lambda: log(
                handler, store, 'edit_settings', 'settings', 'integrations', None, {'keys': keys}, admin=True
            )
        if tpl and tpl.group(2) != 'open':
            name = tpl.group(1)
            info = {
                'action': tpl.group(2),
                'file': urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query).get('name', [''])[0],
            }
            return lambda: log(handler, store, 'edit_template', 'template', name, None, info, admin=True)
        return None
    # журнал: КП, менеджеры, клиенты, типы оборудования
    match = re.match(r'^/api/kp/([A-Za-z0-9_-]+)/meta$', path)
    if match and method == 'PUT':
        old = _loads(store.kp_get(match.group(1), 'meta'))
        new: Any = _body_obj(handler)
        keep = ('number', 'client', 'sum', 'positions', 'manager', 'file')
        before_part = {k: old.get(k) for k in keep} if old else None
        after_part = {k: new.get(k) for k in keep}
        return lambda: log(
            handler, store, 'edit_kp' if old else 'create_kp', 'kp', match.group(1), before_part, after_part
        )
    match = re.match(r'^/api/managers/([A-Za-z0-9_-]+)$', path)
    if match and method == 'PUT':
        old = next((x for x in json.loads(store.managers_list()) if x.get('id') == match.group(1)), None)
        new = _body_obj(handler)
        before_part, after_part = diff(old, dict(new, id=match.group(1)), ('updatedAt',))
        return (
            (
                lambda: log(
                    handler,
                    store,
                    'edit_manager' if old else 'create_manager',
                    'manager',
                    match.group(1),
                    before_part if old else None,
                    after_part,
                )
            )
            if after_part
            else None
        )
    match = re.match(r'^/api/clients/([A-Za-z0-9_-]+)$', path)
    if match and method == 'PUT':
        old = store.client_get(match.group(1))
        new = _body_obj(handler)
        before_part, after_part = diff(old, new, ('updated', 'updatedAt', 'kpCount', 'lastKp'))
        return (
            (
                lambda: log(
                    handler,
                    store,
                    'edit_client' if old else 'create_client',
                    'client',
                    match.group(1),
                    before_part if old else None,
                    after_part,
                )
            )
            if after_part
            else None
        )
    match = re.match(r'^/api/suppliers/([A-Za-z0-9_-]+)$', path)
    if match and method == 'PUT':
        old = store.supplier_get(match.group(1))
        new = _body_obj(handler)
        before_part, after_part = diff(old, dict(new, id=match.group(1)), ('updatedAt',))
        return (
            (
                lambda: log(
                    handler,
                    store,
                    'edit_supplier' if old else 'create_supplier',
                    'supplier',
                    match.group(1),
                    before_part if old else None,
                    after_part,
                )
            )
            if after_part
            else None
        )
    if path == '/api/customs' and method == 'PUT':
        new = _body_obj(handler)
        old = store.customs_all().get(str(new.get('key') or ''))
        return lambda: log(
            handler,
            store,
            'edit_customs',
            'customs',
            new.get('key'),
            old and {k: old.get(k) for k in ('code', 'duty')},
            {k: new.get(k) for k in ('code', 'duty')},
        )
    if path == '/api/types' and method == 'PUT':
        stored = {
            tdef.get('id'): tdef for tdef in (store.kv_get('types') or {}).get('types', []) if isinstance(tdef, dict)
        }
        body = _body_obj(handler)
        if isinstance(body.get('add'), list):  # только добавление категорий — ничего не удаляется
            return lambda: log(
                handler,
                store,
                'edit_types',
                'types',
                'user_types',
                None,
                {'added': [tdef.get('name') for tdef in body['add'] if isinstance(tdef, dict)]},
            )
        sent = body.get('types')
        new = {str(tdef.get('id')) for tdef in (sent if isinstance(sent, list) else []) if isinstance(tdef, dict)}
        try:
            from equipment_types import load_types_builtin

            builtin = {tdef.get('id'): tdef for tdef in load_types_builtin() if isinstance(tdef, dict)}
        except Exception:
            builtin = {}
        # копия стандартной категории без изменений — не удаление (её убирают, чтобы категория обновлялась с программой)
        removed = {
            i
            for i in set(stored) - new
            if not (i in builtin and json.dumps(stored[i], sort_keys=True) == json.dumps(builtin[i], sort_keys=True))
        }
        if removed and not is_admin(handler):  # удалить свою категорию или вернуть стандартные — только администратор
            return _refuse(handler, store, 'delete_attempt', 'types', ','.join(sorted(removed)))
        return lambda: log(
            handler,
            store,
            'edit_types',
            'types',
            'user_types',
            None,
            {
                'types': [
                    tdef.get('name') for tdef in (sent if isinstance(sent, list) else []) if isinstance(tdef, dict)
                ]
            },
        )
    return None


def auth_api(handler, store, method, sub) -> None:
    def send(code, obj, extra=None) -> None:
        return handler.send(code, 'application/json; charset=utf-8', json.dumps(obj, ensure_ascii=False), extra)

    if sub == 'status':
        u = auth_users.current(handler, store) if auth_users.enabled(store) else None
        return send(
            200,
            {
                'enabled': auth_users.enabled(store),
                'user': u,
                'admin': AdminSessions.of(handler) is not None,
                'perms': [{'key': k, 'label': label} for k, label, _ in auth_users.PERMS],
                **auth_users.LoginInfo.public(store),
            },
        )
    if sub == 'login' and method == 'POST':
        addr = _client_ip(handler)
        sec = LoginGuard.left(addr)
        if sec:
            return LoginGuard.refuse(handler, sec)
        data = _body_obj(handler)
        mid, rec = auth_users.find_by_login(store, data.get('login'))
        ok = LoginGuard.verify(data.get('password'), (rec or {}).get('pw'))
        expired = ok and auth_users.TempPassword.expired(rec)
        if not ok or rec.get('blocked') or expired:
            store.audit_add(
                {
                    'userId': mid,
                    'userName': str(data.get('login') or '')[:40],
                    'userRole': 'user',
                    'action': 'login',
                    'entityType': 'user',
                    'entityId': mid,
                    'after': {'reason': 'временный пароль истёк'} if expired and not rec.get('blocked') else None,
                    'ip': addr,
                    'userAgent': handler.headers.get('User-Agent') or '',
                    'result': 'failed',
                }
            )
            if ok and rec.get('blocked'):  # пароль верный, но вход запрещён — говорим только тому, кто знает пароль
                return handler.send(
                    403, 'text/plain; charset=utf-8', 'Вход запрещён администратором — обратитесь к нему'
                )
            if expired:
                return handler.send(
                    403,
                    'text/plain; charset=utf-8',
                    'Срок временного пароля истёк — попросите администратора сбросить пароль ещё раз',
                )
            return LoginGuard.wrong(handler, addr)
        term = auth_users.Term.LONG if data.get('remember', True) is not False else auth_users.Term.SHORT
        LoginGuard.ok(addr)
        tok = auth_users.UserSession.start(store, mid, term)
        auth_users.touch_login(store, mid)
        store.audit_add(
            {
                'userId': mid,
                'userName': rec.get('login'),
                'userRole': 'user',
                'action': 'login',
                'entityType': 'user',
                'entityId': mid,
                'ip': addr,
                'userAgent': handler.headers.get('User-Agent') or '',
                'result': 'success',
            }
        )
        return send(
            200,
            {'ok': True, 'mustChange': auth_users.TempPassword.of(rec) is not None},
            {'Set-Cookie': auth_users.UserSession.cookie(tok, term)},
        )
    handler._kp_user = auth_users.current(handler, store) if auth_users.enabled(store) else None
    if sub == 'logout' and method == 'POST':
        tok = auth_users.cookie_token(handler)
        if tok:
            auth_users.drop_sessions(store, tok=tok)
        if handler._kp_user:
            log(handler, store, 'user_logout', 'user', handler._kp_user['id'], admin=False)
        return send(200, {'ok': True}, {'Set-Cookie': auth_users.UserSession.cookie('')})
    if sub in ('password', 'logout-all') and method == 'POST':
        return UserAuthApi(handler, store).route(sub)
    return handler.send(404, 'text/plain; charset=utf-8', 'Нет такого запроса')


class UserAuthApi:
    """Вошедший менеджер о себе: сменить пароль, выйти на всех устройствах."""

    def __init__(self, handler, store) -> None:
        self.handler, self.store = handler, store
        self.user = handler._kp_user

    def text(self, code, text, extra=None) -> None:
        return self.handler.send(code, 'text/plain; charset=utf-8', text, extra)

    def route(self, sub) -> None:
        if not self.user:
            return self.text(401, 'Нужно войти в программу: логин и пароль менеджера')
        return self.password() if sub == 'password' else self.logout_all()

    def password(self) -> None:
        handler, store, mid = self.handler, self.store, self.user['id']
        addr = _client_ip(handler)
        sec = LoginGuard.left(addr)
        if sec:
            return LoginGuard.refuse(handler, sec)
        tok = auth_users.cookie_token(handler)
        try:
            temp, closed = auth_users.UserPassword.change(
                store, mid, _body_obj(handler), tok, LoginGuard.verify, hash_password
            )
        except PermissionError as exc:
            log(handler, store, 'set_password', 'user', mid, result='failed', admin=False)
            return LoginGuard.wrong(handler, addr, str(exc))
        except ValueError as exc:
            return self.text(400, str(exc))
        LoginGuard.ok(addr)
        log(
            handler,
            store,
            'set_password',
            'user',
            mid,
            None,
            {'by': 'сам', 'temp': temp, 'closedSessions': closed},
            admin=False,
        )
        return handler.send_json({'ok': True, 'closed': closed})

    def logout_all(self) -> None:
        handler, store, mid = self.handler, self.store, self.user['id']
        closed = auth_users.UserSession.drop_all(store, mid)
        log(handler, store, 'logout_all', 'user', mid, None, {'by': 'сам', 'closedSessions': closed}, admin=False)
        return handler.send(
            200,
            'application/json; charset=utf-8',
            json.dumps({'ok': True, 'closed': closed}),
            {'Set-Cookie': auth_users.UserSession.cookie('')},
        )


SECTIONS = ('catalog', 'kp', 'managers', 'clients', 'suppliers', 'audit', 'settings')
SECTION_FILE = {
    'catalog': 'каталог',
    'kp': 'КП',
    'managers': 'менеджеры',
    'clients': 'клиенты',
    'suppliers': 'поставщики',
    'audit': 'журнал',
    'settings': 'настройки',
}  # части имени файла выгрузки


class AdminApi:
    PERCENT_MAX = 100
    AUDIT_YEARS_MAX = 20
    CONFLICTS_SHOWN = 30

    def __init__(self, handler, store) -> None:
        self.handler, self.store = handler, store

    def ok(self, obj=None) -> None:
        return self.handler.send_json({'ok': True} if obj is None else obj)

    def err(self, code, text) -> None:
        return self.handler.send(code, 'text/plain; charset=utf-8', text)

    def data(self) -> dict:
        """Тело запроса — объект JSON (пустое тело — {}); иначе 400 «Неверный запрос»."""
        raw = self.handler.body()
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw.decode('utf-8'))
        except ValueError:
            raise BadRequest('Неверный запрос: нужен JSON') from None
        if data is None:
            return {}
        if not isinstance(data, dict):
            raise BadRequest('Неверный запрос: нужен объект JSON')
        return data

    def log(self, *args, **k) -> None:
        log(self.handler, self.store, *args, **(k | {'admin': True}))

    def handle(self, method, sub) -> None:
        handler, store = self.handler, self.store
        query = dict(
            urllib.parse.parse_qsl(urllib.parse.urlsplit(handler.path).query, keep_blank_values=True, encoding='utf-8')
        )
        users = accounts(store)
        if sub == 'status':
            sess = session(handler)
            return self.ok(
                {
                    'hasPassword': bool(users),
                    'admin': bool(sess),
                    'csrf': sess['csrf'] if sess else '',
                    'login': sess.get('login', '') if sess else '',
                    'name': sess.get('name', '') if sess else '',
                    'canSetup': not users and handler.is_local(),
                    'idleMinutes': SrvVal.get(store, 'srv.adminIdleMin'),
                    'rights': AdminRights(users).view(sess.get('login', '')) if sess else None,
                }
            )
        if sub == 'setup' and method == 'POST':
            if users:
                return self.err(409, 'Администратор уже создан')
            if not handler.is_local():
                return self.err(403, 'Первая учётная запись создаётся на компьютере, где работает программа')
            data = self.data()
            login, password = str(data.get('login') or 'admin').strip(), str(data.get('password') or '')
            try:
                check_login(login)
                check_new_password(password)
            except ValueError as exc:
                return self.err(400, str(exc))
            u: Any = {
                'login': login,
                'name': str(data.get('name') or '').strip()[:80] or login,
                'pw': hash_password(password),
                'created': _now(),
                'by': 'первый вход',
                'lastLogin': _now(),
            }
            save_accounts(store, [u])
            tok = self._login_ok(u)
            log(handler, store, 'create_admin', 'admin', login, None, {'login': login, 'name': u['name']}, admin=True)
            return tok
        if sub == 'login' and method == 'POST':
            addr = _client_ip(handler)
            if not users:
                return self.err(409, 'Администратор ещё не создан')
            sec = LoginGuard.left(addr)
            if sec:
                log(handler, store, 'login', 'admin', None, result='failed', admin=False)
                return LoginGuard.refuse(handler, sec)
            data = self.data()
            login = str(data.get('login') or '').strip()
            u = find_account(users, login) if login else (users[0] if len(users) == 1 else None)
            if not LoginGuard.verify(data.get('password'), (u or {}).get('pw')):
                log(handler, store, 'login', 'admin', login[:40] or None, result='failed', admin=False)
                return LoginGuard.wrong(handler, addr)
            LoginGuard.ok(addr)
            u['lastLogin'] = _now()
            save_accounts(store, users)
            resp = self._login_ok(u)
            log(handler, store, 'login', 'admin', u['login'], admin=True)
            return resp
        if sub == 'logout' and method == 'POST':
            AdminSessions.drop(_cookie_token(handler))
            log(handler, store, 'logout', 'admin', admin=True)
            return handler.send(
                200,
                'application/json; charset=utf-8',
                '{"ok": true}',
                {'Set-Cookie': 'kp_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'},
            )
        # дальше — только администратор; изменения — с CSRF-токеном
        if not AdminSessions.allows(handler, method):
            if method != 'GET':
                log(handler, store, 'admin_request', 'admin', sub, result='failed', admin=False)
            return self.err(401, 'Войдите в «Настройки» — сессия закрыта или истекла')
        if RightsCheck(handler, store).refused(method, '/api/admin/' + sub):
            return None
        try:
            return self.route(method, sub, query)
        except ValueError as exc:
            return self.err(400, str(exc))

    def feeds(self, method, sub, query, actor_login) -> None:
        import feeds
        from equipment_types import load_types

        store = self.store
        types = load_types()['types']
        if sub == 'feeds' and method == 'GET':
            return self.ok(
                {
                    'items': feeds.status(store),
                    'types': [
                        {'id': tdef.get('id'), 'name': tdef.get('name'), 'group': tdef.get('group')}
                        for tdef in types
                        if not tdef.get('hidden')
                    ],
                }
            )
        if sub == 'feeds' and method == 'POST':
            feed: Any = feeds.feed_save(store, self.data())
            self.log(
                'edit_settings',
                'settings',
                'feed:' + feed['id'],
                None,
                {'url': feed['url'] or feed.get('kind'), 'name': feed['name']},
            )
            return self.ok(feed)
        match: Any = re.match(
            r'^feeds/([a-z0-9-]{1,40})/(preview|import|check|delete|log|status|upload|file|discounts|plan|loadplan|rebuild|purge|unblock)$',
            sub,
        )
        if not match:
            return self.err(404, 'Нет такого запроса')
        fid, act = match.group(1), match.group(2)
        feed = feeds.feed_get(store, fid)
        if not feed:
            return self.err(404, 'Фид не найден')
        if act == 'log':
            return self.ok({'items': feeds.log_of(store, fid)})
        if act == 'status':
            return self.ok({'job': feeds.JOBS.get(fid)})
        if (
            act == 'discounts'
        ):  # как сетка скидок разложится по позициям; в теле можно прислать ещё не сохранённую сетку
            data = self.data() if method == 'POST' else {}
            feed_copy = dict(feed)
            if isinstance(data.get('discounts'), list):
                feed_copy['discounts'] = feeds.discount_rules(data['discounts'])
            if isinstance(data.get('driveHints'), dict):
                feed_copy['driveHints'] = {k: str(data['driveHints'].get(k) or '')[:400] for k in ('belt', 'direct')}
            if 'discount' in data:
                x: Any = feeds.parse_number(data.get('discount'))
                feed_copy['discount'] = x if x and 0 < x < self.PERCENT_MAX else None
            return self.ok(feeds.discount_plan(store, feed_copy))
        if method != 'POST':
            return self.err(405, 'Нужен POST')
        if (
            act == 'loadplan'
        ):  # «Что загружать»: план «добавится / изменится / пропущено»; в теле — ещё не сохранённые настройки
            data = self.data()
            feed_copy = dict(feed)
            if isinstance(data.get('filter'), dict):
                feed_copy['filter'] = feeds.FeedRules.clean_filter(data['filter'])
            if isinstance(data.get('fields'), dict):
                feed_copy['fields'] = feeds.FeedRules.clean_fields(data['fields'])
            if isinstance(data.get('cats'), dict):
                feed_copy['cats'] = feeds._cats_ok(data['cats'])
            try:
                return self.ok(feeds.FeedRules.plan(store, feed_copy, types))
            except Exception as exc:
                return self.err(422, f'Фид не загрузился: {exc}')
        if act == 'upload':  # файл фида из файлов: ?kind=pages|price&name=имя, тело — сам файл
            if feeds.busy(fid):
                return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
            meta = feeds.feed_file_put(
                store, fid, query.get('kind', ''), self.handler.body(), query.get('name', ''), query.get('slot') or None
            )
            self.log(
                'edit_settings',
                'settings',
                'feed:' + fid,
                None,
                {'file': query.get('kind'), 'name': meta['name'], 'rows': meta.get('rows')},
            )
            return self.ok(meta)
        if act == 'file':  # файл фида из файлов: {kind, slot, act: drop | cur, cur, sheet}
            if feeds.busy(fid):
                return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
            data = self.data()
            x = feeds.feed_file_set(
                store,
                fid,
                str(data.get('kind') or ''),
                str(data.get('slot') or ''),
                str(data.get('act') or ''),
                str(data.get('cur') or ''),
                str(data.get('sheet') or ''),
            )
            self.log(
                'edit_settings',
                'settings',
                'feed:' + fid,
                None,
                {'file': data.get('kind'), 'slot': data.get('slot'), 'act': data.get('act'), 'cur': data.get('cur')},
            )
            return self.ok(x.get('files') or {})
        if act == 'delete':
            feeds.feed_delete(store, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'url': feed['url']}, None)
            return self.ok()
        if feeds.busy(fid):
            return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
        if act == 'purge':  # удалить позиции фида в корзину: {cat, preview, block}
            data = self.data()
            cat = str(data.get('cat') or '')[:80]
            if data.get('preview') is True:
                return self.ok(feeds.FeedPurge.preview(store, feed, cat))
            purge = feeds.FeedPurge.run_and_block if data.get('block') is not False else feeds.FeedPurge.run
            match = purge(store, feed, cat, actor(self.handler, True)[1])
            self.log(
                'delete_catalog', 'catalog', 'feed:' + fid, None, dict(match, feed=feed.get('name'), cat=cat or 'все')
            )
            return self.ok(match)
        if act == 'unblock':  # вернуть удалённые позиции фида в загрузку
            count = feeds.FeedPurge.unblock(store, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'excluded': count}, {'excluded': 0})
            return self.ok({'unblocked': count})
        if act == 'plan':  # фид из файлов: что сделает сборка каталога (без записи)
            try:
                return self.ok(feeds.plan_summary(store, feed))
            except Exception as exc:
                return self.err(422, f'Фид не загрузился: {exc}')
        if act == 'rebuild':  # разрешить сборку каталога заново (парс снова перестроит позиции производителя)
            feeds.feed_unbuild(store, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'built': True}, {'built': False})
            return self.ok()
        if act == 'preview':
            try:
                return self.ok(feeds.preview(store, feed, types))
            except Exception as exc:
                return self.err(422, f'Фид не загрузился: {exc}')
        who = actor_login or 'администратор'
        if act == 'import':
            data = self.data()
            only = set(data.get('only') or []) or None
            feeds.run_bg(
                feeds.import_feed,
                store,
                feed,
                types,
                feeds.IMAGE_STORE,
                who,
                only,
                missing=feeds.Missing.TRASH if data.get('trashMissing') is True else feeds.Missing.KEEP,
            )
            self.log(
                'import_feed',
                'catalog',
                'feed:' + fid,
                None,
                {'url': feed['url'], 'only': len(only) if only else 'все'},
            )
        else:
            feeds.run_bg(feeds.check_feed, store, feed, who, types=types)
            self.log('check_feed', 'catalog', 'feed:' + fid, None, {'url': feed['url']})
        return self.ok({'job': feeds.JOBS.get(fid) or {'state': 'run', 'kind': act}})

    def _login_ok(self, user=None) -> Any:
        tok, csrf = AdminSessions.start(self.handler, user)
        return self.handler.send(
            200,
            'application/json; charset=utf-8',
            json.dumps({'ok': True, 'csrf': csrf}),
            {'Set-Cookie': f'kp_admin={tok}; Path=/; HttpOnly; SameSite=Strict'},
        )

    def route(self, method, sub, query) -> None:
        store = self.store
        actor_login = (AdminSessions.of(self.handler) or {}).get('login', '')
        if (
            sub
            in ('system', 'attention', 'readiness', 'restart', 'folder', 'log', 'log/download', 'alerts', 'alerts/test')
            or sub == 'update'
            or sub.startswith('update/')
        ):
            return self.system(method, sub, query, actor_login)
        if sub == 'history' or sub.startswith('history/'):
            return self.history(method, sub, query)
        if (
            sub == 'connections'
        ):  # проверить все подключения: почта, нейросеть, ЦБ, контрагенты, перевозчики, GitHub, фиды, PDF
            from config import ROOT
            from connections import ConnectionCheck

            checker = ConnectionCheck(store, os.path.dirname(store.path), ROOT)
            return self.ok(checker.run() if method == 'POST' else checker.last())
        if sub == 'password' and method == 'POST':
            addr = _client_ip(self.handler)
            sec = LoginGuard.left(addr)  # подбор текущего пароля — как подбор при входе
            if sec:
                return LoginGuard.refuse(self.handler, sec)
            payload, users = self.data(), accounts(store)
            u = find_account(users, actor_login) or (users[0] if len(users) == 1 else None)
            if not u or not LoginGuard.verify(payload.get('old') or '', (u or {}).get('pw')):
                self.log('set_password', 'admin', actor_login, result='failed')
                return LoginGuard.wrong(self.handler, addr, 'Текущий пароль указан неверно')
            check_new_password(payload.get('new') or '')
            LoginGuard.ok(addr)
            u['pw'] = hash_password(payload['new'])
            save_accounts(store, users)
            AdminSessions.drop_login(
                u['login'], keep=_cookie_token(self.handler)
            )  # другие входы с прежним паролем закрываются
            self.log('set_password', 'admin', u['login'])
            return self.ok()
        if sub == 'access':  # вход менеджеров в конструктор: режим, логины, пароли, права
            if method == 'POST':
                payload = self.data()
                if 'enabled' in payload:
                    enabled = bool(payload['enabled'])
                    if enabled and not any(
                        acc.get('login') and acc.get('pw') and not acc.get('blocked')
                        for acc in auth_users.access(store).values()
                    ):
                        return self.err(400, 'Сначала задайте логин и пароль хотя бы одному менеджеру')
                    before: Any = auth_users.enabled(store)
                    toggle = auth_users.UserLogin.enable if enabled else auth_users.UserLogin.disable
                    toggle(store, actor_login or 'admin')
                    self.log('toggle_user_login', 'settings', 'userLogin', {'enabled': before}, {'enabled': enabled})
                if 'help' in payload:  # «Забыли пароль?» на экране входа: к кому обращаться
                    before = auth_users.LoginInfo.help(store)
                    after = auth_users.LoginInfo.set_help(store, payload['help'], actor_login or 'admin')
                    if after != before:
                        self.log('edit_settings', 'settings', 'userLogin.help', {'help': before}, {'help': after})
            mgrs = _loads(store.managers_list()) or []
            return self.ok(
                {
                    'enabled': auth_users.enabled(store),
                    'perms': [{'key': k, 'label': label, 'def': default} for k, label, default in auth_users.PERMS],
                    'managers': auth_users.public(store, mgrs),
                    'help': auth_users.LoginInfo.help(store),
                }
            )
        acc: Any = re.match(r'^access/([A-Za-z0-9_-]{1,64})/(reset|logout)$', sub)
        if acc and method == 'POST':
            return self.access_act(acc.group(1), acc.group(2), actor_login)
        acc = re.match(r'^access/([A-Za-z0-9_-]{1,64})$', sub)
        if acc and method == 'POST':
            mid = acc.group(1)
            if not any(x.get('id') == mid for x in (_loads(store.managers_list()) or [])):
                return self.err(404, 'Менеджер не найден')
            payload = self.data()
            rec: Any = auth_users.set_access(store, mid, payload, hash_password)
            info = {k: payload[k] for k in ('login', 'perms', 'blocked', 'clear') if k in payload}
            if payload.get('password'):
                info['password'] = 'изменён'
            self.log('edit_access', 'manager', mid, None, info)
            return self.ok(
                {
                    'login': rec.get('login') or '',
                    'hasPassword': bool(rec.get('pw')),
                    'perms': auth_users.perms_of(rec),
                    'blocked': bool(rec.get('blocked')),
                }
            )
        if sub == 'rules/stations':  # инженерные правила станций: своя версия файла администратора или файл поставки
            from station_rules import StationRules

            rules = StationRules(store)
            if method == 'POST':
                before = rules.info()
                res = (
                    rules.reset()
                    if query.get('reset') == '1'
                    else rules.save(self.handler.body(), actor_login or 'admin')
                )
                self.log(
                    'edit_settings',
                    'settings',
                    'stationRules',
                    {'version': before['version'], 'own': before['own']},
                    {'version': res['version'], 'own': res['own']},
                )
                return self.ok({'info': res})
            return self.ok({'info': rules.info(), 'layoutDef': rules.layout_defaults()})
        if sub == 'features':  # функции программы: включить / выключить
            from features import FeatureAccess

            features = FeatureAccess(store)
            if method == 'POST':
                before = features.config()
                res = features.save(self.data().get('values'), actor_login or 'admin')
                changes = {k: v for k, v in res.items() if before.get(k) != v}
                if changes:
                    self.log('edit_settings', 'settings', 'features', {k: before.get(k) for k in changes}, changes)
                return self.ok({'config': res})
            return self.ok({'config': features.config()})
        if sub == 'mail':  # почта для отправки КП клиентам (SMTP)
            from kp_track import Mailer

            if method == 'POST':
                res = Mailer(store).save(self.data(), actor_login or 'admin')
                self.log(
                    'edit_settings',
                    'settings',
                    'mail',
                    None,
                    {k: res.get(k) for k in ('host', 'port', 'security', 'login', 'fromEmail')},
                )
                return self.ok(res)
            return self.ok(Mailer(store).public())
        if sub == 'mail/test' and method == 'POST':
            from kp_track import Mailer

            try:
                recipients = Mailer.addresses(self.data().get('to'))
                if not recipients:
                    return self.err(400, 'Укажите адрес для проверки')
                Mailer(store).send_service(
                    recipients,
                    'Проверка почты — Конструктор КП',
                    'Это проверочное письмо: отправка КП по почте настроена.',
                )
            except RuntimeError as exc:
                return self.err(422, str(exc))
            self.log('edit_settings', 'settings', 'mail_test', None, {'to': recipients})
            return self.ok({'ok': True})
        if sub == 'lists':  # списки и выборы: {ключ: [строки]}; None — вернуть встроенный список
            from lists import ListStore

            lists = ListStore(store)
            if method == 'POST':
                payload = self.data()
                before = lists.all()
                res = lists.save(payload.get('values'), actor_login or 'admin')
                keys = list((payload.get('values') or {}).keys())
                self.log(
                    'edit_lists', 'settings', 'lists', {k: before.get(k) for k in keys}, {k: res.get(k) for k in keys}
                )
                return self.ok({'values': res})
            return self.ok({'values': lists.all()})
        if sub == 'defaults':  # значения по умолчанию программы: {ключ: {on, v}}; None — вернуть встроенное
            import defaults

            if method == 'POST':
                payload = self.data()
                before = defaults.get(store)
                res = defaults.save(store, payload.get('values'), actor_login or 'admin')
                changes = {k: res.get(k) for k in (payload.get('values') or {})}
                self.log('edit_defaults', 'settings', 'defaults', {k: before.get(k) for k in changes}, changes)
                return self.ok({'values': res})
            return self.ok({'values': defaults.get(store)})
        if sub == 'bitrix/mirror' or sub.startswith('bitrix/mirror/'):  # кабинет как Битрикс24 (bitrix_mirror_load.py)
            from bitrix_mirror_load import MirrorDesk

            return MirrorDesk(self.handler, self.store, self.log).route(method, sub, actor_login or 'admin')
        if sub == 'bitrix' or sub.startswith('bitrix/'):  # связь с Битрикс24 (bitrix.py)
            from bitrix import BitrixDesk

            return BitrixDesk(self.handler, self.store, self.log).route(method, sub, actor_login or 'admin')
        if sub == 'ai':  # нейросеть в программе: включить / выключить, ключ, модель, адрес API, расход
            import ai_llm

            if method == 'POST':
                payload = self.data()
                before = ai_llm.settings(store)
                res = ai_llm.save(store, payload, actor_login or 'admin')
                info = {k: payload[k] for k in ('enabled', 'model', 'base') if k in payload}
                if 'key' in payload:
                    info['key'] = 'изменён' if payload.get('key') else 'удалён'
                self.log('edit_ai', 'settings', 'ai', {k: before.get(k) for k in info if k in before}, info)
                return self.ok(res)
            return self.ok(ai_llm.admin_view(store))
        if sub == 'ai/test' and method == 'POST':  # проверка ключа и связи: короткий запрос
            import ai_llm

            try:
                acc = ai_llm.AiAsk.probe(store, 'Ответь JSON-объектом {"ok": true, "model": "<название модели>"}')
            except RuntimeError as exc:
                return self.err(422, str(exc))
            return self.ok({'ok': True, 'answer': acc['text'][:200], 'model': acc['model'], 'usage': acc['usage']})
        if sub == 'users':
            if method == 'POST':
                return self.ok(self.users(self.data(), actor_login))
            return self.ok(
                {'items': [public_account(u) for u in accounts(store)], 'me': actor_login, **AdminRights.schema()}
            )
        if sub == 'stats':
            return self.ok(stats(store))
        if sub == 'audit':
            page = max(0, int(query.get('page') or 0))
            res = store.audit_query(query, 50, page * 50)
            res['page'] = page
            return self.ok(res)
        if sub == 'audit/filters':
            return self.ok(
                {
                    'users': store.audit_distinct('user_name'),
                    'actions': store.audit_distinct('action'),
                    'entities': store.audit_distinct('entity_type'),
                }
            )
        acc = re.match(r'^audit/(\d{1,9})/rollback$', sub)
        if acc and method == 'POST':
            return self.rollback(int(acc.group(1)))
        if (
            sub == 'logos'
        ):  # логотипы производителей: закрепить за маркой (на всё её оборудование и в будущем) или снять
            import web_api
            from maker_logos import MakerLogos

            logos = MakerLogos(store, web_api.IMAGES)
            if method == 'POST':
                payload = self.data()
                res = (
                    logos.unpin(payload.get('maker'))
                    if payload.get('unpin')
                    else logos.set(payload.get('maker'), payload.get('image'), actor_login or 'admin')
                )
                self.log(
                    'edit_settings',
                    'settings',
                    'makerLogo',
                    None,
                    {'maker': res['maker'], 'unpin': bool(payload.get('unpin')), 'items': res.get('items', 0)},
                )
                return self.ok(res)
            return self.ok({'items': logos.list()})
        if sub == 'feeds' or sub.startswith('feeds/'):  # товарные фиды поставщиков (feeds.py)
            return self.feeds(method, sub, query, actor_login)
        acc = re.match(r'^list/(kp|catalog|manager|client|supplier)$', sub)
        if acc:
            return self.ok(self.listing(acc.group(1), query.get('q') or ''))
        if sub == 'delete' and method == 'POST':
            return self.delete(self.data())
        acc = re.match(r'^kpfiles/([A-Za-z0-9_-]{1,64})/(\d{1,9})/delete$', sub)
        if acc and method == 'POST':  # справочный документ КП — удаляет только администратор (у менеджеров кнопки нет)
            from kp_files import KpFiles

            rec = KpFiles.of(store).delete(acc.group(1), int(acc.group(2)))
            if not rec:
                return self.err(404, 'Документ не найден')
            self.log('delete_kp_file', 'kp', acc.group(1), {'name': rec['name'], 'size': rec['size']}, None)
            return self.ok({'ok': True})
        if sub == 'feedback':  # «Сообщить о проблеме» — сообщения менеджеров, новые сверху
            from feedback import Feedback

            return self.ok({'items': list(reversed(Feedback(store).all()))[:50]})
        acc = re.match(r'^feedback/(\d{1,9})/done$', sub)
        if acc and method == 'POST':
            from feedback import Feedback

            if not Feedback(store).done(int(acc.group(1))):
                return self.err(404, 'Сообщение не найдено')
            return self.ok({'ok': True})
        acc = re.match(r'^dealfiles/(d\d{1,9})/(\d{1,9})/delete$', sub)
        if acc and method == 'POST':  # документ сделки — после первых минут удаляет только администратор
            from deal_files import DealFiles

            rec = DealFiles.of(store).delete(acc.group(1), int(acc.group(2)))
            if not rec:
                return self.err(404, 'Документ не найден')
            self.log('delete_deal_file', 'deal', acc.group(1), {'name': rec['name'], 'kind': rec['kind']}, None)
            return self.ok({'ok': True})
        if sub == 'trash' or sub.startswith('trash/'):
            return self.trash(method, sub, query)
        if sub == 'moderation':
            if method == 'POST':
                return self.toggle(self.data())
            desk = self.desk()
            return self.ok(
                {
                    'settings': moderation(store),
                    'pending': desk.items('pending'),
                    'history': desk.items('approved', 30) + desk.items('rejected', 30),
                    'archived': desk.items('archived'),
                }
            )
        acc = re.match(r'^pending/(\d{1,9})$', sub)
        if acc:
            return self.ok(self.desk().view(int(acc.group(1))))
        acc = re.match(r'^pending/(\d{1,9})/(approve|reject)$', sub)
        if acc and method == 'POST':  # fields — принять только эти поля (остальные изменения правки отбрасываются)
            payload = self.data()
            return self.ok(
                self.desk().review(
                    int(acc.group(1)),
                    acc.group(2),
                    payload.get('reason') or '',
                    got_value if isinstance(got_value := payload.get('fields'), list) else None,
                )
            )
        if sub == 'pending/approve-all' and method == 'POST':
            count = sum(
                1 for pend in store.pending_list('pending') if self.desk().review(pend['id'], 'approve', '')['ok']
            )
            return self.ok({'approved': count})
        if sub == 'export' and method == 'GET':
            cats = [
                cat for cat in (query.get('cats') or '').split(',') if re.match(r'^[A-Za-z0-9_-]{1,64}$', cat)
            ] or None
            pick = None
            if query.get('pick'):  # категории, производители, поставщики, фиды — несколько в каждом
                from supplier_scope import ExportScope

                try:
                    pick = ExportScope.clean(json.loads(query['pick'])) or None
                except ValueError as exc:
                    return self.err(400, str(exc) if 'выбор' in str(exc) else 'Неверный выбор позиций каталога')
            flt = None
            if query.get('flt'):  # «Каталог по фильтру»: категория, производитель, поставщик, поиск, с ценой, в наличии
                from supplier_scope import CatalogFilter

                try:
                    flt = CatalogFilter.clean(json.loads(query['flt']))
                except ValueError:
                    return self.err(400, 'Неверный фильтр каталога')
            prices = [x for x in (query.get('prices') or '').split(',') if x in ('price', 'rrc', 'cost', 'stock')]
            return self.export(
                [
                    section
                    for section in (query.get('sections') or ','.join(SECTIONS)).split(',')
                    if section in SECTIONS
                ],
                cats=cats,
                fallback='zip' if query.get('images') == '1' else 'json',
                sup=(query.get('sup') or '').strip() or None,
                pick=pick,
                fmt=query.get('fmt'),
                flt=flt,
                prices=prices,
            )
        if sub == 'export/filter' and method == 'GET':  # сколько позиций попадёт в «Каталог по фильтру»
            from supplier_scope import CatalogFilter

            try:
                filt = CatalogFilter.clean(json.loads(query.get('flt') or '{}'))
            except ValueError:
                return self.err(400, 'Неверный фильтр каталога')
            return self.ok({'n': len(CatalogFilter(store).ids(filt))})
        if sub.startswith(
            'settings-file'
        ):  # все настройки программы одним файлом (ключи API — по галочке, пароли — никогда)
            from data_bundle import SettingsFile

            settings_file = SettingsFile(store, actor_login or 'admin')
            data_file = self.data_file()
            if (
                sub == 'settings-file' and method == 'GET'
            ):  # любой формат выгрузки (DataFile), как у остальных вариантов
                from data_file import DataFile

                fmt = DataFile.fmt(query.get('fmt'))
                from data_bundle import Keys

                name, body = settings_file.export(Keys.WITH if query.get('keys') == '1' else Keys.WITHOUT)
                data, ext, ctype, more = data_file.dump(body.decode('utf-8'), fmt)
                self.log(
                    'export_settings',
                    'settings',
                    'file',
                    None,
                    dict(more, keys=query.get('keys') == '1', bytes=len(data), fmt=fmt),
                )
                return self.handler.send(200, ctype, data, self.handler.attachment(name[:-5] + ext))
            if sub == 'settings-file/preview' and method == 'POST':
                return self.ok(settings_file.preview(self.settings_doc(data_file, self.handler.body())))
            if sub == 'settings-file' and method == 'POST':
                picked = [x for x in (query.get('sections') or '').split(',') if x] if 'sections' in query else None
                body = self.handler.body()
                res = settings_file.apply(self.settings_doc(data_file, body), picked)
                res['images'] = self.settings_images(data_file, body)
                self.log('import_settings', 'settings', 'file', None, res)
                return self.ok(res)
            return self.err(404, 'Нет такого запроса')
        if sub == 'export/cats' and method == 'GET':
            return self.ok(self.export_cats())
        if (
            sub == 'export/scope' and method == 'GET'
        ):  # сочетания категория / производитель / поставщик / фид для выбора
            from supplier_scope import ExportScope

            return self.ok(ExportScope(store).summary())
        if sub == 'export/suppliers' and method == 'GET':
            from supplier_scope import SupplierScope

            return self.ok(SupplierScope(store).groups())
        if sub in ('import/file/preview', 'import/file') and method == 'POST':
            return self.ok(
                self.import_file(
                    self.handler.body(),
                    Load.APPLY if sub == 'import/file' else Load.PREVIEW,
                    sections=query.get('sections'),
                    name=query.get('name') or '',
                    mode=query.get('mode') if query.get('mode') in ('edits', 'auto') else 'all',
                )
            )
        if sub == 'export/sqlite' and method == 'GET':
            return self.export_sqlite()
        if sub in ('import/preview', 'import') and method == 'POST':
            load = Load.APPLY if sub == 'import' else Load.PREVIEW
            return self.ok(self.import_(self.data(), load, sections=query.get('sections')))
        if sub == 'import/sqlite' and method == 'POST':
            return self.ok(self.import_sqlite(self.handler.body(), query.get('name', '')))
        if sub.startswith('maint'):
            return self.maint(method, sub, query)
        if sub == 'migrations':
            from storage import MIGRATIONS

            return self.ok(
                {
                    'applied': store.migrations_applied(),
                    'all': [x[0] for x in MIGRATIONS],
                    'last': store.migration_last(),
                }
            )
        acc = re.match(r'^migrations/([A-Za-z0-9_.-]+)/down$', sub)
        if acc and method == 'POST':
            if acc.group(1) != store.migration_last():
                return self.err(
                    400,
                    f'Откатить можно только последнюю миграцию ({store.migration_last()}): поздние миграции меняют таблицы ранних',
                )
            store.backup(
                os.path.join(
                    os.path.dirname(store.path),
                    'backup',
                    'kp-{}-before-migration-down.zip'.format(datetime.now().strftime('%Y%m%d-%H%M%S')),
                )
            )
            store.migration_down(acc.group(1))
            return self.ok()
        return self.err(404, 'not found')

    def system(self, method, sub, query, actor_login) -> None:
        import config
        from admin_overview import Attention, Readiness, SystemInfo
        from app_update import Restarter, UpdateError, Updater

        store, updater = self.store, Updater(self.store, config.ROOT, config.DATA_DIR)
        if sub == 'system' and method == 'GET':
            return self.ok(dict(SystemInfo(store, config).get(), local=self.handler.is_local()))
        if sub == 'attention' and method == 'GET':
            return self.ok({'items': Attention(store, config).items()})
        if sub == 'readiness' and method == 'GET':
            return self.ok({'items': Readiness(store, config).items()})
        if sub == 'log' and method == 'GET':  # журнал сервера: последние ошибки (data/logs/kp.log)
            from server_log import ServerLog

            log = ServerLog.of(config.DATA_DIR)
            return self.ok(
                {
                    'errors': log.errors(30),
                    'day': log.count_since(24),
                    'bytes': log.size(),
                    'files': len(log.files()),
                    'dir': log.folder,
                    'local': self.handler.is_local(),
                }
            )
        if sub == 'log/download' and method == 'GET':
            from server_log import ServerLog

            log = ServerLog.of(config.DATA_DIR)
            return self.handler.send(
                200,
                'text/plain; charset=utf-8',
                log.text().encode('utf-8'),
                self.handler.attachment('kp-log_{}.txt'.format(datetime.now().strftime('%Y-%m-%d_%H%M'))),
            )
        if sub.startswith('alerts'):  # письма администратору о проблемах (admin_alerts.py)
            from admin_alerts import AdminAlerts

            alerts = AdminAlerts(store, config)
            try:
                if sub == 'alerts' and method == 'GET':
                    return self.ok(alerts.public())
                if sub == 'alerts' and method == 'POST':
                    before = alerts.public()
                    res = alerts.save(self.data(), actor_login)
                    self.log(
                        'edit_settings',
                        'settings',
                        'alerts',
                        {'on': before['on'], 'to': before['to']},
                        {'on': res['on'], 'to': res['to']},
                    )
                    return self.ok(res)
                if sub == 'alerts/test' and method == 'POST':
                    return self.ok(alerts.test())
            except (ValueError, RuntimeError) as exc:
                return self.err(400, str(exc))
            return self.err(404, 'not found')
        if sub == 'restart' and method == 'POST':
            self.log('restart', 'system', config.APP_TITLE)
            from server_log import ServerLog

            ServerLog.note(f'Перезапуск из «Настроек» ({actor_login or "администратор"})')
            self.ok({'ok': True, 'delay': Restarter.DELAY})
            Restarter(config.SERVER_MODE).restart(getattr(self.handler.server, 'main_server', self.handler.server))
            return None
        if sub == 'folder' and method == 'POST':
            if not self.handler.is_local():
                return self.err(403, 'Папки открываются только на компьютере, где работает программа')
            from desktop import open_folder

            path = {
                'data': config.DATA_DIR,
                'docs': config.DOCS_DIR,
                'root': config.ROOT,
                'backup': os.path.join(config.DATA_DIR, 'backup'),
                'logs': os.path.join(config.DATA_DIR, 'logs'),
            }.get(str(self.data().get('which')))
            if not path or not os.path.isdir(path):
                return self.err(404, 'Папки нет')
            open_folder(path)
            return self.ok()
        try:
            if sub == 'update' and method == 'GET':
                return self.ok(updater.status())
            if sub == 'update' and method == 'POST':
                data = self.data()
                res = updater.configure(data, actor_login or 'admin')
                self.log(
                    'edit_settings',
                    'settings',
                    'update',
                    None,
                    {
                        k: ('задан' if k == 'token' and data[k] else data[k])
                        for k in data
                        if k in ('repo', 'auto', 'token', 'nightly', 'nightHour')
                    },
                )
                return self.ok(res)
            if sub == 'update/check' and method == 'POST':
                return self.ok(updater.check())
            if sub in ('update/download', 'update/upload') and method == 'POST':
                res = (
                    updater.download_latest(actor_login or 'admin')
                    if sub == 'update/download'
                    else (updater.reinstall if query.get('force') == '1' else updater.install)(
                        self.handler.body(), actor_login or 'admin', source='файл ' + str(query.get('name') or '')[:80]
                    )
                )
                self.log(
                    'update_install',
                    'system',
                    res['version'],
                    {'version': res['from']},
                    {'version': res['version'], 'files': res['files']},
                )
                return self.ok(res)
            if sub == 'update/rollback' and method == 'POST':
                res = updater.rollback(actor_login or 'admin')
                self.log('update_rollback', 'system', res['version'])
                return self.ok(res)
            if sub == 'update/remove' and method == 'POST':
                res = updater.remove(actor_login or 'admin')
                self.log('update_remove', 'system', 'EXE')
                return self.ok(res)
        except UpdateError as exc:
            return self.err(422, str(exc))
        return self.err(404, 'not found')

    def history(self, method, sub, query) -> None:
        from settings_history import SettingsHistory

        history = SettingsHistory(self.store)
        if sub == 'history' and method == 'GET':
            key = query.get('key') if query.get('key') in SettingsHistory.KEYS else None
            limit, offset = (
                max(1, min(int(query.get('limit') or 100), 500)),
                max(0, min(int(query.get('offset') or 0), SettingsHistory.KEEP)),
            )
            return self.ok({'items': history.items(key, limit, offset), 'keys': SettingsHistory.KEYS})
        match = re.match(r'^history/(\d{1,9})(/rollback)?$', sub)
        if match and method == 'GET' and not match.group(2):
            return self.ok(history.get(match.group(1)))
        if match and method == 'POST' and match.group(2):
            res = history.rollback(match.group(1), actor(self.handler, True)[1])
            self.log('rollback_settings', 'settings', res['key'], None, {'history': res['id'], 'title': res['title']})
            return self.ok(res)
        return self.err(404, 'not found')

    def maint(self, method, sub, query) -> None:
        import maintenance

        store = self.store
        data_dir = os.path.dirname(store.path)
        img_dir = os.path.join(data_dir, 'img')
        if sub == 'maint' and method == 'GET':
            return self.ok(maintenance.summary(store, data_dir))
        if sub == 'maint/health':  # проверка «здоровья» базы: последняя (GET) или сейчас (POST)
            import config
            from db_health import DbHealth

            health = DbHealth(store, config.DATA_DIR, config.DOCS_DIR)
            if method == 'POST':
                res = health.run()
                self.log(
                    'db_health',
                    'db',
                    'health',
                    None,
                    {k: (v.get('n') if isinstance(v, dict) else v) for k, v in res.items()},
                )
                return self.ok(res)
            return self.ok(health.last())
        if sub == 'maint/overview' and method == 'GET':  # сводка над вкладкой «База и копии»
            from admin_overview import DbOverview

            return self.ok(DbOverview(store, data_dir).get())
        if sub == 'maint/backup' and method == 'POST':
            rec = maintenance.DbCopy.now(store, data_dir)
            self.log(
                'backup_db',
                'db',
                'auto',
                None,
                {'ok': rec.get('ok'), 'file': os.path.basename(rec.get('file') or '')},
                result='success' if rec.get('ok') else 'failed',
            )
            from backup_mirror import MirrorBackup

            mirror = MirrorBackup(store, data_dir)
            if mirror.config()['on'] and not mirror.status()['running']:
                threading.Thread(target=mirror.run, daemon=True, name='backup-mirror').start()
            return self.ok(maintenance.summary(store, data_dir))
        if sub.startswith('maint/mirror'):  # вторая папка для копий базы (сетевой диск, флешка, облако)
            from backup_mirror import MirrorBackup

            mirror = MirrorBackup(store, data_dir)
            if sub == 'maint/mirror' and method == 'GET':
                return self.ok(mirror.status())
            if sub == 'maint/mirror' and method == 'POST':
                res = mirror.save(self.data(), actor(self.handler, True)[1])
                self.log(
                    'edit_settings', 'settings', 'backup2', None, {k: res[k] for k in ('on', 'path', 'keep', 'images')}
                )
                return self.ok(res)
            if sub == 'maint/mirror/check' and method == 'POST':
                return self.ok(mirror.check_any(self.data()))
            if sub == 'maint/mirror/run' and method == 'POST':
                res = mirror.start()
                self.log('backup_db', 'db', 'mirror', None, {'path': res.get('path')})
                return self.ok(res)
        if sub == 'maint/run' and method == 'POST':
            rec = maintenance.db_maintenance(store, vacuum=True)
            self.log('maintain_db', 'db', 'vacuum', None, rec.get('vacuum'))
            return self.ok(maintenance.summary(store, data_dir))
        if sub == 'maint/audit' and method == 'POST':
            years = int(self.data().get('years') or 0)
            if years < 1 or years > self.AUDIT_YEARS_MAX:
                raise ValueError('Срок хранения журнала — от 1 до 20 лет')
            cfg = store.kv_get('settings') or {}
            cfg['auditYears'] = years
            store.kv_set('settings', cfg)
            count = maintenance.archive_audit(store, data_dir, years)
            self.log('edit_settings', 'settings', 'auditYears', None, {'years': years, 'archived': count})
            return self.ok(dict(maintenance.summary(store, data_dir), archivedNow=count))
        if sub == 'maint/images' and method == 'GET':
            lst = maintenance.unused_images(store, img_dir)
            return self.ok(
                {'count': len(lst), 'bytes': sum(x['bytes'] for x in lst), 'sample': [x['rel'] for x in lst[:20]]}
            )
        if sub == 'maint/images' and method == 'POST':
            import feeds  # хранилище изображений: его индекс одинаковых картинок после очистки строится заново

            res = maintenance.purge_images(store, img_dir, feeds.IMAGE_STORE)
            self.log('purge_images', 'images', 'unused', None, res)
            return self.ok(res)
        return self.err(404, 'not found')

    def access_act(self, mid: str, act, actor_login) -> None:
        """Менеджер: сброс пароля (временный — в ответе один раз), выход везде, права и вход."""
        store = self.store
        if not any(x.get('id') == mid for x in (_loads(store.managers_list()) or [])):
            return self.err(404, 'Менеджер не найден')
        if act == 'reset':
            password, hours, until = auth_users.TempPassword.issue(store, mid, hash_password, actor_login or 'admin')
            self.log('reset_password', 'manager', mid, None, {'temp': True, 'hours': hours, 'until': until})
            return self.ok({'password': password, 'hours': hours, 'until': until})
        closed = auth_users.UserSession.drop_all(store, mid)
        self.log('logout_all', 'manager', mid, None, {'closedSessions': closed})
        return self.ok({'closed': closed})

    def users(self, data, actor_login) -> dict:
        store, users, act = self.store, accounts(self.store), data.get('action')
        login = (data.get('login') or '').strip()
        u = find_account(users, login)
        if act == 'add':
            check_login(login)
            if u:
                raise ValueError(f'Логин «{login}» уже занят')
            check_new_password(data.get('password') or '')
            u = {
                'login': login,
                'name': (data.get('name') or '').strip()[:80] or login,
                'pw': hash_password(data['password']),
                'created': _now(),
                'by': actor_login,
                'main': bool(data.get('main')),
                'rights': AdminRights.clean(data.get('rights')),
            }
            users.append(u)
            save_accounts(store, users)
            self.log('create_admin', 'admin', login, None, {'login': login, 'name': u['name'], 'main': u['main']})
            return {'ok': True}
        if not u:
            raise ValueError('Учётная запись не найдена')
        if act == 'edit':
            before = {'login': u['login'], 'name': u.get('name', '')}
            new_login = (data.get('newLogin') or u['login']).strip()
            if new_login.lower() != u['login'].lower():
                check_login(new_login)
                if find_account(users, new_login):
                    raise ValueError(f'Логин «{new_login}» уже занят')
            u['login'], u['name'] = new_login, (data.get('name') or '').strip()[:80] or new_login
            save_accounts(store, users)
            self.log('edit_admin', 'admin', u['login'], before, {'login': u['login'], 'name': u['name']})
            AdminSessions.rename(login, u['login'], u['name'])
            return {'ok': True}
        if act == 'rights':
            return self._rights(users, u, data)
        if act == 'password':
            check_new_password(data.get('password') or '')
            u['pw'] = hash_password(data['password'])
            save_accounts(store, users)
            AdminSessions.drop_login(
                u['login'], keep=_cookie_token(self.handler)
            )  # сменён пароль — другие входы закрыты
            self.log('set_password', 'admin', u['login'])
            return {'ok': True}
        if act == 'delete':
            if len(users) <= 1:
                raise ValueError('Нельзя удалить единственного администратора')
            if AdminRights.is_main(u) and self._mains(users) <= 1:
                raise ValueError('Это единственный главный администратор — сначала назначьте главным другого')
            if u['login'].lower() == actor_login.lower():
                raise ValueError('Нельзя удалить свою учётную запись — войдите под другим администратором')
            users.remove(u)
            save_accounts(store, users)
            AdminSessions.drop_login(u['login'])
            self.log('delete_admin', 'admin', u['login'], {'login': u['login'], 'name': u.get('name', '')}, None)
            return {'ok': True}
        raise ValueError('Неизвестное действие')

    @staticmethod
    def _mains(users: list) -> int:
        return sum(1 for acc in users if AdminRights.is_main(acc))

    def _rights(self, users: list, u: dict, data: dict) -> dict:
        """Главный или права по вкладкам и действиям; последнего главного разжаловать нельзя."""
        before = {'main': AdminRights.is_main(u), 'rights': AdminRights.clean(u.get('rights'))}
        main = bool(data.get('main'))
        if before['main'] and not main and self._mains(users) <= 1:
            raise ValueError('Это единственный главный администратор — сначала назначьте главным другого')
        u['main'], u['rights'] = main, AdminRights.clean(data.get('rights'))
        save_accounts(self.store, users)
        self.log('edit_admin_rights', 'admin', u['login'], before, {'main': main, 'rights': u['rights']})
        return {'ok': True}

    def listing(self, etype, query_text) -> dict:
        store, query_low = self.store, query_text.lower()
        if etype == 'kp':
            from kp_files import KpFiles

            metas = store.kp_all_meta()
            file_counts = KpFiles.of(store).counts(
                [x.get('id') for x in metas]
            )  # справочные документы — «📎» у КП (удаляет администратор)
            rows = [
                {
                    'id': x.get('id'),
                    'title': '№ {} — {}'.format(x.get('number', ''), x.get('client', '')),
                    'files': file_counts.get(x.get('id'), 0),
                    'sub': '{} · {} · {}'.format(
                        x.get('date', ''), x.get('manager') or '—', (x.get('items') or [''])[0]
                    ),
                }
                for x in metas
            ]
            rows.sort(key=lambda row: row['title'], reverse=True)
        elif etype == 'catalog':
            rows = [
                {
                    'id': x['id'],
                    'title': x.get('name', ''),
                    'sub': ' · '.join(str(v) for v in ((x.get('attrs') or {}).get('maker'), x.get('spec')) if v),
                }
                for x in json.loads(store.catalog_light())
            ]
        elif etype == 'manager':
            rows = [
                {
                    'id': x['id'],
                    'title': x.get('name', ''),
                    'sub': ' · '.join(v for v in (x.get('position'), x.get('phone')) if v),
                }
                for x in json.loads(store.managers_list())
            ]
        elif etype == 'supplier':
            rows = [
                {
                    'id': x['id'],
                    'title': x.get('name', ''),
                    'sub': ' · '.join(v for v in (x.get('country'), x.get('currency')) if v),
                }
                for x in store.suppliers_list()
            ]
        else:  # контрагентов тысячи: ищем в базе, показываем первые 300
            found = store.clients_search(query_text, 300)
            rows = [
                {'id': x['id'], 'title': x.get('name', ''), 'sub': 'ИНН {}'.format(x.get('inn', ''))}
                for x in found['items']
            ]
            return {'total': found['total'], 'items': rows}
        if query_low:
            rows = [
                item
                for item in rows
                if query_low in (item['title'] + ' ' + item['sub'] + ' ' + str(item['id'])).lower()
            ]
        return {'total': len(rows), 'items': rows if etype != 'catalog' else rows[:300]}

    def delete(self, body) -> None:
        etype, ids = body.get('type'), body.get('ids') or []
        if etype not in ('kp', 'catalog', 'manager', 'client', 'supplier') or not isinstance(ids, list) or not ids:
            raise ValueError('Не выбрано, что удалить')
        if etype == 'catalog':  # название позиции — запросом по id, а не разбором всего каталога на каждую позицию
            found = {
                eid: self.store.one('SELECT name FROM catalog WHERE id=?', (eid,))
                for eid in ids
                if isinstance(eid, str)
            }
            titles = {eid: found[eid][0] if found.get(eid) else str(eid) for eid in ids}
        elif etype == 'client':  # контрагентов тысячи — по одному, а не списком
            titles = {eid: (self.store.client_get(str(eid)) or {}).get('name') or str(eid) for eid in ids}
        else:
            rows = {row['id']: row['title'] for row in self.listing(etype, '')['items']}
            titles = {eid: rows.get(eid) or str(eid) for eid in ids}
        count = 0
        for eid in ids:
            data = self.store.trash_put(etype, str(eid), titles.get(eid, str(eid)), actor(self.handler, True)[1])
            if data and etype == 'kp':
                from crm import DealBook

                DealBook.kp_moved(
                    self.store, str(eid), actor(self.handler, True)[1]
                )  # сумма сделки — без удалённого КП
            self.log(
                'delete_' + etype,
                etype,
                eid,
                {'title': titles.get(eid, '')} if data else None,
                None,
                result='success' if data else 'failed',
            )
            count += bool(data)
        return self.ok({'deleted': count})

    def desk(self) -> Any:
        from catalog_admin import ModerationDesk

        return ModerationDesk(self.store, actor(self.handler, True)[1], self.log)

    def review(self, eid, act, reason) -> Any:
        return self.desk().review(eid, act, reason)

    def trash(self, method, sub, query) -> None:
        """Корзина: список (?type=вид), восстановить, удалить навсегда одну запись, очистить (всё или один вид)."""
        from catalog_admin import TrashBin

        trash = TrashBin(self.store, self.log)
        if sub == 'trash':
            etype = query.get('type') or ''
            return self.ok(
                dict(
                    trash.items(etype if etype in TrashBin.TYPES else ''), days=SrvVal.get(self.store, 'srv.trashDays')
                )
            )
        if method != 'POST':
            return self.err(405, 'Нужен POST')
        if sub == 'trash/clear':
            return self.ok({'deleted': trash.clear(str(self.data().get('type') or ''))})
        match = re.match(r'^trash/(\d{1,9})/(restore|purge)$', sub)
        if not match:
            return self.err(404, 'Нет такого запроса')
        trash.restore(int(match.group(1))) if match.group(2) == 'restore' else trash.drop(int(match.group(1)))
        return self.ok()

    def toggle(self, data) -> None:
        before = moderation(self.store)
        enabled = bool(data.get('enabled'))
        pend = self.store.pending_list('pending')
        if not enabled and pend:
            how = data.get('pending')
            if how not in ('apply', 'reject', 'archive'):
                return self.err(409, f'Есть правки на модерации ({len(pend)}): выберите, что с ними сделать')
            for pending_item in pend:
                if how == 'archive':
                    self.store.pending_set(
                        pending_item['id'], 'archived', actor(self.handler, True)[1], 'Модерация отключена'
                    )
                else:
                    self.review(pending_item['id'], 'approve' if how == 'apply' else 'reject', 'Модерация отключена')
        _set_moderation(self.store, enabled, actor(self.handler, True)[1])
        self.log('toggle_moderation', 'settings', 'productEditModeration', before, moderation(self.store))
        return self.ok({'settings': moderation(self.store)})

    def rollback(self, aid) -> None:
        entry = self.store.audit_get(aid)
        if (
            not entry
            or entry['action'] not in ('edit_product', 'approve_edit')
            or not isinstance(entry.get('before'), dict)
        ):
            raise ValueError('Эту запись откатить нельзя')
        if any(isinstance(v, dict) and '__truncated__' in v for v in entry['before'].values()):
            raise ValueError('Правка слишком большая для отката — исправьте позицию вручную')
        cur = _loads(self.store.catalog_get(entry['entityId']))
        if cur is None:
            raise ValueError('Товара больше нет в каталоге')
        new = dict(cur)
        for k, v in entry['before'].items():
            if v == ABSENT:
                new.pop(k, None)
            else:
                new[k] = v
        self.store.catalog_put(entry['entityId'], json.dumps(new, ensure_ascii=False))
        before_diff, after_diff = diff(cur, new)
        self.log('rollback_edit', 'product', entry['entityId'], before_diff, dict(after_diff, __audit__=aid))
        return self.ok()

    def bundle(self) -> Any:
        from data_bundle import DataBundle

        return DataBundle(os.path.join(os.path.dirname(self.store.path), 'img'))

    def export_cats(self) -> list:
        """Категории каталога для выборочной выгрузки: [{cat, count}] (названия и группы — у клиента в справочнике типов)."""
        return [
            {'cat': cat or '', 'count': count}
            for cat, count in self.store.all('SELECT cat, COUNT(*) FROM catalog GROUP BY cat ORDER BY cat')
        ]

    def export(
        self, sections, cats=None, fallback='json', sup=None, pick=None, fmt=None, flt=None, prices=None
    ) -> None:
        """Выбранные разделы базы файлом в любом формате (DataFile: xlsx, json, xml, yml, zip — решение владельца 18.10)."""
        from data_file import DataFile
        from supplier_scope import SupplierScope

        store = self.store
        out: dict = {}
        items = 0
        catalog = '[]'
        keep = None
        ids = None
        docs = None
        src: tuple | None = None
        fmt = DataFile.fmt(fmt, fallback)
        if fmt == 'yml':
            # YML — каталог для сайтов и маркетплейсов: только каталог и без закупки (она при загрузке остаётся в базе)
            if 'catalog' not in sections and not sup:
                raise ValueError('YML — формат каталога: отметьте раздел «Каталог» или выберите другой формат')
            sections = ['catalog']
        if sup:
            docs = SupplierScope(store).docs(sup)
            sections, cats, items, keep = ['catalog'], None, len(docs), list(SupplierScope.PRICE_KEYS)
            catalog = json.dumps(docs, ensure_ascii=False)
            out['catalog'] = None
        elif 'catalog' in sections and (pick or flt is not None):
            from supplier_scope import CatalogFilter, ExportScope

            if flt is not None:
                ids, keep = CatalogFilter(store).ids(flt), CatalogFilter.keep(prices)
                sections = ['catalog']
            else:
                ids = ExportScope(store).ids(pick)
            out['catalog'] = None
            items = len(ids)
            parts = [
                store.joined(
                    'SELECT doc AS x FROM catalog WHERE id IN ({}) ORDER BY name'.format(
                        ','.join('?' * len(ids[i : i + 500]))
                    ),
                    tuple(ids[i : i + 500]),
                )
                for i in range(0, len(ids), 500)
            ]
            catalog = '[' + ','.join(x for x in parts if x) + ']'
            if keep:
                docs = [SupplierScope.strip(card, keep) for card in json.loads(catalog)]
                catalog = json.dumps(docs, ensure_ascii=False)
            elif fmt != 'yml':
                src = ('WHERE id IN (%s)', ids)
        elif 'catalog' in sections:
            # каталог — готовыми строками из базы, без разбора и повторной сборки: 25 000 позиций занимали 1,3 ГБ памяти сервера
            where, args = ('WHERE cat IN ({})'.format(','.join('?' * len(cats))), tuple(cats)) if cats else ('', ())
            out['catalog'] = None
            items = store.scalar('SELECT COUNT(*) FROM catalog ' + where, args)
            catalog = '[' + store.joined(f'SELECT doc AS x FROM catalog {where} ORDER BY name', args) + ']'
            src = (where, args)
        if fmt == 'yml' and 'catalog' in out:
            cost = list(SupplierScope.COST_KEYS)
            docs = [SupplierScope.strip(card, cost) for card in (docs if docs is not None else json.loads(catalog))]
            catalog, keep, src = json.dumps(docs, ensure_ascii=False), sorted(set(keep or []) | set(cost)), None
        cur = self.current(sections)
        for k in ('kp', 'managers', 'clients', 'audit', 'suppliers', 'settings'):
            if k in cur:
                out[k] = cur[k]
        from version import VERSION

        extra = [
            ('cats', cats if cats else None),
            ('pick', {k: sorted(v) for k, v in pick.items()} if pick and 'catalog' in sections else None),
            ('supplier', sup or None),
            ('keep', keep or None),
            ('filter', json.loads(json.dumps(flt, ensure_ascii=False, default=sorted)) if flt is not None else None),
        ]
        if fmt in ('xlsx', 'xml', 'yml'):
            # таблица и XML строятся из разобранных данных: каталог разбирается один раз (отпечатки — из него же), строка JSON
            # всей выгрузки не собирается — 25 000 позиций в Excel занимали больше гигабайта памяти сервера
            cat_docs = None
            if 'catalog' in out:
                cat_docs, catalog = (docs if docs is not None else json.loads(catalog)), ''
            digests = self.digests(out, cat_docs if cat_docs is not None else False)
            doc = {
                'format': 'kp-backup',
                'version': 1,
                'app': VERSION,
                'createdAt': _now(),
                'sections': {k: cat_docs if k == 'catalog' else v for k, v in out.items()},
            }
            doc.update((k, v) for k, v in extra if v is not None)
            doc['digests'] = digests
            body = None
        else:
            digests = self.digests(
                out,
                ('catalog' in out)
                and (docs if docs is not None and src is None else self._rows(src) if src else json.loads(catalog)),
            )
            secs = ','.join(
                '{}:{}'.format(json.dumps(k), catalog if k == 'catalog' else json.dumps(v, ensure_ascii=False))
                for k, v in out.items()
            )
            del catalog
            body = (
                '{{"format":"kp-backup","version":1,"app":{},"createdAt":{},"sections":{{{}}}{},"digests":{}}}'.format(
                    json.dumps(VERSION),
                    json.dumps(_now()),
                    secs,
                    ''.join(f',{json.dumps(k)}:{json.dumps(v, ensure_ascii=False)}' for k, v in extra if v is not None),
                    json.dumps(digests, separators=(',', ':')),
                )
            )
            del secs
            doc = None
        what = (
            ('+'.join(SECTION_FILE[x] for x in sections) if len(sections) < len(SECTIONS) else 'вся_база')
            + (f'_категорий-{len(cats)}' if cats else '')
            + (f'_выборка-{items}' if (pick or flt is not None) and 'catalog' in sections else '')
        )
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
        data, ext, ctype, more = self.data_file().dump(body, fmt, doc)
        del body, doc
        self.log('export_db', 'db', ','.join(sections), None, dict(info, bytes=len(data), **more))
        return self.handler.send(200, ctype, data, self.handler.attachment(f'КП_выгрузка_{what}_{stamp}{ext}'))

    def data_file(self) -> Any:
        """Форматы выгрузки: подписи столбцов Excel — из справочника категорий, ссылки на фото в YML — адрес программы."""
        from data_file import DataFile
        from equipment_types import load_types

        types = {tdef.get('id'): tdef for tdef in load_types()['types'] if isinstance(tdef, dict)}
        labels: dict = {}
        for tdef in types.values():
            for field in tdef.get('fields') or []:
                if isinstance(field, dict) and field.get('key') and field.get('label'):
                    labels.setdefault(
                        'attrs.{}'.format(field['key']),
                        field['label'] + (', ' + field['unit'] if field.get('unit') else ''),
                    )
        host = re.sub(r'[^A-Za-z0-9.:\-\[\]]', '', self.handler.headers.get('Host') or '')
        return DataFile(
            os.path.join(os.path.dirname(self.store.path), 'img'), 'http://' + host if host else '', labels, types
        )

    def current(self, sections) -> dict:
        """Разделы базы, кроме каталога, — как в файле выгрузки."""
        store = self.store
        out: dict[str, Any] = {}
        if 'kp' in sections:
            out['kp'] = [
                dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated', 'track'), row, strict=False))
                for row in store.all('SELECT id, number, state, meta, docx, updated, track FROM kp')
            ]
        if 'managers' in sections:
            out['managers'] = json.loads(store.managers_list())
        if 'clients' in sections:
            out['clients'] = store.clients_all()
        if 'audit' in sections:
            out['audit'] = store.audit_query({}, 10**7)['items']
        if 'suppliers' in sections:
            out['suppliers'] = {
                'suppliers': [{k: v for k, v in x.items() if k != '_rev'} for x in store.suppliers_list()],
                'customs': store.customs_all(),
            }
        if 'settings' in sections:
            from data_bundle import ProgramSettings

            out['settings'] = ProgramSettings(store).export()
        return out

    def _rows(self, src) -> Iterator[dict]:
        """Позиции каталога по одной (для отпечатков): условие WHERE … или список id."""
        where, args = src
        if '%s' in where:
            for i in range(0, len(args), 500):
                part = tuple(args[i : i + 500])
                for (doc,) in self.store.all('SELECT doc FROM catalog ' + where % ','.join('?' * len(part)), part):
                    yield _loads(doc) or {}
            return
        for (doc,) in self.store.all('SELECT doc FROM catalog ' + where, args):
            yield _loads(doc) or {}

    def digests(self, out, catalog) -> dict:
        """Отпечатки записей на момент выгрузки: {раздел: {id: отпечаток}}; у настроек — {"_": отпечаток}."""
        from data_file import DataFile
        from supplier_scope import SupplierScope

        res = {}
        if catalog:
            res['catalog'] = {
                x['id']: DataFile.digest(x, SupplierScope.VOLATILE)
                for x in catalog
                if isinstance(x, dict) and x.get('id')
            }
        for k in ('kp', 'managers', 'clients'):
            if isinstance(out.get(k), list):
                res[k] = {str(x.get('id')): DataFile.digest(x) for x in out[k] if isinstance(x, dict) and x.get('id')}
        if isinstance(out.get('suppliers'), dict):
            res['suppliers'] = {
                str(x.get('id')): DataFile.digest(x) for x in out['suppliers'].get('suppliers') or [] if x.get('id')
            }
        if 'settings' in out:
            res['settings'] = {'_': DataFile.digest(out['settings'])}
        return res

    def export_sqlite(self) -> None:
        """Файл базы целиком — архивом ZIP (kp.sqlite3 внутри): в 15–20 раз меньше, загружается обратно как есть."""
        tmp = os.path.join(os.path.dirname(self.store.path), 'backup', f'export-{secrets.token_hex(4)}.zip')
        self.store.backup(tmp)
        try:
            with open(tmp, 'rb') as handle:
                data = handle.read()
        finally:
            os.remove(tmp)
        self.log('export_db', 'db', 'sqlite', None, {'bytes': len(data)})
        return self.handler.send(
            200,
            'application/zip',
            data,
            self.handler.attachment('kp_{}.zip'.format(datetime.now().strftime('%Y-%m-%d_%H%M'))),
        )

    def import_sqlite(self, data, name='') -> dict:
        """Файл базы целиком (.sqlite3 или .zip с ним): проверка, копия текущей базы, замена содержимого «на ходу»."""
        import io
        import zipfile

        from storage import DbZip

        if not data:
            raise ValueError('Файл пустой')
        tmp = os.path.join(os.path.dirname(self.store.path), 'backup', f'import-{secrets.token_hex(4)}.sqlite3')
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        try:
            if data[:2] == b'PK':
                try:
                    DbZip.unpack(io.BytesIO(data), tmp)
                except zipfile.BadZipFile:
                    raise ValueError('Архив повреждён или это не архив ZIP') from None
            else:
                with open(tmp, 'wb') as handle:
                    handle.write(data)
            with open(tmp, 'rb') as handle:
                if handle.read(16) != b'SQLite format 3\x00':
                    raise ValueError('Это не файл базы SQLite (.sqlite3) и не архив с ним')
            import feeds

            if any(
                feeds.busy(fid) for fid in list(feeds.JOBS)
            ):  # фоновая загрузка писала бы старые карточки в новую базу
                raise ValueError('Идёт загрузка или проверка фида — дождитесь её окончания и загрузите файл базы снова')
            bak = self.store.restore_sqlite(tmp)
        finally:
            for ext in ('', '-wal', '-shm', '-journal'):
                try:
                    os.remove(tmp + ext)
                except OSError:
                    pass
        rep = {
            'catalog': self.store.scalar('SELECT COUNT(*) FROM catalog'),
            'kp': self.store.scalar('SELECT COUNT(*) FROM kp'),
            'clients': self.store.scalar('SELECT COUNT(*) FROM clients'),
            'backup': bak,
            'file': str(name or '')[:120],
        }
        self.log(
            'import_db',
            'db',
            'sqlite',
            None,
            {'bytes': len(data), 'file': rep['file'], 'backup': bak, 'catalog': rep['catalog'], 'kp': rep['kp']},
        )
        return rep

    @staticmethod
    def _limits_ok(x) -> bool:
        from storage import DocLimits

        try:
            DocLimits.check(x, 'Карточка')
            return True
        except ValueError:
            return False

    DUP_KEYS = {'name': 'фамилия и имя', 'email': 'e-mail', 'mobile': 'мобильный телефон', 'ext': 'добавочный номер'}

    def _dup_in_file(self, x, seen) -> str:
        """Повтор менеджера внутри одного файла (те же ключи, что manager_dup для базы). → что совпало или ''."""
        what = self.DUP_KEYS
        keys = self.store.manager_keys(x)
        return next(
            (
                what[what_key]
                for what_key in what
                if keys.get(what_key) and seen.get((what_key, keys[what_key])) not in (None, x.get('id'))
            ),
            '',
        )

    def _remember_in_file(self, x, seen) -> None:
        """Ключи менеджера — в «уже встречались в файле»."""
        keys = self.store.manager_keys(x)
        for what_key in self.DUP_KEYS:
            if keys.get(what_key):
                seen.setdefault((what_key, keys[what_key]), x.get('id'))

    def import_(self, data, load: Load, sections=None, mode='all', fmt='json') -> dict:
        """Проверка схемы и предпросмотр (что добавится / обновится); Load.APPLY — запись после копии базы."""
        apply = load is Load.APPLY
        if (
            not isinstance(data, dict)
            or data.get('format') != 'kp-backup'
            or data.get('version') != 1
            or not isinstance(data.get('sections'), dict)
        ):
            raise ValueError(
                'Это не выгрузка данных программы: нужен файл «КП_выгрузка_…», выгруженный в «Копии и база → Выгрузить»'
            )
        from data_file import DataFile

        sec = data['sections']
        want = [
            section
            for section in (sections or 'catalog,kp,managers,clients,suppliers,settings').split(',')
            if section in sec and section != 'audit' and section in SECTIONS
        ]
        store, rep, errors, conflicts = self.store, {}, [], []
        from supplier_scope import SupplierScope

        keep = SupplierScope.keep_of(data)  # выгрузка без цен и остатков: у имеющихся позиций они остаются как в базе
        digs = got_value if isinstance(got_value := data.get('digests'), dict) else {}
        edits = mode == 'edits' and bool(digs)
        if edits:
            keep = list(SupplierScope.PRICE_KEYS)
        author = actor(self.handler, True)[1]
        backup = self.import_backup() if apply else None
        exist = {
            'catalog': {x['id']: x for x in json.loads(store.catalog_light())},
            'kp': {row[0]: row for row in store.all('SELECT id, meta FROM kp')},
            'managers': {x['id']: x for x in json.loads(store.managers_list())},
            'clients': {x['id']: x for x in store.clients_all()},
            'suppliers': {x['id']: x for x in store.suppliers_list()},
        }
        req = {
            'catalog': ('id', 'name'),
            'kp': ('id', 'number'),
            'managers': ('id', 'name'),
            'clients': ('id',),
            'suppliers': ('id', 'name'),
        }
        from data_bundle import ProgramSettings

        def now_of(sec_key, cid) -> dict:
            """Запись базы сейчас — в том же виде, что в файле выгрузки (для сравнения отпечатков)."""
            if sec_key == 'catalog':
                return _loads(store.catalog_get(cid)) or {}
            if sec_key == 'kp':
                kp_row = store.one('SELECT id, number, state, meta, docx, updated, track FROM kp WHERE id=?', (cid,))
                return (
                    dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated', 'track'), kp_row, strict=False))
                    if kp_row
                    else {}
                )
            x = exist[sec_key].get(cid) or {}
            return {k: v for k, v in x.items() if k != '_rev'}

        for section in want:
            if section == 'settings':
                count = ProgramSettings(store).count(sec[section])
                if edits and (digs.get('settings') or {}).get('_'):
                    own = digs['settings']['_']
                    if DataFile.digest(sec[section]) == own:
                        rep[section] = {'new': 0, 'updated': 0, 'invalid': 0, 'same': count}
                        want = [x for x in want if x != 'settings']
                        continue
                    if DataFile.digest(ProgramSettings(store).export()) != own:
                        rep[section] = {'new': 0, 'updated': 0, 'invalid': 0, 'conflict': count}
                        conflicts.append('Настройки программы — изменены и в программе после выгрузки')
                        want = [x for x in want if x != 'settings']
                        continue
                rep[section] = {'new': 0, 'updated': count, 'invalid': 0}
                continue
            if section == 'suppliers':  # {suppliers: [...], customs: {ключ: {code, duty, note, name}}}
                rows = (sec[section].get('suppliers') if isinstance(sec[section], dict) else None) or []
            else:
                rows = sec[section] if isinstance(sec[section], list) else []
            for x in rows:
                if isinstance(x, dict) and isinstance(x.get('id'), (int, float)) and not isinstance(x.get('id'), bool):
                    x['id'] = str(int(x['id'])) if float(x['id']).is_integer() else str(x['id'])
            bad = [
                i
                for i, x in enumerate(rows)
                if not isinstance(x, dict)
                or any(not x.get(k) for k in req[section])
                or not re.match(r'^[A-Za-z0-9_-]{1,64}$', str(x.get('id')))
            ]
            errors += [f'{section}: запись {i + 1} без обязательных полей {", ".join(req[section])}' for i in bad[:5]]
            # то, на чём запись споткнулась бы посередине загрузки, — видно уже в предпросмотре и пропускается
            more = []
            seen: dict = {}
            for i, x in enumerate(rows):
                if i in bad:
                    continue
                if section == 'catalog' and 'attrs' in x and not isinstance(x['attrs'], (dict, type(None))):
                    more.append(i)
                    errors.append('Позиция «{}»: параметры не в том виде — пропущено'.format(str(x.get('name'))[:80]))
                elif section == 'suppliers' and not self._limits_ok(x):
                    more.append(i)
                    errors.append('Поставщик «{}»: карточка не в том виде — пропущено'.format(str(x.get('name'))[:80]))
                elif section == 'managers' and self._dup_in_file(x, seen):
                    more.append(i)
                    errors.append(
                        'Менеджер «{}»: повторяется в файле ({}) — пропущено'.format(
                            x.get('name'), self._dup_in_file(x, seen)
                        )
                    )
                if section == 'managers':
                    self._remember_in_file(x, seen)
                if i in more:
                    continue
                if section == 'kp' and not store.kp_import_ok(x):
                    more.append(i)
                    errors.append(f'КП {x.get("number") or x.get("id")}: испорченная запись — пропущено')
                elif section == 'managers':
                    dup = store.manager_dup(x['id'], x)
                    if dup:
                        more.append(i)
                        errors.append(
                            'Менеджер «{}»: такой уже есть — {} (совпадает {}), пропущено'.format(
                                x.get('name'), dup[0].get('name') or 'без имени', dup[1]
                            )
                        )
            bad += more
            skip = set(bad)
            ok = [x for i, x in enumerate(rows) if i not in skip]
            same = conf = 0
            if edits:
                digest, skip_keys, left = (
                    digs.get(section) or {},
                    SupplierScope.VOLATILE if section == 'catalog' else (),
                    [],
                )
                for x in ok:
                    own = digest.get(str(x['id']))
                    if own and DataFile.digest(x, skip_keys) == own:
                        same += 1
                        continue
                    if (
                        own
                        and x['id'] in exist[section]
                        and DataFile.digest(now_of(section, x['id']), skip_keys) != own
                    ):
                        conf += 1
                        if len(conflicts) < self.CONFLICTS_SHOWN:
                            conflicts.append(
                                '{} «{}» — изменено и в программе после выгрузки'.format(
                                    {
                                        'catalog': 'Позиция',
                                        'kp': 'КП',
                                        'managers': 'Менеджер',
                                        'clients': 'Клиент',
                                        'suppliers': 'Поставщик',
                                    }[section],
                                    x.get('name') or x.get('number') or x['id'],
                                )
                            )
                        continue
                    left.append(x)
                ok = left
            rep[section] = {
                'new': sum(1 for x in ok if x['id'] not in exist[section]),
                'updated': sum(1 for x in ok if x['id'] in exist[section]),
                'invalid': len(bad),
            }
            if edits:
                rep[section].update(same=same, conflict=conf)

            def put(func, x, sec_name=section, errors=errors) -> None:
                """Запись одной строки: ошибка — в отчёт, остальные записываются (загрузка не обрывается посередине)."""
                try:
                    func(x)
                except (ValueError, TypeError) as exc:
                    what = str(x.get('name') or x.get('number') or x.get('id'))[:80]
                    errors.append(f'{sec_name} «{what}»: не записано — {str(exc)[:160]}')

            if apply:
                if section == 'catalog':

                    def cat_put(x) -> None:
                        y = {k: v for k, v in x.items() if k not in ('_light', 'st', 'pricesCount')}
                        if keep and x['id'] in exist['catalog']:
                            y = SupplierScope.merge(y, _loads(store.catalog_get(x['id'])) or {}, keep)
                        store.catalog_put(x['id'], json.dumps(y, ensure_ascii=False))

                    for x in ok:
                        put(cat_put, x)
                elif section == 'kp':
                    for x in ok:
                        put(store.kp_import, x)
                elif section == 'managers':
                    for x in ok:
                        put(lambda x: store.manager_put(x['id'], json.dumps(x, ensure_ascii=False)), x)
                elif section == 'suppliers':
                    for x in ok:
                        put(lambda x: store.supplier_put(x['id'], x, author), x)
                    customs = got_value if isinstance(got_value := sec[section].get('customs'), dict) else {}
                    now = store.customs_all() if edits else {}
                    for key, code in customs.items():
                        if isinstance(code, dict) and re.match(r'^(cat|item):[\w.-]{1,80}$', str(key)):
                            if edits and all(
                                str(code.get(field) or '') == str((now.get(key) or {}).get(field) or '')
                                for field in ('code', 'duty', 'note', 'name')
                            ):
                                continue  # «только изменённое»: такие же коды ТН ВЭД не переписываются
                            store.customs_put(
                                key,
                                code.get('code'),
                                code.get('duty'),
                                code.get('note'),
                                author,
                                code.get('name') or '',
                            )
                else:
                    for x in ok:
                        put(lambda x: store.client_put(x['id'], x), x)
        if apply and 'settings' in want and isinstance(sec['settings'], dict):
            ProgramSettings(store).apply(sec['settings'])
        if apply:
            self.log(
                'import_db',
                'db',
                ','.join(want),
                None,
                {
                    'report': rep,
                    'createdAt': data.get('createdAt'),
                    'backup': backup,
                    'fmt': fmt,
                    'mode': 'edits' if edits else 'all',
                },
            )
        return {
            'report': rep,
            'errors': errors,
            'createdAt': data.get('createdAt'),
            'applied': apply,
            'keep': bool(keep) and not edits,
            'supplier': str(data.get('supplier') or '')[:120],
            'digests': bool(digs),
            'mode': 'edits' if edits else 'all',
            'conflicts': conflicts,
        }

    def import_file(self, data, load: Load, sections=None, name='', mode='all') -> dict:
        """Файл любого формата выгрузки → предпросмотр или запись (копия базы перед записью)."""
        from catalog_patch import CatalogPatch, CatalogSheet
        from data_file import DataFile

        apply = load is Load.APPLY

        kind = DataFile.sniff(data)
        if kind in ('sqlite', 'sqlite-zip'):
            if apply:
                raise ValueError('Это файл базы целиком — загрузите его в «Загрузить → Файл базы целиком»')
            return {'kind': 'sqlite'}
        if kind == 'xlsx-patch':
            patch_res, z, imgs = CatalogSheet(self.store).patch(data, str(name)[:120]), None, []
        else:
            patch_res, z, imgs = self.data_file().load(data)
        if isinstance(patch_res, dict) and patch_res.get('format') == 'kp-settings':
            if z:
                z.close()
            if apply:
                raise ValueError('Это файл настроек — загрузите его в «Загрузить → Файл настроек»')
            return {'kind': 'settings'}
        bundle = self.bundle()
        if CatalogPatch.is_patch(
            patch_res
        ):  # правки каталога: только перечисленные поля позиций, цены и остатки не трогаются
            if z:
                z.close()
            res = CatalogPatch(self.store).run(patch_res, load, actor(self.handler, True)[1], self.import_backup)
            if apply:
                self.log(
                    'import_db',
                    'db',
                    'catalog-patch',
                    None,
                    {
                        'title': res['patch']['title'],
                        'items': res['patch']['written'],
                        'fields': res['patch']['fields'],
                        'skipped': res['patch']['conflictCount'],
                    },
                )
            return res
        if mode == 'auto':  # Excel — по умолчанию «только изменённое в файле», остальное — «всё как в файле»
            mode = 'edits' if kind == 'xlsx' else 'all'
        try:
            res = self.import_(patch_res, load, sections, mode, kind)
            res['images'] = bundle.plan(imgs) if imgs else None
            res['fmt'] = kind
            if apply and imgs:
                res['images']['written'] = bundle.write(z, imgs)
                try:
                    import web_api

                    web_api.IMAGES.index = None  # новые файлы — в учёт одинаковых изображений
                except Exception:
                    pass
            return res
        finally:
            if z:
                z.close()

    def settings_doc(self, data_file, data) -> Any:
        """Файл настроек любого формата → документ kp-settings (проверку делает SettingsFile.read)."""
        from data_file import DataFile

        kind = DataFile.sniff(data)
        if kind not in ('json', 'zip', 'xlsx', 'xml'):
            raise ValueError('Это не файл настроек программы')
        if kind == 'json':
            return data
        doc, z, _ = data_file.load(data)
        if z:
            z.close()
        return doc

    def settings_images(self, data_file, data) -> int | None:
        """Архив .zip настроек: недостающие изображения (логотипы производителей) — в папку img."""
        from data_file import DataFile

        if DataFile.sniff(data) != 'zip':
            return None
        _, z, imgs = data_file.load(data)
        try:
            return self.bundle().write(z, imgs) if imgs else 0
        finally:
            z.close()

    def import_backup(self) -> str:
        return self.store.backup(
            os.path.join(
                os.path.dirname(self.store.path),
                'backup',
                'kp-{}-before-import.zip'.format(datetime.now().strftime('%Y%m%d-%H%M%S')),
            )
        )


def stats(store) -> dict:
    metas = store.kp_all_meta()
    now = datetime.now()
    today = now.date()

    def day(x) -> date | None:
        v = x.get('createdAt') or x.get('savedAt') or x.get('date') or ''
        try:
            return (
                datetime.fromisoformat(v[:19]).date()
                if len(v) > DATE_LEN
                else datetime.strptime(v[:10], '%Y-%m-%d').date()
            )
        except ValueError:
            return None

    days = [(day(x), x) for x in metas]
    top, active = SrvVal.get(store, 'srv.statTop'), SrvVal.get(store, 'srv.statActiveDays')

    def count(days_back) -> int:
        return sum(1 for stamp_day, _ in days if stamp_day and (today - stamp_day).days < days_back)

    def rub(x) -> float:
        econ = got_value if isinstance(got_value := x.get('econ'), dict) else {}
        return econ_rub(
            {
                'econ': {
                    'cur': 'RUB',
                    'sum': econ.get('sumRub')
                    if econ.get('cur') not in (None, 'RUB')
                    else (econ.get('sum') or x.get('sum') or 0),
                }
            }
        )[0]

    mgr: dict = {}
    for _, x in days:
        k = x.get('manager') or '—'
        mgr_item = mgr.setdefault(k, {'name': k, 'count': 0, 'sum': 0})
        mgr_item['count'] += 1
        mgr_item['sum'] += rub(x) or 0
    prods = sorted(
        (
            {'name': x.get('name', ''), 'count': x.get('pricesCount') or len(x.get('prices') or [])}
            for x in json.loads(store.catalog_light())
        ),
        key=lambda prod: -prod['count'],
    )
    series: dict[str, list] = {'day': [], 'week': [], 'month': []}
    for i in range(29, -1, -1):
        day_date = today - timedelta(days=i)
        series['day'].append({'label': day_date.strftime('%d.%m'), 'count': sum(1 for x, _ in days if x == day_date)})
    monday = today - timedelta(days=today.weekday())
    for i in range(11, -1, -1):
        week = monday - timedelta(weeks=i)
        series['week'].append(
            {
                'label': week.strftime('%d.%m'),
                'count': sum(1 for x, _ in days if x and week <= x < week + timedelta(days=7)),
            }
        )
    for i in range(11, -1, -1):
        y, month = today.year, today.month - i
        while month <= 0:
            y, month = y - 1, month + 12
        series['month'].append(
            {
                'label': f'{month:02d}.{y % 100}',
                'count': sum(1 for x, _ in days if x and (x.year, x.month) == (y, month)),
            }
        )
    month_ago = (now - timedelta(days=30)).isoformat(timespec='seconds')
    active_ago = (now - timedelta(days=active)).isoformat(timespec='seconds')

    def _one(sql, *args) -> Any:
        return store.scalar(sql, args)

    approved = _one("SELECT COUNT(*) FROM pending_edits WHERE status='approved'")
    rejected = _one("SELECT COUNT(*) FROM pending_edits WHERE status='rejected'")
    users = {
        rec[0]
        for rec in store.all(
            'SELECT DISTINCT user_name FROM audit WHERE ts >= ? AND user_name IS NOT NULL', (active_ago,)
        )
    }
    users |= {
        x.get('manager') for day_date, x in days if day_date and (today - day_date).days < active and x.get('manager')
    }
    users.discard('Не выбран')
    from maintenance import db_size

    size = db_size(store)
    return {
        'kp': {
            'total': len(metas),
            'today': count(1),
            'week': count(7),
            'month': count(30),
            'sumMonth': sum((rub(x) or 0) for day_date, x in days if day_date and (today - day_date).days < MONTH_DAYS),
        },
        'managers': sorted(mgr.values(), key=lambda mgr_rec: -mgr_rec['count'])[:top],
        'products': [prod_item for prod_item in prods if prod_item['count']][:top],
        'moderation': {
            'enabled': moderation(store).get('enabled'),
            'pending': _one("SELECT COUNT(*) FROM pending_edits WHERE status='pending'"),
            'approved': approved,
            'rejected': rejected,
            'conversion': round(approved * 100 / (approved + rejected), 1) if approved + rejected else None,
        },
        'activeUsers': len(users),
        'activeDays': active,
        'deletions': {
            'month': _one(
                "SELECT COUNT(*) FROM audit WHERE action LIKE 'delete\\_%' ESCAPE '\\' AND result='success' AND ts >= ?",
                month_ago,
            ),
            'total': _one("SELECT COUNT(*) FROM audit WHERE action LIKE 'delete\\_%' ESCAPE '\\' AND result='success'"),
            'trash': _one('SELECT COUNT(*) FROM trash'),
        },
        'db': {'bytes': size, 'tables': store.table_counts()},
        'series': series,
    }


def startup(store, data_dir: str, log_print=print) -> None:
    """При запуске: сброс пароля по файлу data/admin-reset.txt, очистка корзины старше srv.trashDays дней («Значения программы»)."""
    reset = os.path.join(data_dir, 'admin-reset.txt')
    if os.path.isfile(reset):
        store.write("DELETE FROM kv WHERE key IN ('admin', 'admins')")
        AdminSessions.reset(store)
        os.remove(reset)
        store.audit_add(
            {
                'action': 'set_password',
                'entityType': 'admin',
                'entityId': 'reset',
                'userName': 'Компьютер-сервер',
                'userRole': 'admin',
                'after': {'reset': True},
            }
        )
        log_print(
            'Учётные записи администраторов сброшены (data/admin-reset.txt): создайте новую в «Настройках» на этом компьютере'
        )
    count = store.trash_purge(SrvVal.get(store, 'srv.trashDays'))
    if count:
        store.audit_add(
            {
                'action': 'purge_trash',
                'entityType': 'trash',
                'userName': 'Программа',
                'userRole': 'admin',
                'after': {'count': count},
            }
        )
