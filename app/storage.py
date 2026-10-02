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
]
KP_VERSIONS = 30

# таблицы, строки которых удаляются в корзину целиком (все столбцы) и восстанавливаются из неё
TRASH_TABLES = {'kp': 'kp', 'catalog': 'catalog', 'manager': 'managers', 'client': 'clients', 'supplier': 'suppliers'}

# поля позиции, которые нужны списку каталога, фильтрам и быстрому поиску (без характеристик, описаний и галереи)
LIGHT_KEYS = ('id', 'name', 'spec', 'price', 'priceCur', 'cost', 'costCur', 'margin', 'mmode', 'kind', 'short', 'unit',
              'attrs', 'hint', 'photo', 'prices', 'options', 'updatedAt')


def _now():
    return datetime.now().isoformat(timespec='seconds')


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

    def catalog_get(self, cid):
        r = self.one('SELECT doc FROM catalog WHERE id=?', (cid,))
        return r[0] if r else None

    def catalog_put(self, cid, text):
        doc = json.loads(text)
        doc['id'] = cid
        a = doc.get('attrs') or {}
        self.write('INSERT OR REPLACE INTO catalog (id, doc, light, name, cat, maker, updated) VALUES (?,?,?,?,?,?,?)',
                   (cid, json.dumps(doc, ensure_ascii=False), json.dumps(light_of(doc), ensure_ascii=False),
                    doc.get('name', ''), a.get('cat', ''), a.get('maker', ''), _now()))

    def catalog_count(self):
        return self.one('SELECT COUNT(*) FROM catalog')[0]

    # ---------- миграции ----------
    def migrations_applied(self):
        return self.kv_get('schema') or []

    def migrations_up(self):
        done = self.migrations_applied()
        for mid, up, _down in MIGRATIONS:
            if mid not in done:
                with self.lock:
                    self.conn().executescript(up)
                    self.conn().commit()
                done = done + [mid]
                self.kv_set('schema', done)

    def migration_down(self, mid):
        """Откат миграции: её таблицы удаляются (данные в них теряются), остальная база не меняется."""
        down = next((d for i, _u, d in MIGRATIONS if i == mid), None)
        if down is None or mid not in self.migrations_applied():
            raise ValueError('Миграция не применена: %s' % mid)
        with self.lock:
            self.conn().executescript(down)
            self.conn().commit()
        self.kv_set('schema', [x for x in self.migrations_applied() if x != mid])

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
        return [json.loads(r[0]) for r in self.all('SELECT doc FROM suppliers ORDER BY name COLLATE NOCASE')]

    def supplier_get(self, sid):
        r = self.one('SELECT doc FROM suppliers WHERE id=?', (sid,))
        return json.loads(r[0]) if r else None

    def supplier_put(self, sid, doc):
        if not isinstance(doc, dict) or not str(doc.get('name') or '').strip():
            raise ValueError('Укажите название поставщика')
        doc = dict(doc, id=sid, name=str(doc['name']).strip()[:200], updatedAt=_now())
        self.write('INSERT OR REPLACE INTO suppliers (id, name, country, doc, updated) VALUES (?,?,?,?,?)',
                   (sid, doc['name'], str(doc.get('country') or '')[:80], json.dumps(doc, ensure_ascii=False), _now()))
        return doc

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
    def managers_list(self):
        rows = self.all('SELECT doc FROM managers ORDER BY name COLLATE NOCASE')
        return '[' + ','.join(r[0] for r in rows) + ']'

    def manager_put(self, mid, text):
        doc = json.loads(text)
        if not isinstance(doc, dict):
            raise ValueError('Ожидались данные менеджера')
        doc['id'] = mid
        doc['updatedAt'] = _now()
        self.write('INSERT OR REPLACE INTO managers (id, name, doc, updated) VALUES (?,?,?,?)',
                   (mid, str(doc.get('name') or ''), json.dumps(doc, ensure_ascii=False), _now()))
        return doc

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
        return '[' + ','.join(r[0] for r in rows) + ']'

    def kp_get(self, kid, field):
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        r = self.one('SELECT %s FROM kp WHERE id=?' % field, (kid,))
        return r[0] if r else None

    def kp_set(self, kid, field, value, by=''):
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        with self.lock:
            c = self.conn()
            old = c.execute('SELECT state, meta FROM kp WHERE id=?', (kid,)).fetchone()
            if not old:
                c.execute('INSERT INTO kp (id, number, updated) VALUES (?,?,?)', (kid, kid, _now()))
            elif field == 'state' and old[0] and old[0] != value:
                # прежнее состояние — в историю версий (лишнее сверх KP_VERSIONS удаляется)
                c.execute('INSERT INTO kp_versions (kp_id, created, user_name, state, meta) VALUES (?,?,?,?,?)', (kid, _now(), by, old[0], old[1]))
                c.execute('DELETE FROM kp_versions WHERE kp_id=? AND id NOT IN (SELECT id FROM kp_versions WHERE kp_id=? ORDER BY id DESC LIMIT ?)',
                          (kid, kid, KP_VERSIONS))
            c.execute('UPDATE kp SET %s=?, updated=? WHERE id=?' % field, (value, _now(), kid))
            c.commit()

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

    def client_get(self, cid):
        r = self.one('SELECT doc FROM clients WHERE id=?', (cid,))
        return json.loads(r[0]) if r else None

    def client_put(self, cid, doc):
        self.write('INSERT OR REPLACE INTO clients (id, doc, updated) VALUES (?,?,?)', (cid, json.dumps(doc, ensure_ascii=False), _now()))

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
