"""Обслуживание базы: ежедневные копии (DbCopy), журнал действий, сжатие, изображения, кэш, фоновые задачи."""

import gzip
import json
import os
import re
import threading
import time
from datetime import date, datetime, timedelta

from defaults import SrvVal
from server_log import ServerLog
from storage import DbZip

AUDIT_YEARS = 2  # по умолчанию; своё — kv settings.auditYears
IMG_RX = re.compile(r'/img/([^"\\?#\s<>]+?\.(?:jpg|jpeg|png|webp|pdf))', re.I)
IMG_EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.pdf')  # .pdf — буклет окраски станции


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def state(store) -> dict:
    return store.kv_get('maint') or {}


def _save(store, **parts) -> dict:
    st = state(store)
    st.update(parts)
    store.kv_set('maint', st)
    return st


def auto_dir(data_dir: str) -> str:
    return os.path.join(data_dir, 'backup', 'auto')


class DbCopy:
    """Ежедневные копии базы в data/backup/auto (ZIP), хранение по дням, неделям и месяцам."""

    RX = re.compile(r'^kp-(\d{4}-\d{2}-\d{2})\.(zip|sqlite3)$')
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
        by = {}
        if folder and os.path.isdir(folder):
            for name in os.listdir(folder):
                m = cls.RX.match(name)
                if not m:
                    continue
                f = os.path.join(folder, name)
                try:
                    size = os.path.getsize(f)
                except OSError:
                    continue
                rec = by.setdefault(m.group(1), {'date': m.group(1), 'file': f, 'bytes': 0, 'zip': False, 'files': []})
                rec['files'].append(f)
                rec['bytes'] += size
                if m.group(2) == 'zip':
                    rec['file'], rec['zip'] = f, True
        return sorted(by.values(), key=lambda x: x['date'], reverse=True)

    @staticmethod
    def keep_set(dates, store=None) -> set:
        """Какие копии оставить: последние дни, по одной за недели и месяцы (числа — «Значения программы»)."""
        daily, weekly, monthly = (
            SrvVal.get(store, k) for k in ('srv.backupDaily', 'srv.backupWeekly', 'srv.backupMonthly')
        )
        ds = sorted(set(dates), reverse=True)
        keep = set(ds[:daily])
        weeks, months = {}, {}
        for s in ds:
            d = date.fromisoformat(s)
            weeks.setdefault(d.isocalendar()[:2], s)
            months.setdefault((d.year, d.month), s)
        keep |= set(list(weeks.values())[:weekly])
        keep |= set(list(months.values())[:monthly])
        return keep

    @classmethod
    def daily(cls, store, data_dir: str, force: bool = False) -> dict | None:
        """Копия за сегодня (если её нет), проверенная до и после сжатия; затем ротация → запись о копии."""
        with cls.LOCK:
            today = date.today().isoformat()
            d = auto_dir(data_dir)
            have = [x for x in cls.listing(d) if x['date'] == today]
            if have and not force:
                return state(store).get('backup')
            dst = os.path.join(d, f'kp-{today}.zip')
            rec = {'at': _now(), 'file': dst}
            try:
                store.backup(dst, check=True)
                for x in have:  # прежняя копия за сегодня (например, без сжатия) — заменена архивом
                    for f in x['files']:
                        if f != dst and os.path.isfile(f):
                            os.remove(f)
                rec.update(ok=True, bytes=os.path.getsize(dst), db=db_size(store), zip=True)
            except Exception as e:
                rec.update(ok=False, error=str(e)[:300])
            cls.rotate(d, store=store)
            _save(store, backup=rec)
            return rec

    @classmethod
    def sweep(cls, folder: str, age=None) -> int:
        """Удалить остатки прерванных копий, выгрузок и загрузок базы (временные файлы старше часа). → сколько удалено."""
        n = 0
        edge = time.time() - (cls.TMP_AGE if age is None else age)
        if folder and os.path.isdir(folder):
            for name in os.listdir(folder):
                f = os.path.join(folder, name)
                try:
                    if cls.TMP_RX.match(name) and os.path.isfile(f) and os.path.getmtime(f) < edge:
                        os.remove(f)
                        n += 1
                except OSError:
                    pass
        return n

    @classmethod
    def rotate(cls, folder: str, keep=None, store=None) -> None:
        """Удалить копии, которые не нужно хранить (все файлы их даты), и остатки прерванных копий."""
        cls.sweep(folder)
        lst = cls.listing(folder)
        keep = cls.keep_set([b['date'] for b in lst], store) if keep is None else keep
        for b in lst:
            if b['date'] not in keep:
                for f in b['files']:
                    try:
                        os.remove(f)
                    except OSError:
                        pass

    @classmethod
    def compress_old(cls, store, data_dir: str, log=print) -> dict | None:
        """Копии без сжатия → ZIP рядом; исходный файл удаляется после проверки архива."""
        n = saved = 0
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
                    n += 1
                    saved += before - os.path.getsize(dst)
                except Exception as e:
                    log(f'Копия {name} не сжата: {e}')
                time.sleep(cls.PAUSE)
        if not n:
            return None
        st = state(store).get('compressed') or {}
        rec = {'at': _now(), 'files': int(st.get('files') or 0) + n, 'saved': int(st.get('saved') or 0) + saved}
        _save(store, compressed=rec)
        return rec

    @staticmethod
    def others(data_dir: str) -> dict:
        """Копии «перед изменением» в data/backup (обновление программы, импорт, сборка каталога…): сколько и сколько места."""
        folder = os.path.join(data_dir, 'backup')
        n = size = 0
        if os.path.isdir(folder):
            for name in os.listdir(folder):
                f = os.path.join(folder, name)
                if name.startswith('kp-') and name.endswith(('.zip', '.sqlite3')) and os.path.isfile(f):
                    n += 1
                    size += os.path.getsize(f)
        return {'count': n, 'bytes': size}


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
    d = os.path.join(data_dir, 'backup', 'audit-archive')
    os.makedirs(d, exist_ok=True)
    by_year = {}
    for r in rows:
        by_year.setdefault(str(r[1])[:4] or 'unknown', []).append(dict(zip(cols, r, strict=False)))
    for y, recs in by_year.items():
        with gzip.open(os.path.join(d, f'audit-{y}.jsonl.gz'), 'at', encoding='utf-8') as f:
            for x in recs:
                f.write(json.dumps(x, ensure_ascii=False) + '\n')
    store.write('DELETE FROM audit WHERE ts < ? AND id <= ?', (edge, rows[-1][0]))
    st = state(store)
    _save(
        store,
        audit={
            'at': _now(),
            'archived': int((st.get('audit') or {}).get('archived') or 0) + len(rows),
            'dir': d,
            'years': years,
        },
    )
    return len(rows)


def purge_checks(store) -> int:
    edge = (datetime.now() - timedelta(days=SrvVal.get(store, 'srv.checksDays'))).isoformat(timespec='seconds')
    n = store.one('SELECT COUNT(*) FROM checks WHERE checked < ?', (edge,))[0]
    if n:
        store.write('DELETE FROM checks WHERE checked < ?', (edge,))
    return n


def db_maintenance(store, vacuum=None) -> dict:
    """Сброс журнала WAL в базу, обновление статистики запросов; раз в месяц (или по кнопке) — сжатие и проверка."""
    st = state(store)
    last = (st.get('vacuum') or {}).get('at') or ''
    if vacuum is None:  # само — только ночью: сжатие держит запись в базу (десятки секунд на большой базе)
        night = datetime.now().hour < 6 or datetime.now().hour >= 22
        vacuum = night and (
            not last
            or last
            < (datetime.now() - timedelta(days=SrvVal.get(store, 'srv.vacuumDays'))).isoformat(timespec='seconds')
        )
    size0 = db_size(store)
    rec = {}
    with store.lock:
        c = store.conn()
        c.commit()
        if vacuum:
            c.execute('VACUUM')
        c.execute('PRAGMA optimize')
        c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    if vacuum:
        rec['vacuum'] = {
            'at': _now(),
            'before': size0,
            'after': db_size(store),
            'check': DbZip.integrity(store.path, quick=True),
        }
    rec['optimize'] = {'at': _now(), 'bytes': db_size(store)}
    _save(store, **rec)
    return rec


def db_size(store) -> int:
    return sum(os.path.getsize(store.path + s) for s in ('', '-wal') if os.path.isfile(store.path + s))


def _referenced(store) -> set:
    refs = set()
    for (t,) in store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        cols = [r[1] for r in store.all(f'PRAGMA table_info("{t}")') if (r[2] or '').upper() in ('TEXT', '')]
        for col in cols:
            for (v,) in store.all(f'SELECT "{col}" FROM "{t}" WHERE "{col}" LIKE ?', ('%/img/%',)):
                for m in IMG_RX.finditer(str(v)):
                    refs.add(m.group(1).replace('\\/', '/'))
    return refs


def unused_images(store, img_dir: str) -> list:
    """Файлы data/img, на которые нигде в базе нет ссылок (и старше месяца — srv.imgUnusedDays), плюс всё из папки unused."""
    refs = _referenced(store)
    edge = (datetime.now() - timedelta(days=SrvVal.get(store, 'srv.imgUnusedDays'))).timestamp()
    out = []
    root = os.path.abspath(img_dir)
    for dp, _dn, fn in os.walk(root):
        for name in fn:
            if os.path.splitext(name)[1].lower() not in IMG_EXTS:
                continue
            f = os.path.join(dp, name)
            rel = os.path.relpath(f, root).replace(os.sep, '/')
            if rel in refs:
                continue
            if not rel.startswith('unused/') and os.path.getmtime(f) > edge:
                continue
            out.append({'rel': rel, 'bytes': os.path.getsize(f)})
    return out


def purge_images(store, img_dir: str, images=None) -> dict:
    lst = unused_images(store, img_dir)
    n = size = 0
    for x in lst:
        try:
            f = os.path.join(img_dir, *x['rel'].split('/'))
            os.remove(f)
            n += 1
            size += x['bytes']
        except OSError:
            pass
    if images is not None:
        images.index = None  # индекс одинаковых изображений построится заново
    _save(store, images={'at': _now(), 'deleted': n, 'bytes': size})
    return {'deleted': n, 'bytes': size}


class DbHealthRun:
    """Еженедельная проверка «здоровья» базы (db_health.DbHealth) — папка готовых КП из настроек программы."""

    @staticmethod
    def weekly(store) -> dict | None:
        import config
        from db_health import DbHealth

        return DbHealth(store, config.DATA_DIR, config.DOCS_DIR).weekly()


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

            for name, fn in (
                ('копия базы', lambda: DbCopy.daily(store, data_dir)),
                ('копия во вторую папку', lambda: MirrorBackup(store, data_dir).run()),
                ('сжатие прежних копий', lambda: DbCopy.compress_old(store, data_dir, ServerLog.failure)),
                ('архив журнала действий', lambda: archive_audit(store, data_dir)),
                ('кэш проверок', lambda: purge_checks(store)),
                ('документы КП, удалённых навсегда', lambda: KpFiles(store, data_dir).purge()),
                ('обслуживание базы', lambda: db_maintenance(store)),
                ('проверка базы', lambda: DbHealthRun.weekly(store)),
            ):
                try:
                    fn()
                except Exception as e:
                    ServerLog.failure(f'обслуживание ({name})', e)
            _save(store, lastRun=_now())
        finally:
            cls.LOCK.release()

    @classmethod
    def daily(cls, store, data_dir: str) -> threading.Thread:
        """Раз в час проверяем, не наступил ли новый день: сервер отдела может работать неделями без перезапуска."""

        def loop() -> None:
            ev = threading.Event()
            while not ev.wait(3600):
                if (state(store).get('lastRun') or '')[:10] != date.today().isoformat():
                    cls.run(store, data_dir)

        t = threading.Thread(target=loop, daemon=True, name='maintenance')
        t.start()
        return t

    @staticmethod
    def every(seconds: float, fn, name) -> threading.Thread:
        """Задача раз в seconds секунд (первый запуск — через минуту после старта); name — для журнала сервера."""

        def loop() -> None:
            ev = threading.Event()
            wait = 60
            while not ev.wait(wait):
                try:
                    wait = max(60, int(seconds() if callable(seconds) else seconds))
                except Exception:
                    wait = 3600
                try:
                    fn()
                except Exception as e:
                    ServerLog.failure(f'фоновая задача «{name}»', e)

        t = threading.Thread(target=loop, daemon=True, name=f'every-{name[:40]}')
        t.start()
        return t


def summary(store, data_dir: str) -> dict:
    st = state(store)
    bl = DbCopy.listing(auto_dir(data_dir))
    return {
        'backup': st.get('backup'),
        'copies': len(bl),
        'copiesBytes': sum(b['bytes'] for b in bl),
        'dir': auto_dir(data_dir),
        'others': DbCopy.others(data_dir),
        'compressed': st.get('compressed'),
        'dbBytes': db_size(store),
        'oldest': bl[-1]['date'] if bl else None,
        'audit': st.get('audit'),
        'vacuum': st.get('vacuum'),
        'optimize': st.get('optimize'),
        'images': st.get('images'),
        'lastRun': st.get('lastRun'),
        'auditYears': int((store.kv_get('settings') or {}).get('auditYears') or AUDIT_YEARS),
        'auditRows': store.one('SELECT COUNT(*) FROM audit')[0],
        'auditOldest': (store.one('SELECT MIN(ts) FROM audit')[0] or '')[:10],
    }
