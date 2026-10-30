"""Основа запросов «Настроек»: ответ, ошибка, тело запроса, запись в журнал действий."""

import json

from admin_journal import log
from config import BadRequest


class AdminBase:
    """Основа запросов «Настроек»: ответ, ошибка, тело запроса, запись в журнал действий."""

    def __init__(self, handler, store) -> None:
        self.handler, self.store = handler, store

    def ok(self, obj=None) -> None:
        return self.handler.send_json({'ok': True} if obj is None else obj)

    def err(self, code, text) -> None:
        return self.handler.send(code, 'text/plain; charset=utf-8', text)

    def data(self) -> dict:
        """Тело запроса — объект JSON (пустое тело — {}); иначе 400 «Неверный запрос»."""
        raw = self.handler.body()
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw.decode('utf-8'))
        except ValueError:
            raise BadRequest('Неверный запрос: нужен JSON') from None
        if data is None:
            return {}
        if not isinstance(data, dict):
            raise BadRequest('Неверный запрос: нужен объект JSON')
        return data

    def log(self, *args, **k) -> None:
        log(self.handler, self.store, *args, **(k | {'admin': True}))
