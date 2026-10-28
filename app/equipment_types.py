"""Справочник типов оборудования: встроенный (app/equipment_types.json) + свои типы отдела (в базе)."""

import json
import os
import re

from config import APP_DIR, read_text, store


def types_builtin_path() -> str:
    return os.path.join(APP_DIR, 'equipment_types.json')


def load_types_builtin() -> list:
    try:
        return json.loads(read_text(types_builtin_path())).get('types', [])
    except Exception:
        return []


def load_types() -> dict:
    """Свой тип с тем же id дополняет встроенный, новые — в конец, «hidden» — скрыт."""
    base = load_types_builtin()
    user = (store().kv_get('types') or {}).get('types', [])
    out = [dict(item) for item in base]
    index = {item.get('id'): i for i, item in enumerate(out)}
    for item in user:
        if not isinstance(item, dict) or not item.get('id'):
            continue
        if item['id'] in index:
            merged = dict(out[index[item['id']]])
            merged.update(item)
            out[index[item['id']]] = merged
        else:
            index[item['id']] = len(out)
            out.append(item)
    return {'version': 1, 'types': [item for item in out if not item.get('hidden')]}


def save_user_types(body: bytes) -> None:
    data = json.loads(body.decode('utf-8'))
    if not isinstance(data, dict):
        raise ValueError('Ожидается {"types": [...]}')
    if isinstance(data.get('add'), list):
        # добавление к нынешним: категория, созданная коллегой минутой раньше, не теряется
        cur = (store().kv_get('types') or {}).get('types') or []
        add = {str(item.get('id')): item for item in data['add'] if isinstance(item, dict)}
        data = {
            'types': [item for item in cur if not (isinstance(item, dict) and str(item.get('id')) in add)]
            + list(add.values())
        }
    types = data.get('types')
    if not isinstance(types, list):
        raise ValueError('Ожидается {"types": [...]}')
    for item in types:
        if not isinstance(item, dict) or not re.match(r'^[a-z][a-z0-9_]{1,30}$', item.get('id') or ''):
            raise ValueError('У каждого типа нужен id: латиница, цифры и «_»')
        if not isinstance(item.get('fields', []), list):
            raise ValueError('fields должен быть списком')
    TypePatterns.check(types, (store().kv_get('types') or {}).get('types') or [])
    store().kv_set('types', {'version': 1, 'types': types})


class TypePatterns:
    """Шаблоны категорий (match) и полей (find) выполняются в браузере каждого: только безопасные выражения."""

    MAX = 300
    # перебор растёт как длина строки в степени числа повторов подряд («\d*\d*\d*…»), а повтор группы, внутри которой
    # тоже повтор, — «катастрофически» ((a|a)+, (\d+\.?)+, (?:\d*){6}): повтор группы не принимается вовсе, повторов
    # отдельных знаков («+», «*», «?», «{m,n}») — не больше 2 в варианте (между «|») и 8 во всём шаблоне
    UNBOUNDED_MAX = 8
    BRANCH_MAX = 2
    JS_ONLY = re.compile(r'(?<!\\)\[\^?\]')
    QUANT = re.compile(r'[*+?]|\{\d*(,\d*)?\}')
    BACKREF = re.compile(r'\\[1-9]|\\k<')

    @classmethod
    def check_patterns(cls, patterns: list[tuple[str, str]], allowed: set) -> None:
        """[(где, шаблон)] — новые (не из allowed) проверяются так же, как у категорий (нормы станций, серии)."""
        for where, pattern in patterns:
            if pattern not in allowed:
                cls._one(pattern, where)

    @classmethod
    def check(cls, types: list, saved: list) -> None:
        """ValueError с названием категории и поля — если новый шаблон длинный, с ошибкой или опасный (встроенные и уже
        сохранённые не проверяются: прежние настройки отдела сохраняются как были)."""
        builtin = set(cls._patterns(load_types_builtin())) | set(cls._patterns(saved))
        for item in types:
            for where, pattern in cls._own(item):
                if pattern not in builtin:
                    cls._one(pattern, where)

    @staticmethod
    def _own(item: dict) -> list[tuple[str, str]]:
        name = str(item.get('name') or item.get('id') or '')[:60]
        out = [(name, item['match'])] if isinstance(item.get('match'), str) and item['match'] else []
        for field in item.get('fields') or []:
            if isinstance(field, dict) and isinstance(field.get('find'), str) and field['find']:
                out.append((f'{name} → {str(field.get("label") or field.get("key") or "")[:60]}', field['find']))
        return out

    @classmethod
    def _patterns(cls, types: list) -> list[str]:
        return [pattern for item in types if isinstance(item, dict) for _where, pattern in cls._own(item)]

    @classmethod
    def _scan(cls, pattern: str) -> tuple[list[int], bool]:
        """Проход по шаблону: число повторов в каждом варианте верхнего уровня и есть ли повтор группы. Пары «\\x» и
        наборы «[…]» — один знак (их «*», «|», скобки не считаются)."""
        counts, depth, pos, prev, nested = [0], 0, 0, '', False
        while pos < len(pattern):
            char, quant = pattern[pos], cls.QUANT.match(pattern, pos)
            if quant and prev in ('atom', 'group'):
                nested = nested or (prev == 'group' and quant.group(0) != '?')  # «(…)?» — не больше одного раза
                counts[-1] += 1
                pos, prev = quant.end(), 'quant'
                pos += pattern[pos : pos + 1] == '?'  # ленивый повтор — тот же повтор
                continue
            step, prev = 1, 'atom'
            if char == '\\':
                step = 2
            elif char == '[':
                step = cls._class_end(pattern, pos) - pos
            elif char == '(':
                depth, prev = depth + 1, 'open'
                step += pattern[pos + 1 : pos + 2] == '?'  # (?: (?= (?! (?<…: «?» — не повтор
            elif char == ')':
                depth, prev = depth - 1, 'group'
            elif char == '|':
                prev = 'open'
                counts += [0] if depth == 0 else []
            pos += step
        return counts, nested

    @staticmethod
    def _class_end(pattern: str, start: int) -> int:
        """Позиция после «]», закрывающей набор «[…]» с позиции start — по правилам браузера (JS): первая «]» закрывает."""
        pos = start + 1
        while pos < len(pattern) and pattern[pos] != ']':
            pos += 2 if pattern[pos] == '\\' else 1
        return min(pos + 1, len(pattern))

    @classmethod
    def _one(cls, pattern: str, where: str) -> None:
        if len(pattern) > cls.MAX:
            raise ValueError(f'«{where}»: шаблон длиннее {cls.MAX} знаков')
        if cls.JS_ONLY.search(pattern):  # «[]», «[^]» в браузере и на сервере значат разное — проверка была бы неверной
            raise ValueError(f'«{where}»: пустой набор «[]» или «[^]» — запишите набор знаков явно')
        counts, nested = cls._scan(pattern)
        if nested or cls.BACKREF.search(pattern):
            raise ValueError(
                f'«{where}»: повтор группы «(…)+» / «(…){{n}}» или обратная ссылка могут «повесить» браузер — '
                'повторяйте отдельные знаки (\\S*, \\s+), а не группы'
            )
        if sum(counts) > cls.UNBOUNDED_MAX:
            raise ValueError(
                f'«{where}»: больше {cls.UNBOUNDED_MAX} повторов «+», «*», «?», «{{…}}» — упростите шаблон'
            )
        if max(counts) > cls.BRANCH_MAX:
            raise ValueError(
                f'«{where}»: больше {cls.BRANCH_MAX} повторов в одном варианте (между «|») — разбейте его на варианты'
            )
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(f'«{where}»: ошибка в шаблоне ({exc})') from None
