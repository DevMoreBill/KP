# -*- coding: utf-8 -*-
"""Общее для проверок программы: пути, вымышленные данные, стенд сервера, запросы к нему, приёмник писем.

Проверки не трогают рабочую базу и папки программы. Стенд (Stand) — копия кода программы во временной папке с базой,
которую SampleData заполняет вымышленными данными: каталог, клиенты, менеджеры, КП. После проверки папка удаляется.
"""
import email
import email.header
import http.client
import io
import json
import os
import random
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(REPO, 'app')
if APP not in sys.path:
    sys.path.insert(0, APP)


class Net:
    """Адреса и порты для стендов."""
    LOCAL = '127.0.0.1'

    @staticmethod
    def free_port():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((Net.LOCAL, 0))
            return s.getsockname()[1]

    @staticmethod
    def remote_ip():
        """Свой адрес не 127.x — запрос с него сервер считает запросом сотрудника по сети. '' — такого адреса нет."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(('192.0.2.1', 9))           # пакеты не отправляются: только выбор адреса для маршрута
                ip = s.getsockname()[0]
        except OSError:
            return ''
        return '' if ip.startswith('127.') or ip == '0.0.0.0' else ip


class Http:
    """Запросы к серверу: (код, тело, заголовки). host — откуда «приходит» запрос: 127.0.0.1 — с компьютера-сервера,
    Net.remote_ip() — как от сотрудника по сети."""
    def __init__(self, port, host=Net.LOCAL):
        self.port, self.host = port, host

    def req(self, method, path, body=None, host=None, headers=None, cookie=None, raw=False, timeout=60):
        host = host or self.host
        c = http.client.HTTPConnection(host, self.port, timeout=timeout)
        h = {'Host': '%s:%d' % (host, self.port)}
        if cookie:
            h['Cookie'] = cookie
        if body is not None and not isinstance(body, (bytes, str)):
            body = json.dumps(body, ensure_ascii=False)
            h['Content-Type'] = 'application/json'
        h.update(headers or {})
        try:
            c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            for k, v in h.items():
                c.putheader(k, v)
            data = body.encode('utf-8') if isinstance(body, str) else body
            if data is not None and 'Content-Length' not in h:
                c.putheader('Content-Length', str(len(data)))
            c.endheaders(data)
            r = c.getresponse()
            out = r.read()
            return r.status, (out if raw else out.decode('utf-8', 'replace')), dict(r.getheaders())
        finally:
            c.close()

    @staticmethod
    def js(b):
        try:
            return json.loads(b)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def cookie(headers):
        return (headers.get('Set-Cookie') or '').split(';')[0]


class SmtpSink:
    """Почтовый сервер для проверок: принимает письма (EHLO, MAIL, RCPT, DATA, QUIT) и хранит их в памяти."""
    def __init__(self):
        self.messages = []
        sink = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                def w(s):
                    self.wfile.write((s + '\r\n').encode())
                w('220 sink ESMTP')
                frm, rcpt = None, []
                while True:
                    line = self.rfile.readline()
                    if not line:
                        return
                    cmd = line.decode('latin-1').strip()
                    up = cmd.upper()
                    if up.startswith(('EHLO', 'HELO')):
                        w('250-sink')
                        w('250 SIZE 52428800')
                    elif up.startswith('MAIL FROM'):
                        frm = cmd[10:].strip()
                        w('250 ok')
                    elif up.startswith('RCPT TO'):
                        rcpt.append(cmd[8:].strip().strip('<>'))
                        w('250 ok')
                    elif up == 'DATA':
                        w('354 go')
                        data = []
                        while True:
                            x = self.rfile.readline()
                            if x in (b'.\r\n', b'.\n', b''):
                                break
                            data.append(x[1:] if x.startswith(b'..') else x)
                        sink.messages.append({'from': frm, 'rcpt': rcpt, 'data': b''.join(data)})
                        rcpt = []
                        w('250 queued')
                    elif up == 'QUIT':
                        w('221 bye')
                        return
                    else:
                        w('250 ok')

        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

        self.srv = Server((Net.LOCAL, 0), Handler)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()

    def mail_settings(self, **kw):
        """Настройки почты программы (kv mail) для отправки сюда."""
        return dict({'host': Net.LOCAL, 'port': self.port, 'security': 'none', 'fromEmail': 'kp@example.com', 'fromName': 'Конструктор КП'}, **kw)

    def message(self, i=-1):
        """Письмо i: (тема, текст первой части, имена вложений, получатели, само письмо)."""
        m = self.messages[i]
        msg = email.message_from_bytes(m['data'])
        subject = str(email.header.make_header(email.header.decode_header(msg.get('Subject', ''))))
        part = next((p for p in msg.walk() if p.get_content_type() == 'text/plain'), msg)
        text = (part.get_payload(decode=True) or b'').decode(part.get_content_charset() or 'utf-8', 'replace')
        files = [p.get_filename() for p in msg.walk() if p.get_filename()]
        return subject, text, files, m['rcpt'], msg


class Quiet:
    """Ошибки, которые программа печатает в консоль (журнал сервера повторяет их там), — не в вывод проверок: проверка
    этих ошибок и ждёт."""
    @staticmethod
    def stderr(test):
        saved = sys.stderr, sys.__stderr__
        sys.stderr = sys.__stderr__ = io.StringIO()
        test.addCleanup(Quiet._restore, saved)

    @staticmethod
    def _restore(saved):
        sys.stderr, sys.__stderr__ = saved


class FakeConfig:
    """Заменитель модуля config для проверок отдельных классов (admin_overview, admin_alerts)."""
    @staticmethod
    def make(folder, **kw):
        base = dict(SERVER_MODE=False, DATA_DIR=folder, ROOT=folder, BASE_PORT=17845, FROZEN=False, DOCS_DIR=folder,
                    DOCS_SHARE='', ALLOWED_HOSTS=[], STARTED=0)
        base.update(kw)
        return types.SimpleNamespace(**base)


class TempStore:
    """База программы во временной папке (миграции применяются при создании)."""
    def __init__(self, test=None):
        import storage
        self.dir = tempfile.mkdtemp(prefix='kp-test-')
        self.store = storage.Store(os.path.join(self.dir, 'kp.sqlite3'))
        if test is not None:
            test.addCleanup(self.close)

    def close(self):
        try:
            self.store.conn().close()
        except Exception:
            pass
        shutil.rmtree(self.dir, ignore_errors=True)


class SampleData:
    """Вымышленные данные: менеджеры, каталог по категориям из equipment_types.json, клиенты с верными ИНН, КП менеджеров."""
    MANAGERS = (('mgr-ivanova', 'Иванова Анна Сергеевна', 'ivanova@example.com', '+7 900 000-00-01'),
                ('mgr-petrov', 'Петров Олег Игоревич', 'petrov@example.com', '+7 900 000-00-02'))
    MAKERS = ('ТестМаш', 'Пневмо-Тест', 'Компрессор-Пример', 'Air Sample')
    KINDS = (('comp_screw', 'Винтовой компрессор', 'ВК', {'flow': (0.5, 40, 'м³/мин'), 'pressure': (7, 13, 'бар'), 'kw': (4, 250, 'кВт')}),
             ('comp_piston', 'Поршневой компрессор', 'ПК', {'flow': (0.1, 3, 'м³/мин'), 'pressure': (8, 16, 'бар'), 'kw': (1, 30, 'кВт')}),
             ('dryer_refrig', 'Осушитель рефрижераторный', 'ОР', {'flow': (0.5, 60, 'м³/мин')}),
             ('receiver', 'Ресивер вертикальный', 'РВ', {'volume': (100, 10000, 'л'), 'pressure': (8, 16, 'бар')}),
             ('dgu', 'Дизель-генераторная установка', 'АД', {'kw': (10, 1000, 'кВт')}),
             ('filter', 'Магистральный фильтр', 'МФ', {'flow': (0.5, 60, 'м³/мин')}))
    CITIES = ('Москва', 'Казань', 'Екатеринбург', 'Новосибирск', 'Самара', 'Пермь')
    TEXT = ('Надёжная конструкция для непрерывной работы на производстве. Корпус с шумоизоляцией, доступ к узлам для '
            'обслуживания с одной стороны. Контроллер с журналом событий и удалённым контролем.')

    def __init__(self, seed=52, items=240, clients=40, kps=6):
        self.rnd = random.Random(seed)
        self.n_items, self.n_clients, self.n_kps = items, clients, kps
        self.items = self._catalog()
        self.clients = self._clients()

    @staticmethod
    def inn(rnd):
        """ИНН организации (10 цифр) с верной контрольной цифрой."""
        d = [rnd.randint(1, 9)] + [rnd.randint(0, 9) for _ in range(8)]
        k = sum(w * x for w, x in zip((2, 4, 10, 3, 5, 9, 4, 6, 8), d)) % 11 % 10
        return ''.join(map(str, d + [k]))

    def _catalog(self):
        out = []
        for i in range(self.n_items):
            cat, title, prefix, params = self.KINDS[i % len(self.KINDS)]
            maker = self.MAKERS[i % len(self.MAKERS)]
            model = '%s-%d%s' % (prefix, 10 + i, 'Т' if i % 3 == 0 else '')
            attrs = {'cat': cat, 'maker': maker, 'model': model}
            rows = []
            for key, (lo, hi, unit) in params.items():
                v = round(self.rnd.uniform(lo, hi), 1)
                attrs[key] = v
                rows.append({'k': key, 'v': '%s %s' % (str(v).replace('.', ','), unit)})
            price = self.rnd.randrange(50, 9000) * 1000
            out.append({'id': 'tst-%04d' % i, 'name': '%s %s %s' % (title, maker, model), 'price': price, 'priceCur': 'RUB',
                        'cost': int(price * 0.7), 'costCur': 'RUB', 'unit': 'шт', 'short': '%s %s' % (title, model),
                        'spec': self.TEXT, 'attrs': attrs, 'groups': [{'name': 'Основные', 'rows': rows}]})
        return out

    def _clients(self):
        out = []
        for i in range(self.n_clients):
            city = self.CITIES[i % len(self.CITIES)]
            out.append({'id': 'cl-%03d' % i, 'name': 'ООО «Пример %d»' % (i + 1), 'full': 'Общество с ограниченной ответственностью «Пример %d»' % (i + 1),
                        'inn': self.inn(self.rnd), 'address': 'г. %s, ул. Тестовая, д. %d' % (city, i + 1)})
        return out

    def kp_docs(self, kid, n, manager):
        """Состояние и описание КП менеджера: позиции из каталога, клиент из списка."""
        mid, name = manager[0], manager[1]
        cl = self.clients[n % len(self.clients)]
        items = [self.items[(n * 7 + j) % len(self.items)] for j in range(2)]
        rows = [{'name': x['name'], 'qty': 1 + j, 'price': x['price'], 'cost': x['cost']} for j, x in enumerate(items)]
        total = sum(r['qty'] * r['price'] for r in rows)
        state = {'number': kid, 'kpId': kid, 'client': cl['name'], 'clientInn': cl['inn'], 'authorId': mid, 'items': rows,
                 'manager': {'name': name, 'email': manager[2]}, 'deal': {'margin': 30}}
        meta = {'id': kid, 'number': kid, 'client': cl['name'], 'clientInn': cl['inn'], 'authorId': mid, 'manager': name,
                'date': time.strftime('%Y-%m-%d'), 'sum': total, 'cur': 'RUB', 'items': [r['name'] for r in rows]}
        return state, meta

    def fill(self, store):
        """Записать данные в базу (до запуска сервера стенда)."""
        for mid, name, mail, phone in self.MANAGERS:
            store.manager_put(mid, json.dumps({'name': name, 'email': mail, 'mobile': phone, 'position': 'Менеджер'}, ensure_ascii=False), 'стенд')
        for x in self.items:
            store.catalog_put(x['id'], json.dumps(x, ensure_ascii=False), 'стенд')
        for c in self.clients:
            store.client_put(c['id'], c, 'стенд')
        self.kp_ids = {m[0]: [] for m in self.MANAGERS}
        for n in range(self.n_kps):
            mgr = self.MANAGERS[n % len(self.MANAGERS)]
            kid = store.next_number()
            state, meta = self.kp_docs(kid, n, mgr)
            store.kp_set(kid, 'state', json.dumps(state, ensure_ascii=False), mgr[1])
            store.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), mgr[1])
            self.kp_ids[mgr[0]].append(kid)
        return self


class Stand:
    """Программа во временной папке: копия кода (app, templates), settings.json, база с вымышленными данными, сервер
    в отдельном процессе. Режим server — как сервер отдела (слушает сеть), local — программа на одном компьютере.
    offline — без выхода в интернет: запросы сервера к внешним сервисам (GitHub, ЦБ, карты, проверка контрагентов) идут
    через несуществующий прокси и сразу получают отказ — проверки не зависят от сети и не тратят чужие лимиты."""
    ADMIN = ('admin', 'Stand-Pass-52')
    ENV_DROP = ('KP_UPDATE_DIR', 'KP_BASE_VERSION', 'KP_UPDATE_VERSION', 'KP_UPDATE_FALLBACK')
    DEAD_PROXY = 'http://127.0.0.1:9'

    def __init__(self, mode='server', sample=None, offline=True):
        self.offline = offline
        self.dir = tempfile.mkdtemp(prefix='kp-stand-')
        self.app = os.path.join(self.dir, 'app')
        os.makedirs(self.app)
        for f in os.listdir(APP):
            if f.endswith('.py') or f in ('equipment_types.json', 'icon.ico'):
                shutil.copy(os.path.join(APP, f), self.app)
        shutil.copytree(os.path.join(APP, 'web'), os.path.join(self.app, 'web'))
        shutil.copytree(os.path.join(REPO, 'templates'), os.path.join(self.dir, 'templates'))
        self.port = Net.free_port()
        self.mode = mode
        with open(os.path.join(self.app, 'settings.json'), 'w', encoding='utf-8') as f:
            json.dump({'mode': mode, 'port': self.port}, f)
        self.data = os.path.join(self.app, 'data')
        self.db = os.path.join(self.data, 'kp.sqlite3')
        self.http = Http(self.port)
        self.proc = None
        self.out = os.path.join(self.dir, 'server-output.txt')
        self.sample = sample
        if sample is not None:
            import storage
            st = storage.Store(self.db)
            sample.fill(st)
            st.conn().close()
        self._admin = None

    def kv_set(self, key, value):
        """Настройка в базе стенда до запуска сервера (почта, письма о проблемах)."""
        import storage
        st = storage.Store(self.db)
        st.kv_set(key, value)
        st.conn().close()

    # ---------- процесс сервера
    def start(self, timeout=90):
        env = dict(os.environ, BROWSER='true', KP_NO_BROWSER='1', PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1')
        for k in self.ENV_DROP:
            env.pop(k, None)
        if self.offline:
            for k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
                env[k] = self.DEAD_PROXY
            env['NO_PROXY'] = env['no_proxy'] = '127.0.0.1,localhost'
        with open(self.out, 'ab') as out:
            self.proc = subprocess.Popen([sys.executable, os.path.join(self.app, 'kp_server.py')], cwd=self.dir, env=env,
                                         stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        t = time.time()
        while time.time() - t < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError('Сервер стенда завершился при запуске (код %s):\n%s' % (self.proc.returncode, self.output()[-3000:]))
            if self.up():
                return self
            time.sleep(0.3)
        raise RuntimeError('Сервер стенда не ответил за %d с:\n%s' % (timeout, self.output()[-3000:]))

    def up(self):
        try:
            return self.http.req('GET', '/api/ping', timeout=3)[0] == 200
        except OSError:
            return False

    def stop(self):
        if not self.proc or self.proc.poll() is not None:
            return
        try:
            self.http.req('POST', '/api/shutdown', {}, timeout=5)
        except OSError:
            pass
        try:
            self.proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=10)

    def restart(self):
        self.stop()
        return self.start()

    def close(self):
        self.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def output(self):
        try:
            with open(self.out, 'r', encoding='utf-8', errors='replace') as f:
                return f.read()
        except OSError:
            return ''

    # ---------- администратор и менеджеры
    def admin(self):
        """Вход администратора (первый раз — создание учётной записи на самом компьютере): (cookie, заголовки с CSRF)."""
        login, pw = self.ADMIN
        st, b, hd = self.http.req('POST', '/api/admin/login', {'login': login, 'password': pw})
        if st == 409:
            st, b, hd = self.http.req('POST', '/api/admin/setup', {'login': login, 'password': pw, 'name': 'Администратор стенда'})
        if st != 200:
            raise RuntimeError('Администратор стенда не вошёл: %s %s' % (st, b[:200]))
        self._admin = (Http.cookie(hd), {'X-CSRF-Token': json.loads(b)['csrf']})
        return self._admin

    @staticmethod
    def as_manager(manager):
        """Заголовки запроса от менеджера, выбранного в программе (без входа по паролю)."""
        return {'X-KP-User-Id': manager[0], 'X-KP-User': urllib.parse.quote(manager[1])}

    # ---------- журнал сервера
    def log_records(self):
        from server_log import ServerLog
        return ServerLog(os.path.join(self.data, 'logs')).records()

    def request_errors(self):
        """Ошибки обработки запросов в журнале сервера (ответ 500)."""
        return [r for r in self.log_records() if r['level'] == 'ОШИБКА' and r['text'].split(' ', 1)[0] in ('GET', 'PUT', 'POST', 'DELETE', 'HEAD', 'OPTIONS')]
