# -*- coding: utf-8 -*-
"""Копии базы во второе место: сетевой диск, флешка, папка облака (Яндекс Диск, OneDrive) — на случай,
если откажет диск компьютера с программой (тогда пропадут и база, и копии рядом с ней в data/backup).

Каждый день после обычной копии (maintenance.DbCopy.daily) архив kp-ГГГГ-ММ-ДД.zip копируется во вторую папку
и проверяется (контрольные суммы архива; прежние копии без сжатия .sqlite3 — встроенной проверкой SQLite); там хранится
столько последних копий, сколько задано. По желанию туда же досылаются изображения каталога (только новые и изменённые
файлы). Настройка — kv settings.backup2, состояние — kv maint.backup2.
"""
import os
import shutil
import threading
import uuid
from datetime import date, datetime

import maintenance
from storage import DbZip


class MirrorBackup:
    KEEP = 14                  # копий во второй папке по умолчанию
    KEEP_MAX = 365
    STALE_DAYS = 2             # «Требует внимания», если последней копии во второй папке больше двух дней
    _lock = threading.Lock()   # одна копия за раз (по расписанию и кнопкой)

    def __init__(self, store, data_dir):
        self.store, self.data_dir = store, data_dir

    # ---------- настройка ----------
    def config(self):
        c = (self.store.kv_get('settings') or {}).get('backup2') or {}
        return {'on': bool(c.get('on')), 'path': str(c.get('path') or ''), 'keep': int(c.get('keep') or self.KEEP),
                'images': bool(c.get('images'))}

    def state(self):
        return maintenance.state(self.store).get('backup2') or {}

    def status(self):
        c, s = self.config(), self.state()
        copies = self._copies(c['path']) if c['on'] and c['path'] and os.path.isdir(c['path']) else []
        return dict(c, last=s, copies=len(copies), copiesBytes=sum(x['bytes'] for x in copies),
                    newest=copies[0]['date'] if copies else None, stale=self.stale(), running=self._lock.locked())

    def start(self):
        """Копия в фоне (кнопка «Копировать сейчас»): первая выгрузка изображений по сети может идти минутами."""
        if not self.config()['on']:
            raise ValueError('Вторая папка не включена')
        if self._lock.locked():
            raise ValueError('Копия во вторую папку уже идёт')
        threading.Thread(target=self.run, kwargs={'force': True}, daemon=True, name='backup-mirror').start()
        return dict(self.status(), running=True)

    def save(self, d, by=''):
        path = self._norm(d.get('path'))
        on = bool(d.get('on')) and bool(path)
        if on:
            self.check(path)
        keep = max(1, min(self.KEEP_MAX, int(d.get('keep') or self.KEEP)))
        st = self.store.kv_get('settings') or {}
        st['backup2'] = {'on': on, 'path': path, 'keep': keep, 'images': bool(d.get('images'))}
        st['backup2At'], st['backup2By'] = datetime.now().isoformat(timespec='seconds'), by
        self.store.kv_set('settings', st)
        return self.status()

    def _norm(self, path):
        path = str(path or '').strip().strip('"')
        if not path:
            return ''
        if not (os.path.isabs(path) or path.startswith('\\\\')):
            raise ValueError('Укажите полный путь к папке: например D:\\Копии КП, \\\\сервер\\копии или папку Яндекс Диска')
        data = os.path.normcase(os.path.abspath(self.data_dir))
        p = os.path.normcase(os.path.abspath(path))
        if p == data or p.startswith(data + os.sep):
            raise ValueError('Вторая папка не должна быть внутри папки данных программы — выберите другой диск или сетевую папку')
        return path

    def check(self, path=None):
        """Папка доступна и в неё можно писать → {ok, free}. ValueError — понятным текстом."""
        path = self._norm(path if path is not None else self.config()['path'])
        if not path:
            raise ValueError('Папка не указана')
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as e:
            raise ValueError('Папка недоступна: %s (%s)' % (path, e.strerror or e))
        probe = os.path.join(path, '.kp-check-%s.tmp' % uuid.uuid4().hex[:8])
        try:
            with open(probe, 'wb') as f:
                f.write(b'ok')
            os.remove(probe)
        except OSError as e:
            raise ValueError('В папку нельзя записать: %s (%s). Если программа работает службой — у её учётной записи должен быть доступ.'
                             % (path, e.strerror or e))
        try:
            free = shutil.disk_usage(path).free
        except OSError:
            free = None
        return {'ok': True, 'path': path, 'free': free}

    # ---------- копирование ----------
    @staticmethod
    def _copies(path):
        return maintenance.DbCopy.listing(path)

    def run(self, force=False):
        """Копия за сегодня во вторую папку (если включено). → состояние или None (выключено)."""
        c = self.config()
        if not c['on'] or not c['path']:
            return None
        if not self._lock.acquire(blocking=False):
            return None
        try:
            return self._run(c, force)
        finally:
            self._lock.release()

    def _run(self, c, force):
        today = date.today().isoformat()
        rec = {'at': datetime.now().isoformat(timespec='seconds'), 'path': c['path']}
        try:
            self.check(c['path'])
            auto = maintenance.auto_dir(self.data_dir)
            src = self._today(auto, today)
            if not src or force:
                maintenance.DbCopy.daily(self.store, self.data_dir, force=force)
                src = self._today(auto, today)
            if not src:
                raise RuntimeError('нет сегодняшней копии базы в data\\backup\\auto')
            dst = os.path.join(c['path'], os.path.basename(src))
            tmp = dst + '.part'
            try:
                shutil.copyfile(src, tmp)
                if os.path.getsize(tmp) != os.path.getsize(src):
                    raise RuntimeError('копия записалась не полностью')
                self._verify(tmp, DbZip.is_zip(src))
                os.replace(tmp, dst)
            finally:
                if os.path.exists(tmp):          # не записалась или не прошла проверку — недописанный файл не оставлять
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
            for x in self._copies(c['path']):        # та же дата в прежнем виде (без сжатия) — заменена архивом
                if x['date'] == today:
                    for f in x['files']:
                        if f != dst and os.path.isfile(f):
                            os.remove(f)
            rec.update(ok=True, file=dst, bytes=os.path.getsize(dst))
            for old in self._copies(c['path'])[c['keep']:]:
                for f in old['files']:
                    try:
                        os.remove(f)
                    except OSError:
                        pass
            if c['images']:
                rec['images'] = self._images(os.path.join(c['path'], 'img'))
        except Exception as e:
            rec.update(ok=False, error=str(e)[:300])
        maintenance._save(self.store, backup2=rec)
        return rec

    @staticmethod
    def _today(auto, today):
        """Сегодняшняя копия в data/backup/auto: архив ZIP или прежняя копия без сжатия; нет — ''."""
        for x in maintenance.DbCopy.listing(auto):
            if x['date'] == today:
                return x['file']
        return ''

    @staticmethod
    def _verify(path, is_zip):
        """Записанная во вторую папку копия читается: архив — по контрольным суммам, файл базы — проверкой SQLite."""
        if is_zip:
            try:
                DbZip.verify(path)
            except ValueError as e:
                raise RuntimeError('копия не прошла проверку: %s' % e)
            return
        res = DbZip.integrity(path, quick=True)
        if res != 'ok':
            raise RuntimeError('копия не прошла проверку: ' + res)

    def _images(self, dst_root):
        """Изображения каталога: только новые и изменённые (по размеру) файлы."""
        src_root = os.path.join(self.data_dir, 'img')
        copied = total = 0
        for dp, dn, fn in os.walk(src_root):
            if os.path.relpath(dp, src_root).split(os.sep)[0] == 'unused':
                continue
            for name in fn:
                if not name.lower().endswith(maintenance.IMG_EXTS):
                    continue
                total += 1
                s = os.path.join(dp, name)
                d = os.path.join(dst_root, os.path.relpath(s, src_root))
                if os.path.isfile(d) and os.path.getsize(d) == os.path.getsize(s):
                    continue
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copyfile(s, d)
                copied += 1
        return {'total': total, 'copied': copied}

    def stale(self):
        """Включено, но последняя удачная копия старше STALE_DAYS дней (или её нет)."""
        c, s = self.config(), self.state()
        if not c['on']:
            return False
        if not s.get('ok'):
            return True
        try:
            return (datetime.now() - datetime.fromisoformat(s['at'])).days >= self.STALE_DAYS
        except (KeyError, ValueError):
            return True
