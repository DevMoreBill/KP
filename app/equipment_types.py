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
    # повтор группы, внутри которой тоже повтор, — «катастрофический» перебор на длинной строке (браузер зависает)
    # повтор группы «(…)+», «(…)*», «(…){n,}» — основа «катастрофического» перебора ((a|a)+, (\d+\.?)+): не принимается;
    # «(…)?» и повторы отдельных знаков (\S*, \s+) — можно
    NESTED = re.compile(r'\)[+*]|\)\{\d*,')
    UNBOUNDED = re.compile(r'(?<!\\)[+*]|\{\d*,\}')
    UNBOUNDED_MAX = 12
    # повторы подряд в одной ветке («\d*\d*\d*…») — перебор растёт как длина строки в степени их числа: не больше 3
    BRANCH_MAX = 3
    BACKREF = re.compile(r'\\[1-9]|\\k<')

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

    @staticmethod
    def _branches(pattern: str) -> list[str]:
        """Варианты шаблона верхнего уровня (по «|» вне скобок)."""
        out: list[str] = []
        depth, cur, pos = 0, '', 0
        while pos < len(pattern):
            char = pattern[pos]
            if char == '\\':
                cur, pos = cur + pattern[pos : pos + 2], pos + 2
                continue
            depth += {'(': 1, ')': -1}.get(char, 0)
            if char == '|' and depth == 0:
                out, cur = [*out, cur], ''
            else:
                cur += char
            pos += 1
        return [*out, cur]

    @classmethod
    def _one(cls, pattern: str, where: str) -> None:
        if len(pattern) > cls.MAX:
            raise ValueError(f'«{where}»: шаблон длиннее {cls.MAX} знаков')
        if cls.NESTED.search(pattern) or cls.BACKREF.search(pattern):
            raise ValueError(
                f'«{where}»: повтор группы «(…)+» / «(…)*» или обратная ссылка могут «повесить» браузер — '
                'повторяйте отдельные знаки (\\S*, \\s+), а не группы'
            )
        if len(cls.UNBOUNDED.findall(pattern)) > cls.UNBOUNDED_MAX:
            raise ValueError(f'«{where}»: больше {cls.UNBOUNDED_MAX} повторов «+» и «*» — упростите шаблон')
        if any(len(cls.UNBOUNDED.findall(branch)) > cls.BRANCH_MAX for branch in cls._branches(pattern)):
            raise ValueError(
                f'«{where}»: больше {cls.BRANCH_MAX} повторов «+» и «*» в одном варианте (между «|») — разбейте его на варианты'
            )
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(f'«{where}»: ошибка в шаблоне ({exc})') from None
