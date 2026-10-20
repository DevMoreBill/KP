"""Чистый код в переписанном Python (решение владельца 20.10): говорящие имена не короче 3 знаков, кроме словаря
исключений («names» в tests/code_style.json: переменные, параметры, функции, классы, атрибуты self), и без логических
флагов в параметрах («flags»: вариант — отдельным методом или объектом-перечислением).
"""

import ast
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = frozenset(
    [
        'i',
        'j',
        'k',
        'x',
        'y',
        'z',
        'x0',
        'x1',
        'x2',
        'y0',
        'y1',
        'y2',
        'z0',
        'z1',
        'z2',
        'dx',
        'dy',
        'dz',
        'id',
        'ok',
        'kw',
        'el',
        'db',
        'of',
        '_',
        'ox',
        'oy',
        'Li',
        'Wi',
        'Hi',
        'Le',
        'We',
        'He',
        'u',
        'v',
    ]
)
MIN = 3


class NameScan(ast.NodeVisitor):
    """Короткие имена в одном модуле: (строка, имя)."""

    def __init__(self) -> None:
        self.found: list[tuple[int, str]] = []

    def _check(self, line: int, name: str) -> None:
        if len(name.lstrip('_')) < MIN and name not in ALLOWED and name.lstrip('_') not in ALLOWED and name != '__':
            self.found.append((line, name))

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._check(node.lineno, node.name)
        args = node.args
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs, args.vararg, args.kwarg]:
            if arg is not None:
                self._check(arg.lineno, arg.arg)
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node: ast.Lambda) -> None:
        for arg in node.args.args:
            self._check(arg.lineno, arg.arg)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._check(node.lineno, node.name)
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Store):
            self._check(node.lineno, node.id)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if isinstance(node.ctx, ast.Store) and isinstance(node.value, ast.Name) and node.value.id in ('self', 'cls'):
            self._check(node.lineno, node.attr)
        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.name:
            self._check(node.lineno, node.name)
        self.generic_visit(node)

    def visit_alias(self, node: ast.alias) -> None:
        if node.asname:
            self._check(node.lineno, node.asname)


class FlagScan(ast.NodeVisitor):
    """Параметры-флаги в одном модуле: значение True/False по умолчанию или тип bool → (строка, функция.параметр)."""

    def __init__(self) -> None:
        self.found: list[tuple[int, str]] = []

    @staticmethod
    def _is_flag(arg: ast.arg, default: ast.expr | None) -> bool:
        by_default = isinstance(default, ast.Constant) and isinstance(default.value, bool)
        by_type = arg.annotation is not None and ast.unparse(arg.annotation) == 'bool'
        return by_default or by_type

    def visit_FunctionDef(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        args = node.args
        positional = [*args.posonlyargs, *args.args]
        defaults: list[ast.expr | None] = [None] * (len(positional) - len(args.defaults))
        pairs = [
            *zip(positional, [*defaults, *args.defaults], strict=True),
            *zip(args.kwonlyargs, args.kw_defaults, strict=True),
        ]
        self.found += [(arg.lineno, f'{node.name}.{arg.arg}') for arg, default in pairs if self._is_flag(arg, default)]
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef


def flags(path: Path) -> list[tuple[int, str]]:
    """Параметры-флаги файла."""
    scanner = FlagScan()
    scanner.visit(ast.parse(path.read_text(encoding='utf-8')))
    return scanner.found


def scan(path: Path) -> list[tuple[int, str]]:
    """Короткие имена файла."""
    scanner = NameScan()
    scanner.visit(ast.parse(path.read_text(encoding='utf-8')))
    return scanner.found


class NamesTest(unittest.TestCase):
    def test_names(self) -> None:
        modules = json.loads((ROOT / 'tests' / 'code_style.json').read_text(encoding='utf-8')).get('names', [])
        bad = [f'{name}:{line} «{short}»' for name in modules for line, short in scan(ROOT / name)]
        self.assertEqual(bad, [], 'короткие имена:\n' + '\n'.join(bad[:50]))

    def test_flags(self) -> None:
        modules = json.loads((ROOT / 'tests' / 'code_style.json').read_text(encoding='utf-8')).get('flags', [])
        bad = [f'{name}:{line} «{flag}»' for name in modules for line, flag in flags(ROOT / name)]
        self.assertEqual(bad, [], 'логические флаги в параметрах:\n' + '\n'.join(bad[:50]))


if __name__ == '__main__':
    import sys

    for arg in sys.argv[1:]:
        for line, short in scan(Path(arg)):
            print(f'{arg}:{line} {short}')
        for line, flag in flags(Path(arg)):
            print(f'{arg}:{line} флаг {flag}')
