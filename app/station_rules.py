# -*- coding: utf-8 -*-
"""Инженерные правила модульных станций (МКС, ДЭС) — отдельный версионируемый файл, не в коде.

• Файл в поставке — app/web/rules/stations.json: {format: 'kp-station-rules', version, date, title, statuses, rules: [...],
  series: [...]}. Правило: id, group, title, value (число, таблица или параметры формулы), unit, source {doc, item, url},
  status — confirmed (подтверждено источником) / practice (отраслевая практика) / unconfirmed (требует подтверждения).
  series — данные производителей по сериям (поправки осушителей и фильтров, продувка), у каждой — источник.
• Администратор может загрузить свою версию файла (kv «stationRules»): структура проверяется, прежняя версия
  сохраняется (kv «stationRulesPrev»); «вернуть файл поставки» — удалить свою версию.
• Значения компоновки (матрица расстановки, проходы, отступы) правятся в «Настройках» таблицами — проверка LayoutValues.
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
            if rid in LayoutValues.IDS:
                LayoutValues.check(rid, r['value'])
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
        RuleShape.check(d, self.bundled())
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


class RuleShape:
    """правка значения правила в «Настройках» (или своя версия файла): значение — той же формы, что в файле поставки
    (число — число, таблица [[x, y]] — таблица, параметры — те же ключи); значения компоновки проверяет LayoutValues"""
    MAX = 1e9

    @classmethod
    def check(cls, d, bundled):
        base = {r['id']: r.get('value') for r in bundled.get('rules', [])}
        for r in d.get('rules', []):
            rid = r.get('id')
            if rid in base and rid not in LayoutValues.IDS:
                cls.same(base[rid], r.get('value'), 'Правило %s' % rid)
        return True

    @classmethod
    def table(cls, v):
        return isinstance(v, list) and len(v) > 0 and all(isinstance(x, list) and len(x) == 2 and all(cls.number(y) for y in x) for x in v)

    @staticmethod
    def number(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    @classmethod
    def same(cls, b, v, where):
        if isinstance(b, bool):
            if not isinstance(v, bool):
                raise ValueError(where + ': нужно «да» или «нет»')
        elif cls.number(b):
            if not cls.number(v) or v != v or abs(v) > cls.MAX:
                raise ValueError(where + ': нужно число')
        elif isinstance(b, str):
            if not isinstance(v, str) or len(v) > 500:
                raise ValueError(where + ': нужен текст до 500 знаков')
        elif cls.table(b):
            if not cls.table(v) or len(v) > 200:
                raise ValueError(where + ': нужна таблица из пар чисел (до 200 строк)')
        elif isinstance(b, list):
            if not isinstance(v, list) or len(v) != len(b):
                raise ValueError(where + ': нужен список из %d значений' % len(b))
            for i, (x, y) in enumerate(zip(b, v)):
                cls.same(x, y, '%s [%d]' % (where, i + 1))
        elif isinstance(b, dict):
            if not isinstance(v, dict) or set(v) != set(b):
                raise ValueError(where + ': набор параметров не совпадает с файлом поставки')
            for k in b:
                cls.same(b[k], v[k], '%s, %s' % (where, str(k)[:30]))


class LayoutValues:
    """значения компоновки станции: матрица расстановки (layout.matrix), проходы (norm.aisle, norm.aisle_tight), отступы
    (clear.kind) — правятся в «Настройках» таблицами; проверка: известные виды и ключи, числа в разумных пределах"""
    IDS = ('layout.matrix', 'norm.aisle', 'norm.aisle_tight', 'clear.kind')
    KINDS = ('compressor', 'dryer', 'receiver', 'filter', 'pump', 'dgu', 'cabinet', 'tank', 'other')
    GROUPS = ('gap', 'pair', 'wall', 'access', 'sides', 'rotate', 'gate', 'service', 'door', 'aisle', 'exits', 'exhaust',
              'fit', 'modes', 'recv', 'cab', 'move', 'tank', 'conv', 'muffler')
    MAX_MM = 20000
    # пределы чисел матрицы (те же — в форме «Настроек», LayoutParams в station-layout.js; тест сверяет)
    SCALAR = {
        'fit.dense': (0, 1),
        'fit.roadW': (2000, 3500),
        'fit.wide': (0, 1),
        'fit.maxL': (3000, 20000),
        'fit.minL': (1000, 6000),
        'fit.minW': (1000, 2550),
        'fit.maxW': (2550, 5000),
        'fit.minH': (1500, 3000),
        'fit.hWalk': (1900, 3000),
        'fit.maxH': (2400, 4000),
        'fit.step': (10, 500),
        'fit.two': (0, 60),
        'fit.recv2': (0, 5000),
        'fit.ends': (0, 60),
        'modes.ends': (0, 1),
        'modes.tight': (0, 1),
        'modes.cross': (0, 1),
        'modes.next': (600, 3000),
        'door.w': (900, 1000),
        'door.h': (2000, 2100),
        'door.gap': (0, 2000),
        'door.edge': (0, 2000),
        'door.pad': (0, 1000),
        'exits.n': (1, 4),
        'exits.dist': (0, 20000),
        'gate.addW': (0, 1000),
        'gate.minW': (800, 3000),
        'gate.full': (0.3, 1),
        'gate.addH': (0, 1000),
        'gate.minH': (1500, 3000),
        'gate.top': (0, 500),
        'gate.twoAt': (2000, 20000),
        'access.back': (0, 2000),
        'access.side': (300, 2000),
        'service.addW': (0, 1000),
        'service.min': (300, 2000),
        'service.max': (1000, 6000),
        'service.leaf': (300, 2000),
        'service.addH': (0, 1000),
        'service.minH': (300, 2500),
        'service.step': (10, 500),
        'service.wall': (0, 1),
        'aisle.service': (300, 2000),
        'gap.v': (0, 150),
        'move.pass': (0, 300),
        'recv.pairSide': (0, 1000),
        'recv.outGap': (300, 5000),
        'recv.outStep': (0, 3000),
        'recv.pad': (0, 500),
        'exhaust.louvre': (200, 1500),
        'exhaust.over': (0, 1000),
        'cab.top': (1200, 2500),
        'cab.low': (0, 1200),
        'tank.pad': (0, 1500),
        'tank.gap': (0, 1500),
        'tank.back': (0, 1000),
        'tank.aisle': (300, 2000),
        'tank.part': (50, 500),
        'tank.door': (600, 1500),
        'tank.fill': (300, 2000),
        'conv.z': (0, 1000),
        'conv.gap': (0, 2000),
        'conv.edge': (0, 1000),
        'conv.front': (0, 2000),
        'muffler.gap': (0, 1000),
        'muffler.outlet': (0, 1500),
    }

    @classmethod
    def num(cls, v, where, lo=0, hi=None):
        hi = cls.MAX_MM if hi is None else hi
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
            raise ValueError('%s: нужно число от %s до %s' % (where, lo, hi))
        return v

    @classmethod
    def kind(cls, v, where):
        if v not in cls.KINDS:
            raise ValueError('%s: неизвестный вид оборудования «%s»' % (where, str(v)[:30]))

    @classmethod
    def check(cls, rid, v):
        where = 'Правило %s' % rid
        if rid == 'norm.aisle':
            if not isinstance(v, list) or len(v) != 2:
                raise ValueError(where + ': нужны два числа — рекомендуемый и допустимый проход')
            a, b = (cls.num(x, where, 600, 3000) for x in v)
            if b > a:
                raise ValueError(where + ': допустимый проход больше рекомендуемого')
        elif rid == 'norm.aisle_tight':
            cls.num(v, where, 600, 3000)
        elif rid == 'clear.kind':
            cls.clear(v, where)
        else:
            cls.matrix(v, where)
        return True

    @classmethod
    def clear(cls, v, where):
        if not isinstance(v, dict) or not v:
            raise ValueError(where + ': нужны отступы по видам оборудования')
        for k, x in v.items():
            cls.kind(k, where)
            if not isinstance(x, dict):
                raise ValueError('%s, %s: не объект' % (where, k))
            for s, y in x.items():
                w = '%s, %s, %s' % (where, k, str(s)[:20])
                if isinstance(y, list):
                    if len(y) != 2:
                        raise ValueError(w + ': нужны два числа — рекомендуемый и допустимый')
                    a, b = (cls.num(z, w, 0, 5000) for z in y)
                    if b > a:
                        raise ValueError(w + ': допустимый больше рекомендуемого')
                else:
                    cls.num(y, w, 0, 5000)

    @classmethod
    def rows(cls, v, g, where):
        x = v.get(g)
        if x is None:
            return []
        r = x.get('rows') if isinstance(x, dict) else None
        if not isinstance(r, list) or len(r) > 100 or not all(isinstance(q, dict) for q in r):
            raise ValueError('%s, %s: нужен список строк' % (where, g))
        return r

    @classmethod
    def matrix(cls, v, where):
        if not isinstance(v, dict):
            raise ValueError(where + ': не объект')
        for g, x in v.items():
            if g not in cls.GROUPS:
                raise ValueError('%s: неизвестный раздел «%s»' % (where, str(g)[:30]))
            if not isinstance(x, dict):
                raise ValueError('%s, %s: не объект' % (where, g))
            t = x.get('t', '')
            if not isinstance(t, str) or len(t) > 500:
                raise ValueError('%s, %s: пояснение — текст до 500 знаков' % (where, g))
            if g not in ('pair', 'wall', 'sides', 'rotate'):
                for k, y in x.items():
                    if k != 't':
                        lo, hi = cls.SCALAR.get('%s.%s' % (g, k), (0, cls.MAX_MM))
                        cls.num(y, '%s, %s.%s' % (where, g, str(k)[:20]), lo, hi)
        for j, r in enumerate(cls.rows(v, 'pair', where)):
            w = '%s, пара %d' % (where, j + 1)
            cls.kind(r.get('a'), w)
            cls.kind(r.get('b'), w)
            base, k, mn = cls.num(r.get('base'), w + ', база', 0, 5000), cls.num(r.get('k', 0), w + ', коэффициент', 0, 3), cls.num(r.get('min'), w + ', не менее', 0, 5000)
            of = r.get('of', '')
            if of and (not isinstance(of, str) or of.split('.')[0] not in cls.KINDS or of.split('.')[-1] not in ('w', 'l', 'h')):
                raise ValueError(w + ': размер — «вид.w», «вид.l» или «вид.h»')
            if mn > base and not k:
                raise ValueError(w + ': «не менее» больше базы')
        for j, r in enumerate(cls.rows(v, 'wall', where)):
            w = '%s, стена %d' % (where, j + 1)
            cls.kind(r.get('kind'), w)
            cls.num(r.get('base'), w + ', база', 0, 5000)
            cls.num(r.get('k', 0), w + ', коэффициент', 0, 3)
            cls.num(r.get('tight'), w + ', плотно', 0, 5000)
        for j, r in enumerate(cls.rows(v, 'sides', where)):
            w = '%s, стороны %d' % (where, j + 1)
            cls.kind(r.get('kind'), w)
            if not isinstance(r.get('s'), str) or not re.match('^[ФЗЛП]{1,4}$', r['s']):
                raise ValueError(w + ': стороны — буквы Ф, З, Л, П')
            for f in ('door', 'tilt'):
                if f in r and not isinstance(r[f], bool):
                    raise ValueError(w + ': отметка «%s» — да или нет' % f)
        for j, r in enumerate(cls.rows(v, 'rotate', where)):
            cls.kind(r.get('kind'), '%s, поворот %d' % (where, j + 1))
        d = v.get('door') or {}
        if 'w' in d:
            cls.num(d['w'], where + ', ширина двери', *cls.SCALAR['door.w'])
        if 'h' in d:
            cls.num(d['h'], where + ', высота двери', *cls.SCALAR['door.h'])
        s = v.get('service') or {}
        if isinstance(s.get('min'), (int, float)) and isinstance(s.get('max'), (int, float)) and s['min'] > s['max']:
            raise ValueError(where + ': сервисные ворота — «не меньше» больше «не больше»')
