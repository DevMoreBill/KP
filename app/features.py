# -*- coding: utf-8 -*-
"""Включение и отключение дополнительных функций программы («Настройки → Функции программы»).

• kv «settings».features = {ключ: {on, who: all | admin | users, users: [id менеджеров]}}; нет ключа — встроенное значение
  (FEATURES), для всех. «Только администратору» — функцию видит вошедший в «Настройки»; «выбранным» — им и администратору.
  Кто работает: при входе по паролю — вошедший менеджер, иначе — менеджер, выбранный на устройстве (подпись запроса).
• Интерфейс прячет выключенные функции (подписи и описания — app/web/js/core/features.js), сервер закрывает их адреса
  (blocked → 403 «Функция выключена администратором»): выключенную функцию нельзя вызвать и в обход интерфейса.
• Данные выключенной функции не удаляются: включили снова — всё на месте.
"""
import re
from datetime import datetime

# ключ: (встроенное значение, название — для ответа сервера)
FEATURES = {
    'tender': (True, 'КП для тендера'),
    'stations': (True, 'Станции в контейнере'),
    'check': (True, 'Проверка контрагента'),
    'clientPrev': (True, 'Предупреждение о КП клиента'),
    'ai': (True, 'Заполнение с ИИ'),
    'deal': (True, 'Экономика сделки'),
    'carriers': (True, 'Цены перевозчиков онлайн'),
    'track': (True, 'Ход сделки'),
    'reminders': (True, 'Напоминания'),
    'mail': (True, 'Отправка КП по почте'),
    'report': (True, 'Отчёт по КП'),
    'versions': (True, 'История версий КП'),
    'feedInfo': (True, 'РРЦ и остатки поставщиков'),
    'catImport': (True, 'Импорт каталога'),
    'hotkeys': (True, 'Горячие клавиши'),
    'myDay': (True, '«Мой день»'),
    'drafts': (True, 'Черновики на сервере'),
    'autosave': (True, 'Автосохранение'),
    'presets': (True, 'Заготовки КП'),
    'priceHist': (True, 'Цены в прошлых КП'),
    'saveDlg': (True, 'Окно «КП сохранено»'),
    'mgrLine': (True, '«Менеджер» строкой'),
    'clientCard': (True, 'Карточка клиента'),
}

# адреса сервера, которые принадлежат функции: (метод или None — любой, шаблон пути, ключ)
ROUTES = [
    (None, re.compile(r'^/api/kp/[A-Za-z0-9_-]+/track$'), 'track'),
    ('GET', re.compile(r'^/api/reminders$'), 'reminders'),
    (None, re.compile(r'^/api/kp/[A-Za-z0-9_-]+/(send|mailform)$'), 'mail'),
    ('GET', re.compile(r'^/api/report$'), 'report'),
    (None, re.compile(r'^/api/check(/.*)?$'), 'check'),
    ('POST', re.compile(r'^/api/ai/fill$'), 'ai'),
    ('POST', re.compile(r'^/api/logistics/quote$'), 'carriers'),
    ('GET', re.compile(r'^/api/kp/[A-Za-z0-9_-]+/versions(/\d+)?$'), 'versions'),
    (None, re.compile(r'^/api/drafts(/.*)?$'), 'drafts'),
    (None, re.compile(r'^/api/presets(/.*)?$'), 'presets'),
    (None, re.compile(r'^/api/clientcard(/.*)?$'), 'clientCard'),
]


WHO = ('all', 'admin', 'users')       # кому доступна включённая функция: всем, только администратору, выбранным менеджерам


def config(store):
    """Настройка всех функций: {ключ: {on, who, users}} (старое значение да / нет — {on, who: all})."""
    own = ((store.kv_get('settings') or {}).get('features')) or {}
    own = own if isinstance(own, dict) else {}
    out = {}
    for k, (d, _) in FEATURES.items():
        v = own.get(k)
        if isinstance(v, bool):
            v = {'on': v}
        v = v if isinstance(v, dict) else {}
        who = v.get('who') if v.get('who') in WHO else 'all'
        users = [str(x)[:64] for x in (v.get('users') or []) if isinstance(x, str)][:200] if who == 'users' else []
        out[k] = {'on': bool(v['on']) if isinstance(v.get('on'), bool) else d, 'who': who, 'users': users}
    return out


def allowed(cfg, key, is_admin, uid):
    """Доступна ли функция этому пользователю: выключена — нет; «только администратору» — администратору;
    «выбранным» — им и администратору."""
    c = cfg.get(key) or {'on': True, 'who': 'all'}
    if not c['on']:
        return False
    if c['who'] == 'all':
        return True
    if is_admin:
        return True
    return c['who'] == 'users' and bool(uid) and uid in c['users']


def get(store, is_admin=True, uid=''):
    """Действующие значения для пользователя: {ключ: да | нет}."""
    cfg = config(store)
    return {k: allowed(cfg, k, is_admin, uid) for k in FEATURES}


def on(store, key):
    """Включена ли функция вообще (для всех или для кого-то)."""
    return config(store)[key]['on']


def save(store, values, by=''):
    """values = {ключ: {on, who, users} | да / нет | None (вернуть встроенное)}. ValueError — понятным текстом."""
    if not isinstance(values, dict) or not values:
        raise ValueError('Нет значений')
    st = store.kv_get('settings') or {}
    cur = dict(st.get('features') or {})
    for k, v in values.items():
        if k not in FEATURES:
            raise ValueError('Неизвестная функция: %s' % str(k)[:40])
        if v is None:
            cur.pop(k, None)
        elif isinstance(v, bool):
            cur[k] = {'on': v, 'who': (cur.get(k) or {}).get('who', 'all') if isinstance(cur.get(k), dict) else 'all',
                      'users': (cur.get(k) or {}).get('users', []) if isinstance(cur.get(k), dict) else []}
        elif isinstance(v, dict):
            who = v.get('who', 'all')
            if who not in WHO:
                raise ValueError('Кому доступно: всем, администратору или выбранным менеджерам')
            users = v.get('users') or []
            if not isinstance(users, list) or not all(isinstance(x, str) and re.match(r'^[A-Za-z0-9_-]{1,64}$', x) for x in users):
                raise ValueError('Неверный список менеджеров')
            cur[k] = {'on': bool(v.get('on', True)), 'who': who, 'users': users[:200] if who == 'users' else []}
        else:
            raise ValueError('Неверное значение функции')
    st['features'] = cur
    st['featuresAt'], st['featuresBy'] = datetime.now().isoformat(timespec='seconds'), by
    store.kv_set('settings', st)
    return config(store)


def blocked(store, method, path, who):
    """Название функции, которой принадлежит адрес и которая недоступна этому пользователю, или None.
    who() → (администратор ли, id менеджера) — вызывается, только если адрес принадлежит функции."""
    for m, rx, key in ROUTES:
        if (m is None or m == method) and rx.match(path):
            is_admin, uid = who()
            return None if allowed(config(store), key, is_admin, uid) else FEATURES[key][1]
    return None
