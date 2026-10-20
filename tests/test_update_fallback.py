# -*- coding: utf-8 -*-
"""Обновление не запустилось — программа сама возвращается к прежней версии (launcher.Launcher, app_update.StartCheck).

EXE имитируется (как PyInstaller onefile): sys.frozen, sys._MEIPASS — папка со «встроенной» копией программы,
sys.executable — сценарий kp.exe, который снова запускает имитацию (так программа перезапускает себя). Обновления —
папки update с изменённой версией и намеренной ошибкой. Только не Windows: на Windows то же проверяет сборка EXE в CI."""
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

from kit import APP, REPO, Http, Net

FROZEN_MAIN = '''# имитация «Конструктор КП.exe»: sys.frozen, sys._MEIPASS = bundle, sys.executable = root/kp.exe
import os, sys, runpy
sys.frozen = True
sys._MEIPASS = os.environ['KP_TEST_BUNDLE']
sys.executable = os.path.join(os.environ['KP_TEST_ROOT'], 'kp.exe')
sys.path[0] = os.path.join(sys._MEIPASS, 'app')
os.chdir(os.environ['KP_TEST_ROOT'])
runpy.run_path(os.path.join(sys._MEIPASS, 'app', 'launcher.py'), run_name='__main__')
'''


@unittest.skipIf(os.name == 'nt', 'имитация EXE — сценарий оболочки; на Windows проверяет сборка EXE в CI')
class UpdateFallbackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.mkdtemp(prefix='kp-upd-')
        cls.bundle, cls.root = os.path.join(cls.work, 'bundle'), os.path.join(cls.work, 'root')
        os.makedirs(os.path.join(cls.bundle, 'app'))
        for f in os.listdir(APP):
            if f.endswith('.py') or f in ('equipment_types.json', 'icon.ico'):
                shutil.copy(os.path.join(APP, f), os.path.join(cls.bundle, 'app', f))
        shutil.copytree(os.path.join(APP, 'web'), os.path.join(cls.bundle, 'app', 'web'))
        shutil.copytree(os.path.join(REPO, 'templates'), os.path.join(cls.bundle, 'templates'))
        os.makedirs(cls.root)
        main = os.path.join(cls.work, 'frozen_main.py')
        with open(main, 'w', encoding='utf-8') as f:
            f.write(FROZEN_MAIN)
        exe = os.path.join(cls.root, 'kp.exe')
        with open(exe, 'w', encoding='utf-8') as f:
            f.write('#!/bin/sh\nexec "%s" "%s" "$@" >> "%s/out.log" 2>&1\n' % (sys.executable, main, cls.root))
        os.chmod(exe, 0o755)
        cls.port = Net.free_port()
        with open(os.path.join(cls.root, 'settings.json'), 'w', encoding='utf-8') as f:
            json.dump({'mode': 'local', 'port': cls.port}, f)
        cls.http = Http(cls.port)
        cls.spawned = []
        with open(os.path.join(APP, 'version.py'), encoding='utf-8') as f:
            cls.exe_ver = re.search(r"VERSION = '([\d.]+)'", f.read()).group(1)

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        for pid in cls.procs():
            os.kill(pid, signal.SIGKILL)
        shutil.rmtree(cls.work, ignore_errors=True)

    # ---------- имитация EXE
    @classmethod
    def start(cls, browser=True):
        env = dict(os.environ, KP_TEST_ROOT=cls.root, KP_TEST_BUNDLE=cls.bundle, BROWSER='true', PYTHONDONTWRITEBYTECODE='1')
        for k in ('KP_UPDATE_DIR', 'KP_BASE_VERSION', 'KP_UPDATE_VERSION', 'KP_UPDATE_FALLBACK', 'KP_NO_BROWSER'):
            env.pop(k, None)
        if not browser:
            env['KP_NO_BROWSER'] = '1'
        p = subprocess.Popen([os.path.join(cls.root, 'kp.exe')], env=env, cwd=cls.root, start_new_session=True,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.spawned.append(p)
        return p

    @classmethod
    def up(cls):
        try:
            return cls.http.req('GET', '/api/ping', timeout=2)[0] == 200
        except OSError:
            return False

    def wait_up(self, sec=120):
        t = time.time()
        while time.time() - t < sec:
            if self.up():
                return True
            time.sleep(0.5)
        return False

    @classmethod
    def stop(cls):
        try:
            cls.http.req('POST', '/api/shutdown', {}, timeout=5)
        except OSError:
            pass
        t = time.time()
        while cls.up() and time.time() - t < 30:
            time.sleep(0.3)
        t = time.time()
        while cls.procs() and time.time() - t < 15:
            time.sleep(0.3)
        for p in cls.spawned:              # запущенные проверкой процессы (после возврата работает уже другой) — дождаться
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

    @classmethod
    def procs(cls):
        out = []
        for p in os.listdir('/proc') if os.path.isdir('/proc') else []:
            if p.isdigit():
                try:
                    with open('/proc/%s/cmdline' % p, 'rb') as f:
                        cmd = f.read().split(b'\0')
                    with open('/proc/%s/environ' % p, 'rb') as f:
                        env = f.read()
                except OSError:
                    continue
                if any(x.endswith(b'frozen_main.py') for x in cmd) and cls.root.encode() in env:
                    out.append(int(p))
        return out

    @staticmethod
    def env_of(pid):
        try:
            with open('/proc/%d/environ' % pid, 'rb') as f:
                return dict(x.split('=', 1) for x in f.read().decode('utf-8', 'replace').split('\0') if '=' in x)
        except OSError:
            return {}

    def version(self):
        return json.loads(self.http.req('GET', '/api/version')[1])

    def output(self):
        try:
            with open(os.path.join(self.root, 'out.log'), encoding='utf-8', errors='replace') as f:
                return f.read()[-3000:]
        except OSError:
            return ''

    def kv_update(self):
        c = sqlite3.connect(os.path.join(self.root, 'data', 'kp.sqlite3'))
        try:
            r = c.execute("SELECT value FROM kv WHERE key='update'").fetchone()
        finally:
            c.close()
        return json.loads(r[0]) if r else {}

    # ---------- обновления
    def patch(self, ver, folder='update', breaker=None):
        d = os.path.join(self.root, folder)
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(os.path.join(self.bundle, 'app'), os.path.join(d, 'app'))
        shutil.copytree(os.path.join(self.bundle, 'templates'), os.path.join(d, 'templates'))
        vf = os.path.join(d, 'app', 'version.py')
        with open(vf, encoding='utf-8') as f:
            txt = f.read()
        with open(vf, 'w', encoding='utf-8') as f:
            f.write(re.sub(r"VERSION = '[^']+'", "VERSION = '%s'" % ver, txt))
        with open(os.path.join(d, 'version.json'), 'w', encoding='utf-8') as f:
            json.dump({'version': ver}, f)
        if breaker:
            breaker(os.path.join(d, 'app'))

    @staticmethod
    def edit(app, name, a, b):
        p = os.path.join(app, name)
        with open(p, encoding='utf-8') as f:
            s = f.read()
        assert s.count(a) == 1, (name, a)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(s.replace(a, b))

    def keep_prev(self):
        os.replace(os.path.join(self.root, 'update'), os.path.join(self.root, 'update.prev'))

    def broken_import(self, msg):
        return lambda app: self.edit(app, 'kp_server.py', 'STARTED = False\n', "STARTED = False\nraise RuntimeError('%s')\n" % msg)

    def broken_startup(self, line):
        return lambda app: self.edit(app, 'admin.py', 'def startup(store, data_dir, log_print=print):\n',
                                     'def startup(store, data_dir, log_print=print):\n    %s\n' % line)

    # ---------- сценарии по порядку
    def test_1_exe_version(self):
        self.start()
        self.assertTrue(self.wait_up(), self.output())
        v = self.version()
        self.assertEqual((v['version'], v['patched']), (self.exe_ver, False))
        self.stop()

    def test_2_good_update(self):
        self.patch('99.0.1')
        self.start()
        self.assertTrue(self.wait_up(), self.output())
        v = self.version()
        self.assertEqual((v['version'], v['patched']), ('99.0.1', True))
        self.assertFalse(os.path.exists(os.path.join(self.root, 'update-failed.json')))
        self.stop()

    def test_3_broken_import_back_to_prev(self):
        self.keep_prev()
        self.patch('99.0.2', breaker=self.broken_import('ci: broken update'))
        p = self.start()
        self.assertTrue(self.wait_up(), self.output())
        self.assertEqual(self.version()['version'], '99.0.1')
        with open(os.path.join(self.root, 'update.failed', 'version.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['version'], '99.0.2')
        self.assertFalse(os.path.exists(os.path.join(self.root, 'update.prev')), 'update.prev вернулся в update')
        self.assertEqual(p.wait(timeout=10), 0, 'первый процесс завершился')
        time.sleep(1)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'update-failed.json')), 'запись о сбое перенесена в базу')
        u = self.kv_update()
        f = u.get('failed') or {}
        self.assertTrue(f.get('version') == '99.0.2' and 'ci: broken update' in f.get('reason', '') and 'Traceback' in f.get('trace', ''), f)
        self.assertTrue(any(h.get('source', '').startswith('не запустилось') and h.get('from') == '99.0.2' and h.get('version') == '99.0.1'
                            for h in u.get('history', [])), u.get('history'))
        pids = self.procs()
        self.assertEqual(len(pids), 1, pids)
        self.assertNotIn('KP_NO_BROWSER', self.env_of(pids[0]), 'первый запуск — браузер открывается и у нового процесса')
        self.stop()

    def test_4_self_check_failed(self):
        self.keep_prev()
        self.patch('99.0.3', breaker=lambda app: self.edit(
            app, 'web_api.py', "        import version\n\n        return self.send_json({'version': version.VERSION,",
            "        import version\n\n        raise KeyError('ci: version route broken')\n        return self.send_json({'version': version.VERSION,"))
        self.start(browser=False)
        self.assertTrue(self.wait_up(), self.output())
        time.sleep(2)
        self.assertEqual(self.version()['version'], '99.0.1')
        f = self.kv_update().get('failed') or {}
        self.assertTrue(f.get('version') == '99.0.3' and 'Самопроверка' in f.get('reason', '') and '500' in f.get('reason', ''), f)
        pids = self.procs()
        self.assertTrue(pids and self.env_of(pids[0]).get('KP_NO_BROWSER') == '1', 'перезапуск «из настроек» — без браузера')
        self.stop()

    def test_5_startup_code_error(self):
        self.keep_prev()
        self.patch('99.0.4', breaker=self.broken_startup("raise TypeError('ci: startup bug')"))
        self.start(browser=False)
        self.assertTrue(self.wait_up(), self.output())
        time.sleep(2)
        self.assertEqual(self.version()['version'], '99.0.1')
        f = self.kv_update().get('failed') or {}
        self.assertTrue(f.get('version') == '99.0.4' and 'ci: startup bug' in f.get('reason', ''), f)
        self.stop()

    def test_6_environment_error_is_not_rolled_back(self):
        self.keep_prev()
        self.patch('99.0.5', breaker=self.broken_startup("import sqlite3\n    raise sqlite3.DatabaseError('database disk image is malformed')"))
        p = self.start(browser=False)
        self.assertEqual(p.wait(timeout=60), 1, 'ошибка окружения: сообщение и выход, без отката')
        with open(os.path.join(self.root, 'update', 'version.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['version'], '99.0.5')
        self.assertTrue(os.path.exists(os.path.join(self.root, 'update.prev')))
        time.sleep(3)
        self.assertFalse(self.procs() or self.up(), 'программа не перезапускалась')

    def test_7_chain_back_to_exe(self):
        shutil.rmtree(os.path.join(self.root, 'update.prev'))
        self.patch('99.0.2', folder='update.prev', breaker=self.broken_import('ci: broken prev'))
        self.patch('99.0.6', breaker=self.broken_import('ci: broken 6'))
        self.start(browser=False)
        self.assertTrue(self.wait_up(150), self.output())
        time.sleep(2)
        v = self.version()
        self.assertEqual((v['version'], v['patched']), (self.exe_ver, False))
        u = self.kv_update()
        hist = [h['from'] for h in u.get('history', []) if h.get('source', '').startswith('не запустилось')]
        self.assertEqual(hist[-2:], ['99.0.6', '99.0.2'])
        self.assertFalse(os.path.exists(os.path.join(self.root, 'update')) or os.path.exists(os.path.join(self.root, 'update.prev')))
        self.assertEqual((u.get('failed') or {}).get('version'), '99.0.6', 'предупреждение — о самом новом из неудачных')
        self.assertEqual(len(self.procs()), 1)
        self.stop()

    def test_8_older_update_ignored(self):
        self.patch('1.0.0', breaker=self.broken_import('ci: must not load'))
        self.start(browser=False)
        self.assertTrue(self.wait_up(60), self.output())
        v = self.version()
        self.assertEqual((v['version'], v['patched']), (self.exe_ver, False))
        self.stop()


if __name__ == '__main__':
    unittest.main()
