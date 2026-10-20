"""Маршруты HTTP-API: контроллеры разделов с @route и маршрутизатор (первый подходящий по пути и методу)."""

import contextlib
import hashlib
import json
import math
import os
import re
import socket
import threading
import time
import urllib.parse
import zlib
from collections.abc import Iterator
from datetime import date, datetime, timedelta

import admin
import ai_llm
import catalog_admin
import defaults
import images
import logistics_api
import pdf_convert
import pdf_text
from ai_profile import CategoryProfile, ModelFacts
from bitrix import BitrixConf, BitrixQueue, BitrixSync, EconXlsx
from cbr import cbr_key_rate, cbr_rates
from config import (
    APP_DIR,
    DATA_DIR,
    DOCS_DIR,
    DOCS_SHARE,
    IMG_DIR,
    MIME,
    ROOT,
    SERVER_MODE,
    UPDATE_DIR,
    BadRequest,
    docs_path,
    read_text,
    safe_dir,
    safe_file,
    safe_id,
    store,
    write_bytes,
)
from crm import CrmBoard, DealBook, Stages, TaskBook
from desktop import DesktopError, open_file, open_folder, show_in_folder
from equipment_types import load_types, save_user_types, types_builtin_path
from features import FeatureAccess
from images import ImageStore
from kp_files import KpFiles
from kp_templates import (
    TEMPLATES_DIR,
    TemplateError,
    copy_template,
    delete_template,
    list_history,
    list_templates,
    open_template_file,
    put_file,
    reset_template,
    restore_history,
    template_file,
)
from kp_track import DealTrack, Mailer, MailRate, MailTemplate, ReminderList
from server_log import ServerLog
from storage import Conflict, with_rev

_CP = None
_LOGOS = {}  # логотипы производителей: {rev — версия каталога, text — готовый ответ}


def cp() -> object:
    """Справочник контрагентов и проверки (создаётся после подготовки папок данных)."""
    global _CP
    if _CP is None:
        from counterparty import Counterparties

        _CP = Counterparties(store())
    return _CP


WEB_DIR = os.path.join(APP_DIR, 'web')  # интерфейс: index.html, css/, js/, vendor/
WEB_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
}

# политика безопасности страницы: скрипты — только файлы программы (внедрённый в данные скрипт не выполнится);
# unsafe-eval — скелет шаблона КП (skeleton.js) собирается из текста; картинки — свои, data:, blob: и с сайтов поставщиков
CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; "
    "font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
)

# хранилище изображений data/img (по папкам категорий)
IMAGES = ImageStore(IMG_DIR)


def web_file(rel) -> str | None:
    """Файл интерфейса по относительному пути внутри app/web (без выхода за пределы папки)."""
    parts = [x for x in rel.replace('\\', '/').split('/') if x and x not in ('.', '..')]
    f = os.path.join(WEB_DIR, *parts)
    if not os.path.normcase(os.path.abspath(f)).startswith(os.path.normcase(os.path.abspath(WEB_DIR))):
        return None
    return f if os.path.isfile(f) and os.path.splitext(f)[1].lower() in WEB_TYPES else None


WIN_RESERVED = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1, 10)} | {f'LPT{i}' for i in range(1, 10)}


def pdf_of(docx) -> str:
    """PDF рядом с .docx КП, с тем же именем."""
    return os.path.splitext(docx)[0] + '.pdf'


class CbrCache:
    """Курсы и ключевая ставка ЦБ: удачный ответ — в базу; ЦБ недоступен — последний сохранённый (stale)."""

    RETRY = 600
    _failed = {}

    @classmethod
    def get(cls, key, fetch) -> dict:
        res = None
        if time.time() - cls._failed.get(key, 0) >= cls.RETRY:
            try:
                res = fetch()
            except Exception as e:
                res = {'error': str(e)}
            if res and not res.get('error'):
                cls._failed.pop(key, None)
                res = dict(res, fetched=datetime.now().strftime('%Y-%m-%dT%H:%M:%S'))
                try:
                    store().kv_set(key, res)
                except Exception:
                    pass
                return res
            cls._failed[key] = time.time()
        res = res or {'error': 'ЦБ недавно не ответил — повтор позже'}
        last = store().kv_get(key)
        if isinstance(last, dict) and not last.get('error'):
            return dict(
                last,
                stale=True,
                src=(last.get('src') or 'ЦБ РФ') + ' — сохранённое значение, ЦБ сейчас недоступен',
                fetchError=res.get('error', ''),
            )
        return res


PASS = object()  # обработчик: «не мой случай» — ищем следующий маршрут


_ROUTES = []  # (регулярное выражение, методы или None, класс, имя метода) — в порядке объявления


def route(pattern: str, methods: str | tuple | None = None):
    """Обработчик маршрута: pattern — регулярное выражение всего пути, methods — метод, кортеж или None (любой)."""
    ms = None if methods is None else ((methods,) if isinstance(methods, str) else tuple(methods))

    def mark(fn):
        fn._route = (re.compile(rf'\A(?:{pattern})\Z'), ms)  # \Z: «$» пропустил бы «…\n» в конце пути
        return fn

    return mark


class ControllerMeta(type):
    """Маршруты класса регистрируются при его объявлении — в порядке методов в теле класса."""

    def __init__(cls, name, bases, ns) -> None:
        super().__init__(name, bases, ns)
        for attr, fn in ns.items():
            if callable(fn) and hasattr(fn, '_route'):
                rx, ms = fn._route
                _ROUTES.append((rx, ms, cls, attr))


class Controller(metaclass=ControllerMeta):
    """Раздел API."""

    def __init__(self, h, m, path, q) -> None:
        self.h, self.m, self.p, self.q = h, m, path, q

    def __getattr__(
        self, name
    ) -> object:  # self.send_json(...) → h.send_json(...); self.server, self.path, self.headers
        return getattr(self.h, name)

    def json_body(self) -> dict:
        """Тело запроса — объект JSON; иначе BadRequest (400)."""
        try:
            d = json.loads(self.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            raise BadRequest('Неверный запрос: нужен JSON') from None
        if not isinstance(d, dict):
            raise BadRequest('Неверный запрос: нужен объект JSON')
        return d

    @staticmethod
    def no_paths(e) -> str:
        """Текст ошибки для ответа — без путей на диске сервера (C:\\…, /tmp/…)."""
        return re.sub(r'(?:[A-Za-z]:\\|\\\\|/(?:tmp|home|root|var|usr|Users)/)[^\s"\'«»;,)]*', '…', str(e))

    def text(self, code, msg) -> None:
        return self.send(code, 'text/plain; charset=utf-8', msg)

    @staticmethod
    @contextlib.contextmanager
    def user_input() -> Iterator[None]:
        """Ошибка проверки ввода (ValueError с текстом для пользователя) — ответ 400 с этим текстом."""
        try:
            yield
        except ValueError as e:
            raise BadRequest(str(e)) from None

    @staticmethod
    def kp_docx(kid: str) -> str | None:
        """Файл Word сохранённого КП (путь в папке КП) или None — КП ещё не сохранялось в Word или файл убран."""
        rel = store().kp_get(kid, 'docx')
        f = docs_path(rel.strip()) if rel else None
        return f if f and os.path.isfile(f) else None


class Router:
    """Находит контроллер и метод по пути и методу запроса."""

    def __init__(self, routes=None) -> None:
        self.routes = routes if routes is not None else _ROUTES

    def dispatch(self, h) -> object:
        m = 'GET' if h.command == 'HEAD' else h.command
        u = urllib.parse.urlsplit(h.path)
        path = urllib.parse.unquote(u.path)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True, encoding='utf-8'))
        ctrl = {}
        for rx, ms, cls, attr in self.routes:
            if ms is not None and m not in ms:
                continue
            mt = rx.match(path)
            if not mt:
                continue
            c = ctrl.get(cls) or ctrl.setdefault(cls, cls(h, m, path, q))
            # неверный ввод (BadRequest, испорченное тело) — 400 отвечает kp_server.Handler
            try:
                res = getattr(c, attr)(*mt.groups())
            except Conflict as e:  # запись успели изменить другие (X-KP-Rev) — 409
                return h.conflict(e)
            except DesktopError as e:
                return h.send(422, 'text/plain; charset=utf-8', str(e))
            if res is not PASS:
                return res
        return h.not_found()


class WebIndex:
    """index.html с меткой версии в адресе каждого файла интерфейса: браузер хранит файлы, пока они не изменятся."""

    REF = re.compile(r'((?:src|href)=")(/web/[^"?#]+)(")')
    cache = {}  # {(метка index.html, метки файлов): готовые байты}

    @staticmethod
    def tag(f) -> str:
        st = os.stat(f)
        return f'{st.st_mtime_ns:x}-{st.st_size:x}'

    @classmethod
    def build(cls, f: str) -> str:
        with open(f, 'rb') as fh:
            html = fh.read().decode('utf-8')
        refs = [(m.group(2), web_file(m.group(2)[len('/web/') :])) for m in cls.REF.finditer(html)]
        key = (cls.tag(f), *tuple(cls.tag(x) if x else '' for _, x in refs))
        hit = cls.cache.get(key)
        if hit is None:
            tags = {
                u: '%08x' % (zlib.crc32(t.encode()) & 0xFFFFFFFF) for (u, x), t in zip(refs, key[1:], strict=False) if t
            }
            hit = cls.REF.sub(
                lambda m: (
                    m.group(1) + m.group(2) + ('?v=' + tags[m.group(2)] if m.group(2) in tags else '') + m.group(3)
                ),
                html,
            ).encode('utf-8')
            cls.cache = {key: hit}
        return hit


class StaticController(Controller):
    YEAR = 'public, max-age=31536000, immutable'

    @route(r'/|/index\.html|/web/.*')
    def web(self) -> None:
        idx = self.p in ('/', '/index.html')
        f = web_file('index.html' if idx else self.p[len('/web/') :])
        if not f:
            return self.not_found()
        if idx:
            return self.send_file(f, WEB_TYPES['.html'], 'no-cache', CSP, data=WebIndex.build(f))
        # адрес с меткой версии (из index.html) не меняется, пока не изменится файл, — хранится в браузере год
        return self.send_file(
            f, WEB_TYPES[os.path.splitext(f)[1].lower()], self.YEAR if self.q.get('v') else 'no-cache'
        )

    @route(r'/favicon\.ico')
    def favicon(self) -> None:
        icon = os.path.join(APP_DIR, 'icon.ico')
        if not os.path.isfile(icon):
            return self.not_found()
        with open(icon, 'rb') as f:
            return self.send(200, 'image/x-icon', f.read())


class TypesController(Controller):
    @route(r'/api/types')
    def types(self) -> None:
        if self.q.get('builtin') == '1':
            return self.send_json(read_text(types_builtin_path()))
        if self.m == 'PUT':
            self.json_body()
            with self.user_input():
                save_user_types(self.body())
            return self.send_json(load_types())
        text = json.dumps(load_types(), ensure_ascii=False)
        return self.send_cached('types-' + hashlib.md5(text.encode('utf-8')).hexdigest()[:16], lambda: text)


class GeoController(Controller):
    @route(r'/api/geo/(.*)', 'GET')
    def geo(self, act) -> None:
        import geo

        q = self.q
        try:
            if act == 'suggest':
                return self.send_json(geo.suggest(store(), q.get('q', '')))
            if act == 'locate':
                return self.send_json(geo.locate(store(), q.get('q', '')))
            if act == 'reverse':
                return self.send_json(geo.reverse(store(), q.get('lat'), q.get('lon')))
            if act == 'route':
                a, b = (q.get('a') or '').split(','), (q.get('b') or '').split(',')
                if len(a) != 2 or len(b) != 2:
                    raise ValueError('Нужны две точки')
                return self.send_json(geo.RoadRoute.distance_km(store(), a, b))
            if act == 'unshort':
                return self.send_json({'url': geo.unshort(q.get('u', ''))})
        except Exception as e:
            return self.send_json({'error': str(e)[:300] or e.__class__.__name__})
        return self.text(404, 'Нет такого запроса')


class PartiesController(Controller):
    @route(r'/api/party')
    def party(self) -> None:
        return self.send_json(cp().lookup(self.q.get('inn', '')))

    @route(
        r'/api/check/quota'
    )  # сколько проверок Checko (и резерва OFData) осталось сегодня на весь отдел, сколько в очереди
    def quota(self) -> None:
        return self.send_json(cp().quota())

    @route(r'/api/check')
    def check(self) -> None:
        return self.send_json(
            cp().check(self.q.get('inn', ''), force=self.q.get('force') == '1', by=admin.actor(self.h)[1])
        )

    @route(r'/api/integrations/export', 'GET')  # резервная копия ключей (только администратор — см. admin.guard)
    def keys_export(self) -> None:
        return self.send_json(
            {'kind': 'kp-keys', 'v': 1, 'at': datetime.now().isoformat(timespec='seconds'), 'keys': cp().keys()}
        )

    @route(r'/api/integrations')
    def keys(self) -> None:
        if self.m == 'PUT':
            self.json_body()
            with self.user_input():
                saved = cp().save_keys(self.body())
            return self.send_json(saved)
        pub = cp().keys_public()
        if admin.session(self.h, touch=False) is None:  # менеджеру — «задан / не задан» и лимиты, без маски ключа
            pub = {k: v for k, v in pub.items() if not k.endswith('Mask')}
        return self.send_json(pub)

    @route(r'/api/clients', 'GET')
    def clients(self) -> None:
        # справочник не грузится целиком: последние использованные или найденные по названию / ИНН / адресу
        q = self.q
        try:
            limit, offset = max(1, min(int(q.get('limit') or 50), 500)), max(0, min(int(q.get('offset') or 0), 10**9))
        except ValueError:
            limit, offset = 50, 0
        res = store().clients_search(q.get('q', ''), limit, offset)
        res['all'] = store().clients_count() if not q.get('q') else None
        return self.send_json(res)

    @route(r'/api/clients/([^/]+)', ('GET', 'PUT'))
    def client(self, cid) -> None:
        cid = safe_id(cid)
        if self.m == 'GET':
            c = store().client_get(cid, rev=True)
            return self.send_json(c) if c else self.text(404, 'Клиент не найден')
        self.json_body()  # не объект JSON — 400
        return self.send_json(cp().save_client(cid, self.body(), admin.actor(self.h)[1], self.base_rev()))


class TemplatesController(Controller):
    @route(r'/api/templates')
    def templates(self) -> None:
        return self.send_json(list_templates())

    @route(r'/api/templates/folder', 'POST')
    def folder(self) -> None:
        if not self.is_local():
            return self.send_json({'remote': True, 'share': ''})
        os.makedirs(TEMPLATES_DIR, exist_ok=True)
        open_folder(TEMPLATES_DIR)
        return self.send_json({'ok': True})

    @route(r'/api/templates/([A-Za-z0-9_-]+)/([a-z]+)')
    def action(self, tid: str, action) -> None:
        """Редактор шаблона: сохранение файлов, история версий, копия, заводской вариант, открыть в Word."""
        m, q = self.m, self.q
        try:
            if action == 'file' and m == 'PUT':
                put_file(tid, q.get('name', ''), self.body())
                return self.send_json({'ok': True})
            if action == 'history' and m == 'GET':
                return self.send_json(list_history(tid))
            if action == 'restore' and m == 'POST':
                return self.send_json({'ok': True, 'file': restore_history(tid, q.get('name', ''))})
            if action == 'copy' and m == 'POST':
                return self.send_json({'ok': True, 'id': copy_template(tid, q.get('to', ''), q.get('title', ''))})
            if action == 'reset' and m == 'POST':
                reset_template(tid)
                return self.send_json({'ok': True})
            if action == 'delete' and m == 'POST':
                delete_template(tid)
                return self.send_json({'ok': True})
            if action == 'open' and m == 'POST':
                if not self.is_local():
                    return self.send_json({'remote': True})
                open_template_file(tid, q.get('name', ''))
                return self.send_json({'ok': True})
        except TemplateError as e:
            return self.text(400, str(e))
        return self.not_found()

    @route(r'/tpl/([A-Za-z0-9_-]+)/([^/]+)')
    def file(self, tid: str, name) -> None:
        f = template_file(tid, urllib.parse.unquote(name))
        if not f:
            return self.not_found('Файл шаблона не найден')
        ext = os.path.splitext(f)[1].lower()
        ctype = {
            '.json': 'application/json; charset=utf-8',
            '.js': 'text/plain; charset=utf-8',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }.get(ext) or MIME.get(ext, 'application/octet-stream')
        extra = (
            {'Content-Disposition': f'attachment; filename="{os.path.basename(f)}"'}
            if self.q.get('download') == '1'
            else None
        )
        with open(f, 'rb') as fh:
            return self.send(200, ctype, fh.read(), extra)


class SystemController(Controller):
    @route(r'/api/ping')
    def ping(self) -> None:
        base = {
            'ok': True,
            'local': self.is_local(),
            'mode': 'server' if SERVER_MODE else 'local',
            'host': socket.gethostname(),
        }
        if getattr(self.h, '_kp_login', False) and not self.h._kp_user and admin.session(self.h, touch=False) is None:
            return self.send_json(base)  # до входа — без папок, путей и состава базы
        far = not self.is_local() and admin.session(self.h, touch=False) is None  # по сети — без путей сервера
        return self.send_json(
            {
                'ok': True,
                'dataDir': '' if far else DATA_DIR,
                'docsDir': '' if far else DOCS_DIR,
                'local': self.is_local(),
                'mode': 'server' if SERVER_MODE else 'local',
                'docsShare': DOCS_SHARE,
                'host': socket.gethostname(),
                'port': self.server.server_address[1],
                'items': store().catalog_count(),
                'migrations': (store().kv_get('migrations') or [])[-2:],
            }
        )


class CatalogController(Controller):
    @route(r'/api/catalog', 'GET')
    def catalog(self) -> None:
        # список — облегчённые карточки (без таблиц характеристик и галерей); полная позиция — по id
        full = self.q.get('full') == '1'
        return self.send_cached(
            'cat{}-{}'.format('f' if full else 'l', store().data_rev('catalog')),
            lambda: store().catalog_full() if full else store().catalog_light(),
        )

    # каталог 20 000+: браузер хранит каталог у себя (IndexedDB) и докачивает изменения после своего номера
    @route(r'/api/catalog/sync', 'GET')
    def sync(self) -> None:
        from catalog_sync import CatalogSync

        cs = CatalogSync(store())
        d = cs.delta(self.q.get('since'), self.q.get('epoch') or '')
        if d is not None:
            return self.send(
                200, 'application/json; charset=utf-8', cs.delta_json(d).encode('utf-8'), {'Cache-Control': 'no-store'}
            )
        st = cs.state()
        return self.send_cached('cats-{}-{}'.format(st['epoch'], st['seq']), cs.full_json)

    # поиск по характеристикам (строка поиска позиции хранится на сервере, не в браузере)
    @route(r'/api/catalog/search', 'GET')
    def search(self) -> None:
        from catalog_sync import CatalogSync

        return self.send_json({'q': self.q.get('q') or '', 'ids': CatalogSync(store()).search(self.q.get('q') or '')})

    @route(
        r'/api/catalog/sources', 'GET'
    )  # фиды-источники позиций: id → поставщик (из справочника, если фид к нему привязан)
    def sources(self) -> None:
        sups = {x.get('id'): x.get('name') for x in store().suppliers_list()}
        return self.send_json(
            {
                f['id']: {
                    'name': sups.get(f.get('supplier')) or f.get('name') or f['id'],
                    'feed': f.get('name') or f['id'],
                }
                for f in (store().kv_get('feeds') or {}).get('items', [])
                if f.get('id')
            }
        )

    @route(r'/api/catalog/pending')  # режим модерации и товары с правками на модерации (бейдж «На модерации»)
    def pending(self) -> None:
        return self.send_json(
            {'moderation': bool(admin.moderation(store()).get('enabled')), 'ids': store().pending_ids()}
        )

    @route(r'/api/catalog/([^/]+)', 'GET')  # запись позиции — PUT в admin.guard (модерация, права)
    def item(self, cid) -> None:
        doc = store().catalog_get(safe_id(cid), rev=True)
        return self.send_json(doc) if doc else self.not_found()

    # изображения: папки «раздел/категория/производитель» латиницей (app/images.py); одинаковые хранятся один раз
    @route(r'/api/img', 'POST')
    def img_put(self) -> None:
        data, q = self.body(), self.q
        mb = defaults.SrvVal.get(store(), 'kp.imgMB')
        if len(data) > mb * 1024 * 1024:
            return self.text(413, f'Картинка больше {mb} МБ — уменьшите её (предел — «Значения программы»)')
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            ext = '.png'
        elif data[:3] == b'\xff\xd8\xff':
            ext = '.jpg'
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            ext = '.webp'
        elif data[:5] == b'%PDF-' and q.get('kind') == 'booklet':  # буклет цветовых решений заказчика — ещё и PDF
            ext = '.pdf'
        else:
            return self.text(
                400, 'Нужна картинка JPEG, PNG или WebP' + (' либо файл PDF' if q.get('kind') == 'booklet' else '')
            )
        tmap = {t.get('id'): t for t in load_types()['types']}
        folder, title = images.place(
            tmap.get(q.get('cat')),
            q.get('maker'),
            q.get('model'),
            q.get('name'),
            q.get('kind') or 'photo',
            q.get('caption'),
        )
        rel = IMAGES.put(data, ext, folder, title)
        return self.send_json({'name': rel})

    @route(r'/img/(.+)')
    def img(self, rel) -> None:
        f = IMAGES.path(rel)
        if not f:
            return self.not_found()
        return self.send_file(f, MIME[os.path.splitext(f)[1].lower()], 'private, max-age=604800')


class ManagersController(Controller):
    @route(r'/api/managers', 'GET')
    def managers(self) -> None:
        return self.send_cached('mgr-' + store().data_rev('managers'), lambda: store().managers_list(rev=True))

    @route(r'/api/managers/([^/]+)', 'PUT')
    def manager(self, mid: str) -> None:
        mid, d = safe_id(mid), self.json_body()
        # при входе по паролю менеджер меняет только свою карточку (контакты в его КП); остальные — администратор
        if admin.login_on(self.h) and (getattr(self.h, '_kp_user', None) or {}).get('id') != mid:
            return self.text(403, 'Карточку другого менеджера меняет администратор')
        for k in ('name', 'position', 'phone', 'ext', 'mobile', 'email'):
            if k in d and not isinstance(d[k], str):
                d[k] = '' if d[k] is None else str(d[k])
        try:
            return self.send_json(
                store().manager_put(mid, json.dumps(d, ensure_ascii=False), admin.actor(self.h)[1], self.base_rev())
            )
        except ValueError as e:  # дубль другого менеджера (ФИО, e-mail, мобильный, добавочный)
            return self.text(422, str(e))


class KpController(Controller):
    # PDF: чем можно преобразовать; преобразование присланного DOCX (предпросмотр) без записи в журнал
    @route(r'/api/pdf', 'GET')
    def pdf_tools(self) -> None:
        return self.send_json(pdf_convert.available(cp().keys().get('convertapiKey')))

    @route(r'/api/pdf', 'POST')
    def pdf_convert(self) -> None:
        try:
            data = pdf_convert.convert_bytes(self.body(), cp().keys().get('convertapiKey'))
        except Exception as e:
            return self.text(422, f'PDF не создан: {Controller.no_paths(e)}')
        return self.send(200, 'application/pdf', data, self.attachment(safe_file(self.q.get('name')) or 'КП.pdf'))

    @route(r'/api/history')
    def history(self) -> None:
        if (
            'limit' in self.q
        ):  # постранично, с поиском и итогами по всему отбору; files — число справочных документов КП
            res = admin.KpJournal.page(self.h, store(), self.q)
            n = KpFiles.of(store()).counts([r.get('id') for r in res['items'] if isinstance(r, dict)])
            for r in res['items']:
                if isinstance(r, dict) and n.get(r.get('id')):
                    r['files'] = n[r['id']]
            return self.send_json(res)
        return self.send_json(admin.KpJournal.out(self.h, store().kp_list()))

    @route(r'/api/kp/new', 'POST')
    def new(self) -> None:
        n = store().next_number()
        return self.send_json({'id': n, 'number': n})

    @route(r'/api/kp/([^/]+)/(state|meta)', ('GET', 'PUT'))
    def doc(self, kid: str, field) -> None:
        kid = safe_id(kid)
        if self.m == 'PUT':
            text = self.body().decode('utf-8')
            try:
                if not isinstance(json.loads(text), dict):
                    raise ValueError
            except ValueError:  # испорченная запись ломала бы журнал КП у всех
                return self.text(400, 'Неверный формат КП')
            rev = store().kp_set(
                kid,
                field,
                admin.kp_in(self.h, store(), kid, field, text),
                admin.actor(self.h)[1],
                self.base_rev() if field == 'state' else None,
            )
            if field == 'meta':
                return self.send_json(
                    {'ok': True, 'rev': rev, 'deal': CrmController.on_kp(self.h, kid), 'bx': BitrixConf(store()).on()}
                )
            return self.send_json({'ok': True, 'rev': rev})
        v = store().kp_get(kid, field)
        if v and field == 'state':
            v = with_rev(admin.kp_out(self.h, 'state', v), store().rev_of('kp', kid)['rev'])
            return self.send_json(v)
        return self.send_json(admin.kp_out(self.h, field, v)) if v else self.not_found()

    @route(r'/api/kp/([^/]+)/rev', 'GET')  # кто и когда последним сохранил КП — проверка перед сохранением
    def rev(self, kid: str) -> None:
        return self.send_json(store().rev_of('kp', safe_id(kid)))

    # история версий КП: список и состояние выбранной версии (экономика чужого КП убирается, как и у текущей)
    @route(r'/api/kp/([^/]+)/versions', 'GET')
    def versions(self, kid: str) -> None:
        return self.send_json(store().kp_versions(safe_id(kid)))

    @route(r'/api/kp/([^/]+)/versions/(\d+)', 'GET')
    def version(self, kid: str, n) -> None:
        if len(n) > 9:
            return self.not_found()
        v = store().kp_version_state(safe_id(kid), n)
        return self.send_json(admin.kp_out(self.h, 'state', v)) if v else self.not_found()

    @route(r'/api/kp/([^/]+)/docx', 'PUT')
    def docx_put(self, kid: str) -> None:
        kid, q = safe_id(kid), self.q
        name = safe_file(q.get('name'))
        # только документ Word: имя — с расширением .docx (не .exe, .bat, .lnk…), содержимое — архив docx (PK…)
        if not name.lower().endswith('.docx'):
            name = os.path.splitext(name)[0].rstrip('. ') + '.docx'
        if os.path.splitext(name)[0].split('.')[0].strip().upper() in WIN_RESERVED:
            name = '_' + name
        try:  # документ Word без макросов и внешних шаблонов — его потом открывает Word сервера (PDF)
            pdf_convert.DocxCheck.check(self.body())
        except ValueError as e:
            return self.text(400, f'Файл КП должен быть документом Word (.docx): {e}')
        sub = safe_dir(q.get('dir'))  # папка менеджера (фамилия)
        rel = (sub + '/' + name) if sub else name
        # имя занято файлом другого КП (два КП по одной закупке: «4567892 КП») — «4567892 КП (2)», «(3)»…
        stem, ext = os.path.splitext(name)
        for k in range(2, 100):
            if not store().kp_docx_owner(rel, kid):
                break
            name = f'{stem} ({k}){ext}'
            rel = (sub + '/' + name) if sub else name
        f = docs_path(rel)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        write_bytes(f, self.body())
        # прежний PDF устарел: создаётся заново, если его попросили сохранить
        stale = [pdf_of(f)]
        # при пересохранении КП под новым именем старый файл убираем, чтобы не копились дубли
        prev = store().kp_get(kid, 'docx')
        if prev:
            old = docs_path(prev.strip())
            if os.path.isfile(old) and os.path.normcase(old) != os.path.normcase(f):
                stale += [old, pdf_of(old)]
        for x in stale:
            try:
                if os.path.isfile(x):
                    os.remove(x)
            except OSError:
                pass
        store().kp_set(kid, 'docx', rel)
        return self.send_json({'ok': True, 'path': f if self.is_local() else '', 'rel': rel})

    @route(r'/api/kp/([^/]+)/docx', 'GET')
    def docx_get(self, kid: str) -> None:
        # скачивание готового КП — для сотрудников, открывших программу по сети
        f = self.kp_docx(safe_id(kid))
        if not f:
            return self.not_found('Файл КП не найден')
        with open(f, 'rb') as fh:
            data = fh.read()
        return self.send(
            200,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data,
            self.attachment(os.path.basename(f), 'KP.docx'),
        )

    # PDF сохранённого КП: создаётся рядом с .docx (тем же именем), скачивается сотрудниками по сети
    @route(r'/api/kp/([^/]+)/pdf')
    def pdf(self, kid: str) -> object:
        f = self.kp_docx(safe_id(kid))
        if not f:
            return self.not_found('Файл КП не найден')
        pdf = pdf_of(f)
        if self.m == 'POST':
            try:
                pdf_convert.convert_file(f, pdf, cp().keys().get('convertapiKey'))
            except Exception as e:
                return self.text(422, f'PDF не создан: {Controller.no_paths(e)}')
            return self.send_json({'ok': True, 'path': pdf if self.is_local() else '', 'local': self.is_local()})
        if self.m == 'GET':
            if not os.path.isfile(pdf):
                return self.not_found('PDF этого КП ещё не создан')
            with open(pdf, 'rb') as fh:
                return self.send(200, 'application/pdf', fh.read(), self.attachment(os.path.basename(pdf)))
        return PASS

    @route(r'/api/kp/([^/]+)/openpdf', 'POST')
    def open_pdf(self, kid: str) -> None:
        rel = store().kp_get(safe_id(kid), 'docx')
        pdf = pdf_of(docs_path(rel.strip())) if rel else None
        if not pdf or not os.path.isfile(pdf):
            return self.not_found('PDF этого КП ещё не создан')
        if not self.is_local():
            return self.send_json({'remote': True, 'download': f'/api/kp/{safe_id(kid)}/pdf'})
        open_file(pdf)
        return self.send_json({'ok': True})

    @route(r'/api/kp/([^/]+)/(open|folder)', 'POST')
    def open_doc(self, kid: str, how) -> None:
        rel = store().kp_get(safe_id(kid), 'docx')
        if not rel:
            return self.not_found('Файл КП не найден')
        if not self.is_local():  # открыть Word можно только на своём компьютере — сотруднику по сети отдаём файл
            return self.send_json(
                {
                    'remote': True,
                    'download': f'/api/kp/{safe_id(kid)}/docx',
                    'share': (DOCS_SHARE.rstrip('\\/') + '\\' + rel.replace('/', '\\')) if DOCS_SHARE else '',
                }
            )
        f = docs_path(rel.strip())
        if not os.path.isfile(f):
            return self.not_found('Файл КП был перемещён или удалён')
        if os.path.splitext(f)[1].lower() not in ('.docx', '.pdf'):  # запускать на компьютере можно только документ
            return self.text(400, 'Это не документ Word — файл не открывается')
        if how == 'open':
            open_file(f)
        else:
            show_in_folder(f)
        return self.send_json({'ok': True})

    @route(r'/api/folder', 'POST')
    def docs_folder(self) -> None:
        sub = safe_dir(self.q.get('dir'))
        target = os.path.join(DOCS_DIR, sub) if sub else DOCS_DIR
        os.makedirs(target, exist_ok=True)
        if not self.is_local():
            return self.send_json(
                {
                    'remote': True,
                    'share': (DOCS_SHARE.rstrip('\\/') + ('\\' + sub if sub else '')) if DOCS_SHARE else '',
                }
            )
        open_folder(target)
        return self.send_json({'ok': True})


class KpFilesController(Controller):
    """Паспорта, сертификаты, схемы к КП — в документ КП не входят."""

    def _kp_ok(self, kid: str) -> bool:
        """КП есть в журнале; КП в корзине — только администратору (его документы ждут восстановления)."""
        return store().kp_get(kid, 'meta') is not None or admin.session(self.h, touch=False) is not None

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files', ('GET', 'POST'))
    def files(self, kid: str) -> None:
        kf = KpFiles.of(store())
        if self.m == 'GET':
            if not self._kp_ok(kid):
                return self.not_found('КП не найдено')
            return self.send_json({'items': kf.list(kid, admin.actor(self.h)[0]), 'limits': kf.limits()})
        if store().kp_get(kid, 'meta') is None:
            return self.text(400, 'Сначала сохраните КП, затем прикрепите документы')
        uid, name, _role = admin.actor(self.h)
        with self.user_input():
            rec = kf.add(kid, self.q.get('name', ''), self.body(), self.q.get('note', ''), name, uid)
        admin.log(self.h, store(), 'add_kp_file', 'kp', kid, None, {'name': rec['name'], 'size': rec['size']})
        CrmController.bx(DealBook(store()).deal_of(kid))
        return self.send_json(rec)

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files/(\d{1,9})', ('GET', 'PUT'))
    def file(self, kid: str, fid: str) -> None:
        kf = KpFiles.of(store())
        if not self._kp_ok(kid):
            return self.not_found('КП не найдено')
        if self.m == 'PUT':
            note = self.json_body().get('note')
            if note is not None and not isinstance(note, str):
                raise BadRequest('Примечание — строка')
            old = kf.get(kid, fid)
            try:
                rec = kf.set_note(kid, fid, note or '')
            except LookupError as e:
                return self.not_found(str(e))
            admin.log(
                self.h,
                store(),
                'edit_kp_file',
                'kp',
                kid,
                {'name': old['name'], 'note': old['note']},
                {'note': rec['note']},
            )
            return self.send_json(rec)
        got = kf.read(kid, fid)
        if not got:
            return self.not_found('Документ не найден')
        rec, data = got
        return self.send(
            200,
            rec['mime'] or 'application/octet-stream',
            data,
            self.attachment(rec['name'], 'document.' + (rec['ext'] or 'bin')),
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files/(\d{1,9})/remove', 'POST')
    def remove_own(self, kid: str, fid: str) -> None:
        """Автор удаляет свой файл, прикреплённый по ошибке, — только в первые kp.fileUndoMin минут после загрузки."""
        try:
            rec = KpFiles.of(store()).delete_own(kid, fid, admin.actor(self.h)[0])
        except LookupError as e:
            return self.not_found(str(e))
        except PermissionError as e:
            return self.text(403, str(e))
        admin.log(
            self.h,
            store(),
            'delete_kp_file',
            'kp',
            kid,
            {'name': rec['name'], 'size': rec['size'], 'author': True},
            None,
        )
        return self.send_json({'ok': True})


class ToolsController(Controller):
    @route(r'/api/cbr')
    def cbr(self) -> None:
        return self.send_json(CbrCache.get('cbr_last', cbr_rates))

    @route(r'/api/cbr/keyrate')
    def keyrate(self) -> None:
        return self.send_json(CbrCache.get('keyrate_last', cbr_key_rate))

    # картинки карточек: логотипы производителей из каталога; картинка, перетащенная со страницы сайта
    @route(r'/api/logos', 'GET')
    def logos(self) -> None:
        # логотипы зависят только от каталога: расчёт (~0,5 с на большом каталоге) — один раз на его версию
        import imgfetch

        rev = store().data_rev('catalog')
        if _LOGOS.get('rev') != rev:
            _LOGOS.update(rev=rev, text=json.dumps(imgfetch.logos(store()), ensure_ascii=False))
        return self.send_cached('logos-' + rev, lambda: _LOGOS['text'])

    @route(r'/api/imgfetch', 'GET')
    def imgfetch(self) -> None:
        import imgfetch

        try:
            ctype, data = imgfetch.fetch_image(self.q.get('url') or '')
        except Exception as e:
            return self.text(422, f'Картинка не загружена: {e}')
        return self.send(200, ctype, data)

    @route(r'/api/ai/status', 'GET')  # нейросеть в программе: включена ли (без ключа и адреса)
    def ai_status(self) -> None:
        return self.send_json(ai_llm.status(store()))

    @route(r'/api/ai/profile', 'GET')  # образец объёма категории и данные этой же модели из каталога — для запроса к ИИ
    def ai_profile(self) -> None:
        q = self.q
        return self.send_json(
            {
                'profile': CategoryProfile(store()).get(str(q.get('cat') or '')[:40]),
                'facts': ModelFacts(store()).find(
                    q.get('maker', '')[:100], q.get('model', '')[:100], q.get('name', '')[:300], q.get('id', '')[:64]
                ),
            }
        )

    @route(r'/api/ai/fill', 'POST')  # автозаполнение: запрос из программы → ответ нейросети (JSON строкой)
    def ai_fill(self) -> None:
        d = self.json_body()
        try:
            return self.send_json(ai_llm.ask(store(), d.get('prompt')))
        except RuntimeError as e:
            return self.text(422, str(e))

    @route(r'/api/pagetext', 'POST')  # текст и характеристики со страницы товара — для автозаполнения карточки
    def pagetext(self) -> None:
        import feeds

        d = self.json_body()
        try:
            return self.send_json(feeds.page_text(str(d.get('url') or '').strip(), defaults.img_opts(store())))
        except Exception as e:
            return self.text(422, f'Страница не прочитана: {str(e)[:200]}')

    def _too_big(self, what) -> bool:
        """Документ для разбора больше допустимого («Значения программы»): ответить 413 и вернуть True."""
        mb = defaults.SrvVal.get(store(), 'cat.docMaxMB')
        if self.body_size() <= mb * 1024 * 1024:
            return False
        self.text(413, f'{what} больше {mb} МБ')
        return True

    @route(r'/api/pdftext', 'POST')  # текст из PDF (паспорт, каталог, ТЗ) — для автозаполнения карточки
    def pdftext(self) -> None:
        if self._too_big('PDF'):
            return None
        try:
            r = pdf_text.text(self.body())
            r.pop('per', None)  # текст по страницам — только для разбора ТЗ
            return self.send_json(r)
        except Exception as e:
            return self.text(422, f'PDF не прочитан: {str(e)[:200]}')

    @route(r'/api/tz/parse', 'POST')  # ТЗ заказчика (PDF, DOCX, XLSX, ODT, RTF, TXT): текст и требования к станции
    def tz_parse(self) -> None:
        from doc_text import DocText
        from tz_parse import TzParse

        if self._too_big('Файл'):
            return None
        try:
            doc = DocText.extract(str(self.q.get('name') or '')[:200], self.body())
        except Exception as e:
            return self.text(422, f'ТЗ не прочитано: {str(e)[:200]}')
        r = TzParse.parse(doc['text'])
        r.update(
            text=doc['text'][:20000].replace('\f', '\n'),
            doc={
                'kind': doc['kind'],
                'pages': doc.get('pages'),
                'chars': len(doc['text']),
                'quality': doc.get('quality'),
                'low': doc.get('low'),
                'methods': doc.get('methods') or [],
            },
        )
        return self.send_json(r)

    @route(
        r'/api/rules/stations\.js', 'GET'
    )  # инженерные правила станций — скриптом до модулей расчёта (StationRules.use)
    def rules_stations_js(self) -> None:
        from station_rules import StationRules

        return self.send(
            200,
            'text/javascript; charset=utf-8',
            StationRules(store()).js().encode('utf-8'),
            {'Cache-Control': 'no-cache'},
        )

    @route(
        r'/api/rules/stations', 'GET'
    )  # то же — JSON (просмотр, выгрузка, документ «Инженерные правила и источники»)
    def rules_stations(self) -> None:
        from station_rules import StationRules

        sr = StationRules(store())
        return self.send_json({'rules': sr.current(), 'info': sr.info()})

    @route(r'/api/pagephotos', 'POST')  # фото со страницы товара на сайте поставщика — в изображения позиции
    def pagephotos(self) -> None:
        import feeds

        d = self.json_body()
        tmap = {t.get('id'): t for t in load_types()['types']}
        try:
            return self.send_json(
                feeds.page_photos(
                    store(),
                    IMAGES,
                    str(d.get('url') or '').strip(),
                    tmap.get(d.get('cat')),
                    d.get('maker') or '',
                    d.get('model') or '',
                    d.get('name') or '',
                    d.get('urls') if isinstance(d.get('urls'), list) else None,
                )
            )
        except Exception as e:
            return self.text(422, f'Фото со страницы не загружены: {str(e)[:200]}')


class SettingsController(Controller):
    MAX_UITEXTS = 3000  # изменённых текстов интерфейса

    @route(r'/api/lists', 'GET')  # списки и выборы от администратора (для всех; правка — /api/admin/lists)
    def lists(self) -> None:
        from lists import ListStore

        return self.send_json(ListStore(store()).all())

    @route(r'/api/defaults', 'GET')  # значения по умолчанию от администратора (для всех)
    def defaults(self) -> None:
        return self.send_json(defaults.get(store()))

    @route(r'/api/logistics/quote', 'POST')  # цены перевозчиков (ATI.SU, ПЭК, Деловые Линии, КИТ) — итог по максимуму
    def quote(self) -> None:
        req = self.json_body()
        try:
            return self.send_json(logistics_api.DeliveryQuote(store(), req).run())
        except (ValueError, TypeError, KeyError) as e:
            return self.text(400, f'Неверный запрос: {e}')

    @route(r'/api/logistics/status', 'GET')
    def logistics_status(self) -> None:
        return self.send_json(
            {
                'providers': logistics_api.providers(store()),
                'auto': store().kv_get('logisticsAuto'),
                'settings': logistics_api.auto_settings(store()),
            }
        )

    @route(r'/api/logistics/refresh', 'POST')  # обновить ставки по ATI.SU сейчас (администратор)
    def logistics_refresh(self) -> None:
        try:
            rec = logistics_api.auto_refresh(store(), force=True)
        except Exception as e:
            return self.text(502, f'ATI.SU: {e}')
        return self.send_json(rec or {'error': 'Не задан ключ ATI.SU («Интеграции») или обновление уже идёт'})

    @route(r'/api/logistics/carriers', ('GET', 'PUT'))  # перевозчики: включение и адреса API (изменяет администратор)
    def logistics_carriers(self) -> None:
        if self.m == 'PUT':
            d = self.json_body()
            with self.user_input():
                saved = logistics_api.CarrierApi.save(store(), d, admin.actor(self.h)[1])
            return self.send_json(saved)
        return self.send_json(logistics_api.CarrierApi.public(store()))

    @route(r'/api/logistics/carriers/test', 'POST')  # пробный расчёт одного перевозчика (администратор)
    def logistics_carrier_test(self) -> None:
        carrier = str(self.json_body().get('id') or '')
        with self.user_input():
            res = logistics_api.CarrierApi.test(store(), carrier)
        return self.send_json(res)

    @route(
        r'/api/logistics/china', ('GET', 'PUT')
    )  # доставка из Китая (только администратор): ставки экспедиторов, направления ATI.SU
    def china(self) -> None:
        from china_freight import ChinaFreight

        cf = ChinaFreight(store())
        if self.m == 'PUT':
            rows = self.json_body().get('rows')
            with self.user_input():
                saved = cf.save_rates(rows, admin.actor(self.h)[1])
            return self.send_json(saved)
        return self.send_json(cf.status())

    @route(r'/api/logistics/china/quote', 'POST')  # расчёт Китай → граница РФ (в экономику сделки не идёт)
    def china_quote(self) -> None:
        from china_freight import ChinaFreight

        req = self.json_body()
        with self.user_input():
            res = ChinaFreight(store()).quote(req, CbrCache.get('cbr_last', cbr_rates))
        return self.send_json(res)

    @route(r'/api/logistics')  # тарифы доставки по России (общие для отдела; изменяет администратор)
    def logistics(self) -> None:
        if self.m == 'PUT':
            try:
                body = self.json_body()
            except BadRequest:
                raise BadRequest('Неверный формат тарифов') from None
            with self.user_input():
                d = logistics_api.TariffInput.check(body)
            d['updatedAt'] = datetime.now().isoformat(timespec='seconds')
            d['updatedBy'] = admin.actor(self.h)[1]
            store().kv_set('logistics', d)
            return self.send_json({'ok': True})
        return self.send_json(dict(store().kv_get('logistics') or {}, _auto=store().kv_get('logisticsAuto')))

    @route(r'/api/uitexts', 'GET')  # тексты интерфейса, изменённые администратором: {исходный текст: новый}
    def uitexts(self) -> None:
        return self.send_json(store().kv_get('uitexts') or {})

    @route(r'/api/uitexts', 'PUT')  # только администратор (admin.guard)
    def uitexts_put(self) -> None:
        try:
            d = self.json_body()
        except BadRequest:
            raise BadRequest('Неверный формат') from None
        if len(d) > self.MAX_UITEXTS:
            raise BadRequest('Неверный формат')
        out = {str(k)[:2000]: str(v)[:4000] for k, v in d.items() if str(k).strip() and isinstance(v, str)}
        store().kv_set('uitexts', out)
        return self.send_json({'ok': True, 'count': len(out)})

    @route(r'/api/version', 'GET')  # версия программы и установленное обновление
    def version(self) -> None:
        import version

        return self.send_json({'version': version.VERSION, 'patched': bool(UPDATE_DIR), 'updateDir': UPDATE_DIR})

    @route(r'/api/calendar', 'GET')  # производственный календарь РФ (рабочие / банковские дни)
    def calendar(self) -> None:
        import workcal

        with self.user_input():
            cal = workcal.year(store(), int(self.q.get('year') or 0))
        return self.send_json(cal)


class DealController(Controller):
    @route(r'/api/suppliers', 'GET')
    def suppliers(self) -> None:
        return self.send_cached('sup-' + store().data_rev('suppliers'), lambda: store().suppliers_list())

    @route(r'/api/suppliers/([A-Za-z0-9_-]{1,64})', 'PUT')
    def supplier(self, sid) -> None:
        if not catalog_admin.power(
            self.h, 'catSelfMod', 'PUT'
        ):  # справочник поставщиков — администратор и право «Без модерации»
            return self.text(403, 'Справочник поставщиков меняет администратор или менеджер с правом «Без модерации»')
        d = self.json_body()
        with self.user_input():
            saved = store().supplier_put(sid, d, admin.actor(self.h)[1], self.base_rev())
        return self.send_json(saved)

    @route(r'/api/customs', ('GET', 'PUT'))
    def customs(self) -> None:
        if self.m == 'GET':
            return self.send_json(store().customs_all())
        d = self.json_body()
        with self.user_input():
            store().customs_put(
                d.get('key'), d.get('code'), d.get('duty'), d.get('note'), admin.actor(self.h)[1], d.get('name')
            )
        return self.send_json({'ok': True})


class TrackController(Controller):
    @staticmethod
    def _obj(text) -> dict:
        """Объект JSON из базы; пусто или испорчено — {}."""
        try:
            d = json.loads(text) if text else {}
        except (TypeError, ValueError):
            return {}
        return d if isinstance(d, dict) else {}

    @route(
        r'/api/kp/([A-Za-z0-9_-]{1,64})/track', 'PUT'
    )  # статус, причина, заметка, напоминание (права — admin.guard по /api/kp/<id>/)
    def track(self, kid: str) -> None:
        if not store().kp_get(kid, 'meta'):
            return self.not_found('Сначала сохраните КП')
        with self.user_input():
            tr, changed = DealTrack(store()).update(kid, self.json_body(), admin.actor(self.h)[1])
        if changed:
            admin.log(self.h, store(), 'kp_status', 'kp', kid, None, changed)
            CrmController.safe(lambda: CrmController.bx(DealBook(store()).refresh(kid, admin.actor(self.h)[1])))
        return self.send_json({'ok': True, 'track': tr})

    @route(
        r'/api/kp/([A-Za-z0-9_-]{1,64})/econ', 'PUT'
    )  # Excel экономики сделки (собран в браузере автора) — для Битрикс24
    def econ(self, kid: str) -> None:
        meta = self._obj(store().kp_get(kid, 'meta'))
        if not meta:
            return self.not_found('Сначала сохраните КП')
        if not admin.deal_allowed(self.h, meta):
            return self.text(403, 'Экономика сделки — только автору КП и администратору')
        if not BitrixConf(store()).on():
            return self.send_json({'ok': False})
        with self.user_input():
            EconXlsx(store()).save(kid, self.body())
        CrmController.bx(DealBook(store()).deal_of(kid))
        return self.send_json({'ok': True})

    @route(r'/api/reminders', 'GET')  # напоминания менеджера: перезвонить, срок действия КП, нет ответа
    def reminders(self) -> None:
        h = self.h
        uid, name, _ = admin.actor(h, admin=False)
        everyone = admin.session(h, touch=False) is not None and not uid

        def mine(m) -> bool:
            if everyone:
                return True
            author = m.get('authorId') or m.get('managerId')
            if author and uid:
                return author == uid
            return bool(name) and str(m.get('manager') or '').strip().lower() == str(name).strip().lower()

        rows = []
        for kid, meta, track in store().kp_tracked(
            (date.today() - timedelta(days=defaults.SrvVal.get(store(), 'kp.remindDays'))).isoformat()
        ):
            m = self._obj(meta)
            if admin.login_on(h) and not admin.own_kp(h, m) and not admin.perm(h, 'kpOthers'):
                continue
            if not mine(m):
                continue
            # состояние КП (бывает в мегабайтах) — только своим КП и только если срок действия не записан в описании
            rows.append(
                (kid, m, self._obj(track), {} if m.get('validUntil') else self._obj(store().kp_get(kid, 'state')))
            )
        items = ReminderList(store=store()).collect(rows, mine)
        return self.send_json({'items': items, 'count': len(items)})

    @route(r'/api/features', 'GET')  # какие функции программы включены (для всех; правка — /api/admin/features)
    def features(self) -> None:
        return self.send_json(self._features())

    def _features(self) -> dict:
        """Функции программы, доступные тому, кто прислал запрос."""
        return FeatureAccess(store()).for_user(
            admin.session(self.h, touch=False) is not None, admin.actor(self.h, admin=False)[0] or ''
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/mailform', 'GET')  # письмо клиенту: адреса и текст по умолчанию
    def mailform(self, kid: str) -> None:
        st, mt = self._obj(store().kp_get(kid, 'state')), self._obj(store().kp_get(kid, 'meta'))
        mp = Mailer(store()).public()
        tpl = MailTemplate(st, mt, mp.get('fromName') or '')
        word = self.kp_docx(kid)
        pdf = pdf_of(word) if word and os.path.isfile(pdf_of(word)) else None
        ct = st.get('contact') if isinstance(st.get('contact'), dict) else {}
        files = []
        if self._features().get('kpFiles'):
            files = [{k: x[k] for k in ('id', 'name', 'size', 'note')} for x in KpFiles.of(store()).list(kid)]
        return self.send_json(
            {
                'on': mp['on'],
                'to': str(ct.get('email') or '').strip(),
                'cc': tpl.vars['e-mail'],
                'subject': tpl.fill(mp['subject']),
                'body': tpl.fill(mp['body']),
                'word': os.path.basename(word) if word else '',
                'pdf': os.path.basename(pdf) if pdf else '',
                'wordSize': os.path.getsize(word) if word else 0,
                'pdfSize': os.path.getsize(pdf) if pdf else 0,
                'files': files,
                'mailMB': defaults.SrvVal.get(store(), 'kp.mailMB'),
                'sent': (store().kp_track_get(kid).get('sent') or [])[-5:],
            }
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/send', 'POST')  # отправить КП клиенту по почте
    def send_kp(self, kid: str) -> None:
        d = self.json_body()
        with self.user_input():
            to, cc = Mailer.addresses(d.get('to')), Mailer.addresses(d.get('cc'))
        if not to:
            raise BadRequest('Укажите адрес получателя')
        f = self.kp_docx(kid)
        if not f:
            return self.not_found('Файл КП не найден — сохраните КП')
        files = []
        if d.get('word', True):
            with open(f, 'rb') as fh:
                files.append(
                    (
                        os.path.basename(f),
                        fh.read(),
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    )
                )
        if d.get('pdf'):
            pdf = pdf_of(f)
            if not os.path.isfile(pdf):
                try:
                    pdf_convert.convert_file(f, pdf, cp().keys().get('convertapiKey'))
                except Exception as e:
                    return self.text(422, f'PDF не создан: {str(e)[:200]}')
            with open(pdf, 'rb') as fh:
                files.append((os.path.basename(pdf), fh.read(), 'application/pdf'))
        if not files:
            raise BadRequest('Выберите файл: Word или PDF')
        if d.get('files') and self._features().get('kpFiles'):  # отмеченные справочные документы КП
            if not isinstance(d['files'], list):
                raise BadRequest('Неверный список документов')
            with self.user_input():
                files += KpFiles.of(store()).for_mail(kid, d['files'], sum(len(x[1]) for x in files))
        st = self._obj(store().kp_get(kid, 'state'))
        reply = str((st.get('manager') or {}).get('email') or '') if isinstance(st.get('manager'), dict) else ''
        with self.user_input():
            u = getattr(
                self.h, '_kp_user', None
            )  # без входа по паролю «кто» — заголовок запроса: считаем по компьютеру
            MailRate.take(store(), 'u:{}'.format(u['id']) if u else f'ip:{self.h.client_address[0]}')
        try:
            Mailer(store()).send(
                to, cc, str(d.get('subject') or '')[:300], str(d.get('body') or '')[:20000], files, reply
            )
        except RuntimeError as e:
            admin.log(self.h, store(), 'send_kp', 'kp', kid, None, {'to': to, 'error': str(e)[:200]}, result='failed')
            return self.text(422, str(e))
        tr = DealTrack(store()).mark_sent(kid, to + cc, [x[0] for x in files], admin.actor(self.h)[1])
        CrmController.safe(lambda: CrmController.bx(DealBook(store()).refresh(kid, admin.actor(self.h)[1])))
        CrmController.safe(lambda: CrmController.mailed(kid, to + cc, admin.actor(self.h)[1]))
        admin.log(self.h, store(), 'send_kp', 'kp', kid, None, {'to': to, 'cc': cc, 'files': [x[0] for x in files]})
        return self.send_json({'ok': True, 'track': tr})

    @route(
        r'/api/report', 'GET'
    )  # отчёт по КП за период: описания (права — как в журнале) и позиции для расчёта по категориям
    def report(self) -> None:
        q = self.q
        d1, d2 = str(q.get('from') or '')[:10], str(q.get('to') or '')[:10] or '9999-12-31'
        docs = [
            d
            for d in map(
                self._obj,
                store().kp_metas_where(
                    q.get('q', ''), q.get('author', ''), q.get('kind', ''), '', d1, str(q.get('to') or '')[:10]
                ),
            )
            if d and d1 <= str(d.get('date') or '')[:10] <= d2
        ]
        rows = admin.KpJournal.rows(self.h, docs)
        states = store().kp_states(
            [r.get('id') for r in rows if isinstance(r, dict) and r.get('id') and not r.get('locked')]
        )
        deal_on = self._features()['deal']  # экономика недоступна — без прибыли
        for r in rows:
            sr, pr = admin.econ_rub(r)
            r['sumRub'], r['profitRub'] = sr, (pr if deal_on else None)
            if not deal_on:
                for k in ('econ', 'deal'):
                    r.pop(k, None)
            if r.get('locked') or not deal_on:
                continue
            st = self._obj(states.get(r.get('id') or ''))
            r['calc'] = {
                'vat': st.get('vat'),
                'pricing': {k: (st.get('pricing') or {}).get(k) for k in ('cur', 'rates', 'costNoVat')},
                'items': [
                    {
                        k: x.get(k)
                        for k in ('name', 'qty', 'price', 'disc', 'options', 'cost', 'costCur', 'attrs', 'kit')
                    }
                    for x in (st.get('items') or [])
                    if isinstance(x, dict)
                ],
            }
        return self.send_json({'items': rows})


class DraftsController(Controller):
    """Черновики КП на сервере (у каждого менеджера свои, автосохранение) и заготовки КП (общие для всех)."""

    KINDS = {'drafts': 'draft', 'presets': 'preset'}
    MAX_STATE = 25 * 1024 * 1024
    PRESET_DROP = (
        'kpId',
        'number',
        'createdAt',
        'authorId',
        'managerId',
        'manager',
        'date',
        'client',
        'clientId',
        'clientInn',
        'clientKpp',
        'clientOgrn',
        'clientFull',
        'clientAddr',
        'clientDir',
        'clientDirPost',
        'clientStatus',
        'contact',
        'object',
        'check',
        'tender',
        'deal',
    )

    def _who(self) -> tuple:
        uid, name, _ = admin.actor(self.h, admin=False)
        return uid or '', name or ''

    def _mine(self, row) -> bool:
        # черновик без автора (сохранён до выбора менеджера на устройстве) — того, кто с ним работает
        return (
            row['owner'] == self._who()[0]
            or (row['kind'] == 'draft' and not row['owner'])
            or admin.session(self.h, touch=False) is not None
        )

    @route(r'/api/(drafts|presets)', 'GET')
    def list(self, kind) -> None:
        k = self.KINDS[kind]
        return self.send_json(
            {'items': store().drafts_list(k, self._who()[0] if k == 'draft' else None), 'me': self._who()[0]}
        )

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})', 'GET')
    def get(self, kind, did) -> None:
        row, state = store().draft_get(did)
        if not row or row['kind'] != self.KINDS[kind]:
            return self.not_found('Черновик не найден' if kind == 'drafts' else 'Заготовка не найдена')
        if kind == 'drafts' and not self._mine(row):
            return self.text(403, 'Это черновик другого менеджера')
        return self.send(
            200,
            'application/json; charset=utf-8',
            ('{{"row":{},"data":{}}}'.format(json.dumps(row, ensure_ascii=False), state or '{}')).encode('utf-8'),
        )

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})', 'PUT')
    def put(self, kind, did) -> None:
        k = self.KINDS[kind]
        raw = self.body()
        if len(raw) > self.MAX_STATE:
            return self.text(
                413, 'Черновик слишком большой (больше 25 МБ) — уберите вставленные картинки большого размера'
            )
        d = self.json_body()
        st = d.get('state')
        if not isinstance(st, dict):
            raise BadRequest('Нет состояния КП')
        old, _ = store().draft_get(did)
        if old and (old['kind'] != k or not self._mine(old)):
            return self.text(403, 'Это запись другого менеджера')
        uid, name = self._who()
        items = st.get('items') if isinstance(st.get('items'), list) else []
        try:
            total = float(d.get('sum') or 0)
        except (TypeError, ValueError):
            total = 0.0
        if not math.isfinite(total):
            total = 0.0
        keep = old and old['owner']  # черновик без автора получает автора при сохранении
        row = {
            'id': did,
            'kind': k,
            'owner': old['owner'] if keep else uid,
            'owner_name': old['owner_name'] if keep else name,
            'title': str(d.get('title') or '')[:120],
            'client': str(st.get('client') or '')[:200],
            'kp': str(st.get('number') or '')[:40] if st.get('kpId') and k == 'draft' else '',
            'positions': len(items),
            'sum': total,
            'cur': str(d.get('cur') or 'RUB')[:3],
            'updated': datetime.now().isoformat(timespec='seconds'),
        }
        if k == 'preset' and not row['title']:
            raise BadRequest('Укажите название заготовки')
        if (
            k == 'preset'
        ):  # заготовка — общая для отдела: без клиента, номера, автора и экономики (как Presets.DROP в клиенте)
            st = {x: v for x, v in st.items() if x not in self.PRESET_DROP}
        data = {'state': st}
        if k == 'draft' and isinstance(d.get('rev'), int):
            data['rev'] = d['rev']
        store().draft_put(row, json.dumps(data, ensure_ascii=False))
        if k == 'preset' and not old:
            admin.log(self.h, store(), 'preset_add', 'preset', did, None, {'title': row['title']})
        return self.send_json({'ok': True, 'row': row})

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})/delete', 'POST')
    def delete(self, kind, did) -> None:
        row, _ = store().draft_get(did)
        if not row or row['kind'] != self.KINDS[kind]:
            return self.send_json({'ok': True})
        if not self._mine(row):
            return self.text(403, 'Удалить может только автор или администратор')
        store().draft_del(did)
        if kind == 'presets':
            admin.log(self.h, store(), 'preset_delete', 'preset', did, {'title': row['title']}, None)
        return self.send_json({'ok': True})


class ClientCardController(Controller):
    """Карточка клиента: реквизиты и контакты из справочника, все КП клиента (с правами журнала), итоги по статусам, заметки."""

    MAX_NOTES = 200

    def _client(self, cid, inn) -> dict | None:
        c = store().client_get(safe_id(cid), rev=True) if cid else None
        if not c and inn:
            c = store().client_get('inn' + inn, rev=True)
        return c

    @route(r'/api/clientcard', 'GET')
    def card(self) -> None:
        inn = re.sub(r'\D', '', self.q.get('inn') or '')[:12]
        name = (self.q.get('name') or '').strip()[:300]
        c = self._client(self.q.get('id') or '', inn)
        if c:
            inn = inn or re.sub(r'\D', '', str(c.get('inn') or ''))
            name = name or str(c.get('name') or '')
        if not inn and not name:
            raise BadRequest('Нужен ИНН или название клиента')
        res = admin.KpJournal.page(self.h, store(), {'q': inn or name, 'limit': 500})
        key = (
            (lambda r: re.sub(r'\D', '', str(r.get('clientInn') or '')) == inn)
            if inn
            else (lambda r: str(r.get('client') or '').strip().lower() == name.lower())
        )
        rows = [r for r in res['items'] if key(r)]
        rows.sort(key=lambda r: (r.get('date') or '', r.get('number') or ''), reverse=True)
        by, total, people = {}, 0, {}
        for r in rows:
            st = admin.KpJournal.status(r)
            rub = admin.econ_rub(r)[0] or 0
            group = by.setdefault(st, {'n': 0, 'sum': 0})
            group['n'] += 1
            group['sum'] += rub
            total += rub
            if r.get('manager'):
                people[r['manager']] = people.get(r['manager'], 0) + 1
        return self.send_json(
            {
                'client': c,
                'inn': inn,
                'name': name,
                'kps': rows,
                'by': by,
                'total': total,
                'managers': sorted(people, key=lambda k: -people[k]),
                'notes': (c or {}).get('notes') or [],
            }
        )

    @route(
        r'/api/clientcard/note', 'POST'
    )  # заметка о клиенте: {id, text} — добавить; {id, del: время заметки} — удалить свою
    def note(self) -> None:
        d = self.json_body()
        c = self._client(str(d.get('id') or '')[:64], '')
        if not c:
            return self.text(404, 'Клиент не найден в справочнике — сначала сохраните КП с этим клиентом')
        cid = safe_id(str(d.get('id')))
        uid, name = admin.actor(self.h, admin=False)[0] or '', admin.actor(self.h)[1] or ''
        notes = [n for n in (c.get('notes') or []) if isinstance(n, dict)]
        if d.get('del'):
            mine = admin.session(self.h, touch=False) is not None
            keep = [n for n in notes if not (n.get('at') == d['del'] and (mine or n.get('uid') == uid))]
            if len(keep) == len(notes):
                return self.text(403, 'Удалить можно только свою заметку')
            notes = keep
        else:
            text = str(d.get('text') or '').strip()[:2000]
            if not text:
                raise BadRequest('Пустая заметка')
            notes.insert(0, {'at': datetime.now().isoformat(timespec='seconds'), 'by': name, 'uid': uid, 'text': text})
            notes = notes[: self.MAX_NOTES]
        doc = {k: v for k, v in c.items() if k != '_rev'}
        doc['notes'] = notes
        store().client_put(cid, doc, name)
        return self.send_json({'ok': True, 'notes': notes})


class CrmController(Controller):
    """Кабинет: свои сделки и дела — каждому, коллег и отдел — администратору и праву «КП других»; не удаляются."""

    MID = re.compile(r'^[A-Za-z0-9_:-]{0,64}$')

    @staticmethod
    def safe(fn) -> object:
        """Сделки — дополнение к КП: сбой в них не мешает сохранить КП (подробности — в журнал сервера)."""
        try:
            return fn()
        except Exception as e:
            ServerLog.failure('сделки', e)
            return None

    @staticmethod
    def bx(did, kind='deal') -> str:
        """Изменение — в очередь отправки в Битрикс24 (если связь включена). → did"""
        if did:
            BitrixQueue.touch(store(), kind, did)
        return did

    @classmethod
    def mailed(cls, kid: str, to, by: str) -> str | None:
        """Письмо с КП ушло клиенту — сделанное дело «Письмо» в сделке (и в Битрикс24, если связь включена)."""
        book = DealBook(store())
        did = book.deal_of(kid)
        d = book.get(did) if did else None
        if not d:
            return None
        meta = TrackController._obj(store().kp_get(kid, 'meta'))
        tb = TaskBook(store())
        t = tb.add(
            {
                'kind': 'mail',
                'due': date.today().isoformat(),
                'time': datetime.now().strftime('%H:%M'),
                'title': 'Отправлено КП № {}: {}'.format(*(meta.get('number') or kid, ', '.join(to))[:200]),
            },
            d.get('managerId') or '',
            by,
            did,
        )
        tb.update(t['id'], {'state': 'done'})
        return cls.bx(t['id'], 'task')

    @classmethod
    def on_kp(cls, h, kid: str) -> str | None:
        """КП сохранено — в сделку: выбранную в КП (своя или с правом на чужие), прежнюю или новую."""
        meta = TrackController._obj(store().kp_get(kid, 'meta'))
        want = str(meta.get('dealId') or '')[:40]
        if want and want != 'new':
            d = DealBook(store()).get(want)
            uid, _n, everyone = cls.who(h)
            want = want if d and (everyone or d.get('managerId') == uid) else None
        return cls.safe(lambda: cls.bx(DealBook(store()).on_kp(kid, meta, admin.actor(h)[1], want or None)))

    @staticmethod
    def who(h) -> tuple:
        uid, name, _ = admin.actor(h, admin=False)
        everyone = admin.session(h, touch=False) is not None or admin.perm(h, 'kpOthers')
        return uid or '', name or '', everyone

    def _scope(self, q) -> list | None:
        """Чьи сделки: '' — свои, 'all' — весь отдел, id — менеджера. Чужие — только с правом."""
        uid, _n, everyone = self.who(self.h)
        q = str(q or '')
        if q in ('', 'me') or q == uid:
            return [uid]
        if not everyone:
            raise PermissionError(
                'Кабинет коллеги и отдел — у администратора и менеджеров с правом «КП других менеджеров»'
            )
        if q == 'all':
            return None
        if not self.MID.match(q):
            raise BadRequest('Неверный менеджер')
        return [q]

    def _deal(self, did) -> dict | None:
        """Сделка, если она своя или есть право на чужие; иначе — ответ отправлен, None."""
        d = DealBook(store()).get(did)
        uid, _n, everyone = self.who(self.h)
        if not d:
            self.not_found('Сделка не найдена')
            return None
        if not everyone and d.get('managerId') != uid:
            self.text(403, 'Это сделка другого менеджера — нет доступа')
            return None
        return d

    def _manager(self, mid: str) -> tuple:
        """(id, имя) менеджера из справочника для смены ответственного."""
        m = next((x for x in CrmBoard(store()).managers() if x['id'] == mid), None)
        if not m:
            raise BadRequest('Менеджер не найден')
        return m['id'], m['name']

    @route(r'/api/crm/board', 'GET')
    def board(self) -> None:
        try:
            scope = self._scope(self.q.get('manager'))
        except PermissionError as e:
            return self.text(403, str(e))
        res = CrmBoard(store()).build(scope)
        if BitrixConf(store()).on():  # ссылки «Открыть в Битрикс24» на карточках доски
            portal = BitrixConf(store()).get().get('portal') or ''
            bx = dict(store().all("SELECT local_id, bx_id FROM bx_link WHERE kind='deal'"))
            for d in res['deals']:
                if d['id'] in bx and portal:
                    d['bxUrl'] = '{}/crm/deal/details/{}/'.format(portal, bx[d['id']])
        uid, name, everyone = self.who(self.h)
        res.update(me=uid, meName=name, canAll=everyone, managers=CrmBoard(store()).managers() if everyone else [])
        return self.send_json(res)

    @route(r'/api/crm/pick', 'GET')
    def pick(self) -> None:
        uid, _n, everyone = self.who(self.h)
        inn = re.sub(r'\D', '', self.q.get('inn') or '')[:12]
        name = (self.q.get('name') or '').strip()[:300]
        kid = safe_id(self.q.get('kp')) if self.q.get('kp') else ''
        cur = DealBook(store()).deal_of(kid) if kid and admin.kp_access(self.h, store(), kid) else None
        mine = [uid] if not everyone else None
        items = CrmBoard(store()).pick(mine, inn, name) if inn or name else []
        if cur and cur not in [x['id'] for x in items]:
            d = DealBook(store()).get(cur)
            if d:
                items.insert(
                    0,
                    {
                        k: d.get(k)
                        for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')
                    },
                )
        return self.send_json({'items': items, 'current': cur or '', 'stages': Stages.all(store())})

    @route(r'/api/crm/find', 'GET')  # единый поиск программы: сделки по словам (свои; руководитель — все)
    def find(self) -> None:
        uid, _n, everyone = self.who(self.h)
        return self.send_json(
            {'items': CrmBoard(store()).find(None if everyone else [uid], str(self.q.get('q') or '')[:200])}
        )

    @route(r'/api/crm/deal', 'POST')
    def create(self) -> None:
        d = self.json_body()
        uid, name, everyone = self.who(self.h)
        mid, mname = (
            self._manager(str(d.get('managerId')))
            if everyone and d.get('managerId') and d.get('managerId') != uid
            else (uid, name)
        )
        with self.user_input():
            deal = DealBook(store()).create(d, mid, mname, admin.actor(self.h)[1])
        admin.log(
            self.h,
            store(),
            'create_deal',
            'deal',
            deal['id'],
            None,
            {k: deal.get(k) for k in ('title', 'client', 'stage')},
        )
        self.bx(deal['id'])
        return self.send_json(deal)

    @route(r'/api/crm/deal/(d\d{1,9})', ('GET', 'PUT'))
    def deal(self, did) -> None:
        d = self._deal(did)
        if d is None:
            return None
        book = DealBook(store())
        if (
            d.get('bxNew') and d.get('managerId') == self.who(self.h)[0]
        ):  # ответственный открыл — сделка больше не «новая»
            book.flag(did, bxNew=None)
            d.pop('bxNew', None)
        if self.m == 'PUT':
            body = self.json_body()
            mgr = None
            if body.get('managerId') and body['managerId'] != d.get('managerId'):
                if not self.who(self.h)[2]:
                    return self.text(
                        403, 'Передать сделку коллеге может администратор или менеджер с правом «КП других менеджеров»'
                    )
                mgr = self._manager(str(body['managerId']))
            with self.user_input():
                try:
                    new = book.update(did, body, admin.actor(self.h)[1], self.base_rev(), mgr)
                except LookupError as e:
                    return self.not_found(str(e))
            if mgr:
                TaskBook(store()).move_deal(did, mgr[0])
            ch = {k: new.get(k) for k in ('stage', 'lostReason', 'manager') if new.get(k) != d.get(k)}
            if ch:
                admin.log(self.h, store(), 'edit_deal', 'deal', did, {k: d.get(k) for k in ch}, ch)
            self.bx(did)
            d = new
        d['kps'] = book.kps([did])[did]
        d['tasks'] = TaskBook(store()).list(deal=did)
        if BitrixConf(store()).on():
            d['bx'] = self.safe(lambda: BitrixSync(store()).card(did))
        return self.send_json(dict(d, stages=Stages.all(store())))

    @route(r'/api/crm/deal/(d\d{1,9})/kp', 'POST')
    def link(self, did) -> None:
        if self._deal(did) is None:
            return None
        kid = safe_id(str(self.json_body().get('kp') or ''))
        if not store().kp_get(kid, 'meta'):
            return self.not_found('КП не найдено')
        if not admin.kp_access(self.h, store(), kid):
            return self.text(403, 'Это КП другого менеджера — нет доступа')
        old = DealBook(store()).link(did, kid, admin.actor(self.h)[1])
        admin.log(self.h, store(), 'link_deal', 'deal', did, {'deal': old} if old else None, {'kp': kid})
        self.bx(did)
        self.bx(old)
        return self.send_json({'ok': True, 'from': old})

    @route(r'/api/crm/task', 'POST')
    def task_add(self) -> None:
        d = self.json_body()
        uid, _n, everyone = self.who(self.h)
        did = str(d.get('deal') or '')
        mid = uid
        if did:
            deal = self._deal(did)
            if deal is None:
                return None
            mid = deal.get('managerId') or uid
        elif everyone and d.get('managerId'):
            mid = self._manager(str(d['managerId']))[0]
        with self.user_input():
            t = TaskBook(store()).add(d, mid, admin.actor(self.h)[1], did or None)
        self.bx(t['id'], 'task')
        return self.send_json(t)

    @route(r'/api/crm/task/(\d{1,9})', 'PUT')
    def task(self, tid: str) -> None:
        tb = TaskBook(store())
        t = tb.get(tid)
        if not t:
            return self.not_found('Дело не найдено')
        uid, _n, everyone = self.who(self.h)
        if not everyone and t['managerId'] != uid:
            return self.text(403, 'Это дело другого менеджера — нет доступа')
        with self.user_input():
            t = tb.update(tid, self.json_body())
        self.bx(t['id'], 'task')
        return self.send_json(t)


class MeController(Controller):
    @route(r'/api/me/prefs', 'GET')
    def prefs(self) -> None:
        from user_prefs import UserPrefs

        uid = admin.actor(self.h, admin=False)[0]
        return self.send_json({'id': uid or '', 'prefs': UserPrefs(store()).get(uid) if uid else {}})

    @route(r'/api/me/prefs', 'PUT')
    def prefs_put(self) -> None:
        from user_prefs import UserPrefs

        uid, name, _ = admin.actor(self.h, admin=False)
        with self.user_input():
            p = UserPrefs(store()).save(uid, self.json_body(), name)
        return self.send_json({'id': uid, 'prefs': p})


class ServiceController(Controller):
    @route(r'/api/backup', 'POST')
    def backup(self) -> None:
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Резервная копия создаётся на компьютере-сервере'})
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        dst = store().backup(os.path.join(ROOT, 'backup', stamp, 'kp.zip'))  # архив: kp.sqlite3 внутри
        return self.send_json({'ok': True, 'path': dst, 'dir': os.path.dirname(dst)})

    # выключение — только с самого компьютера (файл «Остановить сервер», установщик, кнопка «Выход»); по сети — нельзя
    @route(r'/api/shutdown', 'POST')
    def shutdown(self) -> None:
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Сервер отдела выключается только на компьютере-сервере'})
        self.send_json({'ok': True})
        target = getattr(self.server, 'main_server', self.server)
        threading.Thread(target=target.shutdown, daemon=True).start()
        return None


ROUTER = Router()
