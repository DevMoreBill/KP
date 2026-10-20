"""Справочник типов оборудования: встроенный (app/equipment_types.json) + свои типы отдела (в базе)."""

import json
import os
import re

from config import APP_DIR, read_text, store


def types_builtin_path() -> str:
    return os.path.join(APP_DIR, 'equipment_types.json')


def load_types_builtin() -> list:
    try:
        return json.loads(read_text(types_builtin_path())).get('types', [])
    except Exception:
        return []


def load_types() -> dict:
    """Свой тип с тем же id дополняет встроенный, новые — в конец, «hidden» — скрыт."""
    base = load_types_builtin()
    user = (store().kv_get('types') or {}).get('types', [])
    out = [dict(item) for item in base]
    index = {item.get('id'): i for i, item in enumerate(out)}
    for item in user:
        if not isinstance(item, dict) or not item.get('id'):
            continue
        if item['id'] in index:
            merged = dict(out[index[item['id']]])
            merged.update(item)
            out[index[item['id']]] = merged
        else:
            index[item['id']] = len(out)
            out.append(item)
    return {'version': 1, 'types': [item for item in out if not item.get('hidden')]}


def save_user_types(body: bytes) -> None:
    data = json.loads(body.decode('utf-8'))
    if not isinstance(data, dict):
        raise ValueError('Ожидается {"types": [...]}')
    if isinstance(data.get('add'), list):
        # добавление к нынешним: категория, созданная коллегой минутой раньше, не теряется
        cur = (store().kv_get('types') or {}).get('types') or []
        add = {str(item.get('id')): item for item in data['add'] if isinstance(item, dict)}
        data = {
            'types': [item for item in cur if not (isinstance(item, dict) and str(item.get('id')) in add)]
            + list(add.values())
        }
    types = data.get('types')
    if not isinstance(types, list):
        raise ValueError('Ожидается {"types": [...]}')
    for item in types:
        if not isinstance(item, dict) or not re.match(r'^[a-z][a-z0-9_]{1,30}$', item.get('id') or ''):
            raise ValueError('У каждого типа нужен id: латиница, цифры и «_»')
        if not isinstance(item.get('fields', []), list):
            raise ValueError('fields должен быть списком')
    store().kv_set('types', {'version': 1, 'types': types})
