# -*- coding: utf-8 -*-
"""Картинки для карточек оборудования: логотипы по производителю и загрузка картинки по ссылке.

• logos(store) — логотип каждого производителя из каталога (у моделей с логотипом; если у производителя разные
  логотипы — самый частый). Ключ — название производителя в нижнем регистре: подставляется только при точном совпадении.
• fetch_image(url) — картинка, перетащенная со страницы сайта (браузер отдаёт только ссылку): скачивает сервер
  программы. Только http/https, только изображения до 15 МБ, адреса локальной сети и самого компьютера запрещены.
"""
import ipaddress
import json
import socket
import urllib.parse
import urllib.request

MAX_BYTES = 15 * 1024 * 1024
TYPES = ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp')     # SVG не берём: в нём бывают скрипты


def logos(store):
    count = {}
    for maker, doc in store.all("SELECT maker, doc FROM catalog WHERE maker IS NOT NULL AND maker <> ''"):
        try:
            lg = (json.loads(doc) or {}).get('logo')
        except ValueError:
            continue
        if not isinstance(lg, dict) or not lg.get('src'):
            continue
        key = maker.strip().lower()
        c = count.setdefault(key, {})
        k = lg['src']
        c[k] = c.get(k, (0, maker, lg))
        c[k] = (c[k][0] + 1, maker, lg)
    out = {}
    for key, variants in count.items():
        n, maker, lg = max(variants.values(), key=lambda v: v[0])
        out[key] = {'maker': maker.strip(), 'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')}
    return out


def _public_host(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        raise ValueError('Адрес не найден')
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split('%')[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise ValueError('Ссылки на адреса локальной сети не загружаются')
    return True


def _check_url(url):
    u = urllib.parse.urlsplit(url or '')
    if u.scheme not in ('http', 'https') or not u.hostname:
        raise ValueError('Нужна ссылка http или https на картинку')
    _public_host(u.hostname)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Переадресация тоже проверяется: сайт не должен увести запрос в локальную сеть."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_image(url):
    _check_url(url)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*'})
    with urllib.request.build_opener(_SafeRedirect).open(req, timeout=20) as r:
        ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if ctype not in TYPES:
            raise ValueError('По ссылке не картинка (нужен PNG, JPEG, GIF, WebP или BMP)')
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Картинка больше 15 МБ')
    return ctype, data
