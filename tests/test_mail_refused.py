# -*- coding: utf-8 -*-
"""Отказ доставки письма (kp_track.Mailer): адрес, не принятый почтовым сервером, — понятная ошибка; часть адресов
не принята — письмо ушло остальным, отказ виден. Почтовый сервер подменён — в сеть ничего не уходит."""
import smtplib
import unittest
from unittest import mock

from kit import TempStore


class RefusedTest(unittest.TestCase):
    def setUp(self):
        from kp_track import Mailer
        self.mailer = Mailer(TempStore(self).store)
        self.mail = {'host': 'smtp.test', 'fromEmail': 'kp@pnevmo-test.ru', 'fromName': 'Отдел продаж'}

    def test_all_refused(self):
        boom = smtplib.SMTPRecipientsRefused({'bad@client-test.ru': (550, b'no such user')})
        with mock.patch.object(type(self.mailer), '_deliver', side_effect=boom):
            with self.assertRaises(RuntimeError) as err:
                self.mailer._deliver_to(self.mail, None, ['bad@client-test.ru'])
        self.assertIn('не принял адрес: bad@client-test.ru', str(err.exception))

    def test_part_refused(self):
        with mock.patch.object(type(self.mailer), '_deliver', return_value={'bad@client-test.ru': (550, b'no')}):
            got = self.mailer._deliver_to(self.mail, None, ['ok@client-test.ru', 'bad@client-test.ru'])
        self.assertEqual(got, ['ok@client-test.ru'])


if __name__ == '__main__':
    unittest.main()
