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
PERM_KEYS = [p[0] for p in PERMS]
STRICT = ('catDelete', 'catSelfMod', 'export')
LOCK = threading.Lock()


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def enabled(store) -> bool:
    return bool(((store.kv_get('settings') or {}).get('userLogin') or {}).get('enabled'))


def set_enabled(store, on: bool, by: str) -> None:
    st = store.kv_get('settings') or {}
    st['userLogin'] = {**(st.get('userLogin') or {}), 'enabled': bool(on), 'updatedAt': _now(), 'updatedBy': by}
    store.kv_set('settings', st)
    if not on:
        store.kv_set('userSessions', {})


def access(store) -> dict:
    a = store.kv_get('mgrAccess') or {}
    return a if isinstance(a, dict) else {}


class AccessRecord:
    """Запись одного менеджера в kv «mgrAccess»: прочитать — изменить — записать под блокировкой базы."""

    @staticmethod
    def update(store, mid, fn):
        """fn(запись, все записи) → новая запись (исключение — ничего не пишется)."""
        with store.lock:
            a = access(store)
            a[mid] = fn(dict(a.get(mid) or {}), a)
            store.kv_set('mgrAccess', a)
            return a[mid]

    @staticmethod
    def edit(rec, a, mid, d, pw, drop):
        """Правка администратора («Логин и пароль», права, запрет входа, сброс): drop — пометка «закрыть входы»."""
        if 'login' in d:
            login = norm_login(d.get('login'))
            if login and (len(login) > 40 or not all(ch.isalnum() or ch in '._-@' for ch in login)):
                raise ValueError('Логин — буквы, цифры, точка, дефис, «_» или «@», до 40 символов')
            if login and any(norm_login(r.get('login')) == login for k, r in a.items() if k != mid):
                raise ValueError('Такой логин уже есть у другого менеджера')
            rec['login'] = login
        if pw:
            rec['pw'] = pw
            rec.pop('temp', None)  # пароль от администратора — постоянный
            drop.append(True)
        if isinstance(d.get('perms'), dict):
            rec['perms'] = {k: bool(d['perms'].get(k, perms_of(rec)[k])) for k in PERM_KEYS}
        if 'blocked' in d:
            rec['blocked'] = bool(d['blocked'])
            if rec['blocked']:
                drop.append(True)
        if d.get('clear'):
            rec = {'perms': perms_of(rec)}
            drop.append(True)
        return rec


def perms_of(rec: dict) -> dict:
    p = (rec or {}).get('perms') or {}
    return {k: bool(p.get(k, d)) for k, _, d in PERMS}


def public(store, managers: list) -> list[dict]:
    """Для «Настроек»: менеджеры с логином, правами, последним входом, временным паролем (до какого времени)."""
    a = access(store)
    n = UserSession.count(store)
    out = []
    for m in managers:
        r = a.get(m.get('id')) or {}
        t = TempPassword.of(r)
        out.append(
            {
                'id': m.get('id'),
                'name': m.get('name') or '',
                'position': m.get('position') or '',
                'login': r.get('login') or '',
                'hasPassword': bool(r.get('pw')),
                'blocked': bool(r.get('blocked')),
                'perms': perms_of(r),
                'lastLogin': r.get('lastLogin') or '',
                'temp': (
                    {
                        'until': datetime.fromtimestamp(t['exp']).isoformat(timespec='minutes'),
                        'expired': TempPassword.expired(r),
                    }
                    if t
                    else None
                ),
                'sessions': n.get(m.get('id'), 0),
            }
        )
    return out


def check_password(pw) -> None:
    n = SrvVal.now('srv.userPwMin')
    if len(pw or '') < n:
        raise ValueError(f'Пароль — не короче {n} символов')


def norm_login(s) -> str:
    return str(s or '').strip().lower()


def set_access(store, mid: str, d: dict, hash_password) -> dict:
    """Логин, пароль (если передан), права и блокировка менеджера. ValueError — с понятным текстом."""
    if d.get('password'):
        check_password(d['password'])
    pw = hash_password(d['password']) if d.get('password') else None  # медленный хеш — до блокировки базы
    drop = []
    rec = AccessRecord.update(store, mid, lambda rec, a: AccessRecord.edit(rec, a, mid, d, pw, drop))
    if drop:
        drop_sessions(store, mid)
    return rec


def _h(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _sessions(store) -> dict:
    s = store.kv_get('userSessions') or {}
    now = time.time()
    return {k: v for k, v in s.items() if isinstance(v, dict) and v.get('exp', 0) > now}


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
            s = _sessions(store)
            s[_h(tok)] = {'mid': mid, 'exp': time.time() + ttl}
            store.kv_set('userSessions', s)
        return tok

    @staticmethod
    def count(store) -> dict:
        """Открытые входы по менеджерам: {id: число}."""
        out = {}
        for v in _sessions(store).values():
            out[v.get('mid')] = out.get(v.get('mid'), 0) + 1
        return out

    @staticmethod
    def drop_all(store, mid: str, keep: str = '') -> int:
        """«Выйти на всех устройствах»: закрыть все входы менеджера (keep — токен входа, который остаётся). Число закрытых."""
        with LOCK:
            s = _sessions(store)
            kh = _h(keep) if keep else ''
            left = {k: v for k, v in s.items() if v.get('mid') != mid or k == kh}
            store.kv_set('userSessions', left)
        return len(s) - len(left)

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
    def set_help(cls, store, text, by: str) -> str:
        if not isinstance(text, str):
            raise ValueError('Подсказка «Забыли пароль?» — текст')
        text = ' '.join(text.split())
        if len(text) > cls.HELP_MAX:
            raise ValueError(f'Подсказка «Забыли пароль?» — не длиннее {cls.HELP_MAX} символов')
        st = store.kv_get('settings') or {}
        st['userLogin'] = {**(st.get('userLogin') or {}), 'help': text, 'helpAt': _now(), 'helpBy': by}
        store.kv_set('settings', st)
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
        t = (rec or {}).get('temp')
        return t if isinstance(t, dict) and t.get('exp') else None

    @classmethod
    def expired(cls, rec: dict) -> bool:
        t = cls.of(rec)
        return bool(t) and t['exp'] <= time.time()

    @classmethod
    def issue(cls, store, mid: str, hash_password, by: str) -> tuple:
        """Новый временный пароль менеджеру: (пароль, часов, до какого времени); все его входы закрываются."""
        if not (access(store).get(mid) or {}).get('login'):
            raise ValueError('Сначала задайте менеджеру логин («Логин и пароль»)')
        n = max(cls.LEN, SrvVal.get(store, 'srv.userPwMin'))
        pw = ''.join(secrets.choice(cls.ABC) for _ in range(n))
        hours = SrvVal.get(store, 'srv.tempPwHours')
        exp = time.time() + hours * 3600
        temp = {'pw': hash_password(pw), 'temp': {'exp': exp, 'at': _now(), 'by': by}}
        AccessRecord.update(store, mid, lambda rec, _a: dict(rec, **temp))
        UserSession.drop_all(store, mid)
        return pw, hours, datetime.fromtimestamp(exp).isoformat(timespec='minutes')


class UserPassword:
    """Смена пароля менеджером: текущий (кроме временного) и новый дважды; другие входы закрываются."""

    MAX = 128

    @classmethod
    def change(cls, store, mid: str, d: dict, keep: str, verify, hash_password) -> tuple:
        """→ (был ли пароль временным, закрыто входов); PermissionError — текущий пароль неверный."""
        rec = dict(access(store).get(mid) or {})
        temp = TempPassword.of(rec) is not None
        new, new2 = d.get('new'), d.get('new2')
        if not isinstance(new, str) or not isinstance(new2, str) or not new:
            raise ValueError('Введите новый пароль два раза')
        if not temp and not verify(d.get('old'), rec.get('pw')):
            raise PermissionError('Текущий пароль указан неверно')
        if len(new) > cls.MAX:
            raise ValueError(f'Пароль — не длиннее {cls.MAX} символов')
        check_password(new)
        if new != new2:
            raise ValueError('Новый пароль и повтор не совпадают')
        if verify(new, rec.get('pw')):
            raise ValueError('Новый пароль совпадает с прежним — придумайте другой')
        pw = hash_password(new)
        AccessRecord.update(store, mid, lambda r, _a: {k: v for k, v in dict(r, pw=pw).items() if k != 'temp'})
        return temp, UserSession.drop_all(store, mid, keep)


def drop_sessions(store, mid: str | None = None, tok: str | None = None) -> None:
    with LOCK:
        s = _sessions(store)
        s = {k: v for k, v in s.items() if not ((mid and v.get('mid') == mid) or (tok and k == _h(tok)))}
        store.kv_set('userSessions', s)


def cookie_token(h) -> str:
    for part in (h.headers.get('Cookie') or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == COOKIE:
            return v
    return ''


def current(h, store) -> dict | None:
    """Вошедший менеджер {id, name, perms} или None. Кешируется на время запроса."""
    if hasattr(h, '_kp_user'):
        return h._kp_user
    u = None
    tok = cookie_token(h)
    if tok:
        rec = _sessions(store).get(_h(tok))
        if rec:
            acc = access(store).get(rec['mid']) or {}
            if not acc.get('blocked') and acc.get('pw') and not TempPassword.expired(acc):
                m = next((x for x in json.loads(store.managers_list()) if x.get('id') == rec['mid']), None)
                if m:
                    u = {
                        'id': rec['mid'],
                        'name': m.get('name') or acc.get('login') or '',
                        'login': acc.get('login') or '',
                        'perms': perms_of(acc),
                    }
                    if TempPassword.of(acc):  # вошёл с временным паролем — сначала задать свой
                        u['mustChange'] = True
    h._kp_user = u
    return u


def find_by_login(store, login: str) -> tuple:
    login = norm_login(login)
    for mid, r in access(store).items():
        if login and norm_login(r.get('login')) == login:
            return mid, r
    return None, None


def touch_login(store, mid: str) -> None:
    if mid in access(store):
        AccessRecord.update(store, mid, lambda rec, _a: dict(rec, lastLogin=_now()))
