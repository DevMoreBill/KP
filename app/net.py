# -*- coding: utf-8 -*-
"""Запросы сервера в интернет — одно место (решение владельца 19.10, «один способ ходить в интернет»): тайм-аут всегда,
предел размера ответа (сервис вернул огромную страницу или «бесконечный» поток — сервер не захлёбывается), повтор при обрыве
связи для безопасных запросов (GET; POST — только когда вызывающий сам разрешил), причина ошибки — по-русски и без адресов
с ключами. Системный прокси Windows и сертификаты из хранилища Windows urllib берёт сам.

Особые случаи остаются у своих модулей: защищённые переходы по адресам из ввода (imgfetch.SafeWeb — фиды, фото,
страницы товаров), Битрикс24 (свой opener для проверок), обновления с GitHub (переходы без заголовка авторизации),
адреса (без переходов). Им Net даёт только чтение с пределом: Net.read(ответ, предел).
"""
import json
import re
import socket
import time
import urllib.error
import urllib.request


class Net:
    UA = 'Mozilla/5.0 (KP-Pnevmotekh)'
    TIMEOUT = 20
    LIMIT = 8 * 1024 * 1024          # ответ API больше 8 МБ — не данные, а ошибка сервиса
    RETRY_PAUSE = 1.5                # пауза перед повтором, с

    @classmethod
    def read(cls, resp, limit=None):
        """Тело ответа не больше limit байт; больше — ValueError (сервис прислал не то, что ждали)."""
        limit = limit or cls.LIMIT
        n = resp.headers.get('Content-Length') if getattr(resp, 'headers', None) is not None else None
        if n and str(n).isdigit() and int(n) > limit:
            raise ValueError('Ответ сервиса слишком большой: %s МБ (ждали до %s МБ)' % (int(n) // 1048576, limit // 1048576))
        data = resp.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Ответ сервиса слишком большой (больше %s МБ)' % (limit // 1048576))
        return data

    @classmethod
    def request(cls, url, data=None, headers=None, method=None, timeout=None, limit=None, retries=None, opener=None):
        """Запрос → байты ответа. HTTP-ошибка (4xx/5xx) — urllib.error.HTTPError как прежде (код и тело разбирает модуль);
        обрыв связи / тайм-аут — повтор (по умолчанию: GET — 1 раз, POST — нет), затем исключение."""
        h = {'User-Agent': cls.UA}
        h.update(headers or {})
        meth = method or ('POST' if data is not None else 'GET')
        tries = 1 + (retries if retries is not None else (1 if meth == 'GET' else 0))
        open_ = (opener.open if opener is not None else urllib.request.urlopen)
        for k in range(tries):
            req = urllib.request.Request(url, data=data, headers=h, method=meth)
            try:
                with open_(req, timeout=timeout or cls.TIMEOUT) as r:
                    return cls.read(r, limit)
            except urllib.error.HTTPError:
                raise
            except (urllib.error.URLError, ConnectionError) as e:
                # тайм-аут не повторяем: сервис не отвечает — второй раз ждать столько же (логистика опрашивает много
                # перевозчиков, один «молчащий» удвоил бы ожидание); повтор — только при мгновенном обрыве соединения
                if k + 1 >= tries or cls._timeout(e):
                    raise
                time.sleep(cls.RETRY_PAUSE)

    @staticmethod
    def _timeout(e):
        r = getattr(e, 'reason', e)
        return isinstance(r, (socket.timeout, TimeoutError)) or 'timed out' in str(r)

    @classmethod
    def json(cls, url, data=None, headers=None, method=None, **kw):
        """Запрос → разобранный JSON (BOM в начале допускается)."""
        h = {'Accept': 'application/json'}
        h.update(headers or {})
        return json.loads(cls.request(url, data=data, headers=h, method=method, **kw).decode('utf-8-sig'))

    @staticmethod
    def why(e):
        """Причина сбоя для человека: без адреса запроса (в нём бывает ключ API)."""
        if isinstance(e, urllib.error.HTTPError):
            return 'сервис ответил ошибкой %s' % e.code
        r = getattr(e, 'reason', e)
        if Net._timeout(e):
            return 'сервис не ответил вовремя'
        if isinstance(r, socket.gaierror):
            return 'адрес сервиса не найден — нет интернета или DNS'
        if isinstance(r, ConnectionRefusedError):
            return 'сервис отказал в соединении'
        if isinstance(e, ValueError):
            return str(e)[:160]
        return 'нет связи с сервисом (%s)' % re.sub(r'\w+://\S+', 'адрес скрыт', str(r))[:120]
