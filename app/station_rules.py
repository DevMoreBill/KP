# -*- coding: utf-8 -*-
"""Инженерные правила модульных станций (МКС, ДЭС) — отдельный версионируемый файл, не в коде.

• Файл в поставке — app/web/rules/stations.json: {format: 'kp-station-rules', version, date, title, statuses, rules: [...],
  series: [...]}. Правило: id, group, title, value (число, таблица или параметры формулы), unit, source {doc, item, url},
  status — confirmed (подтверждено источником) / practice (отраслевая практика) / unconfirmed (требует подтверждения).
  series — данные производителей по сериям (поправки осушителей и фильтров, продувка), у каждой — источник.
• Администратор может загрузить свою версию файла (kv «stationRules»): структура проверяется, прежняя версия
  сохраняется (kv «stationRulesPrev»); «вернуть файл поставки» — удалить свою версию.
• Браузер получает правила скриптом /api/rules/stations.js (StationRules.use(...)) — до модулей расчёта станций.
"""
import json
import os
import re
from datetime import datetime

from config import APP_DIR


class StationRules:
    PATH = os.path.join(APP_DIR, 'web', 'rules', 'stations.json')
    STATUSES = ('confirmed', 'practice', 'unconfirmed')
    FORMAT = 'kp-station-rules'
    ID = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$')
    MAX_BYTES = 2 * 1024 * 1024
    KV, KV_PREV = 'stationRules', 'stationRulesPrev'

    def __init__(self, store=None):
        self.store = store

    @classmethod
    def bundled(cls):
        with open(cls.PATH, encoding='utf-8') as f:
            return json.load(f)

    def own(self):
        """своя версия администратора или None"""
        d = self.store.kv_get(self.KV) if self.store is not None else None
        return d if isinstance(d, dict) and d.get('rules') else None

    def current(self):
        """действующие правила: своя версия администратора (если исправна), иначе файл поставки"""
        d = self.own()
        if d:
            try:
                self.validate(d)
                return d
            except ValueError:
                pass
        return self.bundled()

    @classmethod
    def validate(cls, d):
        """структура файла правил; ValueError — понятным текстом"""
        if not isinstance(d, dict) or d.get('format') != cls.FORMAT:
            raise ValueError('Это не файл правил станций (нужен format «%s»)' % cls.FORMAT)
        if not isinstance(d.get('version'), str) or not d['version'].strip() or len(d['version']) > 40:
            raise ValueError('Не указана версия правил')
        rules = d.get('rules')
        if not isinstance(rules, list) or not rules or len(rules) > 2000:
            raise ValueError('Нет списка правил')
        seen = set()
        for i, r in enumerate(rules):
            where = 'правило %d' % (i + 1)
            if not isinstance(r, dict):
                raise ValueError(where + ': не объект')
            rid = r.get('id')
            if not isinstance(rid, str) or not cls.ID.match(rid):
                raise ValueError(where + ': неверный идентификатор')
            if rid in seen:
                raise ValueError('Правило %s повторяется' % rid)
            seen.add(rid)
            if not isinstance(r.get('title'), str) or not r['title'].strip():
                raise ValueError('Правило %s: нет названия' % rid)
            if 'value' not in r:
                raise ValueError('Правило %s: нет значения' % rid)
            if r.get('status') not in cls.STATUSES:
                raise ValueError('Правило %s: статус — confirmed, practice или unconfirmed' % rid)
            s = r.get('source')
            if not isinstance(s, dict) or not isinstance(s.get('doc'), str) or not s['doc'].strip():
                raise ValueError('Правило %s: не указан источник' % rid)
        series = d.get('series', [])
        if not isinstance(series, list):
            raise ValueError('Раздел series — список')
        for i, s in enumerate(series):
            if not isinstance(s, dict) or not s.get('maker') or not s.get('match') or not isinstance(s.get('source'), dict) or not s['source'].get('doc'):
                raise ValueError('Серия %d: нужны maker, match и source.doc' % (i + 1))
            try:
                re.compile(str(s['match']))
            except re.error:
                raise ValueError('Серия %d: неверное выражение match' % (i + 1))
        return True

    def save(self, raw, by=''):
        """своя версия администратора (байты JSON); прежняя — в kv «stationRulesPrev». → кратко о версии"""
        if not raw or len(raw) > self.MAX_BYTES:
            raise ValueError('Файл пустой или больше 2 МБ')
        try:
            d = json.loads(raw.decode('utf-8-sig') if isinstance(raw, bytes) else raw)
        except ValueError:
            raise ValueError('Файл не читается как JSON')
        self.validate(d)
        old = self.own()
        if old:
            self.store.kv_set(self.KV_PREV, old)
        d['_saved'] = {'at': datetime.now().isoformat(timespec='seconds'), 'by': str(by or '')[:120]}
        self.store.kv_set(self.KV, d)
        return self.info()

    def reset(self):
        """вернуть файл поставки"""
        old = self.own()
        if old:
            self.store.kv_set(self.KV_PREV, old)
        self.store.kv_set(self.KV, None)
        return self.info()

    def info(self):
        d, b = self.current(), self.bundled()
        own = self.own()
        cnt = {k: sum(1 for r in d['rules'] if r.get('status') == k) for k in self.STATUSES}
        return {'version': d.get('version'), 'date': d.get('date'), 'own': bool(own), 'saved': (own or {}).get('_saved'),
                'bundled': b.get('version'), 'rules': len(d['rules']), 'series': len(d.get('series') or []), 'byStatus': cnt}

    def js(self):
        """скрипт для браузера: StationRules.use({...}) — до модулей расчёта станций"""
        body = json.dumps(self.current(), ensure_ascii=False).replace('</', '<\\/')
        return 'StationRules.use(%s);\n' % body
