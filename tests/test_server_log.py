# -*- coding: utf-8 -*-
"""Журнал сервера (app/server_log.py): записи и трассировки, смена файлов, разбор ошибок для «Системы», перехват вывода
программы без консоли (у EXE stdout и stderr — None) и ошибок потоков."""
import io
import os
import shutil
import sys
import tempfile
import threading
import unittest

from kit import Quiet
from server_log import ServerLog, _LogStream


class ServerLogTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='kp-log-')
        self.addCleanup(shutil.rmtree, self.dir, True)
        Quiet.stderr(self)

    def log(self):
        log = ServerLog(os.path.join(self.dir, 'logs'))
        self.addCleanup(log.close)
        return log

    def test_records_and_errors(self):
        log = self.log()
        log.info('Запуск: версия тест')
        try:
            {}['нет']
        except KeyError as e:
            log.error('GET /api/x', e)
        recs = log.records()
        self.assertEqual([r['level'] for r in recs], ['ИНФО', 'ОШИБКА'])
        self.assertIn("KeyError: 'нет'", recs[1]['text'])
        self.assertTrue(any('Traceback' in x for x in recs[1]['detail']))
        errs = log.errors()
        self.assertEqual(len(errs), 1)
        self.assertIn('Traceback', errs[0]['detail'])
        self.assertEqual(log.count_since(24), 1)

    def test_secrets_masked(self):
        """INF-019: ключи, вебхук Битрикс24, заголовок Authorization и пароль в JSON — не в журнал."""
        log = self.log()
        log.info('GET https://api.example/x?token=SECRET1&q=1 · https://portal.example/rest/1/SECRET2/crm.deal.add')
        log.info('Authorization: Bearer SECRET3 {"password": "SECRET4", "name": "Иван"} https://user:SECRET5@dav.example/')
        text = ' '.join(r['text'] for r in log.records())
        for secret in ('SECRET1', 'SECRET2', 'SECRET3', 'SECRET4', 'SECRET5'):
            self.assertNotIn(secret, text)
        self.assertIn('Иван', text)

    def test_rotation(self):
        log = self.log()
        log.MAX = 2000
        for i in range(200):
            log.info('строка %d %s' % (i, 'х' * 40))
        files = log.files()
        self.assertTrue(2 <= len(files) <= 1 + ServerLog.KEEP, files)
        self.assertTrue(files[-1].endswith('kp.log'))
        self.assertLess(log.size(), 2000 * (ServerLog.KEEP + 2))
        self.assertTrue(log.text().rstrip().endswith('строка 199 ' + 'х' * 40), 'журнал целиком — от старых записей к новым')

    def test_install_without_console(self):
        saved = sys.stdout, sys.stderr, threading.excepthook, ServerLog.current
        sys.stdout = sys.stderr = None                  # так у EXE без консоли
        try:
            log = ServerLog.install(self.dir)
            self.addCleanup(log.close)
            print('сообщение программы')
            print('без перевода строки', end='')
            print(' — продолжение')

            def boom():
                raise RuntimeError('сбой в потоке')
            t = threading.Thread(target=boom, name='тест')
            t.start()
            t.join()
            ServerLog.failure('фоновая задача «тест»', ValueError('плохо'))
        finally:
            sys.stdout, sys.stderr, threading.excepthook, ServerLog.current = saved
        recs = log.records()
        texts = [r['text'] for r in recs]
        self.assertIn('сообщение программы', texts)
        self.assertIn('без перевода строки — продолжение', texts)
        self.assertTrue(any(r['level'] == 'ОШИБКА' and 'поток «тест»' in r['text'] and 'сбой в потоке' in r['text'] and r['detail'] for r in recs), recs)
        self.assertTrue(any(t.startswith('фоновая задача «тест» — ValueError: плохо') for t in texts), texts)

    def test_console_gets_output_too(self):
        log = self.log()
        buf = io.StringIO()
        _LogStream(log, buf).write('в консоль и в журнал\n')
        self.assertEqual(buf.getvalue(), 'в консоль и в журнал\n')
        self.assertEqual([r['text'] for r in log.records()], ['в консоль и в журнал'])


if __name__ == '__main__':
    unittest.main()
