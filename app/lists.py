"""Списки выбора администратора: kv «settings».lists = {ключ: [строки]}; нет записи — встроенный список."""

import re
from datetime import datetime

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
        d = ((self.store.kv_get('settings') or {}).get('lists')) or {}
        return d if isinstance(d, dict) else {}

    @staticmethod
    def clean_rows(key: str, rows) -> list[dict]:
        if not isinstance(rows, list):
            raise ValueError(f'Список «{key}»: нужен перечень строк')
        if len(rows) > MAX_ROWS:
            raise ValueError(f'Список «{key}»: больше {MAX_ROWS} строк')
        out = []
        for r in rows:
            if not isinstance(r, dict) or len(r) > MAX_FIELDS:
                raise ValueError(f'Список «{key}»: неверная строка')
            row = {}
            for f, v in r.items():
                if not FIELD_RX.match(str(f)):
                    raise ValueError(f'Список «{key}»: неверное поле {str(f)[:30]}')
                if isinstance(v, bool) or v is None:
                    row[f] = bool(v)
                elif isinstance(v, (int, float)):
                    row[f] = v
                else:
                    row[f] = str(v).strip()[:MAX_LEN]
            out.append(row)
        return out

    def save(self, values: dict, by: str = '') -> dict:
        """values = {ключ: [строки] | None — встроенный список}."""
        if not isinstance(values, dict):
            raise ValueError('Нет списков')
        st = self.store.kv_get('settings') or {}
        cur = dict(st.get('lists') or {})
        for k, rows in values.items():
            if not KEY_RX.match(str(k)):
                raise ValueError(f'Неверный ключ списка: {str(k)[:40]}')
            if rows is None:
                cur.pop(k, None)
            else:
                cur[k] = self.clean_rows(k, rows)
        if len(cur) > MAX_LISTS:
            raise ValueError('Слишком много списков')
        st['lists'] = cur
        st['listsAt'], st['listsBy'] = datetime.now().isoformat(timespec='seconds'), by
        self.store.kv_set('settings', st)
        return cur
