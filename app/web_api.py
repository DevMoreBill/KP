# -*- coding: utf-8 -*-
"""Маршруты HTTP-API программы: контроллеры по разделам и маршрутизатор.

Каждый раздел — класс-наследник Controller, обработчики помечены декоратором @route(шаблон пути, методы).
Router проходит маршруты в порядке объявления: первый подходящий по пути и методу обрабатывает запрос;
обработчик может вернуть PASS — «не мой случай», тогда поиск продолжается (как раньше цепочка if в kp_server.route).
Ничего не подошло — 404. Права, модерация и журнал действий проверяются до маршрутизации (admin.guard),
транспорт (ответы, файлы, кэш, защита от чужих сайтов) — в kp_server.Handler.
"""
import hashlib
import json
import os
import re
import socket
import threading
import urllib.parse
from datetime import date, datetime, timedelta

from cbr import cbr_key_rate, cbr_rates
from config import (APP_DIR, BadRequest, UPDATE_DIR, DATA_DIR, DOCS_DIR, DOCS_SHARE, IMG_DIR, MIME, ROOT, SERVER_MODE,
                    docs_path, read_text, safe_dir, safe_file, safe_id, store, write_bytes)
from desktop import DesktopError, open_file, open_folder, show_in_folder
from equipment_types import load_types, save_user_types, types_builtin_path
import admin
from storage import Conflict, with_rev
import pdf_convert
import images
import logistics_api
import ai_llm
import pdf_text
import defaults
import kp_track
from images import ImageStore
from kp_templates import (TEMPLATES_DIR, TemplateError, copy_template, delete_template, list_history, list_templates,
                          open_template_file, put_file, reset_template, restore_history, template_file)

# ---------------------------------------------------------------- общие ресурсы сервера
_CP = None
_LOGOS = {}          # логотипы производителей: {rev — версия каталога, text — готовый ответ}


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

# политика безопасности страницы: скрипты — только файлы программы (внедрённый в данные скрипт не выполнится);
# unsafe-eval — скелет шаблона КП (skeleton.js) собирается из текста; картинки — свои, data:, blob: и с сайтов поставщиков
CSP = ("default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; "
       "font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")

# хранилище изображений data/img (по папкам категорий)
IMAGES = ImageStore(IMG_DIR)


def web_file(rel):
    """Файл интерфейса по относительному пути внутри app/web (без выхода за пределы папки)."""
    parts = [x for x in rel.replace('\\', '/').split('/') if x and x not in ('.', '..')]
    f = os.path.join(WEB_DIR, *parts)
    if not os.path.normcase(os.path.abspath(f)).startswith(os.path.normcase(os.path.abspath(WEB_DIR))):
        return None
    return f if os.path.isfile(f) and os.path.splitext(f)[1].lower() in WEB_TYPES else None


WIN_RESERVED = {'CON', 'PRN', 'AUX', 'NUL'} | {'COM%d' % i for i in range(1, 10)} | {'LPT%d' % i for i in range(1, 10)}


def pdf_of(docx):
    """PDF рядом с .docx КП, с тем же именем."""
    return os.path.splitext(docx)[0] + '.pdf'


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


# ---------------------------------------------------------------- маршрутизация
PASS = object()      # обработчик: «не мой случай» — ищем следующий маршрут


_ROUTES = []         # (регулярное выражение, методы или None, класс, имя метода) — в порядке объявления


def route(pattern, methods=None):
    """Пометить метод контроллера обработчиком: pattern — регулярное выражение всего пути (без ^ и $),
    methods — 'GET' | ('GET', 'PUT') | None (любой метод; HEAD считается GET)."""
    ms = None if methods is None else ((methods,) if isinstance(methods, str) else tuple(methods))

    def mark(fn):
        fn._route = (re.compile('^(?:%s)$' % pattern), ms)
        return fn
    return mark


class ControllerMeta(type):
    """Маршруты класса регистрируются при его объявлении — в порядке методов в теле класса."""
    def __init__(cls, name, bases, ns):
        super().__init__(name, bases, ns)
        for attr, fn in ns.items():
            if callable(fn) and hasattr(fn, '_route'):
                rx, ms = fn._route
                _ROUTES.append((rx, ms, cls, attr))


class Controller(metaclass=ControllerMeta):
    """Раздел API. Отвечает через обработчик запроса (self.h): send, send_json, send_file, not_found, body…
    — обращения к ним передаются обработчику, поэтому код маршрутов пишется как в самом обработчике."""

    def __init__(self, h, m, path, q):
        self.h, self.m, self.p, self.q = h, m, path, q

    def __getattr__(self, name):          # self.send_json(...) → h.send_json(...); self.server, self.path, self.headers
        return getattr(self.h, name)

    def json_body(self):
        """Тело запроса — объект JSON; иначе BadRequest (400)."""
        try:
            d = json.loads(self.body().decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            raise BadRequest('Неверный запрос: нужен JSON')
        if not isinstance(d, dict):
            raise BadRequest('Неверный запрос: нужен объект JSON')
        return d

    def text(self, code, msg):
        return self.send(code, 'text/plain; charset=utf-8', msg)


class Router:
    """Находит контроллер и метод по пути и методу запроса."""

    def __init__(self, routes=None):
        self.routes = routes if routes is not None else _ROUTES

    def dispatch(self, h):
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
            try:
                res = getattr(c, attr)(*mt.groups())
            except BadRequest as e:
                return h.send(400, 'text/plain; charset=utf-8', str(e))
            except DesktopError as e:
                return h.send(422, 'text/plain; charset=utf-8', str(e))
            except (UnicodeDecodeError, json.JSONDecodeError):      # тело запроса — не текст UTF-8 или не JSON
                return h.send(400, 'text/plain; charset=utf-8', 'Неверный запрос: нужен JSON в кодировке UTF-8')
            if res is not PASS:
                return res
        return h.not_found()


# ---------------------------------------------------------------- интерфейс и файлы
class StaticController(Controller):
    @route(r'/|/index\.html|/web/.*')
    def web(self):
        f = web_file('index.html' if self.p in ('/', '/index.html') else self.p[len('/web/'):])
        if not f:
            return self.not_found()
        return self.send_file(f, WEB_TYPES[os.path.splitext(f)[1].lower()], 'no-cache', CSP if f.endswith('index.html') else None)

    @route(r'/favicon\.ico')
    def favicon(self):
        icon = os.path.join(APP_DIR, 'icon.ico')
        if not os.path.isfile(icon):
            return self.not_found()
        with open(icon, 'rb') as f:
            return self.send(200, 'image/x-icon', f.read())


# ---------------------------------------------------------------- справочник типов оборудования
class TypesController(Controller):
    @route(r'/api/types')
    def types(self):
        if self.q.get('builtin') == '1':
            return self.send_json(read_text(types_builtin_path()))
        if self.m == 'PUT':
            self.json_body()
            try:
                save_user_types(self.body())
            except ValueError as e:
                raise BadRequest(str(e))
            return self.send_json(load_types())
        text = json.dumps(load_types(), ensure_ascii=False)
        return self.send_cached('types-' + hashlib.md5(text.encode('utf-8')).hexdigest()[:16], lambda: text)


# ---------------------------------------------------------------- адреса и расстояния для доставки по России (geo.py)
class GeoController(Controller):
    @route(r'/api/geo/(.*)', 'GET')
    def geo(self, act):
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
                return self.send_json(geo.route(store(), a, b))
            if act == 'unshort':
                return self.send_json({'url': geo.unshort(q.get('u', ''))})
        except Exception as e:
            return self.send_json({'error': str(e)[:300] or e.__class__.__name__})
        return self.text(404, 'Нет такого запроса')


# ---------------------------------------------------------------- контрагенты: ИНН, проверка Checko, ключи интеграций, справочник
class PartiesController(Controller):
    @route(r'/api/party')
    def party(self):
        return self.send_json(cp().lookup(self.q.get('inn', '')))

    @route(r'/api/check/quota')        # сколько проверок Checko осталось сегодня (на весь отдел) и сколько в очереди
    def quota(self):
        return self.send_json(cp().quota())

    @route(r'/api/check')
    def check(self):
        return self.send_json(cp().check(self.q.get('inn', ''), force=self.q.get('force') == '1', by=admin.actor(self.h)[1]))

    @route(r'/api/integrations/export', 'GET')      # резервная копия ключей (только администратор — см. admin.guard)
    def keys_export(self):
        return self.send_json({'kind': 'kp-keys', 'v': 1, 'at': datetime.now().isoformat(timespec='seconds'), 'keys': cp().keys()})

    @route(r'/api/integrations')
    def keys(self):
        if self.m == 'PUT':
            self.json_body()
            return self.send_json(cp().save_keys(self.body()))
        return self.send_json(cp().keys_public())

    @route(r'/api/clients', 'GET')
    def clients(self):
        # справочник не грузится целиком: последние использованные или найденные по названию / ИНН / адресу
        q = self.q
        try:
            limit, offset = max(1, min(int(q.get('limit') or 50), 500)), max(0, min(int(q.get('offset') or 0), 10 ** 9))
        except ValueError:
            limit, offset = 50, 0
        res = store().clients_search(q.get('q', ''), limit, offset)
        res['all'] = store().clients_count() if not q.get('q') else None
        return self.send_json(res)

    @route(r'/api/clients/([^/]+)', ('GET', 'PUT'))
    def client(self, cid):
        cid = safe_id(cid)
        if self.m == 'GET':
            c = store().client_get(cid, rev=True)
            return self.send_json(c) if c else self.text(404, 'Клиент не найден')
        self.json_body()            # не объект JSON — 400
        try:
            return self.send_json(cp().save_client(cid, self.body(), admin.actor(self.h)[1], self.base_rev()))
        except Conflict as e:
            return self.conflict(e)


# ---------------------------------------------------------------- шаблоны КП (папка templates): список, файлы, редактор шаблона
class TemplatesController(Controller):
    @route(r'/api/templates')
    def templates(self):
        return self.send_json(list_templates())

    @route(r'/api/templates/folder', 'POST')
    def folder(self):
        if not self.is_local():
            return self.send_json({'remote': True, 'share': ''})
        os.makedirs(TEMPLATES_DIR, exist_ok=True)
        open_folder(TEMPLATES_DIR)
        return self.send_json({'ok': True})

    @route(r'/api/templates/([A-Za-z0-9_-]+)/([a-z]+)')
    def action(self, tid, action):
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
    def file(self, tid, name):
        f = template_file(tid, urllib.parse.unquote(name))
        if not f:
            return self.not_found('Файл шаблона не найден')
        ext = os.path.splitext(f)[1].lower()
        ctype = {'.json': 'application/json; charset=utf-8', '.js': 'text/plain; charset=utf-8',
                 '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}.get(ext) or MIME.get(ext, 'application/octet-stream')
        extra = {'Content-Disposition': 'attachment; filename="%s"' % os.path.basename(f)} if self.q.get('download') == '1' else None
        with open(f, 'rb') as fh:
            return self.send(200, ctype, fh.read(), extra)


# ---------------------------------------------------------------- состояние программы
class SystemController(Controller):
    @route(r'/api/ping')
    def ping(self):
        base = {'ok': True, 'local': self.is_local(), 'mode': 'server' if SERVER_MODE else 'local', 'host': socket.gethostname()}
        if getattr(self.h, '_kp_login', False) and not self.h._kp_user and admin.session(self.h, touch=False) is None:
            return self.send_json(base)        # до входа — без папок, путей и состава базы
        return self.send_json({'ok': True, 'dataDir': DATA_DIR, 'docsDir': DOCS_DIR, 'local': self.is_local(),
                               'mode': 'server' if SERVER_MODE else 'local', 'docsShare': DOCS_SHARE,
                               'host': socket.gethostname(), 'port': self.server.server_address[1], 'items': store().catalog_count(),
                               'migrations': (store().kv_get('migrations') or [])[-2:]})


# ---------------------------------------------------------------- каталог и изображения
class CatalogController(Controller):
    @route(r'/api/catalog', 'GET')
    def catalog(self):
        # список — облегчённые карточки (без таблиц характеристик и галерей); полная позиция — по id
        full = self.q.get('full') == '1'
        return self.send_cached('cat%s-%s' % ('f' if full else 'l', store().data_rev('catalog')),
                                lambda: store().catalog_full() if full else store().catalog_light())

    @route(r'/api/catalog/sources', 'GET')   # фиды-источники позиций: id → поставщик (из справочника, если фид к нему привязан)
    def sources(self):
        sups = {x.get('id'): x.get('name') for x in store().suppliers_list()}
        return self.send_json({f['id']: {'name': sups.get(f.get('supplier')) or f.get('name') or f['id'], 'feed': f.get('name') or f['id']}
                               for f in (store().kv_get('feeds') or {}).get('items', []) if f.get('id')})

    @route(r'/api/catalog/pending')   # режим модерации и товары с правками на модерации (бейдж «На модерации»)
    def pending(self):
        return self.send_json({'moderation': bool(admin.moderation(store()).get('enabled')), 'ids': store().pending_ids()})

    @route(r'/api/catalog/([^/]+)', 'GET')     # запись позиции — PUT в admin.guard (модерация, права)
    def item(self, cid):
        doc = store().catalog_get(safe_id(cid), rev=True)
        return self.send_json(doc) if doc else self.not_found()

    # изображения: папки «раздел/категория/производитель» латиницей (app/images.py); одинаковые хранятся один раз
    @route(r'/api/img', 'POST')
    def img_put(self):
        data, q = self.body(), self.q
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            ext = '.png'
        elif data[:3] == b'\xff\xd8\xff':
            ext = '.jpg'
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            ext = '.webp'
        else:
            return self.text(400, 'Нужна картинка JPEG, PNG или WebP')
        tmap = {t.get('id'): t for t in load_types()['types']}
        folder, title = images.place(tmap.get(q.get('cat')), q.get('maker'), q.get('model'), q.get('name'), q.get('kind') or 'photo', q.get('caption'))
        rel = IMAGES.put(data, ext, folder, title)
        return self.send_json({'name': rel})

    @route(r'/img/(.+)')
    def img(self, rel):
        f = IMAGES.path(rel)
        if not f:
            return self.not_found()
        return self.send_file(f, MIME[os.path.splitext(f)[1].lower()], 'private, max-age=604800')


# ---------------------------------------------------------------- менеджеры (контакты в КП)
class ManagersController(Controller):
    @route(r'/api/managers', 'GET')
    def managers(self):
        return self.send_cached('mgr-' + store().data_rev('managers'), lambda: store().managers_list(rev=True))

    @route(r'/api/managers/([^/]+)', 'PUT')
    def manager(self, mid):
        mid, d = safe_id(mid), self.json_body()
        # при входе по паролю менеджер меняет только свою карточку (контакты в его КП); остальные — администратор
        if admin.login_on(self.h) and (getattr(self.h, '_kp_user', None) or {}).get('id') != mid:
            return self.text(403, 'Карточку другого менеджера меняет администратор')
        for k in ('name', 'position', 'phone', 'ext', 'mobile', 'email'):
            if k in d and not isinstance(d[k], str):
                d[k] = '' if d[k] is None else str(d[k])
        try:
            return self.send_json(store().manager_put(mid, json.dumps(d, ensure_ascii=False), admin.actor(self.h)[1], self.base_rev()))
        except Conflict as e:
            return self.conflict(e)
        except ValueError as e:         # дубль другого менеджера (ФИО, e-mail, мобильный, добавочный)
            return self.text(422, str(e))


# ---------------------------------------------------------------- КП: журнал, состояние, версии, файлы Word и PDF
class KpController(Controller):
    # PDF: чем можно преобразовать; преобразование присланного DOCX (предпросмотр) без записи в журнал
    @route(r'/api/pdf', 'GET')
    def pdf_tools(self):
        return self.send_json(pdf_convert.available(cp().keys().get('convertapiKey')))

    @route(r'/api/pdf', 'POST')
    def pdf_convert(self):
        try:
            data = pdf_convert.convert_bytes(self.body(), cp().keys().get('convertapiKey'))
        except Exception as e:
            return self.text(422, 'PDF не создан: %s' % e)
        return self.send(200, 'application/pdf', data, self.attachment(safe_file(self.q.get('name')) or 'КП.pdf'))

    @route(r'/api/history')
    def history(self):
        if 'limit' in self.q:     # постранично, с поиском и итогами по всему отбору
            return self.send_json(admin.history_page(self.h, store(), self.q))
        return self.send_json(admin.history_out(self.h, store().kp_list()))

    @route(r'/api/kp/new', 'POST')
    def new(self):
        n = store().next_number()
        return self.send_json({'id': n, 'number': n})

    @route(r'/api/kp/([^/]+)/(state|meta)', ('GET', 'PUT'))
    def doc(self, kid, field):
        kid = safe_id(kid)
        if self.m == 'PUT':
            text = self.body().decode('utf-8')
            try:
                if not isinstance(json.loads(text), dict):
                    raise ValueError
            except ValueError:   # испорченная запись ломала бы журнал КП у всех
                return self.text(400, 'Неверный формат КП')
            try:
                rev = store().kp_set(kid, field, admin.kp_in(self.h, store(), kid, field, text), admin.actor(self.h)[1],
                                     self.base_rev() if field == 'state' else None)
            except Conflict as e:
                return self.conflict(e)
            return self.send_json({'ok': True, 'rev': rev})
        v = store().kp_get(kid, field)
        if v and field == 'state':
            v = with_rev(admin.kp_out(self.h, 'state', v), store().rev_of('kp', kid)['rev'])
            return self.send_json(v)
        return self.send_json(admin.kp_out(self.h, field, v)) if v else self.not_found()

    @route(r'/api/kp/([^/]+)/rev', 'GET')      # кто и когда последним сохранил КП — проверка перед сохранением
    def rev(self, kid):
        return self.send_json(store().rev_of('kp', safe_id(kid)))

    # история версий КП: список и состояние выбранной версии (экономика чужого КП убирается, как и у текущей)
    @route(r'/api/kp/([^/]+)/versions', 'GET')
    def versions(self, kid):
        return self.send_json(store().kp_versions(safe_id(kid)))

    @route(r'/api/kp/([^/]+)/versions/(\d+)', 'GET')
    def version(self, kid, n):
        if len(n) > 9:
            return self.not_found()
        v = store().kp_version_state(safe_id(kid), n)
        return self.send_json(admin.kp_out(self.h, 'state', v)) if v else self.not_found()

    @route(r'/api/kp/([^/]+)/docx', 'PUT')
    def docx_put(self, kid):
        kid, q = safe_id(kid), self.q
        name = safe_file(q.get('name'))
        # только документ Word: имя — с расширением .docx (не .exe, .bat, .lnk…), содержимое — архив docx (PK…)
        if not name.lower().endswith('.docx'):
            name = os.path.splitext(name)[0].rstrip('. ') + '.docx'
        if os.path.splitext(name)[0].split('.')[0].strip().upper() in WIN_RESERVED:
            name = '_' + name
        if self.body()[:4] != b'PK\x03\x04':
            return self.text(400, 'Файл КП должен быть документом Word (.docx)')
        sub = safe_dir(q.get('dir'))            # папка менеджера (фамилия)
        rel = (sub + '/' + name) if sub else name
        # имя занято файлом другого КП (два КП по одной закупке: «4567892 КП») — «4567892 КП (2)», «(3)»…
        stem, ext = os.path.splitext(name)
        for k in range(2, 100):
            if not store().kp_docx_owner(rel, kid):
                break
            name = '%s (%d)%s' % (stem, k, ext)
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

    @route(r'/api/kp/([^/]+)/docx', 'GET')
    def docx_get(self, kid):
        # скачивание готового КП — для сотрудников, открывших программу по сети
        rel = store().kp_get(safe_id(kid), 'docx')
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
    @route(r'/api/kp/([^/]+)/pdf')
    def pdf(self, kid):
        rel = store().kp_get(safe_id(kid), 'docx')
        f = docs_path(rel.strip()) if rel else None
        if not f or not os.path.isfile(f):
            return self.not_found('Файл КП не найден')
        pdf = pdf_of(f)
        if self.m == 'POST':
            try:
                pdf_convert.convert_file(f, pdf, cp().keys().get('convertapiKey'))
            except Exception as e:
                return self.text(422, 'PDF не создан: %s' % e)
            return self.send_json({'ok': True, 'path': pdf, 'local': self.is_local()})
        if self.m == 'GET':
            if not os.path.isfile(pdf):
                return self.not_found('PDF этого КП ещё не создан')
            with open(pdf, 'rb') as fh:
                return self.send(200, 'application/pdf', fh.read(), self.attachment(os.path.basename(pdf)))
        return PASS

    @route(r'/api/kp/([^/]+)/openpdf', 'POST')
    def open_pdf(self, kid):
        rel = store().kp_get(safe_id(kid), 'docx')
        pdf = pdf_of(docs_path(rel.strip())) if rel else None
        if not pdf or not os.path.isfile(pdf):
            return self.not_found('PDF этого КП ещё не создан')
        if not self.is_local():
            return self.send_json({'remote': True, 'download': '/api/kp/%s/pdf' % safe_id(kid)})
        open_file(pdf)
        return self.send_json({'ok': True})

    @route(r'/api/kp/([^/]+)/(open|folder)', 'POST')
    def open_doc(self, kid, how):
        rel = store().kp_get(safe_id(kid), 'docx')
        if not rel:
            return self.not_found('Файл КП не найден')
        if not self.is_local():   # открыть Word можно только на своём компьютере — сотруднику по сети отдаём файл
            return self.send_json({'remote': True, 'download': '/api/kp/%s/docx' % safe_id(kid),
                                   'share': (DOCS_SHARE.rstrip('\\/') + '\\' + rel.replace('/', '\\')) if DOCS_SHARE else ''})
        f = docs_path(rel.strip())
        if not os.path.isfile(f):
            return self.not_found('Файл КП был перемещён или удалён')
        if os.path.splitext(f)[1].lower() not in ('.docx', '.pdf'):    # запускать на компьютере можно только документ
            return self.text(400, 'Это не документ Word — файл не открывается')
        if how == 'open':
            open_file(f)
        else:
            show_in_folder(f)
        return self.send_json({'ok': True})

    @route(r'/api/folder', 'POST')
    def docs_folder(self):
        sub = safe_dir(self.q.get('dir'))
        target = os.path.join(DOCS_DIR, sub) if sub else DOCS_DIR
        os.makedirs(target, exist_ok=True)
        if not self.is_local():
            return self.send_json({'remote': True, 'share': (DOCS_SHARE.rstrip('\\/') + ('\\' + sub if sub else '')) if DOCS_SHARE else ''})
        open_folder(target)
        return self.send_json({'ok': True})


# ---------------------------------------------------------------- внешние данные и помощники карточки
class ToolsController(Controller):
    @route(r'/api/cbr')
    def cbr(self):
        return self.send_json(cbr_saved('cbr_last', cbr_rates))

    @route(r'/api/cbr/keyrate')
    def keyrate(self):
        return self.send_json(cbr_saved('keyrate_last', cbr_key_rate))

    # картинки карточек: логотипы производителей из каталога; картинка, перетащенная со страницы сайта
    @route(r'/api/logos', 'GET')
    def logos(self):
        # логотипы зависят только от каталога: расчёт (~0,5 с на большом каталоге) — один раз на его версию
        import imgfetch
        rev = store().data_rev('catalog')
        if _LOGOS.get('rev') != rev:
            _LOGOS.update(rev=rev, text=json.dumps(imgfetch.logos(store()), ensure_ascii=False))
        return self.send_cached('logos-' + rev, lambda: _LOGOS['text'])

    @route(r'/api/imgfetch', 'GET')
    def imgfetch(self):
        import imgfetch
        try:
            ctype, data = imgfetch.fetch_image(self.q.get('url') or '')
        except Exception as e:
            return self.text(422, 'Картинка не загружена: %s' % e)
        return self.send(200, ctype, data)

    @route(r'/api/ai/status', 'GET')       # нейросеть в программе: включена ли (без ключа и адреса)
    def ai_status(self):
        return self.send_json(ai_llm.status(store()))

    @route(r'/api/ai/fill', 'POST')        # автозаполнение: запрос из программы → ответ нейросети (JSON строкой)
    def ai_fill(self):
        d = self.json_body()
        try:
            return self.send_json(ai_llm.ask(store(), d.get('prompt')))
        except RuntimeError as e:
            return self.text(422, str(e))

    @route(r'/api/pagetext', 'POST')       # текст и характеристики со страницы товара — для автозаполнения карточки
    def pagetext(self):
        import feeds
        d = self.json_body()
        try:
            return self.send_json(feeds.page_text(str(d.get('url') or '').strip(), defaults.img_opts(store())))
        except Exception as e:
            return self.text(422, 'Страница не прочитана: %s' % str(e)[:200])

    @route(r'/api/pdftext', 'POST')        # текст из PDF (паспорт, каталог, ТЗ) — для автозаполнения карточки
    def pdftext(self):
        if self.body_size() > pdf_text.MAX_BYTES:
            return self.text(413, 'PDF больше 40 МБ')
        try:
            return self.send_json(pdf_text.text(self.body()))
        except Exception as e:
            return self.text(422, 'PDF не прочитан: %s' % str(e)[:200])

    @route(r'/api/pagephotos', 'POST')     # фото со страницы товара на сайте поставщика — в изображения позиции
    def pagephotos(self):
        import feeds
        d = self.json_body()
        tmap = {t.get('id'): t for t in load_types()['types']}
        try:
            return self.send_json(feeds.page_photos(store(), IMAGES, str(d.get('url') or '').strip(), tmap.get(d.get('cat')),
                                                    d.get('maker') or '', d.get('model') or '', d.get('name') or '',
                                                    d.get('urls') if isinstance(d.get('urls'), list) else None))
        except Exception as e:
            return self.text(422, 'Фото со страницы не загружены: %s' % str(e)[:200])


# ---------------------------------------------------------------- настройки отдела: списки, умолчания, тексты, логистика
class SettingsController(Controller):
    @route(r'/api/lists', 'GET')           # списки и выборы от администратора (для всех; правка — /api/admin/lists)
    def lists(self):
        from lists import ListStore
        return self.send_json(ListStore(store()).all())

    @route(r'/api/defaults', 'GET')        # значения по умолчанию от администратора (для всех)
    def defaults(self):
        return self.send_json(defaults.get(store()))

    @route(r'/api/logistics/quote', 'POST')   # цены перевозчиков (ATI.SU, ПЭК, Деловые Линии, КИТ) — итог по максимуму
    def quote(self):
        req = self.json_body()
        try:
            return self.send_json(logistics_api.quote(store(), req))
        except (ValueError, TypeError, KeyError) as e:
            return self.text(400, 'Неверный запрос: %s' % e)

    @route(r'/api/logistics/status', 'GET')
    def logistics_status(self):
        return self.send_json({'providers': logistics_api.providers(store()), 'auto': store().kv_get('logisticsAuto'),
                               'settings': logistics_api.auto_settings(store())})

    @route(r'/api/logistics/refresh', 'POST')   # обновить ставки по ATI.SU сейчас (администратор)
    def logistics_refresh(self):
        try:
            rec = logistics_api.auto_refresh(store(), force=True)
        except Exception as e:
            return self.text(502, 'ATI.SU: %s' % e)
        return self.send_json(rec or {'error': 'Не задан ключ ATI.SU («Интеграции») или обновление уже идёт'})

    @route(r'/api/logistics')              # тарифы доставки по России (общие для отдела; изменяет администратор)
    def logistics(self):
        if self.m == 'PUT':
            try:
                d = self.json_body()
            except ValueError:
                d = None
            if not isinstance(d, dict) or len(json.dumps(d)) > 100000:
                return self.text(400, 'Неверный формат тарифов')
            d['updatedAt'] = datetime.now().isoformat(timespec='seconds')
            d['updatedBy'] = admin.actor(self.h)[1]
            store().kv_set('logistics', d)
            return self.send_json({'ok': True})
        return self.send_json(dict(store().kv_get('logistics') or {}, _auto=store().kv_get('logisticsAuto')))

    @route(r'/api/uitexts', 'GET')         # тексты интерфейса, изменённые администратором: {исходный текст: новый}
    def uitexts(self):
        return self.send_json(store().kv_get('uitexts') or {})

    @route(r'/api/uitexts', 'PUT')         # только администратор (admin.guard)
    def uitexts_put(self):
        try:
            d = self.json_body()
        except ValueError:
            return self.text(400, 'Неверный формат')
        if not isinstance(d, dict) or len(d) > 3000:
            return self.text(400, 'Неверный формат')
        out = {str(k)[:2000]: str(v)[:4000] for k, v in d.items() if str(k).strip() and isinstance(v, str)}
        store().kv_set('uitexts', out)
        return self.send_json({'ok': True, 'count': len(out)})

    @route(r'/api/version', 'GET')         # версия программы и установленное обновление
    def version(self):
        import version
        return self.send_json({'version': version.VERSION, 'patched': bool(UPDATE_DIR), 'updateDir': UPDATE_DIR})

    @route(r'/api/calendar', 'GET')        # производственный календарь РФ (рабочие / банковские дни)
    def calendar(self):
        import workcal
        qy = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query)).get('year') or ''
        try:
            return self.send_json(workcal.year(store(), int(qy or 0)))
        except ValueError as e:
            return self.text(400, str(e))


# ---------------------------------------------------------------- «Экономика сделки»: поставщики и коды ТН ВЭД / пошлины (общие для отдела)
class DealController(Controller):
    @route(r'/api/suppliers', 'GET')
    def suppliers(self):
        return self.send_cached('sup-' + store().data_rev('suppliers'), lambda: store().suppliers_list())

    @route(r'/api/suppliers/([A-Za-z0-9_-]{1,64})', 'PUT')
    def supplier(self, sid):
        try:
            return self.send_json(store().supplier_put(sid, self.json_body(), admin.actor(self.h)[1], self.base_rev()))
        except Conflict as e:
            return self.conflict(e)
        except ValueError as e:
            return self.text(400, str(e))

    @route(r'/api/customs', ('GET', 'PUT'))
    def customs(self):
        if self.m == 'GET':
            return self.send_json(store().customs_all())
        d = self.json_body()
        try:
            store().customs_put(d.get('key'), d.get('code'), d.get('duty'), d.get('note'), admin.actor(self.h)[1], d.get('name'))
        except ValueError as e:
            return self.text(400, str(e))
        return self.send_json({'ok': True})


# ---------------------------------------------------------------- ход сделки: статус, напоминания, письмо клиенту, отчёт
def _obj(text):
    try:
        d = json.loads(text) if text else {}
    except (TypeError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


class TrackController(Controller):
    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/track', 'PUT')   # статус, причина, заметка, напоминание (права — admin.guard по /api/kp/<id>/)
    def track(self, kid):
        if not store().kp_get(kid, 'meta'):
            return self.not_found('Сначала сохраните КП')
        try:
            tr, changed = kp_track.update(store(), kid, self.json_body(), admin.actor(self.h)[1])
        except ValueError as e:
            raise BadRequest(str(e))
        if changed:
            admin.log(self.h, store(), 'kp_status', 'kp', kid, None, changed)
        return self.send_json({'ok': True, 'track': tr})

    @route(r'/api/reminders', 'GET')       # напоминания менеджера: перезвонить, срок действия КП, нет ответа
    def reminders(self):
        h = self.h
        uid, name, _ = admin.actor(h, admin=False)
        everyone = admin.session(h, touch=False) is not None and not uid
        rows = []
        for kid, meta, track, state in store().kp_tracked((date.today() - timedelta(days=200)).isoformat()):
            m = _obj(meta)
            if admin.login_on(h) and not admin.own_kp(h, m) and not admin.perm(h, 'kpOthers'):
                continue
            rows.append((kid, m, _obj(track), _obj(state)))

        def mine(m):
            if everyone:
                return True
            author = m.get('authorId') or m.get('managerId')
            if author and uid:
                return author == uid
            return bool(name) and str(m.get('manager') or '').strip().lower() == str(name).strip().lower()
        items = kp_track.reminders(rows, mine)
        return self.send_json({'items': items, 'count': len(items)})

    @route(r'/api/mail/status', 'GET')
    def mail_status(self):
        return self.send_json({'on': kp_track.mail_on(store())})

    def _files(self, kid):
        rel = store().kp_get(kid, 'docx')
        f = docs_path(rel.strip()) if rel else None
        return f if f and os.path.isfile(f) else None

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/mailform', 'GET')   # письмо клиенту: адреса и текст по умолчанию
    def mailform(self, kid):
        st, mt = _obj(store().kp_get(kid, 'state')), _obj(store().kp_get(kid, 'meta'))
        mp = kp_track.mail_public(store())
        v = kp_track.mail_vars(st, mt, mp.get('fromName') or '')
        f = self._files(kid)
        ct = st.get('contact') if isinstance(st.get('contact'), dict) else {}
        return self.send_json({'on': mp['on'], 'to': str(ct.get('email') or '').strip(), 'cc': v['e-mail'],
                               'subject': kp_track.fill(mp['subject'], v), 'body': kp_track.fill(mp['body'], v),
                               'word': os.path.basename(f) if f else '', 'pdf': os.path.basename(pdf_of(f)) if f and os.path.isfile(pdf_of(f)) else '',
                               'sent': (store().kp_track_get(kid).get('sent') or [])[-5:]})

    @route(r'/api/kp/([A-Za-z0-9_-]{1,64})/send', 'POST')      # отправить КП клиенту по почте
    def send_kp(self, kid):
        d = self.json_body()
        try:
            to, cc = kp_track.addresses(d.get('to')), kp_track.addresses(d.get('cc'))
        except ValueError as e:
            raise BadRequest(str(e))
        if not to:
            raise BadRequest('Укажите адрес получателя')
        f = self._files(kid)
        if not f:
            return self.not_found('Файл КП не найден — сохраните КП')
        files = []
        if d.get('word', True):
            with open(f, 'rb') as fh:
                files.append((os.path.basename(f), fh.read(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        if d.get('pdf'):
            pdf = pdf_of(f)
            if not os.path.isfile(pdf):
                try:
                    pdf_convert.convert_file(f, pdf, cp().keys().get('convertapiKey'))
                except Exception as e:
                    return self.text(422, 'PDF не создан: %s' % str(e)[:200])
            with open(pdf, 'rb') as fh:
                files.append((os.path.basename(pdf), fh.read(), 'application/pdf'))
        if not files:
            raise BadRequest('Выберите файл: Word или PDF')
        st = _obj(store().kp_get(kid, 'state'))
        reply = str((st.get('manager') or {}).get('email') or '') if isinstance(st.get('manager'), dict) else ''
        try:
            kp_track.send(store(), to, cc, str(d.get('subject') or '')[:300], str(d.get('body') or '')[:20000], files, reply)
        except RuntimeError as e:
            admin.log(self.h, store(), 'send_kp', 'kp', kid, None, {'to': to, 'error': str(e)[:200]}, result='failed')
            return self.text(422, str(e))
        tr = kp_track.mark_sent(store(), kid, to + cc, [x[0] for x in files], admin.actor(self.h)[1])
        admin.log(self.h, store(), 'send_kp', 'kp', kid, None, {'to': to, 'cc': cc, 'files': [x[0] for x in files]})
        return self.send_json({'ok': True, 'track': tr})

    @route(r'/api/report', 'GET')          # отчёт по КП за период: описания (права — как в журнале) и позиции для расчёта по категориям
    def report(self):
        q = self.q
        d1, d2 = str(q.get('from') or '')[:10], str(q.get('to') or '')[:10] or '9999-12-31'
        metas = [m for m in store().kp_metas_where(q.get('q', ''), q.get('author', ''), q.get('kind', ''))
                 if d1 <= str(_obj(m).get('date') or '')[:10] <= d2]
        rows = json.loads(admin.history_out(self.h, '[' + ','.join(m for m in metas if _obj(m)) + ']'))
        for r in rows:
            sr, pr = admin.econ_rub(r)
            r['sumRub'], r['profitRub'] = sr, pr
            if r.get('locked'):
                continue
            st = _obj(store().kp_get(r.get('id') or '', 'state'))
            r['calc'] = {'vat': st.get('vat'), 'pricing': {k: (st.get('pricing') or {}).get(k) for k in ('cur', 'rates', 'costNoVat')},
                         'items': [{k: x.get(k) for k in ('name', 'qty', 'price', 'disc', 'options', 'cost', 'costCur', 'attrs', 'kit')}
                                   for x in (st.get('items') or []) if isinstance(x, dict)]}
        return self.send_json({'items': rows})


# ---------------------------------------------------------------- обслуживание: копия базы, выключение
class ServiceController(Controller):
    @route(r'/api/backup', 'POST')
    def backup(self):
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Резервная копия создаётся на компьютере-сервере'})
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        dst = store().backup(os.path.join(ROOT, 'backup', stamp, 'kp.sqlite3'))
        return self.send_json({'ok': True, 'path': dst, 'dir': os.path.dirname(dst)})

    # выключение — только с самого компьютера (файл «Остановить сервер», установщик, кнопка «Выход»); по сети — нельзя
    @route(r'/api/shutdown', 'POST')
    def shutdown(self):
        if not self.is_local():
            return self.send_json({'ok': False, 'message': 'Сервер отдела выключается только на компьютере-сервере'})
        self.send_json({'ok': True})
        target = getattr(self.server, 'main_server', self.server)
        threading.Thread(target=target.shutdown, daemon=True).start()


ROUTER = Router()
