"""Значения по умолчанию от администратора: kv «settings».defaults = {ключ: {on, v}}; нет записи — встроенное."""

import math
import re
import threading
import time
from datetime import datetime
from typing import Any

KEY_RX = re.compile(r'^[\w.\- ёЁ]{1,80}$')
MAX_KEYS = 3000
MAX_LEN = 500

# фото со страницы товара (как в defaults.js)
IMG_BUILTIN = {'img.minKB': 15, 'img.minPx': 200, 'img.skipBlank': True, 'img.maxCount': 12}


def get(store) -> dict:
    data = ((store.kv_get('settings') or {}).get('defaults')) or {}
    return data if isinstance(data, dict) else {}


def _clean(v):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return v
    return str(v).strip()[:MAX_LEN]


def save(store, values: dict, author: str = '') -> dict:
    """values = {ключ: {on, v} | None — встроенное}."""
    if not isinstance(values, dict):
        raise ValueError('Нет значений')
    settings = store.kv_get('settings') or {}
    cur = dict(settings.get('defaults') or {})
    for k, x in values.items():
        if not KEY_RX.match(str(k)):
            raise ValueError(f'Неверный ключ: {str(k)[:40]}')
        if x is None:
            cur.pop(k, None)
            continue
        if not isinstance(x, dict):
            raise ValueError(f'Неверное значение: {k}')
        cur[k] = {'on': bool(x.get('on', True)), 'v': _clean(x.get('v'))}
    if len(cur) > MAX_KEYS:
        raise ValueError('Слишком много значений')
    for k in values:
        SrvVal.check(k, cur.get(k))
    settings['defaults'] = cur
    settings['defaultsAt'], settings['defaultsBy'] = datetime.now().isoformat(timespec='seconds'), author
    store.kv_set('settings', settings)
    SrvVal.forget()
    return cur


def value(store, key: str, builtin=None):
    """Выключено — None, не задано — встроенное."""
    return _value_of(get(store).get(key), builtin)


def _value_of(x, builtin):
    if not isinstance(x, dict):
        return builtin
    if not x.get('on', True):
        return None
    v = x.get('v')
    return builtin if v in (None, '') else v


def _num_of(v, builtin, low: float | None = None, high: float | None = None):
    try:
        num = float(str(v).replace(',', '.').replace(' ', ''))
    except (TypeError, ValueError):
        return builtin
    if not math.isfinite(num) or (low is not None and num < low) or (high is not None and num > high):
        return builtin
    return int(num) if isinstance(builtin, int) and not isinstance(builtin, bool) and num == int(num) else num


def num(store, key: str, builtin, low: float | None = None, high: float | None = None):
    """Число из «Значений программы»; не задано, выключено, не число или вне [lo, hi] — встроенное."""
    return _num_of(value(store, key, builtin), builtin, low, high)


class SrvVal:
    """Числа сервера из «Значений программы» (описания — core/defaults-srv.js, сверка — tests/test_srv_values.py)."""

    # ключ: (встроенное, наименьшее, наибольшее)
    LIMITS = {
        # резервные копии
        'srv.backupDaily': (7, 1, 90),
        'srv.backupWeekly': (4, 0, 52),
        'srv.backupMonthly': (12, 0, 120),
        'srv.backupStaleDays': (2, 1, 30),
        'srv.mirrorStaleDays': (2, 1, 30),
        # журналы и хранение
        'srv.trashDays': (30, 1, 365),
        'srv.kpVersions': (30, 5, 500),
        'srv.tplHistory': (40, 5, 500),
        'srv.settingsHistory': (500, 50, 5000),
        'srv.checksDays': (365, 30, 3650),
        'srv.imgUnusedDays': (30, 7, 365),
        'srv.vacuumDays': (30, 7, 365),
        # вход и сессии (защита — только в безопасных пределах)
        'srv.adminIdleMin': (15, 5, 240),
        'srv.userSessionDays': (30, 1, 365),
        'srv.userShortHours': (12, 1, 72),
        'srv.loginFails': (5, 3, 20),
        'srv.loginLockMin': (10, 1, 120),
        'srv.adminPwMin': (8, 8, 64),
        'srv.userPwMin': (4, 4, 64),
        'srv.tempPwHours': (24, 1, 168),
        # письма администратору и «Требует внимания»
        'srv.alertRemindH': (24, 1, 168),
        'srv.lowDiskGB': (2.0, 0.5, 1000),
        'srv.alertsEveryMin': (60, 15, 1440),
        # ночное обновление
        'srv.nightWindowH': (2, 1, 6),
        'srv.nightQuietMin': (15, 5, 120),
        # статистика
        'srv.statTop': (10, 3, 50),
        'srv.statActiveDays': (30, 1, 365),
        # проверка контрагентов
        'cp.ttlDays': (7, 0, 90),
        'cp.reserve': (20, 0, 100),
        'cp.finReuseDays': (120, 0, 365),
        'cp.fullReuseDays': (30, 0, 180),
        'cp.youngYears': (1, 0, 10),
        'cp.courtsPct': (10, 1, 100),
        'cp.queueEveryMin': (30, 10, 720),
        # фиды, страницы, нейросеть
        'cat.feedHour': (6, 0, 23),
        'cat.feedMaxMB': (150, 10, 1000),
        'cat.feedFileMB': (60, 5, 250),
        'cat.feedLog': (30, 5, 200),
        'cat.pageDays': (30, 1, 365),
        'cat.imgMaxMB': (15, 1, 100),
        'cat.docMaxMB': (40, 5, 250),
        'ai.rateMin': (30, 5, 300),
        'ai.temperature': (0.2, 0, 1.5),
        'ai.maxTokens': (8000, 1000, 8192),
        # напоминания менеджеру
        'kp.staleDays': (7, 1, 90),
        'kp.expireAhead': (3, 0, 30),
        'kp.expiredShow': (3, 0, 60),
        'kp.remindDays': (200, 30, 1000),
        # справочные документы к КП (app/kp_files.py)
        'kp.fileMB': (25, 1, 100),
        'kp.filesMax': (20, 1, 100),
        'kp.filesMB': (100, 10, 1000),
        'kp.mailMB': (18, 5, 50),
        'kp.mailPerHour': (30, 1, 500),
        'kp.fileUndoMin': (10, 0, 120),
        'kp.imgMB': (25, 5, 100),
    }
    TTL = 5
    _cache: tuple[Any, float, dict] = (None, 0.0, {})
    _lock = threading.Lock()

    @classmethod
    def forget(cls) -> None:
        with cls._lock:
            cls._cache = (None, 0.0, {})

    @classmethod
    def _all(cls, store) -> dict:
        with cls._lock:
            cached, stamp, values = cls._cache
            if cached is store and time.time() - stamp < cls.TTL:
                return values
        values = get(store)
        with cls._lock:
            cls._cache = (store, time.time(), values)
        return values

    @classmethod
    def get(cls, store, key: str):
        builtin, low, high = cls.LIMITS[key]
        if store is None:
            return builtin
        try:
            x = cls._all(store).get(key)
        except Exception:
            return builtin
        num = _num_of(_value_of(x, builtin), builtin, low, high)
        return round(num) if isinstance(builtin, int) else num

    @classmethod
    def now(cls, key: str):
        """То же для открытой базы программы (config.STORE); не открыта — встроенное."""
        try:
            import config

            store = config.STORE
        except Exception:
            store = None
        return cls.get(store, key)

    @classmethod
    def check(cls, key: str, x) -> None:
        """При сохранении: число в границах, пустое — встроенное."""
        if key not in cls.LIMITS or not isinstance(x, dict) or x.get('v') in (None, ''):
            return
        _, low, high = cls.LIMITS[key]
        if _num_of(x['v'], None, low, high) is None:
            raise ValueError(f'Значение «{key}»: нужно число от {low} до {high}')


def img_opts(store) -> dict:
    """Фильтр фото со страницы: {minKB, minPx, skipBlank, maxCount}; выключенное — 0 / False."""
    out: dict[str, Any] = {}
    own = get(store)
    for k, builtin in IMG_BUILTIN.items():
        x = own.get(k)
        name = k.split('.', 1)[1]
        if isinstance(builtin, bool):
            out[name] = bool(x.get('on', True)) if isinstance(x, dict) else builtin
            continue
        v = _value_of(x, builtin)
        out[name] = max(0, int(_num_of(v, builtin))) if v is not None else 0
    if not out['maxCount']:
        out['maxCount'] = 30
    return out
