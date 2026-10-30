# -*- coding: utf-8 -*-
"""Все проверки программы одной командой (из корня репозитория): python tests/run_all.py

1. Статические: pyflakes (сервер, проверки, служебные сценарии), ESLint интерфейса — в том числе необъявленные имена
   (eslint.config.mjs), оформление переписанного кода (tests/code_style.py: Ruff, Prettier), разбор help.js. Нет pyflakes или Node.js — шаг пропускается с предупреждением; с ключом --strict
   (так в CI) — ошибка.
2. Наборы tests/test_*.py: правила проекта, журнал сервера, письма администратору, ночные обновления, задача
   Планировщика, копии базы, API на стенде с вымышленными данными, безопасность, фаззинг, сессии администратора,
   возврат к прежней версии при неудачном обновлении. Рабочая база не используется.

Ключи: --quick — без долгих наборов (фаззинг, обновления, безопасность); --no-static — без статических проверок;
--shard=K/N — K-я из N частей наборов, поделённых по времени (tests/suite_times.json; так CI идёт параллельно);
--changed — только то, что затронуто незакоммиченными правками (git): pyflakes и ESLint по изменённым файлам, наборы
по карте в Changed (сервер — где упомянут модуль; интерфейс — проверки в Node и кнопок; CSS — только статические) и
правила проекта (test_project) — для мелких правок; полный набор делает CI при отправке (тремя частями, --shard). Имена наборов — только они (python tests/run_all.py test_api test_security). Код выхода 0 — всё прошло.
"""
import collections
import glob
import importlib.util
import json
import os
import shutil
import re
import subprocess
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


class Shard:
    """Часть наборов для параллельного запуска в CI (--shard 2/3): наборы делятся по замеренному времени
    (tests/suite_times.json, без замера — DEFAULT с) так, чтобы части шли примерно одинаково; каждый набор — ровно в одной части."""
    TIMES = os.path.join(HERE, 'suite_times.json')
    DEFAULT = 5

    def __init__(self, spec):
        part, total = spec.split('/')
        self.part, self.total = int(part), int(total)
        if not 1 <= self.part <= self.total:
            raise SystemExit('--shard K/N: K от 1 до N')

    def pick(self, names):
        try:
            with open(self.TIMES, encoding='utf-8') as f:
                times = json.load(f)
        except (OSError, ValueError):
            times = {}
        loads = [[0, []] for _ in range(self.total)]
        for name in sorted(names, key=lambda n: (-times.get(n, self.DEFAULT), n)):
            lightest = min(loads, key=lambda load: load[0])
            lightest[0] += times.get(name, self.DEFAULT)
            lightest[1].append(name)
        return sorted(loads[self.part - 1][1])


class Changed:
    """Что затронуто незакоммиченными правками (--changed): файлы и связанные с ними наборы проверок.

    Сервер — наборы, где упомянут изменённый модуль (ядро — все); интерфейс — проверки в Node (tests/js: слепки расчётов,
    станции, сделка) только при правке JS, кнопки и поля (test_controls) — при правке JS или HTML; правка одного CSS —
    только статические проверки и правила проекта. Долгие наборы (фаззинг, обновления, безопасность) — только при правке
    сервера, к которому они относятся, или в полном прогоне."""
    ALWAYS = ('test_project',)       # правила проекта — всегда
    SHARED = ('kit', 'run_all', 'storage', 'kp_server', 'web_api')   # каркас проверок и ядро сервера — все наборы
    NODE = re.compile(r"tests', 'js'|tests/js|'js', ")   # набор запускает проверки интерфейса в Node
    CONTROLS = 'test_controls'
    STATION = re.compile(r'^app/web/(js/(features/(layout|calc|draw|eskd|view|kit|station|req|rules|rules-doc|tz|tz-out)|core)/|rules/)')
    SLOW = {'test_fuzz': ('web_api', 'kp_server'), 'test_security': ('web_api', 'admin', 'kp_server', 'storage'),
            'test_update_fallback': ('updater', 'update_sign', 'kp_server', 'launcher')}

    def files(self):
        out = set()
        for cmd in (['git', 'diff', '--name-only', 'HEAD'], ['git', 'ls-files', '--others', '--exclude-standard']):
            r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding='utf-8', errors='replace')
            out.update(x.strip() for x in r.stdout.splitlines() if x.strip())
        return sorted(f for f in out if os.path.exists(os.path.join(REPO, f)))

    @classmethod
    def suites(cls, touched, names):
        keys = {os.path.splitext(os.path.basename(f))[0] for f in touched
                if f.endswith('.py') and f.startswith(('app/', 'tests/')) and not f.startswith('tests/ui/')}
        keys |= {os.path.splitext(os.path.basename(f))[0] for f in touched if f.startswith('templates/')}
        js = any(f.startswith(('app/web/js/', 'tests/js/')) for f in touched)
        html = js or any(f.endswith('.html') and f.startswith('app/web/') for f in touched)
        station = any(cls.STATION.match(f) or f.startswith('tests/js/') for f in touched)
        pick = names if keys & set(cls.SHARED) else [n for n in names if cls._wanted(n, keys, js, html)]
        if not station and not keys & set(cls.SHARED):
            pick = [n for n in pick if not n.startswith('test_station_') or n in keys]
        return [n for n in pick if n not in cls.SLOW or n in keys or keys & set(cls.SLOW[n])]

    @classmethod
    def _wanted(cls, name, keys, js, html):
        if name in keys or name in cls.ALWAYS or (html and name == cls.CONTROLS):
            return True
        with open(os.path.join(HERE, name + '.py'), encoding='utf-8') as f:
            text = f.read()
        if js and cls.NODE.search(text):
            return True
        return any(re.search(r'(?<![\w-])%s(?![\w-])' % re.escape(k), text) for k in keys)


class Runner:
    ESLINT = 'eslint@10.1.0'
    NOTES_SHOWN = 15  # мест сведений в журнале прогона (все — eslint с KP_ESLINT_REPORT=1)
    REPORT_RULES = ('kp/esc-html', 'complexity', 'max-lines-per-function')  # предупреждения KP_ESLINT_REPORT=1 (eslint.config.mjs)
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

    def eslint(self, npx, js):
        """Один проход ESLint (KP_ESLINT_REPORT=1, --format json): ошибки и предупреждения правил — отказ (как --max-warnings 0);
        предупреждения правил сведений (REPORT_RULES) — в журнал прогона без отказа (правило становится ошибкой, когда все
        места разобраны)."""
        name = 'ESLint (%s)' % ('app/web/js' if js == ['app/web/js'] else '%d файл.' % len(js))
        t = time.time()
        r = subprocess.run([npx, '--yes', self.ESLINT, '--format', 'json'] + js, cwd=REPO, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', env=dict(os.environ, KP_ESLINT_REPORT='1'))
        try:
            rows = json.loads(r.stdout or '[]')
        except ValueError:
            rows = None
        if rows is None or r.returncode not in (0, 1):
            self.failed.append(name)
            self.say('ОШИБКА  %s: ESLint не отработал (%.1f с)\n%s' % (name, time.time() - t, (r.stdout + r.stderr).strip()[-6000:]))
            return
        bad, notes = [], []
        for row in rows:
            path = os.path.relpath(row['filePath'], REPO).replace(os.sep, '/')
            for msg in row['messages']:
                note = msg.get('severity') == 1 and msg.get('ruleId') in self.REPORT_RULES
                (notes if note else bad).append('%s:%d:%d %s (%s)' % (path, msg.get('line', 0), msg.get('column', 0),
                                                                     msg.get('message', ''), msg.get('ruleId') or ''))
        if bad:
            self.failed.append(name)
            self.say('ОШИБКА  %s (%.1f с)\n%s' % (name, time.time() - t, '\n'.join(bad)[-6000:]))
        else:
            self.say('OK      %s (%.1f с)' % (name, time.time() - t))
        rules = collections.Counter(line.rsplit('(', 1)[1].rstrip(')') for line in notes)
        self.say('СВЕДЕНИЯ ESLint — разметка без esc(), сложность скриптов: %s' % (
            ', '.join('%s — %d' % pair for pair in rules.most_common()) or 'замечаний нет'))
        for line in notes[:self.NOTES_SHOWN]:
            self.say('         %s' % line)

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
            self.eslint(npx, js)
        from code_style import CodeStyle
        style = CodeStyle(self.touched)
        for what in style.missing():
            self.tool('оформление кода', False, what)
        for name, cmd in style.commands():
            self.step(name, cmd)
        if self.tool('help.js', bool(node), 'Node.js'):
            self.step('help.js читается', [node, '-e', "if (!require('./app/web/js/features/help.js').HELP_SECTIONS.length || !require('./app/web/js/features/help-versions.js').APP_VERSIONS.length) process.exit(1)"])

    def suites(self):
        names = self.names or sorted(os.path.basename(f)[:-3] for f in glob.glob(os.path.join(HERE, 'test_*.py')))
        if self.touched is not None and not self.names:
            names = Changed.suites(self.touched, names)
        if '--quick' in self.flags:
            names = [n for n in names if n not in self.SLOW]
        shard = next((f.split('=', 1)[1] for f in self.flags if f.startswith('--shard=')), None)
        return Shard(shard).pick(names) if shard else names

    def units(self):
        sys.path.insert(0, HERE)
        sys.path.insert(1, os.path.join(REPO, 'app'))  # модули сервера — для любого набора, а не только после того, кто их подключил
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
