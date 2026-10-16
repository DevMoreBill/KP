# -*- coding: utf-8 -*-
"""Вход менеджеров в конструктор по логину и паролю и права менеджеров.

• Режим входа — kv «settings».userLogin.enabled (включает и выключает администратор в «Настройках → Менеджеры и доступ»).
  Выключен — менеджер выбирается на устройстве, права не проверяются.
  Включён — без входа конструктор не открывается; кто работает, сервер знает по сессии (а не по подписи запроса).
• Учётные данные и права — kv «mgrAccess»: {id менеджера: {login, pw (хеш), perms, lastLogin}}. Отдельно от справочника
  менеджеров: справочник уходит в каждый браузер, а хеши паролей и права — нет.
• Сессия — cookie kp_user (HttpOnly, SameSite=Strict, 30 дней — srv.userSessionDays в «Значениях программы»); в базе — только хеш токена (kv «userSessions»),
  поэтому вход переживает перезапуск программы. Выход, смена пароля или права «вход запрещён» закрывают сессии.
  Без «Запомнить меня» — cookie до закрытия браузера и не дольше srv.userShortHours часов (UserSession).
• Экран входа — подсказка «Забыли пароль?» от администратора (settings.userLogin.help, LoginInfo).
• Пароль — не короче srv.userPwMin символов (по умолчанию 4); хранится только хешем, как у администраторов.
"""
import hashlib
import json
import secrets
import threading
import time
from datetime import datetime

from defaults import SrvVal

COOKIE = 'kp_user'
PERMS = [   # ключ, подпись, по умолчанию
    ('catAdd', 'Добавлять оборудование в каталог', True),
    ('catEdit', 'Редактировать оборудование в каталоге', True),
    ('kpOthers', 'Видеть и открывать КП других менеджеров', False),
    ('dealView', 'Видеть экономику сделки', True),
]
PERM_KEYS = [p[0] for p in PERMS]
LOCK = threading.Lock()


def _now():
    return datetime.now().isoformat(timespec='seconds')


def enabled(store):
    return bool(((store.kv_get('settings') or {}).get('userLogin') or {}).get('enabled'))


def set_enabled(store, on, by):
    st = store.kv_get('settings') or {}
    st['userLogin'] = {**(st.get('userLogin') or {}), 'enabled': bool(on), 'updatedAt': _now(), 'updatedBy': by}
    store.kv_set('settings', st)
    if not on:
        store.kv_set('userSessions', {})


def access(store):
    a = store.kv_get('mgrAccess') or {}
    return a if isinstance(a, dict) else {}


def perms_of(rec):
    p = (rec or {}).get('perms') or {}
    return {k: bool(p.get(k, d)) for k, _, d in PERMS}


def public(store, managers):
    """Для «Настроек»: менеджеры с логином, правами и последним входом — без хешей."""
    a = access(store)
    out = []
    for m in managers:
        r = a.get(m.get('id')) or {}
        out.append({'id': m.get('id'), 'name': m.get('name') or '', 'position': m.get('position') or '', 'login': r.get('login') or '',
                    'hasPassword': bool(r.get('pw')), 'blocked': bool(r.get('blocked')), 'perms': perms_of(r), 'lastLogin': r.get('lastLogin') or ''})
    return out


def check_password(pw):
    n = SrvVal.now('srv.userPwMin')
    if len(pw or '') < n:
        raise ValueError('Пароль — не короче %d символов' % n)


def norm_login(s):
    return str(s or '').strip().lower()


def set_access(store, mid, d, hash_password):
    """Логин, пароль (если передан), права и блокировка менеджера. ValueError — с понятным текстом."""
    a = access(store)
    rec = dict(a.get(mid) or {})
    if 'login' in d:
        login = norm_login(d.get('login'))
        if login and (len(login) > 40 or not all(ch.isalnum() or ch in '._-@' for ch in login)):
            raise ValueError('Логин — буквы, цифры, точка, дефис, «_» или «@», до 40 символов')
        if login and any(norm_login(r.get('login')) == login for k, r in a.items() if k != mid):
            raise ValueError('Такой логин уже есть у другого менеджера')
        rec['login'] = login
    if d.get('password'):
        check_password(d['password'])
        rec['pw'] = hash_password(d['password'])
        drop_sessions(store, mid)
    if isinstance(d.get('perms'), dict):
        rec['perms'] = {k: bool(d['perms'].get(k, perms_of(rec)[k])) for k in PERM_KEYS}
    if 'blocked' in d:
        rec['blocked'] = bool(d['blocked'])
        if rec['blocked']:
            drop_sessions(store, mid)
    if d.get('clear'):
        rec = {'perms': perms_of(rec)}
        drop_sessions(store, mid)
    a[mid] = rec
    store.kv_set('mgrAccess', a)
    return rec


# ---------------------------------------------------------------- сессии
def _h(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def _sessions(store):
    s = store.kv_get('userSessions') or {}
    now = time.time()
    return {k: v for k, v in s.items() if isinstance(v, dict) and v.get('exp', 0) > now}


class UserSession:
    """Сессия менеджера после входа. remember — «Запомнить меня на этом устройстве»: cookie на srv.userSessionDays дней;
    без неё — cookie до закрытия браузера (без Max-Age), а сервер держит сессию не дольше srv.userShortHours часов."""

    @staticmethod
    def start(store, mid, remember=True):
        tok = secrets.token_urlsafe(32)
        ttl = SrvVal.get(store, 'srv.userSessionDays') * 86400 if remember else SrvVal.get(store, 'srv.userShortHours') * 3600
        with LOCK:
            s = _sessions(store)
            s[_h(tok)] = {'mid': mid, 'exp': time.time() + ttl}
            store.kv_set('userSessions', s)
        return tok

    @staticmethod
    def cookie(tok, remember=True):
        """Set-Cookie: пустой tok — удалить cookie (выход)."""
        if not tok:
            return '%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' % COOKIE
        age = '; Max-Age=%d' % (SrvVal.now('srv.userSessionDays') * 86400) if remember else ''
        return '%s=%s; Path=/%s; HttpOnly; SameSite=Strict' % (COOKIE, tok, age)


class LoginInfo:
    """Что экран входа знает до входа: подсказка «Забыли пароль?» (её пишет администратор — к кому обращаться),
    срок «Запомнить меня». Только то, что администратор сам решил показать, — без логинов и данных менеджеров."""
    HELP_MAX = 200

    @staticmethod
    def help(store):
        return str(((store.kv_get('settings') or {}).get('userLogin') or {}).get('help') or '')

    @classmethod
    def set_help(cls, store, text, by):
        if not isinstance(text, str):
            raise ValueError('Подсказка «Забыли пароль?» — текст')
        text = ' '.join(text.split())
        if len(text) > cls.HELP_MAX:
            raise ValueError('Подсказка «Забыли пароль?» — не длиннее %d символов' % cls.HELP_MAX)
        st = store.kv_get('settings') or {}
        st['userLogin'] = {**(st.get('userLogin') or {}), 'help': text, 'helpAt': _now(), 'helpBy': by}
        store.kv_set('settings', st)
        return text

    @classmethod
    def public(cls, store):
        return {'help': cls.help(store), 'sessionDays': SrvVal.get(store, 'srv.userSessionDays'),
                'shortHours': SrvVal.get(store, 'srv.userShortHours')}


def drop_sessions(store, mid=None, tok=None):
    with LOCK:
        s = _sessions(store)
        s = {k: v for k, v in s.items() if not ((mid and v.get('mid') == mid) or (tok and k == _h(tok)))}
        store.kv_set('userSessions', s)


def cookie_token(h):
    for part in (h.headers.get('Cookie') or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == COOKIE:
            return v
    return ''


def current(h, store):
    """Вошедший менеджер {id, name, perms} или None. Кешируется на время запроса."""
    if hasattr(h, '_kp_user'):
        return h._kp_user
    u = None
    tok = cookie_token(h)
    if tok:
        rec = _sessions(store).get(_h(tok))
        if rec:
            acc = access(store).get(rec['mid']) or {}
            if not acc.get('blocked') and acc.get('pw'):
                m = next((x for x in json.loads(store.managers_list()) if x.get('id') == rec['mid']), None)
                if m:       # менеджера удалили из справочника — сессия больше не действует
                    u = {'id': rec['mid'], 'name': m.get('name') or acc.get('login') or '', 'login': acc.get('login') or '', 'perms': perms_of(acc)}
    h._kp_user = u
    return u


def find_by_login(store, login):
    login = norm_login(login)
    for mid, r in access(store).items():
        if login and norm_login(r.get('login')) == login:
            return mid, r
    return None, None


def touch_login(store, mid):
    a = access(store)
    if mid in a:
        a[mid]['lastLogin'] = _now()
        store.kv_set('mgrAccess', a)
