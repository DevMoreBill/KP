"""Картинки по ссылке и логотипы производителей; запросы на чужие сайты — только в интернет, не в локальную сеть."""

import http.client
import ipaddress
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

from defaults import SrvVal
from maker_logos import MakerLogos

# сайты поставщиков отвечают «роботу» 403 или страницей-проверкой
BROWSER_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
)
TYPES = ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp')  # без SVG: в нём бывают скрипты


def logos(store) -> dict:
    """{производитель в нижнем регистре: {maker, src, w, h}}: закреплённый, иначе из папки логотипов, иначе самый частый."""
    groups, names = {}, {}
    col = {k: f"CASE WHEN json_valid(doc) THEN json_extract(doc, '$.logo.{k}') END" for k in ('src', 'w', 'h')}
    rows = store.all(
        f'SELECT maker, src, w, h, COUNT(*) FROM (SELECT maker, {col["src"]} AS src, {col["w"]} AS w, {col["h"]} AS h '
        'FROM catalog '
        "WHERE maker IS NOT NULL AND maker <> '') GROUP BY maker, src"
    )
    for maker, src, w, h, n in rows:
        g = MakerLogos.key(maker)
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
    for g, lg in MakerLogos(store).pins().items():
        for m in names.get(g, set()) | {str(lg.get('maker') or '').strip()}:
            if m:
                out[m.lower()] = {'maker': m, 'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')}
    return out


def _local(ip: str) -> bool:
    a = ipaddress.ip_address(ip.split('%', maxsplit=1)[0])
    return a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified


def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        raise ValueError('Адрес не найден') from None
    for info in infos:
        if _local(info[4][0]):
            raise ValueError('Ссылки на адреса локальной сети не загружаются')
    return True


def web_url(url) -> str:
    """Адрес с кириллицей и пробелами → %-кодировка, домен — punycode; закодированное не трогается."""
    url = str(url or '').strip()
    try:
        u = urllib.parse.urlsplit(url)
        host = (
            u.hostname.encode('idna').decode('ascii') if u.hostname and not u.hostname.isascii() else (u.hostname or '')
        )
    except (ValueError, UnicodeError):
        return url
    netloc = u.netloc
    if u.hostname and host != u.hostname:
        netloc = netloc.replace(u.hostname, host)

    def q(s: str, safe: str) -> str:
        return urllib.parse.quote(s, safe=safe, encoding='utf-8')

    return urllib.parse.urlunsplit(
        (
            u.scheme,
            netloc,
            q(u.path, "/%:@!$&'()*+,;=~-._"),
            q(u.query, "/%:@!$&'()*+,;=?~-._"),
            q(u.fragment, '/%:@?~-._'),
        )
    )


def _check_url(url: str) -> None:
    u = urllib.parse.urlsplit(url or '')
    if u.scheme not in ('http', 'https') or not u.hostname:
        raise ValueError('Нужна ссылка http или https на картинку')
    _public_host(u.hostname)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        newurl = web_url(newurl)
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class SafeWeb:
    """Запросы на чужие сайты: адрес соединения проверяется после подключения (подмена DNS); через прокси — нельзя."""

    @staticmethod
    def _peer(sock) -> None:
        if _local(sock.getpeername()[0]):
            sock.close()
            raise ValueError('Ссылки на адреса локальной сети не загружаются')

    class HTTPConn(http.client.HTTPConnection):
        def connect(self) -> None:
            super().connect()
            SafeWeb._peer(self.sock)

    class HTTPSConn(http.client.HTTPSConnection):
        def connect(self) -> None:
            super().connect()
            SafeWeb._peer(self.sock)

    @staticmethod
    def _proxied(req) -> bool:
        return req.has_proxy() or bool(getattr(req, '_tunnel_host', None))

    class HTTP(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(http.client.HTTPConnection if SafeWeb._proxied(req) else SafeWeb.HTTPConn, req)

    class HTTPS(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(
                http.client.HTTPSConnection if SafeWeb._proxied(req) else SafeWeb.HTTPSConn, req, context=self._context
            )

    @classmethod
    def opener(cls, *extra) -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(_SafeRedirect, cls.HTTP, cls.HTTPS, *extra)


def retry(fn, tries: int = 3, pause: float = 1.5):
    """Повтор при 403/429/5xx, обрыве и тайм-ауте."""
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
    return None


def fetch_image(url: str, referer: str | None = None, tries: int = 1) -> tuple[str, bytes]:
    url = web_url(url)
    _check_url(url)
    hd = {'User-Agent': BROWSER_UA, 'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'}
    if referer:
        hd['Referer'] = referer
    mb = SrvVal.now('cat.imgMaxMB')

    def get() -> tuple[str, bytes]:
        with SafeWeb.opener().open(urllib.request.Request(url, headers=hd), timeout=20) as r:
            ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            if ctype not in TYPES:
                raise ValueError('По ссылке не картинка (нужен PNG, JPEG, GIF, WebP или BMP)')
            data = r.read(mb * 1024 * 1024 + 1)
        if len(data) > mb * 1024 * 1024:
            raise ValueError(f'Картинка больше {mb} МБ')
        return ctype, data

    return retry(get, tries)
