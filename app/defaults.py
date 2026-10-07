# -*- coding: utf-8 -*-
"""Значения по умолчанию программы, которые задаёт администратор («Настройки → Умолчания»).

Хранятся в kv «settings».defaults = {ключ: {"on": да/нет, "v": значение}}. Список ключей, подписи и встроенные значения —
в интерфейсе (app/web/js/core/defaults.js): сервер хранит и отдаёт то, что выбрал администратор, и сам использует только
настройки фото со страницы (мин. размер файла и сторон, пропуск пустых картинок, сколько фото показывать).
Нет записи по ключу — действует встроенное значение программы.
"""
import re
from datetime import datetime

KEY_RX = re.compile(r'^[\w.\- ёЁ]{1,80}$')
MAX_KEYS = 200
MAX_LEN = 500

# фото со страницы товара: встроенные значения (как в defaults.js)
IMG_BUILTIN = {'img.minKB': 15, 'img.minPx': 200, 'img.skipBlank': True, 'img.maxCount': 12}


def get(store):
    d = ((store.kv_get('settings') or {}).get('defaults')) or {}
    return d if isinstance(d, dict) else {}


def _clean(v):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return v
    return str(v).strip()[:MAX_LEN]


def save(store, values, by=''):
    """values = {ключ: {"on": bool, "v": значение} | None (вернуть встроенное)}. ValueError — понятным текстом."""
    if not isinstance(values, dict):
        raise ValueError('Нет значений')
    st = store.kv_get('settings') or {}
    cur = dict(st.get('defaults') or {})
    for k, x in values.items():
        if not KEY_RX.match(str(k)):
            raise ValueError('Неверный ключ: %s' % str(k)[:40])
        if x is None:
            cur.pop(k, None)
            continue
        if not isinstance(x, dict):
            raise ValueError('Неверное значение: %s' % k)
        cur[k] = {'on': bool(x.get('on', True)), 'v': _clean(x.get('v'))}
    if len(cur) > MAX_KEYS:
        raise ValueError('Слишком много значений')
    st['defaults'] = cur
    st['defaultsAt'], st['defaultsBy'] = datetime.now().isoformat(timespec='seconds'), by
    store.kv_set('settings', st)
    return cur


def value(store, key, builtin=None):
    """Значение для сервера: выключено — None, не задано — встроенное."""
    x = get(store).get(key)
    if not isinstance(x, dict):
        return builtin
    if not x.get('on', True):
        return None
    v = x.get('v')
    return builtin if v in (None, '') else v


def img_opts(store):
    """Фильтр фото со страницы: {minKB, minPx, skipBlank, maxCount} (выключенное ограничение — 0 / False)."""
    out = {}
    for k, b in IMG_BUILTIN.items():
        x = get(store).get(k)
        name = k.split('.', 1)[1]
        if isinstance(b, bool):
            out[name] = bool(x.get('on', True)) if isinstance(x, dict) else b
            continue
        v = value(store, k, b)
        try:
            out[name] = max(0, int(float(str(v).replace(',', '.')))) if v is not None else 0
        except ValueError:
            out[name] = b
    if not out['maxCount']:
        out['maxCount'] = 30
    return out
