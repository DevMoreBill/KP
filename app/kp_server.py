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
Только стандартная библиотека Python; собирается PyInstaller в один EXE.
"""
import hashlib
import json
import os
import re
import socket
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cbr import cbr_key_rate, cbr_rates
from config import (ALLOWED_HOSTS, APP_DIR, UPDATE_DIR, APP_TITLE, BASE_PORT, DATA_DIR, DOCS_DIR, DOCS_SHARE, IMG_DIR, MIME, ROOT, SERVER_MODE,
                    docs_path, message_box, read_text, safe_dir, safe_file, safe_id, store, write_bytes)
import catalog_migrate
from data_setup import prepare_dirs, seed_catalog, sync_counter_with_files
from desktop import open_file, open_folder, show_in_folder
from equipment_types import load_types, load_types_builtin, save_user_types, types_builtin_path
import admin
from storage import Conflict, with_rev
from version import VERSION as APP_VERSION
import pdf_convert
import images
import maintenance
import logistics_api
from images import ImageStore, mark_organized, organize_existing
from kp_templates import (TEMPLATES_DIR, TemplateError, copy_template, delete_template, ensure_templates, list_history,
                          list_templates, open_template_file, put_file, reset_template, restore_history, template_file)


_CP = None


def cp():
    """Справочник контрагентов и проверки (создаётся после подготовки папок данных)."""
    global _CP
    if _CP is None:
        from counterparty import Counterparties
        _CP = Counterparties(store())
    return _CP


WEB_DIR = os.path.join(APP_DIR, 'web')      # интерфейс: index.html, css/, js/, vendor/
WEB_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
             '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'}


def web_file(rel):
    """Файл интерфейса по относительному пути внутри app/web (без выхода за пределы папки)."""
    parts = [x for x in rel.replace('\\', '/').split('/') if x and x not in ('.', '..')]
    f = os.path.join(WEB_DIR, *parts)
    if not os.path.normcase(os.path.abspath(f)).startswith(os.path.normcase(os.path.abspath(WEB_DIR))):
        return None
    return f if os.path.isfile(f) and os.path.splitext(f)[1].lower() in WEB_TYPES else None



MAX_BODY = 300 * 1024 * 1024    # самый большой запрос — загрузка резервной копии базы

# хранилище изображений data/img (по папкам категорий)
IMAGES = ImageStore(IMG_DIR)

def pdf_of(docx):
    """PDF рядом с .docx КП, с тем же именем."""
    return os.path.splitext(docx)[0] + '.pdf'

class Handler(BaseHTTPRequestHandler):
    server_version = 'KP/1.0'

    def log_message(self, fmt, *args):  # у EXE без консоли нет stderr
        pass

    # --- ответы ---
    def is_local(self):
        a = (self.client_address or ('',))[0]
        return a in ('127.0.0.1', '::1', '::ffff:127.0.0.1') or a.startswith('127.')

    def send(self, code, ctype, body, extra=None):
        data = body if isinstance(body, bytes) else str(body).encode('utf-8')
        gz = len(data) > 20000 and 'gzip' in (self.headers.get('Accept-Encoding') or '') and \
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
        Не изменилось — короткий ответ 304 без данных; иначе — данные (make()) с новой меткой."""
        etag = 'W/"%s-%s"' % (tag, APP_VERSION)
        if etag in (self.headers.get('If-None-Match') or ''):
            return self.send(304, 'application/json; charset=utf-8', b'', {'ETag': etag, 'Cache-Control': 'no-cache'})
        obj = make()
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        return self.send(200, 'application/json; charset=utf-8', text, {'ETag': etag, 'Cache-Control': 'no-cache'})

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

    def dispatch(self):
        try:
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            m = 'GET' if self.command == 'HEAD' else self.command
            if not self.request_allowed():
                self.close_connection = True
                return self.send(403, 'text/plain; charset=utf-8', 'Запрос отклонён: откройте программу по её адресу')
            if self.body_size() > MAX_BODY:
                self.close_connection = True
                return self.send(413, 'text/plain; charset=utf-8', 'Слишком большой запрос')
            # права, модерация и журнал действий (admin.py): True — ответ уже отправлен, функция — записать в журнал
            hook = admin.guard(self, store(), m, path) if path.startswith('/api/') else None
            if hook is True:
                return
            self.route()
            if callable(hook) and getattr(self, '_code', 500) < 400:
                hook()
        except Exception as e:
            try:
                self.send(500, 'text/plain; charset=utf-8', str(e))
            except Exception:
                pass

    def template_api(self, tid, action, m, q):
        """Редактор шаблона: сохранение файлов, история версий, копия, заводской вариант, открыть в Word."""
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
            return self.send(400, 'text/plain; charset=utf-8', str(e))
        return self.not_found()

    def route(self):
        m = 'GET' if self.command == 'HEAD' else self.command
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True, encoding='utf-8'))

        if path in ('/', '/index.html') or path.startswith('/web/'):
            f = web_file('index.html' if path in ('/', '/index.html') else path[len('/web/'):])
            if not f:
                return self.not_found()
            with open(f, 'rb') as fh:
                return self.send(200, WEB_TYPES[os.path.splitext(f)[1].lower()], fh.read(), {'Cache-Control': 'no-cache'})
        if path == '/favicon.ico':
            icon = os.path.join(APP_DIR, 'icon.ico')
            if not os.path.isfile(icon):
                return self.not_found()
            with open(icon, 'rb') as f:
                return self.send(200, 'image/x-icon', f.read())
        # справочник типов оборудования
        if path == '/api/types':
            if q.get('builtin') == '1':
                return self.send_json(read_text(types_builtin_path()))
            if m == 'PUT':
                save_user_types(self.body())
                return self.send_json(load_types())
            text = json.dumps(load_types(), ensure_ascii=False)
            return self.send_cached('types-' + hashlib.md5(text.encode('utf-8')).hexdigest()[:16], lambda: text)

        # контрагенты: поиск по ИНН, проверка Checko, справочник
        # адреса и расстояния для доставки по России (geo.py): подсказки, координаты, маршрут по дорогам
        if path.startswith('/api/geo/') and m == 'GET':
            import geo
            act = path[len('/api/geo/'):]
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
                    return self.send_json(geo.route(store(), a, b))
                if act == 'unshort':
                    return self.send_json({'url': geo.unshort(q.get('u', ''))})
            except Exception as e:
                return self.send_json({'error': str(e)[:300] or e.__class__.__name__})
            return self.send(404, 'text/plain; charset=utf-8', 'Нет такого запроса')
        if path == '/api/party':
            return self.send_json(cp().lookup(q.get('inn', '')))
        if path == '/api/check/quota':      # сколько проверок Checko осталось сегодня (на весь отдел) и сколько в очереди
            return self.send_json(cp().quota())
        if path == '/api/check':
            return self.send_json(cp().check(q.get('inn', ''), force=q.get('force') == '1', by=admin.actor(self)[1]))
        if path == '/api/integrations/export' and m == 'GET':      # резервная копия ключей (только администратор — см. admin.guard)
            return self.send_json({'kind': 'kp-keys', 'v': 1, 'at': datetime.now().isoformat(timespec='seconds'), 'keys': cp().keys()})
        if path == '/api/integrations':
            if m == 'PUT':
                return self.send_json(cp().save_keys(self.body()))
            return self.send_json(cp().keys_public())
        if path == '/api/clients' and m == 'GET':
            # справочник не грузится целиком: последние использованные или найденные по названию / ИНН / адресу
            try:
                limit, offset = max(1, min(int(q.get('limit') or 50), 500)), max(0, int(q.get('offset') or 0))
            except ValueError:
                limit, offset = 50, 0
            res = store().clients_search(q.get('q', ''), limit, offset)
            res['all'] = store().clients_count() if not q.get('q') else None
            return self.send_json(res)
        r = re.match(r'^/api/clients/([^/]+)$', path)
        if r:
            if m == 'GET':
                c = store().client_get(r.group(1), rev=True)
                return self.send_json(c) if c else self.send(404, 'text/plain; charset=utf-8', 'Клиент не найден')
            if m == 'PUT':
                try:
                    return self.send_json(cp().save_client(r.group(1), self.body(), admin.actor(self)[1], self.base_rev()))
                except Conflict as e:
                    return self.conflict(e)

        # шаблоны КП (папка templates): список, файлы, редактор шаблона
        if path == '/api/templates':
            return self.send_json(list_templates())
        if path == '/api/templates/folder' and m == 'POST' and not self.is_local():
            return self.send_json({'remote': True, 'share': ''})
        if path == '/api/templates/folder' and m == 'POST':
            os.makedirs(TEMPLATES_DIR, exist_ok=True)
            open_folder(TEMPLATES_DIR)
            return self.send_json({'ok': True})
        r = re.match(r'^/api/templates/([A-Za-z0-9_-]+)/([a-z]+)$', path)
        if r:
            return self.template_api(r.group(1), r.group(2), m, q)
        r = re.match(r'^/tpl/([A-Za-z0-9_-]+)/([^/]+)$', path)
        if r:
            f = template_file(r.group(1), urllib.parse.unquote(r.group(2)))
            if not f:
                return self.not_found('Файл шаблона не найден')
            ext = os.path.splitext(f)[1].lower()
            ctype = {'.json': 'application/json; charset=utf-8', '.js': 'text/plain; charset=utf-8',
                     '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}.get(ext) or MIME.get(ext, 'application/octet-stream')
            extra = {'Content-Disposition': 'attachment; filename="%s"' % os.path.basename(f)} if q.get('download') == '1' else None
            with open(f, 'rb') as fh:
                return self.send(200, ctype, fh.read(), extra)

        if path == '/api/ping':
            return self.send_json({'ok': True, 'dataDir': DATA_DIR, 'docsDir': DOCS_DIR, 'local': self.is_local(),
                                   'mode': 'server' if SERVER_MODE else 'local', 'docsShare': DOCS_SHARE,
                                   'host': socket.gethostname(), 'port': self.server.server_address[1], 'items': store().catalog_count(),
                                   'migrations': (store().kv_get('migrations') or [])[-2:]})

        # каталог
        if path == '/api/catalog' and m == 'GET':
            # список — облегчённые карточки (без таблиц характеристик и галерей); полная позиция — по id
            full = q.get('full') == '1'
            return self.send_cached('cat%s-%s' % ('f' if full else 'l', store().data_rev('catalog')),
                                    lambda: store().catalog_full() if full else store().catalog_light())
        if path == '/api/catalog/pending':   # режим модерации и товары с правками на модерации (бейдж «На модерации»)
            return self.send_json({'moderation': bool(admin.moderation(store()).get('enabled')), 'ids': store().pending_ids()})
        r = re.match(r'^/api/catalog/([^/]+)$', path)
        if r:
            cid = safe_id(r.group(1))
            if m == 'GET':
                doc = store().catalog_get(cid, rev=True)
                return self.send_json(doc) if doc else self.not_found()

        # изображения
        # изображения: папки «раздел/категория/производитель» латиницей (app/images.py); одинаковые хранятся один раз
        if path == '/api/img' and m == 'POST':
            data = self.body()
            if data[:8] == b'\x89PNG\r\n\x1a\n':
                ext = '.png'
            elif data[:3] == b'\xff\xd8\xff':
                ext = '.jpg'
            elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
                ext = '.webp'
            else:
                return self.send(400, 'text/plain; charset=utf-8', 'Нужна картинка JPEG, PNG или WebP')
            tmap = {t.get('id'): t for t in load_types()['types']}
            folder, title = images.place(tmap.get(q.get('cat')), q.get('maker'), q.get('model'), q.get('name'), q.get('kind') or 'photo', q.get('caption'))
            rel = IMAGES.put(data, ext, folder, title)
            return self.send_json({'name': rel})
        r = re.match(r'^/img/(.+)$', path)
        if r:
            f = IMAGES.path(r.group(1))
            if not f:
                return self.not_found()
            with open(f, 'rb') as fh:
                return self.send(200, MIME[os.path.splitext(f)[1].lower()], fh.read())

        # менеджеры (контакты в КП)
        if path == '/api/managers' and m == 'GET':
            return self.send_cached('mgr-' + store().data_rev('managers'), lambda: store().managers_list(rev=True))
        r = re.match(r'^/api/managers/([^/]+)$', path)
        if r:
            mid = safe_id(r.group(1))
            if m == 'PUT':
                try:
                    return self.send_json(store().manager_put(mid, self.body().decode('utf-8'), admin.actor(self)[1], self.base_rev()))
                except Conflict as e:
                    return self.conflict(e)

        # PDF: чем можно преобразовать; преобразование присланного DOCX (предпросмотр) без записи в журнал
        if path == '/api/pdf' and m == 'GET':
            return self.send_json(pdf_convert.available(cp().keys().get('convertapiKey')))
        if path == '/api/pdf' and m == 'POST':
            try:
                data = pdf_convert.convert_bytes(self.body(), cp().keys().get('convertapiKey'))
            except Exception as e:
                return self.send(422, 'text/plain; charset=utf-8', 'PDF не создан: %s' % e)
            return self.send(200, 'application/pdf', data, self.attachment(safe_file(q.get('name')) or 'КП.pdf'))

        # журнал КП
        if path == '/api/history':
            if 'limit' in q:     # постранично, с поиском и итогами по всему отбору
                return self.send_json(admin.history_page(self, store(), q))
            return self.send_json(admin.history_out(self, store().kp_list()))
        if path == '/api/kp/new' and m == 'POST':
            n = store().next_number()
            return self.send_json({'id': n, 'number': n})
        r = re.match(r'^/api/kp/([^/]+)/(state|meta)$', path)
        if r:
            kid = safe_id(r.group(1))
            if m == 'PUT':
                text = self.body().decode('utf-8')
                try:
                    if not isinstance(json.loads(text), dict):
                        raise ValueError
                except ValueError:   # испорченная запись ломала бы журнал КП у всех
                    return self.send(400, 'text/plain; charset=utf-8', 'Неверный формат КП')
                try:
                    rev = store().kp_set(kid, r.group(2), admin.kp_in(self, store(), kid, r.group(2), text), admin.actor(self)[1],
                                         self.base_rev() if r.group(2) == 'state' else None)
                except Conflict as e:
                    return self.conflict(e)
                return self.send_json({'ok': True, 'rev': rev})
            if m == 'GET':
                v = store().kp_get(kid, r.group(2))
                if v and r.group(2) == 'state':
                    v = with_rev(admin.kp_out(self, 'state', v), store().rev_of('kp', kid)['rev'])
                    return self.send_json(v)
                return self.send_json(admin.kp_out(self, r.group(2), v)) if v else self.not_found()
        r = re.match(r'^/api/kp/([^/]+)/rev$', path)      # кто и когда последним сохранил КП — проверка перед сохранением
        if r and m == 'GET':
            return self.send_json(store().rev_of('kp', safe_id(r.group(1))))
        # история версий КП: список и состояние выбранной версии (экономика чужого КП убирается, как и у текущей)
        r = re.match(r'^/api/kp/([^/]+)/versions$', path)
        if r and m == 'GET':
            return self.send_json(store().kp_versions(safe_id(r.group(1))))
        r = re.match(r'^/api/kp/([^/]+)/versions/(\d+)$', path)
        if r and m == 'GET':
            v = store().kp_version_state(safe_id(r.group(1)), r.group(2))
            return self.send_json(admin.kp_out(self, 'state', v)) if v else self.not_found()
        r = re.match(r'^/api/kp/([^/]+)/docx$', path)
        if r and m == 'PUT':
            kid = safe_id(r.group(1))
            name = safe_file(q.get('name'))
            sub = safe_dir(q.get('dir'))            # папка менеджера (фамилия)
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
            return self.send_json({'ok': True, 'path': f, 'rel': rel})
        r = re.match(r'^/api/kp/([^/]+)/docx$', path)
        if r and m == 'GET':
            # скачивание готового КП — для сотрудников, открывших программу по сети
            rel = store().kp_get(safe_id(r.group(1)), 'docx')
            f = docs_path(rel.strip()) if rel else None
            if not f or not os.path.isfile(f):
                return self.not_found('Файл КП не найден')
            with open(f, 'rb') as fh:
                data = fh.read()
            fn = os.path.basename(f)
            return self.send(200, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data,
                             {'Content-Disposition': 'attachment; filename="%s"; filename*=UTF-8\'\'%s' % (
                                 re.sub(r'[^A-Za-z0-9._-]', '_', fn.encode('ascii', 'ignore').decode()) or 'KP.docx', urllib.parse.quote(fn))})
        # PDF сохранённого КП: создаётся рядом с .docx (тем же именем), скачивается сотрудниками по сети
        r = re.match(r'^/api/kp/([^/]+)/pdf$', path)
        if r:
            rel = store().kp_get(safe_id(r.group(1)), 'docx')
            f = docs_path(rel.strip()) if rel else None
            if not f or not os.path.isfile(f):
                return self.not_found('Файл КП не найден')
            pdf = pdf_of(f)
            if m == 'POST':
                try:
                    pdf_convert.convert_file(f, pdf, cp().keys().get('convertapiKey'))
                except Exception as e:
                    return self.send(422, 'text/plain; charset=utf-8', 'PDF не создан: %s' % e)
                return self.send_json({'ok': True, 'path': pdf, 'local': self.is_local()})
            if m == 'GET':
                if not os.path.isfile(pdf):
                    return self.not_found('PDF этого КП ещё не создан')
                with open(pdf, 'rb') as fh:
                    return self.send(200, 'application/pdf', fh.read(), self.attachment(os.path.basename(pdf)))
        r = re.match(r'^/api/kp/([^/]+)/openpdf$', path)
        if r and m == 'POST':
            rel = store().kp_get(safe_id(r.group(1)), 'docx')
            pdf = pdf_of(docs_path(rel.strip())) if rel else None
            if not pdf or not os.path.isfile(pdf):
                return self.not_found('PDF этого КП ещё не создан')
            if not self.is_local():
                return self.send_json({'remote': True, 'download': '/api/kp/%s/pdf' % safe_id(r.group(1))})
            open_file(pdf)
            return self.send_json({'ok': True})
        r = re.match(r'^/api/kp/([^/]+)/(open|folder)$', path)
        if r and m == 'POST':
            rel = store().kp_get(safe_id(r.group(1)), 'docx')
            if not rel:
                return self.not_found('Файл КП не найден')
            if not self.is_local():   # открыть Word можно только на своём компьютере — сотруднику по сети отдаём файл
                return self.send_json({'remote': True, 'download': '/api/kp/%s/docx' % safe_id(r.group(1)),
                                       'share': (DOCS_SHARE.rstrip('\\/') + '\\' + rel.replace('/', '\\')) if DOCS_SHARE else ''})
            f = docs_path(rel.strip())
            if not os.path.isfile(f):
                return self.not_found('Файл КП был перемещён или удалён')
            if r.group(2) == 'open':
                open_file(f)
            else:
                show_in_folder(f)
            return self.send_json({'ok': True})
        if path == '/api/folder' and m == 'POST':
            sub = safe_dir(q.get('dir'))
            target = os.path.join(DOCS_DIR, sub) if sub else DOCS_DIR
            os.makedirs(target, exist_ok=True)
            if not self.is_local():
                return self.send_json({'remote': True, 'share': (DOCS_SHARE.rstrip('\\/') + ('\\' + sub if sub else '')) if DOCS_SHARE else ''})
            open_folder(target)
            return self.send_json({'ok': True})
        if path == '/api/cbr':
            return self.send_json(cbr_saved('cbr_last', cbr_rates))
        if path == '/api/cbr/keyrate':
            return self.send_json(cbr_saved('keyrate_last', cbr_key_rate))
        # картинки карточек: логотипы производителей из каталога; картинка, перетащенная со страницы сайта
        if path == '/api/logos' and m == 'GET':
            import imgfetch
            return self.send_json(imgfetch.logos(store()))
        if path == '/api/imgfetch' and m == 'GET':
            import imgfetch
            try:
                ctype, data = imgfetch.fetch_image(q.get('url') or '')
            except Exception as e:
                return self.send(422, 'text/plain; charset=utf-8', 'Картинка не загружена: %s' % e)
            return self.send(200, ctype, data)
        if path == '/api/pagephotos' and m == 'POST':     # фото со страницы товара на сайте поставщика — в изображения позиции
            import feeds
            d = json.loads(self.body().decode('utf-8') or '{}')
            tmap = {t.get('id'): t for t in load_types()['types']}
            try:
                return self.send_json(feeds.page_photos(store(), IMAGES, str(d.get('url') or '').strip(), tmap.get(d.get('cat')),
                                                        d.get('maker') or '', d.get('model') or '', d.get('name') or ''))
            except Exception as e:
                return self.send(422, 'text/plain; charset=utf-8', 'Фото со страницы не загружены: %s' % str(e)[:200])
        if path == '/api/logistics/quote' and m == 'POST':   # цены перевозчиков (ATI.SU, ПЭК, Деловые Линии, КИТ) — итог по максимуму
            try:
                return self.send_json(logistics_api.quote(store(), json.loads(self.body().decode('utf-8') or '{}')))
            except (ValueError, TypeError, KeyError) as e:
                return self.send(400, 'text/plain; charset=utf-8', 'Неверный запрос: %s' % e)
        if path == '/api/logistics/status' and m == 'GET':
            return self.send_json({'providers': logistics_api.providers(store()), 'auto': store().kv_get('logisticsAuto'),
                                   'settings': logistics_api.auto_settings(store())})
        if path == '/api/logistics/refresh' and m == 'POST':   # обновить ставки по ATI.SU сейчас (администратор)
            try:
                rec = logistics_api.auto_refresh(store(), force=True)
            except Exception as e:
                return self.send(502, 'text/plain; charset=utf-8', 'ATI.SU: %s' % e)
            return self.send_json(rec or {'error': 'Не задан ключ ATI.SU («Интеграции») или обновление уже идёт'})
        if path == '/api/logistics':                    # тарифы доставки по России (общие для отдела; изменяет администратор)
            if m == 'PUT':
                try:
                    d = json.loads(self.body().decode('utf-8') or '{}')
                except ValueError:
                    d = None
                if not isinstance(d, dict) or len(json.dumps(d)) > 100000:
                    return self.send(400, 'text/plain; charset=utf-8', 'Неверный формат тарифов')
                d['updatedAt'] = datetime.now().isoformat(timespec='seconds')
                d['updatedBy'] = admin.actor(self)[1]
                store().kv_set('logistics', d)
                return self.send_json({'ok': True})
            return self.send_json(dict(store().kv_get('logistics') or {}, _auto=store().kv_get('logisticsAuto')))
        if path == '/api/uitexts' and m == 'GET':       # тексты интерфейса, изменённые администратором: {исходный текст: новый}
            return self.send_json(store().kv_get('uitexts') or {})
        if path == '/api/uitexts' and m == 'PUT':       # только администратор (admin.guard)
            try:
                d = json.loads(self.body().decode('utf-8') or '{}')
            except ValueError:
                return self.send(400, 'text/plain; charset=utf-8', 'Неверный формат')
            if not isinstance(d, dict) or len(d) > 3000:
                return self.send(400, 'text/plain; charset=utf-8', 'Неверный формат')
            out = {str(k)[:2000]: str(v)[:4000] for k, v in d.items() if str(k).strip() and isinstance(v, str)}
            store().kv_set('uitexts', out)
            return self.send_json({'ok': True, 'count': len(out)})
        if path == '/api/version' and m == 'GET':       # версия программы и установленное обновление
            import version
            return self.send_json({'version': version.VERSION, 'patched': bool(UPDATE_DIR), 'updateDir': UPDATE_DIR})
        if path == '/api/calendar' and m == 'GET':      # производственный календарь РФ (рабочие / банковские дни)
            import workcal
            qy = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query)).get('year') or ''
            try:
                return self.send_json(workcal.year(store(), int(qy or 0)))
            except ValueError as e:
                return self.send(400, 'text/plain; charset=utf-8', str(e))
        # «Экономика сделки»: справочник поставщиков и коды ТН ВЭД / пошлины — общие для отдела (в базе)
        if path == '/api/suppliers' and m == 'GET':
            return self.send_cached('sup-' + store().data_rev('suppliers'), lambda: store().suppliers_list())
        r = re.match(r'^/api/suppliers/([A-Za-z0-9_-]{1,64})$', path)
        if r and m == 'PUT':
            try:
                return self.send_json(store().supplier_put(r.group(1), json.loads(self.body().decode('utf-8') or '{}'), admin.actor(self)[1], self.base_rev()))
            except Conflict as e:
                return self.conflict(e)
            except ValueError as e:
                return self.send(400, 'text/plain; charset=utf-8', str(e))
        if path == '/api/customs':
            if m == 'GET':
                return self.send_json(store().customs_all())
            if m == 'PUT':
                d = json.loads(self.body().decode('utf-8') or '{}')
                try:
                    store().customs_put(d.get('key'), d.get('code'), d.get('duty'), d.get('note'), admin.actor(self)[1], d.get('name'))
                except ValueError as e:
                    return self.send(400, 'text/plain; charset=utf-8', str(e))
                return self.send_json({'ok': True})
        if path == '/api/backup' and m == 'POST':
            if not self.is_local():
                return self.send_json({'ok': False, 'message': 'Резервная копия создаётся на компьютере-сервере'})
            stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
            dst = store().backup(os.path.join(ROOT, 'backup', stamp, 'kp.sqlite3'))
            return self.send_json({'ok': True, 'path': dst, 'dir': os.path.dirname(dst)})
        if path == '/api/shutdown' and m == 'POST' and (SERVER_MODE or not self.is_local()):
            return self.send_json({'ok': False, 'message': 'Сервер отдела выключается только на компьютере-сервере'})
        if path == '/api/shutdown' and m == 'POST':
            self.send_json({'ok': True})
            target = getattr(self.server, 'main_server', self.server)
            threading.Thread(target=target.shutdown, daemon=True).start()
            return

        self.not_found()


def cbr_saved(key, fetch):
    """Курсы / ключевая ставка ЦБ: удачный ответ сохраняется в базе; если ЦБ недоступен — последний сохранённый
    (с пометкой stale и временем загрузки), чтобы расчёты работали и без интернета."""
    try:
        res = fetch()
    except Exception as e:
        res = {'error': str(e)}
    if res and not res.get('error'):
        res = dict(res, fetched=datetime.now().strftime('%Y-%m-%dT%H:%M:%S'))
        try:
            store().kv_set(key, res)
        except Exception:
            pass
        return res
    last = store().kv_get(key)
    if isinstance(last, dict) and not last.get('error'):
        return dict(last, stale=True, src=(last.get('src') or 'ЦБ РФ') + ' — сохранённое значение, ЦБ сейчас недоступен',
                    fetchError=res.get('error', ''))
    return res


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
    try:
        import sqlite3  # noqa: F401 — база данных программы; без модуля программа работать не может
    except ImportError as e:
        message_box('В сборке программы нет модуля базы данных SQLite (%s).\n\n'
                    'Пересоберите EXE из актуального проекта (kp.spec не должен исключать sqlite3) '
                    'или скачайте готовую сборку из GitHub Actions.' % e)
        return 1
    try:
        prepare_dirs()
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
        feeds.upgrade(store(), load_types()['types'], APP_VERSION)          # после обновления — фиды по новым правилам
        seeded = seed_catalog()
        sync_counter_with_files()
    except Exception as e:
        message_box('Не удалось подготовить папки данных:\n%s\n\n%s' % (DATA_DIR, e))
        return 1
    try:   # каталог под новую структуру категорий — один раз; перед этим копия базы в data/backup
        if seeded:   # стартовый каталог уже в новой структуре, изображения — по папкам
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
