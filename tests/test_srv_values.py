# -*- coding: utf-8 -*-
"""Значения сервера в «Настройки → Значения программы» (defaults.SrvVal, описания — app/web/js/core/defaults-srv.js):
описание для админки есть у каждого значения сервера, встроенное и границы в JS и Python совпадают; изменённое через
/api/admin/defaults значение действует на сервере без перезапуска; вне границ — не сохраняется, а попавшее в базу —
заменяется встроенным."""
import json
import os
import re
import unittest
from datetime import date, timedelta

from kit import APP, Http, SampleData, Stand, TempStore
import defaults
from defaults import SrvVal
from maintenance import DbCopy

JS = os.path.join(APP, 'web', 'js', 'core', 'defaults-srv.js')


class Registry:
    """Строки реестра defaults-srv.js: {ключ: {'type', 'builtin', 'min', 'max', 'opts', 'hint'}}."""
    ROW = re.compile(r"^\s*\['([\w.]+)', '(\w+)', '([^']*)', '(num|select|bool|text)', '([^']*)', \{(.*)$")

    @classmethod
    def rows(cls):
        out = {}
        with open(JS, encoding='utf-8') as f:
            lines = f.read().split('\n')
        for i, ln in enumerate(lines):
            m = cls.ROW.match(ln)
            if not m:
                continue
            rest = m.group(6) + ' ' + (lines[i + 1] if i + 1 < len(lines) else '')
            num = lambda k: (lambda x: float(x.group(1)) if x else None)(re.search(r'\b%s:(-?[\d.]+)' % k, rest))
            opts = re.findall(r"\['(-?[\d.]+)',", rest) if m.group(4) == 'select' else []
            if 'Array.from({length:24}' in rest:
                opts = [str(h) for h in range(24)]
            out[m.group(1)] = {'type': m.group(4), 'builtin': m.group(5), 'min': num('min'), 'max': num('max'), 'opts': opts,
                               'req': 'req:true' in rest, 'hint': 'hint:' in rest}
        return out


class RegistryTest(unittest.TestCase):
    def test_js_matches_python(self):
        rows = Registry.rows()
        self.assertEqual(set(rows), set(SrvVal.LIMITS), 'у каждого значения сервера — описание в defaults-srv.js, и наоборот')
        for k, (b, lo, hi) in SrvVal.LIMITS.items():
            r = rows[k]
            self.assertEqual(float(r['builtin']), float(b), '%s: встроенное в JS и Python' % k)
            self.assertTrue(r['req'] and r['hint'], '%s: всегда действует и с подробным пояснением' % k)
            self.assertTrue(lo <= b <= hi, k)
            if r['type'] == 'num':
                self.assertEqual((r['min'], r['max']), (float(lo), float(hi)), '%s: границы в JS и Python' % k)
            else:
                self.assertEqual(r['type'], 'select', k)
                self.assertIn(r['builtin'], r['opts'], k)
                self.assertTrue(all(lo <= float(v) <= hi for v in r['opts']), '%s: варианты в границах сервера' % k)

    def test_no_secrets(self):
        """В «Значения программы» (отдаются всем) — ни паролей, ни ключей."""
        for k in SrvVal.LIMITS:
            self.assertNotRegex(k.lower(), r'pass|secret|smtp|apikey|\.key|\.token')


class SrvValTest(unittest.TestCase):
    def setUp(self):
        self.ts = TempStore(self)
        self.st = self.ts.store
        SrvVal.forget()
        self.addCleanup(SrvVal.forget)

    def test_value_bounds(self):
        self.assertEqual(SrvVal.get(self.st, 'srv.trashDays'), 30, 'не задано — встроенное')
        self.assertEqual(SrvVal.get(None, 'srv.trashDays'), 30, 'без базы — встроенное')
        defaults.save(self.st, {'srv.trashDays': {'on': True, 'v': '45'}, 'srv.lowDiskGB': {'on': True, 'v': '0,5'}})
        self.assertEqual(SrvVal.get(self.st, 'srv.trashDays'), 45)
        self.assertEqual(SrvVal.get(self.st, 'srv.lowDiskGB'), 0.5, 'дробное — дробным')
        for bad in ('0', '366', 'abc', 'nan', 'inf'):
            with self.assertRaises(ValueError, msg=bad):
                defaults.save(self.st, {'srv.trashDays': {'on': True, 'v': bad}})
        self.assertEqual(SrvVal.get(self.st, 'srv.trashDays'), 45, 'неверное не сохранилось')
        # вне границ в базе (старая версия, ручная правка) — встроенное; выключено — встроенное
        st = self.st.kv_get('settings')
        st['defaults']['srv.adminIdleMin'] = {'on': True, 'v': 0}
        st['defaults']['srv.loginFails'] = {'on': False, 'v': 50}
        self.st.kv_set('settings', st)
        SrvVal.forget()
        self.assertEqual(SrvVal.get(self.st, 'srv.adminIdleMin'), 15)
        self.assertEqual(SrvVal.get(self.st, 'srv.loginFails'), 5)
        defaults.save(self.st, {'srv.trashDays': None})
        self.assertEqual(SrvVal.get(self.st, 'srv.trashDays'), 30, 'сброс — встроенное')

    def test_backup_keep(self):
        """Сколько копий хранить — из «Значений программы»."""
        days = [(date(2026, 10, 14) - timedelta(days=i)).isoformat() for i in range(400)]
        self.assertEqual(len(DbCopy.keep_set(days)), len(DbCopy.keep_set(days, self.st)))
        defaults.save(self.st, {'srv.backupDaily': {'on': True, 'v': 3}, 'srv.backupWeekly': {'on': True, 'v': 0},
                                'srv.backupMonthly': {'on': True, 'v': 0}})
        self.assertEqual(DbCopy.keep_set(days, self.st), set(days[:3]))

    def test_reminders(self):
        from kp_track import ReminderList
        today = date(2026, 10, 14)
        sent = {'status': 'sent', 'at': (today - timedelta(days=4)).isoformat()}
        rows = [('k1', {'number': '1'}, sent, {})]
        self.assertEqual(ReminderList(today, self.st).collect(rows, lambda m: True), [], '4 дня — ещё рано (встроенное 7)')
        defaults.save(self.st, {'kp.staleDays': {'on': True, 'v': 3}})
        self.assertEqual([x['kind'] for x in ReminderList(today, self.st).collect(rows, lambda m: True)], ['stale'])


class StandTest(unittest.TestCase):
    """На работающей программе: правка через /api/admin/defaults действует сразу (без перезапуска)."""
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=10, clients=3, kps=1)).start()
        cls.cookie, cls.hd = cls.stand.admin()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def req(self, method, path, body=None):
        st, b, _ = self.stand.http.req(method, path, body, cookie=self.cookie, headers=self.hd)
        return st, (Http.js(b) if st == 200 else b)

    def save(self, values):
        return self.req('POST', '/api/admin/defaults', {'values': values})

    def test_applied_on_server(self):
        self.assertEqual(self.req('GET', '/api/admin/trash')[1]['days'], 30)
        st, b = self.save({'srv.trashDays': {'on': True, 'v': '45'}, 'srv.adminIdleMin': {'on': True, 'v': '20'}})
        self.assertEqual(st, 200, b)
        self.assertEqual(self.req('GET', '/api/admin/trash')[1]['days'], 45, 'срок корзины — сразу')
        self.assertEqual(json.loads(self.stand.http.req('GET', '/api/admin/status', cookie=self.cookie)[1])['idleMinutes'], 20)
        # вне границ — 400 с понятным текстом, прежнее значение действует
        st, b = self.save({'srv.trashDays': {'on': True, 'v': '0'}})
        self.assertEqual(st, 400)
        self.assertIn('от 1 до 365', b)
        self.assertEqual(self.req('GET', '/api/admin/trash')[1]['days'], 45)
        # /api/defaults (для всех) отдаёт значение — интерфейс показывает те же числа
        self.assertEqual(Http.js(self.stand.http.req('GET', '/api/defaults')[1])['srv.trashDays']['v'], '45')
        self.save({'srv.trashDays': None, 'srv.adminIdleMin': None})
        self.assertEqual(self.req('GET', '/api/admin/trash')[1]['days'], 30, 'сброс — встроенное')

    def test_login_fails(self):
        """Порог неверных паролей: 3 вместо 5 — после трёх ошибок вход закрыт (и верным паролем)."""
        st, b = self.save({'srv.loginFails': {'on': True, 'v': '3'}, 'srv.loginLockMin': {'on': True, 'v': '1'}})
        self.assertEqual(st, 200, b)
        lg, pw = Stand.ADMIN
        res = [self.stand.http.req('POST', '/api/admin/login', {'login': lg, 'password': 'wrong-1'}) for _ in range(3)]
        self.assertEqual([r[0] for r in res], [403, 403, 429], 'третья ошибка — сразу пауза')
        self.assertIn('Осталось попыток: 1', res[1][1])
        self.assertIn('закрыт на 1 мин', res[2][1])
        self.assertTrue(1 <= int(res[2][2].get('Retry-After')) <= 60, res[2][2])
        st, b, _ = self.stand.http.req('POST', '/api/admin/login', {'login': lg, 'password': pw})
        self.assertEqual(st, 429)
        self.assertIn('1 мин', b)
        # вне границ в базе — встроенные 5 попыток: после перезапуска счётчик пуст, 4 ошибки — ещё не пауза
        self.stand.stop()
        self.stand.kv_set('settings', dict(self._settings(), defaults=dict(self._settings().get('defaults') or {},
                                                                        **{'srv.loginFails': {'on': True, 'v': 1}})))
        self.stand.start()
        codes = [self.stand.http.req('POST', '/api/admin/login', {'login': lg, 'password': 'wrong-2'})[0] for _ in range(4)]
        self.assertEqual(codes, [403] * 4, 'значение 1 вне границ (3–20) — действует встроенное 5')
        self.assertEqual(self.stand.http.req('POST', '/api/admin/login', {'login': lg, 'password': pw})[0], 200)
        self.__class__.cookie, self.__class__.hd = self.stand.admin()

    def _settings(self):
        import storage
        s = storage.Store(self.stand.db)
        try:
            return s.kv_get('settings') or {}
        finally:
            s.conn().close()


if __name__ == '__main__':
    unittest.main()
