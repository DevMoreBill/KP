# -*- coding: utf-8 -*-
"""Конструктор КП ПНЕВМОТЕХ — сервер программы.

Отдаёт интерфейс (app.html) и API; данные — в SQLite (storage.py), контрагенты — counterparty.py.
Режимы (settings.json → mode): «local» — для одного компьютера (127.0.0.1), «server» — сервер отдела,
доступный по сети (0.0.0.0:port). Только стандартная библиотека Python; собирается PyInstaller в один EXE.
"""
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_TITLE = 'Конструктор КП ПНЕВМОТЕХ'
BASE_PORT = 17845
FROZEN = getattr(sys, 'frozen', False)

# root — папка, где лежит EXE (или скрипт); bundle — встроенные в EXE файлы
ROOT = os.path.dirname(os.path.abspath(sys.executable if FROZEN else __file__))
BUNDLE = getattr(sys, '_MEIPASS', ROOT)
if not FROZEN:
    BUNDLE = os.path.dirname(ROOT)  # при запуске из исходников: корень репозитория

SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
CURRENCIES = ('USD', 'EUR', 'CNY')


def message_box(text, error=True):
    """Сообщение пользователю: у EXE без консоли нет другого способа что-то показать."""
    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, text, APP_TITLE, 0x10 if error else 0x40)
            return
        except Exception:
            pass
    try:
        print(text, file=sys.stderr)
    except Exception:
        pass


def read_text(path):
    with open(path, 'r', encoding='utf-8-sig') as f:
        return f.read()


def write_text(path, text):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def write_bytes(path, data):
    with open(path, 'wb') as f:
        f.write(data)


# --- папки данных (можно вынести в сетевую папку через settings.json: {"dataDir": "\\\\server\\share\\КП"}) ---
SETTINGS = {}


def resolve_dirs():
    data_dir = os.path.join(ROOT, 'data')
    docs_dir = os.path.join(ROOT, 'Коммерческие предложения')
    settings = os.path.join(ROOT, 'settings.json')
    if os.path.exists(settings):
        try:
            st = json.loads(read_text(settings))
            SETTINGS.update(st)
            if st.get('dataDir'):
                data_dir = os.path.join(st['dataDir'], 'data')
                docs_dir = os.path.join(st['dataDir'], 'Коммерческие предложения')
        except Exception:
            pass
    else:
        try:
            write_text(settings, '{\n  "mode": "local",\n  "port": 17845,\n  "dataDir": "",\n  "docsShare": ""\n}\n')
        except Exception:
            pass
    return data_dir, docs_dir


DATA_DIR, DOCS_DIR = resolve_dirs()
# mode: "local" — программа для одного компьютера; "server" — сервер отдела, доступен по сети (http://имя-компьютера:порт)
SERVER_MODE = str(SETTINGS.get('mode', 'local')).lower() == 'server'
if SETTINGS.get('port'):
    try:
        BASE_PORT = int(SETTINGS['port'])
    except (TypeError, ValueError):
        pass
DOCS_SHARE = str(SETTINGS.get('docsShare') or '').strip()   # сетевой путь к папке КП для сотрудников, напр. \\\\SERVER\\КП
STORE = None


def store():
    global STORE
    if STORE is None:
        from storage import Store
        STORE = Store(os.path.join(DATA_DIR, 'kp.sqlite3'))
    return STORE
IMG_DIR = os.path.join(DATA_DIR, 'img')


def prepare_dirs():
    for d in (DATA_DIR, IMG_DIR, DOCS_DIR):
        os.makedirs(d, exist_ok=True)


def sync_counter_with_files():
    """Номер КП не должен повторить уже существующий файл (например, если базу восстановили из старой копии)."""
    year = datetime.now().year
    top = 0
    for dp, dn, fn in os.walk(DOCS_DIR):
        for name in fn:
            m = re.match(r'^(\d{4})-(\d{3,})_', name)
            if m and int(m.group(1)) == year:
                top = max(top, int(m.group(2)))
    if top:
        store().ensure_counter_at_least(year, top)


def seed_catalog():
    """Первый запуск на новом компьютере: стартовый каталог с фото из EXE — сразу в базу."""
    st = store()
    if st.catalog_count():
        return
    seed = os.path.join(BUNDLE, 'seed', 'data')
    img = os.path.join(seed, 'img')
    if os.path.isdir(img):
        for name in os.listdir(img):
            target = os.path.join(IMG_DIR, name)
            if not os.path.exists(target):
                shutil.copyfile(os.path.join(img, name), target)
    cat = os.path.join(seed, 'catalog')
    if os.path.isdir(cat):
        for name in os.listdir(cat):
            if name.endswith('.json'):
                st.catalog_put(name[:-5], read_text(os.path.join(cat, name)))


# ---------- шаблоны КП ----------
# Папка «templates» рядом с программой (правится вручную: base.docx в Word, template.json в Блокноте).
TEMPLATES_DIR = os.path.join(ROOT, 'templates') if FROZEN else os.path.join(BUNDLE, 'templates')
TPL_FILES = re.compile(r'^(template\.json|base\.docx|[A-Za-z0-9_-]+\.(jpg|jpeg|png))$')


def ensure_templates():
    """Первый запуск EXE: раскладываем встроенные шаблоны рядом с программой (свои правки не перезаписываются)."""
    src = os.path.join(BUNDLE, 'templates')
    if not os.path.isdir(src) or os.path.normcase(src) == os.path.normcase(TEMPLATES_DIR):
        return
    for name in os.listdir(src):
        dst = os.path.join(TEMPLATES_DIR, name)
        if os.path.isdir(os.path.join(src, name)) and not os.path.exists(dst):
            shutil.copytree(os.path.join(src, name), dst)


def template_dirs():
    out = {}
    if os.path.isdir(TEMPLATES_DIR):
        for name in sorted(os.listdir(TEMPLATES_DIR)):
            d = os.path.join(TEMPLATES_DIR, name)
            if SAFE_ID.match(name) and os.path.isfile(os.path.join(d, 'template.json')):
                out[name] = d
    return out


def list_templates():
    res = []
    for tid, d in template_dirs().items():
        try:
            j = json.loads(read_text(os.path.join(d, 'template.json')))
        except Exception as e:
            res.append({'id': tid, 'name': tid, 'error': 'Ошибка в template.json: %s' % e})
            continue
        res.append({'id': tid, 'name': j.get('name') or tid, 'description': j.get('description', ''), 'filePrefix': j.get('filePrefix', ''),
                    'hasBase': os.path.isfile(os.path.join(d, 'base.docx')),
                    'clients': bool(j.get('clientsImage')) and os.path.isfile(os.path.join(d, j.get('clientsImage', '')))})
    return res


def types_builtin_path():
    return os.path.join(BUNDLE, 'app', 'equipment_types.json')


def load_types():
    """Справочник типов оборудования: встроенный (app/equipment_types.json) + свои (data/types.json).

    Типы из data/types.json с тем же id заменяют встроенные, новые добавляются в конец,
    а тип с "hidden": true скрывается. Так новые виды оборудования добавляются без правки кода.
    """
    try:
        base = json.loads(read_text(types_builtin_path())).get('types', [])
    except Exception:
        base = []
    user = (store().kv_get('types') or {}).get('types', [])
    out = [dict(t) for t in base]
    index = {t.get('id'): i for i, t in enumerate(out)}
    for t in user:
        if not isinstance(t, dict) or not t.get('id'):
            continue
        if t['id'] in index:
            merged = dict(out[index[t['id']]])
            merged.update(t)
            out[index[t['id']]] = merged
        else:
            index[t['id']] = len(out)
            out.append(t)
    return {'version': 1, 'types': [t for t in out if not t.get('hidden')]}


def save_user_types(body):
    data = json.loads(body.decode('utf-8'))
    types = data.get('types')
    if not isinstance(types, list):
        raise ValueError('Ожидается {"types": [...]}')
    for t in types:
        if not isinstance(t, dict) or not re.match(r'^[a-z][a-z0-9_]{1,30}$', t.get('id') or ''):
            raise ValueError('У каждого типа нужен id: латиница, цифры и «_»')
        if not isinstance(t.get('fields', []), list):
            raise ValueError('fields должен быть списком')
    store().kv_set('types', {'version': 1, 'types': types})


_CP = None


def cp():
    """Справочник контрагентов и проверки (создаётся после подготовки папок данных)."""
    global _CP
    if _CP is None:
        from counterparty import Counterparties
        _CP = Counterparties(store())
    return _CP


def app_html_path():
    return os.path.join(BUNDLE, 'app', 'app.html')


def safe_id(s):
    if not SAFE_ID.match(s or ''):
        raise ValueError('Недопустимый идентификатор: %s' % s)
    return s


def safe_file(s):
    s = re.sub(r'[\\/:*?"<>|]', '', s or '').strip()
    return s or 'КП.docx'


def safe_dir(s):
    """Имя подпапки (фамилия менеджера): без путей и запрещённых символов."""
    s = re.sub(r'[\\/:*?"<>|.]', '', s or '').strip()
    return s[:60]


def docs_path(rel):
    """Путь к файлу КП по относительному имени из docx.txt (с подпапкой менеджера или без)."""
    parts = [safe_file(x) for x in re.split(r'[\\/]', rel or '') if x]
    return os.path.join(DOCS_DIR, *parts) if parts else os.path.join(DOCS_DIR, 'КП.docx')


def open_file(path):
    if os.name == 'nt':
        os.startfile(path)
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    else:
        subprocess.Popen(['xdg-open', path])


def show_in_folder(path):
    if os.name == 'nt':
        subprocess.Popen('explorer.exe /select,"%s"' % path)
    else:
        open_file(os.path.dirname(path))


def open_folder(path):
    if os.name == 'nt':
        subprocess.Popen('explorer.exe "%s"' % path)
    else:
        open_file(path)


def http_get(url, headers=None):
    # urllib берёт системный прокси Windows, а SSL-сертификаты — из хранилища Windows
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read()


def cbr_rates():
    err = []
    # 1) официальный сайт ЦБ РФ
    try:
        root = ET.fromstring(http_get('https://www.cbr.ru/scripts/XML_daily.asp'))  # windows-1251 из заголовка XML
        d = root.get('Date')
        res = {'date': '%s-%s-%s' % (d[6:10], d[3:5], d[0:2]), 'src': 'ЦБ РФ (cbr.ru)'}
        for v in root.findall('Valute'):
            code = v.findtext('CharCode')
            if code in CURRENCIES:
                res[code] = float(v.findtext('Value').replace(',', '.')) / float(v.findtext('Nominal').replace(',', '.'))
        return res
    except Exception as e:
        err.append(str(e))
    # 2) зеркало данных ЦБ
    try:
        j = json.loads(http_get('https://www.cbr-xml-daily.ru/daily_json.js').decode('utf-8-sig'))
        res = {'date': j['Date'][:10], 'src': 'ЦБ РФ (зеркало cbr-xml-daily.ru)'}
        for c in CURRENCIES:
            v = j.get('Valute', {}).get(c)
            if v:
                res[c] = float(v['Value']) / float(v['Nominal'])
        return res
    except Exception as e:
        err.append(str(e))
    return {'error': '; '.join(err)}


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
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def send_json(self, obj):
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        self.send(200, 'application/json; charset=utf-8', text)

    def not_found(self, text='not found'):
        self.send(404, 'text/plain; charset=utf-8', text)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n > 0 else b''

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
            self.route()
        except Exception as e:
            try:
                self.send(500, 'text/plain; charset=utf-8', str(e))
            except Exception:
                pass

    def route(self):
        m = 'GET' if self.command == 'HEAD' else self.command
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True, encoding='utf-8'))

        if path in ('/', '/index.html'):
            with open(app_html_path(), 'rb') as f:
                return self.send(200, 'text/html; charset=utf-8', f.read())
        if path == '/favicon.ico':
            icon = os.path.join(BUNDLE, 'app', 'icon.ico')
            if not os.path.isfile(icon):
                return self.not_found()
            with open(icon, 'rb') as f:
                return self.send(200, 'image/x-icon', f.read())
        # справочник типов оборудования
        if path == '/api/types':
            if m == 'PUT':
                save_user_types(self.body())
            return self.send_json(load_types())

        # контрагенты: поиск по ИНН, проверка Checko, справочник
        if path == '/api/party':
            return self.send_json(cp().lookup(q.get('inn', '')))
        if path == '/api/check':
            return self.send_json(cp().check(q.get('inn', ''), force=q.get('force') == '1'))
        if path == '/api/integrations':
            if m == 'PUT':
                return self.send_json(cp().save_keys(self.body()))
            return self.send_json(cp().keys_public())
        if path == '/api/clients' and m == 'GET':
            return self.send_json(cp().list_clients())
        r = re.match(r'^/api/clients/([^/]+)$', path)
        if r:
            if m == 'PUT':
                return self.send_json(cp().save_client(r.group(1), self.body()))
            if m == 'DELETE':
                cp().delete_client(r.group(1))
                return self.send_json({'ok': True})

        # шаблоны КП
        if path == '/api/templates':
            return self.send_json(list_templates())
        if path == '/api/templates/folder' and m == 'POST' and not self.is_local():
            return self.send_json({'remote': True, 'share': ''})
        if path == '/api/templates/folder' and m == 'POST':
            os.makedirs(TEMPLATES_DIR, exist_ok=True)
            open_folder(TEMPLATES_DIR)
            return self.send_json({'ok': True})
        r = re.match(r'^/tpl/([A-Za-z0-9_-]+)/([^/]+)$', path)
        if r:
            d = template_dirs().get(r.group(1))
            name = urllib.parse.unquote(r.group(2))
            f = os.path.join(d, name) if d and TPL_FILES.match(name) else None
            if not f or not os.path.isfile(f):
                return self.not_found('Файл шаблона не найден')
            ext = os.path.splitext(f)[1].lower()
            ctype = {'.json': 'application/json; charset=utf-8', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}.get(ext) or MIME.get(ext, 'application/octet-stream')
            with open(f, 'rb') as fh:
                return self.send(200, ctype, fh.read())

        if path == '/api/ping':
            return self.send_json({'ok': True, 'dataDir': DATA_DIR, 'docsDir': DOCS_DIR, 'local': self.is_local(),
                                   'mode': 'server' if SERVER_MODE else 'local', 'docsShare': DOCS_SHARE,
                                   'host': socket.gethostname(), 'port': self.server.server_address[1], 'items': store().catalog_count()})

        # каталог
        if path == '/api/catalog' and m == 'GET':
            # список — облегчённые карточки (без таблиц характеристик и галерей); полная позиция — по id
            return self.send_json(store().catalog_full() if q.get('full') == '1' else store().catalog_light())
        r = re.match(r'^/api/catalog/([^/]+)$', path)
        if r:
            cid = safe_id(r.group(1))
            if m == 'GET':
                doc = store().catalog_get(cid)
                return self.send_json(doc) if doc else self.not_found()
            if m == 'PUT':
                store().catalog_put(cid, self.body().decode('utf-8'))
                return self.send_json({'ok': True})
            if m == 'DELETE':
                store().catalog_delete(cid)
                return self.send_json({'ok': True})

        # изображения
        if path == '/api/img' and m == 'POST':
            ext = '.png' if q.get('ext') == 'png' else '.jpg'
            data = self.body()
            # имя по содержимому: одинаковые изображения (логотипы, фото контроллеров) хранятся один раз
            name = hashlib.md5(data).hexdigest() + ext
            path_img = os.path.join(IMG_DIR, name)
            if not os.path.isfile(path_img):
                write_bytes(path_img, data)
            return self.send_json({'name': name})
        r = re.match(r'^/img/([A-Za-z0-9]+\.(jpg|jpeg|png|webp))$', path)
        if r:
            f = os.path.join(IMG_DIR, r.group(1))
            if not os.path.isfile(f):
                return self.not_found()
            with open(f, 'rb') as fh:
                return self.send(200, MIME[os.path.splitext(f)[1].lower()], fh.read())

        # журнал КП
        if path == '/api/history':
            return self.send_json(store().kp_list())
        if path == '/api/kp/new' and m == 'POST':
            n = store().next_number()
            return self.send_json({'id': n, 'number': n})
        r = re.match(r'^/api/kp/([^/]+)/(state|meta)$', path)
        if r:
            kid = safe_id(r.group(1))
            if m == 'PUT':
                store().kp_set(kid, r.group(2), self.body().decode('utf-8'))
                return self.send_json({'ok': True})
            if m == 'GET':
                v = store().kp_get(kid, r.group(2))
                return self.send_json(v) if v else self.not_found()
        r = re.match(r'^/api/kp/([^/]+)/docx$', path)
        if r and m == 'PUT':
            kid = safe_id(r.group(1))
            name = safe_file(q.get('name'))
            sub = safe_dir(q.get('dir'))            # папка менеджера (фамилия)
            rel = (sub + '/' + name) if sub else name
            f = docs_path(rel)
            os.makedirs(os.path.dirname(f), exist_ok=True)
            write_bytes(f, self.body())
            # при пересохранении КП под новым именем старый файл убираем, чтобы не копились дубли
            prev = store().kp_get(kid, 'docx')
            if prev:
                old = docs_path(prev.strip())
                if os.path.isfile(old) and os.path.normcase(old) != os.path.normcase(f):
                    try:
                        os.remove(old)
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
        r = re.match(r'^/api/kp/([^/]+)$', path)
        if r and m == 'DELETE':
            store().kp_delete(safe_id(r.group(1)))
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
            return self.send_json(cbr_rates())
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
        seed_catalog()
        sync_counter_with_files()
    except Exception as e:
        message_box('Не удалось подготовить папки данных:\n%s\n\n%s' % (DATA_DIR, e))
        return 1
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
