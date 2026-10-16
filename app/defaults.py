# -*- coding: utf-8 -*-
"""Значения по умолчанию программы, которые задаёт администратор («Настройки → Умолчания»).

Хранятся в kv «settings».defaults = {ключ: {"on": да/нет, "v": значение}}. Список ключей, подписи и встроенные значения —
в интерфейсе (app/web/js/core/defaults.js, значения сервера — app/web/js/core/defaults-srv.js): сервер хранит и отдаёт то,
что выбрал администратор, и сам использует настройки фото со страницы (img_opts) и значения сервера (SrvVal: сроки
хранения, копии, сессии, пороги писем, расписания, проверки контрагентов, нейросеть и т. п.).
Нет записи по ключу — действует встроенное значение программы.
"""
import math
import re
import threading
import time
from datetime import datetime

KEY_RX = re.compile(r'^[\w.\- ёЁ]{1,80}$')
MAX_KEYS = 3000
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
    for k in values:
        SrvVal.check(k, cur.get(k))
    st['defaults'] = cur
    st['defaultsAt'], st['defaultsBy'] = datetime.now().isoformat(timespec='seconds'), by
    store.kv_set('settings', st)
    SrvVal.forget()
    return cur


def value(store, key, builtin=None):
    """Значение для сервера: выключено — None, не задано — встроенное."""
    return _value_of(get(store).get(key), builtin)


def _value_of(x, builtin):
    if not isinstance(x, dict):
        return builtin
    if not x.get('on', True):
        return None
    v = x.get('v')
    return builtin if v in (None, '') else v


def _num_of(v, builtin, lo=None, hi=None):
    try:
        n = float(str(v).replace(',', '.').replace(' ', ''))
    except (TypeError, ValueError):
        return builtin
    if not math.isfinite(n) or (lo is not None and n < lo) or (hi is not None and n > hi):
        return builtin
    return int(n) if isinstance(builtin, int) and not isinstance(builtin, bool) and n == int(n) else n


def num(store, key, builtin, lo=None, hi=None):
    """Число из «Значений программы» (ключ из реестра интерфейса): не задано, выключено, не число или вне [lo, hi] —
    встроенное. Значения сервера описаны для админки в app/web/js/core/defaults-srv.js."""
    return _num_of(value(store, key, builtin), builtin, lo, hi)


class SrvVal:
    """Числа, которые использует сервер, из «Настройки → Значения программы» (описания для админки —
    app/web/js/core/defaults-srv.js; встроенные значения и границы там и здесь совпадают — проверяет tests/test_srv_values.py).
    SrvVal.get(store, ключ) — число: не задано, выключено, не число или вне границ — встроенное (поведение как до настройки).
    Значения читаются в момент использования (кэш на несколько секунд, сброс при сохранении) — перезапуск не нужен."""
    # ключ: (встроенное, наименьшее, наибольшее)
    LIMITS = {
        # резервные копии
        'srv.backupDaily': (7, 1, 90), 'srv.backupWeekly': (4, 0, 52), 'srv.backupMonthly': (12, 0, 120),
        'srv.backupStaleDays': (2, 1, 30), 'srv.mirrorStaleDays': (2, 1, 30),
        # журналы и хранение
        'srv.trashDays': (30, 1, 365), 'srv.kpVersions': (30, 5, 500), 'srv.tplHistory': (40, 5, 500),
        'srv.settingsHistory': (500, 50, 5000), 'srv.checksDays': (365, 30, 3650), 'srv.imgUnusedDays': (30, 7, 365),
        'srv.vacuumDays': (30, 7, 365),
        # вход и сессии (защита — только в безопасных пределах)
        'srv.adminIdleMin': (15, 5, 240), 'srv.userSessionDays': (30, 1, 365), 'srv.userShortHours': (12, 1, 72), 'srv.loginFails': (5, 3, 20),
        'srv.loginLockMin': (10, 1, 120), 'srv.adminPwMin': (8, 8, 64), 'srv.userPwMin': (4, 4, 64),
        'srv.tempPwHours': (24, 1, 168),
        # письма администратору и «Требует внимания»
        'srv.alertRemindH': (24, 1, 168), 'srv.lowDiskGB': (2.0, 0.5, 1000), 'srv.alertsEveryMin': (60, 15, 1440),
        # ночное обновление
        'srv.nightWindowH': (2, 1, 6), 'srv.nightQuietMin': (15, 5, 120),
        # статистика
        'srv.statTop': (10, 3, 50), 'srv.statActiveDays': (30, 1, 365),
        # проверка контрагентов
        'cp.ttlDays': (7, 0, 90), 'cp.reserve': (20, 0, 100), 'cp.finReuseDays': (120, 0, 365), 'cp.fullReuseDays': (30, 0, 180),
        'cp.youngYears': (1, 0, 10), 'cp.courtsPct': (10, 1, 100), 'cp.queueEveryMin': (30, 10, 720),
        # фиды, страницы, нейросеть
        'cat.feedHour': (6, 0, 23), 'cat.feedMaxMB': (150, 10, 1000), 'cat.feedFileMB': (60, 5, 250), 'cat.feedLog': (30, 5, 200),
        'cat.pageDays': (30, 1, 365), 'cat.imgMaxMB': (15, 1, 100), 'cat.docMaxMB': (40, 5, 250),
        'ai.rateMin': (30, 5, 300), 'ai.temperature': (0.2, 0, 1.5), 'ai.maxTokens': (8000, 1000, 8192),
        # напоминания менеджеру
        'kp.staleDays': (7, 1, 90), 'kp.expireAhead': (3, 0, 30), 'kp.expiredShow': (3, 0, 60), 'kp.remindDays': (200, 30, 1000),
        # справочные документы к КП (app/kp_files.py)
        'kp.fileMB': (25, 1, 100), 'kp.filesMax': (20, 1, 100), 'kp.filesMB': (100, 10, 1000), 'kp.mailMB': (18, 5, 50), 'kp.fileUndoMin': (10, 0, 120),
    }
    TTL = 5                  # с — кэш значений: сервер читает их на каждом запросе (сессии)
    _cache = (None, 0.0, {})
    _lock = threading.Lock()

    @classmethod
    def forget(cls):
        with cls._lock:
            cls._cache = (None, 0.0, {})

    @classmethod
    def _all(cls, store):
        with cls._lock:
            st, at, d = cls._cache
            if st is store and time.time() - at < cls.TTL:
                return d
        d = get(store)
        with cls._lock:
            cls._cache = (store, time.time(), d)
        return d

    @classmethod
    def get(cls, store, key):
        b, lo, hi = cls.LIMITS[key]
        if store is None:
            return b
        try:
            x = cls._all(store).get(key)
        except Exception:            # база недоступна — встроенное, сервер работает дальше
            return b
        n = _num_of(_value_of(x, b), b, lo, hi)
        return int(round(n)) if isinstance(b, int) else n      # целое встроенное — целое (сроки, количества)

    @classmethod
    def now(cls, key):
        """То же для открытой базы программы (config.STORE) — где хранилище не передаётся (сессии, вход, пароли);
        база ещё не открыта — встроенное."""
        try:
            import config
            st = config.STORE
        except Exception:
            st = None
        return cls.get(st, key)

    @classmethod
    def check(cls, key, x):
        """Проверка при сохранении: число в границах (пустое — встроенное). ValueError — понятным текстом."""
        if key not in cls.LIMITS or not isinstance(x, dict) or x.get('v') in (None, ''):
            return
        b, lo, hi = cls.LIMITS[key]
        if _num_of(x['v'], None, lo, hi) is None:
            raise ValueError('Значение «%s»: нужно число от %s до %s' % (key, lo, hi))


def img_opts(store):
    """Фильтр фото со страницы: {minKB, minPx, skipBlank, maxCount} (выключенное ограничение — 0 / False)."""
    out, own = {}, get(store)
    for k, b in IMG_BUILTIN.items():
        x = own.get(k)
        name = k.split('.', 1)[1]
        if isinstance(b, bool):
            out[name] = bool(x.get('on', True)) if isinstance(x, dict) else b
            continue
        v = _value_of(x, b)
        try:
            out[name] = max(0, int(float(str(v).replace(',', '.')))) if v is not None else 0
        except ValueError:
            out[name] = b
    if not out['maxCount']:
        out['maxCount'] = 30
    return out
