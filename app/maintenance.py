"""Обслуживание базы: ежедневные копии (DbCopy), журнал действий, сжатие, изображения, кэш, фоновые задачи."""

import gzip
import json
import os
import re
import threading
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

from defaults import SrvVal
from server_log import ErrorText, ServerLog
from storage import DbZip

NIGHT_END = 6
NIGHT_START = 22

AUDIT_YEARS = 2  # по умолчанию; своё — kv settings.auditYears
IMG_RX = re.compile(r'/img/([^"\\?#\s<>]+?\.(?:jpg|jpeg|png|webp|pdf))', re.I)
IMG_EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.pdf')  # .pdf — буклет окраски станции


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def state(store) -> dict:
    return store.kv_get('maint') or {}


def _save(store, **parts) -> dict:
    with store.lock:  # копия, проверка и сжатие пишут сюда из разных потоков
        state_data = state(store)
        state_data.update(parts)
        store.kv_set('maint', state_data)
    return state_data


def auto_dir(data_dir: str) -> str:
    return os.path.join(data_dir, 'backup', 'auto')


class DbCopy:
    """Ежедневные копии базы в data/backup/auto (ZIP), хранение по дням, неделям и месяцам."""

    NAME_RE = re.compile(r'^kp-(\d{4}-\d{2}-\d{2})\.(zip|sqlite3)$')
    OLD_RX = re.compile(r'^kp-.+\.sqlite3$')  # копии без сжатия: ежедневные и «перед изменением» (обновление, импорт…)
    # временные файлы копий, выгрузки и загрузки базы: остаются, если программу закрыли посреди копирования
    TMP_RX = re.compile(
        r'^(?:kp-.+\.zip\.(?:tmp|part)|export-[0-9a-f]+\.zip(?:\.tmp|\.part)?|import-[0-9a-f]+\.sqlite3)(?:-wal|-shm|-journal)?$'
    )
    TMP_AGE = 3600  # временный файл старше часа — остаток прерванной операции
    PAUSE = 0.3  # пауза между перепаковками — сервер не нагружается подряд
    LOCK = threading.Lock()  # одна копия за раз: плановая и «Создать копию сейчас» не пишут один файл

    @classmethod
    def listing(cls, folder: str) -> list:
        """Ежедневные копии в папке, новые первыми: по одной записи на дату (file — ZIP, если есть; files — все файлы даты)."""
        by_date: dict = {}
        if folder and os.path.isdir(folder):
            for name in os.listdir(folder):
                match = cls.NAME_RE.match(name)
                if not match:
                    continue
                path = os.path.join(folder, name)
                try:
                    size = os.path.getsize(path)
                except OSError:
                    continue
                rec = by_date.setdefault(
                    match.group(1), {'date': match.group(1), 'file': path, 'bytes': 0, 'zip': False, 'files': []}
                )
                rec['files'].append(path)
                rec['bytes'] += size
                if match.group(2) == 'zip':
                    rec['file'], rec['zip'] = path, True
        return sorted(by_date.values(), key=lambda x: x['date'], reverse=True)

    @staticmethod
    def keep_set(dates, store=None) -> set:
        """Какие копии оставить: последние дни, по одной за недели и месяцы (числа — «Значения программы»)."""
        daily, weekly, monthly = (
            SrvVal.get(store, k) for k in ('srv.backupDaily', 'srv.backupWeekly', 'srv.backupMonthly')
        )
        days = sorted(set(dates), reverse=True)
        keep = set(days[:daily])
        weeks: dict = {}
        months: dict = {}
        for day_text in days:
            day = date.fromisoformat(day_text)
            weeks.setdefault(day.isocalendar()[:2], day_text)
            months.setdefault((day.year, day.month), day_text)
        keep |= set(list(weeks.values())[:weekly])
        keep |= set(list(months.values())[:monthly])
        return keep

    @classmethod
    def daily(cls, store, data_dir: str) -> dict | None:
        """Копия за сегодня, если её ещё нет → запись о копии."""
        with cls.LOCK:
            today = date.today().isoformat()
            if any(x['date'] == today for x in cls.listing(auto_dir(data_dir))):
                return state(store).get('backup')
            return cls._copy(store, data_dir)

    @classmethod
    def now(cls, store, data_dir: str) -> dict:
        """Копия сейчас («Создать копию»): прежняя копия за сегодня заменяется."""
        with cls.LOCK:
            return cls._copy(store, data_dir)

    @classmethod
    def _copy(cls, store, data_dir: str) -> dict:
        """Копия, проверенная до и после сжатия; затем ротация → запись о копии."""
        today = date.today().isoformat()
        folder = auto_dir(data_dir)
        have = [x for x in cls.listing(folder) if x['date'] == today]
        dst = os.path.join(folder, f'kp-{today}.zip')
        rec: dict[str, Any] = {'at': _now(), 'file': dst}
        try:
            store.backup_checked(dst)
            for x in have:  # прежняя копия за сегодня (например, без сжатия) — заменена архивом
                for name in x['files']:
                    if name != dst and os.path.isfile(name):
                        os.remove(name)
            rec.update(ok=True, bytes=os.path.getsize(dst), db=db_size(store), zip=True)
        except Exception as exc:
            rec.update(ok=False, error=ErrorText.of(exc)[:300])
        cls.rotate(folder, store=store)
        _save(store, backup=rec)
        return rec

    @classmethod
    def sweep(cls, folder: str, age=None) -> int:
        """Удалить остатки прерванных копий, выгрузок и загрузок базы (временные файлы старше часа). → сколько удалено."""
        count = 0
        edge = time.time() - (cls.TMP_AGE if age is None else age)
        if folder and os.path.isdir(folder):
            for name in os.listdir(folder):
                path = os.path.join(folder, name)
                try:
                    if cls.TMP_RX.match(name) and os.path.isfile(path) and os.path.getmtime(path) < edge:
                        os.remove(path)
                        count += 1
                except OSError:
                    pass
        return count

    @classmethod
    def rotate(cls, folder: str, keep=None, store=None) -> None:
        """Удалить копии, которые не нужно хранить (все файлы их даты), и остатки прерванных копий."""
        cls.sweep(folder)
        lst = cls.listing(folder)
        keep = cls.keep_set([backup['date'] for backup in lst], store) if keep is None else keep
        for backup in lst:
            if backup['date'] not in keep:
                for name in backup['files']:
                    try:
                        os.remove(name)
                    except OSError:
                        pass

    @classmethod
    def compress_old(cls, store, data_dir: str, log=print) -> dict | None:
        """Копии без сжатия → ZIP рядом; исходный файл удаляется после проверки архива."""
        count = saved = 0
        for folder in (auto_dir(data_dir), os.path.join(data_dir, 'backup')):
            if not os.path.isdir(folder):
                continue
            cls.sweep(folder)
            for name in sorted(os.listdir(folder)):
                src = os.path.join(folder, name)
                dst = src[: -len('.sqlite3')] + '.zip'
                if not cls.OLD_RX.match(name) or not os.path.isfile(src) or os.path.exists(dst):
                    continue
                try:
                    before = os.path.getsize(src)
                    DbZip.pack(src, dst)
                    os.remove(src)
                    for ext in ('-wal', '-shm', '-journal'):
                        if os.path.exists(src + ext):
                            os.remove(src + ext)
                    count += 1
                    saved += before - os.path.getsize(dst)
                except Exception as exc:
                    log(f'Копия {name} не сжата: {exc}')
                time.sleep(cls.PAUSE)
        if not count:
            return None
        state_data = state(store).get('compressed') or {}
        rec = {
            'at': _now(),
            'files': int(state_data.get('files') or 0) + count,
            'saved': int(state_data.get('saved') or 0) + saved,
        }
        _save(store, compressed=rec)
        return rec

    @staticmethod
    def others(data_dir: str) -> dict:
        """Копии «перед изменением» в data/backup (обновление программы, импорт, сборка каталога…): сколько и сколько места."""
        folder = os.path.join(data_dir, 'backup')
        count = size = 0
        if os.path.isdir(folder):
            for name in os.listdir(folder):
                path = os.path.join(folder, name)
                if name.startswith('kp-') and name.endswith(('.zip', '.sqlite3')) and os.path.isfile(path):
                    count += 1
                    size += os.path.getsize(path)
        return {'count': count, 'bytes': size}


def archive_audit(store, data_dir: str, years=None) -> int:
    """Записи журнала действий старше years лет — в архив data/backup/audit-archive/audit-ГГГГ.jsonl.gz, из базы удаляются."""
    years = years or int((store.kv_get('settings') or {}).get('auditYears') or AUDIT_YEARS)
    edge = (datetime.now() - timedelta(days=365 * years)).isoformat(timespec='seconds')
    cols = (
        'id',
        'ts',
        'user_id',
        'user_name',
        'role',
        'action',
        'entity_type',
        'entity_id',
        'before',
        'after',
        'ip',
        'ua',
        'result',
    )
    rows = store.all('SELECT {} FROM audit WHERE ts < ? ORDER BY id'.format(', '.join(cols)), (edge,))
    if not rows:
        return 0
    folder = os.path.join(data_dir, 'backup', 'audit-archive')
    os.makedirs(folder, exist_ok=True)
    by_year: dict = {}
    for row in rows:
        by_year.setdefault(str(row[1])[:4] or 'unknown', []).append(dict(zip(cols, row, strict=False)))
    for y, recs in by_year.items():
        with gzip.open(os.path.join(folder, f'audit-{y}.jsonl.gz'), 'at', encoding='utf-8') as handle:
            for x in recs:
                handle.write(json.dumps(x, ensure_ascii=False) + '\n')
    store.write('DELETE FROM audit WHERE ts < ? AND id <= ?', (edge, rows[-1][0]))
    state_data = state(store)
    _save(
        store,
        audit={
            'at': _now(),
            'archived': int((state_data.get('audit') or {}).get('archived') or 0) + len(rows),
            'dir': folder,
            'years': years,
        },
    )
    return len(rows)


def purge_checks(store) -> int:
    edge = (datetime.now() - timedelta(days=SrvVal.get(store, 'srv.checksDays'))).isoformat(timespec='seconds')
    count = store.scalar('SELECT COUNT(*) FROM checks WHERE checked < ?', (edge,))
    if count:
        store.write('DELETE FROM checks WHERE checked < ?', (edge,))
    return count


def db_maintenance(store, vacuum=None) -> dict:
    """Сброс журнала WAL в базу, обновление статистики запросов; раз в месяц (или по кнопке) — сжатие и проверка."""
    state_data = state(store)
    last = (state_data.get('vacuum') or {}).get('at') or ''
    if vacuum is None:  # само — только ночью: сжатие держит запись в базу (десятки секунд на большой базе)
        night = datetime.now().hour < NIGHT_END or datetime.now().hour >= NIGHT_START
        vacuum = night and (
            not last
            or last
            < (datetime.now() - timedelta(days=SrvVal.get(store, 'srv.vacuumDays'))).isoformat(timespec='seconds')
        )
    size0 = db_size(store)
    rec = {}
    with store.lock:
        conn = store.conn()
        conn.commit()
        if vacuum:
            conn.execute('VACUUM')
        conn.execute('PRAGMA optimize')
        conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    if vacuum:
        rec['vacuum'] = {
            'at': _now(),
            'before': size0,
            'after': db_size(store),
            'check': DbZip.quick_check(store.path),
        }
    rec['optimize'] = {'at': _now(), 'bytes': db_size(store)}
    _save(store, **rec)
    return rec


def db_size(store) -> int:
    return sum(os.path.getsize(store.path + suffix) for suffix in ('', '-wal') if os.path.isfile(store.path + suffix))


def _referenced(store) -> set:
    refs = set()
    for (table,) in store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        cols = [
            column[1]
            for column in store.all(f'PRAGMA table_info({store.ident(table)})')
            if (column[2] or '').upper() in ('TEXT', '')
        ]
        for col in cols:
            name, field = store.ident(table), store.ident(col)
            for (v,) in store.all(f'SELECT {field} FROM {name} WHERE {field} LIKE ?', ('%/img/%',)):
                for match in IMG_RX.finditer(str(v)):
                    refs.add(match.group(1).replace('\\/', '/'))
    return refs


def unused_images(store, img_dir: str) -> list:
    """Файлы data/img, на которые нигде в базе нет ссылок (и старше месяца — srv.imgUnusedDays), плюс всё из папки unused."""
    refs = _referenced(store)
    edge = (datetime.now() - timedelta(days=SrvVal.get(store, 'srv.imgUnusedDays'))).timestamp()
    out = []
    root = os.path.abspath(img_dir)
    for dir_path, _dirs, files in os.walk(root):
        for name in files:
            if os.path.splitext(name)[1].lower() not in IMG_EXTS:
                continue
            path = os.path.join(dir_path, name)
            rel = os.path.relpath(path, root).replace(os.sep, '/')
            if rel in refs:
                continue
            if not rel.startswith('unused/') and os.path.getmtime(path) > edge:
                continue
            out.append({'rel': rel, 'bytes': os.path.getsize(path)})
    return out


def purge_images(store, img_dir: str, images=None) -> dict:
    lst = unused_images(store, img_dir)
    count = size = 0
    for x in lst:
        try:
            path = os.path.join(img_dir, *x['rel'].split('/'))
            os.remove(path)
            count += 1
            size += x['bytes']
        except OSError:
            pass
    if images is not None:
        images.index = None  # индекс одинаковых изображений построится заново
    _save(store, images={'at': _now(), 'deleted': count, 'bytes': size})
    return {'deleted': count, 'bytes': size}


class DbHealthRun:
    """Еженедельная проверка «здоровья» базы (db_health.DbHealth) — папка готовых КП из настроек программы."""

    @staticmethod
    def weekly(store) -> dict | None:
        import config
        from db_health import DbHealth

        return DbHealth(store, config.DATA_DIR, config.DOCS_DIR).weekly()

    @staticmethod
    def nightly(store, data_dir: str) -> dict | None:
        from db_health import NightCheck

        return NightCheck.scheduled(store, data_dir)


class Background:
    """Фоновые задачи сервера: плановое обслуживание базы (при запуске и раз в сутки) и задачи по расписанию."""

    LOCK = threading.Lock()  # плановое обслуживание — одно за раз

    @classmethod
    def run(cls, store, data_dir: str) -> None:
        """Плановое обслуживание: копии, вторая папка, журналы, корзина, неиспользуемые файлы, сжатие базы."""
        if not cls.LOCK.acquire(blocking=False):
            return
        try:
            from backup_mirror import MirrorBackup
            from kp_files import KpFiles

            for name, func in (
                ('копия базы', lambda: DbCopy.daily(store, data_dir)),
                ('копия во вторую папку', lambda: MirrorBackup(store, data_dir).run()),
                ('сжатие прежних копий', lambda: DbCopy.compress_old(store, data_dir, ServerLog.failure)),
                ('архив журнала действий', lambda: archive_audit(store, data_dir)),
                ('кэш проверок', lambda: purge_checks(store)),
                ('документы КП, удалённых навсегда', lambda: KpFiles(store, data_dir).purge()),
                ('обслуживание базы', lambda: db_maintenance(store)),
                ('проверка базы', lambda: DbHealthRun.weekly(store)),
                ('ночная проверка базы', lambda: DbHealthRun.nightly(store, data_dir)),
            ):
                try:
                    func()
                except Exception as exc:
                    ServerLog.failure(f'обслуживание ({name})', exc)
            _save(store, lastRun=_now())
        finally:
            cls.LOCK.release()

    @classmethod
    def daily(cls, store, data_dir: str) -> threading.Thread:
        """Раз в час проверяем, не наступил ли новый день: сервер отдела может работать неделями без перезапуска."""

        def loop() -> None:
            event = threading.Event()
            while not event.wait(3600):
                if (state(store).get('lastRun') or '')[:10] != date.today().isoformat():
                    cls.run(store, data_dir)

        thread = threading.Thread(target=loop, daemon=True, name='maintenance')
        thread.start()
        return thread

    @staticmethod
    def every(seconds: float | Callable[[], float], func, name) -> threading.Thread:
        """Задача раз в seconds секунд (первый запуск — через минуту после старта); name — для журнала сервера."""

        def loop() -> None:
            event = threading.Event()
            wait = 60
            while not event.wait(wait):
                try:
                    wait = max(60, int(seconds() if callable(seconds) else seconds))
                except Exception:
                    wait = 3600
                try:
                    func()
                except Exception as exc:
                    ServerLog.failure(f'фоновая задача «{name}»', exc)

        table = threading.Thread(target=loop, daemon=True, name=f'every-{name[:40]}')
        table.start()
        return table


def summary(store, data_dir: str) -> dict:
    state_data = state(store)
    backups = DbCopy.listing(auto_dir(data_dir))
    return {
        'backup': state_data.get('backup'),
        'copies': len(backups),
        'copiesBytes': sum(backup['bytes'] for backup in backups),
        'dir': auto_dir(data_dir),
        'others': DbCopy.others(data_dir),
        'compressed': state_data.get('compressed'),
        'dbBytes': db_size(store),
        'oldest': backups[-1]['date'] if backups else None,
        'audit': state_data.get('audit'),
        'vacuum': state_data.get('vacuum'),
        'optimize': state_data.get('optimize'),
        'images': state_data.get('images'),
        'lastRun': state_data.get('lastRun'),
        'auditYears': int((store.kv_get('settings') or {}).get('auditYears') or AUDIT_YEARS),
        'auditRows': store.scalar('SELECT COUNT(*) FROM audit'),
        'auditOldest': (store.scalar('SELECT MIN(ts) FROM audit') or '')[:10],
    }
