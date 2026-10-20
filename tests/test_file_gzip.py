# -*- coding: utf-8 -*-
"""Сжатые файлы интерфейса (kp_server.Handler.send_file, FileGzip): два разных файла с одинаковыми временем изменения и
размером (так бывает после распаковки обновления) не подменяют друг друга в памяти сжатых."""
import gzip
import os
import shutil
import tempfile
import unittest

from kit import APP  # путь к app/ — до импорта сервера
import kp_server


class FakeHandler:
    """Обработчик без сети: заголовки запроса и записанный ответ."""

    file_tag = staticmethod(kp_server.Handler.file_tag)
    send_file = kp_server.Handler.send_file

    def __init__(self):
        self.headers = {'Accept-Encoding': 'gzip'}
        self.sent = None

    def send_gzipped(self, code, ctype, data, extra=None):
        self.sent = data

    def send(self, code, ctype, body, extra=None):
        self.sent = body


class FileGzipTest(unittest.TestCase):
    def test_same_time_and_size(self):
        self.assertTrue(os.path.isdir(APP))
        tmp = tempfile.mkdtemp(prefix='kp-gz-')
        self.addCleanup(shutil.rmtree, tmp, True)
        paths = []
        for name, letter in (('a.js', 'a'), ('b.js', 'b')):
            path = os.path.join(tmp, name)
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(letter * 4000)
            os.utime(path, ns=(1_700_000_000_000_000_000, 1_700_000_000_000_000_000))
            paths.append(path)
        self.assertEqual(kp_server.Handler.file_tag(paths[0]), kp_server.Handler.file_tag(paths[1]))
        got = []
        for path in paths:
            handler = FakeHandler()
            handler.send_file(path, 'text/javascript; charset=utf-8', 'no-cache')
            got.append(gzip.decompress(handler.sent).decode())
        self.assertEqual([text[0] for text in got], ['a', 'b'], 'у каждого файла — своё содержимое')


if __name__ == '__main__':
    unittest.main()
