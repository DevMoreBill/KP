"""Обновление программы: пакет (UpdatePackage), выпуски GitHub, установка, перезапуск, ночное обновление."""

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
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta
from typing import Any

import version
from defaults import SrvVal
from server_log import ServerLog
from update_sign import UpdateSign


class UpdateError(Exception):
    """Ошибка обновления — текст для администратора."""


class UpdatePackage:
    """Архив обновления: проверка и распаковка."""

    MAX_BYTES = 150 * 1024 * 1024
    MAX_FILES = 5000
    MAX_UNPACKED = 600 * 1024 * 1024  # распакованное целиком (защита от «zip-бомбы»)
    REQUIRED = ('update/version.json', 'update/app/kp_server.py', 'update/app/web/index.html')

    def __init__(self, data, keys=None) -> None:
        """keys — доверенные ключи подписи (UpdateSign.keys); None — без проверки подписи (только разбор архива)."""
        if len(data) > self.MAX_BYTES:
            raise UpdateError('Файл слишком большой для обновления (больше 150 МБ)')
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise UpdateError('Это не архив ZIP — нужен файл обновления «KP-Obnovlenie-….zip» из выпуска') from None
        self.names = {self._norm(i.filename): i for i in self.zip.infolist() if not i.is_dir()}
        if len(self.names) > self.MAX_FILES:
            raise UpdateError('В архиве слишком много файлов')
        if any(self._unsafe(name) for name in self.names):
            raise UpdateError('В архиве есть недопустимые пути — файл повреждён или это не обновление программы')
        if sum(i.file_size for i in self.names.values()) > self.MAX_UNPACKED:
            raise UpdateError('Архив обновления распаковывается в слишком большой объём — файл повреждён')
        self.prefix = self._prefix()
        missing = [req for req in self.REQUIRED if self.prefix + req not in self.names]
        if missing:
            raise UpdateError(
                'Это не обновление «Конструктора КП»: нет {}'.format(
                    ', '.join(miss.split('/', 1)[1] for miss in missing)
                )
            )
        try:
            self.version = str(
                json.loads(self.zip.read(self.names[self.prefix + 'update/version.json']).decode('utf-8-sig')).get(
                    'version'
                )
                or ''
            )
        except (ValueError, UnicodeDecodeError):
            raise UpdateError('В архиве испорчен version.json') from None
        if not re.match(r'^\d+\.\d+(\.\d+){0,2}$', self.version):
            raise UpdateError(f'В архиве неверная версия: {self.version[:40]}')
        if keys is not None:
            try:
                UpdateSign.check(self.zip, self.names, self.prefix, self.version, keys)
            except (ValueError, zipfile.BadZipFile, OSError, NotImplementedError) as exc:
                raise UpdateError(f'Обновление не установлено: {exc}') from exc

    _norm = staticmethod(UpdateSign.norm)

    @staticmethod
    def _unsafe(name) -> bool:
        parts = name.split('/')
        return (
            name.startswith('/')
            or '..' in parts
            or any(part.startswith('~') or ':' in part or '\\' in part for part in parts)
        )

    def _prefix(self) -> str:
        """Архив может содержать update сразу или внутри папки «Обновление КП X/»."""
        for name in self.names:
            if name.endswith('update/version.json'):
                return name[: -len('update/version.json')]
        return ''

    def files(self, folder: str) -> list:
        """[(путь внутри folder, ZipInfo)] — файлы папки update или server-setup."""
        prefix = self.prefix + folder + '/'
        return [
            (name[len(prefix) :], i)
            for name, i in self.names.items()
            if name.startswith(prefix) and '__pycache__' not in name
        ]

    def extract(self, folder: str, dst) -> int:
        count = 0
        root = os.path.abspath(dst)
        for rel, info in self.files(folder):
            out = os.path.abspath(os.path.join(dst, *rel.split('/')))
            if os.path.commonpath([root, out]) != root:  # «D:» внутри пути на Windows сбросил бы папку
                raise UpdateError('Пакет обновления повреждён: файл вне папки обновления')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with self.zip.open(info) as src, open(out, 'wb') as handle:
                shutil.copyfileobj(src, handle)
            count += 1
        return count


class ReleaseSource:
    """Выпуски на GitHub: последняя версия, описание изменений, архив обновления."""

    WEB_API = 'https://api.github.com'
    API = os.environ.get('KP_UPDATE_API') or WEB_API
    ASSET = re.compile(r'^KP-Obnovlenie-[\d.]+\.zip$')
    TIMEOUT = 60

    def __init__(self, repo, token='') -> None:
        if not re.match(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', repo or ''):
            raise UpdateError('Репозиторий — в виде «владелец/имя», например DevMoreBill/KP')
        self.repo, self.token = repo, (token or '').strip()

    def _headers(self, accept='application/vnd.github+json') -> dict:
        headers = {
            'Accept': accept,
            'User-Agent': 'KP-Konstruktor/' + version.VERSION,
            'X-GitHub-Api-Version': '2022-11-28',
        }
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        return headers

    class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
        """Файл выпуска отдаётся по ссылке на хранилище — туда токен не передаётся."""

        def redirect_request(self, req, stream, code, msg, headers, newurl) -> Any:
            new_req = super().redirect_request(req, stream, code, msg, headers, newurl)
            if new_req is not None:
                new_req.headers.pop('Authorization', None)
                new_req.unredirected_hdrs.pop('Authorization', None)
            return new_req

    @staticmethod
    def _offline(exc) -> 'UpdateError':
        return UpdateError(
            'Нет связи с GitHub: {}. Скачайте архив обновления вручную и загрузите его файлом'.format(
                str(getattr(exc, 'reason', exc))[:120]
            )
        )

    def _open(self, url, accept) -> Any:
        req = urllib.request.Request(url, headers=self._headers(accept))
        try:
            return urllib.request.build_opener(self._NoAuthRedirect()).open(req, timeout=self.TIMEOUT)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise UpdateError(
                    'GitHub не принял токен — проверьте его (нужен доступ «Contents: read» к репозиторию)'
                ) from exc
            if exc.code == 404:
                raise UpdateError(
                    f'Выпуск не найден: репозиторий {self.repo} приватный — укажите токен GitHub, или выпусков ещё нет'
                    if not self.token
                    else f'Выпуск или репозиторий {self.repo} не найден'
                ) from exc
            raise UpdateError(f'GitHub ответил ошибкой {exc.code}') from exc
        except (urllib.error.URLError, OSError) as exc:
            raise self._offline(exc) from exc

    def latest(self) -> dict:
        """{version, tag, name, notes, published, asset: {id, name, size, url?} | None, url}."""
        try:
            with self._open(f'{self.API}/repos/{self.repo}/releases/latest', 'application/vnd.github+json') as resp:
                j = json.loads(resp.read().decode('utf-8'))
        except UpdateError:
            if self.token or self.API != ReleaseSource.WEB_API:
                raise
            return self._latest_web()
        tag = str(j.get('tag_name') or '')
        asset = next(
            (
                {'id': item.get('id'), 'name': item.get('name'), 'size': item.get('size')}
                for item in (j.get('assets') or [])
                if self.ASSET.match(str(item.get('name') or ''))
            ),
            None,
        )
        return {
            'version': tag.lstrip('vV'),
            'tag': tag,
            'name': str(j.get('name') or tag),
            'notes': str(j.get('body') or '')[:20000],
            'published': j.get('published_at') or '',
            'asset': asset,
            'url': j.get('html_url') or '',
        }

    def _latest_web(self) -> dict:
        """Последний выпуск по перенаправлению github.com/<репозиторий>/releases/latest → …/releases/tag/vX.Y.Z."""
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    f'https://github.com/{self.repo}/releases/latest', headers=self._headers('text/html')
                ),
                timeout=self.TIMEOUT,
            ) as resp:
                final = resp.geturl()
        except urllib.error.HTTPError as exc:
            raise UpdateError(
                f'Выпуск не найден: репозиторий {self.repo} приватный или не существует (GitHub ответил {exc.code}) — укажите токен GitHub'
            ) from exc
        except (urllib.error.URLError, OSError) as exc:
            raise self._offline(exc) from exc
        match = re.search(r'/releases/tag/([^/?#]+)$', final or '')
        if not match:
            raise UpdateError(f'Выпусков в репозитории {self.repo} ещё нет')
        tag = urllib.parse.unquote(match.group(1))
        ver = tag.lstrip('vV')
        name = f'KP-Obnovlenie-{ver}.zip'
        asset = (
            {
                'id': 0,
                'name': name,
                'size': None,
                'url': f'https://github.com/{self.repo}/releases/download/{urllib.parse.quote(tag)}/{name}',
            }
            if self.ASSET.match(name)
            else None
        )
        return {'version': ver, 'tag': tag, 'name': tag, 'notes': '', 'published': '', 'asset': asset, 'url': final}

    def download(self, asset) -> bytes:
        """asset — {id, url?} из latest() (или номер файла выпуска)."""
        info = asset if isinstance(asset, dict) else {'id': asset}
        if info.get('url') and not info.get('id'):
            if not str(info['url']).startswith(f'https://github.com/{self.repo}/releases/download/'):
                raise UpdateError('Неверная ссылка на файл выпуска')
            url = info['url']
        else:
            url = f'{self.API}/repos/{self.repo}/releases/assets/{int(info["id"])}'
        with self._open(url, 'application/octet-stream') as resp:
            return resp.read(UpdatePackage.MAX_BYTES + 1)


class Updater:
    """Установка обновления рядом с программой, откат, история."""

    KV_KEY = 'update'
    HISTORY = 30
    REPO = 'DevMoreBill/KP'  # репозиторий выпусков по умолчанию
    FAILED_LOG = 'update-failed.json'  # пишет launcher.py, когда обновление не запустилось и вернулась прежняя версия

    def __init__(self, store, root, data_dir: str) -> None:
        self.store, self.root, self.data_dir = store, root, data_dir
        self.dir, self.prev, self.new, self.failed_dir = (
            os.path.join(root, x) for x in ('update', 'update.prev', 'update.new', 'update.failed')
        )

    def settings(self) -> dict:
        conf = self.store.kv_get(self.KV_KEY) or {}
        return conf if isinstance(conf, dict) else {}

    def _save(self, conf) -> None:
        self.store.kv_set(self.KV_KEY, conf)

    @staticmethod
    def frozen() -> bool:
        return bool(getattr(sys, 'frozen', False))

    @staticmethod
    def _dir_version(folder) -> str:
        try:
            with open(os.path.join(folder, 'version.json'), encoding='utf-8-sig') as handle:
                return str(json.load(handle).get('version') or '')
        except (OSError, ValueError):
            return ''

    def current(self) -> str:
        return version.VERSION

    def token(self) -> str:
        return str(((self.store.kv_get('integrations') or {}).get('githubToken')) or '').strip()

    def status(self) -> dict:
        conf = (os.path.isfile(os.path.join(self.root, self.FAILED_LOG)) and self.absorb_failures()) or self.settings()
        installed, prev = self._dir_version(self.dir), self._dir_version(self.prev)
        last = conf.get('last') or {}
        return {
            'current': self.current(),
            'base': os.environ.get('KP_BASE_VERSION') or '',
            'patched': bool(os.environ.get('KP_UPDATE_DIR')),
            'installed': installed,
            'pending': bool(installed) and version.as_tuple(installed) > version.as_tuple(self.current()),
            'prev': prev,
            'frozen': self.frozen(),
            'writable': self.writable(),
            'root': self.root,
            'repo': conf.get('repo') or self.REPO,
            'auto': conf.get('auto', True),
            'hasToken': bool(self.token()),
            'last': last,
            'available': bool(last.get('version'))
            and version.as_tuple(last['version']) > version.as_tuple(self.current()),
            'failed': self.failed(conf),
            'history': (conf.get('history') or [])[-self.HISTORY :][::-1],
            'nightly': conf.get('nightly') or 'off',
            'nightHour': int(conf.get('nightHour', NightUpdate.HOUR)),
            'nightLast': conf.get('nightLast'),
            'nightSupported': NightUpdate.supported(),
        }

    def failed(self, conf=None) -> dict | None:
        """Последнее не запустившееся обновление (пока работает версия старше него) или None."""
        failed = (conf or self.settings()).get('failed')
        if not isinstance(failed, dict) or not failed.get('version'):
            return None
        return failed if version.as_tuple(failed['version']) > version.as_tuple(self.current()) else None

    def absorb_failures(self) -> dict | None:
        """Записи launcher.py о неудачных запусках → история и предупреждение; файл удаляется."""
        path = os.path.join(self.root, self.FAILED_LOG)
        try:
            with open(path, encoding='utf-8') as handle:
                recs = json.load(handle)
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            recs = []
        try:
            conf = self.settings()
            hist = conf.get('history') if isinstance(conf.get('history'), list) else []
            for raw in recs if isinstance(recs, list) else []:
                if not isinstance(raw, dict) or not raw.get('version'):
                    continue
                rec = {
                    k: str(raw.get(k) or '')[:limit]
                    for k, limit in (
                        ('version', 40),
                        ('back', 40),
                        ('exe', 40),
                        ('at', 40),
                        ('reason', 600),
                        ('trace', 6000),
                    )
                }
                hist.append(
                    {
                        'version': rec['back'] or rec['exe'],
                        'from': rec['version'],
                        'by': 'программа',
                        'at': rec['at'],
                        'source': 'не запустилось — возврат',
                        'reason': rec['reason'],
                    }
                )
                ServerLog.failure(
                    'обновление {} не запустилось, программа вернулась к {}: {}'.format(
                        rec['version'], rec['back'] or rec['exe'], rec['reason']
                    )
                )
                # не запустились подряд два обновления (новое и предыдущее) — предупреждение о самом новом из них
                old = conf.get('failed') if isinstance(conf.get('failed'), dict) else {}
                if version.as_tuple(rec['version']) >= version.as_tuple(old.get('version') or '0'):
                    conf['failed'] = rec
            conf['history'] = hist[-self.HISTORY :]
            self._save(conf)
            os.remove(path)
            return conf
        except Exception as exc:  # запись о сбое не должна мешать работе программы
            ServerLog.failure('запись о неудачном обновлении не прочитана', exc)
            return None

    def writable(self) -> bool:
        """Можно ли писать рядом с программой (пробный файл; update.new не трогается — туда идёт распаковка)."""
        probe = os.path.join(os.path.dirname(self.new), f'.kp-write-probe-{os.getpid()}')
        try:
            with open(probe, 'w') as handle:
                handle.write('1')
            os.remove(probe)
            return True
        except OSError:
            return False

    def configure(self, data, author: str) -> dict:
        conf = self.settings()
        if 'repo' in data:
            ReleaseSource(str(data.get('repo') or '').strip())  # проверка вида «владелец/имя»
            conf['repo'] = str(data['repo']).strip()
        if 'auto' in data:
            conf['auto'] = bool(data['auto'])
        if 'nightly' in data:
            if data.get('nightly') not in NightUpdate.MODES:
                raise UpdateError('Ночные обновления: выключены, только исправления или все версии')
            conf['nightly'] = data['nightly']
        if 'nightHour' in data:
            try:
                hour = int(data.get('nightHour'))
            except (TypeError, ValueError):
                hour = -1
            if not 0 <= hour <= 23:
                raise UpdateError('Час ночного обновления — от 0 до 23')
            conf['nightHour'] = hour
        if 'token' in data:
            keys = self.store.kv_get('integrations') or {}
            token = str(data.get('token') or '').strip()
            if token:
                keys['githubToken'] = token[:300]
            else:
                keys.pop('githubToken', None)
            self.store.kv_set('integrations', keys)
        conf['updatedAt'], conf['updatedBy'] = datetime.now().isoformat(timespec='seconds'), author
        self._save(conf)
        return self.status()

    def source(self) -> 'ReleaseSource':
        return ReleaseSource(self.settings().get('repo') or self.REPO, self.token())

    def check(self) -> dict:
        conf = self.settings()
        try:
            rel = self.source().latest()
            rel['at'] = datetime.now().isoformat(timespec='seconds')
            conf['last'] = rel
        except UpdateError as exc:
            conf['last'] = dict(conf.get('last') or {}, at=datetime.now().isoformat(timespec='seconds'), error=str(exc))
            self._save(conf)
            raise
        self._save(conf)
        return self.status()

    def auto_check(self) -> None:
        """Раз в сутки (фоновая задача): проверить, есть ли новая версия (только если включено и задан репозиторий)."""
        conf = self.settings()
        if not conf.get('auto', True):
            return
        last = (conf.get('last') or {}).get('at') or ''
        if last[:10] == datetime.now().strftime('%Y-%m-%d'):
            return
        try:
            self.check()
        except UpdateError:
            pass

    def download_latest(self, author: str) -> dict:
        last = self.settings().get('last') or {}
        if not last.get('asset'):
            raise UpdateError('В выпуске нет архива обновления — сначала «Проверить обновления»')
        return self.install(self.source().download(last['asset']), author, source='GitHub ' + (last.get('tag') or ''))

    def install(self, data, author: str, source='файл', force: bool = False) -> dict:
        pkg = UpdatePackage(data, UpdateSign.keys(self.root))
        cur = self.current()
        if not force and version.as_tuple(pkg.version) <= version.as_tuple(cur):
            raise UpdateError(f'Версия обновления {pkg.version} не новее работающей {cur} — устанавливать нечего')
        if not self.writable():
            raise UpdateError(
                f'Нет прав записи в папку программы {self.root} — запустите обновление файлом «Установить обновление.cmd» '
                'от имени администратора компьютера'
            )
        self._backup_db(pkg.version)
        shutil.rmtree(self.new, ignore_errors=True)
        count = pkg.extract('update', self.new)
        if not os.path.isfile(os.path.join(self.new, 'app', 'kp_server.py')):
            shutil.rmtree(self.new, ignore_errors=True)
            raise UpdateError('Архив распакован не полностью — повторите')
        self._swap_in()
        setup = self._server_setup(pkg)
        shutil.rmtree(self.failed_dir, ignore_errors=True)  # прежнее неудачное обновление больше не нужно
        self._log({'version': pkg.version, 'from': cur, 'by': author, 'source': source, 'files': count}, failed=None)
        return {'version': pkg.version, 'from': cur, 'files': count, 'serverSetup': setup}

    def _backup_db(self, ver) -> None:
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        self.store.backup(os.path.join(self.data_dir, 'backup', f'kp-{stamp}-before-update-{ver}.zip'))

    def _swap_in(self) -> None:
        """update.new → update; прежнее update → update.prev."""
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

    def _server_setup(self, pkg) -> int:
        dst = os.path.join(self.root, 'server-setup')
        if not os.path.isdir(dst) or not pkg.files('server-setup'):
            return 0
        try:
            return pkg.extract('server-setup', dst)
        except OSError:
            return 0

    def rollback(self, author: str) -> dict:
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
        self._log({'version': back, 'from': cur, 'by': author, 'source': 'откат'})
        return {'version': back}

    def remove(self, author: str) -> dict:
        """Убрать установленное обновление — после перезапуска работает версия, встроенная в EXE."""
        if not os.path.isdir(self.dir):
            raise UpdateError('Обновление не установлено — работает версия программы (EXE)')
        shutil.rmtree(self.prev, ignore_errors=True)
        os.replace(self.dir, self.prev)
        self._log({'version': 'EXE', 'from': self.current(), 'by': author, 'source': 'обновление убрано'})
        return {'ok': True}

    def _log(self, rec, **extra) -> None:
        ServerLog.note(
            'Обновления: {} → {} ({}{})'.format(
                rec.get('from') or '',
                rec.get('version') or '',
                rec.get('source') or '',
                ', ' + rec['by'] if rec.get('by') else '',
            )
        )
        conf = self.settings()
        hist = conf.get('history') if isinstance(conf.get('history'), list) else []
        hist.append(dict(rec, at=datetime.now().isoformat(timespec='seconds')))
        conf['history'] = hist[-self.HISTORY :]
        for k, v in extra.items():  # failed=None — новая установка: прежнее предупреждение о сбое снимается
            if v is None:
                conf.pop(k, None)
            else:
                conf[k] = v
        self._save(conf)


class Restarter:
    """Перезапуск программы: вспомогательный процесс ждёт закрытия и запускает её снова."""

    TASK = 'Конструктор КП — сервер отдела'
    DELAY = 3

    def __init__(self, server_mode) -> None:
        self.server_mode = server_mode

    def _task_exists(self) -> bool:
        try:
            return (
                subprocess.run(
                    ['schtasks', '/Query', '/TN', self.TASK], check=False, capture_output=True, timeout=15
                ).returncode
                == 0
            )
        except (OSError, subprocess.SubprocessError):
            return False

    def command(self) -> list | str:
        """Команда вспомогательного процесса."""
        if os.name == 'nt':
            wait = f'ping -n {self.DELAY + 1} 127.0.0.1 >nul'
            if self.server_mode and self._task_exists():
                return f'cmd.exe /s /c "{wait} & schtasks /Run /TN "{self.TASK}""'
            run = (
                f'"{sys.executable}"'
                if getattr(sys, 'frozen', False)
                else f'"{sys.executable}" "{os.path.abspath(sys.argv[0])}"'
            )
            return f'cmd.exe /s /c "{wait} & start "" {run}"'
        args = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, os.path.abspath(sys.argv[0])]
        return ['sh', '-c', f'sleep {self.DELAY}; exec "$@"', 'kp-restart', *args]

    # новый процесс не наследует _MEI…/_PYI… (папка старого EXE) и KP_UPDATE_* (их ставит launcher.py)
    INHERIT_DROP = ('_MEI', '_PYI', 'PYINSTALLER_', 'KP_UPDATE_', 'KP_BASE_VERSION')

    @classmethod
    def environment(cls, browser=False) -> dict:
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(cls.INHERIT_DROP)}
        env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'  # PyInstaller ≥ 6.10: новый EXE — как запущенный заново
        if browser:
            env.pop('KP_NO_BROWSER', None)
        else:
            env['KP_NO_BROWSER'] = '1'
        return env

    def spawn(self, browser=False) -> None:
        """browser — новый процесс сам откроет браузер (возврат к прежней версии при первом запуске: страницы ещё нет)."""
        env = self.environment(browser)
        cmd = self.command()
        if os.name == 'nt':
            flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            try:
                subprocess.Popen(
                    cmd, env=env, creationflags=flags | 0x01000000, close_fds=True
                )  # + CREATE_BREAKAWAY_FROM_JOB
            except OSError:
                subprocess.Popen(cmd, env=env, creationflags=flags, close_fds=True)
        else:
            subprocess.Popen(
                cmd,
                env=env,
                start_new_session=True,
                close_fds=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
            )

    def restart(self, server) -> None:
        """После ответа на запрос: запустить вспомогательный процесс и закрыть сервер (main() завершает программу)."""

        def launch() -> None:
            self.spawn()
            server.shutdown()

        threading.Timer(0.7, launch).start()


class StartCheck:
    """Самопроверка запуска обновления (патча) и разбор ошибок запуска."""

    PATHS = ('/api/version', '/api/ping', '/')
    TIMEOUT = 60  # медленный компьютер или большая база: не ответил за минуту — не повод откатывать
    ENV_WORDS = (
        'malformed',
        'not a database',
        'disk is full',
        'database is locked',
        'disk i/o error',
        'readonly database',
        'unable to open database',
        'read-only file system',
        'no space left',
    )

    class Failed(Exception):
        """Обновление запустилось, но на свои главные адреса не отвечает как надо."""

    def __init__(self, port, server, ready) -> None:
        self.port, self.server, self.ready, self.error = port, server, ready, ''

    @staticmethod
    def armed() -> bool:
        """Работает обновление (патч), и EXE умеет вернуть прежнюю версию (launcher.py с 3.51)."""
        return bool(os.environ.get('KP_UPDATE_DIR')) and os.environ.get('KP_UPDATE_FALLBACK') == '1'

    @classmethod
    def code_error(cls, exc) -> bool:
        """Ошибка в коде программы, а не в окружении (нет прав, нет места, база повреждена или занята)."""
        if isinstance(exc, PermissionError) or (
            isinstance(exc, OSError) and exc.errno in (errno.ENOSPC, errno.EROFS, errno.EACCES)
        ):
            return False
        if isinstance(exc, (sqlite3.DatabaseError, OSError)):
            return not any(word in str(exc).lower() for word in cls.ENV_WORDS)
        return True

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True, name='start-check').start()

    def _run(self) -> None:
        try:
            for path in self.PATHS:
                self._get(path)
        except self.Failed as exc:
            self.error = f'Самопроверка после запуска: {exc}'
            self.server.shutdown()
            return
        except Exception as exc:  # сама проверка не должна откатывать рабочую версию
            ServerLog.failure('самопроверка запуска не выполнена', exc)
        self.ready()

    def _get(self, path) -> None:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(f'http://127.0.0.1:{self.port}{path}', timeout=self.TIMEOUT) as resp:
                resp.read(1 << 20)
        except urllib.error.HTTPError as exc:
            raise self.Failed(f'{path} — ответ {exc.code}') from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                return
            raise self.Failed(f'{path} — нет ответа ({exc.reason})') from exc
        except TimeoutError:
            return
        except (OSError, ValueError) as exc:
            raise self.Failed(f'{path} — {exc}') from exc


class NightUpdate:
    """Ночное обновление в выбранный час, если программа простаивает (EXE с откатом, launcher.py)."""

    MODES = ('off', 'patch', 'all')
    HOUR = 3  # час по умолчанию
    # окно и тишина — srv.nightWindowH, srv.nightQuietMin
    MIN_EXE = (3, 51, 0)  # EXE с возвратом к прежней версии
    AUTHOR = 'ночное обновление'
    last_write = 0.0  # время последнего изменяющего запроса (kp_server.Handler)

    def __init__(self, updater) -> None:
        self.updater = updater

    @classmethod
    def touch(cls) -> None:
        cls.last_write = time.time()

    @classmethod
    def supported(cls) -> bool:
        """Программа запущена из EXE, который умеет вернуть прежнюю версию (встроенная в EXE версия — 3.51 и новее)."""
        base = os.environ.get('KP_BASE_VERSION') or version.VERSION
        return bool(getattr(sys, 'frozen', False)) and version.as_tuple(base) >= cls.MIN_EXE

    def skip(self, conf, now) -> str:
        """Почему сейчас не ставить ('' — ставить можно)."""
        if (conf.get('nightly') or 'off') == 'off':
            return 'выключено'
        if not self.supported():
            return 'нужен EXE 3.51 и новее'
        hour = int(conf.get('nightHour', self.HOUR))
        if (now.hour - hour) % 24 >= SrvVal.get(self.updater.store, 'srv.nightWindowH'):
            return 'не время'
        if (conf.get('nightLast') or {}).get('night') == self.night(now, hour):
            return 'уже была попытка этой ночью'
        if time.time() - self.last_write < SrvVal.get(self.updater.store, 'srv.nightQuietMin') * 60:
            return 'кто-то работает'
        return ''

    @staticmethod
    def night(now, hour) -> str:
        """Какая это ночь: дата начала окна (окно 23:00–01:00 — одна ночь)."""
        start = now if now.hour >= hour else now - timedelta(days=1)
        return start.strftime('%Y-%m-%d')

    def run(self, restart, now=None) -> dict | None:
        """Раз в полчаса (Background.every): поставить новую версию, если пора; restart — перезапуск программы. → запись или None."""
        now = now or datetime.now()
        conf = self.updater.settings()
        if self.skip(conf, now):
            return None
        rec = {
            'night': self.night(now, int(conf.get('nightHour', self.HOUR))),
            'at': now.isoformat(timespec='seconds'),
            'from': self.updater.current(),
        }
        try:
            status = self.updater.check()
            last, failed = status.get('last') or {}, (self.updater.settings().get('failed') or {})
            last_version, cur = last.get('version') or '', self.updater.current()
            if not status['available']:
                rec['result'] = 'новой версии нет'
            elif failed.get('version') == last_version:
                rec['result'] = f'версия {last_version} уже не запустилась на этом компьютере — ставится только вручную'
            elif (conf.get('nightly') == 'patch') and version.as_tuple(last_version)[:2] != version.as_tuple(cur)[:2]:
                rec['result'] = f'версия {last_version} — не исправление текущей {cur}; её ставят вручную'
            else:
                res = self.updater.download_latest(self.AUTHOR)
                rec.update(
                    result='установлена версия {}, перезапуск'.format(res['version']), version=res['version'], ok=True
                )
        except UpdateError as exc:
            rec.update(result=f'не выполнено: {exc}', error=True)
            ServerLog.failure('ночное обновление', exc)
        conf = self.updater.settings()
        conf['nightLast'] = rec
        self.updater._save(conf)
        if rec.get('ok'):
            from admin_alerts import AdminAlerts

            AdminAlerts.notice(
                self.updater.store,
                'Ночью установлено обновление {} (было {}) — программа перезапустилась'.format(
                    rec['version'], rec['from']
                ),
            )
            ServerLog.note('Ночное обновление: {} → {}'.format(rec['from'], rec['version']))
            restart()
        return rec
