# -*- coding: utf-8 -*-
"""Админ-панель «Настройки»: пароль администратора, сессии, права, журнал действий, корзина, модерация правок,
резервные копии и статистика.

• Пароль хранится только хешем (scrypt; если в Python нет scrypt — PBKDF2-SHA256), в kv «admin».
  Первый пароль задаётся на компьютере, где работает программа. Сброс: создать файл data/admin-reset.txt
  и перезапустить программу.
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
import os
import re
import secrets
import threading
import time
import urllib.parse
from datetime import datetime, timedelta

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


def _start_session(h):
    tok, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    with LOCK:
        SESSIONS[tok] = {'csrf': csrf, 'last': time.time(), 'ip': _ip(h)}
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
    if admin is None:
        admin = session(h, touch=False) is not None
    uid = urllib.parse.unquote(h.headers.get('X-KP-User-Id') or '')[:64]
    name = urllib.parse.unquote(h.headers.get('X-KP-User') or '')[:120]
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
        return text
    for r in rows:
        if isinstance(r, dict) and not deal_allowed(h, r):
            for k in DEAL_KEYS_META:
                r.pop(k, None)
            r['locked'] = True
    return json.dumps(rows, ensure_ascii=False)


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
    store.catalog_put(cid, text)
    auto = before is not None and set(diff(before, after)[1]) <= AUTO_KEYS
    b, a = diff(before, after)
    log(h, store, 'price_sync' if auto else ('edit_product' if before else 'create_product'), 'product', cid,
        b if before else None, a, admin=admin)
    return h.send_json({'ok': True})


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
        old = {t.get('id') for t in (store.kv_get('types') or {}).get('types', [])}
        new = {t.get('id') for t in (_loads(h.body().decode('utf-8')) or {}).get('types', [])}
        if old - new and not is_admin(h):    # удалить свою категорию или вернуть стандартные — только администратор
            log(h, store, 'delete_attempt', 'types', ','.join(sorted(old - new)), result='failed')
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
        rec = st.kv_get('admin')
        if sub == 'status':
            s = session(h)
            return self.ok({'hasPassword': bool(rec), 'admin': bool(s), 'csrf': s['csrf'] if s else '',
                            'canSetup': not rec and h.is_local(), 'idleMinutes': IDLE_SECONDS // 60})
        if sub == 'setup' and m == 'POST':
            if rec:
                return self.err(409, 'Пароль уже задан')
            if not h.is_local():
                return self.err(403, 'Первый пароль задаётся на компьютере, где работает программа')
            pw = self.data().get('password') or ''
            try:
                check_new_password(pw)
            except ValueError as e:
                return self.err(400, str(e))
            st.kv_set('admin', hash_password(pw))
            self.log('set_password', 'admin', 'password')
            return self._login_ok()
        if sub == 'login' and m == 'POST':
            ip = _ip(h)
            if not rec:
                return self.err(409, 'Пароль администратора ещё не задан')
            if _locked(ip):
                log(h, st, 'login', 'admin', None, result='failed', admin=False)
                return self.err(429, 'Слишком много неверных попыток — подождите 10 минут')
            if not verify_password(self.data().get('password') or '', rec):
                _fail(ip)
                log(h, st, 'login', 'admin', None, result='failed', admin=False)
                return self.err(403, 'Неверный пароль')
            self.log('login', 'admin')
            return self._login_ok()
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

    def _login_ok(self):
        tok, csrf = _start_session(self.h)
        return self.h.send(200, 'application/json; charset=utf-8', json.dumps({'ok': True, 'csrf': csrf}),
                           {'Set-Cookie': 'kp_admin=%s; Path=/; HttpOnly; SameSite=Strict' % tok})

    def route(self, m, sub, q):
        st = self.st
        if sub == 'password' and m == 'POST':
            d = self.data()
            if not verify_password(d.get('old') or '', st.kv_get('admin')):
                self.log('set_password', 'admin', 'password', result='failed')
                return self.err(403, 'Текущий пароль указан неверно')
            check_new_password(d.get('new') or '')
            st.kv_set('admin', hash_password(d['new']))
            self.log('set_password', 'admin', 'password')
            return self.ok()
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
        if sub == 'migrations':
            from storage import MIGRATIONS
            return self.ok({'applied': st.migrations_applied(), 'all': [x[0] for x in MIGRATIONS]})
        r = re.match(r'^migrations/([A-Za-z0-9_.-]+)/down$', sub)
        if r and m == 'POST':
            st.backup(os.path.join(os.path.dirname(st.path), 'backup', 'kp-%s-before-migration-down.sqlite3' % datetime.now().strftime('%Y%m%d-%H%M%S')))
            st.migration_down(r.group(1))
            return self.ok()
        return self.err(404, 'not found')

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
        else:
            rows = [{'id': x['id'], 'title': x.get('name', ''), 'sub': 'ИНН %s' % x.get('inn', '')} for x in st.clients_all()]
        if ql:
            rows = [r for r in rows if ql in (r['title'] + ' ' + r['sub'] + ' ' + str(r['id'])).lower()]
        return {'total': len(rows), 'items': rows if etype != 'catalog' else rows[:300]}

    def delete(self, d):
        etype, ids = d.get('type'), d.get('ids') or []
        if etype not in ('kp', 'catalog', 'manager', 'client', 'supplier') or not isinstance(ids, list) or not ids:
            raise ValueError('Не выбрано, что удалить')
        rows = {r['id']: r['title'] for r in self.listing(etype, '')['items']} if etype != 'catalog' else {}
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
                        st.write('INSERT OR REPLACE INTO kp (id, number, state, meta, docx, updated) VALUES (?,?,?,?,?,?)',
                                 (x['id'], x.get('number'), x.get('state'), x.get('meta'), x.get('docx'), x.get('updated') or _now()))
                elif s == 'managers':
                    for x in ok:
                        st.manager_put(x['id'], json.dumps(x, ensure_ascii=False))
                else:
                    for x in ok:
                        st.write('INSERT OR REPLACE INTO clients (id, doc, updated) VALUES (?,?,?)', (x['id'], json.dumps(x, ensure_ascii=False), _now()))
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
        store.write("DELETE FROM kv WHERE key='admin'")
        os.remove(reset)
        store.audit_add({'action': 'set_password', 'entityType': 'admin', 'entityId': 'reset', 'userName': 'Компьютер-сервер',
                         'userRole': 'admin', 'after': {'reset': True}})
        log_print('Пароль администратора сброшен (data/admin-reset.txt): задайте новый в «Настройках» на этом компьютере')
    n = store.trash_purge(TRASH_DAYS)
    if n:
        store.audit_add({'action': 'purge_trash', 'entityType': 'trash', 'userName': 'Программа', 'userRole': 'admin', 'after': {'count': n}})
