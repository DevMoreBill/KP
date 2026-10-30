"""«Сообщить о проблеме»: сообщения менеджеров с тем, где это случилось (раздел, окно, версия, экран, ошибки страницы)."""

import re
from typing import Any

from clock import Clock
from kp_track import Val


class Feedback:
    """Сообщения — в базе (kv), новые — в «Требует внимания» и письмом администратору (если письма включены)."""

    KEY = 'feedback'
    KEEP = 300
    TEXT_MAX = 2000
    CTX_MAX = 300
    CTX_KEYS = ('where', 'dialog', 'version', 'screen', 'theme', 'errors')
    ERRORS_MAX = 10

    def __init__(self, store) -> None:
        self.store = store

    def all(self) -> list[dict]:
        rows = self.store.kv_get(self.KEY)
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def add(self, data: Any, author: str) -> dict:
        """Новое сообщение. ValueError — понятным текстом."""
        if not isinstance(data, dict):
            raise ValueError('Нет текста сообщения')
        text = Val.text(data.get('text'), self.TEXT_MAX)
        if not text:
            raise ValueError('Опишите, что случилось')
        rows = self.all()
        entry = {
            'id': max((int(row.get('id') or 0) for row in rows), default=0) + 1,
            'at': Clock.now(),
            'by': str(author or '')[:120],
            'text': text,
            'ctx': self._ctx(data.get('ctx')),
            'done': False,
        }
        self.store.kv_set(self.KEY, [*rows, entry][-self.KEEP :])
        return entry

    def _ctx(self, raw: Any) -> dict[str, Any]:
        ctx = raw if isinstance(raw, dict) else {}
        out: dict[str, Any] = {key: Val.text(ctx.get(key), self.CTX_MAX) for key in self.CTX_KEYS if key != 'errors'}
        errors = picked if isinstance(picked := ctx.get('errors'), list) else []
        out['errors'] = [re.sub(r'\s+', ' ', str(row))[: self.CTX_MAX] for row in errors[-self.ERRORS_MAX :]]
        return out

    def new(self) -> list[dict]:
        return [row for row in self.all() if not row.get('done')]

    def done(self, fid: int) -> bool:
        """Отметить прочитанным (администратор)."""
        rows = self.all()
        hit = False
        for row in rows:
            if int(row.get('id') or 0) == fid:
                row['done'] = True
                hit = True
        if hit:
            self.store.kv_set(self.KEY, rows)
        return hit
