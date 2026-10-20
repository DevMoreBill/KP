"""Оформление переписанного кода: Ruff (проверка и формат) для модулей Python из tests/code_style.json, Prettier для
ES-модулей интерфейса (app/web/js). Запуск из корня репозитория: python tests/code_style.py [--fix] [файлы…]."""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class CodeStyle:
    RUFF = 'ruff==0.15.8'
    PRETTIER = 'prettier@3.6.2'
    ESM = re.compile(r'^(?:import|export)\s', re.M)

    def __init__(self, only: list[str] | None = None) -> None:
        self.only = {part.replace('\\', '/') for part in only} if only is not None else None

    def _pick(self, files: list[str]) -> list[str]:
        return files if self.only is None else [file for file in files if file in self.only]

    def python(self) -> list[str]:
        listed = json.loads((REPO / 'tests' / 'code_style.json').read_text(encoding='utf-8'))['python']
        return self._pick(listed)

    def modules(self) -> list[str]:
        root = REPO / 'app' / 'web' / 'js'
        found = [path for path in sorted(root.rglob('*.js')) if self.ESM.search(path.read_text(encoding='utf-8'))]
        return self._pick([path.relative_to(REPO).as_posix() for path in found])

    @staticmethod
    def ruff() -> list[str] | None:
        exe = shutil.which('ruff')
        return [exe] if exe else None

    @staticmethod
    def npx() -> str | None:
        return shutil.which('npx')

    def commands(self, fix: bool = False) -> list[tuple[str, list[str]]]:
        out = []
        py_files, js_files, ruff, npx = self.python(), self.modules(), self.ruff(), self.npx()
        if py_files and ruff:
            out.append(('Ruff (проверка)', [*ruff, 'check', *(['--fix'] if fix else []), *py_files]))
            out.append(('Ruff (формат)', [*ruff, 'format', *([] if fix else ['--check']), *py_files]))
        if js_files and npx:
            out.append(('Prettier', [npx, '--yes', self.PRETTIER, '--write' if fix else '--check', *js_files]))
        return out

    def missing(self) -> list[str]:
        need = []
        if self.python() and not self.ruff():
            need.append(f'Ruff (pip install {self.RUFF})')
        if self.modules() and not self.npx():
            need.append('Node.js (npx)')
        return need

    def run(self, fix: bool = False) -> int:
        for what in self.missing():
            print(f'ОШИБКА  нет {what}')
        failed = bool(self.missing())
        for name, cmd in self.commands(fix):
            proc = subprocess.run(
                cmd, cwd=REPO, capture_output=True, text=True, encoding='utf-8', errors='replace', check=False
            )
            failed |= proc.returncode != 0
            print(
                f'ОШИБКА  {name}\n{(proc.stdout + proc.stderr).strip()[-4000:]}'
                if proc.returncode
                else f'OK      {name}'
            )
        return int(failed)


if __name__ == '__main__':
    args = sys.argv[1:]
    files = [a for a in args if not a.startswith('--')]
    sys.exit(CodeStyle(files or None).run(fix='--fix' in args))
