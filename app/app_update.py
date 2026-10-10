# -*- coding: utf-8 -*-
"""Обновление программы из «Настроек → Обновления» и перезапуск.

• UpdatePackage — архив обновления «KP-Obnovlenie-X.zip» (как в выпуске на GitHub): внутри папка update (version.json,
  app\\*.py, app\\web\\…, templates\\…) и server-setup (файлы управления сервером отдела). Проверка: нет путей наружу,
  есть код и интерфейс, версия читается.
• ReleaseSource — проверка новой версии и скачивание архива из выпусков GitHub (репозиторий и токен — в «Настройках»;
  у приватного репозитория без токена — только загрузка архива файлом).
• Updater — установка в папку update рядом с программой (её подключает launcher.py при запуске EXE, если версия новее
  встроенной), прежнее обновление — в update.prev (откат одной кнопкой), копия базы перед установкой, история установок.
• Restarter — перезапуск: вспомогательный процесс ждёт, пока программа закроется и освободит порт, и запускает её снова
  (сервер отдела — задачей Планировщика, обычный запуск — тем же EXE без открытия браузера).
• StartCheck — самопроверка запуска обновления и разбор ошибок запуска: не прошла — launcher.py (встроен в EXE) сам
  возвращает прежнюю версию, а Updater показывает причину в «Обновлениях».
"""
import errno
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import zipfile
from datetime import datetime

import version


class UpdateError(Exception):
    """Ошибка обновления — текст для администратора."""


class UpdatePackage:
    """Архив обновления: проверка и распаковка."""
    MAX_BYTES = 150 * 1024 * 1024
    MAX_FILES = 5000
    REQUIRED = ('update/version.json', 'update/app/kp_server.py', 'update/app/web/index.html')

    def __init__(self, data):
        if len(data) > self.MAX_BYTES:
            raise UpdateError('Файл слишком большой для обновления (больше 150 МБ)')
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise UpdateError('Это не архив ZIP — нужен файл обновления «KP-Obnovlenie-….zip» из выпуска')
        self.names = {self._norm(i.filename): i for i in self.zip.infolist() if not i.is_dir()}
        if len(self.names) > self.MAX_FILES:
            raise UpdateError('В архиве слишком много файлов')
        if any(self._unsafe(n) for n in self.names):
            raise UpdateError('В архиве есть недопустимые пути — файл повреждён или это не обновление программы')
        self.prefix = self._prefix()
        missing = [r for r in self.REQUIRED if self.prefix + r not in self.names]
        if missing:
            raise UpdateError('Это не обновление «Конструктора КП»: нет %s' % ', '.join(m.split('/', 1)[1] for m in missing))
        try:
            self.version = str(json.loads(self.zip.read(self.names[self.prefix + 'update/version.json']).decode('utf-8-sig')).get('version') or '')
        except (ValueError, UnicodeDecodeError):
            raise UpdateError('В архиве испорчен version.json')
        if not re.match(r'^\d+\.\d+(\.\d+){0,2}$', self.version):
            raise UpdateError('В архиве неверная версия: %s' % self.version[:40])

    @staticmethod
    def _norm(n):
        n = n.replace('\\', '/')
        while n.startswith('./'):
            n = n[2:]
        return n

    @staticmethod
    def _unsafe(n):
        parts = n.split('/')
        return n.startswith('/') or ':' in parts[0] or '..' in parts or any(p.startswith('~') for p in parts)

    def _prefix(self):
        """Архив может содержать update сразу или внутри папки «Обновление КП X/»."""
        for n in self.names:
            if n.endswith('update/version.json'):
                return n[:-len('update/version.json')]
        return ''

    def files(self, folder):
        """[(путь внутри folder, ZipInfo)] — файлы папки update или server-setup."""
        p = self.prefix + folder + '/'
        return [(n[len(p):], i) for n, i in self.names.items() if n.startswith(p) and '__pycache__' not in n]

    def extract(self, folder, dst):
        n = 0
        for rel, info in self.files(folder):
            out = os.path.join(dst, *rel.split('/'))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with self.zip.open(info) as src, open(out, 'wb') as f:
                shutil.copyfileobj(src, f)
            n += 1
        return n


class ReleaseSource:
    """Выпуски на GitHub: последняя версия, описание изменений, архив обновления."""
    API = os.environ.get('KP_UPDATE_API') or 'https://api.github.com'
    ASSET = re.compile(r'^KP-Obnovlenie-[\d.]+\.zip$')
    TIMEOUT = 60

    def __init__(self, repo, token=''):
        if not re.match(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', repo or ''):
            raise UpdateError('Репозиторий — в виде «владелец/имя», например DevMoreBill/KP')
        self.repo, self.token = repo, (token or '').strip()

    def _headers(self, accept='application/vnd.github+json'):
        h = {'Accept': accept, 'User-Agent': 'KP-Konstruktor/' + version.VERSION, 'X-GitHub-Api-Version': '2022-11-28'}
        if self.token:
            h['Authorization'] = 'Bearer ' + self.token
        return h

    class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
        """Файл выпуска отдаётся по ссылке на хранилище — туда токен не передаётся."""
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            r = super().redirect_request(req, fp, code, msg, headers, newurl)
            if r is not None:
                r.headers.pop('Authorization', None)
                r.unredirected_hdrs.pop('Authorization', None)
            return r

    def _open(self, url, accept):
        req = urllib.request.Request(url, headers=self._headers(accept))
        try:
            return urllib.request.build_opener(self._NoAuthRedirect()).open(req, timeout=self.TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise UpdateError('GitHub не принял токен — проверьте его (нужен доступ «Contents: read» к репозиторию)')
            if e.code == 404:
                raise UpdateError('Выпуск не найден: репозиторий %s приватный — укажите токен GitHub, или выпусков ещё нет' % self.repo
                                  if not self.token else 'Выпуск или репозиторий %s не найден' % self.repo)
            raise UpdateError('GitHub ответил ошибкой %s' % e.code)
        except (urllib.error.URLError, OSError) as e:
            raise UpdateError('Нет связи с GitHub: %s. Скачайте архив обновления вручную и загрузите его файлом' % str(getattr(e, 'reason', e))[:120])

    def latest(self):
        """{version, tag, name, notes, published, asset: {id, name, size} | None, url}."""
        with self._open('%s/repos/%s/releases/latest' % (self.API, self.repo), 'application/vnd.github+json') as r:
            j = json.loads(r.read().decode('utf-8'))
        tag = str(j.get('tag_name') or '')
        asset = next(({'id': a.get('id'), 'name': a.get('name'), 'size': a.get('size')} for a in (j.get('assets') or [])
                      if self.ASSET.match(str(a.get('name') or ''))), None)
        return {'version': tag.lstrip('vV'), 'tag': tag, 'name': str(j.get('name') or tag), 'notes': str(j.get('body') or '')[:20000],
                'published': j.get('published_at') or '', 'asset': asset, 'url': j.get('html_url') or ''}

    def download(self, asset_id):
        url = '%s/repos/%s/releases/assets/%d' % (self.API, self.repo, int(asset_id))
        with self._open(url, 'application/octet-stream') as r:
            data = r.read(UpdatePackage.MAX_BYTES + 1)
        return data


class Updater:
    """Установка обновления рядом с программой, откат, история."""
    KV = 'update'
    HISTORY = 30
    FAILED_LOG = 'update-failed.json'     # пишет launcher.py, когда обновление не запустилось и вернулась прежняя версия

    def __init__(self, store, root, data_dir):
        self.store, self.root, self.data_dir = store, root, data_dir
        self.dir, self.prev, self.new, self.failed_dir = (os.path.join(root, x) for x in ('update', 'update.prev', 'update.new', 'update.failed'))

    # ---------- состояние
    def settings(self):
        s = self.store.kv_get(self.KV) or {}
        return s if isinstance(s, dict) else {}

    def _save(self, s):
        self.store.kv_set(self.KV, s)

    @staticmethod
    def frozen():
        return bool(getattr(sys, 'frozen', False))

    @staticmethod
    def _dir_version(d):
        try:
            with open(os.path.join(d, 'version.json'), 'r', encoding='utf-8-sig') as f:
                return str(json.load(f).get('version') or '')
        except (OSError, ValueError):
            return ''

    def current(self):
        return version.VERSION

    def token(self):
        return str(((self.store.kv_get('integrations') or {}).get('githubToken')) or '').strip()

    def status(self):
        s = (os.path.isfile(os.path.join(self.root, self.FAILED_LOG)) and self.absorb_failures()) or self.settings()
        installed, prev = self._dir_version(self.dir), self._dir_version(self.prev)
        last = s.get('last') or {}
        return {'current': self.current(), 'base': os.environ.get('KP_BASE_VERSION') or '', 'patched': bool(os.environ.get('KP_UPDATE_DIR')),
                'installed': installed, 'pending': bool(installed) and version.as_tuple(installed) > version.as_tuple(self.current()),
                'prev': prev, 'frozen': self.frozen(), 'writable': self.writable(), 'root': self.root,
                'repo': s.get('repo') or 'DevMoreBill/KP', 'auto': s.get('auto', True), 'hasToken': bool(self.token()),
                'last': last, 'available': bool(last.get('version')) and version.as_tuple(last['version']) > version.as_tuple(self.current()),
                'failed': self.failed(s), 'history': (s.get('history') or [])[-self.HISTORY:][::-1]}

    def failed(self, s=None):
        """Последнее обновление, которое не запустилось (программа вернулась к прежней версии), — пока работает версия
        старше него: {version, back, at, reason, trace} или None."""
        f = (s or self.settings()).get('failed')
        if not isinstance(f, dict) or not f.get('version'):
            return None
        return f if version.as_tuple(f['version']) > version.as_tuple(self.current()) else None

    def absorb_failures(self):
        """Записи launcher.py о неудачных запусках обновлений (update-failed.json рядом с программой) → история установок
        и предупреждение в «Обновлениях»; файл удаляется. Никогда не мешает запуску. → новые настройки или None."""
        path = os.path.join(self.root, self.FAILED_LOG)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                recs = json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            recs = []
        try:
            s = self.settings()
            h = s.get('history') if isinstance(s.get('history'), list) else []
            for r in recs if isinstance(recs, list) else []:
                if not isinstance(r, dict) or not r.get('version'):
                    continue
                r = {k: str(r.get(k) or '')[:limit] for k, limit in (('version', 40), ('back', 40), ('exe', 40), ('at', 40), ('reason', 600), ('trace', 6000))}
                h.append({'version': r['back'] or r['exe'], 'from': r['version'], 'by': 'программа', 'at': r['at'],
                          'source': 'не запустилось — возврат', 'reason': r['reason']})
                # не запустились подряд два обновления (новое и предыдущее) — предупреждение о самом новом из них
                old = s.get('failed') if isinstance(s.get('failed'), dict) else {}
                if version.as_tuple(r['version']) >= version.as_tuple(old.get('version') or '0'):
                    s['failed'] = r
            s['history'] = h[-self.HISTORY:]
            self._save(s)
            os.remove(path)
            return s
        except Exception as e:          # запись о сбое не должна мешать работе программы
            print('Запись о неудачном обновлении не прочитана:', e)
            return None

    def writable(self):
        try:
            os.makedirs(self.new, exist_ok=True)
            probe = os.path.join(self.new, '.probe')
            with open(probe, 'w') as f:
                f.write('1')
            os.remove(probe)
            shutil.rmtree(self.new, ignore_errors=True)
            return True
        except OSError:
            return False

    def configure(self, d, by):
        s = self.settings()
        if 'repo' in d:
            ReleaseSource(str(d.get('repo') or '').strip())       # проверка вида «владелец/имя»
            s['repo'] = str(d['repo']).strip()
        if 'auto' in d:
            s['auto'] = bool(d['auto'])
        if 'token' in d:
            keys = self.store.kv_get('integrations') or {}
            t = str(d.get('token') or '').strip()
            if t:
                keys['githubToken'] = t[:300]
            else:
                keys.pop('githubToken', None)
            self.store.kv_set('integrations', keys)
        s['updatedAt'], s['updatedBy'] = datetime.now().isoformat(timespec='seconds'), by
        self._save(s)
        return self.status()

    # ---------- проверка и скачивание
    def source(self):
        return ReleaseSource(self.settings().get('repo') or 'DevMoreBill/KP', self.token())

    def check(self):
        s = self.settings()
        try:
            rel = self.source().latest()
            rel['at'] = datetime.now().isoformat(timespec='seconds')
            s['last'] = rel
        except UpdateError as e:
            s['last'] = dict(s.get('last') or {}, at=datetime.now().isoformat(timespec='seconds'), error=str(e))
            self._save(s)
            raise
        self._save(s)
        return self.status()

    def auto_check(self):
        """Раз в сутки (фоновая задача): проверить, есть ли новая версия (только если включено и задан репозиторий)."""
        s = self.settings()
        if not s.get('auto', True):
            return
        last = (s.get('last') or {}).get('at') or ''
        if last[:10] == datetime.now().strftime('%Y-%m-%d'):
            return
        try:
            self.check()
        except UpdateError:
            pass

    def download_latest(self, by):
        last = self.settings().get('last') or {}
        if not last.get('asset'):
            raise UpdateError('В выпуске нет архива обновления — сначала «Проверить обновления»')
        return self.install(self.source().download(last['asset']['id']), by, source='GitHub ' + (last.get('tag') or ''))

    # ---------- установка, откат
    def install(self, data, by, source='файл', force=False):
        pkg = UpdatePackage(data)
        cur = self.current()
        if not force and version.as_tuple(pkg.version) <= version.as_tuple(cur):
            raise UpdateError('Версия обновления %s не новее работающей %s — устанавливать нечего' % (pkg.version, cur))
        if not self.writable():
            raise UpdateError('Нет прав записи в папку программы %s — запустите обновление файлом «Установить обновление.cmd» '
                              'от имени администратора компьютера' % self.root)
        self._backup_db(pkg.version)
        shutil.rmtree(self.new, ignore_errors=True)
        n = pkg.extract('update', self.new)
        if not os.path.isfile(os.path.join(self.new, 'app', 'kp_server.py')):
            shutil.rmtree(self.new, ignore_errors=True)
            raise UpdateError('Архив распакован не полностью — повторите')
        self._swap_in()
        setup = self._server_setup(pkg)
        shutil.rmtree(self.failed_dir, ignore_errors=True)      # прежнее неудачное обновление больше не нужно
        self._log({'version': pkg.version, 'from': cur, 'by': by, 'source': source, 'files': n}, failed=None)
        return {'version': pkg.version, 'from': cur, 'files': n, 'serverSetup': setup}

    def _backup_db(self, ver):
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        self.store.backup(os.path.join(self.data_dir, 'backup', 'kp-%s-before-update-%s.zip' % (stamp, ver)))

    def _swap_in(self):
        """update.new → update; прежнее update → update.prev. Папку, занятую работающей программой, не переименовать —
        тогда файлы копируются поверх (прежние сохраняются в update.prev)."""
        shutil.rmtree(self.prev, ignore_errors=True)
        try:
            if os.path.isdir(self.dir):
                os.replace(self.dir, self.prev)
            os.replace(self.new, self.dir)
        except OSError:
            if os.path.isdir(self.dir) and not os.path.isdir(self.prev):
                shutil.copytree(self.dir, self.prev)
            shutil.copytree(self.new, self.dir, dirs_exist_ok=True)
            shutil.rmtree(self.new, ignore_errors=True)

    def _server_setup(self, pkg):
        dst = os.path.join(self.root, 'server-setup')
        if not os.path.isdir(dst) or not pkg.files('server-setup'):
            return 0
        try:
            return pkg.extract('server-setup', dst)
        except OSError:
            return 0

    def rollback(self, by):
        """Вернуть предыдущее обновление (или версию EXE, если предыдущего нет)."""
        if not os.path.isdir(self.prev):
            raise UpdateError('Предыдущего обновления нет')
        cur, back = self.current(), self._dir_version(self.prev)
        tmp = self.dir + '.tmp'
        shutil.rmtree(tmp, ignore_errors=True)
        if os.path.isdir(self.dir):
            os.replace(self.dir, tmp)
        os.replace(self.prev, self.dir)
        if os.path.isdir(tmp):
            os.replace(tmp, self.prev)
        self._log({'version': back, 'from': cur, 'by': by, 'source': 'откат'})
        return {'version': back}

    def remove(self, by):
        """Убрать установленное обновление — после перезапуска работает версия, встроенная в EXE."""
        if not os.path.isdir(self.dir):
            raise UpdateError('Обновление не установлено — работает версия программы (EXE)')
        shutil.rmtree(self.prev, ignore_errors=True)
        os.replace(self.dir, self.prev)
        self._log({'version': 'EXE', 'from': self.current(), 'by': by, 'source': 'обновление убрано'})
        return {'ok': True}

    def _log(self, rec, **extra):
        s = self.settings()
        h = s.get('history') if isinstance(s.get('history'), list) else []
        h.append(dict(rec, at=datetime.now().isoformat(timespec='seconds')))
        s['history'] = h[-self.HISTORY:]
        for k, v in extra.items():          # failed=None — новая установка: прежнее предупреждение о сбое снимается
            if v is None:
                s.pop(k, None)
            else:
                s[k] = v
        self._save(s)


class Restarter:
    """Перезапуск программы: вспомогательный процесс ждёт закрытия и запускает её снова."""
    TASK = 'Конструктор КП — сервер отдела'
    DELAY = 3

    def __init__(self, server_mode):
        self.server_mode = server_mode

    def _task_exists(self):
        try:
            return subprocess.run(['schtasks', '/Query', '/TN', self.TASK], capture_output=True, timeout=15).returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    def command(self):
        """Команда вспомогательного процесса. На Windows — готовая строка: из списка Python сделал бы кавычки вида \\",
        которых cmd.exe не понимает (start "" "…\\kp.exe" сломался бы)."""
        if os.name == 'nt':
            wait = 'ping -n %d 127.0.0.1 >nul' % (self.DELAY + 1)
            if self.server_mode and self._task_exists():
                return 'cmd.exe /s /c "%s & schtasks /Run /TN "%s""' % (wait, self.TASK)
            run = '"%s"' % sys.executable if getattr(sys, 'frozen', False) else '"%s" "%s"' % (sys.executable, os.path.abspath(sys.argv[0]))
            return 'cmd.exe /s /c "%s & start "" %s"' % (wait, run)
        args = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, os.path.abspath(sys.argv[0])]
        return ['sh', '-c', 'sleep %d; exec "$@"' % self.DELAY, 'kp-restart'] + args

    # переменные, которые новый процесс должен получить заново, а не унаследовать:
    # _MEI…/_PYI… — EXE в одном файле (PyInstaller) распаковывается во временную папку и помечает её в окружении;
    # унаследовав их, новый EXE искал бы свои файлы в папке старого процесса (её уже удалили) и сразу падал;
    # KP_UPDATE_* / KP_BASE_VERSION — launcher.py ставит их сам, если обновление новее EXE (после отката — нет)
    INHERIT_DROP = ('_MEI', '_PYI', 'PYINSTALLER_', 'KP_UPDATE_', 'KP_BASE_VERSION')

    @classmethod
    def environment(cls, browser=False):
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(cls.INHERIT_DROP)}
        env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'      # PyInstaller ≥ 6.10: новый EXE — как запущенный заново
        if browser:
            env.pop('KP_NO_BROWSER', None)
        else:
            env['KP_NO_BROWSER'] = '1'
        return env

    def spawn(self, browser=False):
        """browser — новый процесс сам откроет браузер (возврат к прежней версии при первом запуске: страницы ещё нет)."""
        env = self.environment(browser)
        cmd = self.command()
        if os.name == 'nt':
            flags = 0x00000008 | 0x00000200       # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            try:
                subprocess.Popen(cmd, env=env, creationflags=flags | 0x01000000, close_fds=True)   # + CREATE_BREAKAWAY_FROM_JOB
            except OSError:
                subprocess.Popen(cmd, env=env, creationflags=flags, close_fds=True)
        else:
            subprocess.Popen(cmd, env=env, start_new_session=True, close_fds=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)

    def restart(self, server):
        """После ответа на запрос: запустить вспомогательный процесс и закрыть сервер (main() завершает программу)."""
        def go():
            self.spawn()
            server.shutdown()
        threading.Timer(0.7, go).start()


class StartCheck:
    """Самопроверка запуска обновления (патча) и разбор ошибок запуска.

    Пока новая версия не ответила на свои главные адреса, программа не считается запущенной (kp_server.STARTED).
    Ошибка в коде обновления до этого момента или неудачная самопроверка — launcher.py возвращает прежнюю версию
    (update → update.failed, update.prev → update) и запускает её; причина — в «Настройки → Обновления».
    Ошибки окружения (база повреждена или занята, нет места, нет прав) прежняя версия встретила бы так же — из-за них
    обновление не откатывается: программа показывает своё обычное сообщение."""
    PATHS = ('/api/version', '/api/ping', '/')
    TIMEOUT = 60           # медленный компьютер или большая база: не ответил за минуту — не повод откатывать
    ENV_WORDS = ('malformed', 'not a database', 'disk is full', 'database is locked', 'disk i/o error', 'readonly database',
                 'unable to open database', 'read-only file system', 'no space left')

    class Failed(Exception):
        """Обновление запустилось, но на свои главные адреса не отвечает как надо."""

    def __init__(self, port, server, ready):
        self.port, self.server, self.ready, self.error = port, server, ready, ''

    @staticmethod
    def patched():
        return bool(os.environ.get('KP_UPDATE_DIR'))

    @classmethod
    def code_error(cls, e):
        """Ошибка в коде программы, а не в окружении (нет прав, нет места, база повреждена или занята)."""
        if isinstance(e, PermissionError) or (isinstance(e, OSError) and e.errno in (errno.ENOSPC, errno.EROFS, errno.EACCES)):
            return False
        if isinstance(e, sqlite3.DatabaseError) or isinstance(e, OSError):
            return not any(w in str(e).lower() for w in cls.ENV_WORDS)
        return True

    def start(self):
        threading.Thread(target=self._run, daemon=True, name='start-check').start()

    def _run(self):
        try:
            for path in self.PATHS:
                self._get(path)
        except self.Failed as e:
            self.error = 'Самопроверка после запуска: %s' % e
            self.server.shutdown()
            return
        except Exception as e:           # сама проверка не должна откатывать рабочую версию
            print('Самопроверка запуска не выполнена:', e)
        self.ready()

    def _get(self, path):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open('http://127.0.0.1:%d%s' % (self.port, path), timeout=self.TIMEOUT) as r:
                r.read(1 << 20)
        except urllib.error.HTTPError as e:
            raise self.Failed('%s — ответ %d' % (path, e.code))
        except urllib.error.URLError as e:
            if isinstance(e.reason, TimeoutError):
                return
            raise self.Failed('%s — нет ответа (%s)' % (path, e.reason))
        except TimeoutError:
            return
        except (OSError, ValueError) as e:
            raise self.Failed('%s — %s' % (path, e))
