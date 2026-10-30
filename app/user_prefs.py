"""Личные настройки менеджера (kv «userPrefs»): тема, кабинет, шаблон, свои умолчания КП, подпись, расположение разделов."""

import re

from clock import Clock


class CabLayout:
    """Расположение разделов кабинета, своё у менеджера: две колонки, порядок, ширина левой, высоты, скрытые."""

    PAGES = ('today', 'team', 'deal')
    COLS = ('l', 'r')
    KEY_RX = re.compile(r'^[a-z]{2,16}$')
    MAX_KEYS = 24
    RATIO_MIN = 0.3
    RATIO_MAX = 0.8
    HEIGHT_MIN = 120
    HEIGHT_MAX = 3000

    @classmethod
    def clean(cls, data: object) -> dict:
        if not isinstance(data, dict):
            return {}
        return {page: cls._page(data[page]) for page in cls.PAGES if isinstance(data.get(page), dict)}

    @classmethod
    def _keys(cls, value: object) -> list:
        if not isinstance(value, list):
            return []
        keys = [str(key) for key in value if cls.KEY_RX.match(str(key))]
        return list(dict.fromkeys(keys))[: cls.MAX_KEYS]

    @staticmethod
    def _dict(value: object) -> dict:
        return value if isinstance(value, dict) else {}

    @classmethod
    def _page(cls, data: dict) -> dict:
        cols = cls._dict(data.get('cols'))
        page: dict = {'cols': {col: cls._keys(cols.get(col)) for col in cls.COLS}, 'hide': cls._keys(data.get('hide'))}
        ratio = data.get('ratio')
        if isinstance(ratio, (int, float)) and cls.RATIO_MIN <= ratio <= cls.RATIO_MAX:
            page['ratio'] = round(float(ratio), 3)
        heights = cls._dict(data.get('h'))
        page['h'] = {
            str(key): int(size)
            for key, size in list(heights.items())[: cls.MAX_KEYS]
            if cls.KEY_RX.match(str(key))
            and isinstance(size, (int, float))
            and cls.HEIGHT_MIN <= size <= cls.HEIGHT_MAX
        }
        return page


class UserPrefs:
    KV_KEY = 'userPrefs'
    THEMES = ('auto', 'light', 'dark', 'time')
    CAB_TABS = ('today', 'deals', 'clients')
    DEAL_VIEWS = ('board', 'list', 'gantt', 'pay')
    LIMITS = ('rem', 'drafts', 'todo')
    LIMIT_MIN = 1
    LIMIT_MAX = 30
    DEF_RX = re.compile(r'^(kp\.city|kp\.cur|cond\.[^.]{1,60})$')
    CURS = ('RUB', 'USD', 'EUR', 'CNY')
    MAX_TEXT = 2000
    MAX_DEF = 40
    MAX_DEF_TEXT = 500

    def __init__(self, store) -> None:
        self.store = store

    def _all(self) -> dict:
        stored = self.store.kv_get(self.KV_KEY)
        return stored if isinstance(stored, dict) else {}

    def get(self, uid: str) -> dict:
        return dict(self._all().get(str(uid)) or {})

    def save(self, uid: str, data: dict, author: str = '') -> dict:
        if not uid:
            raise ValueError('Сначала выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера')
        if not isinstance(data, dict):
            raise ValueError('Нет настроек')
        prefs = self._choices(data)
        tpl = str(data.get('template') or '').strip()
        if tpl:
            if not re.match(r'^[A-Za-z0-9_-]{1,64}$', tpl):
                raise ValueError('Неверный шаблон')
            prefs['template'] = tpl
        prefs['mailSign'] = str(data.get('mailSign') or '')[: self.MAX_TEXT]
        prefs['mailCopy'] = data.get('mailCopy') is not False
        prefs['livePreview'] = data.get('livePreview') is True
        prefs['limits'] = self._limits(data.get('limits'))
        prefs['cabLayout'] = CabLayout.clean(data.get('cabLayout'))
        prefs['defaults'] = self._defaults(data.get('defaults'))
        prefs['updatedAt'] = Clock.now()
        everyone = self._all()
        everyone[str(uid)[:64]] = prefs
        self.store.kv_set(self.KV_KEY, everyone)
        return prefs

    def _choices(self, data: dict) -> dict:
        allowed = {'theme': self.THEMES, 'cabTab': self.CAB_TABS, 'dealsView': self.DEAL_VIEWS}
        return {field: data[field] for field, values in allowed.items() if data.get(field) in values}

    def _limits(self, data: object) -> dict:
        if not isinstance(data, dict):
            return {}
        return {
            key: int(data[key])
            for key in self.LIMITS
            if isinstance(data.get(key), (int, float)) and self.LIMIT_MIN <= data[key] <= self.LIMIT_MAX
        }

    def _defaults(self, data: object) -> dict:
        defs: dict = {}
        for key, val in data.items() if isinstance(data, dict) else []:
            name, text = str(key), str(val if val is not None else '').strip()[: self.MAX_DEF_TEXT]
            if not self.DEF_RX.match(name) or not text:
                continue
            if name == 'kp.cur' and text not in self.CURS:
                raise ValueError('Валюта КП — рубли, доллары, евро или юани')
            defs[name] = text
            if len(defs) >= self.MAX_DEF:
                break
        return defs
