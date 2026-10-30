"""Копии базы, изображений и документов КП во вторую папку (сетевой диск, флешка, облако)."""

import os
import shutil
import threading
import uuid
from datetime import date, datetime

import maintenance
from backup_webdav import DiskFull, WebDavStore
from deal_files import DealFiles
from defaults import SrvVal
from kp_files import KpFiles
from net import Net
from server_log import ErrorText
from storage import DbZip


class MirrorBackup:
    KEEP = 14  # копий во второй папке по умолчанию
    FOLDER = 'folder'
    DAV = 'dav'  # Яндекс Диск или другой WebDAV
    MASK = '••••••'
    KEEP_MAX = 365
    _lock = threading.Lock()  # одна копия за раз (по расписанию и кнопкой)

    def __init__(self, store, data_dir: str) -> None:
        self.store, self.data_dir = store, data_dir

    # ---------- настройка ----------
    def config(self) -> dict:
        conf = (self.store.kv_get('settings') or {}).get('backup2') or {}
        dav = picked if isinstance(picked := conf.get('dav'), dict) else {}
        return {
            'on': bool(conf.get('on')),
            'kind': self.DAV if conf.get('kind') == self.DAV else self.FOLDER,
            'path': str(conf.get('path') or ''),
            'keep': int(conf.get('keep') or self.KEEP),
            'images': bool(conf.get('images')),
            'dav': dav,
        }

    def public(self) -> dict:
        """Настройка для «Настроек»: пароль диска наружу не уходит."""
        conf = self.config()
        dav = dict(conf['dav'])
        dav['password'] = self.MASK if dav.get('password') else ''
        return dict(conf, dav=dav)

    def state(self) -> dict:
        return maintenance.state(self.store).get('backup2') or {}

    def status(self) -> dict:
        conf, state = self.public(), self.state()
        dav = conf['kind'] == self.DAV
        copies = (
            self._copies(conf['path'])
            if not dav and conf['on'] and conf['path'] and os.path.isdir(conf['path'])
            else []
        )
        return dict(
            conf,
            last=state,
            copies=len(copies),
            copiesBytes=sum(x['bytes'] for x in copies),
            newest=copies[0]['date'] if copies else None,
            stale=self.stale(),
            running=self._lock.locked(),
        )

    def start(self) -> dict:
        """Копия в фоне (кнопка «Копировать сейчас»): первая выгрузка изображений по сети может идти минутами."""
        if not self.config()['on']:
            raise ValueError('Вторая папка не включена')
        if self._lock.locked():
            raise ValueError('Копия во вторую папку уже идёт')
        threading.Thread(target=self.run_now, daemon=True, name='backup-mirror').start()
        return dict(self.status(), running=True)

    def save(self, dst: dict, author: str = '') -> dict:
        keep = max(1, min(self.KEEP_MAX, int(dst.get('keep') or self.KEEP)))
        if dst.get('kind') == self.DAV:
            self._dav_allowed()
            dav = WebDavStore.clean(dict(dst.get('dav') or {}, password=self._password(dst)), self.config()['dav'])
            enabled = bool(dst.get('on'))
            if enabled:
                self._dav_check(dav)
            entry = {'on': enabled, 'kind': self.DAV, 'path': '', 'keep': keep, 'images': False, 'dav': dav}
        else:
            path = self._norm(dst.get('path'))
            enabled = bool(dst.get('on')) and bool(path)
            if enabled:
                self.check(path)
            entry = {'on': enabled, 'kind': self.FOLDER, 'path': path, 'keep': keep, 'images': bool(dst.get('images'))}
        settings = self.store.kv_get('settings') or {}
        settings['backup2'] = entry
        settings['backup2At'], settings['backup2By'] = datetime.now().isoformat(timespec='seconds'), author
        self.store.kv_set('settings', settings)
        return self.status()

    def _dav_on(self) -> bool:
        from features import FeatureAccess

        return FeatureAccess(self.store).is_on('davBackup')

    def _dav_allowed(self) -> None:
        if not self._dav_on():
            raise ValueError('Копии на Яндекс Диск выключены («Параметры» → «Функции программы»)')

    def _password(self, dst: dict) -> str:
        password = str((dst.get('dav') or {}).get('password') or '')
        return '' if password == self.MASK else password

    def _norm(self, path) -> str:
        path = str(path or '').strip().strip('"')
        if not path:
            return ''
        if not (os.path.isabs(path) or path.startswith('\\\\')):
            raise ValueError(
                'Укажите полный путь к папке: например D:\\Копии КП, \\\\сервер\\копии или папку Яндекс Диска'
            )
        data = os.path.normcase(os.path.abspath(self.data_dir))
        norm = os.path.normcase(os.path.abspath(path))
        if norm == data or norm.startswith(data + os.sep):
            raise ValueError(
                'Вторая папка не должна быть внутри папки данных программы — выберите другой диск или сетевую папку'
            )
        return path

    def check_any(self, dst: dict) -> dict:
        """«Проверить»: папку или Яндекс Диск из формы (пароль не задан — сохранённый)."""
        if dst.get('kind') != self.DAV:
            return self.check(dst.get('path'))
        self._dav_allowed()
        dav = WebDavStore.clean(dict(dst.get('dav') or {}, password=self._password(dst)), self.config()['dav'])
        return {'ok': True, 'path': 'Яндекс Диск: ' + dav['folder'], 'free': self._dav_check(dav)}

    @staticmethod
    def _dav_check(dav: dict) -> int | None:
        try:
            return WebDavStore(dav).check()
        except Exception as exc:
            raise ValueError('Яндекс Диск недоступен: ' + Net.why(exc)) from exc

    def check(self, path: str | None = None) -> dict:
        """Папка доступна и в неё можно писать → {ok, free}. ValueError — понятным текстом."""
        path = self._norm(path if path is not None else self.config()['path'])
        if not path:
            raise ValueError('Папка не указана')
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as exc:
            raise ValueError(f'Папка недоступна: {path} ({exc.strerror or exc})') from exc
        probe = os.path.join(path, f'.kp-check-{uuid.uuid4().hex[:8]}.tmp')
        try:
            with open(probe, 'wb') as file:
                file.write(b'ok')
            os.remove(probe)
        except OSError as exc:
            raise ValueError(
                f'В папку нельзя записать: {path} ({exc.strerror or exc}). Если программа работает службой — у её учётной записи должен быть доступ.'
            ) from exc
        try:
            free = shutil.disk_usage(path).free
        except OSError:
            free = None
        return {'ok': True, 'path': path, 'free': free}

    # ---------- копирование ----------
    @staticmethod
    def _copies(path: str):
        return maintenance.DbCopy.listing(path)

    def run(self) -> dict | None:
        """Копия за сегодня во вторую папку (если включено). → состояние или None (выключено)."""
        return self._locked(self._today_copy)

    def run_now(self) -> dict | None:
        """«Копировать сейчас»: свежая копия базы — и во вторую папку."""
        return self._locked(self._new_copy)

    def _locked(self, source) -> dict | None:
        conf = self.config()
        if not conf['on'] or not (conf['path'] or conf['kind'] == self.DAV):
            return None
        if conf['kind'] == self.DAV and not self._dav_on():
            return None
        if not self._lock.acquire(blocking=False):
            return None
        try:
            return self._run(conf, source)
        finally:
            self._lock.release()

    def _today_copy(self, auto: str, today: str) -> str:
        src = self._today(auto, today)
        if not src:
            maintenance.DbCopy.daily(self.store, self.data_dir)
            src = self._today(auto, today)
        return src

    def _new_copy(self, auto: str, today: str) -> str:
        maintenance.DbCopy.now(self.store, self.data_dir)
        return self._today(auto, today)

    def _run_dav(self, conf: dict, source) -> dict:
        """Копия на Яндекс Диск: архив проверяется здесь, загружается, размер на диске сверяется; лишние старые удаляются."""
        today = date.today().isoformat()
        rec = {
            'at': datetime.now().isoformat(timespec='seconds'),
            'path': 'Яндекс Диск: ' + conf['dav'].get('folder', ''),
        }
        try:
            src = source(maintenance.auto_dir(self.data_dir), today)
            if not src or not DbZip.is_zip(src):
                raise RuntimeError('нет сегодняшнего архива базы в data\\backup\\auto')
            self._verify_zip(src)
            disk = WebDavStore(conf['dav'])
            disk.ensure()
            rec.update(ok=True, file=os.path.basename(src), bytes=self._dav_put(disk, src, conf['keep']))
            disk.prune(conf['keep'])
        except Exception as exc:
            rec.update(ok=False, error=Net.why(exc) if not isinstance(exc, RuntimeError) else ErrorText.of(exc)[:300])
        maintenance._save(self.store, backup2=rec)
        return rec

    @staticmethod
    def _dav_put(disk: WebDavStore, src: str, keep: int) -> int:
        """Нет места — сначала удаляются старые копии сверх «Хранить» (одна остаётся), затем ещё одна попытка."""
        try:
            return disk.put(src)
        except DiskFull:
            disk.prune(max(keep - 1, 1))
            return disk.put(src)

    def _run(self, conf: dict, source) -> dict:
        if conf['kind'] == self.DAV:
            return self._run_dav(conf, source)
        today = date.today().isoformat()
        rec = {'at': datetime.now().isoformat(timespec='seconds'), 'path': conf['path']}
        try:
            self.check(conf['path'])
            auto = maintenance.auto_dir(self.data_dir)
            src = source(auto, today)
            if not src:
                raise RuntimeError('нет сегодняшней копии базы в data\\backup\\auto')
            dst = os.path.join(conf['path'], os.path.basename(src))
            tmp = dst + '.part'
            try:
                shutil.copyfile(src, tmp)
                if os.path.getsize(tmp) != os.path.getsize(src):
                    raise RuntimeError('копия записалась не полностью')
                (self._verify_zip if DbZip.is_zip(src) else self._verify_db)(tmp)
                os.replace(tmp, dst)
            finally:
                if os.path.exists(tmp):  # не записалась или не прошла проверку — недописанный файл не оставлять
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
            for x in self._copies(conf['path']):  # та же дата в прежнем виде (без сжатия) — заменена архивом
                if x['date'] == today:
                    for name in x['files']:
                        if name != dst and os.path.isfile(name):
                            os.remove(name)
            rec.update(ok=True, file=dst, bytes=os.path.getsize(dst))
            for old in self._copies(conf['path'])[conf['keep'] :]:
                for name in old['files']:
                    try:
                        os.remove(name)
                    except OSError:
                        pass
            if conf['images']:
                rec['images'] = self._images(os.path.join(conf['path'], 'img'))
            # справочные документы — всегда: заново их не получить
            rec['kpFiles'] = self._kp_files(os.path.join(conf['path'], KpFiles.FOLDER))
            rec['dealFiles'] = self._files(DealFiles.FOLDER, os.path.join(conf['path'], DealFiles.FOLDER))
        except Exception as exc:
            rec.update(ok=False, error=ErrorText.of(exc)[:300])
        maintenance._save(self.store, backup2=rec)
        return rec

    @staticmethod
    def _today(auto: str, today: str) -> str:
        """Сегодняшняя копия в data/backup/auto: архив ZIP или прежняя копия без сжатия; нет — ''."""
        for x in maintenance.DbCopy.listing(auto):
            if x['date'] == today:
                return x['file']
        return ''

    @staticmethod
    def _verify_zip(path: str) -> None:
        """Записанный во вторую папку архив читается — по контрольным суммам."""
        try:
            DbZip.verify(path)
        except ValueError as exc:
            raise RuntimeError(f'копия не прошла проверку: {exc}') from exc

    @staticmethod
    def _verify_db(path: str) -> None:
        """Записанный во вторую папку файл базы читается — проверка SQLite."""
        res = DbZip.quick_check(path)
        if res != 'ok':
            raise RuntimeError('копия не прошла проверку: ' + res)

    def _images(self, dst_root: str) -> int:
        """Изображения каталога (без папки unused): только новые и изменённые (по размеру) файлы."""
        return self._sync(
            os.path.join(self.data_dir, 'img'),
            dst_root,
            lambda name: name.lower().endswith(maintenance.IMG_EXTS),
            skip_top='unused',
        )

    def _kp_files(self, dst_root: str) -> int:
        """Справочные документы КП: только новые, без недописанных .part и посторонних файлов."""
        return self._files(KpFiles.FOLDER, dst_root)

    def _files(self, folder: str, dst_root: str) -> int:
        """Документы КП или сделок (папка folder): только новые, без недописанных .part и посторонних файлов."""
        return self._sync(os.path.join(self.data_dir, folder), dst_root, KpFiles.DISK.match, copy=self._copy_atomic)

    @staticmethod
    def _copy_atomic(src: str, dst: str) -> None:
        """Через .part: недописанный файл не выглядит готовым."""
        shutil.copyfile(src, dst + '.part')
        os.replace(dst + '.part', dst)

    @staticmethod
    def _sync(src_root, dst_root, accept, skip_top=None, copy=shutil.copyfile):
        """Досылка файлов папки: копируются нет во второй папке или другого размера."""
        copied = total = 0
        for folder, _, files in os.walk(src_root):
            if skip_top and os.path.relpath(folder, src_root).split(os.sep)[0] == skip_top:
                continue
            for name in files:
                if not accept(name):
                    continue
                total += 1
                src = os.path.join(folder, name)
                dst = os.path.join(dst_root, os.path.relpath(src, src_root))
                if os.path.isfile(dst) and os.path.getsize(dst) == os.path.getsize(src):
                    continue
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                copy(src, dst)
                copied += 1
        return {'total': total, 'copied': copied}

    def stale(self) -> bool:
        """Включено, но последняя удачная копия старше srv.mirrorStaleDays дней (или её нет; «Значения программы»)."""
        conf, state = self.config(), self.state()
        if not conf['on']:
            return False
        if not state.get('ok'):
            return True
        try:
            return (datetime.now() - datetime.fromisoformat(state['at'])).days >= SrvVal.get(
                self.store, 'srv.mirrorStaleDays'
            )
        except (KeyError, ValueError):
            return True
