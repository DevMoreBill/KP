"""Раздача интерфейса: index.html с метками версий файлов и картой импорта модулей, файлы app/web, политика безопасности страницы."""

import base64
import hashlib
import json
import os
import re
import time
import zlib
from typing import Any

from config import APP_DIR
from web_base import Controller, route

WEB_DIR = os.path.join(APP_DIR, 'web')  # интерфейс: index.html, css/, js/, vendor/
WEB_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
}
# политика безопасности страницы: скрипты — только файлы программы (внедрённый в данные скрипт не выполнится);
# unsafe-eval — скелет шаблона КП (skeleton.js) собирается из текста; картинки — свои, data:, blob: и с сайтов поставщиков
CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; "
    "font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
)


def web_file(rel) -> str | None:
    """Файл интерфейса по относительному пути внутри app/web (без выхода за пределы папки)."""
    parts = [x for x in rel.replace('\\', '/').split('/') if x and x not in ('.', '..')]
    path = os.path.join(WEB_DIR, *parts)
    if not os.path.normcase(os.path.abspath(path)).startswith(os.path.normcase(os.path.abspath(WEB_DIR))):
        return None
    return path if os.path.isfile(path) and os.path.splitext(path)[1].lower() in WEB_TYPES else None


class WebIndex:
    """index.html с меткой версии в адресе каждого файла интерфейса: браузер хранит файлы, пока они не изменятся.
    Модули, которые подключают друг друга (import), получают метку через карту импорта — без неё браузер при каждом
    запуске переспрашивает сервер о каждом из сотен модулей."""

    REF = re.compile(r'((?:src|href)=")(/web/[^"?#]+)(")')
    MODULE = re.compile(r'<script type="module"')
    JS_ROOT = 'js'
    RECHECK = 2.0  # секунд: модули переспрашиваются у диска не чаще — одновременный запуск отдела не проверяет их на каждую страницу
    cache: dict = {}  # {(метки index.html и файлов): (готовые байты, CSP)}
    scanned: tuple = (0.0, [])  # (когда, модули)

    @staticmethod
    def tag(path) -> str:
        stat = os.stat(path)
        return f'{stat.st_mtime_ns:x}-{stat.st_size:x}'

    @staticmethod
    def short(tag: str) -> str:
        return '%08x' % (zlib.crc32(tag.encode()) & 0xFFFFFFFF)

    @classmethod
    def _modules(cls) -> list[tuple[str, str]]:
        """[(адрес /web/js/…, метка)] всех скриптов интерфейса (свежий обход — не чаще RECHECK)."""
        when, found = cls.scanned
        now = time.monotonic()
        if found and now - when < cls.RECHECK:
            return found
        found = cls._scan()
        cls.scanned = (now, found)
        return found

    @classmethod
    def _scan(cls) -> list[tuple[str, str]]:
        root = os.path.join(WEB_DIR, cls.JS_ROOT)
        out = []
        for folder, _, files in os.walk(root):
            for name in files:
                if name.endswith('.js'):
                    path = os.path.join(folder, name)
                    rel = os.path.relpath(path, WEB_DIR).replace(os.sep, '/')
                    out.append(('/web/' + rel, cls.tag(path)))
        return sorted(out)

    @classmethod
    def _import_map(cls, modules: list[tuple[str, str]]) -> str:
        imports = {url: f'{url}?v={cls.short(tag)}' for url, tag in modules}
        return '<script type="importmap">' + json.dumps({'imports': imports}, separators=(',', ':')) + '</script>\n'

    @classmethod
    def build(cls, path: str) -> tuple[bytes, str]:
        """→ (страница, CSP с хешем карты импорта)."""
        with open(path, 'rb') as handle:
            html = handle.read().decode('utf-8')
        refs = [(match.group(2), web_file(match.group(2)[len('/web/') :])) for match in cls.REF.finditer(html)]
        modules = cls._modules()
        ref_tags = [cls.tag(x) if x else '' for _, x in refs]
        key = (cls.tag(path), *ref_tags, *modules)
        hit = cls.cache.get(key)
        if hit is None:
            tags = {u: cls.short(tag) for (u, _), tag in zip(refs, ref_tags, strict=True) if tag}
            page = cls.REF.sub(
                lambda ref: (
                    ref.group(1)
                    + ref.group(2)
                    + ('?v=' + tags[ref.group(2)] if ref.group(2) in tags else '')
                    + ref.group(3)
                ),
                html,
            )
            imap = cls._import_map(modules)
            first = cls.MODULE.search(page)
            if first:
                page = page[: first.start()] + imap + page[first.start() :]
            body = imap[len('<script type="importmap">') : -len('</script>\n')]
            digest = base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode('ascii')
            csp = CSP.replace("script-src 'self'", f"script-src 'self' 'sha256-{digest}'", 1)
            hit = (page.encode('utf-8'), csp)
            cls.cache = {key: hit}
        return hit


class StaticController(Controller):
    YEAR = 'public, max-age=31536000, immutable'

    @route(r'/|/index\.html|/web/.*')
    def web(self) -> Any:
        idx = self.url_path in ('/', '/index.html')
        path = web_file('index.html' if idx else self.url_path[len('/web/') :])
        if not path:
            return self.not_found()
        if idx:
            page, csp = WebIndex.build(path)
            return self.send_file(path, WEB_TYPES['.html'], 'no-cache', csp, data=page)
        # адрес с меткой версии (из index.html) не меняется, пока не изменится файл, — хранится в браузере год
        return self.send_file(
            path, WEB_TYPES[os.path.splitext(path)[1].lower()], self.YEAR if self.query.get('v') else 'no-cache'
        )

    @route(r'/favicon\.ico')
    def favicon(self) -> Any:
        icon = os.path.join(APP_DIR, 'icon.ico')
        if not os.path.isfile(icon):
            return self.not_found()
        with open(icon, 'rb') as handle:
            return self.send(200, 'image/x-icon', handle.read())
