# -*- coding: utf-8 -*-
"""Списки и выборы, которые администратор правит в «Настройках → Списки и выборы»: варианты выпадающих меню
и подсказок (сроки поставки, условия оплаты, утепление контейнера, климатические исполнения, типы контейнеров,
страны поставщиков…).

Хранятся в kv «settings».lists = {ключ: [строки]}; строка — {поле: значение}. Какие списки есть, их поля и встроенные
значения — в интерфейсе (app/web/js/core/lists.js): сервер хранит и отдаёт то, что задал администратор.
Нет записи по ключу — действует встроенный список программы.
"""
import re
from datetime import datetime

KEY_RX = re.compile(r'^[\w.\-ёЁ ]{1,80}$')
FIELD_RX = re.compile(r'^[A-Za-z0-9_]{1,30}$')
MAX_LISTS = 100
MAX_ROWS = 300
MAX_FIELDS = 12
MAX_LEN = 2000


class ListStore:
    """Хранилище списков администратора поверх kv «settings» базы (один объект на запрос)."""

    def __init__(self, store):
        self.store = store

    def all(self):
        d = ((self.store.kv_get('settings') or {}).get('lists')) or {}
        return d if isinstance(d, dict) else {}

    @staticmethod
    def clean_rows(key, rows):
        """Строки списка без лишнего: только поля-слова, значения — строка (до 2000 знаков) или число."""
        if not isinstance(rows, list):
            raise ValueError('Список «%s»: нужен перечень строк' % key)
        if len(rows) > MAX_ROWS:
            raise ValueError('Список «%s»: больше %d строк' % (key, MAX_ROWS))
        out = []
        for r in rows:
            if not isinstance(r, dict) or len(r) > MAX_FIELDS:
                raise ValueError('Список «%s»: неверная строка' % key)
            row = {}
            for f, v in r.items():
                if not FIELD_RX.match(str(f)):
                    raise ValueError('Список «%s»: неверное поле %s' % (key, str(f)[:30]))
                if isinstance(v, bool) or v is None:
                    row[f] = bool(v)
                elif isinstance(v, (int, float)):
                    row[f] = v
                else:
                    row[f] = str(v).strip()[:MAX_LEN]
            out.append(row)
        return out

    def save(self, values, by=''):
        """values = {ключ: [строки] | None (вернуть встроенный список)}. ValueError — понятным текстом."""
        if not isinstance(values, dict):
            raise ValueError('Нет списков')
        st = self.store.kv_get('settings') or {}
        cur = dict(st.get('lists') or {})
        for k, rows in values.items():
            if not KEY_RX.match(str(k)):
                raise ValueError('Неверный ключ списка: %s' % str(k)[:40])
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
