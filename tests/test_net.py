# -*- coding: utf-8 -*-
"""Запросы сервера в интернет (app/net.py, Net): предел размера ответа (по Content-Length и по потоку без длины), ошибки
HTTP — как прежде (код разбирает модуль), повтор при мгновенном обрыве и без повтора при тайм-ауте, POST без повтора,
причина сбоя по-русски без адреса (в нём бывает ключ). Сервер — локальный, во временном потоке; интернет не нужен."""
import http.server
import os
import socket
import sys
import threading
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))

from net import Net  # noqa: E402


class _H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == '/ok':
            body = b'{"a": 1}'
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/big':                 # длина заявлена
            self.send_response(200)
            self.send_header('Content-Length', str(5 * 1024 * 1024))
            self.end_headers()
        elif self.path == '/stream':              # длины нет — поток больше предела
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'x' * (300 * 1024))
        else:
            self.send_response(404)
            self.send_header('Content-Length', '3')
            self.end_headers()
            self.wfile.write(b'nop')


class NetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), _H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = 'http://127.0.0.1:%d' % cls.srv.server_address[1]
        os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,localhost'

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_ok_and_json(self):
        self.assertEqual(Net.request(self.base + '/ok'), b'{"a": 1}')
        self.assertEqual(Net.json(self.base + '/ok'), {'a': 1})

    def test_limits(self):
        with self.assertRaisesRegex(ValueError, 'слишком большой'):
            Net.request(self.base + '/big', limit=1024 * 1024)
        with self.assertRaisesRegex(ValueError, 'слишком большой'):
            Net.request(self.base + '/stream', limit=100 * 1024)
        self.assertEqual(len(Net.request(self.base + '/stream', limit=400 * 1024)), 300 * 1024)

    def test_http_error_passes(self):
        with self.assertRaises(urllib.error.HTTPError) as c:
            Net.request(self.base + '/none')
        self.assertEqual(c.exception.code, 404)
        self.assertEqual(Net.why(c.exception), 'сервис ответил ошибкой 404')

    def test_retry_rules(self):
        class Op:
            def __init__(self, errs):
                self.errs, self.n = list(errs), 0

            def open(self, req, timeout=None):
                self.n += 1
                if self.errs:
                    raise self.errs.pop(0)
                return _Resp(b'ok')
        Net.RETRY_PAUSE, pause = 0, Net.RETRY_PAUSE
        try:
            op = Op([urllib.error.URLError(ConnectionRefusedError('refused'))])
            self.assertEqual(Net.request('http://x/', opener=op), b'ok')
            self.assertEqual(op.n, 2, 'GET после обрыва — повтор')
            op = Op([urllib.error.URLError(socket.timeout('timed out'))])
            with self.assertRaises(urllib.error.URLError):
                Net.request('http://x/', opener=op)
            self.assertEqual(op.n, 1, 'тайм-аут не повторяется')
            op = Op([urllib.error.URLError(ConnectionRefusedError('refused'))])
            with self.assertRaises(urllib.error.URLError):
                Net.request('http://x/', data=b'1', opener=op)
            self.assertEqual(op.n, 1, 'POST без разрешения не повторяется')
        finally:
            Net.RETRY_PAUSE = pause

    def test_why_has_no_url(self):
        e = urllib.error.URLError(socket.gaierror(-2, 'Name or service not known'))
        self.assertEqual(Net.why(e), 'адрес сервиса не найден — нет интернета или DNS')
        self.assertEqual(Net.why(urllib.error.URLError(socket.timeout('timed out'))), 'сервис не ответил вовремя')
        self.assertNotIn('SECRET', Net.why(urllib.error.URLError('https://api.example/?key=SECRET')), 'адрес с ключом — не в тексте')


class _Resp:
    def __init__(self, data):
        self.data, self.headers = data, {}

    def read(self, n=-1):
        return self.data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


if __name__ == '__main__':
    unittest.main(verbosity=2)
