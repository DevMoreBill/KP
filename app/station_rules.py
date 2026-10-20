"""Инженерные правила станций (app/web/rules/stations.json) и своя версия администратора с проверкой значений."""

import json
import math
import os
import re
from datetime import datetime

from config import APP_DIR


class StationRules:
    PATH = os.path.join(APP_DIR, 'web', 'rules', 'stations.json')
    STATUSES = ('confirmed', 'practice', 'unconfirmed')
    FORMAT = 'kp-station-rules'
    ID_RE = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$')
    MAX_BYTES = 2 * 1024 * 1024
    KV_KEY, KV_PREV = 'stationRules', 'stationRulesPrev'

    def __init__(self, store=None) -> None:
        self.store = store

    @classmethod
    def bundled(cls) -> dict:
        with open(cls.PATH, encoding='utf-8') as handle:
            return json.load(handle)

    def own(self) -> dict | None:
        """своя версия администратора или None"""
        data = self.store.kv_get(self.KV_KEY) if self.store is not None else None
        return data if isinstance(data, dict) and data.get('rules') else None

    def current(self) -> dict:
        """действующие правила: своя версия администратора (если исправна), иначе файл поставки."""
        data = self.own()
        if data:
            try:
                self.validate(data)
                return self.complete(data)
            except ValueError:
                pass
        return self.bundled()

    @classmethod
    def complete(cls, data) -> dict:
        """своя версия + правила поставки, которых в ней нет (копия, своя версия в базе не меняется)"""
        have = {rule.get('id') for rule in data['rules']}
        miss = [rule for rule in cls.bundled()['rules'] if rule.get('id') not in have]
        return dict(data, rules=data['rules'] + miss) if miss else data

    @classmethod
    def validate(cls, data) -> bool:
        """структура файла правил; ValueError — понятным текстом"""
        if not isinstance(data, dict) or data.get('format') != cls.FORMAT:
            raise ValueError(f'Это не файл правил станций (нужен format «{cls.FORMAT}»)')
        if not isinstance(data.get('version'), str) or not data['version'].strip() or len(data['version']) > 40:
            raise ValueError('Не указана версия правил')
        rules = data.get('rules')
        if not isinstance(rules, list) or not rules or len(rules) > 2000:
            raise ValueError('Нет списка правил')
        seen = set()
        for i, rule in enumerate(rules):
            where = f'правило {i + 1}'
            if not isinstance(rule, dict):
                raise ValueError(where + ': не объект')
            rid = rule.get('id')
            if not isinstance(rid, str) or not cls.ID_RE.match(rid):
                raise ValueError(where + ': неверный идентификатор')
            if rid in seen:
                raise ValueError(f'Правило {rid} повторяется')
            seen.add(rid)
            if not isinstance(rule.get('title'), str) or not rule['title'].strip():
                raise ValueError(f'Правило {rid}: нет названия')
            if 'value' not in rule:
                raise ValueError(f'Правило {rid}: нет значения')
            if rule.get('status') not in cls.STATUSES:
                raise ValueError(f'Правило {rid}: статус — confirmed, practice или unconfirmed')
            src = rule.get('source')
            if not isinstance(src, dict) or not isinstance(src.get('doc'), str) or not src['doc'].strip():
                raise ValueError(f'Правило {rid}: не указан источник')
            if rid in LayoutValues.IDS:
                LayoutValues.check(rid, rule['value'])
        series = data.get('series', [])
        if not isinstance(series, list):
            raise ValueError('Раздел series — список')
        for i, src in enumerate(series):
            if (
                not isinstance(src, dict)
                or not src.get('maker')
                or not src.get('match')
                or not isinstance(src.get('source'), dict)
                or not src['source'].get('doc')
            ):
                raise ValueError(f'Серия {i + 1}: нужны maker, match и source.doc')
            try:
                re.compile(str(src['match']))
            except re.error:
                raise ValueError(f'Серия {i + 1}: неверное выражение match') from None
        return True

    def save(self, raw, author: str = '') -> dict:
        """своя версия администратора (байты JSON); прежняя — в kv «stationRulesPrev». → кратко о версии"""
        if not raw or len(raw) > self.MAX_BYTES:
            raise ValueError('Файл пустой или больше 2 МБ')
        try:
            data = json.loads(raw.decode('utf-8-sig') if isinstance(raw, bytes) else raw)
        except ValueError:
            raise ValueError('Файл не читается как JSON') from None
        self.validate(data)
        RuleShape.check(data, self.bundled())
        old = self.own()
        if old:
            self.store.kv_set(self.KV_PREV, old)
        data['_saved'] = {'at': datetime.now().isoformat(timespec='seconds'), 'by': str(author or '')[:120]}
        self.store.kv_set(self.KV_KEY, data)
        return self.info()

    def reset(self) -> dict:
        """вернуть файл поставки"""
        old = self.own()
        if old:
            self.store.kv_set(self.KV_PREV, old)
        self.store.kv_set(self.KV_KEY, None)
        return self.info()

    def layout_defaults(self) -> dict:
        """значения правил компоновки из файла поставки ({id: значение}) — для «Все значения — по умолчанию» в «Настройках»"""
        return {rule['id']: rule.get('value') for rule in self.bundled()['rules'] if rule.get('id') in LayoutValues.IDS}

    def info(self) -> dict:
        data, builtin = self.current(), self.bundled()
        own = self.own()
        cnt = {k: sum(1 for rule in data['rules'] if rule.get('status') == k) for k in self.STATUSES}
        return {
            'version': data.get('version'),
            'date': data.get('date'),
            'own': bool(own),
            'saved': (own or {}).get('_saved'),
            'bundled': builtin.get('version'),
            'rules': len(data['rules']),
            'series': len(data.get('series') or []),
            'byStatus': cnt,
        }

    def json_text(self) -> str:
        """скрипт для браузера: StationRules.use({...}) — до модулей расчёта станций"""
        body = json.dumps(self.current(), ensure_ascii=False).replace('</', '<\\/')
        return f'StationRules.use({body});\n'


class RuleShape:
    """Значение правила при правке — той же формы, что в файле поставки (число, таблица, те же ключи)."""

    MAX = 1e9

    @classmethod
    def check(cls, data, bundled) -> bool:
        base = {rule['id']: rule.get('value') for rule in bundled.get('rules', [])}
        for rule in data.get('rules', []):
            rid = rule.get('id')
            if rid in base and rid not in LayoutValues.IDS:
                cls.same(base[rid], rule.get('value'), f'Правило {rid}')
        return True

    @classmethod
    def table(cls, v) -> bool:
        return (
            isinstance(v, list)
            and len(v) > 0
            and all(isinstance(x, list) and len(x) == 2 and all(cls.number(y) for y in x) for x in v)
        )

    @staticmethod
    def number(v) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    @classmethod
    def same(cls, other, v, where) -> None:
        if isinstance(other, bool):
            if not isinstance(v, bool):
                raise ValueError(where + ': нужно «да» или «нет»')
        elif cls.number(other):
            if not cls.number(v) or math.isnan(v) or abs(v) > cls.MAX:
                raise ValueError(where + ': нужно число')
        elif isinstance(other, str):
            if not isinstance(v, str) or len(v) > 500:
                raise ValueError(where + ': нужен текст до 500 знаков')
        elif cls.table(other):
            if not cls.table(v) or len(v) > 200:
                raise ValueError(where + ': нужна таблица из пар чисел (до 200 строк)')
        elif isinstance(other, list):
            if not isinstance(v, list) or len(v) != len(other):
                raise ValueError(where + f': нужен список из {len(other)} значений')
            for i, (x, y) in enumerate(zip(other, v, strict=False)):
                cls.same(x, y, f'{where} [{i + 1}]')
        elif isinstance(other, dict):
            if not isinstance(v, dict) or set(v) != set(other):
                raise ValueError(where + ': набор параметров не совпадает с файлом поставки')
            for k in other:
                cls.same(other[k], v[k], f'{where}, {str(k)[:30]}')


class LayoutValues:
    """Значения компоновки (layout.matrix, проходы, отступы): известные виды и ключи, числа в разумных пределах."""

    IDS = ('layout.matrix', 'norm.aisle', 'norm.aisle_tight', 'clear.kind')
    KINDS = ('compressor', 'dryer', 'receiver', 'filter', 'pump', 'dgu', 'cabinet', 'tank', 'other')
    GROUPS = (
        'gap',
        'pair',
        'wall',
        'access',
        'sides',
        'rotate',
        'gate',
        'service',
        'door',
        'aisle',
        'exits',
        'exhaust',
        'fit',
        'modes',
        'recv',
        'cab',
        'move',
        'tank',
        'conv',
        'dgu',
        'mods',
        'look',
        'muffler',
        'shell',
        'pick',
        'pipe',
        'pumps',
        'grille',
        'mass',
        'light',
        'fire',
        'power',
    )
    MAX_MM = 20000
    # пределы — те же, что в LayoutParams (layout-params.js); тест сверяет
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
        'exits.dist': (0, 20000),
        'exits.far': (2000, 30000),
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
        'recv.pairWall': (0, 600),
        'recv.upright': (0, 1),
        'recv.close': (0, 1),
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
        'tank.gates': (0, 1),
        'tank.top': (100, 1500),
        'tank.wMax': (500, 3500),
        'tank.h1': (500, 2500),
        'tank.h2': (500, 2500),
        'tank.big': (200, 20000),
        'tank.w1': (300, 2000),
        'tank.w2': (300, 2000),
        'tank.step': (10, 500),
        'tank.wall': (1, 20),
        'mods.max': (2, 30),
        'mods.post': (0, 600),
        'mods.wMin': (1500, 2550),
        'mods.wMax': (1500, 2550),
        'mods.lMin': (2000, 12000),
        'look.align': (0, 1500),
        'look.even': (0, 1),
        'look.lines': (0, 1),
        'look.modStep': (0, 5),
        'look.tidy': (0, 1),
        'dgu.rad': (0, 1000),
        'dgu.pass': (200, 1500),
        'dgu.rot': (0, 1),
        'dgu.two': (0, 1),
        'dgu.across': (2, 10),
        'dgu.convGap': (0, 2000),
        'dgu.convEdge': (0, 1000),
        'dgu.convFront': (0, 2000),
        'conv.z': (0, 1000),
        'conv.gap': (0, 2000),
        'conv.edge': (0, 1000),
        'conv.front': (0, 2000),
        'muffler.gap': (0, 1000),
        'muffler.outlet': (0, 1500),
        # прочие числа станции — тоже правятся в «Настройках»
        'fit.growVent': (0, 6000),
        'fit.growHeat': (0, 3000),
        'tank.max': (500, 20000),
        'pick.max': (1, 8),
        'pick.over': (0, 100),
        'pick.recvFit': (0, 1000),
        'pick.dryerFit': (0, 1000),
        'pick.recvFree': (1, 20),
        'pick.recvAny': (1, 20),
        'pick.oneSup': (0, 50),
        'shell.ins': (0, 300),
        'shell.blockWall': (0, 200),
        'shell.blockFloor': (50, 500),
        'shell.blockRoof': (0, 300),
        'shell.weldWall': (0, 200),
        'shell.weldFloor': (50, 500),
        'shell.weldRoof': (0, 300),
        'shell.northWall': (0, 200),
        'shell.northFloor': (50, 500),
        'shell.northRoof': (0, 300),
        'shell.tambour': (0, 3000),
        'shell.seaLining': (0, 100),
        'shell.seaFloor': (0, 300),
        'shell.gable': (0, 30),
        'shell.mono': (0, 30),
        'pipe.airY': (50, 600),
        'pipe.pad': (0, 300),
        'pipe.outGap': (0, 1000),
        'pipe.outEdge': (100, 2000),
        'pipe.flange': (50, 500),
        'pumps.kw': (0, 200),
        'pumps.len': (300, 3000),
        'pumps.back': (0, 2000),
        'pumps.backMin': (0, 2000),
        'pumps.side': (0, 2000),
        'pumps.sideMin': (0, 2000),
        'pumps.top': (0, 2000),
        'pumps.topMin': (0, 2000),
        'grille.step': (10, 200),
        'grille.gap': (0, 1000),
        'grille.near': (0, 2000),
        'grille.inZ': (0, 1500),
        'grille.inHmin': (100, 2000),
        'grille.inHmax': (200, 2500),
        'grille.inWmin': (100, 2000),
        'grille.inWmax': (200, 3000),
        'grille.lift': (0, 2000),
        'grille.outTop': (0, 1000),
        'grille.outHmin': (100, 2000),
        'grille.outHmax': (200, 2500),
        'grille.outWmin': (100, 2000),
        'grille.outWmax': (200, 3000),
        'grille.whole': (500, 6000),
        'grille.maxn': (1, 12),
        'grille.piece': (100, 2000),
        'grille.fanMin': (200, 1500),
        'grille.roofHood': (100, 1500),
        'grille.hoodSide': (0, 500),
        'grille.hoodLap': (0, 300),
        'grille.hoodAng0': (5, 60),
        'grille.hoodAng1': (30, 90),
        'grille.hoodLow': (0, 1000),
        'grille.hoodGap': (0, 1500),
        'grille.radV': (2, 20),
        'mass.frame': (0, 1000),
        'mass.pBlock': (0, 200),
        'mass.pNorth': (0, 200),
        'mass.pWelded': (0, 200),
        'mass.lining': (0, 100),
        'mass.floor': (0, 300),
        'mass.otherK': (0, 0.5),
        'mass.otherKg': (0, 2000),
        'mass.tare10': (500, 5000),
        'mass.tare20': (1000, 6000),
        'mass.tare20hc': (1000, 6000),
        'mass.tare40': (2000, 8000),
        'mass.tare40hc': (2000, 8000),
        'mass.angle': (10, 60),
        'mass.lugL': (0, 1000),
        'mass.lugW': (0, 1000),
        'mass.beamL': (2000, 20000),
        'mass.beamZ': (500, 6000),
        'mass.beamTop': (500, 6000),
        'mass.sprZ': (500, 6000),
        'mass.sprD': (0, 6000),
        'mass.sprTop': (500, 6000),
        'light.plane': (0, 1500),
        'light.lampW': (1, 500),
        'light.lampLm': (100, 50000),
        'light.lampLen': (100, 3000),
        'light.small': (1, 200),
        'light.flood': (1, 500),
        'light.exit': (0, 50),
        'light.fuelPump': (0.1, 50),
        'fire.modArea': (1, 100),
        'fire.modVolA': (1, 200),
        'fire.modVolB': (1, 200),
        'fire.modSide': (500, 10000),
        'fire.modZ0': (1000, 6000),
        'fire.modZ1': (1000, 10000),
        'fire.k1': (0.5, 3),
        'fire.k3': (0.5, 3),
        'fire.k4': (0.5, 3),
        'fire.shadeH': (0, 3000),
        'fire.shadeGap': (0, 2000),
        'fire.ext': (500, 2500),
        'power.dryerK': (0, 2),
        'power.dryerMin': (0, 20),
        'power.dryerAds': (0, 20),
        'power.dguHeat': (0, 20),
        'power.dguHeatBig': (0, 30),
        'power.dguHeatKw': (10, 5000),
        'power.charger': (0, 5),
        'power.fuelPumpKw': (0, 10),
        'power.s230': (0, 20),
        'power.s230k': (0, 1),
        'power.s380': (0, 50),
        'power.s380k': (0, 1),
        'power.ytp': (0, 5),
        'power.ytpK': (0, 1),
        'power.valves': (0, 5),
        'power.ops': (0, 5),
        'power.asu': (0, 10),
        'power.sockStep': (1000, 20000),
        'power.sockMin': (1, 10),
        'power.sock380': (0, 10),
        'power.sockZ': (300, 2000),
    }

    @classmethod
    def num(cls, v, where, low=0, high=None) -> float:
        high = cls.MAX_MM if high is None else high
        if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v) or not low <= v <= high:
            raise ValueError(f'{where}: нужно число от {low} до {high}')
        return v

    @classmethod
    def kind(cls, v, where) -> None:
        if v not in cls.KINDS:
            raise ValueError(f'{where}: неизвестный вид оборудования «{str(v)[:30]}»')

    @classmethod
    def check(cls, rid, v) -> bool:
        where = f'Правило {rid}'
        if rid == 'norm.aisle':
            if not isinstance(v, list) or len(v) != 2:
                raise ValueError(where + ': нужны два числа — рекомендуемый и допустимый проход')
            first, second = (cls.num(x, where, 600, 3000) for x in v)
            if second > first:
                raise ValueError(where + ': допустимый проход больше рекомендуемого')
        elif rid == 'norm.aisle_tight':
            cls.num(v, where, 600, 3000)
        elif rid == 'clear.kind':
            cls.clear(v, where)
        else:
            cls.matrix(v, where)
        return True

    @classmethod
    def clear(cls, v, where) -> None:
        if not isinstance(v, dict) or not v:
            raise ValueError(where + ': нужны отступы по видам оборудования')
        for k, x in v.items():
            cls.kind(k, where)
            if not isinstance(x, dict):
                raise ValueError(f'{where}, {k}: не объект')
            for val, y in x.items():
                where_text = f'{where}, {k}, {str(val)[:20]}'
                if isinstance(y, list):
                    if len(y) != 2:
                        raise ValueError(where_text + ': нужны два числа — рекомендуемый и допустимый')
                    first, second = (cls.num(z, where_text, 0, 5000) for z in y)
                    if second > first:
                        raise ValueError(where_text + ': допустимый больше рекомендуемого')
                else:
                    cls.num(y, where_text, 0, 5000)

    @classmethod
    def rows(cls, v, group, where) -> list:
        x = v.get(group)
        if x is None:
            return []
        rows_raw = x.get('rows') if isinstance(x, dict) else None
        if not isinstance(rows_raw, list) or len(rows_raw) > 100 or not all(isinstance(row, dict) for row in rows_raw):
            raise ValueError(f'{where}, {group}: нужен список строк')
        return rows_raw

    @classmethod
    def matrix(cls, v, where) -> None:
        if not isinstance(v, dict):
            raise ValueError(where + ': не объект')
        for group, x in v.items():
            if group not in cls.GROUPS:
                raise ValueError(f'{where}: неизвестный раздел «{str(group)[:30]}»')
            if not isinstance(x, dict):
                raise ValueError(f'{where}, {group}: не объект')
            text = x.get('t', '')
            if not isinstance(text, str) or len(text) > 500:
                raise ValueError(f'{where}, {group}: пояснение — текст до 500 знаков')
            if group not in ('pair', 'wall', 'sides', 'rotate'):
                for k, y in x.items():
                    if k != 't':
                        low, high = cls.SCALAR.get(f'{group}.{k}', (0, cls.MAX_MM))
                        cls.num(y, f'{where}, {group}.{str(k)[:20]}', low, high)
        for j, row in enumerate(cls.rows(v, 'pair', where)):
            where_text = f'{where}, пара {j + 1}'
            cls.kind(row.get('a'), where_text)
            cls.kind(row.get('b'), where_text)
            base, k, minimum = (
                cls.num(row.get('base'), where_text + ', база', 0, 5000),
                cls.num(row.get('k', 0), where_text + ', коэффициент', 0, 3),
                cls.num(row.get('min'), where_text + ', не менее', 0, 5000),
            )
            of = row.get('of', '')
            if of and (
                not isinstance(of, str) or of.split('.')[0] not in cls.KINDS or of.split('.')[-1] not in ('w', 'l', 'h')
            ):
                raise ValueError(where_text + ': размер — «вид.w», «вид.l» или «вид.h»')
            if minimum > base and not k:
                raise ValueError(where_text + ': «не менее» больше базы')
        for j, row in enumerate(cls.rows(v, 'wall', where)):
            where_text = f'{where}, стена {j + 1}'
            cls.kind(row.get('kind'), where_text)
            cls.num(row.get('base'), where_text + ', база', 0, 5000)
            cls.num(row.get('k', 0), where_text + ', коэффициент', 0, 3)
            cls.num(row.get('tight'), where_text + ', плотно', 0, 5000)
        for j, row in enumerate(cls.rows(v, 'sides', where)):
            where_text = f'{where}, стороны {j + 1}'
            cls.kind(row.get('kind'), where_text)
            if not isinstance(row.get('s'), str) or not re.match('^[ФЗЛП]{1,4}$', row['s']):
                raise ValueError(where_text + ': стороны — буквы Ф, З, Л, П')
            for field in ('door', 'tilt'):
                if field in row and not isinstance(row[field], bool):
                    raise ValueError(where_text + f': отметка «{field}» — да или нет')
        for j, row in enumerate(cls.rows(v, 'rotate', where)):
            cls.kind(row.get('kind'), f'{where}, поворот {j + 1}')
        door = v.get('door') or {}
        if 'w' in door:
            cls.num(door['w'], where + ', ширина двери', *cls.SCALAR['door.w'])
        if 'h' in door:
            cls.num(door['h'], where + ', высота двери', *cls.SCALAR['door.h'])
        service = v.get('service') or {}
        if (
            isinstance(service.get('min'), (int, float))
            and isinstance(service.get('max'), (int, float))
            and service['min'] > service['max']
        ):
            raise ValueError(where + ': сервисные ворота — «не меньше» больше «не больше»')
