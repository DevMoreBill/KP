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

from storage import Conflict

IDLE_SECONDS = 15 * 60
TRASH_DAYS = 30
FAIL_LIMIT, FAIL_WINDOW = 5, 10 * 60
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
    if len(pw or '') < 8:
        raise ValueError('Пароль — не короче 8 символов')
    if not (re.search(r'\d', pw) and re.search(r'[^\d]', pw)):
        raise ValueError('В пароле нужны и буквы, и цифры')


# ---------------------------------------------------------------- сессии и попытки входа
SESSIONS = {}
FAILS = {}
LOCK = threading.Lock()


def _cookie_token(h):
    for part in (h.headers.get('Cookie') or '').split(';'):
        k, _, v = part.strip().partition('=')
        if k == 'kp_admin':
            return v
    return ''


def session(h, touch=True):
    """Действующая сессия администратора или None (по cookie; 15 минут бездействия — сессия закрывается)."""
    tok = _cookie_token(h)
    with LOCK:
        s = SESSIONS.get(tok)
        if not s:
            return None
        if time.time() - s['last'] > IDLE_SECONDS:
            SESSIONS.pop(tok, None)
            return None
        if touch:
            s['last'] = time.time()
        return s


def is_admin(h, need_csrf=True):
    s = session(h)
    if not s:
        return False
    return not need_csrf or hmac.compare_digest(h.headers.get('X-CSRF-Token') or '', s['csrf'])


def _start_session(h, user=None):
    tok, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    with LOCK:
        SESSIONS[tok] = {'csrf': csrf, 'last': time.time(), 'ip': _ip(h), 'login': (user or {}).get('login', ''),
                         'name': (user or {}).get('name') or (user or {}).get('login') or 'Администратор'}
    return tok, csrf


def _locked(ip):
    now = time.time()
    with LOCK:
        FAILS[ip] = [t for t in FAILS.get(ip, []) if now - t < FAIL_WINDOW]
        return len(FAILS[ip]) >= FAIL_LIMIT


def _fail(ip):
    with LOCK:
        FAILS.setdefault(ip, []).append(time.time())


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
    if admin and s:                                   # действия в «Настройках» — от имени вошедшего администратора
        return 'admin:' + s.get('login', ''), s.get('name') or 'Администратор', 'admin'
    return uid or None, name or ('Администратор' if admin else 'Не выбран'), 'admin' if admin else 'user'


# ---------- «Экономика сделки»: только автору КП и администратору ----------
# Автор — authorId в состоянии/описании КП (у КП прежних версий — менеджер КП). Пользователь — подпись запроса
# (менеджер, выбранный на устройстве): это не вход по паролю, а защита от случайного просмотра; администратор видит всё.
DEAL_KEYS_STATE = ('deal',)
DEAL_KEYS_META = ('deal', 'econ')


def deal_allowed(h, doc):
    if session(h, touch=False) is not None:
        return True
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


def kp_in(h, store, kid, field, text):
    """Сохранение КП не автором: расчёт экономики и автор остаются прежними (их не видно — значит, и не затереть)."""
    if field not in ('state', 'meta'):
        return text
    old = store.kp_get(kid, field)
    if not old:
        return text
    try:
        o, n = json.loads(old), json.loads(text)
    except ValueError:
        return text
    if deal_allowed(h, o) or not isinstance(n, dict):
        return text
    for k in (DEAL_KEYS_STATE if field == 'state' else ('deal',)) + ('authorId',):
        if k in o:
            n[k] = o[k]
        else:
            n.pop(k, None)
    n.pop('locked', None)
    return json.dumps(n, ensure_ascii=False)


def history_out(h, text):
    try:
        rows = json.loads(text)
    except ValueError:
        return '[]'          # без разбора нельзя убрать чужую экономику — лучше пусто, чем лишнее
    for r in rows:
        if isinstance(r, dict) and not deal_allowed(h, r):
            for k in DEAL_KEYS_META:
                r.pop(k, None)
            r['locked'] = True
    return json.dumps(rows, ensure_ascii=False)


def _jround(x):
    return int(math.floor(x + 0.5))


def econ_rub(r):
    """Сумма КП в рублях и прибыль в рублях (копейки) для итогов журнала — как jEcon() в интерфейсе."""
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


def history_page(h, store, q):
    """Журнал КП постранично: поиск и автор — в базе; итоги (сумма, прибыль) — по всему отбору."""
    try:
        limit, offset = max(1, min(int(q.get('limit') or 50), 500)), max(0, int(q.get('offset') or 0))
    except ValueError:
        limit, offset = 50, 0
    metas = store.kp_metas_where(q.get('q', ''), q.get('author', ''))
    rows = _loads(history_out(h, '[' + ','.join(m for m in metas if _loads(m) is not None) + ']')) or []
    rows = [r for r in rows if isinstance(r, dict)]
    s_sum, s_profit, n_profit = 0, 0, 0
    for r in rows:
        a, p = econ_rub(r)
        s_sum += a or 0
        if p is not None:
            s_profit += p
            n_profit += 1
    return {'total': len(rows), 'items': rows[offset:offset + limit], 'authors': store.kp_authors(),
            'agg': {'sum': s_sum, 'profit': s_profit, 'profitN': n_profit}}


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


# ---------------------------------------------------------------- модерация
def moderation(store):
    return ((store.kv_get('settings') or {}).get('productEditModeration') or {'enabled': False})


def _set_moderation(store, enabled, by):
    st = store.kv_get('settings') or {}
    st['productEditModeration'] = {'enabled': bool(enabled), 'updatedAt': _now(), 'updatedBy': by}
    store.kv_set('settings', st)


def _put_product(h, store, cid, admin):
    """Единая точка сохранения товара: модерация (черновик) или сразу в каталог; всё — в журнал."""
    text = h.body().decode('utf-8')
    after = json.loads(text)
    before_text = store.catalog_get(cid)
    before = _loads(before_text)
    mod = moderation(store).get('enabled') and not admin
    if mod and before is not None and h.headers.get('X-KP-Edit') == 'auto':
        b, a = diff(before, after)
        mod = not set(a) <= AUTO_KEYS    # сохранение КП обновило только цены и историю — без модерации
    if mod:
        uid, name, _ = actor(h, False)
        pid = store.pending_add(cid, 'update' if before else 'create', before_text, text, uid, name)
        b, a = diff(before, after, AUTO_KEYS)
        log(h, store, 'submit_edit', 'product', cid, b, a, admin=False)
        return h.send_json({'ok': True, 'pending': True, 'pendingId': pid})
    try:
        rev = store.catalog_put(cid, text, actor(h, admin)[1], h.base_rev())
    except Conflict as e:
        return h.conflict(e)
    auto = before is not None and set(diff(before, after)[1]) <= AUTO_KEYS
    b, a = diff(before, after)
    log(h, store, 'price_sync' if auto else ('edit_product' if before else 'create_product'), 'product', cid,
        b if before else None, a, admin=admin)
    return h.send_json({'ok': True, 'rev': rev})


# ---------------------------------------------------------------- проверка прав перед маршрутом
def guard(h, store, m, path):
    """Вызывается до обычного маршрута. True — ответ уже отправлен; функция — вызвать после успешного ответа
    (запись в журнал); None — ничего не нужно."""
    if path.startswith('/api/admin/'):
        AdminApi(h, store).handle(m, path[len('/api/admin/'):])
        return True
    r = re.match(r'^/api/catalog/([A-Za-z0-9_-]{1,64})$', path)
    if r and m == 'PUT':
        _put_product(h, store, r.group(1), is_admin(h))
        return True
    if m == 'DELETE':
        log(h, store, 'delete_attempt', path.split('/')[2] if path.count('/') > 2 else None, path.rsplit('/', 1)[-1], result='failed')
        h.send(403, 'text/plain; charset=utf-8', DENIED)
        return True
    # только администратор: тарифы доставки по России
    if path == '/api/logistics/refresh' and m == 'POST':
        if not is_admin(h):
            h.send(403, 'text/plain; charset=utf-8', DENIED)
            return True
        return lambda: log(h, store, 'edit_settings', 'settings', 'logistics_refresh', None, {'source': 'ATI.SU'}, admin=True)
    if path == '/api/logistics' and m == 'PUT':
        if not is_admin(h):
            log(h, store, 'edit_settings', 'settings', 'logistics', result='failed')
            h.send(403, 'text/plain; charset=utf-8', DENIED)
            return True
        return lambda: log(h, store, 'edit_settings', 'settings', 'logistics', None, {'tariffs': True}, admin=True)
    # только администратор: резервная копия ключей API (ключи целиком)
    if path == '/api/integrations/export':
        if not is_admin(h):
            log(h, store, 'export_keys', 'settings', 'integrations', result='failed')
            h.send(403, 'text/plain; charset=utf-8', DENIED)
            return True
        return lambda: log(h, store, 'export_keys', 'settings', 'integrations', None, None, admin=True)
    # только администратор: тексты интерфейса
    if path == '/api/uitexts' and m == 'PUT':
        if not is_admin(h):
            log(h, store, 'edit_settings', 'settings', 'uitexts', result='failed')
            h.send(403, 'text/plain; charset=utf-8', DENIED)
            return True
        n = len(_loads(h.body().decode('utf-8')) or {})
        return lambda: log(h, store, 'edit_settings', 'settings', 'uitexts', None, {'texts': n}, admin=True)
    # только администратор: шаблоны КП, ключи API
    tpl = re.match(r'^/api/templates/([A-Za-z0-9_-]+)/(file|restore|copy|reset|delete|open)$', path)
    if (tpl and m in ('PUT', 'POST')) or (path == '/api/templates/folder' and m == 'POST') or (path == '/api/integrations' and m == 'PUT'):
        if not is_admin(h):
            log(h, store, 'edit_settings', 'template' if tpl else 'settings', tpl.group(1) if tpl else path, result='failed')
            h.send(403, 'text/plain; charset=utf-8', DENIED)
            return True
        if path == '/api/integrations':
            keys = list((_loads(h.body().decode('utf-8')) or {}).keys())
            return lambda: log(h, store, 'edit_settings', 'settings', 'integrations', None, {'keys': keys}, admin=True)
        if tpl.group(2) != 'open':
            info = {'action': tpl.group(2), 'file': urllib.parse.parse_qs(urllib.parse.urlsplit(h.path).query).get('name', [''])[0]}
            return lambda: log(h, store, 'edit_template', 'template', tpl.group(1), None, info, admin=True)
        return None
    # журнал: КП, менеджеры, клиенты, типы оборудования
    r = re.match(r'^/api/kp/([A-Za-z0-9_-]+)/meta$', path)
    if r and m == 'PUT':
        old = _loads(store.kp_get(r.group(1), 'meta'))
        new = _loads(h.body().decode('utf-8')) or {}
        keep = ('number', 'client', 'sum', 'positions', 'manager', 'file')
        b = {k: old.get(k) for k in keep} if old else None
        a = {k: new.get(k) for k in keep}
        return lambda: log(h, store, 'edit_kp' if old else 'create_kp', 'kp', r.group(1), b, a)
    r = re.match(r'^/api/managers/([A-Za-z0-9_-]+)$', path)
    if r and m == 'PUT':
        old = next((x for x in json.loads(store.managers_list()) if x.get('id') == r.group(1)), None)
        new = _loads(h.body().decode('utf-8')) or {}
        b, a = diff(old, dict(new, id=r.group(1)), ('updatedAt',))
        return (lambda: log(h, store, 'edit_manager' if old else 'create_manager', 'manager', r.group(1), b if old else None, a)) if a else None
    r = re.match(r'^/api/clients/([A-Za-z0-9_-]+)$', path)
    if r and m == 'PUT':
        old = store.client_get(r.group(1))
        new = _loads(h.body().decode('utf-8')) or {}
        b, a = diff(old, new, ('updated', 'updatedAt', 'kpCount', 'lastKp'))
        return (lambda: log(h, store, 'edit_client' if old else 'create_client', 'client', r.group(1), b if old else None, a)) if a else None
    r = re.match(r'^/api/suppliers/([A-Za-z0-9_-]+)$', path)
    if r and m == 'PUT':
        old = store.supplier_get(r.group(1))
        new = _loads(h.body().decode('utf-8')) or {}
        b, a = diff(old, dict(new, id=r.group(1)), ('updatedAt',))
        return (lambda: log(h, store, 'edit_supplier' if old else 'create_supplier', 'supplier', r.group(1), b if old else None, a)) if a else None
    if path == '/api/customs' and m == 'PUT':
        new = _loads(h.body().decode('utf-8')) or {}
        old = store.customs_all().get(new.get('key') or '')
        return lambda: log(h, store, 'edit_customs', 'customs', new.get('key'), old and {k: old.get(k) for k in ('code', 'duty')},
                           {k: new.get(k) for k in ('code', 'duty')})
    if path == '/api/types' and m == 'PUT':
        stored = {t.get('id'): t for t in (store.kv_get('types') or {}).get('types', []) if isinstance(t, dict)}
        new = {t.get('id') for t in (_loads(h.body().decode('utf-8')) or {}).get('types', [])}
        try:
            from equipment_types import load_types_builtin
            builtin = {t.get('id'): t for t in load_types_builtin() if isinstance(t, dict)}
        except Exception:
            builtin = {}
        # копия стандартной категории без изменений — не удаление (её убирают, чтобы категория обновлялась с программой)
        removed = {i for i in set(stored) - new if not (i in builtin and json.dumps(stored[i], sort_keys=True) == json.dumps(builtin[i], sort_keys=True))}
        if removed and not is_admin(h):    # удалить свою категорию или вернуть стандартные — только администратор
            log(h, store, 'delete_attempt', 'types', ','.join(sorted(removed)), result='failed')
            h.send(403, 'text/plain; charset=utf-8', DENIED)
            return True
        return lambda: log(h, store, 'edit_types', 'types', 'user_types', None,
                           {'types': [t.get('name') for t in (_loads(h.body().decode('utf-8')) or {}).get('types', [])]})
    return None


# ---------------------------------------------------------------- API «Настроек»
SECTIONS = ('catalog', 'kp', 'managers', 'clients', 'audit', 'settings')


class AdminApi:
    def __init__(self, h, store):
        self.h, self.st = h, store

    def ok(self, obj=None):
        return self.h.send_json({'ok': True} if obj is None else obj)

    def err(self, code, text):
        return self.h.send(code, 'text/plain; charset=utf-8', text)

    def data(self):
        return _loads(self.h.body().decode('utf-8')) or {}

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
                            'canSetup': not users and h.is_local(), 'idleMinutes': IDLE_SECONDS // 60})
        if sub == 'setup' and m == 'POST':
            if users:
                return self.err(409, 'Администратор уже создан')
            if not h.is_local():
                return self.err(403, 'Первая учётная запись создаётся на компьютере, где работает программа')
            d = self.data()
            login, pw = (d.get('login') or 'admin').strip(), d.get('password') or ''
            try:
                check_login(login)
                check_new_password(pw)
            except ValueError as e:
                return self.err(400, str(e))
            u = {'login': login, 'name': (d.get('name') or '').strip()[:80] or login, 'pw': hash_password(pw), 'created': _now(), 'by': 'первый вход', 'lastLogin': _now()}
            save_accounts(st, [u])
            tok = self._login_ok(u)
            log(h, st, 'create_admin', 'admin', login, None, {'login': login, 'name': u['name']}, admin=True)
            return tok
        if sub == 'login' and m == 'POST':
            ip = _ip(h)
            if not users:
                return self.err(409, 'Администратор ещё не создан')
            if _locked(ip):
                log(h, st, 'login', 'admin', None, result='failed', admin=False)
                return self.err(429, 'Слишком много неверных попыток — подождите 10 минут')
            d = self.data()
            u = find_account(users, d.get('login')) if (d.get('login') or '').strip() else (users[0] if len(users) == 1 else None)
            if not u or not verify_password(d.get('password') or '', u.get('pw') or {}):
                _fail(ip)
                log(h, st, 'login', 'admin', (d.get('login') or '')[:40] or None, result='failed', admin=False)
                return self.err(403, 'Неверный логин или пароль')
            u['lastLogin'] = _now()
            save_accounts(st, users)
            resp = self._login_ok(u)
            log(h, st, 'login', 'admin', u['login'], admin=True)
            return resp
        if sub == 'logout' and m == 'POST':
            with LOCK:
                SESSIONS.pop(_cookie_token(h), None)
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

    def feeds(self, m, sub, me):
        import feeds
        from equipment_types import load_types
        st = self.st
        types = load_types()['types']
        if sub == 'feeds' and m == 'GET':
            return self.ok({'items': feeds.status(st), 'types': [{'id': t.get('id'), 'name': t.get('name'), 'group': t.get('group')} for t in types if not t.get('hidden')]})
        if sub == 'feeds' and m == 'POST':
            f = feeds.feed_save(st, self.data())
            self.log('edit_settings', 'settings', 'feed:' + f['id'], None, {'url': f['url'], 'name': f['name']})
            return self.ok(f)
        r = re.match(r'^feeds/([a-z0-9-]{1,40})/(preview|import|check|delete|log|status)$', sub)
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
        if m != 'POST':
            return self.err(405, 'Нужен POST')
        if act == 'delete':
            feeds.feed_delete(st, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'url': f['url']}, None)
            return self.ok()
        if feeds.busy(fid):
            return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
        if act == 'preview':
            try:
                return self.ok(feeds.preview(st, f, types))
            except Exception as e:
                return self.err(422, 'Фид не загрузился: %s' % e)
        who = me or 'администратор'
        if act == 'import':
            d = self.data()
            only = set(d.get('only') or []) or None
            feeds.run_bg(feeds.import_feed, st, f, types, feeds.IMAGE_STORE, who, only)
            self.log('import_feed', 'catalog', 'feed:' + fid, None, {'url': f['url'], 'only': len(only) if only else 'все'})
        else:
            feeds.run_bg(feeds.check_feed, st, f, who)
            self.log('check_feed', 'catalog', 'feed:' + fid, None, {'url': f['url']})
        return self.ok({'job': feeds.JOBS.get(fid) or {'state': 'run', 'kind': act}})

    def _login_ok(self, user=None):
        tok, csrf = _start_session(self.h, user)
        return self.h.send(200, 'application/json; charset=utf-8', json.dumps({'ok': True, 'csrf': csrf}),
                           {'Set-Cookie': 'kp_admin=%s; Path=/; HttpOnly; SameSite=Strict' % tok})

    def route(self, m, sub, q):
        st = self.st
        me = (session(self.h, touch=False) or {}).get('login', '')
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
        r = re.match(r'^audit/(\d+)/rollback$', sub)
        if r and m == 'POST':
            return self.rollback(int(r.group(1)))
        if sub == 'feeds' or sub.startswith('feeds/'):          # товарные фиды поставщиков (feeds.py)
            return self.feeds(m, sub, me)
        r = re.match(r'^list/(kp|catalog|manager|client|supplier)$', sub)
        if r:
            return self.ok(self.listing(r.group(1), q.get('q') or ''))
        if sub == 'delete' and m == 'POST':
            return self.delete(self.data())
        if sub == 'trash':
            return self.ok({'items': st.trash_list(), 'days': TRASH_DAYS})
        r = re.match(r'^trash/(\d+)/restore$', sub)
        if r and m == 'POST':
            etype, eid = st.trash_restore(int(r.group(1)))
            self.log('restore', etype, eid)
            return self.ok()
        if sub == 'moderation':
            if m == 'POST':
                return self.toggle(self.data())
            return self.ok({'settings': moderation(st), 'pending': self.pending_list('pending'),
                            'history': self.pending_list('approved')[:30] + self.pending_list('rejected')[:30],
                            'archived': self.pending_list('archived')})
        r = re.match(r'^pending/(\d+)$', sub)
        if r:
            p = st.pending_get(int(r.group(1)))
            if not p:
                raise ValueError('Правка не найдена')
            p['diff'] = self.pending_diff(p)
            p['current'] = st.catalog_get(p['productId']) is not None
            p.pop('before'), p.pop('after')
            return self.ok(p)
        r = re.match(r'^pending/(\d+)/(approve|reject)$', sub)
        if r and m == 'POST':
            return self.ok(self.review(int(r.group(1)), r.group(2), self.data().get('reason') or ''))
        if sub == 'pending/approve-all' and m == 'POST':
            n = sum(1 for p in st.pending_list('pending') if self.review(p['id'], 'approve', '')['ok'])
            return self.ok({'approved': n})
        if sub == 'export':
            return self.export([s for s in (q.get('sections') or ','.join(SECTIONS)).split(',') if s in SECTIONS])
        if sub == 'export/sqlite':
            return self.export_sqlite()
        if sub in ('import/preview', 'import') and m == 'POST':
            return self.ok(self.import_(self.data(), apply=(sub == 'import'), sections=q.get('sections')))
        if sub.startswith('maint'):
            return self.maint(m, sub, q)
        if sub == 'migrations':
            from storage import MIGRATIONS
            return self.ok({'applied': st.migrations_applied(), 'all': [x[0] for x in MIGRATIONS]})
        r = re.match(r'^migrations/([A-Za-z0-9_.-]+)/down$', sub)
        if r and m == 'POST':
            st.backup(os.path.join(os.path.dirname(st.path), 'backup', 'kp-%s-before-migration-down.sqlite3' % datetime.now().strftime('%Y%m%d-%H%M%S')))
            st.migration_down(r.group(1))
            return self.ok()
        return self.err(404, 'not found')

    # ---------- обслуживание базы: копии, сжатие, журнал, изображения ----------
    def maint(self, m, sub, q):
        import maintenance as mt
        st = self.st
        data_dir = os.path.dirname(st.path)
        img_dir = os.path.join(data_dir, 'img')
        if sub == 'maint' and m == 'GET':
            return self.ok(mt.summary(st, data_dir))
        if sub == 'maint/backup' and m == 'POST':
            rec = mt.daily_backup(st, data_dir, force=True)
            self.log('backup_db', 'db', 'auto', None, {'ok': rec.get('ok'), 'file': os.path.basename(rec.get('file') or '')}, result='success' if rec.get('ok') else 'failed')
            return self.ok(mt.summary(st, data_dir))
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
            res = mt.purge_images(st, img_dir)
            self.log('purge_images', 'images', 'unused', None, res)
            return self.ok(res)
        return self.err(404, 'not found')

    # ---------- учётные записи администраторов ----------
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
            if login.lower() == me.lower():
                with LOCK:
                    for s in SESSIONS.values():
                        if s.get('login', '').lower() == me.lower():
                            s['login'], s['name'] = u['login'], u['name']
            return {'ok': True}
        if act == 'password':
            check_new_password(d.get('password') or '')
            u['pw'] = hash_password(d['password'])
            save_accounts(st, users)
            self.log('set_password', 'admin', u['login'])
            return {'ok': True}
        if act == 'delete':
            if len(users) <= 1:
                raise ValueError('Нельзя удалить единственного администратора')
            if u['login'].lower() == me.lower():
                raise ValueError('Нельзя удалить свою учётную запись — войдите под другим администратором')
            users.remove(u)
            save_accounts(st, users)
            with LOCK:
                for k in [k for k, s in SESSIONS.items() if s.get('login', '').lower() == u['login'].lower()]:
                    SESSIONS.pop(k, None)
            self.log('delete_admin', 'admin', u['login'], {'login': u['login'], 'name': u.get('name', '')}, None)
            return {'ok': True}
        raise ValueError('Неизвестное действие')

    # ---------- удаление (в корзину) ----------
    def listing(self, etype, qs):
        st, ql = self.st, qs.lower()
        if etype == 'kp':
            rows = [{'id': x.get('id'), 'title': '№ %s — %s' % (x.get('number', ''), x.get('client', '')),
                     'sub': '%s · %s · %s' % (x.get('date', ''), x.get('manager') or '—', (x.get('items') or [''])[0])} for x in st.kp_all_meta()]
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
        rows = {r['id']: r['title'] for r in self.listing(etype, '')['items']} if etype not in ('catalog', 'client') else {}
        if etype == 'client':
            rows = {eid: (self.st.client_get(str(eid)) or {}).get('name') for eid in ids}
        titles = {eid: rows.get(eid) or next((r['title'] for r in self.listing(etype, str(eid))['items'] if r['id'] == eid), str(eid)) for eid in ids}
        n = 0
        for eid in ids:
            data = self.st.trash_put(etype, str(eid), titles.get(eid, str(eid)), 'admin')
            self.log('delete_' + etype, etype, eid, {'title': titles.get(eid, '')} if data else None, None,
                     result='success' if data else 'failed')
            n += bool(data)
        return self.ok({'deleted': n})

    # ---------- модерация ----------
    def pending_diff(self, p):
        b, a = diff(_loads(p['before']), _loads(p['after']), AUTO_KEYS)
        return [{'field': k, 'label': LABELS.get(k, k), 'before': b[k], 'after': a[k]} for k in a]

    def pending_list(self, status):
        out = []
        for p in self.st.pending_list(status, with_docs=True):
            after = _loads(p['after']) or {}
            cur = self.st.catalog_get(p['productId'])
            p['name'] = after.get('name', p['productId'])
            p['fields'] = [x['label'] for x in self.pending_diff(p)]
            p['stale'] = status == 'pending' and (cur or None) != (p['before'] or None)
            p.pop('before'), p.pop('after')
            out.append(p)
        return out

    def review(self, eid, act, reason):
        p = self.st.pending_get(eid)
        if not p or p['status'] != 'pending':
            return {'ok': False, 'message': 'Правка уже рассмотрена'}
        b, a = diff(_loads(p['before']), _loads(p['after']), AUTO_KEYS)
        if act == 'approve':
            self.st.catalog_put(p['productId'], p['after'])
            self.st.pending_set(eid, 'approved', 'admin')
            self.log('approve_edit', 'product', p['productId'], b, a)
        else:
            self.st.pending_set(eid, 'rejected', 'admin', reason)
            self.log('reject_edit', 'product', p['productId'], b, dict(a, __reason__=reason))
        return {'ok': True}

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
                    self.st.pending_set(p['id'], 'archived', 'admin', 'Модерация отключена')
                else:
                    self.review(p['id'], 'approve' if how == 'apply' else 'reject', 'Модерация отключена')
        _set_moderation(self.st, on, 'admin')
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
    def export(self, sections):
        st, out = self.st, {}
        if 'catalog' in sections:
            out['catalog'] = json.loads(st.catalog_full())
        if 'kp' in sections:
            out['kp'] = [dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated'), r))
                         for r in st.all('SELECT id, number, state, meta, docx, updated FROM kp')]
        if 'managers' in sections:
            out['managers'] = json.loads(st.managers_list())
        if 'clients' in sections:
            out['clients'] = st.clients_all()
        if 'audit' in sections:
            out['audit'] = st.audit_query({}, 10 ** 7)['items']
        if 'settings' in sections:
            out['settings'] = {'types': st.kv_get('types'), 'settings': st.kv_get('settings')}
        body = json.dumps({'format': 'kp-backup', 'version': 1, 'createdAt': _now(), 'sections': out}, ensure_ascii=False)
        self.log('export_db', 'db', ','.join(sections), None, {'sections': sections, 'bytes': len(body.encode('utf-8'))})
        fn = 'КП_резервная_копия_%s_%s.json' % ('+'.join(sections) if len(sections) < len(SECTIONS) else 'полная', datetime.now().strftime('%Y-%m-%d_%H%M'))
        return self.h.send(200, 'application/json; charset=utf-8', body, self.h.attachment(fn))

    def export_sqlite(self):
        tmp = os.path.join(os.path.dirname(self.st.path), 'backup', 'export-%s.sqlite3' % secrets.token_hex(4))
        self.st.backup(tmp)
        try:
            with open(tmp, 'rb') as f:
                data = f.read()
        finally:
            os.remove(tmp)
        self.log('export_db', 'db', 'sqlite', None, {'bytes': len(data)})
        return self.h.send(200, 'application/octet-stream', data, self.h.attachment('kp_%s.sqlite3' % datetime.now().strftime('%Y-%m-%d_%H%M')))

    def import_(self, d, apply, sections=None):
        """Проверка схемы и предпросмотр (что добавится / обновится); apply — запись после копии базы.
        Ничего не удаляется. Журнал действий не импортируется."""
        if d.get('format') != 'kp-backup' or d.get('version') != 1 or not isinstance(d.get('sections'), dict):
            raise ValueError('Это не резервная копия программы (нужен файл «КП_резервная_копия_….json»)')
        sec = d['sections']
        want = [s for s in (sections or 'catalog,kp,managers,clients,settings').split(',') if s in sec and s != 'audit']
        st, rep, errors = self.st, {}, []
        backup = self.import_backup() if apply else None
        exist = {'catalog': {x['id']: x for x in json.loads(st.catalog_light())},
                 'kp': {r[0]: r for r in st.all('SELECT id, meta FROM kp')},
                 'managers': {x['id']: x for x in json.loads(st.managers_list())},
                 'clients': {x['id']: x for x in st.clients_all()}}
        req = {'catalog': ('id', 'name'), 'kp': ('id', 'number'), 'managers': ('id', 'name'), 'clients': ('id',)}
        for s in want:
            if s == 'settings':
                rep[s] = {'new': 0, 'updated': 1 if sec[s] else 0, 'invalid': 0}
                continue
            rows = sec[s] if isinstance(sec[s], list) else []
            bad = [i for i, x in enumerate(rows) if not isinstance(x, dict) or any(not x.get(k) for k in req[s])
                   or not re.match(r'^[A-Za-z0-9_-]{1,64}$', str(x.get('id')))]
            errors += ['%s: запись %d без обязательных полей %s' % (s, i + 1, ', '.join(req[s])) for i in bad[:5]]
            ok = [x for i, x in enumerate(rows) if i not in set(bad)]
            rep[s] = {'new': sum(1 for x in ok if x['id'] not in exist[s]), 'updated': sum(1 for x in ok if x['id'] in exist[s]),
                      'invalid': len(bad)}
            if apply:
                if s == 'catalog':
                    for x in ok:
                        st.catalog_put(x['id'], json.dumps({k: v for k, v in x.items() if k not in ('_light', 'st', 'pricesCount')}, ensure_ascii=False))
                elif s == 'kp':
                    for x in ok:
                        st.kp_import(x)
                elif s == 'managers':
                    for x in ok:
                        st.manager_put(x['id'], json.dumps(x, ensure_ascii=False))
                else:
                    for x in ok:
                        st.client_put(x['id'], x)
        if apply and 'settings' in want and isinstance(sec['settings'], dict):
            for k in ('types', 'settings'):
                if sec['settings'].get(k) is not None:
                    st.kv_set(k, sec['settings'][k])
        if apply:
            self.log('import_db', 'db', ','.join(want), None, {'report': rep, 'createdAt': d.get('createdAt'), 'backup': backup})
        return {'report': rep, 'errors': errors, 'createdAt': d.get('createdAt'), 'applied': apply}

    def import_backup(self):
        return self.st.backup(os.path.join(os.path.dirname(self.st.path), 'backup', 'kp-%s-before-import.sqlite3' % datetime.now().strftime('%Y%m%d-%H%M%S')))


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

    def count(n):
        return sum(1 for d, _ in days if d and (today - d).days < n)

    def rub(x):
        e = x.get('econ') or {}
        return e.get('sumRub') if e.get('cur') not in (None, 'RUB') else (e.get('sum') or x.get('sum') or 0)
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
    q = lambda sql, *a: st.one(sql, a)[0]
    approved = q("SELECT COUNT(*) FROM pending_edits WHERE status='approved'")
    rejected = q("SELECT COUNT(*) FROM pending_edits WHERE status='rejected'")
    users = {r[0] for r in st.all('SELECT DISTINCT user_name FROM audit WHERE ts >= ? AND user_name IS NOT NULL', (month_ago,))}
    users |= {x.get('manager') for d, x in days if d and (today - d).days < 30 and x.get('manager')}
    users.discard('Не выбран')
    size = sum(os.path.getsize(st.path + s) for s in ('', '-wal') if os.path.isfile(st.path + s))
    return {
        'kp': {'total': len(metas), 'today': count(1), 'week': count(7), 'month': count(30),
               'sumMonth': sum((rub(x) or 0) for d, x in days if d and (today - d).days < 30)},
        'managers': sorted(mgr.values(), key=lambda m: -m['count'])[:10],
        'products': [p for p in prods if p['count']][:10],
        'moderation': {'enabled': moderation(st).get('enabled'), 'pending': q("SELECT COUNT(*) FROM pending_edits WHERE status='pending'"),
                       'approved': approved, 'rejected': rejected,
                       'conversion': round(approved * 100 / (approved + rejected), 1) if approved + rejected else None},
        'activeUsers': len(users),
        'deletions': {'month': q("SELECT COUNT(*) FROM audit WHERE action LIKE 'delete\\_%' ESCAPE '\\' AND result='success' AND ts >= ?", month_ago),
                      'total': q("SELECT COUNT(*) FROM audit WHERE action LIKE 'delete\\_%' ESCAPE '\\' AND result='success'"),
                      'trash': q('SELECT COUNT(*) FROM trash')},
        'db': {'bytes': size, 'tables': st.table_counts()},
        'series': series,
    }


def startup(store, data_dir, log_print=print):
    """При запуске: сброс пароля по файлу data/admin-reset.txt, очистка корзины старше TRASH_DAYS дней."""
    reset = os.path.join(data_dir, 'admin-reset.txt')
    if os.path.isfile(reset):
        store.write("DELETE FROM kv WHERE key IN ('admin', 'admins')")
        os.remove(reset)
        store.audit_add({'action': 'set_password', 'entityType': 'admin', 'entityId': 'reset', 'userName': 'Компьютер-сервер',
                         'userRole': 'admin', 'after': {'reset': True}})
        log_print('Учётные записи администраторов сброшены (data/admin-reset.txt): создайте новую в «Настройках» на этом компьютере')
    n = store.trash_purge(TRASH_DAYS)
    if n:
        store.audit_add({'action': 'purge_trash', 'entityType': 'trash', 'userName': 'Программа', 'userRole': 'admin', 'after': {'count': n}})
