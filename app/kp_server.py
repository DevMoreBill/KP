"""HTTP-сервер программы: обработчик запросов (файлы, кэш, сжатие, защита), запуск и фоновые задачи."""

import gzip
import ipaddress
import json
import os
import re
import socket
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import admin
import catalog_migrate
import logistics_api
import maintenance
from app_update import NightUpdate, StartCheck
from config import (
    ALLOWED_HOSTS,
    APP_TITLE,
    BASE_PORT,
    DATA_DIR,
    DOCS_DIR,
    IMG_DIR,
    ROOT,
    SERVER_MODE,
    BadRequest,
    MessageBox,
    store,
)
from data_setup import FreshBase, prepare_dirs, sync_counter_with_files
from defaults import SrvVal
from equipment_types import load_types, load_types_builtin
from images import mark_organized, organize_existing
from kp_templates import ensure_templates
from server_log import ServerLog
from version import VERSION as APP_VERSION
from web_api import IMAGES, ROUTER, counterparties

HTTP_OK = 200

PAID_GET = ('/api/geo/', '/api/party', '/api/check', '/api/imgfetch', '/api/cbr')


class GzipCache:
    """Сжатые ответы по метке версии (ETag): сжатие один раз на версию; сверх max_n — вытесняются старые."""

    def __init__(self, max_n, level) -> None:
        self.max_n, self.level = max_n, level
        self.cache: dict = {}
        self.lock = threading.Lock()
        self.locks: dict = {}  # одна сборка на метку: одновременные запросы ждут её

    def building(self, tag) -> threading.Lock:
        with self.lock:
            lock = self.locks.get(tag)
            if lock is None:
                lock = self.locks[tag] = threading.Lock()
                while len(self.locks) > self.max_n:
                    self.locks.pop(next(iter(self.locks)))
            return lock

    def get(self, tag) -> bytes | None:
        with self.lock:
            return self.cache.get(tag)

    def put(self, tag, data) -> bytes:
        """Сжать data, запомнить под меткой tag и вернуть сжатое."""
        hit = gzip.compress(data, self.level)
        with self.lock:
            self.cache[tag] = hit
            while len(self.cache) > self.max_n:
                self.cache.pop(next(iter(self.cache)))
        return hit


class FileGzip:
    """Сжатые файлы интерфейса в памяти: сжатие один раз на версию файла."""

    MIN = 1024  # меньше — сжатие не окупается
    cache = GzipCache(400, 9)  # файлов в памяти (интерфейс — ~110)

    @classmethod
    def get(cls, tag, data, ctype) -> bytes | None:
        """gzip-байты файла или None (маленький или не текст)."""
        if len(data) < cls.MIN or not (
            ctype.startswith(('text/', 'application/json')) or 'javascript' in ctype or 'svg' in ctype
        ):
            return None
        return cls.cache.get(tag) or cls.cache.put(tag, data)


JSON_GZIP = GzipCache(8, 6)
JSON_GZIP_MIN = 200000  # меньше — отдаётся без сжатия
MAX_BODY = 300 * 1024 * 1024


class BodyLimit:
    """Предел тела запроса: большие загрузки — только «Настройкам», остальным — USER (память сервера)."""

    USER = 64 * 1024 * 1024
    FILES = ('kp.fileMB', 'cat.docMaxMB', 'kp.imgMB', 'cat.imgMaxMB')
    BIG = ('/api/admin/',)
    CHUNK = 64 * 1024

    @classmethod
    def of(cls, path) -> int:
        if path.startswith(cls.BIG):
            return MAX_BODY
        try:
            max_mb = max(SrvVal.get(store(), k) for k in cls.FILES)
        except Exception:
            max_mb = 0
        return min(MAX_BODY, max(cls.USER, int((max_mb + 2) * 1024 * 1024)))

    @classmethod
    def drain(cls, rfile, left) -> None:
        """Дочитать отклонённое тело частями — без копии в памяти целиком."""
        while left > 0:
            got = rfile.read(min(cls.CHUNK, left))
            if not got:
                break
            left -= len(got)


# после самопроверки сбой — уже не сбой запуска обновления
STARTED = False


class Handler(BaseHTTPRequestHandler):
    HTTP_BAD = 400
    server_version = 'KP/1.0'
    sys_version = ''  # в заголовке Server — без версии Python
    # HTTP/1.1 с ETag; ответы — только через send() / send_file() (с Content-Length)
    protocol_version = 'HTTP/1.1'
    # без задержки Нейгла: иначе ~40 мс на ответ
    disable_nagle_algorithm = True
    timeout = 120  # простаивающее соединение закрывается
    GZIP_FROM = 20000
    # браузер закрыл соединение (и WinError 64, 1236) — не ошибка сервера
    GONE = (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)
    GONE_WIN = (64, 1236)
    LOCAL_NAMES = ('localhost', '127.0.0.1', '::1')

    @classmethod
    def gone(cls, exc) -> bool:
        return isinstance(exc, cls.GONE) or getattr(exc, 'winerror', None) in cls.GONE_WIN

    def log_message(self, fmt, *args) -> None:  # у EXE без консоли нет stderr
        pass

    # --- ответы ---
    def is_local(self) -> bool:
        addr = (self.client_address or ('',))[0]
        return addr in ('127.0.0.1', '::1', '::ffff:127.0.0.1') or addr.startswith('127.')

    @staticmethod
    def file_tag(path) -> str:
        """Метка версии файла (ETag): время изменения и размер."""
        stat = os.stat(path)
        return f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'

    def send_file(self, path, ctype, cache, csp=None, data=None) -> None:
        """Файл с проверкой версии (ETag): неизменённый файл браузер берёт из своего кэша — ответ 304 без тела."""
        tag = self.file_tag(path) if data is None else f'"{zlib.crc32(data) & 0xFFFFFFFF:x}"'
        if self.headers.get('If-None-Match') == tag:
            self.send_response(304)
            self.send_header('ETag', tag)
            self.send_header('Cache-Control', cache)
            self.end_headers()
            return None
        extra = {'Cache-Control': cache, 'ETag': tag}
        if csp:
            extra['Content-Security-Policy'] = csp
        if data is None:
            with open(path, 'rb') as handle:
                data = handle.read()
        # ключ сжатого — файл и его версия: у разных файлов после распаковки обновления бывают одинаковые время и размер
        gzip_key = f'{path}|{tag}'
        gzipped = FileGzip.get(gzip_key, data, ctype) if 'gzip' in (self.headers.get('Accept-Encoding') or '') else None
        if gzipped is not None:
            extra['Content-Encoding'] = 'gzip'
            extra['Vary'] = 'Accept-Encoding'
            return self.send_gzipped(200, ctype, gzipped, extra)
        return self.send(200, ctype, data, extra)

    def send(self, code, ctype, body, extra=None) -> None:
        data = body if isinstance(body, bytes) else str(body).encode('utf-8')
        if (
            len(data) > self.GZIP_FROM
            and 'gzip' in (self.headers.get('Accept-Encoding') or '')
            and ctype.startswith(('application/json', 'text/'))
        ):
            return self.send_gzipped(code, ctype, gzip.compress(data, 5), extra)
        return self._write(code, ctype, data, extra or {})

    def send_gzipped(self, code, ctype, data: bytes, extra=None) -> None:
        """Тело уже сжато gzip."""
        return self._write(code, ctype, data, dict(extra or {}, **{'Content-Encoding': 'gzip'}))

    def _write(self, code, ctype, data: bytes, extra: dict) -> None:
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if 'Cache-Control' not in (extra or {}):
            self.send_header('Cache-Control', 'no-store')
        # браузер не угадывает тип файла (картинка не станет страницей), программу нельзя встроить в чужой сайт
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def send_json(self, obj) -> None:
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        self.send(200, 'application/json; charset=utf-8', text)

    def send_cached(self, tag, make) -> None:
        """Справочник с версией: браузер хранит копию и спрашивает «изменилось ли?» (If-None-Match)."""
        etag = f'W/"{tag}-{APP_VERSION}"'
        extra = {'ETag': etag, 'Cache-Control': 'no-cache'}
        if etag in (self.headers.get('If-None-Match') or ''):
            return self.send(304, 'application/json; charset=utf-8', b'', extra)
        gz_ok = 'gzip' in (self.headers.get('Accept-Encoding') or '')
        if not gz_ok:
            return self.send(200, 'application/json; charset=utf-8', self._json_bytes(make()), extra)
        hit = JSON_GZIP.get(etag)
        if hit is None:
            with JSON_GZIP.building(etag):
                hit = JSON_GZIP.get(etag)  # пока ждали — собрал другой запрос
                if hit is None:
                    data = self._json_bytes(make())
                    if len(data) < JSON_GZIP_MIN:
                        return self.send(200, 'application/json; charset=utf-8', data, extra)
                    hit = JSON_GZIP.put(etag, data)
        return self.send_gzipped(200, 'application/json; charset=utf-8', hit, extra)

    @staticmethod
    def _json_bytes(obj) -> bytes:
        return (obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)).encode('utf-8')

    def base_rev(self) -> int | None:
        """С какой правки записи начинали редактирование (заголовок X-KP-Rev); нет — сохранить без проверки."""
        v = (self.headers.get('X-KP-Rev') or '').strip()
        return int(v) if v.isdigit() else None

    def conflict(self, exc) -> None:
        return self.send(409, 'application/json; charset=utf-8', json.dumps(exc.info(), ensure_ascii=False))

    def attachment(self, filename, fallback='file') -> dict:
        """Заголовок «скачать как» с русским именем файла (fallback — латинское имя, если в имени нет латиницы)."""
        ascii_fn = re.sub(r'[^A-Za-z0-9._-]', '_', filename.encode('ascii', 'ignore').decode()) or fallback
        return {
            'Content-Disposition': f'attachment; filename="{ascii_fn}"; filename*=UTF-8\'\'{urllib.parse.quote(filename)}'
        }

    def not_found(self, text='not found') -> None:
        self.send(404, 'text/plain; charset=utf-8', text)

    NON_FINITE = re.compile(rb'(?<![A-Za-z0-9_"])-?(?:NaN|Infinity)(?![A-Za-z0-9_"])')

    def body(self) -> bytes:
        # тело читается один раз: его смотрят и admin.py, и маршрут
        if not hasattr(self, '_body'):
            size = self.body_size()
            self._body = self.rfile.read(size) if size > 0 else b''
        if self.non_finite(self._body):
            raise BadRequest('Неверный запрос: в числах недопустимы NaN и Infinity')
        return self._body

    @classmethod
    def non_finite(cls, raw) -> bool:
        """JSON с NaN или Infinity отклоняется: JSON.parse в браузере на них падает."""
        if not raw or not cls.NON_FINITE.search(raw):
            return False

        def refuse(_const) -> None:
            raise OverflowError

        try:
            json.loads(raw.decode('utf-8'), parse_constant=refuse)
        except OverflowError:
            return True
        except ValueError:
            pass
        return False

    def body_size(self) -> int:
        try:
            return max(0, int(self.headers.get('Content-Length') or 0))
        except ValueError:
            return 0

    _own = None
    LAN_SUFFIX = ('.local', '.lan', '.internal', '.intranet', '.corp', '.home', '.home.arpa', '.localdomain')

    @classmethod
    def lan_name(cls, name) -> bool:
        """Допустимое имя без allowedHosts: IP, имя компьютера, внутренняя зона; публичное — только вписанное."""
        try:
            ipaddress.ip_address(name)
            return True
        except ValueError:
            pass
        if not name or '.' not in name or name.endswith(cls.LAN_SUFFIX):
            return bool(name)
        if cls._own is None:  # имя компьютера узнаётся один раз (getfqdn может ждать DNS)
            cls._own = (socket.gethostname().lower(), socket.getfqdn().lower())
        return name in cls._own

    def request_allowed(self) -> bool:
        """Защита от чужих сайтов: имя в адресе (подмена DNS) и Origin изменяющего запроса (подделка)."""
        host = (self.headers.get('Host') or '').strip().lower()
        name = host.rsplit(':', 1)[0] if not host.endswith(']') else host
        name = name.strip('[]')
        if name not in self.LOCAL_NAMES and not (
            SERVER_MODE and (name in ALLOWED_HOSTS or (not ALLOWED_HOSTS and self.lan_name(name)))
        ):
            return False
        if self.command not in ('GET', 'HEAD'):
            origin = (self.headers.get('Origin') or '').strip().lower()
            if origin == 'null' or (origin and urllib.parse.urlsplit(origin).netloc != host):
                return False
        return True

    def send_response(self, code, message=None) -> None:
        self._code = code
        super().send_response(code, message)

    # --- маршрутизация ---
    # данные запроса сбрасываются: соединение HTTP/1.1 обслуживает несколько запросов
    PER_REQUEST = ('_body', '_kp_user', '_kp_login', '_code')

    def dispatch(self) -> None:
        for attr in self.PER_REQUEST:
            self.__dict__.pop(attr, None)
        try:
            self._dispatch()
        finally:
            # отказ до разбора: непрочитанное тело оборвало бы соединение (RST)
            if not hasattr(self, '_body') and self.body_size() > 0:
                if self.body_size() <= BodyLimit.of(urllib.parse.urlsplit(self.path).path):
                    BodyLimit.drain(self.rfile, self.body_size())
                else:
                    self.close_connection = True

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = dispatch

    def _dispatch(self) -> None:
        try:
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            method = 'GET' if self.command == 'HEAD' else self.command
            if re.search(r'[\x00-\x1f\x7f]', path):  # «%0A» и др. в пути — мимо проверок прав по точному адресу
                self.close_connection = True
                return self.send(400, 'text/plain; charset=utf-8', 'Недопустимый адрес')
            if not self.request_allowed():
                self.close_connection = True
                return self.send(403, 'text/plain; charset=utf-8', 'Запрос отклонён: откройте программу по её адресу')
            # платные внешние сервисы — только с заголовком программы X-KP-User-Id
            if method == 'GET' and path.startswith(PAID_GET) and 'X-KP-User-Id' not in self.headers:
                return self.send(403, 'text/plain; charset=utf-8', 'Запрос отклонён: только из программы')
            if self.body_size() > BodyLimit.of(path):
                self.close_connection = True
                return self.send(413, 'text/plain; charset=utf-8', 'Слишком большой запрос')
            # права, модерация, журнал (admin.py): True — ответ отправлен, функция — записать в журнал
            if method in ('POST', 'PUT', 'DELETE') and path.startswith('/api/'):
                NightUpdate.touch()  # кто-то работает: ночное обновление подождёт
            hook = admin.guard(self, store(), method, path) if path.startswith(('/api/', '/tpl/', '/img/')) else None
            if hook is True:
                return None
            self.route()
            if callable(hook) and getattr(self, '_code', 500) < self.HTTP_BAD:
                hook()
        except (
            BadRequest,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as exc:  # недопустимый идентификатор, испорченное тело — 400
            try:
                self.send(
                    400,
                    'text/plain; charset=utf-8',
                    str(exc) if isinstance(exc, BadRequest) else 'Неверный запрос: нужен JSON в кодировке UTF-8',
                )
            except Exception:
                pass
        except Exception as exc:
            # пользователю — без путей, подробности — в журнал сервера
            try:
                self.send(
                    500,
                    'text/plain; charset=utf-8',
                    f'Внутренняя ошибка сервера ({type(exc).__name__}). Подробности — в журнале сервера.',
                )
            except Exception:
                if self.gone(exc):  # браузер уже закрыл соединение — ответ не нужен, и это не ошибка сервера
                    self.close_connection = True
                    return None
            ServerLog.failure(f'{self.command} {urllib.parse.urlsplit(self.path).path[:300]}', exc)

    def route(self) -> None:
        """Маршруты API — контроллеры разделов в web_api.py (Router: первый подходящий по пути и методу)."""
        return ROUTER.dispatch(self)


def already_running() -> bool:
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            f'http://127.0.0.1:{BASE_PORT}/api/ping', timeout=2
        ) as resp:
            return resp.status == HTTP_OK
    except Exception:
        return False


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # на Windows SO_REUSEADDR пустил бы два процесса на один порт
    allow_reuse_address = os.name != 'nt'
    # очередь соединений 128: по умолчанию 5 переполнялась утром
    request_queue_size = 128

    def handle_error(self, request, client_address) -> None:
        """Ошибка вне обработчика — в журнал сервера (у EXE нет stderr); закрытое браузером соединение — не ошибка."""
        exc = sys.exc_info()[1]
        if not Handler.gone(exc):
            ServerLog.failure(f'соединение {client_address[0] if client_address else "?"}', exc)


class Server6(Server):
    address_family = socket.AF_INET6
    main_server: Any = None


def start_ipv6(port, main_server) -> None:
    """localhost в Windows часто означает ::1 — слушаем и его, как это делал HttpListener."""
    try:
        server6 = Server6(('::1', port), Handler)
    except OSError:
        return
    server6.main_server = main_server
    threading.Thread(target=server6.serve_forever, daemon=True).start()


def start_server() -> tuple:
    host = '0.0.0.0' if SERVER_MODE else '127.0.0.1'
    ports = [BASE_PORT] if SERVER_MODE else range(BASE_PORT, BASE_PORT + 40)  # у сервера отдела адрес постоянный
    for port in ports:
        try:
            return Server((host, port), Handler), port
        except OSError:
            continue
    return None, None


def main() -> int:
    # один экземпляр: если программа уже работает — просто открываем её
    if already_running():
        webbrowser.open(f'http://localhost:{BASE_PORT}/')
        return 0
    log = ServerLog.install(DATA_DIR)  # журнал сервера: вывод программы и ошибки — в data/logs/kp.log
    if log:
        log.info(
            'Запуск: версия {}{}, {}'.format(
                APP_VERSION,
                ' (обновление поверх EXE {})'.format(os.environ.get('KP_BASE_VERSION', ''))
                if os.environ.get('KP_UPDATE_DIR')
                else '',
                'сервер отдела' if SERVER_MODE else 'программа на этом компьютере',
            )
        )
    import importlib.util

    if importlib.util.find_spec('sqlite3') is None:  # база данных программы; без модуля программа работать не может
        MessageBox.error(
            'В сборке программы нет модуля базы данных SQLite.\n\n'
            'Пересоберите EXE из актуального проекта (kp.spec не должен исключать sqlite3) '
            'или скачайте готовую сборку из GitHub Actions.'
        )
        return 1
    try:
        prepare_dirs()
        from settings_history import SettingsHistory

        store().kv_hook = SettingsHistory(store())  # правки настроек людьми — в историю с откатом
        ensure_templates()
        store().migrate_json(DATA_DIR)  # переход с версии, хранившей данные в JSON-файлах
        admin.startup(store(), DATA_DIR)  # сброс пароля по data/admin-reset.txt, очистка корзины
        from app_update import Updater

        Updater(store(), ROOT, DATA_DIR).absorb_failures()  # обновление не запустилось — запись в «Обновления»
        # обслуживание базы: копия за сегодня, архив журнала, сжатие раз в месяц — в фоне, затем раз в сутки
        threading.Thread(
            target=maintenance.Background.run, args=(store(), DATA_DIR), daemon=True, name='maintenance-start'
        ).start()
        maintenance.Background.daily(store(), DATA_DIR)
        # отложенные проверки контрагентов: когда лимит Checko обновится (после 00:00 по Москве) — выполнить очередь
        maintenance.Background.every(
            lambda: SrvVal.get(store(), 'cp.queueEveryMin') * 60,
            lambda: counterparties().run_queue(),
            'очередь проверок контрагентов',
        )
        # ставки доставки по ATI.SU: проверка раз в 3 часа, обновление — когда прошёл период из настроек тарифов доставки
        maintenance.Background.every(3 * 3600, lambda: logistics_api.AutoRates.scheduled(store()), 'ставки доставки')
        import feeds

        feeds.IMAGE_STORE = IMAGES
        maintenance.Background.every(
            3600, lambda: feeds.auto_check(store()), 'фиды поставщиков'
        )  # РРЦ и наличие: когда пора обновлять — решает feeds.auto_check
        maintenance.Background.every(
            6 * 3600, lambda: Updater(store(), ROOT, DATA_DIR).auto_check(), 'проверка новой версии'
        )  # раз в сутки (Updater.auto_check)
        from bitrix import BitrixConf, BitrixSync  # связь с Битрикс24: очередь отправки и опрос изменений

        maintenance.Background.every(lambda: BitrixConf(store()).poll(), lambda: BitrixSync(store()).run(), 'Битрикс24')
        from crm_exec import ExecTasks  # исполнение сделок: дела на подошедшие точки (оплаты, готовность, поставка)

        maintenance.Background.every(3600, lambda: ExecTasks(store()).sweep(), 'исполнение сделок')
        import config
        from admin_alerts import AdminAlerts

        maintenance.Background.every(
            lambda: SrvVal.get(store(), 'srv.alertsEveryMin') * 60,
            lambda: AdminAlerts(store(), config).check(),
            'письма администратору о проблемах',
        )
        from server_task import ServerTask

        if ServerTask.applicable(
            SERVER_MODE
        ):  # задача Планировщика: без остановки через 3 дня работы и от батареи (ИБП)
            ServerTask(store()).start(config.STARTED)
        feeds.upgrade(store(), load_types()['types'], APP_VERSION)  # после обновления — фиды по новым правилам
        fresh = FreshBase.check()
        sync_counter_with_files()
    except Exception as exc:
        ServerLog.failure('запуск', exc)
        if StartCheck.armed() and StartCheck.code_error(exc):
            raise  # ошибка в коде обновления: launcher.py вернёт прежнюю версию и запустит её
        if 'malformed' in str(exc) or 'not a database' in str(exc):
            MessageBox.error(
                'Файл базы данных повреждён:\n{}\n\n{}\n\n'
                'Так бывает, когда kp.sqlite3 подменяют вручную при оставшихся рядом файлах kp.sqlite3-wal и kp.sqlite3-shm.\n'
                'Что сделать: остановить программу, удалить kp.sqlite3-wal и kp.sqlite3-shm, затем положить на место kp.sqlite3 '
                'копию из папки data\\backup (архивы ZIP: kp-ДАТА.zip в backup\\auto — автоматические копии, kp-…-before-….zip — '
                'перед изменениями; файл kp.sqlite3 — внутри архива). '
                'Загружать файл базы впредь лучше через «Настройки → Обслуживание → Копии и база → Файл базы целиком».'.format(
                    os.path.join(DATA_DIR, 'kp.sqlite3'), exc
                )
            )
            return 1
        MessageBox.error(f'Не удалось подготовить папки данных:\n{DATA_DIR}\n\n{exc}')
        return 1
    try:  # каталог под новую структуру категорий — один раз; перед этим копия базы в data/backup
        if fresh:  # новая база: переносить в новую структуру нечего
            catalog_migrate.mark_done(store())
            mark_organized(store())
        rep = catalog_migrate.run(
            store(),
            load_types_builtin(),
            (store().kv_get('types') or {}).get('types', []),
            IMG_DIR,
            os.path.join(DATA_DIR, 'backup'),
        )
        organize_existing(
            store(), load_types()['types'], IMG_DIR, os.path.join(DATA_DIR, 'backup'), backup=(rep or {}).get('backup')
        )
    except Exception as exc:
        ServerLog.failure('обновление каталога или раскладка изображений (будут повторены при следующем запуске)', exc)
    if DATA_DIR.startswith('\\\\'):
        MessageBox.info(
            f'Папка данных указана в сети ({DATA_DIR}).\n\nБазу данных нельзя держать в общей сетевой папке — '
            'при одновременной работе она может повредиться. Для работы всем отделом используйте '
            'сервер отдела (server-setup\\1. Установить сервер отдела.bat), а dataDir оставьте пустым.'
        )
    httpd, port = start_server()
    if not httpd:
        ServerLog.failure(f'запуск: все порты заняты ({BASE_PORT}…)')
        MessageBox.error('Не удалось запустить сервер: все порты заняты.')
        return 1
    ServerLog.note(f'Сервер работает: порт {port}')
    # ночное обновление (если включено в «Обновлениях»): проверка раз в полчаса, установка — и перезапуск этого сервера
    from app_update import Restarter, Updater

    maintenance.Background.every(
        1800,
        lambda: NightUpdate(Updater(store(), ROOT, DATA_DIR)).run(lambda: Restarter(SERVER_MODE).restart(httpd)),
        'ночное обновление',
    )
    if not SERVER_MODE:
        start_ipv6(port, httpd)
    # адрес localhost (а не 127.0.0.1) — чтобы браузер видел черновики, сохранённые прежней версией
    url = f'http://localhost:{port}/'

    def ready() -> None:
        global STARTED
        STARTED = True
        if not os.environ.get('KP_NO_BROWSER'):  # после перезапуска из «Настроек» браузер уже открыт
            webbrowser.open(url)

    # обновление не ответило на главные адреса — останов, launcher.py вернёт прежнюю версию
    check = StartCheck(port, httpd, ready) if StartCheck.armed() else None
    if check:
        check.start()
    else:
        opener = threading.Timer(0.3, ready)
        opener.daemon = True
        opener.start()
    try:
        print(f'{APP_TITLE} запущен: {url}\nДанные: {DATA_DIR}\nГотовые КП: {DOCS_DIR}', flush=True)
        if SERVER_MODE:
            print(f'Режим сервера отдела. Сотрудники открывают: http://{socket.gethostname()}:{port}/', flush=True)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()
    if check and check.error:
        ServerLog.failure(check.error)
        raise StartCheck.Failed(check.error)
    ServerLog.note('Остановка')
    return 0


if __name__ == '__main__':
    sys.exit(main())
