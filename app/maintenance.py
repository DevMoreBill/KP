# -*- coding: utf-8 -*-
"""Обслуживание базы: ежедневные резервные копии с проверкой, срок хранения журнала действий (старое — в архив),
сжатие и проверка базы, неиспользуемые изображения, устаревший кэш проверок контрагентов.

Запускается при старте программы и раз в сутки, пока программа (сервер отдела) работает.
Состояние — в kv «maint»: показывается в «Настройках» → «Статистика» → «Обслуживание базы».
"""
import gzip
import json
import os
import re
import sqlite3
import threading
from datetime import date, datetime, timedelta

KEEP_DAILY, KEEP_WEEKLY, KEEP_MONTHLY = 7, 4, 12
AUDIT_YEARS = 2            # журнал действий: сколько лет хранить в базе (старее — в архив data/backup/audit-archive)
VACUUM_DAYS = 30           # сжатие базы — не чаще раза в месяц
CHECKS_DAYS = 365          # кэш проверок контрагентов (Checko) старше года удаляется
IMG_MIN_AGE_DAYS = 30      # изображение без ссылок считается лишним, если ему больше месяца (черновики КП в браузерах)
AUTO_RX = re.compile(r'^kp-(\d{4}-\d{2}-\d{2})\.sqlite3$')
IMG_RX = re.compile(r'/img/([^"\\?#\s<>]+?\.(?:jpg|jpeg|png|webp))', re.I)
IMG_EXTS = ('.jpg', '.jpeg', '.png', '.webp')

_lock = threading.Lock()


def _now():
    return datetime.now().isoformat(timespec='seconds')


def state(store):
    return store.kv_get('maint') or {}


def _save(store, **parts):
    st = state(store)
    st.update(parts)
    store.kv_set('maint', st)
    return st


def auto_dir(data_dir):
    return os.path.join(data_dir, 'backup', 'auto')


def integrity(path, quick=False):
    """Проверка файла базы встроенной проверкой SQLite: 'ok' или текст ошибки."""
    c = sqlite3.connect(path, timeout=30)
    try:
        r = c.execute('PRAGMA quick_check' if quick else 'PRAGMA integrity_check').fetchall()
        return 'ok' if [x[0] for x in r] == ['ok'] else '; '.join(str(x[0]) for x in r[:5])
    finally:
        c.close()


def backups(data_dir):
    d = auto_dir(data_dir)
    out = []
    if os.path.isdir(d):
        for name in os.listdir(d):
            m = AUTO_RX.match(name)
            if m:
                f = os.path.join(d, name)
                out.append({'date': m.group(1), 'file': f, 'bytes': os.path.getsize(f)})
    return sorted(out, key=lambda x: x['date'], reverse=True)


def keep_set(dates):
    """Какие копии оставить: 7 последних дней, по одной (последней) на каждую из 4 последних недель
    и на каждый из 12 последних месяцев."""
    ds = sorted(set(dates), reverse=True)
    keep = set(ds[:KEEP_DAILY])
    weeks, months = {}, {}
    for s in ds:
        d = date.fromisoformat(s)
        weeks.setdefault(d.isocalendar()[:2], s)
        months.setdefault((d.year, d.month), s)
    keep |= set(list(weeks.values())[:KEEP_WEEKLY])
    keep |= set(list(months.values())[:KEEP_MONTHLY])
    return keep


def daily_backup(store, data_dir, force=False):
    """Копия базы за сегодня (если её ещё нет), проверка целостности копии, ротация старых копий."""
    today = date.today().isoformat()
    d = auto_dir(data_dir)
    dst = os.path.join(d, 'kp-%s.sqlite3' % today)
    if os.path.isfile(dst) and not force:
        return state(store).get('backup')
    os.makedirs(d, exist_ok=True)
    tmp = dst + '.tmp'
    rec = {'at': _now(), 'file': dst}
    try:
        if os.path.isfile(tmp):
            os.remove(tmp)
        store.backup(tmp)
        res = integrity(tmp)
        if res != 'ok':
            raise RuntimeError('копия не прошла проверку: ' + res)
        os.replace(tmp, dst)
        rec.update(ok=True, bytes=os.path.getsize(dst))
    except Exception as e:
        rec.update(ok=False, error=str(e)[:300])
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
    keep = keep_set([b['date'] for b in backups(data_dir)])
    for b in backups(data_dir):
        if b['date'] not in keep:
            try:
                os.remove(b['file'])
            except OSError:
                pass
    _save(store, backup=rec)
    return rec


def archive_audit(store, data_dir, years=None):
    """Записи журнала действий старше years лет — в архив data/backup/audit-archive/audit-ГГГГ.jsonl.gz, из базы удаляются."""
    years = years or int((store.kv_get('settings') or {}).get('auditYears') or AUDIT_YEARS)
    edge = (datetime.now() - timedelta(days=365 * years)).isoformat(timespec='seconds')
    cols = ('id', 'ts', 'user_id', 'user_name', 'role', 'action', 'entity_type', 'entity_id', 'before', 'after', 'ip', 'ua', 'result')
    rows = store.all('SELECT %s FROM audit WHERE ts < ? ORDER BY id' % ', '.join(cols), (edge,))
    if not rows:
        return 0
    d = os.path.join(data_dir, 'backup', 'audit-archive')
    os.makedirs(d, exist_ok=True)
    by_year = {}
    for r in rows:
        by_year.setdefault(str(r[1])[:4] or 'unknown', []).append(dict(zip(cols, r)))
    for y, recs in by_year.items():
        with gzip.open(os.path.join(d, 'audit-%s.jsonl.gz' % y), 'at', encoding='utf-8') as f:
            for x in recs:
                f.write(json.dumps(x, ensure_ascii=False) + '\n')
    store.write('DELETE FROM audit WHERE ts < ? AND id <= ?', (edge, rows[-1][0]))
    st = state(store)
    _save(store, audit={'at': _now(), 'archived': int((st.get('audit') or {}).get('archived') or 0) + len(rows), 'dir': d, 'years': years})
    return len(rows)


def purge_checks(store):
    edge = (datetime.now() - timedelta(days=CHECKS_DAYS)).isoformat(timespec='seconds')
    n = store.one('SELECT COUNT(*) FROM checks WHERE checked < ?', (edge,))[0]
    if n:
        store.write('DELETE FROM checks WHERE checked < ?', (edge,))
    return n


def db_maintenance(store, vacuum=None):
    """Сброс журнала WAL в базу, обновление статистики запросов; раз в месяц (или по кнопке) — сжатие и проверка."""
    st = state(store)
    last = (st.get('vacuum') or {}).get('at') or ''
    if vacuum is None:
        vacuum = not last or last < (datetime.now() - timedelta(days=VACUUM_DAYS)).isoformat(timespec='seconds')
    size0 = _db_size(store)
    rec = {}
    with store.lock:
        c = store.conn()
        c.commit()
        if vacuum:
            c.execute('VACUUM')
        c.execute('PRAGMA optimize')
        c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    if vacuum:
        rec['vacuum'] = {'at': _now(), 'before': size0, 'after': _db_size(store), 'check': integrity(store.path, quick=True)}
    rec['optimize'] = {'at': _now(), 'bytes': _db_size(store)}
    _save(store, **rec)
    return rec


def _db_size(store):
    return sum(os.path.getsize(store.path + s) for s in ('', '-wal') if os.path.isfile(store.path + s))


# ---------------------------------------------------------------- изображения без ссылок
def _referenced(store):
    refs = set()
    for (t,) in store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        cols = [r[1] for r in store.all('PRAGMA table_info("%s")' % t) if (r[2] or '').upper() in ('TEXT', '')]
        for col in cols:
            for (v,) in store.all('SELECT "%s" FROM "%s" WHERE "%s" LIKE ?' % (col, t, col), ('%/img/%',)):
                for m in IMG_RX.finditer(str(v)):
                    refs.add(m.group(1).replace('\\/', '/'))
    return refs


def unused_images(store, img_dir):
    """Файлы data/img, на которые нигде в базе нет ссылок (и старше месяца), плюс всё из папки unused."""
    refs = _referenced(store)
    edge = (datetime.now() - timedelta(days=IMG_MIN_AGE_DAYS)).timestamp()
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


def purge_images(store, img_dir, images=None):
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
        images.index = None          # индекс одинаковых изображений построится заново
    _save(store, images={'at': _now(), 'deleted': n, 'bytes': size})
    return {'deleted': n, 'bytes': size}


# ---------------------------------------------------------------- запуск
def run(store, data_dir, log=print):
    """Плановое обслуживание: копия за сегодня, архив журнала, кэш проверок, сжатие базы раз в месяц."""
    if not _lock.acquire(blocking=False):
        return
    try:
        from backup_mirror import MirrorBackup
        for name, fn in (('копия базы', lambda: daily_backup(store, data_dir)),
                         ('копия во вторую папку', lambda: MirrorBackup(store, data_dir).run()),
                         ('архив журнала действий', lambda: archive_audit(store, data_dir)),
                         ('кэш проверок', lambda: purge_checks(store)),
                         ('обслуживание базы', lambda: db_maintenance(store))):
            try:
                fn()
            except Exception as e:
                log('Обслуживание (%s) не выполнено: %s' % (name, e))
        _save(store, lastRun=_now())
    finally:
        _lock.release()


def start_daily(store, data_dir, log=print):
    """Раз в час проверяем, не наступил ли новый день: сервер отдела может работать неделями без перезапуска."""
    def loop():
        ev = threading.Event()
        while not ev.wait(3600):
            if (state(store).get('lastRun') or '')[:10] != date.today().isoformat():
                run(store, data_dir, log)
    t = threading.Thread(target=loop, daemon=True, name='maintenance')
    t.start()
    return t


def start_every(seconds, fn, log=print):
    """Фоновая задача раз в seconds секунд (первый запуск — через минуту после старта)."""
    def loop():
        ev = threading.Event()
        wait = 60
        while not ev.wait(wait):
            wait = seconds
            try:
                fn()
            except Exception as e:
                log('Фоновая задача: %s' % e)
    t = threading.Thread(target=loop, daemon=True, name='every-%d' % seconds)
    t.start()
    return t


def summary(store, data_dir):
    st = state(store)
    bl = backups(data_dir)
    return {'backup': st.get('backup'), 'copies': len(bl), 'copiesBytes': sum(b['bytes'] for b in bl), 'dir': auto_dir(data_dir),
            'oldest': bl[-1]['date'] if bl else None, 'audit': st.get('audit'), 'vacuum': st.get('vacuum'), 'optimize': st.get('optimize'),
            'images': st.get('images'), 'lastRun': st.get('lastRun'), 'auditYears': int((store.kv_get('settings') or {}).get('auditYears') or AUDIT_YEARS),
            'auditRows': store.one('SELECT COUNT(*) FROM audit')[0], 'auditOldest': (store.one('SELECT MIN(ts) FROM audit')[0] or '')[:10]}
