# -*- coding: utf-8 -*-
"""Конструктор КП ПНЕВМОТЕХ — точка входа и HTTP-сервер.

Отдаёт интерфейс (app/web) и API. Модули сервера:
  config.py          — настройки и пути, база данных (store), общие помощники
  data_setup.py      — подготовка данных при запуске
  storage.py         — база SQLite
  counterparty.py    — контрагенты: ИНН, Checko
  equipment_types.py — справочник типов оборудования
  kp_templates.py    — шаблоны КП
  cbr.py             — курсы ЦБ РФ
  desktop.py         — открыть файл / папку на этом компьютере
  web_api.py         — маршруты API: контроллеры разделов и маршрутизатор (Router)
Только стандартная библиотека Python; собирается PyInstaller в один EXE.
"""
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

from config import (ALLOWED_HOSTS, APP_TITLE, BadRequest, BASE_PORT, DATA_DIR, DOCS_DIR, IMG_DIR, ROOT, SERVER_MODE, message_box, store)
import catalog_migrate
from data_setup import FreshBase, prepare_dirs, sync_counter_with_files
from equipment_types import load_types, load_types_builtin
import admin
from version import VERSION as APP_VERSION
import maintenance
import logistics_api
from images import mark_organized, organize_existing
from kp_templates import ensure_templates
from web_api import IMAGES, ROUTER, cp
from app_update import NightUpdate, StartCheck
from server_log import ServerLog

PAID_GET = ('/api/geo/', '/api/party', '/api/check', '/api/imgfetch', '/api/cbr')
GZ_CACHE = {}       # сжатые большие справочники: {ETag: байты gzip} (send_cached)
GZ_LOCK = threading.Lock()


class FileGzip:
    """Сжатые файлы интерфейса: {ETag: байты gzip}. Файл сжимается один раз на версию (а не при каждой загрузке
    страницы); всего ~1,5 МБ сжатого — держится в памяти, устаревшие версии вытесняются."""
    MIN = 1024              # меньше — сжатие не окупается
    MAX_N = 400             # файлов в памяти (интерфейс — ~110)
    cache = {}
    lock = threading.Lock()

    @classmethod
    def get(cls, tag, data, ctype):
        """gzip-байты файла или None (маленький или не текст)."""
        if len(data) < cls.MIN or not (ctype.startswith('text/') or 'javascript' in ctype or ctype.startswith('application/json')
                                       or 'svg' in ctype):
            return None
        with cls.lock:
            hit = cls.cache.get(tag)
        if hit is None:
            import gzip
            hit = gzip.compress(data, 9)
            with cls.lock:
                cls.cache[tag] = hit
                while len(cls.cache) > cls.MAX_N:
                    cls.cache.pop(next(iter(cls.cache)))
        return hit
MAX_BODY = 300 * 1024 * 1024    # самый большой запрос — загрузка резервной копии базы
# программа запустилась и отвечает (после самопроверки обновления): сбой после этого launcher.py не считает сбоем
# запуска обновления и прежнюю версию не возвращает
STARTED = False


class Handler(BaseHTTPRequestHandler):
    server_version = 'KP/1.0'
    sys_version = ''        # в заголовке Server — без версии Python
    # HTTP/1.1: соединение держится между запросами (60 файлов интерфейса — без новых подключений), а браузер кэширует
    # ответы API с меткой версии (ETag) и получает «не изменилось» (304) вместо повторной загрузки каталога.
    # Ответы — только через send() / send_file() (всегда с Content-Length).
    protocol_version = 'HTTP/1.1'
    timeout = 120           # простаивающее соединение закрывается
    # браузер закрыл соединение, не дождавшись ответа (ушёл со страницы, отменил запрос, пропала сеть), — не ошибка сервера;
    # на Windows так же: WinError 64 «сетевое имя больше недоступно», 1236 «соединение прервано»
    GONE = (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)
    GONE_WIN = (64, 1236)

    @classmethod
    def gone(cls, e):
        return isinstance(e, cls.GONE) or getattr(e, 'winerror', None) in cls.GONE_WIN

    def log_message(self, fmt, *args):  # у EXE без консоли нет stderr
        pass

    # --- ответы ---
    def is_local(self):
        a = (self.client_address or ('',))[0]
        return a in ('127.0.0.1', '::1', '::ffff:127.0.0.1') or a.startswith('127.')

    @staticmethod
    def file_tag(f):
        """Метка версии файла (ETag): время изменения и размер."""
        st = os.stat(f)
        return '"%x-%x"' % (st.st_mtime_ns, st.st_size)

    def send_file(self, f, ctype, cache, csp=None, data=None):
        """Файл с проверкой версии (ETag): неизменённый файл браузер берёт из своего кэша — ответ 304 без тела.
        Интерфейс (cache='no-cache') проверяется при каждой загрузке, файлы с меткой версии в адресе — хранятся год,
        изображения — неделю. data — готовое содержимое вместо файла (index.html с метками версий)."""
        tag = self.file_tag(f) if data is None else '"%x"' % (zlib.crc32(data) & 0xffffffff)
        if self.headers.get('If-None-Match') == tag:
            self.send_response(304)
            self.send_header('ETag', tag)
            self.send_header('Cache-Control', cache)
            self.end_headers()
            return
        extra = {'Cache-Control': cache, 'ETag': tag}
        if csp:
            extra['Content-Security-Policy'] = csp
        if data is None:
            with open(f, 'rb') as fh:
                data = fh.read()
        # текст интерфейса (JS, CSS, HTML) — сжатый один раз на версию файла, дальше из памяти (FileGzip)
        gz = FileGzip.get(tag, data, ctype) if 'gzip' in (self.headers.get('Accept-Encoding') or '') else None
        if gz is not None:
            extra['Content-Encoding'] = 'gzip'
            extra['Vary'] = 'Accept-Encoding'
            return self.send(200, ctype, gz, extra, compressed=True)
        return self.send(200, ctype, data, extra)

    def send(self, code, ctype, body, extra=None, compressed=False):
        data = body if isinstance(body, bytes) else str(body).encode('utf-8')
        gz = not compressed and len(data) > 20000 and 'gzip' in (self.headers.get('Accept-Encoding') or '') and \
            (ctype.startswith('application/json') or ctype.startswith('text/'))
        if gz:
            import gzip
            data = gzip.compress(data, 5)
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        if gz:
            self.send_header('Content-Encoding', 'gzip')
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

    def send_json(self, obj):
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        self.send(200, 'application/json; charset=utf-8', text)

    def send_cached(self, tag, make):
        """Справочник с версией: браузер хранит копию и спрашивает «изменилось ли?» (If-None-Match).
        Не изменилось — короткий ответ 304 без данных; иначе — данные (make()) с новой меткой.
        Большой ответ (каталог — 12 МБ) сжимается один раз на версию и отдаётся всем сотрудникам готовым (GZ_CACHE)."""
        etag = 'W/"%s-%s"' % (tag, APP_VERSION)
        extra = {'ETag': etag, 'Cache-Control': 'no-cache'}
        if etag in (self.headers.get('If-None-Match') or ''):
            return self.send(304, 'application/json; charset=utf-8', b'', extra)
        gz_ok = 'gzip' in (self.headers.get('Accept-Encoding') or '')
        hit = GZ_CACHE.get(etag) if gz_ok else None
        if hit is None:
            obj = make()
            text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
            data = text.encode('utf-8')
            if not gz_ok or len(data) < 200000:
                return self.send(200, 'application/json; charset=utf-8', data, extra)
            import gzip
            hit = gzip.compress(data, 6)
            with GZ_LOCK:
                GZ_CACHE[etag] = hit
                while len(GZ_CACHE) > 8:          # старые версии — прочь
                    GZ_CACHE.pop(next(iter(GZ_CACHE)))
        return self.send(200, 'application/json; charset=utf-8', hit, dict(extra, **{'Content-Encoding': 'gzip'}), compressed=True)

    def base_rev(self):
        """С какой правки записи начинали редактирование (заголовок X-KP-Rev); нет — сохранить без проверки."""
        v = (self.headers.get('X-KP-Rev') or '').strip()
        return int(v) if v.isdigit() else None

    def conflict(self, e):
        return self.send(409, 'application/json; charset=utf-8', json.dumps(e.info(), ensure_ascii=False))

    def attachment(self, fn, fallback='file'):
        """Заголовок «скачать как» с русским именем файла (fallback — латинское имя, если в имени нет латиницы)."""
        ascii_fn = re.sub(r'[^A-Za-z0-9._-]', '_', fn.encode('ascii', 'ignore').decode()) or fallback
        return {'Content-Disposition': 'attachment; filename="%s"; filename*=UTF-8\'\'%s' % (ascii_fn, urllib.parse.quote(fn))}

    def not_found(self, text='not found'):
        self.send(404, 'text/plain; charset=utf-8', text)

    def body(self):
        # тело читается один раз и запоминается: его смотрят и проверка прав / модерация (admin.py), и сам маршрут
        if not hasattr(self, '_body'):
            n = self.body_size()
            self._body = self.rfile.read(n) if n > 0 else b''
        return self._body

    def body_size(self):
        try:
            return max(0, int(self.headers.get('Content-Length') or 0))
        except ValueError:
            return 0

    def request_allowed(self):
        """Защита от чужих сайтов, открытых в браузере сотрудника: имя в адресе (подмена DNS) и источник изменяющего
        запроса (подделка запроса). Программа и её скрипты запрос не подписывают Origin чужого сайта; curl/PowerShell — без Origin."""
        host = (self.headers.get('Host') or '').strip().lower()
        name = host.rsplit(':', 1)[0] if not host.endswith(']') else host
        name = name.strip('[]')
        if not SERVER_MODE:
            if name not in ('localhost', '127.0.0.1', '::1'):
                return False
        elif ALLOWED_HOSTS and name not in ALLOWED_HOSTS and name not in ('localhost', '127.0.0.1', '::1'):
            return False
        if self.command not in ('GET', 'HEAD'):
            origin = (self.headers.get('Origin') or '').strip().lower()
            if origin and origin != 'null' and urllib.parse.urlsplit(origin).netloc != host:
                return False
            if origin == 'null':
                return False
        return True

    def send_response(self, code, message=None):
        self._code = code
        super().send_response(code, message)

    # --- маршрутизация ---
    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    # данные одного запроса: при HTTP/1.1 обработчик обслуживает несколько запросов соединения подряд — перед каждым
    # они сбрасываются (тело, вошедший менеджер, код ответа), иначе следующий запрос увидел бы данные предыдущего
    PER_REQUEST = ('_body', '_kp_user', '_kp_login', '_code')

    def dispatch(self):
        for a in self.PER_REQUEST:
            self.__dict__.pop(a, None)
        try:
            self._dispatch()
        finally:
            # тело запроса не прочитано (отказ до разбора) — его остаток нельзя принять за следующий запрос
            if not hasattr(self, '_body') and self.body_size() > 0:
                self.close_connection = True

    def _dispatch(self):
        try:
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            m = 'GET' if self.command == 'HEAD' else self.command
            if not self.request_allowed():
                self.close_connection = True
                return self.send(403, 'text/plain; charset=utf-8', 'Запрос отклонён: откройте программу по её адресу')
            # запросы, которые тратят лимиты внешних сервисов (Checko, DaData, карты, курсы, скачивание картинок), — только из
            # программы: её запросы несут заголовок X-KP-User-Id, а чужой сайт в браузере сотрудника такой заголовок не поставит
            if m == 'GET' and path.startswith(PAID_GET) and 'X-KP-User-Id' not in self.headers:
                return self.send(403, 'text/plain; charset=utf-8', 'Запрос отклонён: только из программы')
            if self.body_size() > MAX_BODY:
                self.close_connection = True
                return self.send(413, 'text/plain; charset=utf-8', 'Слишком большой запрос')
            # права, модерация и журнал действий (admin.py), вход по паролю — и для шаблонов и картинок: True — ответ уже отправлен, функция — записать в журнал
            if m in ('POST', 'PUT', 'DELETE') and path.startswith('/api/'):
                NightUpdate.touch()          # кто-то работает: ночное обновление подождёт
            hook = admin.guard(self, store(), m, path) if path.startswith(('/api/', '/tpl/', '/img/')) else None
            if hook is True:
                return
            self.route()
            if callable(hook) and getattr(self, '_code', 500) < 400:
                hook()
        except (BadRequest, UnicodeDecodeError, json.JSONDecodeError) as e:      # недопустимый идентификатор, испорченное тело — 400
            try:
                self.send(400, 'text/plain; charset=utf-8', str(e) if isinstance(e, BadRequest) else 'Неверный запрос: нужен JSON в кодировке UTF-8')
            except Exception:
                pass
        except Exception as e:
            # пользователю — без путей и внутренностей; подробности — в журнал сервера (data/logs/kp.log, «Настройки → Система»)
            try:
                self.send(500, 'text/plain; charset=utf-8', 'Внутренняя ошибка сервера (%s). Подробности — в журнале сервера.' % type(e).__name__)
            except Exception:
                if self.gone(e):          # браузер уже закрыл соединение — ответ не нужен, и это не ошибка сервера
                    self.close_connection = True
                    return
            ServerLog.failure('%s %s' % (self.command, urllib.parse.urlsplit(self.path).path[:300]), e)

    def route(self):
        """Маршруты API — контроллеры разделов в web_api.py (Router: первый подходящий по пути и методу)."""
        return ROUTER.dispatch(self)


def already_running():
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
                'http://127.0.0.1:%d/api/ping' % BASE_PORT, timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # на Windows SO_REUSEADDR позволил бы двум процессам занять один порт; на Linux/macOS он нужен для перезапуска
    allow_reuse_address = os.name != 'nt'
    # очередь входящих соединений: по умолчанию 5 — утром 20 браузеров по 6 соединений переполняли её, и часть запросов
    # ждала повтора соединения 1–3 с; 128 — как у обычных веб-серверов
    request_queue_size = 128
    def handle_error(self, request, client_address):
        """Ошибка вне обработчика запроса — в журнал сервера (по умолчанию socketserver печатал её в stderr, которого у EXE нет);
        браузер закрыл соединение — не ошибка (Handler.gone)."""
        e = sys.exc_info()[1]
        if not Handler.gone(e):
            ServerLog.failure('соединение %s' % (client_address[0] if client_address else '?'), e)


class Server6(Server):
    address_family = socket.AF_INET6


def start_ipv6(port, main_server):
    """localhost в Windows часто означает ::1 — слушаем и его, как это делал HttpListener."""
    try:
        s6 = Server6(('::1', port), Handler)
    except OSError:
        return
    s6.main_server = main_server
    threading.Thread(target=s6.serve_forever, daemon=True).start()


def start_server():
    host = '0.0.0.0' if SERVER_MODE else '127.0.0.1'
    ports = [BASE_PORT] if SERVER_MODE else range(BASE_PORT, BASE_PORT + 40)   # у сервера отдела адрес постоянный
    for port in ports:
        try:
            return Server((host, port), Handler), port
        except OSError:
            continue
    return None, None


def main():
    # один экземпляр: если программа уже работает — просто открываем её
    if already_running():
        webbrowser.open('http://localhost:%d/' % BASE_PORT)
        return 0
    log = ServerLog.install(DATA_DIR)          # журнал сервера: вывод программы и ошибки — в data/logs/kp.log
    if log:
        log.info('Запуск: версия %s%s, %s' % (APP_VERSION, ' (обновление поверх EXE %s)' % os.environ.get('KP_BASE_VERSION', '')
                                               if os.environ.get('KP_UPDATE_DIR') else '', 'сервер отдела' if SERVER_MODE else 'программа на этом компьютере'))
    import importlib.util
    if importlib.util.find_spec('sqlite3') is None:     # база данных программы; без модуля программа работать не может
        message_box('В сборке программы нет модуля базы данных SQLite.\n\n'
                    'Пересоберите EXE из актуального проекта (kp.spec не должен исключать sqlite3) '
                    'или скачайте готовую сборку из GitHub Actions.')
        return 1
    try:
        prepare_dirs()
        from settings_history import SettingsHistory
        store().kv_hook = SettingsHistory(store())     # правки настроек людьми — в историю с откатом
        ensure_templates()
        store().migrate_json(DATA_DIR)   # переход с версии, хранившей данные в JSON-файлах
        admin.startup(store(), DATA_DIR)   # сброс пароля по data/admin-reset.txt, очистка корзины
        from app_update import Updater
        Updater(store(), ROOT, DATA_DIR).absorb_failures()     # обновление не запустилось — запись в «Обновления»
        # обслуживание базы: копия за сегодня, архив журнала, сжатие раз в месяц — в фоне, затем раз в сутки
        threading.Thread(target=maintenance.Background.run, args=(store(), DATA_DIR), daemon=True, name='maintenance-start').start()
        maintenance.Background.daily(store(), DATA_DIR)
        # отложенные проверки контрагентов: когда лимит Checko обновится (после 00:00 по Москве) — выполнить очередь
        maintenance.Background.every(1800, lambda: cp().run_queue(), 'очередь проверок контрагентов')
        # ставки доставки по ATI.SU — раз в сутки (период и направления — «Настройки» → «Логистика»)
        maintenance.Background.every(3 * 3600, lambda: logistics_api.auto_refresh(store()), 'ставки доставки')
        import feeds
        feeds.IMAGE_STORE = IMAGES
        maintenance.Background.every(3600, lambda: feeds.auto_check(store()), 'фиды поставщиков')     # фиды поставщиков: РРЦ и наличие раз в день
        maintenance.Background.every(6 * 3600, lambda: Updater(store(), ROOT, DATA_DIR).auto_check(), 'проверка новой версии')   # новая версия на GitHub — раз в сутки
        from admin_alerts import AdminAlerts
        import config
        maintenance.Background.every(3600, lambda: AdminAlerts(store(), config).check(), 'письма администратору о проблемах')
        from server_task import ServerTask
        if ServerTask.applicable(SERVER_MODE):     # задача Планировщика: без остановки через 3 дня работы и от батареи (ИБП)
            ServerTask(store()).start(config.STARTED)
        feeds.upgrade(store(), load_types()['types'], APP_VERSION)          # после обновления — фиды по новым правилам
        fresh = FreshBase.check()
        sync_counter_with_files()
    except Exception as e:
        ServerLog.failure('запуск', e)
        if StartCheck.armed() and StartCheck.code_error(e):
            raise          # ошибка в коде обновления: launcher.py вернёт прежнюю версию и запустит её
        if 'malformed' in str(e) or 'not a database' in str(e):
            message_box('Файл базы данных повреждён:\n%s\n\n%s\n\n'
                        'Так бывает, когда kp.sqlite3 подменяют вручную при оставшихся рядом файлах kp.sqlite3-wal и kp.sqlite3-shm.\n'
                        'Что сделать: остановить программу, удалить kp.sqlite3-wal и kp.sqlite3-shm, затем положить на место kp.sqlite3 '
                        'копию из папки data\\backup (архивы ZIP: kp-ДАТА.zip в backup\\auto — автоматические копии, kp-…-before-….zip — '
                        'перед изменениями; файл kp.sqlite3 — внутри архива). '
                        'Загружать файл базы впредь лучше через «Настройки → Копии и обслуживание базы → Файл базы целиком».'
                        % (os.path.join(DATA_DIR, 'kp.sqlite3'), e))
            return 1
        message_box('Не удалось подготовить папки данных:\n%s\n\n%s' % (DATA_DIR, e))
        return 1
    try:   # каталог под новую структуру категорий — один раз; перед этим копия базы в data/backup
        if fresh:   # новая база: переносить в новую структуру нечего
            catalog_migrate.mark_done(store())
            mark_organized(store())
        rep = catalog_migrate.run(store(), load_types_builtin(), (store().kv_get('types') or {}).get('types', []), IMG_DIR, os.path.join(DATA_DIR, 'backup'))
        organize_existing(store(), load_types()['types'], IMG_DIR, os.path.join(DATA_DIR, 'backup'), backup=(rep or {}).get('backup'))
    except Exception as e:
        ServerLog.failure('обновление каталога или раскладка изображений (будут повторены при следующем запуске)', e)
    if DATA_DIR.startswith('\\\\'):
        message_box('Папка данных указана в сети (%s).\n\nБазу данных нельзя держать в общей сетевой папке — '
                    'при одновременной работе она может повредиться. Для работы всем отделом используйте '
                    'сервер отдела (server-setup\\1. Установить сервер отдела.bat), а dataDir оставьте пустым.' % DATA_DIR, error=False)
    httpd, port = start_server()
    if not httpd:
        ServerLog.failure('запуск: все порты заняты (%d…)' % BASE_PORT)
        message_box('Не удалось запустить сервер: все порты заняты.')
        return 1
    ServerLog.note('Сервер работает: порт %d' % port)
    # ночное обновление (если включено в «Обновлениях»): проверка раз в полчаса, установка — и перезапуск этого сервера
    from app_update import Restarter, Updater
    maintenance.Background.every(1800, lambda: NightUpdate(Updater(store(), ROOT, DATA_DIR)).run(
        lambda: Restarter(SERVER_MODE).restart(httpd)), 'ночное обновление')
    if not SERVER_MODE:
        start_ipv6(port, httpd)
    # адрес localhost (а не 127.0.0.1) — чтобы браузер видел черновики, сохранённые прежней версией
    url = 'http://localhost:%d/' % port

    def ready():
        global STARTED
        STARTED = True
        if not os.environ.get('KP_NO_BROWSER'):          # после перезапуска из «Настроек» браузер уже открыт
            webbrowser.open(url)
    # обновление (патч) сначала отвечает на свои главные адреса — тогда открывается браузер; не ответило — сервер
    # останавливается, и launcher.py возвращает прежнюю версию
    check = StartCheck(port, httpd, ready) if StartCheck.armed() else None
    if check:
        check.start()
    else:
        opener = threading.Timer(0.3, ready)
        opener.daemon = True
        opener.start()
    try:
        print('%s запущен: %s\nДанные: %s\nГотовые КП: %s' % (APP_TITLE, url, DATA_DIR, DOCS_DIR), flush=True)
        if SERVER_MODE:
            print('Режим сервера отдела. Сотрудники открывают: http://%s:%d/' % (socket.gethostname(), port), flush=True)
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
