# -*- coding: utf-8 -*-
"""Конструктор КП ПНЕВМОТЕХ — локальный сервер (Python, собирается в один EXE через PyInstaller).

Перенос server.ps1 один в один: тот же порт, те же адреса API, те же папки данных.
Интерфейс (app.html), шрифт и стартовый каталог с фотографиями встроены в EXE —
ни Python, ни PowerShell, ни интернет для работы не нужны.
"""
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
import uuid
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
def resolve_dirs():
    data_dir = os.path.join(ROOT, 'data')
    docs_dir = os.path.join(ROOT, 'Коммерческие предложения')
    settings = os.path.join(ROOT, 'settings.json')
    if os.path.exists(settings):
        try:
            st = json.loads(read_text(settings))
            if st.get('dataDir'):
                data_dir = os.path.join(st['dataDir'], 'data')
                docs_dir = os.path.join(st['dataDir'], 'Коммерческие предложения')
        except Exception:
            pass
    else:
        try:
            write_text(settings, '{\n  "dataDir": ""\n}\n')
        except Exception:
            pass
    return data_dir, docs_dir


DATA_DIR, DOCS_DIR = resolve_dirs()
CAT_DIR = os.path.join(DATA_DIR, 'catalog')
IMG_DIR = os.path.join(DATA_DIR, 'img')
KP_DIR = os.path.join(DATA_DIR, 'kp')


def prepare_dirs():
    fresh = not os.path.isdir(CAT_DIR) or not any(n.endswith('.json') for n in os.listdir(CAT_DIR))
    for d in (DATA_DIR, CAT_DIR, IMG_DIR, KP_DIR, DOCS_DIR):
        os.makedirs(d, exist_ok=True)
    # первый запуск на новом компьютере: раскладываем встроенный в EXE каталог с фотографиями
    seed = os.path.join(BUNDLE, 'seed', 'data')
    if fresh and os.path.isdir(seed):
        for sub, dst in (('catalog', CAT_DIR), ('img', IMG_DIR)):
            src = os.path.join(seed, sub)
            if not os.path.isdir(src):
                continue
            for name in os.listdir(src):
                target = os.path.join(dst, name)
                if not os.path.exists(target):
                    shutil.copyfile(os.path.join(src, name), target)


TYPES_USER = os.path.join(DATA_DIR, 'types.json')


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
    user = []
    if os.path.isfile(TYPES_USER):
        try:
            user = json.loads(read_text(TYPES_USER)).get('types', [])
        except Exception:
            user = []
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
    write_text(TYPES_USER, json.dumps({'version': 1, 'types': types}, ensure_ascii=False, indent=2))


def app_html_path():
    return os.path.join(BUNDLE, 'app', 'app.html')


def safe_id(s):
    if not SAFE_ID.match(s or ''):
        raise ValueError('Недопустимый идентификатор: %s' % s)
    return s


def safe_file(s):
    s = re.sub(r'[\\/:*?"<>|]', '', s or '').strip()
    return s or 'КП.docx'


def join_json_files(paths):
    parts = []
    for p in sorted(paths):
        try:
            parts.append(read_text(p))
        except OSError:
            pass
    return '[' + ','.join(parts) + ']'


def catalog_files():
    return [os.path.join(CAT_DIR, n) for n in os.listdir(CAT_DIR) if n.lower().endswith('.json')]


def meta_files():
    out = []
    for n in os.listdir(KP_DIR):
        p = os.path.join(KP_DIR, n, 'meta.json')
        if os.path.isfile(p):
            out.append(p)
    return out


_number_lock = threading.Lock()


def next_number():
    with _number_lock:
        year = datetime.now().year
        cnt = os.path.join(DATA_DIR, 'counter-%d.txt' % year)
        n = 0
        if os.path.exists(cnt):
            try:
                n = int(read_text(cnt).strip() or 0)
            except ValueError:
                n = 0
        while True:
            n += 1
            num = '%d-%03d' % (year, n)
            if not os.path.exists(os.path.join(KP_DIR, num)):
                break
        write_text(cnt, str(n))
        os.makedirs(os.path.join(KP_DIR, num))
        return num


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
    def send(self, code, ctype, body):
        data = body if isinstance(body, bytes) else str(body).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
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

        if path == '/api/ping':
            return self.send_json({'ok': True, 'dataDir': DATA_DIR, 'docsDir': DOCS_DIR})

        # каталог
        if path == '/api/catalog' and m == 'GET':
            return self.send_json(join_json_files(catalog_files()))
        r = re.match(r'^/api/catalog/([^/]+)$', path)
        if r:
            f = os.path.join(CAT_DIR, safe_id(r.group(1)) + '.json')
            if m == 'PUT':
                write_text(f, self.body().decode('utf-8'))
                return self.send_json({'ok': True})
            if m == 'DELETE':
                if os.path.exists(f):
                    os.remove(f)
                return self.send_json({'ok': True})

        # изображения
        if path == '/api/img' and m == 'POST':
            ext = '.png' if q.get('ext') == 'png' else '.jpg'
            name = uuid.uuid4().hex + ext
            write_bytes(os.path.join(IMG_DIR, name), self.body())
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
            return self.send_json(join_json_files(meta_files()))
        if path == '/api/kp/new' and m == 'POST':
            n = next_number()
            return self.send_json({'id': n, 'number': n})
        r = re.match(r'^/api/kp/([^/]+)/(state|meta)$', path)
        if r:
            d = os.path.join(KP_DIR, safe_id(r.group(1)))
            f = os.path.join(d, r.group(2) + '.json')
            if m == 'PUT':
                os.makedirs(d, exist_ok=True)
                write_text(f, self.body().decode('utf-8'))
                return self.send_json({'ok': True})
            if m == 'GET':
                if not os.path.isfile(f):
                    return self.not_found()
                return self.send_json(read_text(f))
        r = re.match(r'^/api/kp/([^/]+)/docx$', path)
        if r and m == 'PUT':
            kid = safe_id(r.group(1))
            name = safe_file(q.get('name'))
            f = os.path.join(DOCS_DIR, name)
            write_bytes(f, self.body())
            os.makedirs(os.path.join(KP_DIR, kid), exist_ok=True)
            write_text(os.path.join(KP_DIR, kid, 'docx.txt'), name)
            return self.send_json({'ok': True, 'path': f})
        r = re.match(r'^/api/kp/([^/]+)$', path)
        if r and m == 'DELETE':
            d = os.path.join(KP_DIR, safe_id(r.group(1)))
            if os.path.isdir(d):
                shutil.rmtree(d)
            return self.send_json({'ok': True})
        r = re.match(r'^/api/kp/([^/]+)/(open|folder)$', path)
        if r and m == 'POST':
            ref = os.path.join(KP_DIR, safe_id(r.group(1)), 'docx.txt')
            if not os.path.isfile(ref):
                return self.not_found('Файл КП не найден')
            f = os.path.join(DOCS_DIR, read_text(ref).strip())
            if not os.path.isfile(f):
                return self.not_found('Файл КП был перемещён или удалён')
            if r.group(2) == 'open':
                open_file(f)
            else:
                show_in_folder(f)
            return self.send_json({'ok': True})
        if path == '/api/folder' and m == 'POST':
            open_folder(DOCS_DIR)
            return self.send_json({'ok': True})
        if path == '/api/cbr':
            return self.send_json(cbr_rates())
        if path == '/api/shutdown' and m == 'POST':
            self.send_json({'ok': True})
            target = getattr(self.server, 'main_server', self.server)
            threading.Thread(target=target.shutdown, daemon=True).start()
            return

        self.not_found()


def fix_old_names():
    """Исправление имён КП, сохранённых старой версией с испорченной кодировкой (как в server.ps1)."""
    try:
        for n in os.listdir(KP_DIR):
            ref = os.path.join(KP_DIR, n, 'docx.txt')
            if not os.path.isfile(ref):
                continue
            old = read_text(ref).strip()
            if not re.search('Р[љџ]Р', old):
                continue
            try:
                new = safe_file(old.encode('cp1251').decode('utf-8'))
            except UnicodeError:
                continue
            src, dst = os.path.join(DOCS_DIR, old), os.path.join(DOCS_DIR, new)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.move(src, dst)
            if os.path.exists(dst):
                write_text(ref, new)
    except Exception:
        pass


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
    for port in range(BASE_PORT, BASE_PORT + 40):
        try:
            return Server(('127.0.0.1', port), Handler), port
        except OSError:
            continue
    return None, None


def main():
    # один экземпляр: если программа уже работает — просто открываем её
    if already_running():
        webbrowser.open('http://localhost:%d/' % BASE_PORT)
        return 0
    try:
        prepare_dirs()
    except Exception as e:
        message_box('Не удалось подготовить папки данных:\n%s\n\n%s' % (DATA_DIR, e))
        return 1
    fix_old_names()
    httpd, port = start_server()
    if not httpd:
        message_box('Не удалось запустить сервер: все порты заняты.')
        return 1
    start_ipv6(port, httpd)
    # адрес localhost (а не 127.0.0.1) — чтобы браузер видел черновики, сохранённые прежней версией
    url = 'http://localhost:%d/' % port
    opener = threading.Timer(0.3, lambda: webbrowser.open(url))
    opener.daemon = True
    opener.start()
    try:
        print('%s запущен: %s\nДанные: %s\nГотовые КП: %s' % (APP_TITLE, url, DATA_DIR, DOCS_DIR), flush=True)
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
