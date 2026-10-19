# -*- coding: utf-8 -*-
"""Хук Claude Code (PreToolUse): запрет записи баз, выгрузок и ключей — их не должно быть в проекте (правило владельца).

Файловые инструменты (Write, Edit, MultiEdit, NotebookEdit): отказ, если путь — база (*.sqlite3, *.sqlite, *.db),
выгрузка базы (kp*.zip), ключи и секреты (.env, *.pem, *.key, id_rsa, *.p12, *.pfx) или папка рабочих данных
программы (app/data/). Bash: отказ на принудительное добавление таких файлов в git (git add -f) и на команды, меняющие
app/data/. Код выхода 2 — Claude получает причину и не выполняет действие; 0 — можно.
"""
import json
import os
import re
import sys


class Guard:
    NAMES = (r'.*\.sqlite3?(-wal|-shm|-journal)?$', r'.*\.db$', r'kp.*\.zip$', r'\.env(\..*)?$', r'.*\.(pem|key|p12|pfx)$',
             r'id_(rsa|ed25519|ecdsa)(\.pub)?$')
    DATA = 'app/data/'
    WRITE_TOOLS = ('Write', 'Edit', 'MultiEdit', 'NotebookEdit')
    # команда записи, у которой app/data/ — цель (а не просто упоминание в тексте команды)
    DIR = r'app/data(/|(?=["\'\s]|$))'
    BASH_WRITE = (r'(\brm|\bmv|\bcp|\btruncate|\bsqlite3|\btee|\bsed\s+-i|\bshred|\bunlink)\b[^;&|\n]*?(^|[\s"\'=/])' + DIR,
                  r'>>?\s*["\']?\S*' + DIR, r'\bdd\b[^;&|\n]*\bof=\S*' + DIR)

    def __init__(self, event):
        self.tool = event.get('tool_name') or ''
        self.inp = event.get('tool_input') or {}
        self.root = os.environ.get('CLAUDE_PROJECT_DIR') or event.get('cwd') or os.getcwd()

    def _rel(self, path):
        p = os.path.abspath(os.path.join(self.root, path))
        rel = os.path.relpath(p, self.root).replace(os.sep, '/')
        return None if rel.startswith('../') else rel

    def bad_name(self, name):
        return any(re.match(r, name, re.I) for r in self.NAMES)

    def check_file(self):
        path = self.inp.get('file_path') or self.inp.get('notebook_path') or ''
        rel = self._rel(path) if path else None
        if rel is None:
            return None      # вне проекта (временные папки, копии для проверок) — не наше
        if rel.startswith(self.DATA):
            return 'папка рабочих данных программы (app/data/) — базу пользователя не трогать, только миграции в app/storage.py'
        if self.bad_name(os.path.basename(rel)):
            return 'базы, выгрузки и ключи не кладутся в проект (репозиторий публичный); копии для проверок — во временной папке'
        return None

    def check_bash(self):
        cmd = self.inp.get('command') or ''
        if re.search(r'\bgit\s+add\b[^;&|]*\s(-f|--force)\b', cmd) and any(self.bad_name(os.path.basename(w.strip('"\'')))
                                                                            for w in cmd.split()):
            return 'принудительное добавление базы, выгрузки или ключа в git'
        if any(re.search(r, cmd) for r in self.BASH_WRITE):
            return 'изменение папки рабочих данных программы (app/data/)'
        return None

    def verdict(self):
        if self.tool in self.WRITE_TOOLS:
            return self.check_file()
        if self.tool == 'Bash':
            return self.check_bash()
        return None


if __name__ == '__main__':
    try:
        event = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)
    why = Guard(event).verdict()
    if why:
        sys.stderr.write('Запрещено правилами проекта: %s.\n' % why)
        sys.exit(2)
    sys.exit(0)
