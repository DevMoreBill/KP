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
from typing import Any

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
from bitrix_my import MyCompanies
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
from crm_auto import AutoTasks
from crm_exec import ExecBook, ExecPlan, ExecTasks, Sums
from crm_funnels import DealFields, Funnels
from deal_files import DealClosing, DealFiles
from deal_intake import DealIntake
from deal_rules import ClientByInn, DealRegs
from desktop import DesktopError, open_file, open_folder, show_in_folder
from equipment_types import load_types, save_user_types, types_builtin_path
from features import FeatureAccess, Viewer
from feedback import Feedback
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

_COUNTERPARTIES = None
_LOGOS: dict = {}  # логотипы производителей: {rev — версия каталога, text — готовый ответ}


def counterparties() -> Any:
    """Справочник контрагентов и проверки (создаётся после подготовки папок данных)."""
    global _COUNTERPARTIES
    if _COUNTERPARTIES is None:
        from counterparty import Counterparties

        _COUNTERPARTIES = Counterparties(store())
    return _COUNTERPARTIES


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
    path = os.path.join(WEB_DIR, *parts)
    if not os.path.normcase(os.path.abspath(path)).startswith(os.path.normcase(os.path.abspath(WEB_DIR))):
        return None
    return path if os.path.isfile(path) and os.path.splitext(path)[1].lower() in WEB_TYPES else None


WIN_RESERVED = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1, 10)} | {f'LPT{i}' for i in range(1, 10)}


def pdf_of(docx) -> str:
    """PDF рядом с .docx КП, с тем же именем."""
    return os.path.splitext(docx)[0] + '.pdf'


class CbrCache:
    """Курсы и ключевая ставка ЦБ: удачный ответ — в базу; ЦБ недоступен — последний сохранённый (stale)."""

    RETRY = 600
    _failed: dict = {}

    @classmethod
    def get(cls, key, fetch) -> dict:
        res = None
        if time.time() - cls._failed.get(key, 0) >= cls.RETRY:
            try:
                res = fetch()
            except Exception as exc:
                res = {'error': str(exc)}
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


_ROUTES: list = []  # (регулярное выражение, методы или None, класс, имя метода) — в порядке объявления


def route(pattern: str, methods: str | tuple | None = None):
    """Обработчик маршрута: pattern — регулярное выражение всего пути, methods — метод, кортеж или None (любой)."""
    allowed = None if methods is None else ((methods,) if isinstance(methods, str) else tuple(methods))

    def mark(func):
        func._route = (re.compile(rf'\A(?:{pattern})\Z'), allowed)  # \Z: «$» пропустил бы «…\n» в конце пути
        return func

    return mark


class ControllerMeta(type):
    """Маршруты класса регистрируются при его объявлении — в порядке методов в теле класса."""

    def __init__(cls, name, bases, namespace) -> None:
        super().__init__(name, bases, namespace)
        for attr, func in namespace.items():
            if callable(func) and hasattr(func, '_route'):
                regex, methods = func._route
                _ROUTES.append((regex, methods, cls, attr))


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
        """Текст ошибки для ответа — без путей на диске сервера (C:\\…, /tmp/…)."""
        return re.sub(r'(?:[A-Za-z]:\\|\\\\|/(?:tmp|home|root|var|usr|Users)/)[^\s"\'«»;,)]*', '…', str(exc))

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
    """Находит контроллер и метод по пути и методу запроса."""

    def __init__(self, routes=None) -> None:
        self.routes = routes if routes is not None else _ROUTES

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


class WebIndex:
    """index.html с меткой версии в адресе каждого файла интерфейса: браузер хранит файлы, пока они не изменятся."""

    REF = re.compile(r'((?:src|href)=")(/web/[^"?#]+)(")')
    cache: dict = {}  # {(метка index.html, метки файлов): готовые байты}

    @staticmethod
    def tag(path) -> str:
        stat = os.stat(path)
        return f'{stat.st_mtime_ns:x}-{stat.st_size:x}'

    @classmethod
    def build(cls, path: str) -> bytes:
        with open(path, 'rb') as handle:
            html = handle.read().decode('utf-8')
        refs = [(match.group(2), web_file(match.group(2)[len('/web/') :])) for match in cls.REF.finditer(html)]
        key = (cls.tag(path), *tuple(cls.tag(x) if x else '' for _, x in refs))
        hit = cls.cache.get(key)
        if hit is None:
            tags = {
                u: '%08x' % (zlib.crc32(tag.encode()) & 0xFFFFFFFF)
                for (u, x), tag in zip(refs, key[1:], strict=False)
                if tag
            }
            hit = cls.REF.sub(
                lambda ref: (
                    ref.group(1)
                    + ref.group(2)
                    + ('?v=' + tags[ref.group(2)] if ref.group(2) in tags else '')
                    + ref.group(3)
                ),
                html,
            ).encode('utf-8')
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
            return self.send_file(path, WEB_TYPES['.html'], 'no-cache', CSP, data=WebIndex.build(path))
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


class TypesController(Controller):
    @route(r'/api/types')
    def types(self) -> Any:
        if self.query.get('builtin') == '1':
            return self.send_json(read_text(types_builtin_path()))
        if self.method == 'PUT':
            self.json_body()
            with self.user_input():
                save_user_types(self.body())
            return self.send_json(load_types())
        text = json.dumps(load_types(), ensure_ascii=False)
        return self.send_cached('types-' + hashlib.md5(text.encode('utf-8')).hexdigest()[:16], lambda: text)


class GeoController(Controller):
    PAIR = 2

    @route(r'/api/geo/(.*)', 'GET')
    def geo(self, act) -> Any:
        import geo

        query = self.query
        try:
            if act == 'suggest':
                return self.send_json(geo.suggest(store(), query.get('q', '')))
            if act == 'locate':
                return self.send_json(geo.locate(store(), query.get('q', '')))
            if act == 'reverse':
                return self.send_json(geo.reverse(store(), query.get('lat'), query.get('lon')))
            if act == 'route':
                src, dst = (query.get('a') or '').split(','), (query.get('b') or '').split(',')
                if len(src) != self.PAIR or len(dst) != self.PAIR:
                    raise ValueError('Нужны две точки')
                return self.send_json(geo.RoadRoute.distance_km(store(), src, dst))
            if act == 'unshort':
                return self.send_json({'url': geo.unshort(query.get('u', ''))})
        except Exception as exc:
            return self.send_json({'error': str(exc)[:300] or exc.__class__.__name__})
        return self.text(404, 'Нет такого запроса')


class PartiesController(Controller):
    @route(r'/api/party')
    def party(self) -> Any:
        return self.send_json(counterparties().lookup(self.query.get('inn', '')))

    @route(
        r'/api/check/quota'
    )  # сколько проверок Checko (и резерва OFData) осталось сегодня на весь отдел, сколько в очереди
    def quota(self) -> None:
        return self.send_json(counterparties().quota())

    @route(r'/api/check')
    def check(self) -> Any:
        from counterparty import CheckMode

        return self.send_json(
            counterparties().check(
                self.query.get('inn', ''),
                CheckMode.FRESH if self.query.get('force') == '1' else CheckMode.CACHED,
                author=admin.actor(self.handler)[1],
            )
        )

    @route(r'/api/integrations/export', 'GET')  # резервная копия ключей (только администратор — см. admin.guard)
    def keys_export(self) -> Any:
        return self.send_json(
            {
                'kind': 'kp-keys',
                'v': 1,
                'at': datetime.now().isoformat(timespec='seconds'),
                'keys': counterparties().keys(),
            }
        )

    @route(r'/api/integrations')
    def keys(self) -> Any:
        if self.method == 'PUT':
            self.json_body()
            with self.user_input():
                saved = counterparties().save_keys(self.body())
            return self.send_json(saved)
        pub = counterparties().keys_public()
        if admin.AdminSessions.of(self.handler) is None:  # менеджеру — «задан / не задан» и лимиты, без маски ключа
            pub = {k: v for k, v in pub.items() if not k.endswith('Mask')}
        return self.send_json(pub)

    @route(r'/api/clients', 'GET')
    def clients(self) -> Any:
        # справочник не грузится целиком: последние использованные или найденные по названию / ИНН / адресу
        query = self.query
        try:
            limit, offset = (
                max(1, min(int(query.get('limit') or 50), 500)),
                max(0, min(int(query.get('offset') or 0), 10**9)),
            )
        except ValueError:
            limit, offset = 50, 0
        res = store().clients_search(query.get('q', ''), limit, offset)
        res['all'] = store().clients_count() if not query.get('q') else None
        return self.send_json(res)

    @route(r'/api/clients/([^/]+)', ('GET', 'PUT'))
    def client(self, cid) -> Any:
        cid = safe_id(cid)
        if self.method == 'GET':
            client = store().client_get_rev(cid)
            return self.send_json(client) if client else self.text(404, 'Клиент не найден')
        self.json_body()  # не объект JSON — 400
        return self.send_json(
            counterparties().save_client(cid, self.body(), admin.actor(self.handler)[1], self.base_rev())
        )


class TemplatesController(Controller):
    @route(r'/api/templates')
    def templates(self) -> Any:
        return self.send_json(list_templates())

    @route(r'/api/templates/folder', 'POST')
    def folder(self) -> Any:
        if not self.is_local():
            return self.send_json({'remote': True, 'share': ''})
        os.makedirs(TEMPLATES_DIR, exist_ok=True)
        open_folder(TEMPLATES_DIR)
        return self.send_json({'ok': True})

    @route(r'/api/templates/([A-Za-z0-9_-]+)/([a-z]+)')
    def action(self, tid: str, action) -> Any:
        """Редактор шаблона: сохранение файлов, история версий, копия, заводской вариант, открыть в Word."""
        method, query = self.method, self.query
        try:
            if action == 'file' and method == 'PUT':
                put_file(tid, query.get('name', ''), self.body())
                return self.send_json({'ok': True})
            if action == 'history' and method == 'GET':
                return self.send_json(list_history(tid))
            if action == 'restore' and method == 'POST':
                return self.send_json({'ok': True, 'file': restore_history(tid, query.get('name', ''))})
            if action == 'copy' and method == 'POST':
                return self.send_json(
                    {'ok': True, 'id': copy_template(tid, query.get('to', ''), query.get('title', ''))}
                )
            if action == 'reset' and method == 'POST':
                reset_template(tid)
                return self.send_json({'ok': True})
            if action == 'delete' and method == 'POST':
                delete_template(tid)
                return self.send_json({'ok': True})
            if action == 'open' and method == 'POST':
                if not self.is_local():
                    return self.send_json({'remote': True})
                open_template_file(tid, query.get('name', ''))
                return self.send_json({'ok': True})
        except TemplateError as exc:
            return self.text(400, str(exc))
        return self.not_found()

    @route(r'/tpl/([A-Za-z0-9_-]+)/([^/]+)')
    def file(self, tid: str, name) -> Any:
        path = template_file(tid, urllib.parse.unquote(name))
        if not path:
            return self.not_found('Файл шаблона не найден')
        ext = os.path.splitext(path)[1].lower()
        ctype = {
            '.json': 'application/json; charset=utf-8',
            '.js': 'text/plain; charset=utf-8',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }.get(ext) or MIME.get(ext, 'application/octet-stream')
        extra = (
            {'Content-Disposition': f'attachment; filename="{os.path.basename(path)}"'}
            if self.query.get('download') == '1'
            else None
        )
        with open(path, 'rb') as handle:
            return self.send(200, ctype, handle.read(), extra)


class SystemController(Controller):
    @route(r'/api/ping')
    def ping(self) -> Any:
        base = {
            'ok': True,
            'local': self.is_local(),
            'mode': 'server' if SERVER_MODE else 'local',
            'host': socket.gethostname(),
        }
        if (
            getattr(self.handler, '_kp_login', False)
            and not self.handler._kp_user
            and admin.AdminSessions.of(self.handler) is None
        ):
            return self.send_json(base)  # до входа — без папок, путей и состава базы
        far = not self.is_local() and admin.AdminSessions.of(self.handler) is None  # по сети — без путей сервера
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
    def catalog(self) -> Any:
        # список — облегчённые карточки (без таблиц характеристик и галерей); полная позиция — по id
        full = self.query.get('full') == '1'
        return self.send_cached(
            'cat{}-{}'.format('f' if full else 'l', store().data_rev('catalog')),
            lambda: store().catalog_full() if full else store().catalog_light(),
        )

    # каталог 20 000+: браузер хранит каталог у себя (IndexedDB) и докачивает изменения после своего номера
    @route(r'/api/catalog/sync', 'GET')
    def sync(self) -> Any:
        from catalog_sync import CatalogSync

        sync = CatalogSync(store())
        delta = sync.delta(self.query.get('since'), self.query.get('epoch') or '')
        if delta is not None:
            return self.send(
                200,
                'application/json; charset=utf-8',
                sync.delta_json(delta).encode('utf-8'),
                {'Cache-Control': 'no-store'},
            )
        state = sync.state()
        return self.send_cached('cats-{}-{}'.format(state['epoch'], state['seq']), sync.full_json)

    # поиск по характеристикам (строка поиска позиции хранится на сервере, не в браузере)
    @route(r'/api/catalog/search', 'GET')
    def search(self) -> Any:
        from catalog_sync import CatalogSync

        return self.send_json(
            {'q': self.query.get('q') or '', 'ids': CatalogSync(store()).search(self.query.get('q') or '')}
        )

    @route(
        r'/api/catalog/sources', 'GET'
    )  # фиды-источники позиций: id → поставщик (из справочника, если фид к нему привязан)
    def sources(self) -> None:
        sups = {x.get('id'): x.get('name') for x in store().suppliers_list()}
        return self.send_json(
            {
                feed['id']: {
                    'name': sups.get(feed.get('supplier')) or feed.get('name') or feed['id'],
                    'feed': feed.get('name') or feed['id'],
                }
                for feed in (store().kv_get('feeds') or {}).get('items', [])
                if feed.get('id')
            }
        )

    @route(r'/api/catalog/pending')  # режим модерации и товары с правками на модерации (бейдж «На модерации»)
    def pending(self) -> Any:
        return self.send_json(
            {'moderation': bool(admin.moderation(store()).get('enabled')), 'ids': store().pending_ids()}
        )

    @route(r'/api/catalog/([^/]+)', 'GET')  # запись позиции — PUT в admin.guard (модерация, права)
    def item(self, cid) -> Any:
        doc = store().catalog_get_rev(safe_id(cid))
        return self.send_json(doc) if doc else self.not_found()

    # изображения: папки «раздел/категория/производитель» латиницей (app/images.py); одинаковые хранятся один раз
    @route(r'/api/img', 'POST')
    def img_put(self) -> Any:
        data, query = self.body(), self.query
        max_mb = defaults.SrvVal.get(store(), 'kp.imgMB')
        if len(data) > max_mb * 1024 * 1024:
            return self.text(413, f'Картинка больше {max_mb} МБ — уменьшите её (предел — «Настройки → Параметры»)')
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            ext = '.png'
        elif data[:3] == b'\xff\xd8\xff':
            ext = '.jpg'
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            ext = '.webp'
        elif data[:5] == b'%PDF-' and query.get('kind') == 'booklet':  # буклет цветовых решений заказчика — ещё и PDF
            ext = '.pdf'
        else:
            return self.text(
                400, 'Нужна картинка JPEG, PNG или WebP' + (' либо файл PDF' if query.get('kind') == 'booklet' else '')
            )
        tmap = {tdef.get('id'): tdef for tdef in load_types()['types']}
        folder, title = images.place(
            tmap.get(query.get('cat')),
            query.get('maker'),
            query.get('model'),
            query.get('name'),
            query.get('kind') or 'photo',
            query.get('caption'),
        )
        rel = IMAGES.put(data, ext, folder, title)
        return self.send_json({'name': rel})

    @route(r'/img/(.+)')
    def img(self, rel) -> Any:
        path = IMAGES.path(rel)
        if not path:
            return self.not_found()
        return self.send_file(path, MIME[os.path.splitext(path)[1].lower()], 'private, max-age=604800')


class ManagersController(Controller):
    @route(r'/api/managers', 'GET')
    def managers(self) -> Any:
        return self.send_cached('mgr-' + store().data_rev('managers'), lambda: store().managers_list_rev())

    @route(r'/api/managers/([^/]+)', 'PUT')
    def manager(self, mid: str) -> Any:
        mid, data = safe_id(mid), self.json_body()
        # при входе по паролю менеджер меняет только свою карточку (контакты в его КП); остальные — администратор
        if admin.login_on(self.handler) and (getattr(self.handler, '_kp_user', None) or {}).get('id') != mid:
            return self.text(403, 'Карточку другого менеджера меняет администратор')
        for k in ('name', 'position', 'phone', 'ext', 'mobile', 'email'):
            if k in data and not isinstance(data[k], str):
                data[k] = '' if data[k] is None else str(data[k])
        try:
            return self.send_json(
                store().manager_put(
                    mid, json.dumps(data, ensure_ascii=False), admin.actor(self.handler)[1], self.base_rev()
                )
            )
        except ValueError as exc:  # дубль другого менеджера (ФИО, e-mail, мобильный, добавочный)
            return self.text(422, str(exc))


class KpController(Controller):
    # PDF: чем можно преобразовать; преобразование присланного DOCX (предпросмотр) без записи в журнал
    NUM_DIGITS_MAX = 9

    @route(r'/api/pdf', 'GET')
    def pdf_tools(self) -> Any:
        return self.send_json(pdf_convert.available(counterparties().keys().get('convertapiKey')))

    @route(r'/api/pdf', 'POST')
    def pdf_convert(self) -> Any:
        try:
            data = pdf_convert.convert_bytes(self.body(), counterparties().keys().get('convertapiKey'))
        except Exception as exc:
            return self.text(422, f'PDF не создан: {Controller.no_paths(exc)}')
        return self.send(200, 'application/pdf', data, self.attachment(safe_file(self.query.get('name')) or 'КП.pdf'))

    @route(r'/api/history')
    def history(self) -> Any:
        if (
            'limit' in self.query
        ):  # постранично, с поиском и итогами по всему отбору; files — число справочных документов КП
            res = admin.KpJournal.page(self.handler, store(), self.query)
            count = KpFiles.of(store()).counts([rec.get('id') for rec in res['items'] if isinstance(rec, dict)])
            for rec in res['items']:
                if isinstance(rec, dict) and count.get(rec.get('id')):
                    rec['files'] = count[rec['id']]
            return self.send_json(res)
        return self.send_json(admin.KpJournal.out(self.handler, store().kp_list()))

    @route(r'/api/kp/new', 'POST')
    def new(self) -> Any:
        num = store().next_number()
        return self.send_json({'id': num, 'number': num})

    @route(r'/api/kp/([^/]+)/(state|meta)', ('GET', 'PUT'))
    def doc(self, kid: str, field) -> Any:
        kid = safe_id(kid)
        if self.method == 'PUT':
            text = self.body().decode('utf-8')
            try:
                if not isinstance(json.loads(text), dict):
                    raise ValueError
            except ValueError:  # испорченная запись ломала бы журнал КП у всех
                return self.text(400, 'Неверный формат КП')
            rev = store().kp_set(
                kid,
                field,
                admin.kp_in(self.handler, store(), kid, field, text),
                admin.actor(self.handler)[1],
                self.base_rev() if field == 'state' else None,
            )
            if field == 'meta':
                return self.send_json(
                    {
                        'ok': True,
                        'rev': rev,
                        'deal': CrmController.on_kp(self.handler, kid),
                        'bx': BitrixConf(store()).enabled(),
                    }
                )
            return self.send_json({'ok': True, 'rev': rev})
        v = store().kp_get(kid, field)
        if v and field == 'state':
            v = with_rev(admin.kp_out(self.handler, 'state', v), store().rev_of('kp', kid)['rev'])
            return self.send_json(v)
        return self.send_json(admin.kp_out(self.handler, field, v)) if v else self.not_found()

    @route(r'/api/kp/([^/]+)/rev', 'GET')  # кто и когда последним сохранил КП — проверка перед сохранением
    def rev(self, kid: str) -> None:
        return self.send_json(store().rev_of('kp', safe_id(kid)))

    # история версий КП: список и состояние выбранной версии (экономика чужого КП убирается, как и у текущей)
    @route(r'/api/kp/([^/]+)/versions', 'GET')
    def versions(self, kid: str) -> Any:
        return self.send_json(store().kp_versions(safe_id(kid)))

    @route(r'/api/kp/([^/]+)/versions/(\d+)', 'GET')
    def version(self, kid: str, num) -> Any:
        if len(num) > self.NUM_DIGITS_MAX:
            return self.not_found()
        v = store().kp_version_state(safe_id(kid), num)
        return self.send_json(admin.kp_out(self.handler, 'state', v)) if v else self.not_found()

    @route(r'/api/kp/([^/]+)/docx', 'PUT')
    def docx_put(self, kid: str) -> Any:
        kid, query = safe_id(kid), self.query
        name = safe_file(query.get('name'))
        # только документ Word: имя — с расширением .docx (не .exe, .bat, .lnk…), содержимое — архив docx (PK…)
        if not name.lower().endswith('.docx'):
            name = os.path.splitext(name)[0].rstrip('. ') + '.docx'
        if os.path.splitext(name)[0].split('.')[0].strip().upper() in WIN_RESERVED:
            name = '_' + name
        try:  # документ Word без макросов и внешних шаблонов — его потом открывает Word сервера (PDF)
            pdf_convert.DocxCheck.check(self.body())
        except ValueError as exc:
            return self.text(400, f'Файл КП должен быть документом Word (.docx): {exc}')
        sub = safe_dir(query.get('dir'))  # папка менеджера (фамилия)
        rel = (sub + '/' + name) if sub else name
        # имя занято файлом другого КП (два КП по одной закупке: «4567892 КП») — «4567892 КП (2)», «(3)»…
        stem, ext = os.path.splitext(name)
        for k in range(2, 100):
            if not store().kp_docx_owner(rel, kid):
                break
            name = f'{stem} ({k}){ext}'
            rel = (sub + '/' + name) if sub else name
        path = docs_path(rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_bytes(path, self.body())
        # прежний PDF устарел: создаётся заново, если его попросили сохранить
        stale = [pdf_of(path)]
        # при пересохранении КП под новым именем старый файл убираем, чтобы не копились дубли
        prev = store().kp_get(kid, 'docx')
        if prev:
            old = docs_path(prev.strip())
            if os.path.isfile(old) and os.path.normcase(old) != os.path.normcase(path):
                stale += [old, pdf_of(old)]
        for x in stale:
            try:
                if os.path.isfile(x):
                    os.remove(x)
            except OSError:
                pass
        store().kp_set(kid, 'docx', rel)
        return self.send_json({'ok': True, 'path': path if self.is_local() else '', 'rel': rel})

    @route(r'/api/kp/([^/]+)/docx', 'GET')
    def docx_get(self, kid: str) -> Any:
        # скачивание готового КП — для сотрудников, открывших программу по сети
        path = self.kp_docx(safe_id(kid))
        if not path:
            return self.not_found('Файл КП не найден')
        with open(path, 'rb') as handle:
            data = handle.read()
        return self.send(
            200,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data,
            self.attachment(os.path.basename(path), 'KP.docx'),
        )

    # PDF сохранённого КП: создаётся рядом с .docx (тем же именем), скачивается сотрудниками по сети
    @route(r'/api/kp/([^/]+)/pdf')
    def pdf(self, kid: str) -> Any:
        path = self.kp_docx(safe_id(kid))
        if not path:
            return self.not_found('Файл КП не найден')
        pdf = pdf_of(path)
        if self.method == 'POST':
            try:
                pdf_convert.convert_file(path, pdf, counterparties().keys().get('convertapiKey'))
            except Exception as exc:
                return self.text(422, f'PDF не создан: {Controller.no_paths(exc)}')
            return self.send_json({'ok': True, 'path': pdf if self.is_local() else '', 'local': self.is_local()})
        if self.method == 'GET':
            if not os.path.isfile(pdf):
                return self.not_found('PDF этого КП ещё не создан')
            with open(pdf, 'rb') as handle:
                return self.send(200, 'application/pdf', handle.read(), self.attachment(os.path.basename(pdf)))
        return PASS

    @route(r'/api/kp/([^/]+)/openpdf', 'POST')
    def open_pdf(self, kid: str) -> Any:
        rel = store().kp_get(safe_id(kid), 'docx')
        pdf = pdf_of(docs_path(rel.strip())) if rel else None
        if not pdf or not os.path.isfile(pdf):
            return self.not_found('PDF этого КП ещё не создан')
        if not self.is_local():
            return self.send_json({'remote': True, 'download': f'/api/kp/{safe_id(kid)}/pdf'})
        open_file(pdf)
        return self.send_json({'ok': True})

    @route(r'/api/kp/([^/]+)/(open|folder)', 'POST')
    def open_doc(self, kid: str, how) -> Any:
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
        path = docs_path(rel.strip())
        if not os.path.isfile(path):
            return self.not_found('Файл КП был перемещён или удалён')
        if os.path.splitext(path)[1].lower() not in ('.docx', '.pdf'):  # запускать на компьютере можно только документ
            return self.text(400, 'Это не документ Word — файл не открывается')
        if how == 'open':
            open_file(path)
        else:
            show_in_folder(path)
        return self.send_json({'ok': True})

    @route(r'/api/folder', 'POST')
    def docs_folder(self) -> Any:
        sub = safe_dir(self.query.get('dir'))
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
        return store().kp_get(kid, 'meta') is not None or admin.AdminSessions.of(self.handler) is not None

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files', ('GET', 'POST'))
    def files(self, kid: str) -> Any:
        files = KpFiles.of(store())
        if self.method == 'GET':
            if not self._kp_ok(kid):
                return self.not_found('КП не найдено')
            return self.send_json({'items': files.list(kid, admin.actor(self.handler)[0]), 'limits': files.limits()})
        if store().kp_get(kid, 'meta') is None:
            return self.text(400, 'Сначала сохраните КП, затем прикрепите документы')
        uid, name, _role = admin.actor(self.handler)
        with self.user_input():
            rec = files.add(kid, self.query.get('name', ''), self.body(), self.query.get('note', ''), name, uid)
        admin.log(self.handler, store(), 'add_kp_file', 'kp', kid, None, {'name': rec['name'], 'size': rec['size']})
        CrmController.bitrix_on(DealBook(store()).deal_of(kid))
        return self.send_json(rec)

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/files/(\d{1,9})', ('GET', 'PUT'))
    def file(self, kid: str, fid: str) -> Any:
        files = KpFiles.of(store())
        if not self._kp_ok(kid):
            return self.not_found('КП не найдено')
        if self.method == 'PUT':
            note = self.json_body().get('note')
            if note is not None and not isinstance(note, str):
                raise BadRequest('Примечание — строка')
            old = files.get(kid, fid)
            if old is None:
                return self.not_found('Документ не найден')
            try:
                rec = files.set_note(kid, fid, note or '')
            except LookupError as exc:
                return self.not_found(str(exc))
            admin.log(
                self.handler,
                store(),
                'edit_kp_file',
                'kp',
                kid,
                {'name': old['name'], 'note': old['note']},
                {'note': rec['note']},
            )
            return self.send_json(rec)
        got = files.read(kid, fid)
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
    def remove_own(self, kid: str, fid: str) -> Any:
        """Автор удаляет свой файл, прикреплённый по ошибке, — только в первые kp.fileUndoMin минут после загрузки."""
        try:
            rec = KpFiles.of(store()).delete_own(kid, fid, admin.actor(self.handler)[0])
        except LookupError as exc:
            return self.not_found(str(exc))
        except PermissionError as exc:
            return self.text(403, str(exc))
        admin.log(
            self.handler,
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
    def cbr(self) -> Any:
        return self.send_json(CbrCache.get('cbr_last', cbr_rates))

    @route(r'/api/cbr/keyrate')
    def keyrate(self) -> Any:
        return self.send_json(CbrCache.get('keyrate_last', cbr_key_rate))

    # картинки карточек: логотипы производителей из каталога; картинка, перетащенная со страницы сайта
    @route(r'/api/logos', 'GET')
    def logos(self) -> Any:
        # логотипы зависят только от каталога: расчёт (~0,5 с на большом каталоге) — один раз на его версию
        import imgfetch

        rev = store().data_rev('catalog')
        if _LOGOS.get('rev') != rev:
            _LOGOS.update(rev=rev, text=json.dumps(imgfetch.logos(store()), ensure_ascii=False))
        return self.send_cached('logos-' + rev, lambda: _LOGOS['text'])

    @route(r'/api/imgfetch', 'GET')
    def imgfetch(self) -> Any:
        import imgfetch

        try:
            ctype, data = imgfetch.fetch_image(self.query.get('url') or '')
        except Exception as exc:
            return self.text(422, f'Картинка не загружена: {exc}')
        return self.send(200, ctype, data)

    @route(r'/api/ai/status', 'GET')  # нейросеть в программе: включена ли (без ключа и адреса)
    def ai_status(self) -> Any:
        return self.send_json(ai_llm.status(store()))

    @route(r'/api/ai/profile', 'GET')  # образец объёма категории и данные этой же модели из каталога — для запроса к ИИ
    def ai_profile(self) -> None:
        query = self.query
        return self.send_json(
            {
                'profile': CategoryProfile(store()).get(str(query.get('cat') or '')[:40]),
                'facts': ModelFacts(store()).find(
                    query.get('maker', '')[:100],
                    query.get('model', '')[:100],
                    query.get('name', '')[:300],
                    query.get('id', '')[:64],
                ),
            }
        )

    @route(r'/api/ai/fill', 'POST')  # автозаполнение: запрос из программы → ответ нейросети (JSON строкой)
    def ai_fill(self) -> Any:
        data = self.json_body()
        try:
            return self.send_json(ai_llm.AiAsk.ask(store(), str(data.get('prompt') or '')))
        except RuntimeError as exc:
            return self.text(422, str(exc))

    @route(r'/api/pagetext', 'POST')  # текст и характеристики со страницы товара — для автозаполнения карточки
    def pagetext(self) -> None:
        import feeds

        data = self.json_body()
        try:
            return self.send_json(feeds.page_text(str(data.get('url') or '').strip(), defaults.img_opts(store())))
        except Exception as exc:
            return self.text(422, f'Страница не прочитана: {str(exc)[:200]}')

    @route(r'/api/pdftext', 'POST')  # текст из PDF (паспорт, каталог, ТЗ) — для автозаполнения карточки
    def pdftext(self) -> None:
        if self._too_big('PDF'):
            return None
        try:
            res = pdf_text.PdfText.require(self.body())
            res.pop('per', None)  # текст по страницам — только для разбора ТЗ
            return self.send_json(res)
        except Exception as exc:
            return self.text(422, f'PDF не прочитан: {str(exc)[:200]}')

    @route(r'/api/tz/parse', 'POST')  # ТЗ заказчика (PDF, DOCX, XLSX, ODT, RTF, TXT): текст и требования к станции
    def tz_parse(self) -> None:
        from doc_text import DocText
        from tz_parse import TzParse

        if self._too_big('Файл'):
            return None
        try:
            doc = DocText.extract(str(self.query.get('name') or '')[:200], self.body())
        except Exception as exc:
            return self.text(422, f'ТЗ не прочитано: {str(exc)[:200]}')
        res = TzParse.parse(doc['text'])
        res.update(
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
        return self.send_json(res)

    @route(
        r'/api/rules/stations\.js', 'GET'
    )  # инженерные правила станций — скриптом до модулей расчёта (StationRules.use)
    def rules_stations_js(self) -> None:
        from station_rules import StationRules

        return self.send(
            200,
            'text/javascript; charset=utf-8',
            StationRules(store()).json_text().encode('utf-8'),
            {'Cache-Control': 'no-cache'},
        )

    @route(
        r'/api/rules/stations', 'GET'
    )  # то же — JSON (просмотр, выгрузка, документ «Инженерные правила и источники»)
    def rules_stations(self) -> None:
        from station_rules import StationRules

        rules = StationRules(store())
        return self.send_json({'rules': rules.current(), 'info': rules.info()})

    @route(r'/api/pagephotos', 'POST')  # фото со страницы товара на сайте поставщика — в изображения позиции
    def pagephotos(self) -> None:
        import feeds

        data = self.json_body()
        tmap = {tdef.get('id'): tdef for tdef in load_types()['types']}
        try:
            return self.send_json(
                feeds.page_photos(
                    store(),
                    IMAGES,
                    str(data.get('url') or '').strip(),
                    tmap.get(data.get('cat')),
                    data.get('maker') or '',
                    data.get('model') or '',
                    data.get('name') or '',
                    picked if isinstance(picked := data.get('urls'), list) else None,
                )
            )
        except Exception as exc:
            return self.text(422, f'Фото со страницы не загружены: {str(exc)[:200]}')


class SettingsController(Controller):
    MAX_UITEXTS = 3000  # изменённых текстов интерфейса

    @route(r'/api/lists', 'GET')  # списки и выборы от администратора (для всех; правка — /api/admin/lists)
    def lists(self) -> Any:
        from lists import ListStore

        return self.send_json(ListStore(store()).all())

    @route(r'/api/defaults', 'GET')  # значения по умолчанию от администратора (для всех)
    def defaults(self) -> Any:
        return self.send_json(defaults.get(store()))

    @route(r'/api/logistics/quote', 'POST')  # цены перевозчиков (ATI.SU, ПЭК, Деловые Линии, КИТ) — итог по максимуму
    def quote(self) -> None:
        req = self.json_body()
        try:
            return self.send_json(logistics_api.DeliveryQuote(store(), req).run())
        except (ValueError, TypeError, KeyError) as exc:
            return self.text(400, f'Неверный запрос: {exc}')

    @route(r'/api/logistics/status', 'GET')
    def logistics_status(self) -> Any:
        return self.send_json(
            {
                'providers': logistics_api.providers(store()),
                'auto': store().kv_get('logisticsAuto'),
                'settings': logistics_api.auto_settings(store()),
            }
        )

    @route(r'/api/logistics/refresh', 'POST')  # обновить ставки по ATI.SU сейчас (администратор)
    def logistics_refresh(self) -> Any:
        try:
            rec = logistics_api.AutoRates.now(store())
        except Exception as exc:
            return self.text(502, f'ATI.SU: {exc}')
        return self.send_json(rec or {'error': 'Не задан ключ ATI.SU («Интеграции») или обновление уже идёт'})

    @route(r'/api/logistics/carriers', ('GET', 'PUT'))  # перевозчики: включение и адреса API (изменяет администратор)
    def logistics_carriers(self) -> Any:
        if self.method == 'PUT':
            data = self.json_body()
            with self.user_input():
                saved = logistics_api.CarrierApi.save(store(), data, admin.actor(self.handler)[1])
            return self.send_json(saved)
        return self.send_json(logistics_api.CarrierApi.public(store()))

    @route(r'/api/logistics/carriers/test', 'POST')  # пробный расчёт одного перевозчика (администратор)
    def logistics_carrier_test(self) -> Any:
        carrier = str(self.json_body().get('id') or '')
        with self.user_input():
            res = logistics_api.CarrierApi.test(store(), carrier)
        return self.send_json(res)

    @route(
        r'/api/logistics/china', ('GET', 'PUT')
    )  # доставка из Китая (только администратор): ставки экспедиторов, направления ATI.SU
    def china(self) -> None:
        from china_freight import ChinaFreight

        china = ChinaFreight(store())
        if self.method == 'PUT':
            rows = self.json_body().get('rows') or []
            with self.user_input():
                saved = china.save_rates(rows, admin.actor(self.handler)[1])
            return self.send_json(saved)
        return self.send_json(china.status())

    @route(r'/api/logistics/china/quote', 'POST')  # расчёт Китай → граница РФ (в экономику сделки не идёт)
    def china_quote(self) -> Any:
        from china_freight import ChinaFreight

        req = self.json_body()
        with self.user_input():
            res = ChinaFreight(store()).quote(req, CbrCache.get('cbr_last', cbr_rates))
        return self.send_json(res)

    @route(r'/api/logistics')  # тарифы доставки по России (общие для отдела; изменяет администратор)
    def logistics(self) -> Any:
        if self.method == 'PUT':
            try:
                body = self.json_body()
            except BadRequest:
                raise BadRequest('Неверный формат тарифов') from None
            with self.user_input():
                data = logistics_api.TariffInput.check(body)
            data['updatedAt'] = datetime.now().isoformat(timespec='seconds')
            data['updatedBy'] = admin.actor(self.handler)[1]
            store().kv_set('logistics', data)
            return self.send_json({'ok': True})
        return self.send_json(dict(store().kv_get('logistics') or {}, _auto=store().kv_get('logisticsAuto')))

    @route(r'/api/uitexts', 'GET')  # тексты интерфейса, изменённые администратором: {исходный текст: новый}
    def uitexts(self) -> None:
        return self.send_json(store().kv_get('uitexts') or {})

    @route(r'/api/uitexts', 'PUT')  # только администратор (admin.guard)
    def uitexts_put(self) -> Any:
        try:
            data = self.json_body()
        except BadRequest:
            raise BadRequest('Неверный формат') from None
        if len(data) > self.MAX_UITEXTS:
            raise BadRequest('Неверный формат')
        out = {str(k)[:2000]: str(v)[:4000] for k, v in data.items() if str(k).strip() and isinstance(v, str)}
        store().kv_set('uitexts', out)
        return self.send_json({'ok': True, 'count': len(out)})

    @route(r'/api/version', 'GET')  # версия программы и установленное обновление
    def version(self) -> None:
        import version

        return self.send_json({'version': version.VERSION, 'patched': bool(UPDATE_DIR), 'updateDir': UPDATE_DIR})

    @route(r'/api/calendar', 'GET')  # производственный календарь РФ (рабочие / банковские дни)
    def calendar(self) -> Any:
        import workcal

        with self.user_input():
            cal = workcal.year(store(), int(self.query.get('year') or 0))
        return self.send_json(cal)


class DealController(Controller):
    @route(r'/api/suppliers', 'GET')
    def suppliers(self) -> Any:
        return self.send_cached('sup-' + store().data_rev('suppliers'), lambda: store().suppliers_list())

    @route(r'/api/suppliers/([A-Za-z0-9_-]{1,64})', 'PUT')
    def supplier(self, sid) -> Any:
        if not catalog_admin.power(
            self.handler, 'catSelfMod', 'PUT'
        ):  # справочник поставщиков — администратор и право «Без модерации»
            return self.text(403, 'Справочник поставщиков меняет администратор или менеджер с правом «Без модерации»')
        data = self.json_body()
        with self.user_input():
            saved = store().supplier_put(sid, data, admin.actor(self.handler)[1], self.base_rev())
        return self.send_json(saved)

    @route(r'/api/customs', ('GET', 'PUT'))
    def customs(self) -> Any:
        if self.method == 'GET':
            return self.send_json(store().customs_all())
        data = self.json_body()
        with self.user_input():
            store().customs_put(
                data.get('key'),
                data.get('code'),
                data.get('duty'),
                data.get('note'),
                admin.actor(self.handler)[1],
                data.get('name'),
            )
        return self.send_json({'ok': True})


class TrackController(Controller):
    @staticmethod
    def _obj(text) -> dict:
        """Объект JSON из базы; пусто или испорчено — {}."""
        try:
            data = json.loads(text) if text else {}
        except (TypeError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    @route(
        r'/api/kp/([A-Za-z0-9_-]{1,64})/track', 'PUT'
    )  # статус, причина, заметка, напоминание (права — admin.guard по /api/kp/<id>/)
    def track(self, kid: str) -> None:
        if not store().kp_get(kid, 'meta'):
            return self.not_found('Сначала сохраните КП')
        with self.user_input():
            track, changed = DealTrack(store()).update(kid, self.json_body(), admin.actor(self.handler)[1])
        if changed:
            admin.log(self.handler, store(), 'kp_status', 'kp', kid, None, changed)
            CrmController.safe(
                lambda: CrmController.bitrix_on(DealBook(store()).refresh(kid, admin.actor(self.handler)[1]))
            )
        return self.send_json({'ok': True, 'track': track})

    @route(
        r'/api/kp/([A-Za-z0-9_-]{1,64})/econ', 'PUT'
    )  # Excel экономики сделки (собран в браузере автора) — для Битрикс24
    def econ(self, kid: str) -> None:
        meta = self._obj(store().kp_get(kid, 'meta'))
        if not meta:
            return self.not_found('Сначала сохраните КП')
        if not admin.deal_allowed(self.handler, meta):
            return self.text(403, 'Экономика сделки — только автору КП и администратору')
        if not BitrixConf(store()).enabled():
            return self.send_json({'ok': False})
        with self.user_input():
            EconXlsx(store()).save(kid, self.body())
        CrmController.bitrix_on(DealBook(store()).deal_of(kid))
        return self.send_json({'ok': True})

    @route(r'/api/reminders', 'GET')  # напоминания менеджера: перезвонить, срок действия КП, нет ответа
    def reminders(self) -> None:
        handler = self.handler
        uid, name, _ = admin.actor(handler, admin=False)
        everyone = admin.AdminSessions.of(handler) is not None and not uid

        def mine(meta_obj) -> bool:
            if everyone:
                return True
            author = meta_obj.get('authorId') or meta_obj.get('managerId')
            if author and uid:
                return author == uid
            return bool(name) and str(meta_obj.get('manager') or '').strip().lower() == str(name).strip().lower()

        rows = []
        for kid, meta, track in store().kp_tracked(
            (date.today() - timedelta(days=defaults.SrvVal.get(store(), 'kp.remindDays'))).isoformat()
        ):
            meta_dict = self._obj(meta)
            if admin.login_on(handler) and not admin.own_kp(handler, meta_dict) and not admin.perm(handler, 'kpOthers'):
                continue
            if not mine(meta_dict):
                continue
            # состояние КП (бывает в мегабайтах) — только своим КП и только если срок действия не записан в описании
            rows.append(
                (
                    kid,
                    meta_dict,
                    self._obj(track),
                    {} if meta_dict.get('validUntil') else self._obj(store().kp_get(kid, 'state')),
                )
            )
        items = ReminderList(store=store()).collect(rows, mine)
        return self.send_json({'items': items, 'count': len(items)})

    @route(r'/api/features', 'GET')  # какие функции программы включены (для всех; правка — /api/admin/features)
    def features(self) -> Any:
        return self.send_json(self._features())

    def _features(self) -> dict:
        """Функции программы, доступные тому, кто прислал запрос."""
        return FeatureAccess(store()).for_user(
            Viewer(admin.AdminSessions.of(self.handler) is not None, admin.actor(self.handler, admin=False)[0] or '')
        )

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/mailform', 'GET')  # письмо клиенту: адреса и текст по умолчанию
    def mailform(self, kid: str) -> None:
        state, meta = self._obj(store().kp_get(kid, 'state')), self._obj(store().kp_get(kid, 'meta'))
        mail_public = Mailer(store()).public()
        tpl = MailTemplate(state, meta, mail_public.get('fromName') or '')
        word = self.kp_docx(kid)
        pdf = pdf_of(word) if word and os.path.isfile(pdf_of(word)) else None
        contact = picked if isinstance(picked := state.get('contact'), dict) else {}
        files = []
        if self._features().get('kpFiles'):
            files = [{k: x[k] for k in ('id', 'name', 'size', 'note')} for x in KpFiles.of(store()).list(kid)]
        return self.send_json(
            {
                'on': mail_public['on'],
                'to': str(contact.get('email') or '').strip(),
                'cc': tpl.vars['e-mail'],
                'subject': tpl.fill(mail_public['subject']),
                'body': tpl.fill(mail_public['body']),
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
        data = self.json_body()
        with self.user_input():
            recipients, copies = Mailer.addresses(data.get('to')), Mailer.addresses(data.get('cc'))
        if not recipients:
            raise BadRequest('Укажите адрес получателя')
        path = self.kp_docx(kid)
        if not path:
            return self.not_found('Файл КП не найден — сохраните КП')
        files = []
        if data.get('word', True):
            with open(path, 'rb') as handle:
                files.append(
                    (
                        os.path.basename(path),
                        handle.read(),
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    )
                )
        if data.get('pdf'):
            pdf = pdf_of(path)
            if not os.path.isfile(pdf):
                try:
                    pdf_convert.convert_file(path, pdf, counterparties().keys().get('convertapiKey'))
                except Exception as exc:
                    return self.text(422, f'PDF не создан: {str(exc)[:200]}')
            with open(pdf, 'rb') as handle:
                files.append((os.path.basename(pdf), handle.read(), 'application/pdf'))
        if not files:
            raise BadRequest('Выберите файл: Word или PDF')
        if data.get('files') and self._features().get('kpFiles'):  # отмеченные справочные документы КП
            if not isinstance(data['files'], list):
                raise BadRequest('Неверный список документов')
            with self.user_input():
                files += KpFiles.of(store()).for_mail(kid, data['files'], sum(len(x[1]) for x in files))
        state = self._obj(store().kp_get(kid, 'state'))
        reply = str((state.get('manager') or {}).get('email') or '') if isinstance(state.get('manager'), dict) else ''
        with self.user_input():
            u = getattr(
                self.handler, '_kp_user', None
            )  # без входа по паролю «кто» — заголовок запроса: считаем по компьютеру
            MailRate.take(store(), 'u:{}'.format(u['id']) if u else f'ip:{self.handler.client_address[0]}')
        try:
            accepted = Mailer(store()).send(
                recipients,
                copies,
                str(data.get('subject') or '')[:300],
                str(data.get('body') or '')[:20000],
                files,
                reply,
            )
        except RuntimeError as exc:
            admin.log(
                self.handler,
                store(),
                'send_kp',
                'kp',
                kid,
                None,
                {'to': recipients, 'error': str(exc)[:200]},
                result='failed',
            )
            return self.text(422, str(exc))
        track = DealTrack(store()).mark_sent(
            kid, recipients + copies, [x[0] for x in files], admin.actor(self.handler)[1]
        )
        CrmController.safe(
            lambda: CrmController.bitrix_on(DealBook(store()).refresh(kid, admin.actor(self.handler)[1]))
        )
        CrmController.safe(lambda: CrmController.mailed(kid, recipients + copies, admin.actor(self.handler)[1]))
        admin.log(
            self.handler,
            store(),
            'send_kp',
            'kp',
            kid,
            None,
            {'to': recipients, 'cc': copies, 'files': [x[0] for x in files]},
        )
        refused = [addr for addr in recipients + copies if addr not in accepted]
        return self.send_json({'ok': True, 'track': track, 'refused': refused})

    @route(
        r'/api/report', 'GET'
    )  # отчёт по КП за период: описания (права — как в журнале) и позиции для расчёта по категориям
    def report(self) -> None:
        query = self.query
        date_from, date_to = str(query.get('from') or '')[:10], str(query.get('to') or '')[:10] or '9999-12-31'
        docs = [
            day
            for day in map(
                self._obj,
                store().kp_metas_where(
                    query.get('q', ''),
                    query.get('author', ''),
                    query.get('kind', ''),
                    '',
                    date_from,
                    str(query.get('to') or '')[:10],
                ),
            )
            if day and date_from <= str(day.get('date') or '')[:10] <= date_to
        ]
        rows = admin.KpJournal.rows(self.handler, docs)
        states = store().kp_states(
            [rec.get('id') for rec in rows if isinstance(rec, dict) and rec.get('id') and not rec.get('locked')]
        )
        deal_on = self._features()['deal']  # экономика недоступна — без прибыли
        for rec in rows:
            sale_rub, profit = admin.econ_rub(rec)
            rec['sumRub'], rec['profitRub'] = sale_rub, (profit if deal_on else None)
            if not deal_on:
                for k in ('econ', 'deal'):
                    rec.pop(k, None)
            if rec.get('locked') or not deal_on:
                continue
            state = self._obj(states.get(rec.get('id') or ''))
            rec['calc'] = {
                'vat': state.get('vat'),
                'pricing': {k: (state.get('pricing') or {}).get(k) for k in ('cur', 'rates', 'costNoVat')},
                'items': [
                    {
                        k: x.get(k)
                        for k in ('name', 'qty', 'price', 'disc', 'options', 'cost', 'costCur', 'attrs', 'kit')
                    }
                    for x in (state.get('items') or [])
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
        uid, name, _ = admin.actor(self.handler, admin=False)
        return uid or '', name or ''

    def _mine(self, row) -> bool:
        # черновик без автора (сохранён до выбора менеджера на устройстве) — того, кто с ним работает
        return (
            row['owner'] == self._who()[0]
            or (row['kind'] == 'draft' and not row['owner'])
            or admin.AdminSessions.of(self.handler) is not None
        )

    @route(r'/api/(drafts|presets)', 'GET')
    def list(self, kind) -> Any:
        k = self.KINDS[kind]
        return self.send_json(
            {'items': store().drafts_list(k, self._who()[0] if k == 'draft' else None), 'me': self._who()[0]}
        )

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})', 'GET')
    def get(self, kind, did) -> Any:
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
    def put(self, kind, did) -> Any:
        k = self.KINDS[kind]
        raw = self.body()
        if len(raw) > self.MAX_STATE:
            return self.text(
                413, 'Черновик слишком большой (больше 25 МБ) — уберите вставленные картинки большого размера'
            )
        payload = self.json_body()
        state = payload.get('state')
        if not isinstance(state, dict):
            raise BadRequest('Нет состояния КП')
        old, _ = store().draft_get(did)
        if old and (old['kind'] != k or not self._mine(old)):
            return self.text(403, 'Это запись другого менеджера')
        uid, name = self._who()
        items = picked if isinstance(picked := state.get('items'), list) else []
        try:
            total = float(payload.get('sum') or 0)
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
            'title': str(payload.get('title') or '')[:120],
            'client': str(state.get('client') or '')[:200],
            'kp': str(state.get('number') or '')[:40] if state.get('kpId') and k == 'draft' else '',
            'positions': len(items),
            'sum': total,
            'cur': str(payload.get('cur') or 'RUB')[:3],
            'updated': datetime.now().isoformat(timespec='seconds'),
        }
        if k == 'preset' and not row['title']:
            raise BadRequest('Укажите название заготовки')
        if (
            k == 'preset'
        ):  # заготовка — общая для отдела: без клиента, номера, автора и экономики (как Presets.DROP в клиенте)
            state = {x: v for x, v in state.items() if x not in self.PRESET_DROP}
        data = {'state': state}
        if k == 'draft' and isinstance(payload.get('rev'), int):
            data['rev'] = payload['rev']
        store().draft_put(row, json.dumps(data, ensure_ascii=False))
        if k == 'preset' and not old:
            admin.log(self.handler, store(), 'preset_add', 'preset', did, None, {'title': row['title']})
        return self.send_json({'ok': True, 'row': row})

    @route(r'/api/(drafts|presets)/([A-Za-z0-9_-]{1,40})/delete', 'POST')
    def delete(self, kind, did) -> Any:
        row, _ = store().draft_get(did)
        if not row or row['kind'] != self.KINDS[kind]:
            return self.send_json({'ok': True})
        if not self._mine(row):
            return self.text(403, 'Удалить может только автор или администратор')
        store().draft_del(did)
        if kind == 'presets':
            admin.log(self.handler, store(), 'preset_delete', 'preset', did, {'title': row['title']}, None)
        return self.send_json({'ok': True})


class ClientCardController(Controller):
    """Карточка клиента: реквизиты и контакты из справочника, все КП клиента (с правами журнала), итоги по статусам, заметки."""

    MAX_NOTES = 200

    def _client(self, cid, inn) -> dict | None:
        client = store().client_get_rev(safe_id(cid)) if cid else None
        if not client and inn:
            client = store().client_get_rev('inn' + inn)
        return client

    @route(r'/api/clientcard', 'GET')
    def card(self) -> Any:
        inn = re.sub(r'\D', '', self.query.get('inn') or '')[:12]
        name = (self.query.get('name') or '').strip()[:300]
        client = self._client(self.query.get('id') or '', inn)
        if client:
            inn = inn or re.sub(r'\D', '', str(client.get('inn') or ''))
            name = name or str(client.get('name') or '')
        if not inn and not name:
            raise BadRequest('Нужен ИНН или название клиента')
        res = admin.KpJournal.page(self.handler, store(), {'q': inn or name, 'limit': 500})
        key = (
            (lambda rec: re.sub(r'\D', '', str(rec.get('clientInn') or '')) == inn)
            if inn
            else (lambda item: str(item.get('client') or '').strip().lower() == name.lower())
        )
        rows = [rec for rec in res['items'] if key(rec)]
        rows.sort(key=lambda rec: (rec.get('date') or '', rec.get('number') or ''), reverse=True)
        by_status: dict = {}
        total = 0
        people: dict = {}
        for rec in rows:
            status = admin.KpJournal.status(rec)
            rub = admin.econ_rub(rec)[0] or 0
            group = by_status.setdefault(status, {'n': 0, 'sum': 0})
            group['n'] += 1
            group['sum'] += rub
            total += rub
            if rec.get('manager'):
                people[rec['manager']] = people.get(rec['manager'], 0) + 1
        return self.send_json(
            {
                'client': client,
                'inn': inn,
                'name': name,
                'kps': rows,
                'by': by_status,
                'total': total,
                'managers': sorted(people, key=lambda k: -people[k]),
                'notes': (client or {}).get('notes') or [],
            }
        )

    @route(
        r'/api/clientcard/note', 'POST'
    )  # заметка о клиенте: {id, text} — добавить; {id, del: время заметки} — удалить свою
    def note(self) -> None:
        data = self.json_body()
        client = self._client(str(data.get('id') or '')[:64], '')
        if not client:
            return self.text(404, 'Клиент не найден в справочнике — сначала сохраните КП с этим клиентом')
        cid = safe_id(str(data.get('id')))
        uid, name = admin.actor(self.handler, admin=False)[0] or '', admin.actor(self.handler)[1] or ''
        notes = [note for note in (client.get('notes') or []) if isinstance(note, dict)]
        if data.get('del'):
            mine = admin.AdminSessions.of(self.handler) is not None
            keep = [note for note in notes if not (note.get('at') == data['del'] and (mine or note.get('uid') == uid))]
            if len(keep) == len(notes):
                return self.text(403, 'Удалить можно только свою заметку')
            notes = keep
        else:
            text = str(data.get('text') or '').strip()[:2000]
            if not text:
                raise BadRequest('Пустая заметка')
            notes.insert(0, {'at': datetime.now().isoformat(timespec='seconds'), 'by': name, 'uid': uid, 'text': text})
            notes = notes[: self.MAX_NOTES]
        doc = {k: v for k, v in client.items() if k != '_rev'}
        doc['notes'] = notes
        store().client_put(cid, doc, name)
        return self.send_json({'ok': True, 'notes': notes})


class CrmController(Controller):
    """Кабинет: свои сделки и дела — каждому, коллег и отдел — администратору и праву «КП других»; не удаляются."""

    MID = re.compile(r'^[A-Za-z0-9_:-]{0,64}$')
    CONTACTS = 10

    @staticmethod
    def safe(func) -> Any:
        """Сделки — дополнение к КП: сбой в них не мешает сохранить КП (подробности — в журнал сервера)."""
        try:
            return func()
        except Exception as exc:
            ServerLog.failure('сделки', exc)
            return None

    @staticmethod
    def bitrix_on(did, kind='deal') -> str:
        """Изменение — в очередь отправки в Битрикс24 (если связь включена). → did"""
        if did:
            BitrixQueue.touch(store(), kind, did)
        return did

    @classmethod
    def mailed(cls, kid: str, recipients, author: str) -> str | None:
        """Письмо с КП ушло клиенту — сделанное дело «Письмо» в сделке (и в Битрикс24, если связь включена)."""
        book = DealBook(store())
        did = book.deal_of(kid)
        deal = book.get(did) if did else None
        if not deal:
            return None
        meta = TrackController._obj(store().kp_get(kid, 'meta'))
        tasks = TaskBook(store())
        task = tasks.add(
            {
                'kind': 'mail',
                'due': date.today().isoformat(),
                'time': datetime.now().strftime('%H:%M'),
                'title': 'Отправлено КП № {}: {}'.format(*(meta.get('number') or kid, ', '.join(recipients))[:200]),
            },
            deal.get('managerId') or '',
            author,
            did,
        )
        tasks.update(task['id'], {'state': 'done'})
        return cls.bitrix_on(task['id'], 'task')

    @classmethod
    def on_kp(cls, handler, kid: str) -> str | None:
        """КП сохранено — в сделку: выбранную в КП (своя или с правом на чужие), прежнюю или новую."""
        meta = TrackController._obj(store().kp_get(kid, 'meta'))
        want: Any = str(meta.get('dealId') or '')[:40]
        if want and want != 'new':
            deal = DealBook(store()).get(want)
            uid, _name, everyone = cls.who(handler)
            want = want if deal and (everyone or deal.get('managerId') == uid) else None
        return cls.safe(
            lambda: cls.bitrix_on(DealBook(store()).on_kp(kid, meta, admin.actor(handler)[1], want or None))
        )

    @staticmethod
    def who(handler) -> tuple:
        uid, name, _ = admin.actor(handler, admin=False)
        everyone = admin.AdminSessions.of(handler) is not None or admin.perm(handler, 'kpOthers')
        return uid or '', name or '', everyone

    def _scope(self, query) -> list | None:
        """Чьи сделки: '' — свои, 'all' — весь отдел, id — менеджера. Чужие — только с правом."""
        uid, _name, everyone = self.who(self.handler)
        query = str(query or '')
        if query in ('', 'me') or query == uid:
            return [uid]
        if not everyone:
            raise PermissionError(
                'Кабинет коллеги и отдел — у администратора и менеджеров с правом «КП других менеджеров»'
            )
        if query == 'all':
            return None
        if not self.MID.match(query):
            raise BadRequest('Неверный менеджер')
        return [query]

    def _deal(self, did) -> dict | None:
        """Сделка, если она своя или есть право на чужие; иначе — ответ отправлен, None."""
        deal = DealBook(store()).get(did)
        uid, _name, everyone = self.who(self.handler)
        if not deal:
            self.not_found('Сделка не найдена')
            return None
        if not everyone and deal.get('managerId') != uid:
            self.text(403, 'Это сделка другого менеджера — нет доступа')
            return None
        return deal

    def _manager(self, mid: str) -> tuple:
        """(id, имя) менеджера из справочника для смены ответственного."""
        mgr = next((x for x in CrmBoard(store()).managers() if x['id'] == mid), None)
        if not mgr:
            raise BadRequest('Менеджер не найден')
        return mgr['id'], mgr['name']

    @route(r'/api/crm/board', 'GET')
    def board(self) -> Any:
        try:
            scope = self._scope(self.query.get('manager'))
        except PermissionError as exc:
            return self.text(403, str(exc))
        res = CrmBoard(store()).build(scope)
        res['regs'] = DealRegs(store()).enabled()  # регламент Битрикс24: источник заявки при создании, окно «Заполните»
        if BitrixConf(store()).enabled():  # ссылки «Открыть в Битрикс24» на карточках доски
            portal = BitrixConf(store()).get().get('portal') or ''
            bx_ids = dict(store().all("SELECT local_id, bx_id FROM bx_link WHERE kind='deal'"))
            for deal in res['deals']:
                if deal['id'] in bx_ids and portal:
                    deal['bxUrl'] = '{}/crm/deal/details/{}/'.format(portal, bx_ids[deal['id']])
        uid, name, everyone = self.who(self.handler)
        res.update(me=uid, meName=name, canAll=everyone, managers=CrmBoard(store()).managers() if everyone else [])
        return self.send_json(res)

    @route(r'/api/crm/time', 'GET')
    def deal_time(self) -> Any:
        """«Где тратится время» — по отделу, без имён: только тем, кому виден весь отдел."""
        try:
            self._scope('all')
        except PermissionError as exc:
            return self.text(403, str(exc))
        from crm_time import DealTime

        return self.send_json(DealTime(store()).report())

    @route(r'/api/crm/month', 'GET')
    def month_report(self) -> Any:
        """«Отчёт за месяц» в Excel — тем, кому виден весь отдел."""
        try:
            self._scope('all')
        except PermissionError as exc:
            return self.text(403, str(exc))
        from crm_month import MonthReport

        try:
            report = MonthReport(store(), self.query.get('m') or MonthReport.current())
        except ValueError as exc:
            return self.text(400, str(exc))
        return self.send(
            200,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            report.xlsx(),
            self.attachment(report.file_name(), 'report.xlsx'),
        )

    @route(r'/api/crm/pick', 'GET')
    def pick(self) -> Any:
        uid, _name, everyone = self.who(self.handler)
        inn = re.sub(r'\D', '', self.query.get('inn') or '')[:12]
        name = (self.query.get('name') or '').strip()[:300]
        kid = safe_id(self.query.get('kp')) if self.query.get('kp') else ''
        cur = DealBook(store()).deal_of(kid) if kid and admin.kp_access(self.handler, store(), kid) else None
        mine = [uid] if not everyone else None
        items = CrmBoard(store()).pick(mine, inn, name) if inn or name else []
        if cur and cur not in [x['id'] for x in items]:
            deal = DealBook(store()).get(cur)
            if deal:
                items.insert(
                    0,
                    {
                        k: deal.get(k)
                        for k in ('id', 'number', 'title', 'client', 'stage', 'sum', 'expected', 'updated', 'manager')
                    },
                )
        return self.send_json({'items': items, 'current': cur or '', 'stages': Stages.all(store())})

    @route(r'/api/crm/find', 'GET')  # единый поиск программы: сделки по словам (свои; руководитель — все)
    def find(self) -> Any:
        uid, _name, everyone = self.who(self.handler)
        return self.send_json(
            {'items': CrmBoard(store()).find(None if everyone else [uid], str(self.query.get('q') or '')[:200])}
        )

    @route(r'/api/crm/deal', 'POST')
    def create(self) -> Any:
        data = self.json_body()
        uid, name, everyone = self.who(self.handler)
        mid, mname = (
            self._manager(str(data.get('managerId')))
            if everyone and data.get('managerId') and data.get('managerId') != uid
            else (uid, name)
        )
        with self.user_input():
            deal = DealBook(store()).create(data, mid, mname, admin.actor(self.handler)[1])
            DealIntake(store()).attach_contact(
                deal.get('clientId') or '', data.get('contact'), admin.actor(self.handler)[1]
            )
        admin.log(
            self.handler,
            store(),
            'create_deal',
            'deal',
            deal['id'],
            None,
            {k: deal.get(k) for k in ('title', 'client', 'stage')},
        )
        self.bitrix_on(deal['id'])
        return self.send_json(deal)

    @route(r'/api/feedback', 'POST')
    def feedback(self) -> Any:
        """«Сообщить о проблеме»: текст менеджера и где это случилось — администратору."""
        with self.user_input():
            entry = Feedback(store()).add(self.json_body(), admin.actor(self.handler)[1])
        return self.send_json({'id': entry['id']})

    @route(r'/api/crm/intake', 'POST')
    def intake(self) -> Any:
        """Заявка из письма или ТЗ: JSON {text} или файл (?name=…: PDF, Word, Excel, TXT, письмо .eml) → поля сделки."""
        if self._too_big('Файл'):
            return None
        intake = DealIntake(store())
        with self.user_input():
            if 'json' in str(self.handler.headers.get('Content-Type') or ''):
                mail = {'text': str(self.json_body().get('text') or '')}
            else:
                mail = intake.read(str(self.query.get('name') or ''), self.body())
            return self.send_json(intake.parse(mail))

    @route(r'/api/crm/deal/(d\d{1,9})', ('GET', 'PUT'))
    def deal(self, did) -> Any:
        deal = self._deal(did)
        if deal is None:
            return None
        book = DealBook(store())
        if (
            deal.get('bxNew') and deal.get('managerId') == self.who(self.handler)[0]
        ):  # ответственный открыл — сделка больше не «новая»
            book.flag(did, bxNew=None)
            deal.pop('bxNew', None)
        if self.method == 'PUT':
            body = self.json_body()
            mgr = None
            if body.get('managerId') and body['managerId'] != deal.get('managerId'):
                if not self.who(self.handler)[2]:
                    return self.text(
                        403, 'Передать сделку коллеге может администратор или менеджер с правом «КП других менеджеров»'
                    )
                mgr = self._manager(str(body['managerId']))
            with self.user_input():
                if 'stage' in body:
                    DealRegs(store()).check(deal, str(body['stage'] or ''), str(body.get('lostReason') or ''))
                try:
                    new = book.update(did, body, admin.actor(self.handler)[1], self.base_rev(), mgr)
                except LookupError as exc:
                    return self.not_found(str(exc))
            if mgr:
                TaskBook(store()).move_deal(did, mgr[0])
            changes = {k: new.get(k) for k in ('stage', 'lostReason', 'manager') if new.get(k) != deal.get(k)}
            if changes:
                admin.log(self.handler, store(), 'edit_deal', 'deal', did, {k: deal.get(k) for k in changes}, changes)
            self.bitrix_on(did)
            deal = new
        return self._card(did, deal)

    @route(r'/api/crm/client/inn', 'POST')
    def client_by_inn(self) -> Any:
        """Клиент по ИНН: из справочника или из ФНС (новая карточка) — для сделки без ручного ввода реквизитов."""
        body = self.json_body()
        with self.user_input():
            doc = ClientByInn(store()).ensure(
                str(body.get('inn') or ''), str(body.get('name') or '')[:300], admin.actor(self.handler)[1]
            )
        return self.send_json({key: doc.get(key) or '' for key in ('id', 'name', 'inn', 'address')})

    @route(r'/api/crm/deal/(d\d{1,9})/need', ('GET', 'POST'))
    def need(self, did) -> Any:
        """Регламент Битрикс24: что заполнить для стадии (GET) — и заполнить, затем перевести (POST)."""
        deal = self._deal(did)
        if deal is None:
            return None
        regs, book = DealRegs(store()), DealBook(store())
        author = admin.actor(self.handler)[1]
        if self.method == 'GET':
            book.autofill(did, author)
            with self.user_input():
                view = regs.need(
                    book.get(did) or deal, str(self.query.get('stage') or ''), str(self.query.get('reason') or '')
                )
            return self.send_json(dict(view, on=regs.enabled()))
        body = self.json_body()
        with self.user_input():
            filled = regs.save_client(deal, body.get('client'), author)
            edit = {key: body[key] for key in ('uf', 'note') if key in body}
            edit.update({key: filled[key] for key in ('clientId', 'clientInn') if filled.get(key) != deal.get(key)})
            if edit:
                book.update(did, edit, author)
            book.autofill(did, author)
            deal = book.get(did) or deal
            move = {key: body[key] for key in ('stage', 'lostReason') if key in body}
            if move.get('stage'):
                regs.check(deal, str(move['stage']), str(move.get('lostReason') or ''))
                new = book.update(did, move, author)
            else:
                new = deal
        changes = {key: new.get(key) for key in ('stage', 'lostReason') if new.get(key) != deal.get(key)}
        if changes:
            admin.log(self.handler, store(), 'edit_deal', 'deal', did, {key: deal.get(key) for key in changes}, changes)
        self.bitrix_on(did)
        return self._card(did, new)

    def _card(self, did: str, deal: dict) -> Any:
        """Карточка сделки: КП, исполнение, клиент из справочника, дела, Битрикс24, воронки и поля."""
        book = DealBook(store())
        if book.autofill(did, admin.actor(self.handler)[1]):
            deal = dict(book.get(did) or deal)
            self.bitrix_on(did)
        deal['kps'] = book.kps([did])[did]
        if ExecTasks(store()).sync(deal) + (self.safe(lambda: AutoTasks(store()).sync(deal)) or 0):
            deal = dict(book.get(did) or deal, kps=deal['kps'])
        deal['closingDue'] = DealClosing(store()).due(deal)
        deal['exec'] = ExecPlan(deal).view(Sums.ALL if self._money(deal) else Sums.SALES)
        ExecPlan.strip(deal['kps'])
        deal['clientCard'] = self._client_card(deal)
        # сделка из Битрикса без контактов у клиента — подтянуть контакты сделки и компании (раз в сутки)
        no_people = not (deal['clientCard'] or {}).get('contacts')
        if no_people and BitrixConf(store()).enabled() and self.safe(lambda: BitrixSync(store()).people(did)):
            deal = dict(book.get(did) or deal, kps=deal['kps'], exec=deal['exec'])
            deal['clientCard'] = self._client_card(deal)
        deal['tasks'] = TaskBook(store()).list(deal=did)
        if BitrixConf(store()).enabled():
            deal['bx'] = self.safe(lambda: BitrixSync(store()).card(did))
            companies = MyCompanies(store())
            deal['myCompanies'] = companies.all()
            deal['myCompanyDefault'] = companies.default(BitrixConf(store()).rules().company()['my'])
        funnel = deal.get('funnel') or Funnels.MAIN
        fields = DealFields(store())
        deal['regsNext'] = self.safe(lambda: DealRegs(store()).next_gaps(deal))
        deal['files'] = DealFiles.of(store()).list(did, admin.actor(self.handler)[0])
        deal['fileKinds'] = DealFiles.KINDS
        return self.send_json(
            dict(
                deal,
                stages=Stages.all(store()),
                funnels=Funnels(store()).all(),
                fields=fields.shown(funnel),
                users=fields.users(),
            )
        )

    def _money(self, deal) -> bool:
        """Суммы оплат поставщикам и перевозчикам — тем, кому открыта экономика сделки КП (решение владельца 20.10)."""
        main = ExecPlan.main(deal)
        if not main:
            return False
        meta = TrackController._obj(store().kp_get(main['id'], 'meta'))
        return admin.deal_allowed(self.handler, meta)

    @staticmethod
    def _client_card(deal) -> dict | None:
        """Клиент сделки из справочника: реквизиты и контакты (телефон, почта — для звонка и письма из карточки)."""
        cid = deal.get('clientId') or ('inn' + deal['clientInn'] if deal.get('clientInn') else '')
        client = store().client_get(cid) if cid else None
        if not client:
            return None
        contacts = [row for row in (client.get('contacts') or []) if isinstance(row, dict)][: CrmController.CONTACTS]
        keep = ('name', 'post', 'phone', 'email')
        return {
            'id': client.get('id') or cid,
            'name': client.get('name') or '',
            'inn': client.get('inn') or '',
            'noInn': bool(client.get('noInn')),
            'address': client.get('address') or '',
            'contacts': [{key: str(row.get(key) or '') for key in keep} for row in contacts],
        }

    @route(r'/api/crm/deal/(d\d{1,9})/comment', 'POST')
    def comment(self, did) -> Any:
        """Комментарий в ленту сделки (уходит и в ленту сделки Битрикс24)."""
        if self._deal(did) is None:
            return None
        with self.user_input():
            try:
                DealBook(store()).comment(did, self.json_body().get('text'), admin.actor(self.handler)[1])
            except LookupError as exc:
                return self.not_found(str(exc))
        self.bitrix_on(did)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/files', 'POST')
    def deal_file_add(self, did: str) -> Any:
        """Документ сделки: ?kind=…&name=…, тело — файл; уходит и в Битрикс24."""
        if self._deal(did) is None:
            return None
        uid, name, _role = admin.actor(self.handler)
        with self.user_input():
            rec = DealFiles.of(store()).add_kind(
                did, self.query.get('kind', ''), self.query.get('name', ''), self.body(), name, uid
            )
        admin.log(self.handler, store(), 'add_deal_file', 'deal', did, None, {'name': rec['name'], 'kind': rec['kind']})
        AutoTasks(store()).settle_closing(did)
        self.bitrix_on(did)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/files/(\d{1,9})', 'GET')
    def deal_file(self, did: str, fid: str) -> Any:
        if self._deal(did) is None:
            return None
        got = DealFiles.of(store()).read(did, fid)
        if not got:
            return self.not_found('Документ не найден')
        rec, data = got
        return self.send(
            200,
            rec['mime'] or 'application/octet-stream',
            data,
            self.attachment(rec['name'], 'document.' + (rec['ext'] or 'bin')),
        )

    @route(r'/api/crm/deal/(d\d{1,9})/files/(\d{1,9})/remove', 'POST')
    def deal_file_remove(self, did: str, fid: str) -> Any:
        """Автор удаляет свой документ в первые kp.fileUndoMin минут; позже — администратор."""
        if self._deal(did) is None:
            return None
        try:
            rec = DealFiles.of(store()).delete_own(did, fid, admin.actor(self.handler)[0])
        except LookupError as exc:
            return self.not_found(str(exc))
        except PermissionError as exc:
            return self.text(403, str(exc))
        admin.log(self.handler, store(), 'delete_deal_file', 'deal', did, {'name': rec['name'], 'author': True}, None)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/exec', 'PUT')
    def exec_mark(self, did) -> Any:
        """Отметка точки исполнения: {key, at} — at пусто снимает отметку."""
        if self._deal(did) is None:
            return None
        body = self.json_body()
        with self.user_input():
            try:
                ExecBook(store()).mark(
                    did, str(body.get('key') or '')[:80], str(body.get('at') or ''), admin.actor(self.handler)[1]
                )
            except LookupError as exc:
                return self.not_found(str(exc))
        self.bitrix_on(did)
        return self._card(did, DealBook(store()).get(did) or {})

    @route(r'/api/crm/deal/(d\d{1,9})/kp', 'POST')
    def link(self, did) -> Any:
        if self._deal(did) is None:
            return None
        kid = safe_id(str(self.json_body().get('kp') or ''))
        if not store().kp_get(kid, 'meta'):
            return self.not_found('КП не найдено')
        if not admin.kp_access(self.handler, store(), kid):
            return self.text(403, 'Это КП другого менеджера — нет доступа')
        old = DealBook(store()).link(did, kid, admin.actor(self.handler)[1])
        admin.log(self.handler, store(), 'link_deal', 'deal', did, {'deal': old} if old else None, {'kp': kid})
        self.bitrix_on(did)
        self.bitrix_on(old)
        return self.send_json({'ok': True, 'from': old})

    @route(r'/api/crm/task', 'POST')
    def task_add(self) -> Any:
        data = self.json_body()
        uid, _name, everyone = self.who(self.handler)
        did = str(data.get('deal') or '')
        mid = uid
        if did:
            deal = self._deal(did)
            if deal is None:
                return None
            mid = deal.get('managerId') or uid
        elif everyone and data.get('managerId'):
            mid = self._manager(str(data['managerId']))[0]
        twin = TaskBook(store()).twin(did, data) if did and not data.get('again') else None
        if twin:
            day = '.'.join(reversed(str(twin['due']).split('-')[1:]))
            return self.text(409, 'Такое дело уже есть: «{}» на {}.'.format(twin['title'], day))
        with self.user_input():
            task = TaskBook(store()).add(data, mid, admin.actor(self.handler)[1], did or None)
        self.bitrix_on(task['id'], 'task')
        return self.send_json(task)

    @route(r'/api/crm/task/(\d{1,9})', 'PUT')
    def task(self, tid: str) -> Any:
        tasks = TaskBook(store())
        task = tasks.get(tid)
        if not task:
            return self.not_found('Дело не найдено')
        uid, _name, everyone = self.who(self.handler)
        if not everyone and task['managerId'] != uid:
            return self.text(403, 'Это дело другого менеджера — нет доступа')
        with self.user_input():
            task = tasks.update(tid, self.json_body(), admin.actor(self.handler)[1])
        self.bitrix_on(task['id'], 'task')
        return self.send_json(task)


class MeController(Controller):
    @route(r'/api/me/prefs', 'GET')
    def prefs(self) -> Any:
        from user_prefs import UserPrefs

        uid = admin.actor(self.handler, admin=False)[0]
        return self.send_json({'id': uid or '', 'prefs': UserPrefs(store()).get(uid) if uid else {}})

    @route(r'/api/me/prefs', 'PUT')
    def prefs_put(self) -> Any:
        from user_prefs import UserPrefs

        uid, name, _ = admin.actor(self.handler, admin=False)
        with self.user_input():
            prefs = UserPrefs(store()).save(uid, self.json_body(), name)
        return self.send_json({'id': uid, 'prefs': prefs})


class ServiceController(Controller):
    @route(r'/api/backup', 'POST')
    def backup(self) -> Any:
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Резервная копия создаётся на компьютере-сервере'})
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        dst = store().backup(os.path.join(ROOT, 'backup', stamp, 'kp.zip'))  # архив: kp.sqlite3 внутри
        return self.send_json({'ok': True, 'path': dst, 'dir': os.path.dirname(dst)})

    # выключение — только с самого компьютера (файл «Остановить сервер», установщик, кнопка «Выход»); по сети — нельзя
    @route(r'/api/shutdown', 'POST')
    def shutdown(self) -> Any:
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Сервер отдела выключается только на компьютере-сервере'})
        self.send_json({'ok': True})
        target = getattr(self.server, 'main_server', self.server)
        threading.Thread(target=target.shutdown, daemon=True).start()
        return None


ROUTER = Router()
