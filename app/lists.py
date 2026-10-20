"""Списки выбора администратора: kv «settings».lists = {ключ: [строки]}; нет записи — встроенный список."""

import re
from datetime import datetime
from typing import Any

KEY_RX = re.compile(r'^[\w.\-ёЁ ]{1,80}$')
FIELD_RX = re.compile(r'^[A-Za-z0-9_]{1,30}$')
MAX_LISTS = 100
MAX_ROWS = 300
MAX_FIELDS = 12
MAX_LEN = 2000


class ListStore:
    def __init__(self, store) -> None:
        self.store = store

    def all(self) -> dict:
        data = ((self.store.kv_get('settings') or {}).get('lists')) or {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def clean_rows(key: str, rows) -> list[dict]:
        if not isinstance(rows, list):
            raise ValueError(f'Список «{key}»: нужен перечень строк')
        if len(rows) > MAX_ROWS:
            raise ValueError(f'Список «{key}»: больше {MAX_ROWS} строк')
        out = []
        for raw in rows:
            if not isinstance(raw, dict) or len(raw) > MAX_FIELDS:
                raise ValueError(f'Список «{key}»: неверная строка')
            row: dict[str, Any] = {}
            for field, v in raw.items():
                if not FIELD_RX.match(str(field)):
                    raise ValueError(f'Список «{key}»: неверное поле {str(field)[:30]}')
                if isinstance(v, bool) or v is None:
                    row[field] = bool(v)
                elif isinstance(v, (int, float)):
                    row[field] = v
                else:
                    row[field] = str(v).strip()[:MAX_LEN]
            out.append(row)
        return out

    def save(self, values: dict, author: str = '') -> dict:
        """values = {ключ: [строки] | None — встроенный список}."""
        if not isinstance(values, dict):
            raise ValueError('Нет списков')
        settings = self.store.kv_get('settings') or {}
        cur = dict(settings.get('lists') or {})
        for k, rows in values.items():
            if not KEY_RX.match(str(k)):
                raise ValueError(f'Неверный ключ списка: {str(k)[:40]}')
            if rows is None:
                cur.pop(k, None)
            else:
                cur[k] = self.clean_rows(k, rows)
        if len(cur) > MAX_LISTS:
            raise ValueError('Слишком много списков')
        settings['lists'] = cur
        settings['listsAt'], settings['listsBy'] = datetime.now().isoformat(timespec='seconds'), author
        self.store.kv_set('settings', settings)
        return cur
