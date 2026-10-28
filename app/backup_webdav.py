"""Копии базы на Яндекс Диск (или другой WebDAV): загрузка архива, проверка размера на диске, хранение последних N."""

import http.client
import os
import re
import select
import ssl
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64encode
from collections.abc import Callable

from net import Net


class DiskFull(RuntimeError):
    """На диске нет места для копии."""


class DavUpload:
    """PUT большого файла с «Expect: 100-continue»: отказ диска (нет места, пароль, предел файла) приходит кодом до
    отправки архива, а не обрывом соединения посередине («EOF occurred in violation of protocol»); файл — блоками."""

    BLOCK = 1 << 20
    CONTINUE = 100
    INFO_MAX = 199
    OK_MIN, OK_MAX = 200, 299
    WAIT_CONTINUE = 15  # сервер без «100 Continue» — по истечении архив отправляется (RFC 9110)
    HTTPS_PORT = 443
    PROXY_PORT = 80

    @classmethod
    def put(cls, url: str, path: str, headers: dict, timeout: float) -> None:
        """Загрузить файл; отказ сервера — HTTPError с его кодом, обрыв — ConnectionError/ssl.SSLError."""
        parts = urllib.parse.urlsplit(url)
        conn = cls._connect(parts, timeout)
        try:
            conn.putrequest('PUT', parts.path or '/', skip_accept_encoding=True)
            size = os.path.getsize(path)
            sent = {
                'User-Agent': Net.USER_AGENT,
                **headers,
                'Content-Type': 'application/binary',
                'Content-Length': str(size),
                'Expect': '100-continue',
            }
            for key, value in sent.items():
                conn.putheader(key, value)
            conn.endheaders()
            reader = conn.sock.makefile('rb')
            code = cls._early(conn.sock, reader)
            if code is None:
                code = cls._send(conn.sock, reader, path)
            if not cls.OK_MIN <= code <= cls.OK_MAX:
                raise urllib.error.HTTPError(url, code, 'отказ диска', http.client.HTTPMessage(), None)
        finally:
            conn.close()

    @classmethod
    def _connect(cls, parts: urllib.parse.SplitResult, timeout: float) -> http.client.HTTPSConnection:
        host, port = parts.hostname or '', parts.port or cls.HTTPS_PORT
        context = ssl.create_default_context()
        proxy = urllib.request.getproxies().get('https')
        if not proxy or urllib.request.proxy_bypass(host):
            return http.client.HTTPSConnection(host, port, timeout=timeout, context=context)
        via = urllib.parse.urlsplit(proxy if '://' in proxy else 'http://' + proxy)
        conn = http.client.HTTPSConnection(
            via.hostname or '', via.port or cls.PROXY_PORT, timeout=timeout, context=context
        )
        tunnel = {}
        if via.username:
            pair = urllib.parse.unquote(via.username) + ':' + urllib.parse.unquote(via.password or '')
            tunnel['Proxy-Authorization'] = 'Basic ' + b64encode(pair.encode()).decode()
        conn.set_tunnel(host, port, headers=tunnel)
        return conn

    @classmethod
    def _early(cls, sock, reader) -> int | None:
        """Ответ до отправки файла: None — «100 Continue» или молчание (отправлять), иначе — код отказа."""
        pending = getattr(sock, 'pending', lambda: 0)()
        if not pending and not select.select([sock], [], [], cls.WAIT_CONTINUE)[0]:
            return None
        code = cls._line(reader)
        return None if code == cls.CONTINUE else code

    @classmethod
    def _send(cls, sock, reader, path: str) -> int:
        """Отправить файл → код ответа; обрыв, после которого сервер успел ответить, — его код."""
        try:
            with open(path, 'rb') as file:
                for block in iter(lambda: file.read(cls.BLOCK), b''):
                    sock.sendall(block)
        except (ConnectionError, ssl.SSLError):
            code = cls._status(reader)
            if code:
                return code
            raise
        return cls._status(reader)

    @classmethod
    def _status(cls, reader) -> int:
        """Код окончательного ответа (промежуточные 1xx пропускаются); 0 — ответа нет."""
        code = cls._line(reader)
        while cls.CONTINUE <= code <= cls.INFO_MAX:
            code = cls._line(reader)
        return code

    @staticmethod
    def _line(reader) -> int:
        """Код одного ответа (его заголовки прочитываются); 0 — ответа нет."""
        try:
            match = re.match(r'HTTP/\d(?:\.\d)?\s+(\d{3})', reader.readline(1024).decode('latin-1'))
            if not match:
                return 0
            while reader.readline(8192).strip():
                pass
            return int(match.group(1))
        except (OSError, ValueError):
            return 0


class WebDavStore:
    """Папка на WebDAV-диске: создать, положить файл, список копий, удалить старые. Пароль — пароль приложения Яндекса."""

    URL = 'https://webdav.yandex.ru'
    URL_RE = re.compile(r'^https://[^\s/?#]+/?$')
    FOLDER_RE = re.compile(r'^[\w .-]{1,80}$')
    COPY_RE = re.compile(r'kp-\d{4}-\d{2}-\d{2}\.zip')
    UPLOAD_TIMEOUT = 600
    TIMEOUT = 30
    EXISTS = 405  # MKCOL уже существующей папки
    NO_SPACE = 507
    REFUSED = {
        401: 'Яндекс Диск не принял логин или пароль приложения',
        403: 'Яндекс Диск запретил запись в папку',
        413: 'архив копии ({size}) больше, чем диск принимает одним файлом',
        NO_SPACE: 'на Яндекс Диске нет места для копии ({size}) — освободите место или уменьшите «Хранить копий»',
    }
    QUOTA_BODY = (
        b'<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop>'
        b'<D:quota-available-bytes/></D:prop></D:propfind>'
    )

    def __init__(self, conf: dict, request: Callable | None = None, upload: Callable | None = None) -> None:
        self.conf = conf
        self.request = request or Net.request
        self.upload = upload or DavUpload.put

    @classmethod
    def clean(cls, data: dict, old: dict) -> dict:
        """Проверить настройки диска; пустой пароль — прежний. ValueError — понятным текстом."""
        url = str(data.get('url') or cls.URL).strip().rstrip('/')
        if not cls.URL_RE.match(url + '/'):
            raise ValueError('Адрес диска — https://webdav.yandex.ru (или адрес вашего WebDAV)')
        folder = str(data.get('folder') or 'Копии КП').strip()
        if not cls.FOLDER_RE.match(folder):
            raise ValueError('Папка на диске — буквы, цифры, пробел, точка, дефис (до 80 знаков)')
        login = str(data.get('login') or '').strip()[:120]
        same_place = url == str(old.get('url') or cls.URL).rstrip('/') and login == str(old.get('login') or '')
        password = str(data.get('password') or '') or (str(old.get('password') or '') if same_place else '')
        if not login or not password:
            raise ValueError(
                'Укажите логин Яндекса и пароль приложения (id.yandex.ru → Безопасность → Пароли приложений); '
                'для нового адреса или логина пароль вводится заново'
            )
        return {'url': url, 'folder': folder, 'login': login, 'password': password[:200]}

    def _auth(self) -> dict:
        token = b64encode('{}:{}'.format(self.conf['login'], self.conf['password']).encode()).decode()
        return {'Authorization': 'Basic ' + token}

    def _url(self, name: str = '') -> str:
        base = self.conf['url'].rstrip('/') + '/' + urllib.parse.quote(self.conf['folder']) + '/'
        return base + urllib.parse.quote(name) if name else base

    def ensure(self) -> None:
        try:
            self.request(self._url(), headers=self._auth(), method='MKCOL', timeout=self.TIMEOUT)
        except urllib.error.HTTPError as exc:
            if exc.code != self.EXISTS:
                raise

    def free(self) -> int | None:
        """Свободно на диске, байт (None — диск не сообщает)."""
        headers = dict(self._auth(), Depth='0')
        headers['Content-Type'] = 'application/xml; charset=utf-8'
        try:
            raw = self.request(
                self.conf['url'].rstrip('/') + '/',
                data=self.QUOTA_BODY,
                headers=headers,
                method='PROPFIND',
                timeout=self.TIMEOUT,
            ).decode('utf-8', 'replace')
        except urllib.error.HTTPError:
            return None
        found = re.search(r'<(?:\w+:)?quota-available-bytes>(\d+)</', raw)
        return int(found.group(1)) if found else None

    def put(self, path: str) -> int:
        """Загрузить файл и убедиться, что на диске он того же размера. → размер. DiskFull — нет места."""
        name, size = os.path.basename(path), os.path.getsize(path)
        free = self.free()
        if free is not None and free < size:
            raise DiskFull(self.REFUSED[self.NO_SPACE].format(size=self._mb(size)))
        try:
            self.upload(self._url(name), path, self._auth(), self.UPLOAD_TIMEOUT)
        except urllib.error.HTTPError as exc:
            raise self._refused(exc.code, size) from exc
        except (ConnectionError, ssl.SSLError, urllib.error.URLError) as exc:
            raise RuntimeError(
                f'Яндекс Диск оборвал загрузку архива ({self._mb(size)}): {Net.why(exc)} — повторите «Копировать сейчас»; '
                'если повторяется — проверьте свободное место на диске («Проверить диск»)'
            ) from exc
        if dict(self.listing()).get(name) != size:
            raise RuntimeError('копия на диске не того размера — загрузка прервалась')
        return size

    def _refused(self, code: int, size: int) -> RuntimeError:
        text = self.REFUSED.get(code, f'Яндекс Диск отказал в загрузке (ошибка {code})').format(size=self._mb(size))
        return DiskFull(text) if code == self.NO_SPACE else RuntimeError(text)

    @staticmethod
    def _mb(size: int) -> str:
        return f'{size / 1048576:.0f} МБ'

    def listing(self) -> list[tuple[str, int]]:
        """Копии в папке: [(имя, размер)], новые первыми."""
        headers = dict(self._auth(), Depth='1')
        raw = self.request(self._url(), headers=headers, method='PROPFIND', timeout=self.TIMEOUT).decode(
            'utf-8', 'replace'
        )
        out = []
        for block in re.split(r'<(?:\w+:)?response[ >]', raw)[1:]:
            href = re.search(r'<(?:\w+:)?href>([^<]+)</', block)
            size = re.search(r'<(?:\w+:)?getcontentlength>(\d+)</', block)
            name = urllib.parse.unquote(href.group(1)).rstrip('/').rsplit('/', 1)[-1] if href else ''
            if self.COPY_RE.fullmatch(name):
                out.append((name, int(size.group(1)) if size else 0))
        return sorted(out, reverse=True)

    def prune(self, keep: int) -> None:
        for name, _size in self.listing()[keep:]:
            self.request(self._url(name), headers=self._auth(), method='DELETE', timeout=self.TIMEOUT)

    def check(self) -> int | None:
        """Папка создаётся, в неё пишется и из неё читается → свободно на диске, байт."""
        self.ensure()
        self.listing()
        return self.free()
