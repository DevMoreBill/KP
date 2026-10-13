# -*- coding: utf-8 -*-
"""Картинки для карточек оборудования: логотипы по производителю и загрузка картинки по ссылке.

• logos(store) — логотип каждого производителя из каталога (у моделей с логотипом; если у производителя разные
  логотипы — самый частый). Ключ — название производителя в нижнем регистре: подставляется только при точном совпадении.
• fetch_image(url) — картинка, перетащенная со страницы сайта (браузер отдаёт только ссылку): скачивает сервер
  программы. Только http/https, только изображения до 15 МБ, адреса локальной сети и самого компьютера запрещены.
"""
import ipaddress
import socket
import urllib.parse
import time
import urllib.error
import urllib.request

import images

# сайты поставщиков (Bitrix и др.) на запрос «робота» отвечают 403 или страницей-проверкой — представляемся браузером
BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
MAX_BYTES = 15 * 1024 * 1024
TYPES = ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp')     # SVG не берём: в нём бывают скрипты


def logos(store):
    """Логотип каждого производителя: {производитель в нижнем регистре: {maker, src, w, h}}. Написания одной марки
    («Remeza», «REMEZA», «Ремеза») — одна группа; из нескольких логотипов — файл из папки логотипов, затем самый частый."""
    groups, names = {}, {}
    # логотипы считает сама база (по производителю и файлу): не нужно читать и разбирать все карточки каталога —
    # на 25 000 позиций это было 0,9 с и +190 МБ памяти сервера после каждой правки каталога
    one = "CASE WHEN json_valid(doc) THEN json_extract(doc, '$.logo.%s') END"
    rows = store.all("SELECT maker, src, w, h, COUNT(*) FROM (SELECT maker, %s AS src, %s AS w, %s AS h FROM catalog "
                     "WHERE maker IS NOT NULL AND maker <> '') GROUP BY maker, src" % (one % 'src', one % 'w', one % 'h'))
    for maker, src, w, h, n in rows:
        g = images.slug(maker, 60).replace('-', '')
        names.setdefault(g, set()).add(maker.strip())
        if not src or not isinstance(src, str):
            continue
        c = groups.setdefault(g, {})
        k, mk, lg = c.get(src, (0, maker, {'src': src, 'w': w, 'h': h}))
        c[src] = (k + n, mk, lg)
    out = {}
    for g, variants in groups.items():
        n, maker, lg = max(variants.values(), key=lambda v: (str(v[2]['src']).startswith('/img/logos/'), v[0]))
        for m in names.get(g, {maker}):
            out[m.lower()] = {'maker': m, 'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')}
    # закреплённый администратором логотип марки — главнее найденного в каталоге (maker_logos.MakerLogos)
    from maker_logos import MakerLogos
    for g, lg in MakerLogos(store).pins().items():
        for m in names.get(g, set()) | {str(lg.get('maker') or '').strip()}:
            if m:
                out[m.lower()] = {'maker': m, 'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')}
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


def web_url(url):
    """Адрес как его пишет сайт («…/upload/РГ110 01.jpg», кириллический домен) → допустимый для запроса: русские буквы,
    пробелы и прочее — в %-кодировку, домен — в punycode; уже закодированное (%D0%A0) не трогается."""
    url = str(url or '').strip()
    try:
        u = urllib.parse.urlsplit(url)
        host = u.hostname.encode('idna').decode('ascii') if u.hostname and not u.hostname.isascii() else (u.hostname or '')
    except (ValueError, UnicodeError):
        return url
    netloc = u.netloc
    if u.hostname and host != u.hostname:
        netloc = netloc.replace(u.hostname, host)
    q = lambda s, safe: urllib.parse.quote(s, safe=safe, encoding='utf-8')
    return urllib.parse.urlunsplit((u.scheme, netloc, q(u.path, "/%:@!$&'()*+,;=~-._"), q(u.query, "/%:@!$&'()*+,;=?~-._"), q(u.fragment, "/%:@?~-._")))


def _check_url(url):
    u = urllib.parse.urlsplit(url or '')
    if u.scheme not in ('http', 'https') or not u.hostname:
        raise ValueError('Нужна ссылка http или https на картинку')
    _public_host(u.hostname)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Переадресация тоже проверяется: сайт не должен увести запрос в локальную сеть."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        newurl = web_url(newurl)
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
    url = web_url(url)
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
