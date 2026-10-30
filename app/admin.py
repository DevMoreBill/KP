"""Админ-панель «Настройки»: администраторы и сессии, права, журнал действий, корзина, модерация, копии, статистика."""

import json
import os
import re
import time
import urllib.parse
from datetime import date, datetime, timedelta
from typing import Any

import auth_users
from admin_access import _body_obj, _loads, actor, econ_rub, kp_access, perm
from admin_accounts import (
    LOCK,
    AdminSessions,
    LoginGuard,
    _client_ip,
    _cookie_token,
    _now,
    accounts,
    check_login,
    check_new_password,
    find_account,
    hash_password,
    is_admin,
    public_account,
    save_accounts,
    session,
)
from admin_data_api import SECTIONS, AdminDataApi
from admin_feeds_api import AdminFeedsApi
from admin_journal import log
from admin_records_api import AdminRecordsApi
from admin_rights import AdminRights
from admin_system_api import AdminSystemApi
from catalog_save import _put_product, diff, moderation
from data_file import Load
from defaults import SrvVal

ENTITY_SLASHES = 2
DATE_LEN = 10
MONTH_DAYS = 30

DENIED = 'Удаление и настройки — только в разделе «Настройки» (нужен пароль администратора)'


def _refuse(handler, store=None, action=None, etype=None, eid=None, text=DENIED) -> bool:
    """Отказ (403); попытка изменения (action) — в журнал. Возвращает True — «ответ уже отправлен» для guard."""
    if action:
        log(handler, store, action, etype, eid, result='failed')
    handler.send(403, 'text/plain; charset=utf-8', text)
    return True


class DeniedLog:
    """Отказ в доступе к чужому КП или сделке — в журнал действий, одна запись на человека и запись за 10 минут
    (перебор адресов не раздувает журнал)."""

    PAUSE = 600
    LIMIT = 5000
    seen: dict = {}

    @classmethod
    def note(cls, handler, store, etype: str, eid: str) -> None:
        who = actor(handler, False)[0] or _client_ip(handler)
        key, now = (who, etype, eid), time.time()
        with LOCK:
            if now - cls.seen.get(key, 0) < cls.PAUSE:
                return
            if len(cls.seen) > cls.LIMIT:
                cls.seen.clear()
            cls.seen[key] = now
        log(handler, store, 'access_denied', etype, eid, result='failed')


class RightsCheck:
    """Права вошедшего в «Настройки» администратора (admin_rights): отказ — 403 с причиной, попытка изменения — в журнал."""

    # куда уходит сохранённый пароль почты: сервер, порт, защита соединения, логин (без TLS пароль ушёл бы открытым)
    MAIL_MOVE = ('host', 'port', 'security', 'login')

    def __init__(self, handler, store) -> None:
        self.handler, self.store = handler, store

    def _moved(self, path: str, body: dict) -> dict:
        """«moved» — адрес, куда уйдёт сохранённый пароль или ключ, меняется (сервер почты, логин, адреса перевозчиков)."""
        if path == '/api/logistics/carriers':
            from logistics_api import CarrierApi

            return dict(body, moved=CarrierApi.moved(self.store, body))
        if path == '/api/admin/ai':
            from ai_llm import DEFAULT_BASE

            cur = ((self.store.kv_get('settings') or {}).get('ai') or {}).get('base') or DEFAULT_BASE
            new = body.get('base') or DEFAULT_BASE
            return (
                body
                if not AdminRights.same_value(new, cur)
                else {key: val for key, val in body.items() if key != 'base'}
            )
        if path in ('/api/admin/maint/mirror', '/api/admin/maint/mirror/check'):
            return dict(body, moved='1' if self._mirror_moved(body) else '')
        if path == '/api/admin/mail':
            from kp_track import Mailer

            cur = Mailer(self.store).public()  # как видит экран: порт и защита — со значениями по умолчанию
            moved = [
                key for key in self.MAIL_MOVE if key in body and not AdminRights.same_value(body[key], cur.get(key))
            ]
            return dict(body, moved='1' if moved and cur.get('hasPassword') else '')
        return body

    def _mirror_moved(self, body: dict) -> bool:
        """Вторая папка копий — в другое место: копия базы со всеми ключами уходит туда (как выгрузка базы целиком)."""
        cur = (self.store.kv_get('settings') or {}).get('backup2') or {}
        kind = 'dav' if body.get('kind') == 'dav' else 'folder'
        if kind != ('dav' if cur.get('kind') == 'dav' else 'folder'):
            return True
        if kind == 'folder':
            return not AdminRights.same_value(body.get('path'), cur.get('path'))
        new, old = body.get('dav') or {}, cur.get('dav') or {}
        if AdminRights.given(new.get('password')):
            return True  # новый пароль Яндекс Диска — тоже «Ключи и пароли»
        return any(not AdminRights.same_value(new.get(key), old.get(key)) for key in ('url', 'login', 'folder'))

    def refused(self, method: str, path: str) -> bool:
        sess = AdminSessions.of(self.handler)
        if sess is None:
            return False
        body = self._moved(path, _body_obj(self.handler)) if AdminRights.needs_body(method, path) else None
        # разбор — как у маршрутов (web_api.dispatch, AdminApi): повторённый параметр — последнее значение и тут
        query = dict(
            urllib.parse.parse_qsl(
                urllib.parse.urlsplit(self.handler.path).query, keep_blank_values=True, encoding='utf-8'
            )
        )
        why = AdminRights(accounts(self.store)).refuse(sess.get('login', ''), method, path, body, query)
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
        DeniedLog.note(handler, store, 'kp', match.group(1))
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


class AdminApi(AdminFeedsApi, AdminSystemApi, AdminRecordsApi, AdminDataApi):
    """«Настройки» (`/api/admin/*`): вход администратора и распределение запросов по разделам."""

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
                info['password'] = 'изменён'  # noqa: S105 — пометка для журнала действий, не пароль
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
                res = settings_file.apply(self.settings_doc(data_file, body), picked, self._keys_right())
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
