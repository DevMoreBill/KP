# -*- coding: utf-8 -*-
"""Включение и отключение дополнительных функций программы («Настройки → Функции программы»).

• kv «settings».features = {ключ: true | false}; нет ключа — действует встроенное значение (FEATURES).
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
]


def get(store):
    """Действующие значения всех функций: {ключ: true | false}."""
    own = ((store.kv_get('settings') or {}).get('features')) or {}
    own = own if isinstance(own, dict) else {}
    return {k: bool(own[k]) if isinstance(own.get(k), bool) else d for k, (d, _) in FEATURES.items()}


def on(store, key):
    return get(store).get(key, True)


def save(store, values, by=''):
    """values = {ключ: true | false | None (вернуть встроенное)}. ValueError — понятным текстом."""
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
            cur[k] = v
        else:
            raise ValueError('Значение функции — да или нет')
    st['features'] = cur
    st['featuresAt'], st['featuresBy'] = datetime.now().isoformat(timespec='seconds'), by
    store.kv_set('settings', st)
    return get(store)


def blocked(store, method, path):
    """Название выключенной функции, которой принадлежит адрес, или None."""
    for m, rx, key in ROUTES:
        if (m is None or m == method) and rx.match(path):
            return None if on(store, key) else FEATURES[key][1]
    return None
