# -*- coding: utf-8 -*-
"""Ночные обновления (app_update.NightUpdate): когда ставить и когда нет, режимы «только исправления» и «все версии»,
неудачная версия не повторяется, одна попытка за ночь, окно через полночь, запись попытки, событие для письма."""
import os
import sys
import time
import unittest
from datetime import datetime

from kit import Quiet, TempStore
import app_update
from app_update import NightUpdate, Updater, UpdateError


class FakeUpdater(Updater):
    """Обновления без GitHub: «последняя версия» задаётся в проверке, установка только записывается."""
    def __init__(self, store, folder, latest='3.52.1', cur='3.52.0', err=None):
        super().__init__(store, folder, folder)
        self.latest, self.cur, self.err, self.installed = latest, cur, err, None

    def current(self):
        return self.cur

    def check(self):
        if self.err:
            raise UpdateError(self.err)
        s = self.settings()
        s['last'] = {'version': self.latest, 'asset': {'id': 1}}
        self._save(s)
        return {'available': app_update.version.as_tuple(self.latest) > app_update.version.as_tuple(self.cur), 'last': s['last']}

    def download_latest(self, by):
        self.installed = by
        return {'version': self.latest, 'from': self.cur, 'files': 3}

    def forget_night(self, **extra):
        s = self.settings()
        s.pop('nightLast', None)
        s.update(extra)
        self._save(s)
        return self


class NightUpdateTest(unittest.TestCase):
    AT3 = datetime(2026, 10, 11, 3, 10)

    def setUp(self):
        self.db = TempStore(self)
        self.st = self.db.store
        self.restarted = []
        self.real_supported = NightUpdate.__dict__['supported']
        NightUpdate.supported = classmethod(lambda cls: True)      # как у EXE 3.51+
        self.addCleanup(setattr, NightUpdate, 'supported', self.real_supported)
        NightUpdate.last_write = 0                                   # никто не работает
        self.addCleanup(setattr, NightUpdate, 'last_write', 0)
        Quiet.stderr(self)

    def up(self, **kw):
        return FakeUpdater(self.st, self.db.dir, **kw)

    def run_at(self, up, now, quiet=True):
        if quiet:
            NightUpdate.last_write = 0
        return NightUpdate(up).run(lambda: self.restarted.append(1), now=now)

    def test_when_not_to_install(self):
        up = self.up()
        self.assertIsNone(self.run_at(up, self.AT3), 'выключено')
        up.configure({'nightly': 'patch', 'nightHour': 3}, 'admin')
        self.assertIsNone(self.run_at(up, datetime(2026, 10, 11, 12, 0)), 'не время')
        NightUpdate.last_write = time.time()
        self.assertIsNone(self.run_at(up, self.AT3, quiet=False), 'кто-то работает')
        self.assertFalse(up.settings().get('nightLast'))
        self.assertEqual(self.restarted, [])

    def test_patch_installed_once_a_night(self):
        up = self.up()
        up.configure({'nightly': 'patch', 'nightHour': 3}, 'admin')
        self.st.kv_set('alerts', {'on': True, 'to': 'admin@example.com'})
        r = self.run_at(up, self.AT3)
        self.assertTrue(r and r.get('ok'), r)
        self.assertEqual(up.installed, NightUpdate.AUTHOR)
        self.assertEqual(self.restarted, [1])
        self.assertEqual(up.settings()['nightLast']['version'], '3.52.1')
        self.assertIn('Ночью установлено обновление 3.52.1', str(self.st.kv_get('alerts').get('notices')))
        self.assertIsNone(self.run_at(up, datetime(2026, 10, 11, 4, 40)), 'вторая попытка той же ночью')

    def test_modes(self):
        up = self.up(latest='3.53.0').forget_night()
        up.configure({'nightly': 'patch', 'nightHour': 3}, 'admin')
        r = self.run_at(up, self.AT3)
        self.assertTrue(r and not r.get('ok') and 'не исправление' in r['result'], r)
        self.assertIsNone(up.installed)
        up.configure({'nightly': 'all'}, 'admin')
        up.forget_night()
        r = self.run_at(up, self.AT3)
        self.assertTrue(r and r.get('ok') and up.installed, r)

    def test_failed_version_not_repeated(self):
        up = self.up()
        up.configure({'nightly': 'all', 'nightHour': 3}, 'admin')
        up.forget_night(failed={'version': '3.52.1'})
        r = self.run_at(up, self.AT3)
        self.assertTrue(r and not r.get('ok') and 'уже не запустилась' in r['result'], r)
        self.assertIsNone(up.installed)

    def test_github_error_and_no_new_version(self):
        up = self.up(err='Нет связи с GitHub')
        up.configure({'nightly': 'all', 'nightHour': 3}, 'admin')
        r = self.run_at(up, self.AT3)
        self.assertTrue(r and r.get('error') and 'Нет связи' in r['result'], r)
        up2 = self.up(latest='3.52.0').forget_night()
        r = self.run_at(up2, self.AT3)
        self.assertEqual(r and r['result'], 'новой версии нет')
        self.assertEqual(self.restarted, [])

    def test_window_over_midnight(self):
        self.assertEqual(NightUpdate.night(datetime(2026, 10, 12, 0, 30), 23), '2026-10-11')
        up = self.up()
        up.configure({'nightly': 'all', 'nightHour': 23}, 'admin')
        self.assertEqual(NightUpdate(up).skip(up.settings(), datetime(2026, 10, 12, 0, 30)), '')
        self.assertEqual(NightUpdate(up).skip(up.settings(), datetime(2026, 10, 12, 1, 30)), 'не время')

    def test_settings_checked(self):
        up = self.up()
        for bad in ({'nightly': 'всегда'}, {'nightHour': 24}, {'nightHour': 'x'}, {'nightHour': -1}):
            with self.assertRaises(UpdateError, msg=bad):
                up.configure(bad, 'admin')
        st = up.status()
        self.assertEqual((st['nightly'], st['nightHour']), ('off', NightUpdate.HOUR))

    def test_supported_only_from_new_exe(self):
        NightUpdate.supported = self.real_supported
        self.assertFalse(NightUpdate.supported(), 'запуск из исходников, не из EXE')
        sys.frozen = True
        self.addCleanup(delattr, sys, 'frozen')
        self.addCleanup(os.environ.pop, 'KP_BASE_VERSION', None)
        for base, want in (('3.50.1', False), ('3.51.0', True), ('3.52.0', True)):
            os.environ['KP_BASE_VERSION'] = base          # версия, встроенная в EXE (её задаёт launcher.py)
            self.assertEqual(NightUpdate.supported(), want, base)


if __name__ == '__main__':
    unittest.main()
