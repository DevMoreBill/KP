# -*- coding: utf-8 -*-
"""Все проверки программы одной командой (из корня репозитория): python tests/run_all.py

1. Статические: pyflakes (сервер, проверки, служебные сценарии), ESLint интерфейса — в том числе необъявленные имена
   (eslint.config.mjs), разбор help.js. Нет pyflakes или Node.js — шаг пропускается с предупреждением; с ключом --strict
   (так в CI) — ошибка.
2. Наборы tests/test_*.py: правила проекта, журнал сервера, письма администратору, ночные обновления, задача
   Планировщика, копии базы, API на стенде с вымышленными данными, безопасность, фаззинг, сессии администратора,
   возврат к прежней версии при неудачном обновлении. Рабочая база не используется.

Ключи: --quick — без долгих наборов (фаззинг, обновления, безопасность); --no-static — без статических проверок;
--changed — только то, что затронуто незакоммиченными правками (git): pyflakes и ESLint по изменённым файлам, наборы,
в которых упоминается изменённый модуль или файл, и правила проекта (test_project) — для мелких правок; перед выпуском —
полный прогон. Имена наборов — только они (python tests/run_all.py test_api test_security). Код выхода 0 — всё прошло.
"""
import glob
import importlib.util
import os
import shutil
import re
import subprocess
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


class Changed:
    """Что затронуто незакоммиченными правками (--changed): файлы и связанные с ними наборы проверок."""
    ALWAYS = ('test_project',)       # правила проекта — всегда
    SHARED = ('kit', 'run_all', 'storage', 'kp_server', 'web_api')   # каркас проверок и ядро сервера — все наборы

    def files(self):
        out = set()
        for cmd in (['git', 'diff', '--name-only', 'HEAD'], ['git', 'ls-files', '--others', '--exclude-standard']):
            r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding='utf-8', errors='replace')
            out.update(x.strip() for x in r.stdout.splitlines() if x.strip())
        return sorted(f for f in out if os.path.exists(os.path.join(REPO, f)))

    @classmethod
    def suites(cls, touched, names):
        keys = {os.path.splitext(os.path.basename(f))[0] for f in touched
                if f.startswith(('app/', 'tests/', 'templates/')) and not f.startswith('tests/ui/')}
        if keys & set(cls.SHARED):
            return names
        pick = []
        for n in names:
            if n in keys or n in cls.ALWAYS:
                pick.append(n)
                continue
            with open(os.path.join(HERE, n + '.py'), encoding='utf-8') as f:
                text = f.read()
            if any(re.search(r'(?<![\w-])%s(?![\w-])' % re.escape(k), text) for k in keys):
                pick.append(n)
        return pick


class Runner:
    ESLINT = 'eslint@10.1.0'
    SLOW = ('test_fuzz', 'test_update_fallback', 'test_security')

    def __init__(self, argv):
        self.flags = {a for a in argv if a.startswith('--')}
        self.names = [a[:-3] if a.endswith('.py') else a for a in argv if not a.startswith('--')]
        self.failed = []
        self.touched = Changed().files() if '--changed' in self.flags else None

    def say(self, text):
        print(text, flush=True)

    def tool(self, name, available, what):
        """Есть ли инструмент для шага; нет — пропуск с предупреждением (с --strict — ошибка)."""
        if available:
            return True
        if '--strict' in self.flags:
            self.failed.append(name)
            self.say('ОШИБКА  %s: нет %s' % (name, what))
        else:
            self.say('ПРОПУСК %s: нет %s' % (name, what))
        return False

    def step(self, name, cmd):
        """Внешняя проверка: код выхода 0 — пройдена."""
        t = time.time()
        r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            self.failed.append(name)
            self.say('ОШИБКА  %s (%.1f с)\n%s' % (name, time.time() - t, (r.stdout + r.stderr).strip()[-6000:]))
        else:
            self.say('OK      %s (%.1f с)' % (name, time.time() - t))

    def static(self):
        files = sorted(glob.glob(os.path.join(REPO, 'app', '*.py')) + glob.glob(os.path.join(HERE, '*.py')) +
                       glob.glob(os.path.join(HERE, 'ui', '*.py')) + glob.glob(os.path.join(REPO, '.github', 'scripts', '*.py')) +
                       glob.glob(os.path.join(REPO, '.claude', 'skills', '*', '*.py')))
        js = ['app/web/js']
        if self.touched is not None:
            files = [f for f in files if os.path.relpath(f, REPO).replace(os.sep, '/') in self.touched]
            js = [f for f in self.touched if f.startswith('app/web/js/') and f.endswith('.js')]
        if files and self.tool('pyflakes', importlib.util.find_spec('pyflakes') is not None, 'pyflakes (pip install pyflakes)'):
            self.step('pyflakes', [sys.executable, '-m', 'pyflakes'] + files)
        npx, node = shutil.which('npx'), shutil.which('node')
        if js and self.tool('ESLint', bool(npx), 'Node.js (npx)'):
            self.step('ESLint (%s)' % ('app/web/js' if js == ['app/web/js'] else '%d файл.' % len(js)), [npx, '--yes', self.ESLINT, '--max-warnings', '0'] + js)
        if self.tool('help.js', bool(node), 'Node.js'):
            self.step('help.js читается', [node, '-e', "new Function(require('fs').readFileSync('app/web/js/features/help.js','utf8'))"])

    def suites(self):
        names = self.names or sorted(os.path.basename(f)[:-3] for f in glob.glob(os.path.join(HERE, 'test_*.py')))
        if self.touched is not None and not self.names:
            names = Changed.suites(self.touched, names)
        if '--quick' in self.flags:
            names = [n for n in names if n not in self.SLOW]
        return names

    def units(self):
        sys.path.insert(0, HERE)
        names = self.suites()
        suite = unittest.defaultTestLoader.loadTestsFromNames(names)
        if self.touched is not None:
            self.say('Изменено: %s' % (', '.join(self.touched) or 'ничего'))
        self.say('\nНаборы: %s' % ', '.join(names))
        t = time.time()
        res = unittest.TextTestRunner(verbosity=2, stream=sys.stdout).run(suite)
        self.say('Проверок: %d, ошибок: %d, сбоев: %d, пропущено: %d (%.0f с)' % (
            res.testsRun, len(res.errors), len(res.failures), len(res.skipped), time.time() - t))
        if not res.wasSuccessful():
            self.failed.append('наборы tests/test_*.py')

    def run(self):
        if '--no-static' not in self.flags:
            self.static()
        self.units()
        self.say('\nИТОГ: %s' % ('всё прошло' if not self.failed else 'не прошли — ' + '; '.join(self.failed)))
        return 1 if self.failed else 0


if __name__ == '__main__':
    sys.exit(Runner(sys.argv[1:]).run())
