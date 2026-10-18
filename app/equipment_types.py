# -*- coding: utf-8 -*-
"""Справочник типов оборудования: встроенный (app/equipment_types.json) + свои типы отдела (в базе)."""
import json
import os
import re

from config import APP_DIR, read_text, store


def types_builtin_path():
    return os.path.join(APP_DIR, 'equipment_types.json')


def load_types_builtin():
    try:
        return json.loads(read_text(types_builtin_path())).get('types', [])
    except Exception:
        return []


def load_types():
    """Справочник типов оборудования: встроенный (app/equipment_types.json) + свои (kv «types» в базе).

    Свой тип с тем же id заменяет встроенный, новые добавляются в конец, а тип с "hidden": true скрывается.
    Так новые виды оборудования добавляются без правки кода.
    """
    base = load_types_builtin()
    user = (store().kv_get('types') or {}).get('types', [])
    out = [dict(t) for t in base]
    index = {t.get('id'): i for i, t in enumerate(out)}
    for t in user:
        if not isinstance(t, dict) or not t.get('id'):
            continue
        if t['id'] in index:
            merged = dict(out[index[t['id']]])
            merged.update(t)
            out[index[t['id']]] = merged
        else:
            index[t['id']] = len(out)
            out.append(t)
    return {'version': 1, 'types': [t for t in out if not t.get('hidden')]}


def save_user_types(body):
    data = json.loads(body.decode('utf-8'))
    if not isinstance(data, dict):
        raise ValueError('Ожидается {"types": [...]}')
    if isinstance(data.get('add'), list):
        # добавить категории к нынешним (новая категория из окна каталога): список целиком не пересылается — категория,
        # созданная коллегой минутой раньше, не теряется
        cur = (store().kv_get('types') or {}).get('types') or []
        add = {str(t.get('id')): t for t in data['add'] if isinstance(t, dict)}
        data = {'types': [t for t in cur if not (isinstance(t, dict) and str(t.get('id')) in add)] + list(add.values())}
    types = data.get('types')
    if not isinstance(types, list):
        raise ValueError('Ожидается {"types": [...]}')
    for t in types:
        if not isinstance(t, dict) or not re.match(r'^[a-z][a-z0-9_]{1,30}$', t.get('id') or ''):
            raise ValueError('У каждого типа нужен id: латиница, цифры и «_»')
        if not isinstance(t.get('fields', []), list):
            raise ValueError('fields должен быть списком')
    store().kv_set('types', {'version': 1, 'types': types})
