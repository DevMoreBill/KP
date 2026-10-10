# -*- coding: utf-8 -*-
"""Личные настройки менеджера: хранятся на сервере (kv userPrefs: {id менеджера: {…}}) и действуют на любом компьютере,
где он работает. Общие правила отдела задаёт администратор («Настройки → Умолчания»); здесь — только своё:
тема, стартовый экран, шаблон КП, свои значения для новых КП (город, валюта, условия), подпись и копия в письмах.
"""
import re
from datetime import datetime


class UserPrefs:
    KV = 'userPrefs'
    THEMES = ('auto', 'light', 'dark')
    STARTS = ('auto', 'myday', 'catalog', 'journal', 'none')
    # свои значения для новых КП — только эти умолчания (НДС, округление и экономику сделки задаёт отдел)
    DEF_RX = re.compile(r'^(kp\.city|kp\.cur|cond\.[^.]{1,60})$')
    CURS = ('RUB', 'USD', 'EUR', 'CNY')
    MAX_TEXT = 2000
    MAX_DEF = 40

    def __init__(self, store):
        self.store = store

    def _all(self):
        v = self.store.kv_get(self.KV)
        return v if isinstance(v, dict) else {}

    def get(self, uid):
        return dict(self._all().get(str(uid)) or {})

    def save(self, uid, d, by=''):
        """Записать личные настройки (только известные поля, с проверкой). ValueError — понятным текстом."""
        if not uid:
            raise ValueError('Сначала выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера')
        if not isinstance(d, dict):
            raise ValueError('Нет настроек')
        p = {}
        if d.get('theme') in self.THEMES:
            p['theme'] = d['theme']
        if d.get('start') in self.STARTS:
            p['start'] = d['start']
        tpl = str(d.get('template') or '').strip()
        if tpl:
            if not re.match(r'^[A-Za-z0-9_-]{1,64}$', tpl):
                raise ValueError('Неверный шаблон')
            p['template'] = tpl
        p['mailSign'] = str(d.get('mailSign') or '')[:self.MAX_TEXT]
        p['mailCopy'] = d.get('mailCopy') is not False
        defs = {}
        for k, v in (d.get('defaults') or {}).items() if isinstance(d.get('defaults'), dict) else []:
            k, v = str(k), str(v if v is not None else '').strip()[:500]
            if not self.DEF_RX.match(k) or not v:
                continue
            if k == 'kp.cur' and v not in self.CURS:
                raise ValueError('Валюта КП — рубли, доллары, евро или юани')
            defs[k] = v
            if len(defs) >= self.MAX_DEF:
                break
        p['defaults'] = defs
        p['updatedAt'] = datetime.now().isoformat(timespec='seconds')
        allp = self._all()
        allp[str(uid)[:64]] = p
        self.store.kv_set(self.KV, allp)
        return p
