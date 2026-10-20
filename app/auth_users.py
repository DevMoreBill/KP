"""Вход менеджеров по логину и паролю, сессии, права, временные пароли."""

import hashlib
import json
import secrets
import threading
import time
from datetime import datetime

from defaults import SrvVal

COOKIE = 'kp_user'
PERMS = [  # ключ, подпись, по умолчанию
    ('catAdd', 'Добавлять оборудование в каталог', True),
    ('catEdit', 'Редактировать оборудование в каталоге', True),
    ('kpOthers', 'Видеть и открывать КП других менеджеров', False),
    ('dealView', 'Видеть экономику сделки', True),
    # особые права — только выбранным менеджерам и только при входе по паролю
    ('catDelete', 'Удалять товары (в корзину; восстанавливает и чистит корзину администратор)', False),
    ('catSelfMod', 'Правки без модерации: свои — сразу в каталог, принимать и отклонять правки других', False),
    ('export', 'Выгружать каталог и клиентов в файл (без закупки)', False),
]
PERM_KEYS = [perm[0] for perm in PERMS]
STRICT = ('catDelete', 'catSelfMod', 'export')
LOCK = threading.Lock()


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def enabled(store) -> bool:
    return bool(((store.kv_get('settings') or {}).get('userLogin') or {}).get('enabled'))


def set_enabled(store, enabled: bool, author: str) -> None:
    settings = store.kv_get('settings') or {}
    settings['userLogin'] = {
        **(settings.get('userLogin') or {}),
        'enabled': bool(enabled),
        'updatedAt': _now(),
        'updatedBy': author,
    }
    store.kv_set('settings', settings)
    if not enabled:
        store.kv_set('userSessions', {})


def access(store) -> dict:
    acc = store.kv_get('mgrAccess') or {}
    return acc if isinstance(acc, dict) else {}


class AccessRecord:
    """Запись одного менеджера в kv «mgrAccess»: прочитать — изменить — записать под блокировкой базы."""

    @staticmethod
    def update(store, mid, func):
        """fn(запись, все записи) → новая запись (исключение — ничего не пишется)."""
        with store.lock:
            acc = access(store)
            acc[mid] = func(dict(acc.get(mid) or {}), acc)
            store.kv_set('mgrAccess', acc)
            return acc[mid]

    @staticmethod
    def edit(rec, acc, mid, data, password, drop):
        """Правка администратора («Логин и пароль», права, запрет входа, сброс): drop — пометка «закрыть входы»."""
        if 'login' in data:
            login = norm_login(data.get('login'))
            if login and (len(login) > 40 or not all(char.isalnum() or char in '._-@' for char in login)):
                raise ValueError('Логин — буквы, цифры, точка, дефис, «_» или «@», до 40 символов')
            if login and any(norm_login(other.get('login')) == login for k, other in acc.items() if k != mid):
                raise ValueError('Такой логин уже есть у другого менеджера')
            rec['login'] = login
        if password:
            rec['pw'] = password
            rec.pop('temp', None)  # пароль от администратора — постоянный
            drop.append(True)
        if isinstance(data.get('perms'), dict):
            rec['perms'] = {k: bool(data['perms'].get(k, perms_of(rec)[k])) for k in PERM_KEYS}
        if 'blocked' in data:
            rec['blocked'] = bool(data['blocked'])
            if rec['blocked']:
                drop.append(True)
        if data.get('clear'):
            rec = {'perms': perms_of(rec)}
            drop.append(True)
        return rec


def perms_of(rec: dict) -> dict:
    perms = (rec or {}).get('perms') or {}
    return {k: bool(perms.get(k, key)) for k, _, key in PERMS}


def public(store, managers: list) -> list[dict]:
    """Для «Настроек»: менеджеры с логином, правами, последним входом, временным паролем (до какого времени)."""
    acc = access(store)
    count = UserSession.count(store)
    out = []
    for mgr in managers:
        rec = acc.get(mgr.get('id')) or {}
        temp = TempPassword.of(rec)
        out.append(
            {
                'id': mgr.get('id'),
                'name': mgr.get('name') or '',
                'position': mgr.get('position') or '',
                'login': rec.get('login') or '',
                'hasPassword': bool(rec.get('pw')),
                'blocked': bool(rec.get('blocked')),
                'perms': perms_of(rec),
                'lastLogin': rec.get('lastLogin') or '',
                'temp': (
                    {
                        'until': datetime.fromtimestamp(temp['exp']).isoformat(timespec='minutes'),
                        'expired': TempPassword.expired(rec),
                    }
                    if temp
                    else None
                ),
                'sessions': count.get(mgr.get('id'), 0),
            }
        )
    return out


def check_password(password) -> None:
    minimum = SrvVal.now('srv.userPwMin')
    if len(password or '') < minimum:
        raise ValueError(f'Пароль — не короче {minimum} символов')


def norm_login(text) -> str:
    return str(text or '').strip().lower()


def set_access(store, mid: str, data: dict, hash_password) -> dict:
    """Логин, пароль (если передан), права и блокировка менеджера. ValueError — с понятным текстом."""
    if data.get('password'):
        check_password(data['password'])
    password = hash_password(data['password']) if data.get('password') else None  # медленный хеш — до блокировки базы
    drop: list = []
    rec = AccessRecord.update(store, mid, lambda rec, acc: AccessRecord.edit(rec, acc, mid, data, password, drop))
    if drop:
        drop_sessions(store, mid)
    return rec


def _hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _sessions(store) -> dict:
    sessions = store.kv_get('userSessions') or {}
    now = time.time()
    return {k: v for k, v in sessions.items() if isinstance(v, dict) and v.get('exp', 0) > now}


class UserSession:
    """Сессия менеджера после входа."""

    @staticmethod
    def start(store, mid: str, remember: bool = True) -> str:
        tok = secrets.token_urlsafe(32)
        ttl = (
            SrvVal.get(store, 'srv.userSessionDays') * 86400
            if remember
            else SrvVal.get(store, 'srv.userShortHours') * 3600
        )
        with LOCK:
            sessions = _sessions(store)
            sessions[_hash(tok)] = {'mid': mid, 'exp': time.time() + ttl}
            store.kv_set('userSessions', sessions)
        return tok

    @staticmethod
    def count(store) -> dict:
        """Открытые входы по менеджерам: {id: число}."""
        out: dict = {}
        for v in _sessions(store).values():
            out[v.get('mid')] = out.get(v.get('mid'), 0) + 1
        return out

    @staticmethod
    def drop_all(store, mid: str, keep: str = '') -> int:
        """«Выйти на всех устройствах»: закрыть все входы менеджера (keep — токен входа, который остаётся). Число закрытых."""
        with LOCK:
            sessions = _sessions(store)
            keep_hash = _hash(keep) if keep else ''
            left = {k: v for k, v in sessions.items() if v.get('mid') != mid or k == keep_hash}
            store.kv_set('userSessions', left)
        return len(sessions) - len(left)

    @staticmethod
    def cookie(tok: str, remember: bool = True) -> str:
        """Set-Cookie: пустой tok — удалить cookie (выход)."""
        if not tok:
            return f'{COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
        age = f'; Max-Age={SrvVal.now("srv.userSessionDays") * 86400}' if remember else ''
        return f'{COOKIE}={tok}; Path=/{age}; HttpOnly; SameSite=Strict'


class LoginInfo:
    """Что экран входа знает до входа: подсказка «Забыли пароль?»."""

    HELP_MAX = 200

    @staticmethod
    def help(store) -> str:
        return str(((store.kv_get('settings') or {}).get('userLogin') or {}).get('help') or '')

    @classmethod
    def set_help(cls, store, text, author: str) -> str:
        if not isinstance(text, str):
            raise ValueError('Подсказка «Забыли пароль?» — текст')
        text = ' '.join(text.split())
        if len(text) > cls.HELP_MAX:
            raise ValueError(f'Подсказка «Забыли пароль?» — не длиннее {cls.HELP_MAX} символов')
        settings = store.kv_get('settings') or {}
        settings['userLogin'] = {**(settings.get('userLogin') or {}), 'help': text, 'helpAt': _now(), 'helpBy': author}
        store.kv_set('settings', settings)
        return text

    @classmethod
    def public(cls, store):
        return {
            'help': cls.help(store),
            'sessionDays': SrvVal.get(store, 'srv.userSessionDays'),
            'shortHours': SrvVal.get(store, 'srv.userShortHours'),
            'pwMin': SrvVal.get(store, 'srv.userPwMin'),
        }


class TempPassword:
    """Временный пароль от администратора: без похожих знаков, только хешем, rec['temp'] = {exp, at, by}."""

    ABC = 'abcdefghjkmnpqrstuvwxyz23456789'
    LEN = 10

    @staticmethod
    def of(rec: dict) -> dict | None:
        temp = (rec or {}).get('temp')
        return temp if isinstance(temp, dict) and temp.get('exp') else None

    @classmethod
    def expired(cls, rec: dict) -> bool:
        temp = cls.of(rec)
        return temp is not None and temp['exp'] <= time.time()

    @classmethod
    def issue(cls, store, mid: str, hash_password, author: str) -> tuple:
        """Новый временный пароль менеджеру: (пароль, часов, до какого времени); все его входы закрываются."""
        if not (access(store).get(mid) or {}).get('login'):
            raise ValueError('Сначала задайте менеджеру логин («Логин и пароль»)')
        length = max(cls.LEN, SrvVal.get(store, 'srv.userPwMin'))
        password = ''.join(secrets.choice(cls.ABC) for _ in range(length))
        hours = SrvVal.get(store, 'srv.tempPwHours')
        exp = time.time() + hours * 3600
        temp = {'pw': hash_password(password), 'temp': {'exp': exp, 'at': _now(), 'by': author}}
        AccessRecord.update(store, mid, lambda rec, _access: dict(rec, **temp))
        UserSession.drop_all(store, mid)
        return password, hours, datetime.fromtimestamp(exp).isoformat(timespec='minutes')


class UserPassword:
    """Смена пароля менеджером: текущий (кроме временного) и новый дважды; другие входы закрываются."""

    MAX = 128

    @classmethod
    def change(cls, store, mid: str, data: dict, keep: str, verify, hash_password) -> tuple:
        """→ (был ли пароль временным, закрыто входов); PermissionError — текущий пароль неверный."""
        rec = dict(access(store).get(mid) or {})
        temp = TempPassword.of(rec) is not None
        new, new2 = data.get('new'), data.get('new2')
        if not isinstance(new, str) or not isinstance(new2, str) or not new:
            raise ValueError('Введите новый пароль два раза')
        if not temp and not verify(data.get('old'), rec.get('pw')):
            raise PermissionError('Текущий пароль указан неверно')
        if len(new) > cls.MAX:
            raise ValueError(f'Пароль — не длиннее {cls.MAX} символов')
        check_password(new)
        if new != new2:
            raise ValueError('Новый пароль и повтор не совпадают')
        if verify(new, rec.get('pw')):
            raise ValueError('Новый пароль совпадает с прежним — придумайте другой')
        password = hash_password(new)
        AccessRecord.update(
            store, mid, lambda old, _access: {k: v for k, v in dict(old, pw=password).items() if k != 'temp'}
        )
        return temp, UserSession.drop_all(store, mid, keep)


def drop_sessions(store, mid: str | None = None, tok: str | None = None) -> None:
    with LOCK:
        sessions = _sessions(store)
        sessions = {
            k: v for k, v in sessions.items() if not ((mid and v.get('mid') == mid) or (tok and k == _hash(tok)))
        }
        store.kv_set('userSessions', sessions)


def cookie_token(handler) -> str:
    for part in (handler.headers.get('Cookie') or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == COOKIE:
            return v
    return ''


def current(handler, store) -> dict | None:
    """Вошедший менеджер {id, name, perms} или None. Кешируется на время запроса."""
    if hasattr(handler, '_kp_user'):
        return handler._kp_user
    u = None
    tok = cookie_token(handler)
    if tok:
        rec = _sessions(store).get(_hash(tok))
        if rec:
            acc = access(store).get(rec['mid']) or {}
            if not acc.get('blocked') and acc.get('pw') and not TempPassword.expired(acc):
                mgr = next((x for x in json.loads(store.managers_list()) if x.get('id') == rec['mid']), None)
                if mgr:
                    u = {
                        'id': rec['mid'],
                        'name': mgr.get('name') or acc.get('login') or '',
                        'login': acc.get('login') or '',
                        'perms': perms_of(acc),
                    }
                    if TempPassword.of(acc):  # вошёл с временным паролем — сначала задать свой
                        u['mustChange'] = True
    handler._kp_user = u
    return u


def find_by_login(store, login: object) -> tuple:
    login = norm_login(login)
    for mid, rec in access(store).items():
        if login and norm_login(rec.get('login')) == login:
            return mid, rec
    return None, None


def touch_login(store, mid: str) -> None:
    if mid in access(store):
        AccessRecord.update(store, mid, lambda rec, _access: dict(rec, lastLogin=_now()))
