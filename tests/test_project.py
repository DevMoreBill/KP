# -*- coding: utf-8 -*-
"""Правила проекта, которые проверяются без запуска программы: код сервера компилируется, его модули попадают в EXE
(kp.spec), версия одна в app/version.py и в интерфейсе, все файлы интерфейса подключены, в репозитории нет баз и ключей."""
import os
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

from kit import APP, REPO


class ProjectRules(unittest.TestCase):
    def read(self, *parts):
        with open(os.path.join(REPO, *parts), 'r', encoding='utf-8') as f:
            return f.read()

    def test_python_compiles(self):
        tmp = tempfile.mkdtemp(prefix='kp-pyc-')
        self.addCleanup(shutil.rmtree, tmp, True)
        bad = []
        for folder in ('app', 'tests', os.path.join('.github', 'scripts')):
            for f in sorted(os.listdir(os.path.join(REPO, folder))):
                if f.endswith('.py'):
                    try:
                        py_compile.compile(os.path.join(REPO, folder, f), cfile=os.path.join(tmp, f + 'c'), doraise=True)
                    except py_compile.PyCompileError as e:
                        bad.append('%s/%s: %s' % (folder, f, e.msg))
        self.assertEqual(bad, [])

    def test_server_modules_in_exe(self):
        """Новый модуль сервера (app/*.py) — в hiddenimports kp.spec: модуль, который импортируется только из обновления
        или внутри функции, PyInstaller может не увидеть, и в EXE его не будет."""
        m = re.search(r'hiddenimports=\[(.*?)\]', self.read('kp.spec'), re.S)
        hidden = set(re.findall(r"'([^']+)'", m.group(1)))
        mods = sorted(f[:-3] for f in os.listdir(APP) if f.endswith('.py') and f != 'launcher.py')
        missing = [x for x in mods if x not in hidden]
        self.assertEqual(missing, [], 'добавьте в hiddenimports в kp.spec: %s' % ', '.join(missing))

    def test_version_everywhere(self):
        v = re.search(r"VERSION = '([\d.]+)'", self.read('app', 'version.py')).group(1)
        help_js = self.read('app', 'web', 'js', 'features', 'help.js')
        self.assertIn("let APP_VERSION = '%s'" % v, help_js, 'APP_VERSION в help.js — как в app/version.py')
        first = re.search(r"const APP_VERSIONS = \[\s*\['([\d.]+)'", help_js)
        self.assertEqual(first and first.group(1), v, 'первая запись журнала изменений (APP_VERSIONS) — текущая версия')

    def test_interface_files_linked(self):
        """Каждый файл app/web/js и app/web/css подключён в index.html, и каждый подключённый файл существует."""
        html = self.read('app', 'web', 'index.html')
        linked = {x.split('?')[0] for x in re.findall(r'(?:src|href)="/web/([^"]+\.(?:js|css)[^"]*)"', html)}
        files = set()
        for sub in ('js', 'css'):
            for d, _, names in os.walk(os.path.join(APP, 'web', sub)):
                files |= {os.path.relpath(os.path.join(d, n), os.path.join(APP, 'web')).replace(os.sep, '/')
                          for n in names if n.endswith(('.js', '.css'))}
        self.assertEqual(sorted(files - linked), [], 'файлы интерфейса не подключены в index.html')
        self.assertEqual(sorted(x for x in linked if not os.path.isfile(os.path.join(APP, 'web', x))), [], 'index.html ссылается на несуществующие файлы')

    def test_help_js_parses(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        f = os.path.join(APP, 'web', 'js', 'features', 'help.js')
        r = subprocess.run([node, '-e', "new Function(require('fs').readFileSync(process.argv[1],'utf8'))", f], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])

    def test_no_databases_or_keys(self):
        sys.path.insert(0, os.path.join(REPO, '.github', 'scripts'))
        try:
            from repo_guard import RepoGuard
        finally:
            sys.path.pop(0)
        self.assertEqual(RepoGuard(REPO).run(), [])


if __name__ == '__main__':
    unittest.main()
