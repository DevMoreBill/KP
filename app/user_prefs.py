"""Личные настройки менеджера (kv «userPrefs»): тема, стартовый экран, шаблон, свои умолчания КП, подпись."""

import re
from datetime import datetime


class UserPrefs:
    KV_KEY = 'userPrefs'
    THEMES = ('auto', 'light', 'dark')
    STARTS = ('auto', 'myday', 'catalog', 'journal', 'none')
    DEF_RX = re.compile(r'^(kp\.city|kp\.cur|cond\.[^.]{1,60})$')
    CURS = ('RUB', 'USD', 'EUR', 'CNY')
    MAX_TEXT = 2000
    MAX_DEF = 40

    def __init__(self, store) -> None:
        self.store = store

    def _all(self) -> dict:
        v = self.store.kv_get(self.KV_KEY)
        return v if isinstance(v, dict) else {}

    def get(self, uid: str) -> dict:
        return dict(self._all().get(str(uid)) or {})

    def save(self, uid: str, data: dict, author: str = '') -> dict:
        if not uid:
            raise ValueError('Сначала выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера')
        if not isinstance(data, dict):
            raise ValueError('Нет настроек')
        prefs = {}
        if data.get('theme') in self.THEMES:
            prefs['theme'] = data['theme']
        if data.get('start') in self.STARTS:
            prefs['start'] = data['start']
        tpl = str(data.get('template') or '').strip()
        if tpl:
            if not re.match(r'^[A-Za-z0-9_-]{1,64}$', tpl):
                raise ValueError('Неверный шаблон')
            prefs['template'] = tpl
        prefs['mailSign'] = str(data.get('mailSign') or '')[: self.MAX_TEXT]
        prefs['mailCopy'] = data.get('mailCopy') is not False
        defs = {}
        for key, val in (data.get('defaults') or {}).items() if isinstance(data.get('defaults'), dict) else []:
            k, v = str(key), str(val if val is not None else '').strip()[:500]
            if not self.DEF_RX.match(k) or not v:
                continue
            if k == 'kp.cur' and v not in self.CURS:
                raise ValueError('Валюта КП — рубли, доллары, евро или юани')
            defs[k] = v
            if len(defs) >= self.MAX_DEF:
                break
        prefs['defaults'] = defs
        prefs['updatedAt'] = datetime.now().isoformat(timespec='seconds')
        allp = self._all()
        allp[str(uid)[:64]] = prefs
        self.store.kv_set(self.KV_KEY, allp)
        return prefs
