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

PAID_GET = ('/api/geo/', '/api/party', '/api/check', '/api/imgfetch', '/api/cbr')
GZ_CACHE = {}       # сжатые большие справочники: {ETag: байты gzip} (send_cached)
GZ_LOCK = threading.Lock()
MAX_BODY = 300 * 1024 * 1024    # самый большой запрос — загрузка резервной копии базы


class Handler(BaseHTTPRequestHandler):
    server_version = 'KP/1.0'
    sys_version = ''        # в заголовке Server — без версии Python
    # HTTP/1.1: соединение держится между запросами (60 файлов интерфейса — без новых подключений), а браузер кэширует
    # ответы API с меткой версии (ETag) и получает «не изменилось» (304) вместо повторной загрузки каталога.
    # Ответы — только через send() / send_file() (всегда с Content-Length).
    protocol_version = 'HTTP/1.1'
    timeout = 120           # простаивающее соединение закрывается

    def log_message(self, fmt, *args):  # у EXE без консоли нет stderr
        pass

    # --- ответы ---
    def is_local(self):
        a = (self.client_address or ('',))[0]
        return a in ('127.0.0.1', '::1', '::ffff:127.0.0.1') or a.startswith('127.')

    def send_file(self, f, ctype, cache, csp=None):
        """Файл с проверкой версии (ETag): неизменённый файл браузер берёт из своего кэша — ответ 304 без тела.
        Интерфейс (cache='no-cache') проверяется при каждой загрузке, изображения хранятся неделю."""
        st = os.stat(f)
        tag = '"%x-%x"' % (st.st_mtime_ns, st.st_size)
        if self.headers.get('If-None-Match') == tag:
            self.send_response(304)
            self.send_header('ETag', tag)
            self.send_header('Cache-Control', cache)
            self.end_headers()
            return
        with open(f, 'rb') as fh:
            extra = {'Cache-Control': cache, 'ETag': tag}
            if csp:
                extra['Content-Security-Policy'] = csp
            return self.send(200, ctype, fh.read(), extra)

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

    def attachment(self, fn):
        """Заголовок «скачать как» с русским именем файла."""
        ascii_fn = re.sub(r'[^A-Za-z0-9._-]', '_', fn.encode('ascii', 'ignore').decode()) or 'file'
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
            # подробности — в журнал сервера; пользователю — без путей и внутренностей
            import traceback
            traceback.print_exc()
            try:
                self.send(500, 'text/plain; charset=utf-8', 'Внутренняя ошибка сервера (%s). Подробности — в журнале сервера.' % type(e).__name__)
            except Exception:
                pass

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
        # обслуживание базы: копия за сегодня, архив журнала, сжатие раз в месяц — в фоне, затем раз в сутки
        threading.Thread(target=maintenance.run, args=(store(), DATA_DIR), daemon=True, name='maintenance-start').start()
        maintenance.start_daily(store(), DATA_DIR)
        # отложенные проверки контрагентов: когда лимит Checko обновится (после 00:00 по Москве) — выполнить очередь
        maintenance.start_every(1800, lambda: cp().run_queue())
        # ставки доставки по ATI.SU — раз в сутки (период и направления — «Настройки» → «Логистика»)
        maintenance.start_every(3 * 3600, lambda: logistics_api.auto_refresh(store()))
        import feeds
        feeds.IMAGE_STORE = IMAGES
        maintenance.start_every(3600, lambda: feeds.auto_check(store()))     # фиды поставщиков: РРЦ и наличие раз в день
        from app_update import Updater
        maintenance.start_every(6 * 3600, lambda: Updater(store(), ROOT, DATA_DIR).auto_check())   # новая версия на GitHub — раз в сутки
        feeds.upgrade(store(), load_types()['types'], APP_VERSION)          # после обновления — фиды по новым правилам
        fresh = FreshBase.check()
        sync_counter_with_files()
    except Exception as e:
        if 'malformed' in str(e) or 'not a database' in str(e):
            message_box('Файл базы данных повреждён:\n%s\n\n%s\n\n'
                        'Так бывает, когда kp.sqlite3 подменяют вручную при оставшихся рядом файлах kp.sqlite3-wal и kp.sqlite3-shm.\n'
                        'Что сделать: остановить программу, удалить kp.sqlite3-wal и kp.sqlite3-shm, затем положить на место kp.sqlite3 '
                        'копию из папки data\\backup (kp-ДАТА.sqlite3 — автоматические копии, kp-…-before-….sqlite3 — перед изменениями). '
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
        print('Обновление каталога или раскладка изображений не выполнены (будут повторены при следующем запуске):', e)
    if DATA_DIR.startswith('\\\\'):
        message_box('Папка данных указана в сети (%s).\n\nБазу данных нельзя держать в общей сетевой папке — '
                    'при одновременной работе она может повредиться. Для работы всем отделом используйте '
                    'сервер отдела (server-setup\\1. Установить сервер отдела.bat), а dataDir оставьте пустым.' % DATA_DIR, error=False)
    httpd, port = start_server()
    if not httpd:
        message_box('Не удалось запустить сервер: все порты заняты.')
        return 1
    if not SERVER_MODE:
        start_ipv6(port, httpd)
    # адрес localhost (а не 127.0.0.1) — чтобы браузер видел черновики, сохранённые прежней версией
    url = 'http://localhost:%d/' % port
    if not os.environ.get('KP_NO_BROWSER'):          # после перезапуска из «Настроек» браузер уже открыт
        opener = threading.Timer(0.3, lambda: webbrowser.open(url))
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
    return 0


if __name__ == '__main__':
    sys.exit(main())
