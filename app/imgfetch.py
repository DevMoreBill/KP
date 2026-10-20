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
    groups: dict = {}
    names: dict = {}
    col = {k: f"CASE WHEN json_valid(doc) THEN json_extract(doc, '$.logo.{k}') END" for k in ('src', 'w', 'h')}
    rows = store.all(
        f'SELECT maker, src, w, h, COUNT(*) FROM (SELECT maker, {col["src"]} AS src, {col["w"]} AS w, {col["h"]} AS h '
        'FROM catalog '
        "WHERE maker IS NOT NULL AND maker <> '') GROUP BY maker, src"
    )
    for maker, src, width, height, count in rows:
        group = MakerLogos.key(maker)
        names.setdefault(group, set()).add(maker.strip())
        if not src or not isinstance(src, str):
            continue
        best = groups.setdefault(group, {})
        k, maker_name, logo = best.get(src, (0, maker, {'src': src, 'w': width, 'h': height}))
        best[src] = (k + count, maker_name, logo)
    out = {}
    for group, variants in groups.items():
        count, maker, logo = max(variants.values(), key=lambda v: (str(v[2]['src']).startswith('/img/logos/'), v[0]))
        for name in names.get(group, {maker}):
            out[name.lower()] = {'maker': name, 'src': logo['src'], 'w': logo.get('w'), 'h': logo.get('h')}
    for group, logo in MakerLogos(store).pins().items():
        for name in names.get(group, set()) | {str(logo.get('maker') or '').strip()}:
            if name:
                out[name.lower()] = {'maker': name, 'src': logo['src'], 'w': logo.get('w'), 'h': logo.get('h')}
    return out


def _local(addr: str) -> bool:
    addr_obj = ipaddress.ip_address(addr.split('%', maxsplit=1)[0])
    return (
        addr_obj.is_private
        or addr_obj.is_loopback
        or addr_obj.is_link_local
        or addr_obj.is_reserved
        or addr_obj.is_multicast
        or addr_obj.is_unspecified
    )


def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        raise ValueError('Адрес не найден') from None
    for info in infos:
        if _local(str(info[4][0])):
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

    def _quote(text: str, safe: str) -> str:
        return urllib.parse.quote(text, safe=safe, encoding='utf-8')

    return urllib.parse.urlunsplit(
        (
            u.scheme,
            netloc,
            _quote(u.path, "/%:@!$&'()*+,;=~-._"),
            _quote(u.query, "/%:@!$&'()*+,;=?~-._"),
            _quote(u.fragment, '/%:@?~-._'),
        )
    )


def _check_url(url: str) -> None:
    u = urllib.parse.urlsplit(url or '')
    if u.scheme not in ('http', 'https') or not u.hostname:
        raise ValueError('Нужна ссылка http или https на картинку')
    _public_host(u.hostname)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, stream, code, msg, headers, newurl):
        newurl = web_url(newurl)
        _check_url(newurl)
        return super().redirect_request(req, stream, code, msg, headers, newurl)


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


def retry(func, tries: int = 3, pause: float = 1.5):
    """Повтор при 403/429/5xx, обрыве и тайм-ауте."""
    for k in range(tries):
        try:
            return func()
        except urllib.error.HTTPError as exc:
            if k == tries - 1 or exc.code not in (403, 408, 425, 429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, OSError):
            if k == tries - 1:
                raise
        time.sleep(pause * (k + 1))
    return None


def fetch_image(url: str, referer: str | None = None, tries: int = 1) -> tuple[str, bytes]:
    url = web_url(url)
    _check_url(url)
    headers = {'User-Agent': BROWSER_UA, 'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'}
    if referer:
        headers['Referer'] = referer
    max_mb = SrvVal.now('cat.imgMaxMB')

    def get() -> tuple[str, bytes]:
        with SafeWeb.opener().open(urllib.request.Request(url, headers=headers), timeout=20) as resp:
            ctype = (resp.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            if ctype not in TYPES:
                raise ValueError('По ссылке не картинка (нужен PNG, JPEG, GIF, WebP или BMP)')
            data = resp.read(max_mb * 1024 * 1024 + 1)
        if len(data) > max_mb * 1024 * 1024:
            raise ValueError(f'Картинка больше {max_mb} МБ')
        return ctype, data

    return retry(get, tries)
