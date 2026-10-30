"""Кэш курсов и ключевой ставки ЦБ РФ в базе: общий для всех окон и запусков, при недоступности ЦБ — последний сохранённый."""

import threading
import time
from datetime import datetime

from config import store
from server_log import ServerLog


class CbrCache:
    """Курсы и ключевая ставка ЦБ: удачный ответ — в базу; ЦБ недоступен — последний сохранённый (stale)."""

    RETRY = 600
    FRESH = 1800  # ЦБ меняет курс раз в день: каждое окно и запуск не ходят на cbr.ru (до 15 с ожидания)
    _failed: dict = {}
    _lock = threading.Lock()

    @classmethod
    def _fresh(cls, key) -> dict | None:
        last = store().kv_get(key)
        if not isinstance(last, dict) or last.get('error'):
            return None
        try:
            age = (datetime.now() - datetime.fromisoformat(last.get('fetched') or '')).total_seconds()
        except ValueError:
            return None
        return last if 0 <= age < cls.FRESH else None

    @classmethod
    def get(cls, key, fetch) -> dict:
        fresh = cls._fresh(key)
        if fresh:
            return fresh
        with cls._lock:  # одновременные окна ждут один запрос к ЦБ, а не шлют каждый свой
            return cls._fresh(key) or cls._ask(key, fetch)

    @classmethod
    def _ask(cls, key, fetch) -> dict:
        res = None
        if time.time() - cls._failed.get(key, 0) >= cls.RETRY:
            try:
                res = fetch()
            except Exception as exc:
                res = {'error': str(exc)}
            if res and not res.get('error'):
                cls._failed.pop(key, None)
                res = dict(res, fetched=datetime.now().strftime('%Y-%m-%dT%H:%M:%S'))
                try:
                    store().kv_set(key, res)
                except Exception as exc:  # ответ отдаётся и без кэша
                    ServerLog.failure(f'кэш «{key}» не сохранён', exc)
                return res
            cls._failed[key] = time.time()
        res = res or {'error': 'ЦБ недавно не ответил — повтор позже'}
        last = store().kv_get(key)
        if isinstance(last, dict) and not last.get('error'):
            return dict(
                last,
                stale=True,
                src=(last.get('src') or 'ЦБ РФ') + ' — сохранённое значение, ЦБ сейчас недоступен',
                fetchError=res.get('error', ''),
            )
        return res
