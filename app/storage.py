# -*- coding: utf-8 -*-
"""Хранилище данных конструктора КП на SQLite (встроено в Python и в EXE — ничего устанавливать не нужно).

Один файл базы: data/kp.sqlite3. Изображения по-прежнему лежат файлами в data/img (имя = хеш содержимого),
готовые КП — файлами .docx в папке «Коммерческие предложения».

Таблицы:
  catalog  — позиции каталога: полный документ + облегчённая карточка для списка и поиска;
  kp       — журнал КП: состояние формы, карточка для журнала, путь к .docx;
  counters — счётчики номеров КП по годам;
  clients  — контрагенты; checks — проверки Checko (кэш);
  kv       — прочие настройки (ключи API, свои типы оборудования);
  managers — менеджеры: контакты для КП (добавлена 01.10.2026; в прежних базах создаётся при запуске,
             остальные таблицы и данные не меняются);
  audit, trash, pending_edits — журнал действий, корзина удалённого, правки на модерации
             (миграция «2026-10-admin», обратимая: Store.migration_down).

Запись сериализуется одной блокировкой, база в режиме WAL: одновременное чтение многими пользователями
не мешает записи. При первом запуске данные из прежних JSON-файлов переносятся автоматически.
"""
import hashlib
import json
import os
import re
import sqlite3
import threading
from datetime import datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, doc TEXT NOT NULL, light TEXT NOT NULL, name TEXT, cat TEXT, maker TEXT, updated TEXT);
CREATE INDEX IF NOT EXISTS catalog_cat ON catalog(cat);
CREATE TABLE IF NOT EXISTS kp (id TEXT PRIMARY KEY, number TEXT, state TEXT, meta TEXT, docx TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS counters (year INTEGER PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated TEXT);
CREATE TABLE IF NOT EXISTS checks (inn TEXT PRIMARY KEY, doc TEXT NOT NULL, checked TEXT);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS managers (id TEXT PRIMARY KEY, name TEXT, doc TEXT NOT NULL, updated TEXT);
"""

# обратимые миграции: (id, что создать, что убрать при откате). Применённые — в kv «schema».
# Существующие таблицы и данные миграции не меняют — только добавляют новые таблицы.
MIGRATIONS = [
    ('2026-10-admin',
     """
     CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT, user_name TEXT,
         role TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, before TEXT, after TEXT, ip TEXT, ua TEXT, result TEXT);
     CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
     CREATE INDEX IF NOT EXISTS audit_action ON audit(action);
     CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
         title TEXT, data TEXT NOT NULL, deleted_at TEXT NOT NULL, deleted_by TEXT);
     CREATE TABLE IF NOT EXISTS pending_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, kind TEXT NOT NULL,
         before TEXT, after TEXT NOT NULL, user_id TEXT, user_name TEXT, created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
         reviewed_by TEXT, reviewed_at TEXT, reason TEXT);
     CREATE INDEX IF NOT EXISTS pending_status ON pending_edits(status);
     """,
     """
     DROP TABLE IF EXISTS audit; DROP TABLE IF EXISTS trash; DROP TABLE IF EXISTS pending_edits;
     DELETE FROM kv WHERE key IN ('admin', 'admins', 'settings');
     """),
    # «Экономика сделки»: справочник поставщиков (название, страна, условия) и коды ТН ВЭД / пошлины
    # (по категории оборудования — ключ cat:<тип>, по модели каталога — item:<id>)
    ('2026-11-deal',
     """
     CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, doc TEXT NOT NULL, updated TEXT);
     CREATE TABLE IF NOT EXISTS customs (key TEXT PRIMARY KEY, code TEXT, duty TEXT, note TEXT, updated TEXT, updated_by TEXT);
     """,
     """
     DROP TABLE IF EXISTS suppliers; DROP TABLE IF EXISTS customs;
     """),
    # свои категории в справочнике ТН ВЭД (ключ cat:x_<id>) — с названием
    ('2026-12-customs-name',
     """
     ALTER TABLE customs ADD COLUMN name TEXT;
     """,
     """
     CREATE TABLE customs_prev (key TEXT PRIMARY KEY, code TEXT, duty TEXT, note TEXT, updated TEXT, updated_by TEXT);
     INSERT INTO customs_prev SELECT key, code, duty, note, updated, updated_by FROM customs;
     DROP TABLE customs; ALTER TABLE customs_prev RENAME TO customs;
     """),
    # история версий КП: прежнее состояние сохраняется при каждом пересохранении КП (последние KP_VERSIONS)
    ('2026-12-kp-versions',
     """
     CREATE TABLE IF NOT EXISTS kp_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, kp_id TEXT NOT NULL, created TEXT NOT NULL,
         user_name TEXT, state TEXT NOT NULL, meta TEXT);
     CREATE INDEX IF NOT EXISTS kp_versions_kp ON kp_versions(kp_id, id);
     """,
     """
     DROP TABLE IF EXISTS kp_versions;
     """),
    # 3.9.0: номер правки (rev) и кто правил — защита от затирания при совместной работе;
    # поля для поиска и сортировки на сервере (контрагенты и журнал КП не грузятся целиком).
    # Новые столбцы заполняются из уже сохранённых документов (_fill_columns), данные не меняются.
    ('2027-01-db',
     """
     ALTER TABLE clients ADD COLUMN name TEXT; ALTER TABLE clients ADD COLUMN inn TEXT; ALTER TABLE clients ADD COLUMN used_at TEXT;
     ALTER TABLE clients ADD COLUMN search TEXT; ALTER TABLE clients ADD COLUMN rev INTEGER NOT NULL DEFAULT 0; ALTER TABLE clients ADD COLUMN updated_by TEXT;
     CREATE INDEX IF NOT EXISTS clients_used ON clients(used_at); CREATE INDEX IF NOT EXISTS clients_inn ON clients(inn);
     ALTER TABLE kp ADD COLUMN client TEXT; ALTER TABLE kp ADD COLUMN inn TEXT; ALTER TABLE kp ADD COLUMN manager TEXT; ALTER TABLE kp ADD COLUMN kdate TEXT;
     ALTER TABLE kp ADD COLUMN saved TEXT; ALTER TABLE kp ADD COLUMN search TEXT;
     ALTER TABLE kp ADD COLUMN rev INTEGER NOT NULL DEFAULT 0; ALTER TABLE kp ADD COLUMN updated_by TEXT;
     CREATE INDEX IF NOT EXISTS kp_manager ON kp(manager);
     ALTER TABLE catalog ADD COLUMN rev INTEGER NOT NULL DEFAULT 0; ALTER TABLE catalog ADD COLUMN updated_by TEXT;
     ALTER TABLE managers ADD COLUMN rev INTEGER NOT NULL DEFAULT 0; ALTER TABLE managers ADD COLUMN updated_by TEXT;
     ALTER TABLE suppliers ADD COLUMN rev INTEGER NOT NULL DEFAULT 0; ALTER TABLE suppliers ADD COLUMN updated_by TEXT;
     CREATE INDEX IF NOT EXISTS checks_checked ON checks(checked);
     """,
     """
     DROP INDEX IF EXISTS clients_used; DROP INDEX IF EXISTS clients_inn; DROP INDEX IF EXISTS kp_manager; DROP INDEX IF EXISTS checks_checked;
     ALTER TABLE clients DROP COLUMN name; ALTER TABLE clients DROP COLUMN inn; ALTER TABLE clients DROP COLUMN used_at;
     ALTER TABLE clients DROP COLUMN search; ALTER TABLE clients DROP COLUMN rev; ALTER TABLE clients DROP COLUMN updated_by;
     ALTER TABLE kp DROP COLUMN client; ALTER TABLE kp DROP COLUMN inn; ALTER TABLE kp DROP COLUMN manager; ALTER TABLE kp DROP COLUMN kdate;
     ALTER TABLE kp DROP COLUMN saved; ALTER TABLE kp DROP COLUMN search; ALTER TABLE kp DROP COLUMN rev; ALTER TABLE kp DROP COLUMN updated_by;
     ALTER TABLE catalog DROP COLUMN rev; ALTER TABLE catalog DROP COLUMN updated_by;
     ALTER TABLE managers DROP COLUMN rev; ALTER TABLE managers DROP COLUMN updated_by;
     ALTER TABLE suppliers DROP COLUMN rev; ALTER TABLE suppliers DROP COLUMN updated_by;
     """),
]
KP_VERSIONS = 30

# таблицы, строки которых удаляются в корзину целиком (все столбцы) и восстанавливаются из неё
TRASH_TABLES = {'kp': 'kp', 'catalog': 'catalog', 'manager': 'managers', 'client': 'clients', 'supplier': 'suppliers'}

# поля позиции, которые нужны списку каталога, фильтрам и быстрому поиску (без характеристик, описаний и галереи)
LIGHT_KEYS = ('id', 'name', 'spec', 'price', 'priceCur', 'cost', 'costCur', 'margin', 'mmode', 'kind', 'short', 'unit',
              'attrs', 'hint', 'photo', 'prices', 'options', 'updatedAt', 'rrc', 'stock', 'priceSrc', 'costSrc')


def _now():
    return datetime.now().isoformat(timespec='seconds')


def norm(s):
    """Строка для поиска — как norm() в интерфейсе: нижний регистр, ё → е, без кавычек, одинарные пробелы."""
    return re.sub(r'\s+', ' ', re.sub(r'[«»"]', '', str(s or '').lower().replace('ё', 'е'))).strip()


def like_arg(q):
    """Подстрока для LIKE … ESCAPE '\\' (символы % и _ ищутся как есть)."""
    return '%' + re.sub(r'([%_\\])', r'\\\1', q) + '%'


def with_rev(text, rev):
    """Документ JSON (строка) с номером правки _rev — по нему сохранение узнаёт, что запись успели изменить."""
    t = (text or '').lstrip()
    if not t.startswith('{'):
        return text
    body = t[1:].lstrip()
    return '{"_rev":%d%s%s' % (int(rev or 0), '' if body.startswith('}') else ',', body)


class Conflict(Exception):
    """Запись изменили после того, как её открыли: rev — текущий номер правки, by и at — кто и когда."""
    def __init__(self, rev, by, at):
        Exception.__init__(self, 'Запись уже изменена')
        self.rev, self.by, self.at = rev, by or '', at or ''

    def info(self):
        return {'conflict': True, 'rev': self.rev, 'by': self.by, 'at': self.at}


def client_cols(doc):
    """Столбцы контрагента для поиска и сортировки."""
    d = doc if isinstance(doc, dict) else {}
    return (str(d.get('name') or '')[:300], re.sub(r'\D', '', str(d.get('inn') or ''))[:12], str(d.get('usedAt') or d.get('updatedAt') or '')[:40],
            norm(' '.join(str(d.get(k) or '') for k in ('name', 'full', 'inn', 'address')))[:1000])


def kp_cols(meta):
    """Столбцы журнала КП из описания (meta) для поиска и фильтров."""
    d = meta if isinstance(meta, dict) else {}
    items = d.get('items') if isinstance(d.get('items'), list) else []
    return (str(d.get('client') or '')[:300], re.sub(r'\D', '', str(d.get('clientInn') or ''))[:12], str(d.get('manager') or '')[:200],
            str(d.get('date') or '')[:20], str(d.get('savedAt') or '')[:40],
            norm(' '.join([str(d.get('number') or ''), str(d.get('client') or ''), str(d.get('clientInn') or ''), str(d.get('manager') or '')]
                          + [str(x) for x in items]))[:1500])


def _fill_columns(st, c):
    """Миграция 2027-01-db: заполнить новые столбцы контрагентов и журнала КП из сохранённых документов."""
    for cid, doc in c.execute('SELECT id, doc FROM clients').fetchall():
        try:
            d = json.loads(doc)
        except ValueError:
            d = {}
        c.execute('UPDATE clients SET name=?, inn=?, used_at=?, search=? WHERE id=?', client_cols(d) + (cid,))
    for kid, meta in c.execute('SELECT id, meta FROM kp WHERE meta IS NOT NULL').fetchall():
        try:
            d = json.loads(meta)
        except ValueError:
            d = {}
        c.execute('UPDATE kp SET client=?, inn=?, manager=?, kdate=?, saved=?, search=? WHERE id=?', kp_cols(d) + (kid,))


MIGRATION_FILL = {'2027-01-db': _fill_columns}


def light_of(doc):
    d = {k: doc[k] for k in LIGHT_KEYS if k in doc}
    if isinstance(d.get('prices'), list):
        d['prices'] = d['prices'][:5]
        d['pricesCount'] = len(doc.get('prices') or [])
    # строка для поиска по значениям характеристик (без самих таблиц)
    vals = []
    for g in doc.get('groups') or []:
        for r in g.get('rows') or []:
            vals.append('%s %s' % (r.get('k', ''), r.get('v', '')))
    d['st'] = ' '.join(vals)[:600]
    d['_light'] = True
    return d


class Store:
    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.lock = threading.RLock()
        self.local = threading.local()
        c = self.conn()
        c.executescript(SCHEMA)
        c.commit()
        self.migrations_up()

    def conn(self):
        c = getattr(self.local, 'c', None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('PRAGMA synchronous=NORMAL')
            c.execute('PRAGMA foreign_keys=ON')
            self.local.c = c
        return c

    def _next_rev(self, c, table, key, base_rev):
        """Номер следующей правки записи; base_rev (с какой правки начинали) не совпал — Conflict."""
        r = c.execute('SELECT rev, updated_by, updated FROM %s WHERE id=?' % table, (key,)).fetchone()
        cur = (r[0] or 0) if r else 0
        if base_rev not in (None, '') and r and int(base_rev) != cur:
            raise Conflict(cur, r[1], r[2])
        return cur + 1

    def rev_of(self, table, key):
        if table not in ('kp', 'catalog', 'clients', 'managers', 'suppliers'):
            raise ValueError(table)
        r = self.one('SELECT rev, updated_by, updated FROM %s WHERE id=?' % table, (key,))
        return {'rev': (r[0] or 0) if r else 0, 'by': (r[1] or '') if r else '', 'at': (r[2] or '') if r else ''}

    def write(self, sql, args=()):
        with self.lock:
            c = self.conn()
            c.execute(sql, args)
            c.commit()

    def one(self, sql, args=()):
        return self.conn().execute(sql, args).fetchone()

    def all(self, sql, args=()):
        return self.conn().execute(sql, args).fetchall()

    # ---------- каталог ----------
    def catalog_light(self):
        rows = self.all('SELECT light FROM catalog ORDER BY name')
        return '[' + ','.join(r[0] for r in rows) + ']'

    def catalog_full(self):
        rows = self.all('SELECT doc FROM catalog ORDER BY name')
        return '[' + ','.join(r[0] for r in rows) + ']'

    def catalog_get(self, cid, rev=False):
        r = self.one('SELECT doc, rev FROM catalog WHERE id=?', (cid,))
        return (with_rev(r[0], r[1]) if rev else r[0]) if r else None

    def catalog_put(self, cid, text, by='', base_rev=None):
        doc = json.loads(text)
        doc['id'] = cid
        doc.pop('_rev', None)
        a = doc.get('attrs') or {}
        with self.lock:
            c = self.conn()
            rev = self._next_rev(c, 'catalog', cid, base_rev)
            c.execute('INSERT OR REPLACE INTO catalog (id, doc, light, name, cat, maker, updated, rev, updated_by) VALUES (?,?,?,?,?,?,?,?,?)',
                      (cid, json.dumps(doc, ensure_ascii=False), json.dumps(light_of(doc), ensure_ascii=False),
                       doc.get('name', ''), a.get('cat', ''), a.get('maker', ''), _now(), rev, str(by or '')[:120]))
            self._bump_data(c, 'catalog')
            c.commit()
        return rev

    # ---------- версия справочников: браузер хранит копию и перекачивает её, только когда что-то изменилось ----------
    def _bump_data(self, c, name):
        c.execute("INSERT INTO kv (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
                  ('datarev:' + name,))

    def data_rev(self, name):
        r = self.one('SELECT value FROM kv WHERE key=?', ('datarev:' + name,))
        return str(r[0]) if r else '0'

    def bump_data(self, name):
        with self.lock:
            c = self.conn()
            self._bump_data(c, name)
            c.commit()

    def catalog_count(self):
        return self.one('SELECT COUNT(*) FROM catalog')[0]

    # ---------- миграции ----------
    def migrations_applied(self):
        return self.kv_get('schema') or []

    def _atomic_script(self, script, then=None, mark=None):
        """Изменение схемы, заполнение данных и отметка в kv «schema» — одной транзакцией: при сбое посередине
        база остаётся как была, и при следующем запуске миграция просто выполняется заново."""
        with self.lock:
            c = self.conn()
            c.commit()
            try:
                c.executescript('BEGIN IMMEDIATE;\n' + script)
                if then:
                    then(self, c)
                if mark is not None:
                    c.execute('INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)', ('schema', json.dumps(mark, ensure_ascii=False)))
                c.commit()
            except Exception:
                c.rollback()
                raise

    def migrations_up(self):
        done = self.migrations_applied()
        todo = [x for x in MIGRATIONS if x[0] not in done]
        if todo and done:      # база с данными: перед изменением структуры — копия в data/backup
            self.backup(os.path.join(os.path.dirname(self.path), 'backup', 'kp-%s-before-%s.sqlite3' % (
                datetime.now().strftime('%Y%m%d-%H%M%S'), todo[0][0])))
        for mid, up, _down in todo:
            done = done + [mid]
            self._atomic_script(up, MIGRATION_FILL.get(mid), done)

    def migration_down(self, mid):
        """Откат миграции: её таблицы и столбцы удаляются (данные в них теряются), остальная база не меняется."""
        down = next((d for i, _u, d in MIGRATIONS if i == mid), None)
        if down is None or mid not in self.migrations_applied():
            raise ValueError('Миграция не применена: %s' % mid)
        self._atomic_script(down, None, [x for x in self.migrations_applied() if x != mid])

    # ---------- журнал действий ----------
    def audit_add(self, rec):
        self.write('INSERT INTO audit (ts, user_id, user_name, role, action, entity_type, entity_id, before, after, ip, ua, result) '
                   'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                   (rec.get('timestamp') or _now(), rec.get('userId'), rec.get('userName'), rec.get('userRole'), rec['action'],
                    rec.get('entityType'), rec.get('entityId'),
                    None if rec.get('before') is None else json.dumps(rec['before'], ensure_ascii=False),
                    None if rec.get('after') is None else json.dumps(rec['after'], ensure_ascii=False),
                    rec.get('ip'), (rec.get('userAgent') or '')[:300], rec.get('result') or 'success'))

    AUDIT_COLS = ('id', 'timestamp', 'userId', 'userName', 'userRole', 'action', 'entityType', 'entityId',
                  'before', 'after', 'ip', 'userAgent', 'result')

    def _audit_row(self, r):
        d = dict(zip(self.AUDIT_COLS, r))
        for k in ('before', 'after'):
            if d[k]:
                try:
                    d[k] = json.loads(d[k])
                except Exception:
                    pass
        return d

    def audit_query(self, f, limit=50, offset=0):
        """Записи журнала действий по фильтрам: user, action, entity, q (поиск), from, to (даты ГГГГ-ММ-ДД)."""
        where, args = [], []
        if f.get('user'):
            where.append('user_name = ?'); args.append(f['user'])
        if f.get('action'):
            where.append('action = ?'); args.append(f['action'])
        if f.get('entity'):
            where.append('entity_type = ?'); args.append(f['entity'])
        if f.get('from'):
            where.append('ts >= ?'); args.append(f['from'])
        if f.get('to'):
            where.append('ts < ?'); args.append(f['to'] + 'T99')
        if f.get('q'):
            where.append('(entity_id LIKE ? OR user_name LIKE ? OR after LIKE ? OR before LIKE ?)'); args += ['%' + f['q'] + '%'] * 4
        w = (' WHERE ' + ' AND '.join(where)) if where else ''
        total = self.one('SELECT COUNT(*) FROM audit' + w, args)[0]
        rows = self.all('SELECT id, ts, user_id, user_name, role, action, entity_type, entity_id, before, after, ip, ua, result '
                        'FROM audit' + w + ' ORDER BY id DESC LIMIT ? OFFSET ?', args + [int(limit), int(offset)])
        return {'total': total, 'items': [self._audit_row(r) for r in rows]}

    def audit_get(self, aid):
        r = self.one('SELECT id, ts, user_id, user_name, role, action, entity_type, entity_id, before, after, ip, ua, result '
                     'FROM audit WHERE id=?', (aid,))
        return self._audit_row(r) if r else None

    def audit_distinct(self, col):
        if col not in ('user_name', 'action', 'entity_type'):
            raise ValueError(col)
        return [r[0] for r in self.all('SELECT DISTINCT %s FROM audit WHERE %s IS NOT NULL AND %s <> "" ORDER BY 1' % (col, col, col))]

    # ---------- корзина (мягкое удаление с восстановлением) ----------
    def trash_put(self, etype, eid, title, by):
        table = TRASH_TABLES[etype]
        with self.lock:
            c = self.conn()
            cur = c.execute('SELECT * FROM %s WHERE id=?' % table, (eid,))
            row = cur.fetchone()
            if not row:
                return None
            data = dict(zip([x[0] for x in cur.description], row))
            c.execute('INSERT INTO trash (entity_type, entity_id, title, data, deleted_at, deleted_by) VALUES (?,?,?,?,?,?)',
                      (etype, eid, title, json.dumps(data, ensure_ascii=False), _now(), by))
            c.execute('DELETE FROM %s WHERE id=?' % table, (eid,))
            if table in ('catalog', 'managers', 'suppliers'):
                self._bump_data(c, table)
            c.commit()
        return data

    def trash_list(self):
        return [dict(zip(('id', 'entityType', 'entityId', 'title', 'deletedAt', 'deletedBy'), r))
                for r in self.all('SELECT id, entity_type, entity_id, title, deleted_at, deleted_by FROM trash ORDER BY id DESC')]

    def trash_restore(self, tid):
        r = self.one('SELECT entity_type, entity_id, data FROM trash WHERE id=?', (tid,))
        if not r:
            raise ValueError('Нет такой записи в корзине')
        etype, eid, data = r[0], r[1], json.loads(r[2])
        table = TRASH_TABLES[etype]
        if self.one('SELECT 1 FROM %s WHERE id=?' % table, (eid,)):
            raise ValueError('Запись с таким id уже есть — восстановление заменило бы её')
        cols = list(data)
        with self.lock:
            c = self.conn()
            c.execute('INSERT INTO %s (%s) VALUES (%s)' % (table, ','.join(cols), ','.join('?' * len(cols))), [data[k] for k in cols])
            c.execute('DELETE FROM trash WHERE id=?', (tid,))
            # удалённое прежней версией — без полей для поиска: заполняем их по документу
            if table == 'clients':
                c.execute('UPDATE clients SET name=?, inn=?, used_at=?, search=? WHERE id=?', client_cols(json.loads(data.get('doc') or '{}')) + (eid,))
            elif table == 'kp' and data.get('meta'):
                try:
                    c.execute('UPDATE kp SET client=?, inn=?, manager=?, kdate=?, saved=?, search=? WHERE id=?', kp_cols(json.loads(data['meta'])) + (eid,))
                except ValueError:
                    pass
            if table in ('catalog', 'managers', 'suppliers'):
                self._bump_data(c, table)
            c.commit()
        return etype, eid

    def trash_purge(self, days):
        """Окончательно удалить то, что лежит в корзине дольше days дней."""
        from datetime import timedelta
        edge = (datetime.now() - timedelta(days=days)).isoformat(timespec='seconds')
        n = self.one('SELECT COUNT(*) FROM trash WHERE deleted_at < ?', (edge,))[0]
        if n:
            self.write('DELETE FROM trash WHERE deleted_at < ?', (edge,))
        return n

    # ---------- правки товаров на модерации ----------
    PENDING_COLS = ('id', 'productId', 'kind', 'before', 'after', 'userId', 'userName', 'created', 'status',
                    'reviewedBy', 'reviewedAt', 'reason')

    def pending_add(self, pid, kind, before, after, uid, uname):
        with self.lock:
            c = self.conn()
            cur = c.execute('INSERT INTO pending_edits (product_id, kind, before, after, user_id, user_name, created) VALUES (?,?,?,?,?,?,?)',
                            (pid, kind, before, after, uid, uname, _now()))
            c.commit()
            return cur.lastrowid

    def pending_list(self, status='pending', with_docs=False):
        cols = 'id, product_id, kind, %s, user_id, user_name, created, status, reviewed_by, reviewed_at, reason' % (
            'before, after' if with_docs else 'NULL, NULL')
        rows = self.all('SELECT %s FROM pending_edits WHERE status=? ORDER BY id DESC' % cols, (status,))
        return [dict(zip(self.PENDING_COLS, r)) for r in rows]

    def pending_get(self, eid):
        r = self.one('SELECT id, product_id, kind, before, after, user_id, user_name, created, status, reviewed_by, reviewed_at, reason '
                     'FROM pending_edits WHERE id=?', (eid,))
        return dict(zip(self.PENDING_COLS, r)) if r else None

    def pending_set(self, eid, status, by, reason=''):
        self.write('UPDATE pending_edits SET status=?, reviewed_by=?, reviewed_at=?, reason=? WHERE id=?', (status, by, _now(), reason, eid))

    def pending_ids(self):
        return [r[0] for r in self.all("SELECT DISTINCT product_id FROM pending_edits WHERE status='pending'")]

    # ---------- статистика ----------
    def table_counts(self):
        out = {}
        for (t,) in self.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            out[t] = self.one('SELECT COUNT(*) FROM "%s"' % t)[0]
        return out

    def kp_all_meta(self):
        return [json.loads(r[0]) for r in self.all('SELECT meta FROM kp WHERE meta IS NOT NULL')]

    # ---------- «Экономика сделки»: поставщики и коды ТН ВЭД ----------
    def suppliers_list(self):
        self._deal_legacy()
        return [dict(json.loads(r[0]), _rev=r[1] or 0) for r in self.all('SELECT doc, rev FROM suppliers ORDER BY name COLLATE NOCASE')]

    def supplier_get(self, sid):
        r = self.one('SELECT doc FROM suppliers WHERE id=?', (sid,))
        return json.loads(r[0]) if r else None

    def supplier_put(self, sid, doc, by='', base_rev=None):
        if not isinstance(doc, dict) or not str(doc.get('name') or '').strip():
            raise ValueError('Укажите название поставщика')
        if base_rev is None and doc.get('_rev') is not None:
            base_rev = doc.get('_rev')
        doc = {k: v for k, v in doc.items() if k != '_rev'}
        doc = dict(doc, id=sid, name=str(doc['name']).strip()[:200], updatedAt=_now())
        with self.lock:
            c = self.conn()
            rev = self._next_rev(c, 'suppliers', sid, base_rev)
            c.execute('INSERT OR REPLACE INTO suppliers (id, name, country, doc, updated, rev, updated_by) VALUES (?,?,?,?,?,?,?)',
                      (sid, doc['name'], str(doc.get('country') or '')[:80], json.dumps(doc, ensure_ascii=False), _now(), rev, str(by or '')[:120]))
            self._bump_data(c, 'suppliers')
            c.commit()
        return dict(doc, _rev=rev)

    def customs_all(self):
        self._deal_legacy()
        out = {}
        for key, code, duty, note, upd, by, name in self.all('SELECT key, code, duty, note, updated, updated_by, name FROM customs'):
            out[key] = {'code': code or '', 'duty': duty or '', 'note': note or '', 'name': name or '', 'updated': upd, 'by': by or ''}
        return out

    def customs_put(self, key, code, duty, note, by, name=''):
        """Код ТН ВЭД и ставка пошлины по ключу cat:<категория> или item:<модель>; своя категория (cat:x_…) —
        с названием; пустые код, ставка и название у своей категории — удалить её."""
        if not re.match(r'^(cat|item):[\w.-]{1,80}$', key or ''):
            raise ValueError('Неверный ключ')
        if key.startswith('cat:x_') and not str(name or '').strip():
            if str(code or '').strip() or str(duty or '').strip():
                raise ValueError('Укажите название категории')
            self.write('DELETE FROM customs WHERE key=?', (key,))
            return
        self.write('INSERT OR REPLACE INTO customs (key, code, duty, note, updated, updated_by, name) VALUES (?,?,?,?,?,?,?)',
                   (key, str(code or '')[:40], str(duty or '')[:12], str(note or '')[:300], _now(), str(by or '')[:120], str(name or '')[:120]))

    def _deal_legacy(self):
        """Перенос подсказок прежней версии (kv dealProfiles) в справочники — один раз."""
        old = self.kv_get('dealProfiles')
        if not old:
            return
        for name, p in (old.get('sup') or {}).items():
            sid = 'sup_' + hashlib.md5(name.strip().lower().encode('utf-8')).hexdigest()[:10]
            if isinstance(p, dict) and not self.one('SELECT 1 FROM suppliers WHERE name=? COLLATE NOCASE', (name,)):
                self.supplier_put(sid, dict(p, name=name))
        for cat, duty in (old.get('duty') or {}).items():
            if not self.one('SELECT 1 FROM customs WHERE key=?', ('cat:' + cat,)):
                self.customs_put('cat:' + cat, '', duty, '', 'перенос')
        self.write("DELETE FROM kv WHERE key='dealProfiles'")

    # ---------- менеджеры ----------
    def managers_list(self, rev=False):
        rows = self.all('SELECT doc, rev FROM managers ORDER BY name COLLATE NOCASE')
        return '[' + ','.join(with_rev(r[0], r[1]) if rev else r[0] for r in rows) + ']'

    @staticmethod
    def manager_keys(doc):
        """Признаки одного и того же человека: фамилия и имя, e-mail, мобильный (последние 10 цифр), добавочный."""
        words = re.sub(r'\s+', ' ', str(doc.get('name') or '').lower().replace('ё', 'е')).strip().split(' ')
        mob = re.sub(r'\D', '', str(doc.get('mobile') or ''))[-10:]
        return {'name': ' '.join(words[:2]) if len(words) >= 2 else '', 'email': str(doc.get('email') or '').strip().lower(),
                'mobile': mob if len(mob) == 10 else '', 'ext': re.sub(r'\D', '', str(doc.get('ext') or ''))}

    def manager_dup(self, mid, doc):
        """Другой менеджер с теми же фамилией и именем, e-mail, мобильным или добавочным: (менеджер, что совпало) или None."""
        mine = self.manager_keys(doc)
        what = {'name': 'фамилия и имя', 'email': 'e-mail', 'mobile': 'мобильный телефон', 'ext': 'добавочный номер'}
        for other in json.loads(self.managers_list()):
            if other.get('id') == mid:
                continue
            k = self.manager_keys(other)
            for f in ('name', 'email', 'mobile', 'ext'):
                if mine[f] and mine[f] == k[f]:
                    return other, what[f]
        return None

    def manager_put(self, mid, text, by='', base_rev=None):
        doc = json.loads(text)
        if not isinstance(doc, dict):
            raise ValueError('Ожидались данные менеджера')
        dup = self.manager_dup(mid, doc)
        if dup:
            raise ValueError('Такой менеджер уже есть: %s (совпадает %s)' % (dup[0].get('name') or 'без имени', dup[1]))
        doc.pop('_rev', None)
        doc['id'] = mid
        doc['updatedAt'] = _now()
        with self.lock:
            c = self.conn()
            rev = self._next_rev(c, 'managers', mid, base_rev)
            c.execute('INSERT OR REPLACE INTO managers (id, name, doc, updated, rev, updated_by) VALUES (?,?,?,?,?,?)',
                      (mid, str(doc.get('name') or ''), json.dumps(doc, ensure_ascii=False), _now(), rev, str(by or '')[:120]))
            self._bump_data(c, 'managers')
            c.commit()
        return dict(doc, _rev=rev)

    # ---------- журнал КП ----------
    def next_number(self):
        with self.lock:
            c = self.conn()
            year = datetime.now().year
            r = c.execute('SELECT n FROM counters WHERE year=?', (year,)).fetchone()
            n = r[0] if r else 0
            while True:
                n += 1
                num = '%d-%03d' % (year, n)
                if not c.execute('SELECT 1 FROM kp WHERE id=?', (num,)).fetchone():
                    break
            c.execute('INSERT OR REPLACE INTO counters (year, n) VALUES (?,?)', (year, n))
            c.execute('INSERT INTO kp (id, number, updated) VALUES (?,?,?)', (num, num, _now()))
            c.commit()
            return num

    def ensure_counter_at_least(self, year, n):
        with self.lock:
            c = self.conn()
            r = c.execute('SELECT n FROM counters WHERE year=?', (year,)).fetchone()
            if not r or r[0] < n:
                c.execute('INSERT OR REPLACE INTO counters (year, n) VALUES (?,?)', (year, n))
                c.commit()

    def kp_list(self):
        rows = self.all("SELECT meta FROM kp WHERE meta IS NOT NULL ORDER BY id DESC")
        out = []
        for r in rows:      # испорченная запись (старая версия, ручная правка) не ломает весь журнал
            try:
                if isinstance(json.loads(r[0]), dict):
                    out.append(r[0])
            except (TypeError, ValueError):
                pass
        return '[' + ','.join(out) + ']'

    def kp_get(self, kid, field):
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        r = self.one('SELECT %s FROM kp WHERE id=?' % field, (kid,))
        return r[0] if r else None

    def kp_set(self, kid, field, value, by='', base_rev=None):
        """Сохранение поля КП. Новое состояние (state) — новая правка: base_rev не совпал с текущей — Conflict.
        Возвращает номер правки КП."""
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        with self.lock:
            c = self.conn()
            old = c.execute('SELECT state, meta, rev FROM kp WHERE id=?', (kid,)).fetchone()
            if not old:
                c.execute('INSERT INTO kp (id, number, updated) VALUES (?,?,?)', (kid, kid, _now()))
            rev = (old[2] or 0) if old else 0
            if field == 'state':
                if isinstance(value, str) and '"_rev"' in value[:400]:
                    try:
                        d = json.loads(value)
                        if isinstance(d, dict) and d.pop('_rev', None) is not None:
                            value = json.dumps(d, ensure_ascii=False)
                    except ValueError:
                        pass
                rev = self._next_rev(c, 'kp', kid, base_rev)
                if old and old[0] and old[0] != value:
                    # прежнее состояние — в историю версий (лишнее сверх KP_VERSIONS удаляется)
                    c.execute('INSERT INTO kp_versions (kp_id, created, user_name, state, meta) VALUES (?,?,?,?,?)', (kid, _now(), by, old[0], old[1]))
                    c.execute('DELETE FROM kp_versions WHERE kp_id=? AND id NOT IN (SELECT id FROM kp_versions WHERE kp_id=? ORDER BY id DESC LIMIT ?)',
                              (kid, kid, KP_VERSIONS))
                c.execute('UPDATE kp SET state=?, updated=?, rev=?, updated_by=? WHERE id=?', (value, _now(), rev, str(by or '')[:120], kid))
            elif field == 'meta':
                try:
                    cols = kp_cols(json.loads(value))
                except (TypeError, ValueError):
                    cols = kp_cols({})
                c.execute('UPDATE kp SET meta=?, updated=?, client=?, inn=?, manager=?, kdate=?, saved=?, search=? WHERE id=?',
                          (value, _now()) + cols + (kid,))
            else:
                c.execute('UPDATE kp SET docx=?, updated=? WHERE id=?', (value, _now(), kid))
            c.commit()
        return rev

    def kp_import(self, x):
        """Запись КП из резервной копии целиком (с полями журнала для поиска)."""
        try:
            cols = kp_cols(json.loads(x.get('meta') or '{}'))
        except (TypeError, ValueError):
            cols = kp_cols({})
        with self.lock:
            c = self.conn()
            rev = self._next_rev(c, 'kp', x['id'], None)
            c.execute('INSERT OR REPLACE INTO kp (id, number, state, meta, docx, updated, client, inn, manager, kdate, saved, search, rev) '
                      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (x['id'], x.get('number'), x.get('state'), x.get('meta'), x.get('docx'), x.get('updated') or _now()) + cols + (rev,))
            c.commit()

    def kp_page(self, q='', author='', limit=50, offset=0):
        """Журнал КП постранично: поиск по номеру, получателю, ИНН, автору и позициям; фильтр по автору."""
        where, args = ['meta IS NOT NULL'], []
        qn = norm(q)
        if qn:
            where.append("search LIKE ? ESCAPE '\\'")
            args.append(like_arg(qn))
        if author:
            where.append('manager = ?')
            args.append(author)
        w = ' WHERE ' + ' AND '.join(where)
        total = self.one('SELECT COUNT(*) FROM kp' + w, args)[0]
        rows = self.all('SELECT meta FROM kp' + w + ' ORDER BY id DESC LIMIT ? OFFSET ?', args + [int(limit), int(offset)])
        return total, [r[0] for r in rows]

    def kp_metas_where(self, q='', author=''):
        """Все описания КП под фильтром — для итогов журнала (сумма, прибыль)."""
        total, rows = self.kp_page(q, author, 10 ** 9, 0)
        return rows

    def kp_authors(self):
        return [r[0] for r in self.all("SELECT DISTINCT manager FROM kp WHERE meta IS NOT NULL AND manager IS NOT NULL AND manager <> '' "
                                       "ORDER BY manager COLLATE NOCASE")]

    def kp_versions(self, kid):
        out = []
        for vid, created, by, meta, upd in self.all('SELECT id, created, user_name, meta, (SELECT updated FROM kp WHERE id=kp_id) FROM kp_versions '
                                                     'WHERE kp_id=? ORDER BY id DESC', (kid,)):
            mt = {}
            try:
                mt = json.loads(meta or '{}') or {}
            except ValueError:
                pass
            out.append({'id': vid, 'created': created, 'by': by or '', 'sum': mt.get('sum'), 'cur': mt.get('cur'), 'client': mt.get('client'),
                        'manager': mt.get('manager'), 'savedAt': mt.get('savedAt') or mt.get('updatedAt'), 'items': (mt.get('items') or [])[:3]})
        return out

    def kp_version_state(self, kid, vid):
        r = self.one('SELECT state FROM kp_versions WHERE kp_id=? AND id=?', (kid, int(vid)))
        return r[0] if r else None

    # ---------- контрагенты и проверки ----------
    def clients_all(self):
        return [json.loads(r[0]) for r in self.all('SELECT doc FROM clients ORDER BY updated DESC')]

    def clients_count(self):
        return self.one('SELECT COUNT(*) FROM clients')[0]

    def clients_search(self, q='', limit=50, offset=0):
        """Контрагенты: последние использованные или найденные по названию, ИНН, адресу (поиск — на сервере)."""
        qn, args, w = norm(q), [], ''
        if qn:
            digits = re.sub(r'\D', '', qn)
            if digits and digits == qn.replace(' ', ''):
                w, args = " WHERE inn LIKE ? ESCAPE '\\' OR search LIKE ? ESCAPE '\\'", [digits + '%', like_arg(qn)]
            else:
                w, args = " WHERE search LIKE ? ESCAPE '\\'", [like_arg(qn)]
        total = self.one('SELECT COUNT(*) FROM clients' + w, args)[0]
        rows = self.all('SELECT doc, rev FROM clients' + w + ' ORDER BY used_at DESC, updated DESC LIMIT ? OFFSET ?', args + [int(limit), int(offset)])
        return {'total': total, 'items': [dict(json.loads(r[0]), _rev=r[1] or 0) for r in rows]}

    def client_get(self, cid, rev=False):
        r = self.one('SELECT doc, rev FROM clients WHERE id=?', (cid,))
        if not r:
            return None
        d = json.loads(r[0])
        return dict(d, _rev=r[1] or 0) if rev else d

    def client_put(self, cid, doc, by='', base_rev=None):
        doc = {k: v for k, v in doc.items() if k != '_rev'} if isinstance(doc, dict) else doc
        with self.lock:
            c = self.conn()
            rev = self._next_rev(c, 'clients', cid, base_rev)
            c.execute('INSERT OR REPLACE INTO clients (id, doc, updated, name, inn, used_at, search, rev, updated_by) VALUES (?,?,?,?,?,?,?,?,?)',
                      (cid, json.dumps(doc, ensure_ascii=False), _now()) + client_cols(doc) + (rev, str(by or '')[:120]))
            c.commit()
        return rev

    def check_get(self, inn):
        r = self.one('SELECT doc FROM checks WHERE inn=?', (inn,))
        return json.loads(r[0]) if r else None

    def check_put(self, inn, doc):
        self.write('INSERT OR REPLACE INTO checks (inn, doc, checked) VALUES (?,?,?)', (inn, json.dumps(doc, ensure_ascii=False), _now()))

    # ---------- настройки ----------
    def kv_get(self, key, default=None):
        r = self.one('SELECT value FROM kv WHERE key=?', (key,))
        if not r:
            return default
        try:
            return json.loads(r[0])
        except Exception:
            return default

    def kv_set(self, key, value):
        self.write('INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)', (key, json.dumps(value, ensure_ascii=False)))

    def backup(self, dst):
        """Согласованная копия базы «на ходу» (встроенный механизм SQLite backup)."""
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with self.lock:
            out = sqlite3.connect(dst)
            try:
                self.conn().backup(out)
            finally:
                out.close()
        return dst

    # ---------- перенос прежних JSON-файлов ----------
    def migrate_json(self, data_dir, log=lambda s: None):
        """Однократно переносит каталог, журнал, контрагентов, проверки, ключи и типы из файлов в базу.
        Файлы не удаляются — папки остаются как резервная копия."""
        if self.kv_get('migrated_json'):
            return 0
        n = 0

        def rd(p):
            with open(p, 'r', encoding='utf-8-sig') as f:
                return f.read()
        cat = os.path.join(data_dir, 'catalog')
        if os.path.isdir(cat):
            for name in os.listdir(cat):
                if name.endswith('.json'):
                    try:
                        self.catalog_put(name[:-5], rd(os.path.join(cat, name)))
                        n += 1
                    except Exception as e:
                        log('catalog %s: %s' % (name, e))
        kpd = os.path.join(data_dir, 'kp')
        if os.path.isdir(kpd):
            for kid in os.listdir(kpd):
                d = os.path.join(kpd, kid)
                if not os.path.isdir(d):
                    continue
                for field, fn in (('state', 'state.json'), ('meta', 'meta.json'), ('docx', 'docx.txt')):
                    p = os.path.join(d, fn)
                    if os.path.isfile(p):
                        try:
                            self.kp_set(kid, field, rd(p).strip() if field == 'docx' else rd(p))
                        except Exception as e:
                            log('kp %s: %s' % (kid, e))
                n += 1
        for fn in os.listdir(data_dir) if os.path.isdir(data_dir) else []:
            m = re.match(r'^counter-(\d{4})\.txt$', fn)
            if m:
                try:
                    v = int(rd(os.path.join(data_dir, fn)).strip() or 0)
                    cur = self.one('SELECT n FROM counters WHERE year=?', (int(m.group(1)),))
                    if not cur or cur[0] < v:
                        self.write('INSERT OR REPLACE INTO counters (year, n) VALUES (?,?)', (int(m.group(1)), v))
                except Exception:
                    pass
        cl = os.path.join(data_dir, 'clients')
        if os.path.isdir(cl):
            for name in os.listdir(cl):
                if name.endswith('.json'):
                    try:
                        self.client_put(name[:-5], json.loads(rd(os.path.join(cl, name))))
                        n += 1
                    except Exception:
                        pass
        ch = os.path.join(data_dir, 'checks')
        if os.path.isdir(ch):
            for name in os.listdir(ch):
                if name.endswith('.json'):
                    try:
                        self.check_put(name[:-5], json.loads(rd(os.path.join(ch, name))))
                    except Exception:
                        pass
        for key, fn in (('integrations', 'integrations.json'), ('types', 'types.json')):
            p = os.path.join(data_dir, fn)
            if os.path.isfile(p):
                try:
                    self.kv_set(key, json.loads(rd(p)))
                except Exception:
                    pass
        self.kv_set('migrated_json', _now())
        return n
