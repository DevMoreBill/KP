"""Каркас адресов API: маршрут @route, контроллер раздела, маршрутизатор; общие объекты разделов — изображения, справочник контрагентов, PDF рядом с Word КП."""

import contextlib
import json
import os
import re
import urllib.parse
from collections.abc import Iterator
from typing import Any

import defaults
from config import IMG_DIR, BadRequest, docs_path, store
from desktop import DesktopError
from images import ImageStore
from server_log import ErrorText
from storage import Conflict

_COUNTERPARTIES = None


def counterparties() -> Any:
    """Справочник контрагентов и проверки (создаётся после подготовки папок данных)."""
    global _COUNTERPARTIES
    if _COUNTERPARTIES is None:
        from counterparty import Counterparties

        _COUNTERPARTIES = Counterparties(store())
    return _COUNTERPARTIES


# хранилище изображений data/img (по папкам категорий)
IMAGES = ImageStore(IMG_DIR)


def pdf_of(docx) -> str:
    """PDF рядом с .docx КП, с тем же именем."""
    return os.path.splitext(docx)[0] + '.pdf'


PASS = object()  # обработчик: «не мой случай» — ищем следующий маршрут


def route(pattern: str, methods: str | tuple | None = None):
    """Обработчик маршрута: pattern — регулярное выражение всего пути, methods — метод, кортеж или None (любой)."""
    allowed = None if methods is None else ((methods,) if isinstance(methods, str) else tuple(methods))

    def mark(func):
        func._route = (re.compile(rf'\A(?:{pattern})\Z'), allowed)  # \Z: «$» пропустил бы «…\n» в конце пути
        return func

    return mark


class ControllerMeta(type):
    """Маршруты класса собираются при его объявлении — в порядке методов в теле класса."""

    ROUTES: tuple = ()  # (регулярное выражение, методы или None, имя метода)

    def __init__(cls, name, bases, namespace) -> None:
        super().__init__(name, bases, namespace)
        cls.ROUTES = tuple(
            (*func._route, attr) for attr, func in namespace.items() if callable(func) and hasattr(func, '_route')
        )


class Controller(metaclass=ControllerMeta):
    """Раздел API."""

    def __init__(self, handler, method, path, query) -> None:
        self.handler, self.method, self.url_path, self.query = handler, method, path, query

    def __getattr__(
        self, name
    ) -> Any:  # self.send_json(...) → handler.send_json(...); self.server, self.path, self.headers
        return getattr(self.handler, name)

    def _too_big(self, what) -> bool:
        """Документ для разбора больше допустимого («Значения программы»): ответить 413 и вернуть True."""
        max_mb = defaults.SrvVal.get(store(), 'cat.docMaxMB')
        if self.body_size() <= max_mb * 1024 * 1024:
            return False
        self.text(413, f'{what} больше {max_mb} МБ')
        return True

    def json_body(self) -> dict:
        """Тело запроса — объект JSON; иначе BadRequest (400)."""
        try:
            data = json.loads(self.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            raise BadRequest('Неверный запрос: нужен JSON') from None
        if not isinstance(data, dict):
            raise BadRequest('Неверный запрос: нужен объект JSON')
        return data

    @staticmethod
    def no_paths(exc) -> str:
        """Текст ошибки для ответа — без путей на диске сервера."""
        return ErrorText.of(exc)

    def text(self, code, msg) -> None:
        return self.send(code, 'text/plain; charset=utf-8', msg)

    @staticmethod
    @contextlib.contextmanager
    def user_input() -> Iterator[None]:
        """Ошибка проверки ввода (ValueError с текстом для пользователя) — ответ 400 с этим текстом."""
        try:
            yield
        except ValueError as exc:
            raise BadRequest(str(exc)) from None

    @staticmethod
    def kp_docx(kid: str) -> str | None:
        """Файл Word сохранённого КП (путь в папке КП) или None — КП ещё не сохранялось в Word или файл убран."""
        rel = store().kp_get(kid, 'docx')
        path = docs_path(rel.strip()) if rel else None
        return path if path and os.path.isfile(path) else None


class Router:
    """Находит контроллер и метод по пути и методу запроса: первый подходящий — в порядке контроллеров и их методов."""

    def __init__(self, controllers: tuple) -> None:
        self.routes = [(regex, methods, cls, attr) for cls in controllers for regex, methods, attr in cls.ROUTES]

    def dispatch(self, handler) -> Any:
        method = 'GET' if handler.command == 'HEAD' else handler.command
        u = urllib.parse.urlsplit(handler.path)
        path = urllib.parse.unquote(u.path)
        query = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True, encoding='utf-8'))
        ctrl: dict = {}
        for regex, methods, cls, attr in self.routes:
            if methods is not None and method not in methods:
                continue
            match = regex.match(path)
            if not match:
                continue
            inst = ctrl.get(cls) or ctrl.setdefault(cls, cls(handler, method, path, query))
            # неверный ввод (BadRequest, испорченное тело) — 400 отвечает kp_server.Handler
            try:
                res = getattr(inst, attr)(*match.groups())
            except Conflict as exc:  # запись успели изменить другие (X-KP-Rev) — 409
                return handler.conflict(exc)
            except DesktopError as exc:
                return handler.send(422, 'text/plain; charset=utf-8', str(exc))
            if res is not PASS:
                return res
        return handler.not_found()
