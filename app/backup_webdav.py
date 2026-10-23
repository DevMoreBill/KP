"""Копии базы на Яндекс Диск (или другой WebDAV): загрузка архива, проверка размера на диске, хранение последних N."""

import os
import re
import urllib.error
import urllib.parse
from base64 import b64encode

from net import Net


class WebDavStore:
    """Папка на WebDAV-диске: создать, положить файл, список копий, удалить старые. Пароль — пароль приложения Яндекса."""

    URL = 'https://webdav.yandex.ru'
    URL_RE = re.compile(r'^https://[^\s/?#]+/?$')
    FOLDER_RE = re.compile(r'^[\w .-]{1,80}$')
    COPY_RE = re.compile(r'kp-\d{4}-\d{2}-\d{2}\.zip')
    UPLOAD_TIMEOUT = 600
    TIMEOUT = 30
    EXISTS = 405  # MKCOL уже существующей папки

    def __init__(self, conf: dict, request=None) -> None:
        self.conf = conf
        self.request = request or Net.request

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

    def put(self, path: str) -> int:
        """Загрузить файл и убедиться, что на диске он того же размера. → размер."""
        name = os.path.basename(path)
        with open(path, 'rb') as file:
            data = file.read()
        self.request(self._url(name), data=data, headers=self._auth(), method='PUT', timeout=self.UPLOAD_TIMEOUT)
        sizes = dict(self.listing())
        if sizes.get(name) != len(data):
            raise RuntimeError('копия на диске не того размера — загрузка прервалась')
        return len(data)

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

    def check(self) -> None:
        """Папка создаётся, в неё пишется и из неё читается."""
        self.ensure()
        self.listing()
