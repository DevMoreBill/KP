"""Учётные записи администраторов «Настроек»: пароли, сессии, защита входа от подбора."""

import hashlib
import hmac
import math
import re
import secrets
import threading
import time
from datetime import datetime
from typing import Any

from admin_rights import AdminRights
from defaults import SrvVal


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
    FIELDS = ('csrf', 'last', 'ip', 'login', 'name', 'start')
    HOUR = 3600
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
                k: dict(v, saved=v.get('last', 0), start=v.get('start') or v.get('last', 0))
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
            if cls._expired(sess):
                cls._all().pop(k, None)
                cls._save()
                return None
            return sess

    @classmethod
    def _expired(cls, sess: dict) -> bool:
        """Бездействие дольше srv.adminIdleMin или вход старше srv.adminMaxHours (даже при работе)."""
        store, now = cls._store(), time.time()
        idle = now - sess['last'] > SrvVal.get(store, 'srv.adminIdleMin') * 60
        return (
            idle or now - float(sess.get('start') or sess['last']) > SrvVal.get(store, 'srv.adminMaxHours') * cls.HOUR
        )

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
                'start': time.time(),
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
