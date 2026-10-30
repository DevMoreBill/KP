"""Кто действует и что ему можно: менеджер или администратор, права, своё и чужое КП, экономика сделки."""

import json
import math
import urllib.parse
from typing import Any

from admin_accounts import AdminSessions
from num import Num


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

    rub, profit = _econ_rub(rec)
    return (None if rub is None else Num.parse(rub) or 0), (None if profit is None else Num.parse(profit) or 0)


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
