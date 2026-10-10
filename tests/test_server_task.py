# -*- coding: utf-8 -*-
"""Задача Планировщика сервера отдела (app/server_task.py): разбор настроек, исправление, запись итога, «Система» и
«Требует внимания». PowerShell подменён — проверка работает и не на Windows."""
import json
import unittest

from kit import FakeConfig, TempStore
import admin_overview
import server_task
from server_task import ServerTask

DEFAULT = {'exists': True, 'limit': 'PT72H', 'noBattery': True, 'stopBattery': True, 'priority': 7, 'restart': 0}
GOOD = {'exists': True, 'limit': 'PT0S', 'noBattery': False, 'stopBattery': False, 'priority': 5, 'restart': 3}


class FakeTask(ServerTask):
    """PowerShell без PowerShell: чтение отдаёт states[0], исправление — удачно (fix_ok) или «Отказано в доступе»."""
    def __init__(self, store, states, fix_ok=True):
        super().__init__(store)
        self.states, self.fix_ok, self.calls = list(states), fix_ok, []

    def _ps(self, script):
        self.calls.append(script)
        if 'Set-ScheduledTask' in script:
            if self.fix_ok:
                self.states = [GOOD]
            return (0, '', '') if self.fix_ok else (1, '', 'Отказано в доступе')
        if not self.states:
            return 0, '{"exists": false}', ''
        return 0, '﻿' + json.dumps(self.states[0]), ''


class ServerTaskTest(unittest.TestCase):
    def setUp(self):
        self.db = TempStore(self)
        self.st = self.db.store

    def test_duration_and_problems(self):
        self.assertEqual(ServerTask.duration('PT72H'), '72 ч')
        self.assertEqual(ServerTask.duration('P3D'), '72 ч')
        self.assertEqual(ServerTask.duration('PT1M').strip(), '1 мин')
        self.assertEqual(len(ServerTask.problems(DEFAULT)), 3)
        self.assertEqual(ServerTask.problems(GOOD), [])

    def test_fix(self):
        t = FakeTask(self.st, [DEFAULT])
        rec = t.check(1760000000)
        self.assertTrue(rec.get('fixed') and rec['settings'] == GOOD and rec['before'] == DEFAULT and not rec.get('error'), rec)
        self.assertIn(ServerTask.NAME, t.calls[1])
        self.assertIn('PT0S', t.calls[1])
        self.assertIn('$s.Priority = 5', t.calls[1])
        s = ServerTask(self.st).status()
        self.assertEqual(s['problems'], [])
        t2 = FakeTask(self.st, [GOOD])
        rec2 = t2.check(1760000100)
        self.assertTrue(not rec2.get('fixed') and rec2.get('fixedBefore') and len(t2.calls) == 1, rec2)

    def test_no_rights_and_no_task(self):
        rec = FakeTask(self.st, [DEFAULT], fix_ok=False).check(1760000200)
        self.assertTrue(rec.get('error') and not rec.get('fixed') and ServerTask.problems(rec['settings']), rec)
        rec = FakeTask(self.st, []).check(1760000300)
        self.assertTrue(rec['exists'] is False and not rec.get('error'), rec)

    def test_powershell_without_module(self):
        class Broken(FakeTask):
            def _ps(self, script):
                return 1, '', 'Get-ScheduledTask : The term is not recognized'
        rec = Broken(self.st, []).check(1760000400)
        self.assertTrue(rec.get('error', '').startswith('Get-ScheduledTask'), rec)

    def test_overview(self):
        cfg = FakeConfig.make(self.db.dir, SERVER_MODE=True, FROZEN=True, STARTED=1760000000)
        saved = server_task.os.name
        server_task.os.name = 'nt'                        # сервер отдела на Windows
        try:
            FakeTask(self.st, [DEFAULT], fix_ok=False).check(1760000500)
            at = admin_overview.Attention(self.st, cfg)._task()
            self.assertTrue(at and at[0]['level'] == 'bad' and '72 ч' in at[0]['text'] and 'Отказано в доступе' in at[0]['text'], at)
            FakeTask(self.st, [DEFAULT]).check(1760000600)
            self.assertEqual(admin_overview.Attention(self.st, cfg)._task(), [])
            info = admin_overview.SystemInfo(self.st, cfg).task()
            self.assertTrue(info and info['problems'] == [] and info.get('fixed'), info)
        finally:
            server_task.os.name = saved
        if saved != 'nt':
            self.assertIsNone(admin_overview.SystemInfo(self.st, cfg).task(), 'не Windows — задачи нет в «Системе»')


if __name__ == '__main__':
    unittest.main()
