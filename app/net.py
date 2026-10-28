"""Запросы сервера в интернет: тайм-аут, предел ответа, повтор при обрыве, причина ошибки без адресов с ключами."""

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CrossHostRedirect(urllib.request.HTTPRedirectHandler):
    """Перенаправление на другой сайт — без заголовков с ключами (urllib переносит их туда по умолчанию)."""

    SECRET_HEADERS = ('Authorization', 'Nrgapi-devtoken', 'X-api-key', 'Cookie')

    def redirect_request(self, req, stream, code, msg, headers, newurl) -> Any:
        new_req = super().redirect_request(req, stream, code, msg, headers, newurl)
        moved = urllib.parse.urlsplit(req.full_url).netloc != urllib.parse.urlsplit(newurl).netloc
        if new_req is not None and moved:
            for name in self.SECRET_HEADERS:
                new_req.headers.pop(name, None)
                new_req.unredirected_hdrs.pop(name, None)
        return new_req


class Net:
    USER_AGENT = 'Mozilla/5.0 (KP-Pnevmotekh)'
    TIMEOUT = 20
    LIMIT = 8 * 1024 * 1024
    RETRY_PAUSE = 1.5

    @classmethod
    def read(cls, resp, limit: int | None = None) -> bytes:
        """Тело ответа не больше limit байт, иначе ValueError."""
        limit = limit or cls.LIMIT
        length = resp.headers.get('Content-Length') if getattr(resp, 'headers', None) is not None else None
        if length and str(length).isdigit() and int(length) > limit:
            raise ValueError(
                f'Ответ сервиса слишком большой: {int(length) // 1048576} МБ (ждали до {limit // 1048576} МБ)'
            )
        data = resp.read(limit + 1)
        if len(data) > limit:
            raise ValueError(f'Ответ сервиса слишком большой (больше {limit // 1048576} МБ)')
        return data

    @classmethod
    def request(
        cls,
        url: str,
        data: bytes | None = None,
        headers: dict | None = None,
        method: str | None = None,
        timeout: float | None = None,
        limit: int | None = None,
        retries: int | None = None,
        opener=None,
    ) -> bytes:
        """Байты ответа; HTTPError — вызывающему; обрыв — повтор (GET — 1 раз, POST — нет)."""
        merged = {'User-Agent': cls.USER_AGENT}
        merged.update(headers or {})
        meth = method or ('POST' if data is not None else 'GET')
        tries = 1 + (retries if retries is not None else (1 if meth == 'GET' else 0))
        open_ = (opener or urllib.request.build_opener(CrossHostRedirect())).open
        for k in range(tries):
            req = urllib.request.Request(url, data=data, headers=merged, method=meth)
            try:
                with open_(req, timeout=timeout or cls.TIMEOUT) as resp:
                    return cls.read(resp, limit)
            except urllib.error.HTTPError:
                raise
            except (urllib.error.URLError, ConnectionError) as exc:
                # тайм-аут не повторяется: «молчащий» перевозчик удвоил бы ожидание логистики
                if k + 1 >= tries or cls._timeout(exc):
                    raise
                time.sleep(cls.RETRY_PAUSE)
        return b''

    @staticmethod
    def _timeout(exc: BaseException) -> bool:
        reason = getattr(exc, 'reason', exc)
        return isinstance(reason, (socket.timeout, TimeoutError)) or 'timed out' in str(reason)

    @classmethod
    def json(cls, url: str, data: bytes | None = None, headers: dict | None = None, method: str | None = None, **kw):
        merged = {'Accept': 'application/json'}
        merged.update(headers or {})
        return json.loads(cls.request(url, data=data, headers=merged, method=method, **kw).decode('utf-8-sig'))

    @staticmethod
    def why(exc: BaseException) -> str:
        """Причина сбоя без адреса запроса (в нём бывает ключ API)."""
        if isinstance(exc, urllib.error.HTTPError):
            return f'сервис ответил ошибкой {exc.code}'
        reason = getattr(exc, 'reason', exc)
        if Net._timeout(exc):
            return 'сервис не ответил вовремя'
        if isinstance(reason, socket.gaierror):
            return 'адрес сервиса не найден — нет интернета или DNS'
        if isinstance(reason, ConnectionRefusedError):
            return 'сервис отказал в соединении'
        if isinstance(exc, ValueError):
            return str(exc)[:160]
        hidden = re.sub(r'\w+://\S+', 'адрес скрыт', str(reason))[:120]
        return f'нет связи с сервисом ({hidden})'
