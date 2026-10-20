"""Дополнительные функции программы («Настройки → Функции программы»): кому видны, какие адреса закрыты."""

import re
from datetime import datetime

# ключ: (встроенное значение, название)
FEATURES = {
    'tender': (True, 'КП для тендера'),
    'stations': (True, 'Станции в контейнере'),
    'stLayout': (True, 'Компоновка станций: чертёж и 3D-вид'),
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
    'myDay': (True, 'Кабинет менеджера'),
    'drafts': (True, 'Черновики на сервере'),
    'autosave': (True, 'Автосохранение'),
    'presets': (True, 'Заготовки КП'),
    'priceHist': (True, 'Цены в прошлых КП'),
    'saveDlg': (True, 'Окно «КП сохранено»'),
    'mgrLine': (True, '«Менеджер» строкой'),
    'clientCard': (True, 'Карточка клиента'),
    'kpFiles': (True, 'Справочные документы к КП'),
}

# адреса функции: (метод или None — любой, шаблон пути, ключ)
ROUTES = [
    (None, re.compile(r'^/api/kp/[A-Za-z0-9_-]+/track$'), 'track'),
    ('GET', re.compile(r'^/api/reminders$'), 'reminders'),
    (None, re.compile(r'^/api/kp/[A-Za-z0-9_-]+/(send|mailform)$'), 'mail'),
    ('GET', re.compile(r'^/api/report$'), 'report'),
    (None, re.compile(r'^/api/check(/.*)?$'), 'check'),
    (None, re.compile(r'^/api/ai/(fill|profile)$'), 'ai'),
    ('POST', re.compile(r'^/api/logistics/quote$'), 'carriers'),
    ('GET', re.compile(r'^/api/kp/[A-Za-z0-9_-]+/versions(/\d+)?$'), 'versions'),
    (None, re.compile(r'^/api/drafts(/.*)?$'), 'drafts'),
    (None, re.compile(r'^/api/presets(/.*)?$'), 'presets'),
    (None, re.compile(r'^/api/clientcard(/.*)?$'), 'clientCard'),
    (None, re.compile(r'^/api/kp/[A-Za-z0-9_-]+/files(/.*)?$'), 'kpFiles'),
    (None, re.compile(r'^/api/crm(/.*)?$'), 'myDay'),
]


class FeatureAccess:
    """Настройка функций хранилища и доступ пользователя к ним."""

    WHO = ('all', 'admin', 'users')
    ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
    MAX_USERS = 200

    def __init__(self, store) -> None:
        self.store = store

    def config(self) -> dict:
        """{ключ: {on, who, users}}; старое значение да / нет — {on, who: all}."""
        own = ((self.store.kv_get('settings') or {}).get('features')) or {}
        own = own if isinstance(own, dict) else {}
        return {k: self._norm(own.get(k), desc) for k, (desc, _) in FEATURES.items()}

    def _norm(self, v, default: bool) -> dict:
        if isinstance(v, bool):
            v = {'on': v}
        v = v if isinstance(v, dict) else {}
        who = v.get('who') if v.get('who') in self.WHO else 'all'
        users = (
            [str(x)[:64] for x in (v.get('users') or []) if isinstance(x, str)][: self.MAX_USERS]
            if who == 'users'
            else []
        )
        return {'on': bool(v['on']) if isinstance(v.get('on'), bool) else default, 'who': who, 'users': users}

    @staticmethod
    def allowed(cfg: dict, key: str, is_admin: bool, uid: str) -> bool:
        conf = cfg.get(key) or {'on': True, 'who': 'all'}
        if not conf['on']:
            return False
        if conf['who'] == 'all' or is_admin:
            return True
        return conf['who'] == 'users' and bool(uid) and uid in conf['users']

    def for_user(self, is_admin: bool = True, uid: str = '') -> dict[str, bool]:
        cfg = self.config()
        return {k: self.allowed(cfg, k, is_admin, uid) for k in FEATURES}

    def is_on(self, key: str) -> bool:
        return self.config()[key]['on']

    def save(self, values: dict, author: str = '') -> dict:
        """values = {ключ: {on, who, users} | да / нет | None — встроенное}."""
        if not isinstance(values, dict) or not values:
            raise ValueError('Нет значений')
        settings = self.store.kv_get('settings') or {}
        cur = dict(settings.get('features') or {})
        for k, v in values.items():
            if k not in FEATURES:
                raise ValueError(f'Неизвестная функция: {str(k)[:40]}')
            if v is None:
                cur.pop(k, None)
            else:
                cur[k] = self._value(cur.get(k), v)
        settings['features'] = cur
        settings['featuresAt'], settings['featuresBy'] = datetime.now().isoformat(timespec='seconds'), author
        self.store.kv_set('settings', settings)
        return self.config()

    def _value(self, old, v) -> dict:
        old = old if isinstance(old, dict) else {}
        if isinstance(v, bool):
            return {'on': v, 'who': old.get('who', 'all'), 'users': old.get('users', [])}
        if not isinstance(v, dict):
            raise ValueError('Неверное значение функции')
        who = v.get('who', 'all')
        if who not in self.WHO:
            raise ValueError('Кому доступно: всем, администратору или выбранным менеджерам')
        users = v.get('users') or []
        if not isinstance(users, list) or not all(isinstance(x, str) and self.ID_RE.match(x) for x in users):
            raise ValueError('Неверный список менеджеров')
        return {'on': bool(v.get('on', True)), 'who': who, 'users': users[: self.MAX_USERS] if who == 'users' else []}

    def blocked(self, method: str, path: str, who) -> str | None:
        """Название недоступной пользователю функции адреса или None; who() → (администратор ли, id менеджера)."""
        for pattern, regex, key in ROUTES:
            if (pattern is None or pattern == method) and regex.match(path):
                is_admin, uid = who()
                return None if self.allowed(self.config(), key, is_admin, uid) else FEATURES[key][1]
        return None
