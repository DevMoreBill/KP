"""Дополнительные функции программы («Настройки → Функции программы»): кому видны, какие адреса закрыты."""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar

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
    'dealDocs': (True, 'Документы сделки'),
    'intake': (True, 'Заявка из письма или ТЗ'),
    'callResult': (True, 'Итог звонка'),
    'ufAuto': (True, 'Автозаполнение полей Битрикс24'),
    'dealDelete': (True, 'Удаление сделки'),
    'dealBulk': (True, 'Массовые действия со сделками'),
    'dealPause': (True, 'Отложенные сделки'),
    'idleDeals': (True, '«Без движения» на «Сегодня»'),
    'forecast': (True, 'Прогноз месяца'),
    'callHistory': (True, 'Звонки клиенту в сделке'),
    'notify': (True, 'Уведомления в браузере'),
    'presetPrices': (True, 'Цены заготовки из каталога'),
    'kpCompare': (True, 'Сравнение версий КП'),
    'priceGuard': (True, 'Проверка цен перед сохранением'),
    'docsGen': (True, 'Счёт, спецификация и договор из КП'),
    'kpStamp': (True, 'Подпись и печать в КП'),
    'priceAge': (True, 'Устаревшие цены в каталоге'),
    'analogs': (True, 'Аналоги других производителей'),
    'leadTime': (True, 'Срок поставки из каталога в условия'),
    'stLibrary': (True, 'Типовые станции'),
    'payCalendar': (True, 'Платёжный календарь'),
    'receivables': (True, 'Просроченные оплаты клиентов'),
    'rateDiff': (True, 'Курс в сделке'),
    'onec': (True, 'Оплаты из 1С'),
}

# функция работает только вместе с другой (как needs в app/web/js/core/features.js)
NEEDS = dict.fromkeys(
    (
        'dealDocs',
        'intake',
        'callResult',
        'ufAuto',
        'dealDelete',
        'dealBulk',
        'dealPause',
        'idleDeals',
        'forecast',
        'callHistory',
        'notify',
        'payCalendar',
        'receivables',
        'rateDiff',
    ),
    'myDay',
)
NEEDS.update(
    {
        'presetPrices': 'presets',
        'kpCompare': 'versions',
        'stLayout': 'stations',
        'carriers': 'deal',
        'reminders': 'track',
        'autosave': 'drafts',
    }
)

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
    (None, re.compile(r'^/api/crm/deal/d\d{1,9}/files(/.*)?$'), 'dealDocs'),
    (None, re.compile(r'^/api/crm/intake$'), 'intake'),
    (None, re.compile(r'^/api/crm/deal/d\d{1,9}/(remove|restore)$'), 'dealDelete'),
    ('GET', re.compile(r'^/api/doctpl/(contract|spec)$'), 'docsGen'),
    ('GET', re.compile(r'^/api/crm/pay$'), 'payCalendar'),
    ('POST', re.compile(r'^/api/crm/deal/d\d{1,9}/remind$'), 'receivables'),
    (None, re.compile(r'^/api/onec(/.*)?$'), 'onec'),
    (None, re.compile(r'^/api/crm(/.*)?$'), 'myDay'),
]


@dataclass(frozen=True)
class Viewer:
    """Кто спрашивает о функциях: администратор или менеджер (id)."""

    admin: bool
    uid: str = ''
    ADMIN: ClassVar['Viewer']


Viewer.ADMIN = Viewer(admin=True)


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
        return {k: self._norm(own.get(k), k) for k in FEATURES}

    def _norm(self, v, key: str) -> dict:
        if isinstance(v, bool):
            v = {'on': v}
        v = v if isinstance(v, dict) else {}
        who = v.get('who') if v.get('who') in self.WHO else 'all'
        users = (
            [str(x)[:64] for x in (v.get('users') or []) if isinstance(x, str)][: self.MAX_USERS]
            if who == 'users'
            else []
        )
        builtin = FEATURES[key][0]
        return {'on': bool(v['on']) if isinstance(v.get('on'), bool) else builtin, 'who': who, 'users': users}

    @staticmethod
    def allowed(cfg: dict, key: str, viewer: Viewer) -> bool:
        conf = cfg.get(key) or {'on': True, 'who': 'all'}
        if not conf['on']:
            return False
        if conf['who'] == 'all' or viewer.admin:
            return True
        return conf['who'] == 'users' and bool(viewer.uid) and viewer.uid in conf['users']

    def for_user(self, viewer: Viewer = Viewer.ADMIN) -> dict[str, bool]:
        cfg = self.config()
        return {k: self.allowed(cfg, k, viewer) for k in FEATURES}

    def is_on(self, key: str) -> bool:
        return self.config()[key]['on']

    def save(self, values: object, author: str = '') -> dict:
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
                cfg, viewer = self.config(), Viewer(*who())
                for one in (key, *self._needs(key)):
                    if not self.allowed(cfg, one, viewer):
                        return FEATURES[one][1]
                return None
        return None

    @staticmethod
    def _needs(key: str) -> tuple[str, ...]:
        """Без какой функции эта не работает (цепочкой)."""
        found, out = NEEDS.get(key), []
        while found:
            out.append(found)
            found = NEEDS.get(found)
        return tuple(out)
