# -*- coding: utf-8 -*-
"""Хук Claude Code (PostToolUse): проверка файла сразу после правки — pyflakes для .py, ESLint для app/web/js/**/*.js
(та же версия и настройки, что в tests/run_all.py и CI), для переписанного кода — Ruff и Prettier (tests/code_style.py). Нашлись ошибки — код выхода 2: Claude видит их и исправляет
сразу, не дожидаясь полного прогона. Нет pyflakes или Node.js — проверка молча пропускается (её сделает run_all.py).
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys


class Lint:
    TIMEOUT = 90

    def __init__(self, event):
        self.inp = event.get('tool_input') or {}
        self.root = os.environ.get('CLAUDE_PROJECT_DIR') or event.get('cwd') or os.getcwd()

    def target(self):
        path = self.inp.get('file_path') or ''
        if not path:
            return None
        p = os.path.abspath(os.path.join(self.root, path))
        rel = os.path.relpath(p, self.root).replace(os.sep, '/')
        return None if rel.startswith('../') or not os.path.isfile(p) else rel

    def eslint(self):
        with open(os.path.join(self.root, 'tests', 'run_all.py'), encoding='utf-8') as f:
            m = re.search(r"ESLINT = '([^']+)'", f.read())
        return m.group(1) if m else None

    def command(self, rel):
        if rel.endswith('.py'):
            if importlib.util.find_spec('pyflakes') is None:
                return None
            return [sys.executable, '-m', 'pyflakes', rel]
        if rel.startswith('app/web/js/') and rel.endswith('.js'):
            npx, ver = shutil.which('npx'), self.eslint()
            if not npx or not ver:
                return None
            return [npx, '--yes', ver, '--max-warnings', '0', rel]
        return None

    def style(self, rel):
        """оформление переписанного кода (tests/code_style.py): Ruff для модулей из списка, Prettier для ES-модулей"""
        sys.path.insert(0, os.path.join(self.root, 'tests'))
        try:
            from code_style import CodeStyle
        except ImportError:
            return []
        return [cmd for _, cmd in CodeStyle([rel]).commands()]

    def run(self):
        rel = self.target()
        if not rel:
            return 0
        cmds = [c for c in [self.command(rel)] if c] + self.style(rel)
        for cmd in cmds:
            try:
                r = subprocess.run(cmd, cwd=self.root, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=self.TIMEOUT)
            except (OSError, subprocess.TimeoutExpired):
                continue
            if r.returncode:
                sys.stderr.write('Проверка %s после правки — исправьте:\n%s\n' % (rel, (r.stdout + r.stderr).strip()[-4000:]))
                return 2
        return 0


if __name__ == '__main__':
    try:
        event = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)
    sys.exit(Lint(event).run())
