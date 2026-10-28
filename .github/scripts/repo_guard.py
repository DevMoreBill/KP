# -*- coding: utf-8 -*-
"""Проверка репозитория перед сборкой: в нём не должно быть баз программы, выгрузок и ключей API.

Базы (kp.sqlite3 — клиенты, КП, ключи API в «integrations»), выгрузки данных (kp*.zip), копии ключей
(«ключи-API-….json», kind: kp-keys) и сами ключи хранятся только на компьютере, где работает программа.
Если что-то такое попало в репозиторий (например, файл загружен через «Add files via upload» на GitHub),
сборка останавливается с понятным списком файлов. Удалить файл из истории — см. README, «Ключи API и безопасность».
Запуск: python .github/scripts/repo_guard.py [папка репозитория]. Только стандартная библиотека.
"""
import os
import re
import subprocess
import sys


class RepoGuard:
    SQLITE = b'SQLite format 3\x00'          # заголовок файла SQLite — ловит базу под любым именем
    BAD_NAME = re.compile(r'(\.sqlite3?(-wal|-shm|-journal)?|\.db|\.db-wal|\.db-shm)$|(^|/)kp[^/]*\.zip$|(^|/)integrations\.json$', re.I)
    KEY_NAMES = ('checkoKey', 'ofdataKey', 'dadataKey', 'dadataSecret', 'convertapiKey', 'atiToken', 'dellinKey', 'kitToken',
                 'cdekId', 'cdekSecret', 'vozovozToken', 'deepseekKey', 'githubToken')
    # «"checkoKey": "значение"» / checkoKey='значение' — ключ, записанный в файл (пустые и подстановки ${…} не считаются)
    KEY_VALUE = re.compile(r'''["']?(%s)["']?\s*[:=]\s*["']([^"'\s${}]{8,})["']''' % '|'.join(KEY_NAMES))
    TOKENS = re.compile(r'\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{32,})\b')
    # вебхук Битрикс24 с ключом (кроме примеров на example-адресах) и закрытые ключи
    WEBHOOK = re.compile(r'https?://(?![^/\s"\']*example)[^/\s"\']+/rest/\d+/[A-Za-z0-9]{10,}/')
    PRIVATE = re.compile(r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')
    TEXT_MAX = 5 * 1024 * 1024

    def __init__(self, root):
        self.root = root
        self.problems = []

    def files(self):
        try:
            out = subprocess.run(['git', '-C', self.root, 'ls-files', '-z'], capture_output=True, check=True).stdout
            return [f for f in out.decode('utf-8', 'replace').split('\0') if f]
        except Exception:
            res = []
            for d, dirs, names in os.walk(self.root):
                dirs[:] = [x for x in dirs if x != '.git']
                res += [os.path.relpath(os.path.join(d, n), self.root).replace(os.sep, '/') for n in names]
            return res

    def add(self, path, why):
        self.problems.append((path, why))

    def check_file(self, rel):
        path = os.path.join(self.root, rel)
        if not os.path.isfile(path):
            return
        if self.BAD_NAME.search(rel):
            self.add(rel, 'база или выгрузка данных программы (по имени файла)')
            return
        with open(path, 'rb') as fh:
            head = fh.read(16)
            if head.startswith(self.SQLITE):
                self.add(rel, 'файл базы SQLite')
                return
            if os.path.getsize(path) > self.TEXT_MAX:
                return
            fh.seek(0)
            data = fh.read()
        if b'\0' in data[:4096]:
            return                                   # двоичный файл (картинка, шрифт) — ключей в нём не ищем
        text = data.decode('utf-8', 'replace')
        if re.search(r'"kind"\s*:\s*"kp-keys"', text) and re.search(r'"keys"\s*:\s*\{', text):
            self.add(rel, 'копия ключей API из программы («Скачать копию ключей»)')
        for m in self.KEY_VALUE.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            self.add(rel, 'строка %d: значение ключа %s' % (line, m.group(1)))
        for m in self.TOKENS.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            self.add(rel, 'строка %d: похоже на токен доступа (%s…)' % (line, m.group(1)[:6]))
        for pattern, why in ((self.WEBHOOK, 'адрес вебхука Битрикс24 с ключом'), (self.PRIVATE, 'закрытый ключ')):
            for m in pattern.finditer(text):
                self.add(rel, 'строка %d: %s' % (text.count('\n', 0, m.start()) + 1, why))

    def run(self):
        for rel in self.files():
            if rel.startswith('.github/scripts/repo_guard'):
                continue
            try:
                self.check_file(rel)
            except OSError as e:
                self.add(rel, 'не читается: %s' % e.strerror)
        return self.problems


if __name__ == '__main__':
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    found = RepoGuard(root).run()
    if found:
        print('В репозитории нашлось то, что хранится только на компьютере с программой (базы, выгрузки, ключи API):')
        for path, why in found:
            print('  - %s — %s' % (path, why))
        print('Удалите эти файлы из репозитория и смените ключи API в личных кабинетах сервисов (README, «Ключи API и безопасность»).')
        sys.exit(1)
    print('Проверка репозитория: баз, выгрузок и ключей API нет.')
