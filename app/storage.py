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
             остальные таблицы и данные не меняются).

Запись сериализуется одной блокировкой, база в режиме WAL: одновременное чтение многими пользователями
не мешает записи. При первом запуске данные из прежних JSON-файлов переносятся автоматически.
"""
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

    def catalog_delete(self, cid):
        self.write('DELETE FROM catalog WHERE id=?', (cid,))

    def catalog_count(self):
        return self.one('SELECT COUNT(*) FROM catalog')[0]

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

    def manager_delete(self, mid):
        self.write('DELETE FROM managers WHERE id=?', (mid,))

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

    def kp_set(self, kid, field, value):
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        with self.lock:
            c = self.conn()
            if not c.execute('SELECT 1 FROM kp WHERE id=?', (kid,)).fetchone():
                c.execute('INSERT INTO kp (id, number, updated) VALUES (?,?,?)', (kid, kid, _now()))
            c.execute('UPDATE kp SET %s=?, updated=? WHERE id=?' % field, (value, _now(), kid))
            c.commit()

    def kp_delete(self, kid):
        self.write('DELETE FROM kp WHERE id=?', (kid,))

    def kp_docx_all(self):
        return self.all('SELECT id, docx FROM kp WHERE docx IS NOT NULL')

    # ---------- контрагенты и проверки ----------
    def clients_all(self):
        return [json.loads(r[0]) for r in self.all('SELECT doc FROM clients ORDER BY updated DESC')]

    def client_get(self, cid):
        r = self.one('SELECT doc FROM clients WHERE id=?', (cid,))
        return json.loads(r[0]) if r else None

    def client_put(self, cid, doc):
        self.write('INSERT OR REPLACE INTO clients (id, doc, updated) VALUES (?,?,?)', (cid, json.dumps(doc, ensure_ascii=False), _now()))

    def client_delete(self, cid):
        self.write('DELETE FROM clients WHERE id=?', (cid,))

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
