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
import time
import urllib.error
import urllib.request

# сайты поставщиков (Bitrix и др.) на запрос «робота» отвечают 403 или страницей-проверкой — представляемся браузером
BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
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


def retry(fn, tries=3, pause=1.5):
    """Повтор при временном отказе сайта: 403/429/5xx (защита от частых запросов), обрыв, тайм-аут."""
    for k in range(tries):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            if k == tries - 1 or e.code not in (403, 408, 425, 429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, OSError):
            if k == tries - 1:
                raise
        time.sleep(pause * (k + 1))


def fetch_image(url, referer=None, tries=1):
    _check_url(url)
    hd = {'User-Agent': BROWSER_UA, 'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'}
    if referer:
        hd['Referer'] = referer        # защита от «горячих ссылок»: картинку отдают только со своей страницы

    def get():
        with urllib.request.build_opener(_SafeRedirect).open(urllib.request.Request(url, headers=hd), timeout=20) as r:
            ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            if ctype not in TYPES:
                raise ValueError('По ссылке не картинка (нужен PNG, JPEG, GIF, WebP или BMP)')
            data = r.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('Картинка больше 15 МБ')
        return ctype, data
    return retry(get, tries)
