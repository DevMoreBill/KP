"""Журнал действий (кто, что, когда, было и стало) и журнал КП с учётом прав."""

import json
import threading
from datetime import date, timedelta
from typing import Any

from admin_access import DEAL_KEYS_META, DealViewer, _loads, actor, econ_rub, login_on, own_kp, perm
from admin_accounts import _client_ip
from defaults import SrvVal
from server_log import ServerLog


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
    except Exception as exc:  # журнал не должен мешать работе, но потеря записи видна в журнале сервера
        ServerLog.failure(f'журнал действий: запись «{action}» не сохранена', exc)


def _short(v, limit: int = 20000) -> Any:
    text = json.dumps(v, ensure_ascii=False)
    return v if len(text) <= limit else {'__truncated__': len(text)}
