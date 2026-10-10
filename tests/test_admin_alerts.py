# -*- coding: utf-8 -*-
"""Письма администратору о проблемах (app/admin_alerts.py): проверка настроек, письмо при появлении проблемы,
напоминание раз в сутки, решённая проблема забывается, пробное письмо, почтовый сервер не отвечает."""
import unittest

from kit import FakeConfig, Net, Quiet, SmtpSink, TempStore
from admin_alerts import AdminAlerts


class AdminAlertsTest(unittest.TestCase):
    def setUp(self):
        self.sink = SmtpSink()
        self.addCleanup(self.sink.stop)
        self.db = TempStore(self)
        self.st = self.db.store
        self.al = AdminAlerts(self.st, FakeConfig.make(self.db.dir))
        Quiet.stderr(self)

    def problem(self, ok=False, error='диск недоступен', at='2026-10-10T10:00:00'):
        self.st.kv_set('maint', {'backup': dict({'at': at, 'ok': ok}, **({} if ok else {'error': error}))})

    def test_settings_checked(self):
        for bad in ({'on': True, 'to': ''}, {'to': 'не-адрес'}, {'to': ','.join('a%d@example.com' % i for i in range(AdminAlerts.MAX_TO + 1))}):
            with self.assertRaises(ValueError, msg=bad):
                self.al.save(bad, 'admin')
        r = self.al.save({'on': True, 'to': 'admin@example.com, boss@example.com'}, 'admin')
        self.assertTrue(r['on'])
        self.assertEqual(r['to'], 'admin@example.com, boss@example.com')

    def test_off_sends_nothing(self):
        self.problem()
        self.assertIsNone(self.al.check())
        self.assertEqual(self.sink.messages, [])

    def test_test_letter_without_mail_server(self):
        self.al.save({'on': True, 'to': 'admin@example.com'}, 'admin')
        with self.assertRaises(RuntimeError) as e:
            self.al.test()
        self.assertIn('Почта не настроена', str(e.exception))

    def test_letters(self):
        self.al.save({'on': True, 'to': 'admin@example.com'}, 'admin')
        self.st.kv_set('mail', self.sink.mail_settings())
        self.problem()
        self.assertEqual([x['key'] for x in self.al.problems()], ['backup'])
        r = self.al.check()
        self.assertTrue(r and r['ok'], r)
        self.assertEqual(len(self.sink.messages), 1)
        subject, text, _, rcpt, _ = self.sink.message()
        self.assertIn('требует внимания — 1', subject)
        self.assertIn('диск недоступен', text)
        self.assertIn('(новое)', text)
        self.assertIn('Настройки → Почта', text)
        self.assertEqual(rcpt, ['admin@example.com'])
        # в течение суток — без повторного письма; через сутки — напоминание
        self.assertIsNone(self.al.check())
        s = self.al.settings()
        s['sent'] = {k: '2026-01-01T00:00:00' for k in s['sent']}
        self.st.kv_set('alerts', s)
        r = self.al.check()
        self.assertTrue(r and r['ok'])
        self.assertEqual(len(self.sink.messages), 2)
        # решённая проблема забывается; появилась снова — письмо сразу
        self.problem(ok=True, at='2099-01-01T10:00:00')
        self.assertIsNone(self.al.check())
        self.assertNotIn('backup', self.al.settings().get('sent') or {})
        self.problem(error='снова')
        r = self.al.check()
        self.assertTrue(r and r['ok'])
        self.assertEqual(len(self.sink.messages), 3)
        # пробное письмо
        r = self.al.test()
        self.assertTrue(r['ok'] and r['test'])
        self.assertIn('пробное письмо', self.sink.message()[0])

    def test_notice_goes_with_next_letter(self):
        self.al.save({'on': True, 'to': 'admin@example.com'}, 'admin')
        self.st.kv_set('mail', self.sink.mail_settings())
        AdminAlerts.notice(self.st, 'Ночью установлено обновление 9.9.9')
        r = self.al.check()
        self.assertTrue(r and r['ok'], r)
        subject, text, _, _, _ = self.sink.message()
        self.assertIn('события', subject)
        self.assertIn('Ночью установлено обновление 9.9.9', text)
        self.assertEqual(self.al.settings().get('notices'), [])
        self.assertIsNone(self.al.check(), 'событие отправлено один раз')

    def test_mail_server_down(self):
        self.al.save({'on': True, 'to': 'admin@example.com'}, 'admin')
        self.st.kv_set('mail', self.sink.mail_settings(port=Net.free_port()))
        self.problem()
        r = self.al.check()
        self.assertTrue(r and not r['ok'] and r.get('error'), r)
        self.assertNotIn('backup', self.al.settings().get('sent') or {}, 'после неудачи письмо повторится при следующей проверке')


if __name__ == '__main__':
    unittest.main()
