"""Хранилище на SQLite (data/kp.sqlite3): таблицы, миграции (MIGRATIONS), блокировки, копии, справочники, КП."""

import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import zipfile
from datetime import datetime
from typing import Any, Literal

from defaults import SrvVal

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
    (
        '2026-10-admin',
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
     """,
    ),
    # «Экономика сделки»: справочник поставщиков (название, страна, условия) и коды ТН ВЭД / пошлины
    # (по категории оборудования — ключ cat:<тип>, по модели каталога — item:<id>)
    (
        '2026-11-deal',
        """
     CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, doc TEXT NOT NULL, updated TEXT);
     CREATE TABLE IF NOT EXISTS customs (key TEXT PRIMARY KEY, code TEXT, duty TEXT, note TEXT, updated TEXT, updated_by TEXT);
     """,
        """
     DROP TABLE IF EXISTS suppliers; DROP TABLE IF EXISTS customs;
     """,
    ),
    # свои категории в справочнике ТН ВЭД (ключ cat:x_<id>) — с названием
    (
        '2026-12-customs-name',
        """
     ALTER TABLE customs ADD COLUMN name TEXT;
     """,
        """
     CREATE TABLE customs_prev (key TEXT PRIMARY KEY, code TEXT, duty TEXT, note TEXT, updated TEXT, updated_by TEXT);
     INSERT INTO customs_prev SELECT key, code, duty, note, updated, updated_by FROM customs;
     DROP TABLE customs; ALTER TABLE customs_prev RENAME TO customs;
     """,
    ),
    # история версий КП: прежнее состояние сохраняется при каждом пересохранении КП (последние srv.kpVersions)
    (
        '2026-12-kp-versions',
        """
     CREATE TABLE IF NOT EXISTS kp_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, kp_id TEXT NOT NULL, created TEXT NOT NULL,
         user_name TEXT, state TEXT NOT NULL, meta TEXT);
     CREATE INDEX IF NOT EXISTS kp_versions_kp ON kp_versions(kp_id, id);
     """,
        """
     DROP TABLE IF EXISTS kp_versions;
     """,
    ),
    # номер правки (rev) и кто правил — защита от затирания при совместной работе;
    # поля для поиска и сортировки на сервере (контрагенты и журнал КП не грузятся целиком).
    # Новые столбцы заполняются из уже сохранённых документов (_fill_columns), данные не меняются.
    (
        '2027-01-db',
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
     """,
    ),
    # в облегчённой карточке каталога — фид-источник и артикул (фильтр «Поставщик», поиск по артикулу)
    (
        '2027-02-light',
        """
     CREATE INDEX IF NOT EXISTS catalog_maker ON catalog(maker);
     """,
        """
     DROP INDEX IF EXISTS catalog_maker;
     """,
    ),
    # ход сделки по КП — статус (отправлено, в работе, выиграно, проиграно), напоминание, отправки по почте.
    # Отдельно от описания КП (meta): пересохранение КП их не затирает. status и follow — для фильтров и напоминаний.
    (
        '2027-03-track',
        """
     ALTER TABLE kp ADD COLUMN track TEXT; ALTER TABLE kp ADD COLUMN status TEXT; ALTER TABLE kp ADD COLUMN follow TEXT;
     CREATE INDEX IF NOT EXISTS kp_status ON kp(status); CREATE INDEX IF NOT EXISTS kp_follow ON kp(follow);
     """,
        """
     DROP INDEX IF EXISTS kp_status; DROP INDEX IF EXISTS kp_follow;
     ALTER TABLE kp DROP COLUMN track; ALTER TABLE kp DROP COLUMN status; ALTER TABLE kp DROP COLUMN follow;
     """,
    ),
    # черновики КП на сервере (свои у каждого менеджера, автосохранение) и заготовки КП («как в прошлый раз»).
    # kind: draft | preset; owner — id менеджера (или «admin:логин»); kp — номер КП, если это несохранённые правки КП.
    (
        '2027-04-drafts',
        """
     CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', owner_name TEXT,
       title TEXT, client TEXT, kp TEXT, positions INTEGER, sum REAL, cur TEXT, updated TEXT, state TEXT);
     CREATE INDEX IF NOT EXISTS drafts_owner ON drafts(kind, owner, updated);
     """,
        """
     DROP TABLE IF EXISTS drafts;
     """,
    ),
    # история изменений настроек с откатом (app/settings_history.py): снимок «было — стало» без секретов.
    (
        '2027-05-settings-history',
        """
     CREATE TABLE IF NOT EXISTS settings_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, key TEXT NOT NULL,
       by TEXT, paths TEXT, before TEXT, after TEXT, rolled TEXT);
     CREATE INDEX IF NOT EXISTS settings_history_key ON settings_history(key, id);
     """,
        """
     DROP TABLE IF EXISTS settings_history;
     """,
    ),
    # облегчённые карточки каталога легче вдвое (каталог 6–10 тыс. позиций грузится в браузер быстрее и занимает меньше
    # памяти): без подсказки титула (hint — нужна только в КП, а туда позиция берётся целиком) и строка поиска без повторов слов.
    (
        '2027-06-light-slim',
        """
     SELECT 1;
     """,
        """
     SELECT 1;
     """,
    ),
    # каталог 20 000+ позиций. seq — номер изменения позиции (браузер хранит каталог у себя и докачивает только
    # изменённое: /api/catalog/sync), catalog_gone — удалённые позиции; search — строка поиска по характеристикам на сервере
    # (/api/catalog/search) вместо длинной строки в каждой карточке браузера.
    (
        '2027-07-catalog-sync',
        """
     ALTER TABLE catalog ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE catalog ADD COLUMN search TEXT;
     CREATE INDEX IF NOT EXISTS catalog_seq ON catalog(seq);
     CREATE TABLE IF NOT EXISTS catalog_gone (id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
     CREATE INDEX IF NOT EXISTS catalog_gone_seq ON catalog_gone(seq);
     """,
        """
     DROP INDEX IF EXISTS catalog_gone_seq; DROP TABLE IF EXISTS catalog_gone; DROP INDEX IF EXISTS catalog_seq;
     ALTER TABLE catalog DROP COLUMN search; ALTER TABLE catalog DROP COLUMN seq;
     """,
    ),
    # справочные документы к КП (app/kp_files.py): файлы — в data/kp_files/<номер КП>/, здесь — исходное имя, имя на диске,
    # размер, тип, примечание, кто и когда добавил. Строки остаются, пока КП в корзине; удалённое навсегда чистит KpFiles.purge.
    (
        '2027-08-kp-files',
        """
     CREATE TABLE IF NOT EXISTS kp_files (id INTEGER PRIMARY KEY AUTOINCREMENT, kp_id TEXT NOT NULL, name TEXT NOT NULL, file TEXT NOT NULL,
       size INTEGER NOT NULL DEFAULT 0, mime TEXT, note TEXT, added TEXT NOT NULL, added_by TEXT);
     CREATE INDEX IF NOT EXISTS kp_files_kp ON kp_files(kp_id, id);
     """,
        """
     DROP INDEX IF EXISTS kp_files_kp; DROP TABLE IF EXISTS kp_files;
     """,
    ),
    # кто прикрепил документ (код менеджера): автор может удалить свой файл в первые минуты после загрузки (kp.fileUndoMin)
    (
        '2027-09-kp-files-author',
        """
     ALTER TABLE kp_files ADD COLUMN added_by_id TEXT;
     """,
        """
     ALTER TABLE kp_files DROP COLUMN added_by_id;
     """,
    ),
    # кабинет менеджера (app/crm.py): сделки (описание — JSON), какие КП в какой сделке, дела менеджеров;
    # КП журнала сразу раскладываются по сделкам (DealBook.adopt)
    (
        '2027-10-crm',
        """
     CREATE TABLE IF NOT EXISTS deals (id TEXT PRIMARY KEY, doc TEXT NOT NULL, manager_id TEXT, stage TEXT, client TEXT, inn TEXT,
       updated TEXT, rev INTEGER NOT NULL DEFAULT 0, updated_by TEXT);
     CREATE INDEX IF NOT EXISTS deals_mgr ON deals(manager_id, stage);
     CREATE TABLE IF NOT EXISTS deal_kp (kp_id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, added TEXT);
     CREATE INDEX IF NOT EXISTS deal_kp_deal ON deal_kp(deal_id);
     CREATE TABLE IF NOT EXISTS crm_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id TEXT, manager_id TEXT, kind TEXT NOT NULL,
       due TEXT NOT NULL, time TEXT, title TEXT, note TEXT, state TEXT NOT NULL DEFAULT 'open', done_at TEXT, created TEXT, created_by TEXT);
     CREATE INDEX IF NOT EXISTS crm_tasks_mgr ON crm_tasks(manager_id, state, due);
     CREATE INDEX IF NOT EXISTS crm_tasks_deal ON crm_tasks(deal_id);
     """,
        """
     DROP INDEX IF EXISTS crm_tasks_deal; DROP INDEX IF EXISTS crm_tasks_mgr; DROP TABLE IF EXISTS crm_tasks;
     DROP INDEX IF EXISTS deal_kp_deal; DROP TABLE IF EXISTS deal_kp; DROP INDEX IF EXISTS deals_mgr; DROP TABLE IF EXISTS deals;
     DELETE FROM kv WHERE key = 'crm.seq';
     """,
    ),
    # связь с Битрикс24 (app/bitrix.py): соответствие записей и согласованные значения, очередь отправки, журнал обмена
    (
        '2027-11-bitrix',
        """
     CREATE TABLE IF NOT EXISTS bx_link (kind TEXT NOT NULL, local_id TEXT NOT NULL, bx_id TEXT NOT NULL, sent TEXT, at TEXT,
       PRIMARY KEY (kind, local_id));
     CREATE INDEX IF NOT EXISTS bx_link_bx ON bx_link(kind, bx_id);
     CREATE TABLE IF NOT EXISTS bx_queue (kind TEXT NOT NULL, local_id TEXT NOT NULL, added TEXT, tries INTEGER NOT NULL DEFAULT 0,
       error TEXT, next_at TEXT, PRIMARY KEY (kind, local_id));
     CREATE TABLE IF NOT EXISTS bx_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, level TEXT, text TEXT);
     """,
        """
     DROP TABLE IF EXISTS bx_log; DROP TABLE IF EXISTS bx_queue; DROP INDEX IF EXISTS bx_link_bx; DROP TABLE IF EXISTS bx_link;
     """,
    ),
    # скорость при 20 000 позиций и тысячах КП (аудит 18.10): фид позиции — столбцом с индексом (загрузка и проверка фида
    # не перебирают все карточки), сортировка по названию, производитель без учёта регистра, корзина по записи, файл КП,
    # журнал действий по пользователю и записи
    (
        '2027-12-indexes',
        """
     ALTER TABLE catalog ADD COLUMN feed_id TEXT;
     CREATE INDEX IF NOT EXISTS catalog_feed ON catalog(feed_id);
     CREATE INDEX IF NOT EXISTS catalog_name ON catalog(name);
     CREATE INDEX IF NOT EXISTS catalog_maker_nc ON catalog(maker COLLATE NOCASE);
     CREATE INDEX IF NOT EXISTS trash_entity ON trash(entity_type, entity_id);
     CREATE INDEX IF NOT EXISTS kp_docx ON kp(docx);
     CREATE INDEX IF NOT EXISTS audit_user ON audit(user_name);
     CREATE INDEX IF NOT EXISTS audit_entity ON audit(entity_type, entity_id);
     """,
        """
     DROP INDEX IF EXISTS audit_entity; DROP INDEX IF EXISTS audit_user; DROP INDEX IF EXISTS kp_docx; DROP INDEX IF EXISTS trash_entity;
     DROP INDEX IF EXISTS catalog_maker_nc; DROP INDEX IF EXISTS catalog_name; DROP INDEX IF EXISTS catalog_feed;
     ALTER TABLE catalog DROP COLUMN feed_id;
     """,
    ),
    # номер версии журнала КП: любая запись в таблицу kp (сохранение, ход сделки, корзина, загрузка) его увеличивает —
    # журнал держит разобранные описания в памяти и разбирает заново, только когда КП изменились (KpJournal.page)
    (
        '2027-13-kp-rev',
        """
     INSERT OR IGNORE INTO kv (key, value) VALUES ('datarev:kpj', '1');
     CREATE TRIGGER IF NOT EXISTS kp_rev_ins AFTER INSERT ON kp BEGIN UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'datarev:kpj'; END;
     CREATE TRIGGER IF NOT EXISTS kp_rev_upd AFTER UPDATE ON kp BEGIN UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'datarev:kpj'; END;
     CREATE TRIGGER IF NOT EXISTS kp_rev_del AFTER DELETE ON kp BEGIN UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'datarev:kpj'; END;
     """,
        """
     DROP TRIGGER IF EXISTS kp_rev_del; DROP TRIGGER IF EXISTS kp_rev_upd; DROP TRIGGER IF EXISTS kp_rev_ins;
     DELETE FROM kv WHERE key = 'datarev:kpj';
     """,
    ),
    # журнал обмена с Битрикс24 — менеджер записи (отбор журнала по менеджеру, тонкая настройка 19.10)
    (
        '2027-14-bitrix-log-mid',
        """
     ALTER TABLE bx_log ADD COLUMN mid TEXT;
     """,
        """
     ALTER TABLE bx_log DROP COLUMN mid;
     """,
    ),
]

# таблицы, строки которых удаляются в корзину целиком (все столбцы) и восстанавливаются из неё
TRASH_TABLES = {'kp': 'kp', 'catalog': 'catalog', 'manager': 'managers', 'client': 'clients', 'supplier': 'suppliers'}

# поля позиции, которые нужны списку каталога, фильтрам и быстрому поиску (без характеристик, описаний и галереи)
LIGHT_KEYS = (
    'id',
    'name',
    'spec',
    'price',
    'priceCur',
    'cost',
    'costCur',
    'margin',
    'mmode',
    'kind',
    'short',
    'unit',
    'attrs',
    'photo',
    'prices',
    'options',
    'updatedAt',
    'rrc',
    'stock',
    'priceSrc',
    'costSrc',
    'costDisc',
)


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def norm(text) -> str:
    """Строка для поиска — как norm() в интерфейсе: нижний регистр, ё → е, без кавычек, одинарные пробелы."""
    return re.sub(r'\s+', ' ', re.sub(r'[«»"]', '', str(text or '').lower().replace('ё', 'е'))).strip()


def like_arg(query) -> str:
    """Подстрока для LIKE … ESCAPE '\\' (символы % и _ ищутся как есть)."""
    return '%' + re.sub(r'([%_\\])', r'\\\1', query) + '%'


def with_track(meta, track) -> str:
    """Описание КП (строка JSON) с ходом сделки полем track."""
    if not track or not meta:
        return meta
    text = meta.rstrip()
    if not text.endswith('}'):
        return meta
    body = text[:-1].rstrip()
    sep = '' if body.endswith('{') else ','
    return f'{body}{sep}"track":{track}}}'


def with_rev(text, rev) -> str:
    """Документ JSON (строка) с номером правки _rev — по нему сохранение узнаёт, что запись успели изменить."""
    stripped = (text or '').lstrip()
    if not stripped.startswith('{'):
        return text
    body = stripped[1:].lstrip()
    sep = '' if body.startswith('}') else ','
    return f'{{"_rev":{int(rev or 0)}{sep}{body}'


class DbZip:
    """Копия базы в архиве ZIP: внутри один файл kp.sqlite3."""

    MEMBER = 'kp.sqlite3'
    LEVEL = 6
    CHUNK = 1 << 20

    @staticmethod
    def is_zip(path) -> bool:
        return str(path).lower().endswith('.zip')

    @classmethod
    def pack(cls, src, dst) -> str:
        """Файл базы → архив dst (сначала dst.part, затем переименование); проверка контрольных сумм записанного архива."""
        part = dst + '.part'
        try:
            with zipfile.ZipFile(part, 'w', zipfile.ZIP_DEFLATED, compresslevel=cls.LEVEL) as z:
                z.write(src, cls.MEMBER)
            cls.verify(part)
            os.replace(part, dst)
        finally:
            if os.path.exists(part):
                os.remove(part)
        return dst

    @classmethod
    def verify(cls, path) -> None:
        """Архив читается, в нём есть файл базы и контрольные суммы совпадают — иначе ValueError с причиной."""
        try:
            with zipfile.ZipFile(path) as z:
                if not cls.member(z):
                    raise ValueError('в архиве нет файла базы')
                bad = z.testzip()
        except (zipfile.BadZipFile, OSError) as exc:
            raise ValueError(f'архив копии не читается: {exc}') from exc
        if bad:
            raise ValueError(f'архив копии повреждён: {bad}')

    @staticmethod
    def member(z) -> str:
        """Имя файла базы внутри архива (kp.sqlite3, иначе первый .sqlite3 / .sqlite / .db) или ''."""
        names = [name for name in z.namelist() if name.lower().endswith(('.sqlite3', '.sqlite', '.db'))]
        return DbZip.MEMBER if DbZip.MEMBER in names else (names[0] if names else '')

    @classmethod
    def unpack(cls, src, dst) -> str:
        """Файл базы из архива src → dst (потоком, без чтения всей базы в память)."""
        with zipfile.ZipFile(src) as z:
            name = cls.member(z)
            if not name:
                raise ValueError('В архиве нет файла базы (.sqlite3)')
            with z.open(name) as src_file, open(dst, 'wb') as dst_file:
                while True:
                    chunk = src_file.read(cls.CHUNK)
                    if not chunk:
                        break
                    dst_file.write(chunk)
        return dst

    @staticmethod
    def integrity(path) -> str:
        """Полная проверка файла базы встроенной проверкой SQLite: 'ok' или текст ошибки."""
        return DbZip._pragma_check(path, 'PRAGMA integrity_check')

    @staticmethod
    def quick_check(path) -> str:
        """Быстрая проверка файла базы (без сверки индексов): 'ok' или текст ошибки."""
        return DbZip._pragma_check(path, 'PRAGMA quick_check')

    @staticmethod
    def _pragma_check(path, pragma: str) -> str:
        conn = sqlite3.connect(path, timeout=30)
        try:
            row = conn.execute(pragma).fetchall()
            return 'ok' if [x[0] for x in row] == ['ok'] else '; '.join(str(x[0]) for x in row[:5])
        finally:
            conn.close()


class Conflict(Exception):
    """Запись изменили после того, как её открыли: rev — текущий номер правки, by и at — кто и когда."""

    def __init__(self, rev, author: str, stamp) -> None:
        Exception.__init__(self, 'Запись уже изменена')
        self.rev, self.author, self.stamp = rev, author or '', stamp or ''

    def info(self) -> dict:
        return {'conflict': True, 'rev': self.rev, 'by': self.author, 'at': self.stamp}


def client_cols(doc) -> tuple:
    """Столбцы контрагента для поиска и сортировки."""
    data = doc if isinstance(doc, dict) else {}
    return (
        str(data.get('name') or '')[:300],
        re.sub(r'\D', '', str(data.get('inn') or ''))[:12],
        str(data.get('usedAt') or data.get('updatedAt') or '')[:40],
        norm(' '.join(str(data.get(k) or '') for k in ('name', 'full', 'inn', 'address')))[:1000],
    )


def kp_cols(meta) -> tuple:
    """Столбцы журнала КП из описания (meta) для поиска и фильтров."""
    data = meta if isinstance(meta, dict) else {}
    items = picked if isinstance(picked := data.get('items'), list) else []
    tender = picked if isinstance(picked := data.get('tender'), dict) else {}
    tnd = (
        ['тендер ' + str(tender['number'])] if tender.get('number') else []
    )  # поиск по номеру закупки и слову «тендер»
    return (
        str(data.get('client') or '')[:300],
        re.sub(r'\D', '', str(data.get('clientInn') or ''))[:12],
        str(data.get('manager') or '')[:200],
        str(data.get('date') or '')[:20],
        str(data.get('savedAt') or '')[:40],
        norm(
            ' '.join(
                [
                    str(data.get('number') or ''),
                    str(data.get('client') or ''),
                    str(data.get('clientInn') or ''),
                    str(data.get('manager') or ''),
                ]
                + tnd
                + [str(x) for x in items]
            )
        )[:1500],
    )


def _fill_columns(store, conn) -> None:
    """Миграция 2027-01-db: заполнить новые столбцы контрагентов и журнала КП из сохранённых документов."""
    for cid, doc in conn.execute('SELECT id, doc FROM clients').fetchall():
        try:
            data = json.loads(doc)
        except ValueError:
            data = {}
        conn.execute('UPDATE clients SET name=?, inn=?, used_at=?, search=? WHERE id=?', (*client_cols(data), cid))
    for kid, meta in conn.execute('SELECT id, meta FROM kp WHERE meta IS NOT NULL').fetchall():
        try:
            data = json.loads(meta)
        except ValueError:
            data = {}
        conn.execute(
            'UPDATE kp SET client=?, inn=?, manager=?, kdate=?, saved=?, search=? WHERE id=?', (*kp_cols(data), kid)
        )


def cat_search(doc) -> str:
    """Строка поиска позиции на сервере: название, описание строкой, параметры, характеристики, артикул (без повторов слов)."""
    attrs = picked if isinstance(picked := doc.get('attrs'), dict) else {}
    feed = picked if isinstance(picked := doc.get('feed'), dict) else {}
    parts = [doc.get('name'), doc.get('spec'), doc.get('short'), feed.get('sku')] + [
        v for v in attrs.values() if isinstance(v, (str, int, float))
    ]
    for group in doc.get('groups') or []:
        for row in (group.get('rows') or []) if isinstance(group, dict) else []:
            if isinstance(row, dict):
                parts.append('{} {}'.format(row.get('k', ''), row.get('v', '')))
    seen, words = set(), []
    for word in norm(' '.join(str(x) for x in parts if x not in (None, ''))).split():
        if word not in seen:
            seen.add(word)
            words.append(word)
    return ' '.join(words)[:6000]


def _fill_sync(store, conn) -> None:
    """Миграция 2027-07: строка поиска и номер изменения у всех позиций; облегчённые карточки — без строки поиска."""
    conn.execute(
        "INSERT INTO kv (key, value) VALUES ('datarev:catalog', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
    )
    seq = int(conn.execute("SELECT value FROM kv WHERE key='datarev:catalog'").fetchone()[0])
    for cid, doc in conn.execute('SELECT id, doc FROM catalog').fetchall():
        try:
            data = json.loads(doc)
        except ValueError:
            continue
        conn.execute(
            'UPDATE catalog SET light=?, search=?, seq=? WHERE id=?',
            (json.dumps(light_of(data), ensure_ascii=False), cat_search(data), seq, cid),
        )
    conn.execute('INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)', ('catepoch', json.dumps(os.urandom(6).hex())))


def _fill_light(store, conn) -> None:
    """Миграция 2027-02-light: облегчённые карточки каталога заново — с фидом-источником и артикулом (фильтр «Поставщик», поиск по артикулу)."""
    for cid, doc in conn.execute('SELECT id, doc FROM catalog').fetchall():
        try:
            data = json.loads(doc)
        except ValueError:
            continue
        conn.execute('UPDATE catalog SET light=? WHERE id=?', (json.dumps(light_of(data), ensure_ascii=False), cid))
    conn.execute(
        "INSERT INTO kv (key, value) VALUES ('datarev:catalog', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
    )


def _fill_crm(store, conn) -> None:
    """Миграция 2027-10-crm: КП журнала — по сделкам (одного клиента у одного менеджера с промежутком до 30 дней — одна сделка)."""
    from crm import DealBook

    DealBook(store)._adopt(conn)


def feed_of(doc) -> str | None:
    """Фид-источник позиции каталога (столбец feed_id) или None."""
    feed = picked if isinstance(doc, dict) and isinstance(picked := doc.get('feed'), dict) else {}
    return str(feed['id'])[:80] if feed.get('id') else None


def _fill_feed(store, conn) -> None:
    """Миграция 2027-12: фид-источник позиций — в столбец feed_id."""
    rows = []
    for cid, doc in conn.execute('SELECT id, doc FROM catalog WHERE doc LIKE \'%"feed"%\'').fetchall():
        try:
            feed = feed_of(json.loads(doc))
        except ValueError:
            continue
        if feed:
            rows.append((feed, cid))
    conn.executemany('UPDATE catalog SET feed_id=? WHERE id=?', rows)


MIGRATION_FILL = {
    '2027-01-db': _fill_columns,
    '2027-02-light': _fill_light,
    '2027-06-light-slim': _fill_light,
    '2027-07-catalog-sync': _fill_sync,
    '2027-10-crm': _fill_crm,
    '2027-12-indexes': _fill_feed,
}


def light_of(doc) -> dict:
    data = {k: doc[k] for k in LIGHT_KEYS if k in doc}
    if isinstance(data.get('prices'), list):
        data['prices'] = data['prices'][:5]
        data['pricesCount'] = len(doc.get('prices') or [])
    # поиск по значениям характеристик — на сервере (столбец search, /api/catalog/search), в карточке браузера его нет
    feed = picked if isinstance(picked := doc.get('feed'), dict) else {}
    if feed.get('id'):  # фид-источник — фильтр «Поставщик» в каталоге
        data['src'] = str(feed['id'])[:40]
    art = feed.get('sku') or (picked if isinstance(picked := doc.get('attrs'), dict) else {}).get('article')
    if art:  # артикул поставщика — поиск по артикулу
        data['art'] = str(art)[:60]
    data['_light'] = True
    return data


class DocLimits:
    """Границы документа справочника из запроса: имена полей, глубина, длина строк и списков, размер."""

    KEY = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,59}\Z')
    MAX_BYTES, MAX_STR, MAX_LIST, MAX_KEYS, MAX_DEPTH = 512 * 1024, 10000, 2000, 200, 6

    @classmethod
    def check(cls, doc, what) -> None:
        if len(json.dumps(doc, ensure_ascii=False)) > cls.MAX_BYTES:
            raise ValueError(f'{what} слишком большая')
        cls._walk(doc, what, 0)

    @classmethod
    def _walk(cls, v, what, depth) -> None:
        if depth > cls.MAX_DEPTH:
            raise ValueError(f'{what}: слишком глубокая вложенность')
        if isinstance(v, dict):
            if len(v) > cls.MAX_KEYS:
                raise ValueError(f'{what}: слишком много полей')
            for k, x in v.items():
                if not cls.KEY.match(str(k)):
                    raise ValueError(f'{what}: недопустимое имя поля')
                cls._walk(x, what, depth + 1)
        elif isinstance(v, list):
            if len(v) > cls.MAX_LIST:
                raise ValueError(f'{what}: слишком длинный список')
            for x in v:
                cls._walk(x, what, depth + 1)
        elif isinstance(v, str) and len(v) > cls.MAX_STR:
            raise ValueError(f'{what}: слишком длинное значение')


# журнал КП — новые сверху: номер «год-NNN» по числу (строкой «2026-1000» < «2026-999»)
KP_ORDER = 'substr(id, 1, 5) DESC, length(id) DESC, id DESC'


class TxLock:
    """Блокировка записи в базу (повторно входимая)."""

    def __init__(self, store) -> None:
        self.store = store
        self.rlock = threading.RLock()
        self.depth = threading.local()

    def acquire(self, *args, **k) -> bool:
        ok = self.rlock.acquire(*args, **k)
        if ok:
            self.depth.n = getattr(self.depth, 'n', 0) + 1
        return ok

    def release(self) -> None:
        self.depth.n -= 1
        self.rlock.release()

    def __enter__(self) -> 'TxLock':
        self.acquire()
        return self

    def __exit__(self, exc_type, exc_val, trace) -> Literal[False]:
        try:
            if exc_type is not None and self.depth.n == 1:
                conn = getattr(self.store.local, 'c', None)
                if conn is not None and conn.in_transaction:
                    conn.rollback()
        finally:
            self.release()
        return False


class WriteBatch:
    """Запись пачками по SIZE в транзакции; между пачками блокировка отпускается (сохранение КП не ждёт долго)."""

    SIZE = 500

    def __init__(self, store, size=None) -> None:
        self.store, self.size, self.count = store, size or self.SIZE, 0

    def __enter__(self) -> 'WriteBatch':
        self.store.lock.acquire()
        return self

    def step(self) -> None:
        self.count += 1
        if self.count % self.size == 0:
            self.store.conn().commit()
            self.store.lock.release()
            self.store.lock.acquire()

    def __exit__(self, exc_type, exc_val, trace) -> Literal[False]:
        try:
            conn = self.store.conn()
            if exc_type is None:
                conn.commit()
            elif conn.in_transaction:
                conn.rollback()
        finally:
            self.store.lock.release()
        return False


class Store:
    NAME_WORDS = 2
    MOBILE_DIGITS = 10

    def __init__(self, path) -> None:
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.local = threading.local()
        self.lock = TxLock(self)
        conn = self.conn()
        conn.executescript(SCHEMA)
        conn.commit()
        self.migrations_up()

    def conn(self) -> sqlite3.Connection:
        conn = getattr(self.local, 'c', None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA synchronous=NORMAL')
            conn.execute('PRAGMA foreign_keys=ON')
            self.local.c = conn
        return conn

    def _next_rev(self, conn, table, key, base_rev) -> int:
        """Номер следующей правки записи; base_rev (с какой правки начинали) не совпал — Conflict."""
        row = conn.execute(f'SELECT rev, updated_by, updated FROM {table} WHERE id=?', (key,)).fetchone()
        cur = (row[0] or 0) if row else 0
        if base_rev not in (None, '') and row and int(base_rev) != cur:
            raise Conflict(cur, row[1], row[2])
        return cur + 1

    def catalog_revs(self) -> dict:
        """{id позиции каталога: номер правки} — снимок перед долгой записью (загрузка фида)."""
        return {i: row or 0 for i, row in self.all('SELECT id, rev FROM catalog')}

    def rev_of(self, table, key) -> dict:
        if table not in ('kp', 'catalog', 'clients', 'managers', 'suppliers', 'deals'):
            raise ValueError(table)
        row = self.one(f'SELECT rev, updated_by, updated FROM {table} WHERE id=?', (key,))
        return {
            'rev': (row[0] or 0) if row else 0,
            'by': (row[1] or '') if row else '',
            'at': (row[2] or '') if row else '',
        }

    def write(self, sql, args=()) -> None:
        with self.lock:
            conn = self.conn()
            conn.execute(sql, args)
            conn.commit()

    def one(self, sql, args=()) -> tuple | None:
        return self.conn().execute(sql, args).fetchone()

    def scalar(self, sql, args=()) -> Any:
        """Первое значение первой строки (COUNT, MAX…); строки нет — None."""
        row = self.one(sql, args)
        return row[0] if row else None

    def all(self, sql, args=()) -> list:
        return self.conn().execute(sql, args).fetchall()

    def joined(self, sql, args=(), sep=',') -> str:
        """Первый столбец выборки одной строкой через sep — склеивает сама база."""
        try:
            res = self.one(f'SELECT group_concat(x, ?) FROM ({sql})', (sep, *tuple(args)))
        except (sqlite3.DataError, sqlite3.OperationalError) as exc:
            if 'too big' not in str(exc):
                raise
            return sep.join(
                row[0] for row in self.all(sql, args) if row[0] is not None
            )  # больше 1 ГБ одной строкой — по строкам
        return (res[0] or '') if res else ''

    def catalog_light(self) -> str:
        return '[' + self.joined('SELECT light AS x FROM catalog ORDER BY name') + ']'

    def catalog_full(self) -> str:
        return '[' + self.joined('SELECT doc AS x FROM catalog ORDER BY name') + ']'

    def catalog_get(self, cid) -> str | None:
        row = self.one('SELECT doc FROM catalog WHERE id=?', (cid,))
        return row[0] if row else None

    def catalog_get_rev(self, cid) -> str | None:
        """Позиция каталога с номером правки (_rev) — для совместной правки."""
        row = self.one('SELECT doc, rev FROM catalog WHERE id=?', (cid,))
        return with_rev(row[0], row[1]) if row else None

    def catalog_put(self, cid, text, author: str = '', base_rev=None) -> int:
        with self.lock:
            conn = self.conn()
            rev = self._catalog_row(conn, cid, text, author, base_rev)
            conn.commit()
        return rev

    def catalog_stage(self, cid, text, author: str = '', base_rev=None) -> int:
        """Запись позиции без фиксации — фиксирует пачка WriteBatch вызывающего."""
        with self.lock:
            return self._catalog_row(self.conn(), cid, text, author, base_rev)

    def _catalog_row(self, conn, cid, text, author, base_rev) -> int:
        doc = json.loads(text)
        doc['id'] = cid
        doc.pop('_rev', None)
        attrs = picked if isinstance(picked := doc.get('attrs'), dict) else {}
        rev = self._next_rev(conn, 'catalog', cid, base_rev)
        seq = self._cat_seq(conn)
        conn.execute(
            'INSERT OR REPLACE INTO catalog (id, doc, light, name, cat, maker, updated, rev, updated_by, seq, search, feed_id) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (
                cid,
                json.dumps(doc, ensure_ascii=False),
                json.dumps(light_of(doc), ensure_ascii=False),
                doc.get('name', ''),
                attrs.get('cat', ''),
                attrs.get('maker', ''),
                _now(),
                rev,
                str(author or '')[:120],
                seq,
                cat_search(doc),
                feed_of(doc),
            ),
        )
        conn.execute('DELETE FROM catalog_gone WHERE id=?', (cid,))
        return rev

    def _cat_seq(self, conn) -> int:
        """Новый номер изменения каталога (он же версия справочника «каталог»)."""
        self._bump_data(conn, 'catalog')
        return int(conn.execute("SELECT value FROM kv WHERE key='datarev:catalog'").fetchone()[0])

    def catalog_epoch(self) -> str:
        """Метка «поколения» каталога: меняется, когда база заменена целиком, — браузеры тогда загружают каталог заново."""
        epoch = self.kv_get('catepoch')
        if not epoch:
            epoch = os.urandom(6).hex()
            self.write('INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)', ('catepoch', json.dumps(epoch)))
        return epoch

    def _bump_data(self, conn, name) -> None:
        conn.execute(
            "INSERT INTO kv (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
            ('datarev:' + name,),
        )

    def touch_data(self, *names) -> None:
        """Справочники изменены не через свои методы (загрузка копии) — браузеры перекачают их."""
        with self.lock:
            conn = self.conn()
            for name in names:
                self._bump_data(conn, name)
            conn.commit()

    def data_rev(self, name) -> str:
        row = self.one('SELECT value FROM kv WHERE key=?', ('datarev:' + name,))
        return str(row[0]) if row else '0'

    def catalog_count(self) -> int:
        return self.scalar('SELECT COUNT(*) FROM catalog')

    def migrations_applied(self) -> list:
        return self.kv_get('schema') or []

    @staticmethod
    def _idempotent(conn, script) -> str:
        """ADD COLUMN — только если столбца нет, DROP COLUMN — только если есть (база без отметки «schema»)."""

        def keep(match) -> str:
            have = {row[1] for row in conn.execute('PRAGMA table_info({})'.format(match.group('t')))}
            exists = match.group('col') in have
            return match.group(0) if (match.group('op').upper() == 'ADD') != exists else ''

        return re.sub(r'ALTER TABLE (?P<t>\w+) (?P<op>ADD|DROP) COLUMN (?P<col>\w+)[^;]*;', keep, script, flags=re.I)

    def _atomic_script(self, script, then=None, mark=None) -> None:
        """Схема, заполнение и отметка в kv «schema» — одной транзакцией: при сбое база остаётся как была."""
        with self.lock:
            conn = self.conn()
            conn.commit()
            try:
                conn.executescript('BEGIN IMMEDIATE;\n' + self._idempotent(conn, script))
                if then:
                    then(self, conn)
                if mark is not None:
                    conn.execute(
                        'INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)',
                        ('schema', json.dumps(mark, ensure_ascii=False)),
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def migrations_up(self) -> None:
        done = self.migrations_applied()
        todo = [x for x in MIGRATIONS if x[0] not in done]
        if todo and done:  # база с данными: перед изменением структуры — копия в data/backup
            self.backup(
                os.path.join(
                    os.path.dirname(self.path),
                    'backup',
                    'kp-{}-before-{}.zip'.format(datetime.now().strftime('%Y%m%d-%H%M%S'), todo[0][0]),
                )
            )
        for mid, step, _down in todo:
            done = [*done, mid]
            self._atomic_script(step, MIGRATION_FILL.get(mid), done)

    def migration_last(self) -> str | None:
        """Последняя применённая миграция — откатить можно только её."""
        done = self.migrations_applied()
        return next((i for i, _u, _desc in reversed(MIGRATIONS) if i in done), None)

    def migration_down(self, mid: str) -> None:
        """Откат последней миграции: её таблицы и столбцы удаляются (данные в них теряются), остальная база не меняется."""
        down = next((desc for i, _u, desc in MIGRATIONS if i == mid), None)
        if down is None or mid not in self.migrations_applied():
            raise ValueError(f'Миграция не применена: {mid}')
        if mid != self.migration_last():
            raise ValueError(
                f'Откатить можно только последнюю миграцию ({self.migration_last()}): поздние миграции меняют таблицы ранних'
            )
        self._atomic_script(down, None, [x for x in self.migrations_applied() if x != mid])

    def audit_add(self, rec) -> None:
        self.write(
            'INSERT INTO audit (ts, user_id, user_name, role, action, entity_type, entity_id, before, after, ip, ua, result) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (
                rec.get('timestamp') or _now(),
                rec.get('userId'),
                rec.get('userName'),
                rec.get('userRole'),
                rec['action'],
                rec.get('entityType'),
                rec.get('entityId'),
                None if rec.get('before') is None else json.dumps(rec['before'], ensure_ascii=False),
                None if rec.get('after') is None else json.dumps(rec['after'], ensure_ascii=False),
                rec.get('ip'),
                (rec.get('userAgent') or '')[:300],
                rec.get('result') or 'success',
            ),
        )

    AUDIT_COLS = (
        'id',
        'timestamp',
        'userId',
        'userName',
        'userRole',
        'action',
        'entityType',
        'entityId',
        'before',
        'after',
        'ip',
        'userAgent',
        'result',
    )

    def _audit_row(self, row) -> dict:
        data = dict(zip(self.AUDIT_COLS, row, strict=False))
        for k in ('before', 'after'):
            if data[k]:
                try:
                    data[k] = json.loads(data[k])
                except Exception:
                    pass
        return data

    def audit_query(self, filt, limit: int = 50, offset: int = 0) -> dict:
        """Записи журнала действий по фильтрам: user, action, entity, q (поиск), from, to (даты ГГГГ-ММ-ДД)."""
        where, args = [], []
        if filt.get('user'):
            where.append('user_name = ?')
            args.append(filt['user'])
        if filt.get('action'):
            where.append('action = ?')
            args.append(filt['action'])
        if filt.get('entity'):
            where.append('entity_type = ?')
            args.append(filt['entity'])
        if filt.get('from'):
            where.append('ts >= ?')
            args.append(filt['from'])
        if filt.get('to'):
            where.append('ts < ?')
            args.append(filt['to'] + 'T99')
        if filt.get('q'):
            where.append(
                "(entity_id LIKE ? ESCAPE '\\' OR user_name LIKE ? ESCAPE '\\' OR after LIKE ? ESCAPE '\\' OR before LIKE ? ESCAPE '\\')"
            )
            args += [like_arg(filt['q'])] * 4
        where_sql = (' WHERE ' + ' AND '.join(where)) if where else ''
        total = self.scalar('SELECT COUNT(*) FROM audit' + where_sql, args)
        rows = self.all(
            'SELECT id, ts, user_id, user_name, role, action, entity_type, entity_id, before, after, ip, ua, result '
            'FROM audit' + where_sql + ' ORDER BY id DESC LIMIT ? OFFSET ?',
            [*args, int(limit), int(offset)],
        )
        return {'total': total, 'items': [self._audit_row(row) for row in rows]}

    def audit_get(self, aid) -> dict | None:
        row = self.one(
            'SELECT id, ts, user_id, user_name, role, action, entity_type, entity_id, before, after, ip, ua, result '
            'FROM audit WHERE id=?',
            (aid,),
        )
        return self._audit_row(row) if row else None

    def audit_distinct(self, col) -> list:
        if col not in ('user_name', 'action', 'entity_type'):
            raise ValueError(col)
        return [
            row[0]
            for row in self.all(f'SELECT DISTINCT {col} FROM audit WHERE {col} IS NOT NULL AND {col} <> "" ORDER BY 1')
        ]

    def trash_put(self, etype, eid, title, author: str) -> dict | None:
        table = TRASH_TABLES[etype]
        with self.lock:
            conn = self.conn()
            cur = conn.execute(f'SELECT * FROM {table} WHERE id=?', (eid,))
            row = cur.fetchone()
            if not row:
                return None
            data = dict(zip([x[0] for x in cur.description], row, strict=False))
            conn.execute(
                'INSERT INTO trash (entity_type, entity_id, title, data, deleted_at, deleted_by) VALUES (?,?,?,?,?,?)',
                (etype, eid, title, json.dumps(data, ensure_ascii=False), _now(), author),
            )
            conn.execute(f'DELETE FROM {table} WHERE id=?', (eid,))
            if table == 'catalog':  # браузеры уберут позицию при следующей догрузке изменений
                conn.execute('INSERT OR REPLACE INTO catalog_gone (id, seq) VALUES (?,?)', (eid, self._cat_seq(conn)))
            elif table in ('managers', 'suppliers'):
                self._bump_data(conn, table)
            conn.commit()
        return data

    def trash_put_many(self, etype, rows, author: str) -> int:
        """Много записей в корзину одной транзакцией (позиции фида — тысячи): rows — [(id, название)]. → сколько перенесено."""
        table, count = TRASH_TABLES[etype], 0
        with self.lock:
            conn = self.conn()
            for eid, title in rows:
                cur = conn.execute(f'SELECT * FROM {table} WHERE id=?', (eid,))
                row = cur.fetchone()
                if not row:
                    continue
                data = dict(zip([x[0] for x in cur.description], row, strict=False))
                conn.execute(
                    'INSERT INTO trash (entity_type, entity_id, title, data, deleted_at, deleted_by) VALUES (?,?,?,?,?,?)',
                    (etype, eid, title, json.dumps(data, ensure_ascii=False), _now(), author),
                )
                conn.execute(f'DELETE FROM {table} WHERE id=?', (eid,))
                if table == 'catalog':
                    conn.execute(
                        'INSERT OR REPLACE INTO catalog_gone (id, seq) VALUES (?,?)', (eid, self._cat_seq(conn))
                    )
                count += 1
            if count and table in ('managers', 'suppliers'):
                self._bump_data(conn, table)
            conn.commit()
        return count

    def trash_list(self) -> list:
        return [
            dict(zip(('id', 'entityType', 'entityId', 'title', 'deletedAt', 'deletedBy'), row, strict=False))
            for row in self.all(
                'SELECT id, entity_type, entity_id, title, deleted_at, deleted_by FROM trash ORDER BY id DESC'
            )
        ]

    def trash_restore(self, tid: str) -> tuple:
        row = self.one('SELECT entity_type, entity_id, data FROM trash WHERE id=?', (tid,))
        if not row:
            raise ValueError('Нет такой записи в корзине')
        etype, eid, data = row[0], row[1], json.loads(row[2])
        table = TRASH_TABLES[etype]
        with self.lock:
            conn = self.conn()
            if conn.execute(f'SELECT 1 FROM {table} WHERE id=?', (eid,)).fetchone():
                raise ValueError('Запись с таким id уже есть — восстановление заменило бы её')
            have = {x[1] for x in conn.execute(f'PRAGMA table_info({table})')}
            cols = [
                k for k in data if k in have
            ]  # поля записи корзины — только столбцы таблицы (запись могла прийти из файла)
            conn.execute(
                'INSERT INTO {} ({}) VALUES ({})'.format(table, ','.join(cols), ','.join('?' * len(cols))),
                [data[k] for k in cols],
            )
            conn.execute('DELETE FROM trash WHERE id=?', (tid,))
            # удалённое прежней версией — без полей для поиска: заполняем их по документу
            if table == 'clients':
                conn.execute(
                    'UPDATE clients SET name=?, inn=?, used_at=?, search=? WHERE id=?',
                    (*client_cols(json.loads(data.get('doc') or '{}')), eid),
                )
            elif table == 'kp' and data.get('meta'):
                try:
                    conn.execute(
                        'UPDATE kp SET client=?, inn=?, manager=?, kdate=?, saved=?, search=? WHERE id=?',
                        (*kp_cols(json.loads(data['meta'])), eid),
                    )
                except ValueError:
                    pass
            if table == 'catalog':
                try:
                    doc = json.loads(data.get('doc') or '{}')
                except ValueError:
                    doc = {}
                conn.execute(
                    'UPDATE catalog SET seq=?, search=?, light=?, feed_id=? WHERE id=?',
                    (
                        self._cat_seq(conn),
                        cat_search(doc),
                        json.dumps(light_of(doc), ensure_ascii=False),
                        feed_of(doc),
                        eid,
                    ),
                )
                conn.execute('DELETE FROM catalog_gone WHERE id=?', (eid,))
            elif table in ('managers', 'suppliers'):
                self._bump_data(conn, table)
            conn.commit()
        return etype, eid

    def trash_drop(self, tid: str) -> dict | None:
        """Удалить навсегда одну запись корзины → {entityType, entityId, title} или None."""
        row = self.one('SELECT entity_type, entity_id, title FROM trash WHERE id=?', (tid,))
        if not row:
            return None
        self.write('DELETE FROM trash WHERE id=?', (tid,))
        self._kp_orphans()
        return {'entityType': row[0], 'entityId': row[1], 'title': row[2]}

    def trash_clear(self, etype=None) -> int:
        """«Очистить корзину»: всё или записи одного вида → сколько удалено навсегда."""
        where, args = ('WHERE entity_type=?', (etype,)) if etype else ('', ())
        count = self.scalar('SELECT COUNT(*) FROM trash ' + where, args)
        if count:
            self.write('DELETE FROM trash ' + where, args)
            self._kp_orphans()
        return count

    def trash_purge(self, days) -> int:
        """Окончательно удалить то, что лежит в корзине дольше days дней."""
        from datetime import timedelta

        edge = (datetime.now() - timedelta(days=days)).isoformat(timespec='seconds')
        count = self.scalar('SELECT COUNT(*) FROM trash WHERE deleted_at < ?', (edge,))
        if count:
            self.write('DELETE FROM trash WHERE deleted_at < ?', (edge,))
            self._kp_orphans()
        return count

    def _kp_orphans(self) -> None:
        """Версии КП, удалённых навсегда (нет ни в журнале, ни в корзине), — тоже удалить: в них клиент и цены."""
        self.write(
            'DELETE FROM kp_versions WHERE kp_id NOT IN (SELECT id FROM kp) '
            "AND kp_id NOT IN (SELECT entity_id FROM trash WHERE entity_type='kp')"
        )

    PENDING_COLS = (
        'id',
        'productId',
        'kind',
        'before',
        'after',
        'userId',
        'userName',
        'created',
        'status',
        'reviewedBy',
        'reviewedAt',
        'reason',
    )

    def pending_add(self, pid, kind, before, after, uid: str, uname) -> int:
        with self.lock:
            conn = self.conn()
            cur = conn.execute(
                'INSERT INTO pending_edits (product_id, kind, before, after, user_id, user_name, created) VALUES (?,?,?,?,?,?,?)',
                (pid, kind, before, after, uid, uname, _now()),
            )
            conn.commit()
            return cur.lastrowid or 0

    def pending_list(self, status='pending') -> list:
        """Правки на модерации без содержимого (до и после)."""
        return self._pending_rows(status, 'NULL, NULL')

    def pending_docs(self, status='pending') -> list:
        """Правки на модерации с содержимым (до и после)."""
        return self._pending_rows(status, 'before, after')

    def _pending_rows(self, status, docs_cols: str) -> list:
        cols = (
            f'id, product_id, kind, {docs_cols}, user_id, user_name, created, status, reviewed_by, reviewed_at, reason'
        )
        rows = self.all(f'SELECT {cols} FROM pending_edits WHERE status=? ORDER BY id DESC', (status,))
        return [dict(zip(self.PENDING_COLS, row, strict=False)) for row in rows]

    def pending_get(self, eid) -> dict | None:
        row = self.one(
            'SELECT id, product_id, kind, before, after, user_id, user_name, created, status, reviewed_by, reviewed_at, reason '
            'FROM pending_edits WHERE id=?',
            (eid,),
        )
        return dict(zip(self.PENDING_COLS, row, strict=False)) if row else None

    def pending_set(self, eid, status, author: str, reason='') -> None:
        self.write(
            'UPDATE pending_edits SET status=?, reviewed_by=?, reviewed_at=?, reason=? WHERE id=?',
            (status, author, _now(), reason, eid),
        )

    def pending_claim(self, eid) -> bool:
        """Занять правку для принятия: True — только у первого из одновременных «Принять»."""
        with self.lock:
            conn = self.conn()
            count = conn.execute(
                "UPDATE pending_edits SET status='approving' WHERE id=? AND status='pending'", (eid,)
            ).rowcount
            conn.commit()
            return count == 1

    def pending_ids(self) -> list:
        return [row[0] for row in self.all("SELECT DISTINCT product_id FROM pending_edits WHERE status='pending'")]

    def table_counts(self) -> dict:
        out = {}
        for (table,) in self.all(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ):
            out[table] = self.scalar(f'SELECT COUNT(*) FROM "{table}"')
        return out

    def kp_all_meta(self) -> list:
        """Описания всех КП; испорченное пропускается, как в kp_list."""
        out = []
        for (meta,) in self.all('SELECT meta FROM kp WHERE meta IS NOT NULL'):
            try:
                data = json.loads(meta)
            except (TypeError, ValueError):
                continue
            if isinstance(data, dict):
                out.append(data)
        return out

    def suppliers_list(self) -> list:
        self._deal_legacy()
        return [
            dict(json.loads(row[0]), _rev=row[1] or 0)
            for row in self.all('SELECT doc, rev FROM suppliers ORDER BY name COLLATE NOCASE')
        ]

    def supplier_get(self, sid) -> dict | None:
        row = self.one('SELECT doc FROM suppliers WHERE id=?', (sid,))
        return json.loads(row[0]) if row else None

    def supplier_put(self, sid, doc, author: str = '', base_rev=None) -> dict:
        if not isinstance(doc, dict) or not str(doc.get('name') or '').strip():
            raise ValueError('Укажите название поставщика')
        DocLimits.check(doc, 'Карточка поставщика')
        if base_rev is None and doc.get('_rev') is not None:
            base_rev = doc.get('_rev')
        doc = {k: v for k, v in doc.items() if k != '_rev'}
        doc = dict(doc, id=sid, name=str(doc['name']).strip()[:200], updatedAt=_now())
        with self.lock:
            conn = self.conn()
            rev = self._next_rev(conn, 'suppliers', sid, base_rev)
            conn.execute(
                'INSERT OR REPLACE INTO suppliers (id, name, country, doc, updated, rev, updated_by) VALUES (?,?,?,?,?,?,?)',
                (
                    sid,
                    doc['name'],
                    str(doc.get('country') or '')[:80],
                    json.dumps(doc, ensure_ascii=False),
                    _now(),
                    rev,
                    str(author or '')[:120],
                ),
            )
            self._bump_data(conn, 'suppliers')
            conn.commit()
        return dict(doc, _rev=rev)

    def customs_all(self) -> dict:
        self._deal_legacy()
        out = {}
        for key, code, duty, note, upd, author, name in self.all(
            'SELECT key, code, duty, note, updated, updated_by, name FROM customs'
        ):
            out[key] = {
                'code': code or '',
                'duty': duty or '',
                'note': note or '',
                'name': name or '',
                'updated': upd,
                'by': author or '',
            }
        return out

    def customs_put(self, key, code, duty, note, author: str, name='') -> None:
        """Код ТН ВЭД и ставка по ключу cat:<категория> или item:<модель>; своя пустая категория удаляется."""
        if not isinstance(key, str) or not re.match(r'^(cat|item):[\w.-]{1,80}$', key):
            raise ValueError('Неверный ключ')
        if key.startswith('cat:x_') and not str(name or '').strip():
            if str(code or '').strip() or str(duty or '').strip():
                raise ValueError('Укажите название категории')
            self.write('DELETE FROM customs WHERE key=?', (key,))
            return
        self.write(
            'INSERT OR REPLACE INTO customs (key, code, duty, note, updated, updated_by, name) VALUES (?,?,?,?,?,?,?)',
            (
                key,
                str(code or '')[:40],
                str(duty or '')[:12],
                str(note or '')[:300],
                _now(),
                str(author or '')[:120],
                str(name or '')[:120],
            ),
        )

    def _deal_legacy(self) -> None:
        """Перенос подсказок прежней версии (kv dealProfiles) в справочники — один раз."""
        old = self.kv_get('dealProfiles')
        if not old:
            return
        for name, part in (old.get('sup') or {}).items():
            sid = 'sup_' + hashlib.md5(name.strip().lower().encode('utf-8')).hexdigest()[:10]
            if isinstance(part, dict) and not self.one('SELECT 1 FROM suppliers WHERE name=? COLLATE NOCASE', (name,)):
                self.supplier_put(sid, dict(part, name=name))
        for cat, duty in (old.get('duty') or {}).items():
            if not self.one('SELECT 1 FROM customs WHERE key=?', ('cat:' + cat,)):
                self.customs_put('cat:' + cat, '', duty, '', 'перенос')
        self.write("DELETE FROM kv WHERE key='dealProfiles'")

    def managers_list(self) -> str:
        rows = self.all('SELECT doc FROM managers ORDER BY name COLLATE NOCASE')
        return '[' + ','.join(row[0] for row in rows) + ']'

    def managers_list_rev(self) -> str:
        """Менеджеры с номерами правки (_rev) — для совместной правки."""
        rows = self.all('SELECT doc, rev FROM managers ORDER BY name COLLATE NOCASE')
        return '[' + ','.join(with_rev(row[0], row[1]) for row in rows) + ']'

    @staticmethod
    def manager_keys(doc) -> dict:
        """Признаки одного и того же человека: фамилия и имя, e-mail, мобильный (последние 10 цифр), добавочный."""
        words = re.sub(r'\s+', ' ', str(doc.get('name') or '').lower().replace('ё', 'е')).strip().split(' ')
        mob = re.sub(r'\D', '', str(doc.get('mobile') or ''))[-10:]
        return {
            'name': ' '.join(words[:2]) if len(words) >= Store.NAME_WORDS else '',
            'email': str(doc.get('email') or '').strip().lower(),
            'mobile': mob if len(mob) == Store.MOBILE_DIGITS else '',
            'ext': re.sub(r'\D', '', str(doc.get('ext') or '')),
        }

    def manager_dup(self, mid: str, doc) -> tuple | None:
        """Другой менеджер с теми же фамилией и именем, e-mail, мобильным или добавочным: (менеджер, что совпало) или None."""
        mine = self.manager_keys(doc)
        what = {'name': 'фамилия и имя', 'email': 'e-mail', 'mobile': 'мобильный телефон', 'ext': 'добавочный номер'}
        for other in json.loads(self.managers_list()):
            if other.get('id') == mid:
                continue
            k = self.manager_keys(other)
            for field in ('name', 'email', 'mobile', 'ext'):
                if mine[field] and mine[field] == k[field]:
                    return other, what[field]
        return None

    # карточка менеджера: только поля, которые знает программа (справочник уходит в каждый браузер — без мусора и
    # мегабайтных строк), длина — до 300 знаков, адрес и часы работы — до 1 000
    MANAGER_FIELDS = {
        'name': 300,
        'position': 300,
        'phone': 300,
        'ext': 300,
        'mobile': 300,
        'email': 300,
        'site': 300,
        'address': 1000,
        'hours': 1000,
        'folder': 300,
    }

    def manager_put(self, mid: str, text, author: str = '', base_rev=None) -> dict:
        doc = json.loads(text)
        if not isinstance(doc, dict):
            raise ValueError('Ожидались данные менеджера')
        for k, field in self.MANAGER_FIELDS.items():
            if len(str(doc.get(k) or '')) > field:
                raise ValueError(f'Карточка менеджера: поле «{k}» — не длиннее {field} знаков')
        doc = {k: str(doc[k]) for k in self.MANAGER_FIELDS if doc.get(k) is not None}
        dup = self.manager_dup(mid, doc)
        if dup:
            raise ValueError(
                'Такой менеджер уже есть: {} (совпадает {})'.format(dup[0].get('name') or 'без имени', dup[1])
            )
        doc.pop('_rev', None)
        doc['id'] = mid
        doc['updatedAt'] = _now()
        with self.lock:
            conn = self.conn()
            rev = self._next_rev(conn, 'managers', mid, base_rev)
            conn.execute(
                'INSERT OR REPLACE INTO managers (id, name, doc, updated, rev, updated_by) VALUES (?,?,?,?,?,?)',
                (
                    mid,
                    str(doc.get('name') or ''),
                    json.dumps(doc, ensure_ascii=False),
                    _now(),
                    rev,
                    str(author or '')[:120],
                ),
            )
            self._bump_data(conn, 'managers')
            conn.commit()
        return dict(doc, _rev=rev)

    def next_number(self) -> str:
        with self.lock:
            conn = self.conn()
            year = datetime.now().year
            row = conn.execute('SELECT n FROM counters WHERE year=?', (year,)).fetchone()
            last = row[0] if row else 0
            while True:
                last += 1
                num = f'{year}-{last:03d}'
                # номер КП из корзины не выдаётся заново: его версии и документы ждут восстановления
                if not conn.execute(
                    "SELECT 1 FROM kp WHERE id=? UNION SELECT 1 FROM trash WHERE entity_type = 'kp' AND entity_id = ?",
                    (num, num),
                ).fetchone():
                    break
            conn.execute('INSERT OR REPLACE INTO counters (year, n) VALUES (?,?)', (year, last))
            conn.execute('INSERT INTO kp (id, number, updated) VALUES (?,?,?)', (num, num, _now()))
            conn.commit()
            return num

    def ensure_counter_at_least(self, year, num) -> None:
        with self.lock:
            conn = self.conn()
            row = conn.execute('SELECT n FROM counters WHERE year=?', (year,)).fetchone()
            if not row or row[0] < num:
                conn.execute('INSERT OR REPLACE INTO counters (year, n) VALUES (?,?)', (year, num))
                conn.commit()

    def kp_list(self) -> str:
        rows = self.all('SELECT meta, track FROM kp WHERE meta IS NOT NULL ORDER BY ' + KP_ORDER)
        out = []
        for row in rows:  # испорченная запись (старая версия, ручная правка) не ломает весь журнал
            try:
                if isinstance(json.loads(row[0]), dict):
                    out.append(with_track(row[0], row[1]))
            except (TypeError, ValueError):
                pass
        return '[' + ','.join(out) + ']'

    def kp_get(self, kid: str, field) -> str | None:
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        row = self.one(f'SELECT {field} FROM kp WHERE id=?', (kid,))
        return row[0] if row else None

    def kp_set(self, kid: str, field, value, author: str = '', base_rev=None) -> int:
        """Сохранение поля КП."""
        if field not in ('state', 'meta', 'docx'):
            raise ValueError(field)
        with self.lock:
            conn = self.conn()
            old = conn.execute('SELECT state, meta, rev FROM kp WHERE id=?', (kid,)).fetchone()
            if not old:
                conn.execute('INSERT INTO kp (id, number, updated) VALUES (?,?,?)', (kid, kid, _now()))
            rev = (old[2] or 0) if old else 0
            if field == 'state':
                if isinstance(value, str) and '"_rev"' in value[:400]:
                    try:
                        data = json.loads(value)
                        if isinstance(data, dict) and data.pop('_rev', None) is not None:
                            value = json.dumps(data, ensure_ascii=False)
                    except ValueError:
                        pass
                rev = self._next_rev(conn, 'kp', kid, base_rev)
                if old and old[0] and old[0] != value:
                    # прежнее состояние — в историю версий (лишнее сверх srv.kpVersions удаляется)
                    conn.execute(
                        'INSERT INTO kp_versions (kp_id, created, user_name, state, meta) VALUES (?,?,?,?,?)',
                        (kid, _now(), author, old[0], old[1]),
                    )
                    conn.execute(
                        'DELETE FROM kp_versions WHERE kp_id=? AND id NOT IN (SELECT id FROM kp_versions WHERE kp_id=? ORDER BY id DESC LIMIT ?)',
                        (kid, kid, SrvVal.get(self, 'srv.kpVersions')),
                    )
                conn.execute(
                    'UPDATE kp SET state=?, updated=?, rev=?, updated_by=? WHERE id=?',
                    (value, _now(), rev, str(author or '')[:120], kid),
                )
            elif field == 'meta':
                try:
                    cols = kp_cols(json.loads(value))
                except (TypeError, ValueError):
                    cols = kp_cols({})
                conn.execute(
                    'UPDATE kp SET meta=?, updated=?, client=?, inn=?, manager=?, kdate=?, saved=?, search=? WHERE id=?',
                    (value, _now(), *cols, kid),
                )
            else:
                conn.execute('UPDATE kp SET docx=?, updated=? WHERE id=?', (value, _now(), kid))
            conn.commit()
        return rev

    @staticmethod
    def kp_import_ok(x) -> bool:
        """КП из резервной копии годится к записи: состояние и описание — объекты JSON (или их нет)."""
        for field in ('state', 'meta'):
            if x.get(field) is None:
                continue
            try:
                if not isinstance(json.loads(x[field]), dict):
                    return False
            except (TypeError, ValueError):
                return False
        return True

    def kp_import(self, x) -> None:
        """Запись КП из резервной копии целиком (с полями журнала для поиска)."""
        try:
            cols = kp_cols(json.loads(x.get('meta') or '{}'))
        except (TypeError, ValueError):
            cols = kp_cols({})
        with self.lock:
            conn = self.conn()
            rev = self._next_rev(conn, 'kp', x['id'], None)
            track = picked if isinstance(picked := x.get('track'), str) else None
            try:
                tender = json.loads(track) if track else {}
            except ValueError:
                track, tender = None, {}
            follow = picked if isinstance(tender, dict) and isinstance(picked := tender.get('followUp'), dict) else {}
            conn.execute(
                'INSERT OR REPLACE INTO kp (id, number, state, meta, docx, updated, client, inn, manager, kdate, saved, search, rev, '
                'track, status, follow) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (
                    x['id'],
                    x.get('number'),
                    x.get('state'),
                    x.get('meta'),
                    x.get('docx'),
                    x.get('updated') or _now(),
                    *cols,
                    rev,
                    track,
                    (tender.get('status') if isinstance(tender, dict) else None) or None,
                    (follow.get('date') if not follow.get('done') else None) or None,
                ),
            )
            conn.commit()

    def kp_page(
        self, query='', author='', limit: int = 50, offset: int = 0, kind='', status='', date_from='', date_to=''
    ) -> tuple:
        """Журнал КП постранично с поиском, фильтрами (автор, вид КП, ход сделки) и итогами по отбору."""
        where, args = ['meta IS NOT NULL'], []
        if status == 'new':
            where.append("(status IS NULL OR status = 'new')")
        elif status == 'open':
            where.append("(status IS NULL OR status NOT IN ('won', 'lost'))")
        elif status in ('sent', 'work', 'won', 'lost'):
            where.append('status = ?')
            args.append(status)
        if kind in ('tender', 'std'):  # тендерное КП — в описании есть tender.number (клиент пишет его первым полем)
            where.append(
                ('' if kind == 'tender' else 'NOT ')
                + "COALESCE(CASE WHEN json_valid(meta) THEN json_type(meta, '$.tender.number') END, '') <> ''"
            )
        query_norm = norm(query)
        if query_norm:
            where.append("search LIKE ? ESCAPE '\\'")
            args.append(like_arg(query_norm))
        if author:
            where.append('manager = ?')
            args.append(author)
        if date_from or date_to:  # дата КП — в столбце kdate (ГГГГ-ММ-ДД)
            where.append('substr(kdate, 1, 10) BETWEEN ? AND ?')
            args += [str(date_from or '')[:10], str(date_to or '9999-12-31')[:10]]
        where_sql = ' WHERE ' + ' AND '.join(where)
        total = self.scalar('SELECT COUNT(*) FROM kp' + where_sql, args)
        rows = self.all(
            'SELECT meta, track FROM kp' + where_sql + ' ORDER BY ' + KP_ORDER + ' LIMIT ? OFFSET ?',
            [*args, int(limit), int(offset)],
        )
        return total, [with_track(meta, track) for meta, track in rows]

    def kp_metas_where(self, query='', author='', kind='', status='', date_from='', date_to='') -> list:
        """Все описания КП под фильтром — для итогов журнала (сумма, прибыль) и отчёта за период."""
        _total, rows = self.kp_page(query, author, 10**9, 0, kind, status, date_from, date_to)
        return rows

    def kp_states(self, ids) -> dict:
        """{id КП: состояние строкой} — одним запросом на 500 КП (отчёт по позициям), а не запросом на каждое."""
        out: dict = {}
        for i in range(0, len(ids), 500):
            part = ids[i : i + 500]
            out.update(
                self.all('SELECT id, state FROM kp WHERE id IN ({})'.format(','.join('?' * len(part))), tuple(part))
            )
        return out

    def kp_track_get(self, kid: str) -> dict:
        row = self.one('SELECT track FROM kp WHERE id=?', (kid,))
        try:
            data = json.loads(row[0]) if row and row[0] else {}
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    def kp_track_set(self, kid: str, track) -> None:
        follow = (track.get('followUp') or {}) if isinstance(track.get('followUp'), dict) else {}
        self.write(
            'UPDATE kp SET track=?, status=?, follow=? WHERE id=?',
            (
                json.dumps(track, ensure_ascii=False),
                track.get('status') or None,
                (follow.get('date') or None) if not follow.get('done') else None,
                kid,
            ),
        )

    def kp_tracked(self, since) -> list:
        """КП для напоминаний: незакрытые с since или с напоминанием → [(id, meta, track)]."""
        return self.all(
            "SELECT id, meta, track FROM kp WHERE meta IS NOT NULL AND (status IS NULL OR status NOT IN ('won', 'lost')) "
            'AND (kdate >= ? OR follow IS NOT NULL)',
            (since,),
        )

    def kp_docx_owner(self, rel, kid: str) -> str | None:
        """Другое КП, чей файл лежит по этому пути (тендерные КП называются «<№ закупки> КП» и могут совпасть)."""
        row = self.one('SELECT id FROM kp WHERE docx=? AND id<>?', (rel, kid))
        return row[0] if row else None

    def kp_authors(self) -> list:
        return [
            row[0]
            for row in self.all(
                "SELECT DISTINCT manager FROM kp WHERE meta IS NOT NULL AND manager IS NOT NULL AND manager <> '' "
                'ORDER BY manager COLLATE NOCASE'
            )
        ]

    def kp_trashed(self, kid: str) -> bool:
        return self.one("SELECT 1 FROM trash WHERE entity_type = 'kp' AND entity_id = ?", (kid,)) is not None

    def kp_last_version_meta(self, kid: str) -> str | None:
        row = self.one('SELECT meta FROM kp_versions WHERE kp_id = ? ORDER BY id DESC LIMIT 1', (kid,))
        return row[0] if row else None

    def kp_versions(self, kid: str) -> list:
        out = []
        for vid, created, author, meta, _upd in self.all(
            'SELECT id, created, user_name, meta, (SELECT updated FROM kp WHERE id=kp_id) FROM kp_versions '
            'WHERE kp_id=? ORDER BY id DESC',
            (kid,),
        ):
            metas: dict = {}
            try:
                metas = json.loads(meta or '{}') or {}
            except ValueError:
                pass
            out.append(
                {
                    'id': vid,
                    'created': created,
                    'by': author or '',
                    'sum': metas.get('sum'),
                    'cur': metas.get('cur'),
                    'client': metas.get('client'),
                    'manager': metas.get('manager'),
                    'savedAt': metas.get('savedAt') or metas.get('updatedAt'),
                    'items': (metas.get('items') or [])[:3],
                }
            )
        return out

    def kp_version_state(self, kid: str, vid) -> str | None:
        row = self.one('SELECT state FROM kp_versions WHERE kp_id=? AND id=?', (kid, int(vid)))
        return row[0] if row else None

    DRAFT_COLS = ('id', 'kind', 'owner', 'owner_name', 'title', 'client', 'kp', 'positions', 'sum', 'cur', 'updated')

    def drafts_list(self, kind, owner=None) -> list:
        """Черновики владельца или все заготовки (owner=None) — без состояния КП, новые сверху."""
        sql, args = 'SELECT {} FROM drafts WHERE kind=?'.format(', '.join(self.DRAFT_COLS)), [kind]
        if owner is not None:
            sql += ' AND owner=?'
            args.append(owner)
        return [
            dict(zip(self.DRAFT_COLS, row, strict=False))
            for row in self.all(sql + ' ORDER BY updated DESC LIMIT 500', args)
        ]

    def draft_get(self, did) -> tuple:
        """(строка без состояния, состояние — текст JSON) или (None, None)."""
        row = self.one('SELECT {}, state FROM drafts WHERE id=?'.format(', '.join(self.DRAFT_COLS)), (did,))
        return (dict(zip(self.DRAFT_COLS, row[:-1], strict=False)), row[-1]) if row else (None, None)

    def draft_put(self, row, state, keep=40) -> None:
        """Записать черновик или заготовку; у владельца остаются keep последних черновиков."""
        cols = (*self.DRAFT_COLS, 'state')
        vals = [row.get(col) for col in self.DRAFT_COLS] + [state]
        with self.lock:
            col = self.conn()
            col.execute(
                'INSERT OR REPLACE INTO drafts ({}) VALUES ({})'.format(', '.join(cols), ','.join('?' * len(cols))),
                vals,
            )
            if row['kind'] == 'draft':
                col.execute(
                    "DELETE FROM drafts WHERE kind='draft' AND owner=? AND id NOT IN "
                    "(SELECT id FROM drafts WHERE kind='draft' AND owner=? ORDER BY updated DESC LIMIT ?)",
                    (row['owner'], row['owner'], keep),
                )
            col.commit()

    def draft_del(self, did) -> None:
        self.write('DELETE FROM drafts WHERE id=?', (did,))

    def clients_all(self) -> list:
        return [json.loads(row[0]) for row in self.all('SELECT doc FROM clients ORDER BY updated DESC')]

    def clients_count(self) -> int:
        return self.scalar('SELECT COUNT(*) FROM clients')

    def clients_search(self, query='', limit: int = 50, offset: int = 0) -> dict:
        """Контрагенты: последние использованные или найденные по названию, ИНН, адресу (поиск — на сервере)."""
        query_norm, args, where_sql = norm(query), [], ''
        if query_norm:
            digits = re.sub(r'\D', '', query_norm)
            if digits and digits == query_norm.replace(' ', ''):
                where_sql, args = (
                    " WHERE inn LIKE ? ESCAPE '\\' OR search LIKE ? ESCAPE '\\'",
                    [digits + '%', like_arg(query_norm)],
                )
            else:
                where_sql, args = " WHERE search LIKE ? ESCAPE '\\'", [like_arg(query_norm)]
        total = self.scalar('SELECT COUNT(*) FROM clients' + where_sql, args)
        rows = self.all(
            'SELECT doc, rev FROM clients' + where_sql + ' ORDER BY used_at DESC, updated DESC LIMIT ? OFFSET ?',
            [*args, int(limit), int(offset)],
        )
        return {'total': total, 'items': [dict(json.loads(row[0]), _rev=row[1] or 0) for row in rows]}

    def client_get(self, cid) -> dict | None:
        row = self.one('SELECT doc FROM clients WHERE id=?', (cid,))
        return json.loads(row[0]) if row else None

    def client_get_rev(self, cid) -> dict | None:
        """Клиент с номером правки (_rev) — для совместной правки."""
        row = self.one('SELECT doc, rev FROM clients WHERE id=?', (cid,))
        return dict(json.loads(row[0]), _rev=row[1] or 0) if row else None

    def client_put(self, cid, doc, author: str = '', base_rev=None) -> int:
        doc = {k: v for k, v in doc.items() if k != '_rev'} if isinstance(doc, dict) else doc
        with self.lock:
            conn = self.conn()
            rev = self._next_rev(conn, 'clients', cid, base_rev)
            conn.execute(
                'INSERT OR REPLACE INTO clients (id, doc, updated, name, inn, used_at, search, rev, updated_by) VALUES (?,?,?,?,?,?,?,?,?)',
                (cid, json.dumps(doc, ensure_ascii=False), _now(), *client_cols(doc), rev, str(author or '')[:120]),
            )
            conn.commit()
        return rev

    def check_get(self, inn) -> dict | None:
        row = self.one('SELECT doc FROM checks WHERE inn=?', (inn,))
        return json.loads(row[0]) if row else None

    def check_put(self, inn, doc) -> None:
        self.write(
            'INSERT OR REPLACE INTO checks (inn, doc, checked) VALUES (?,?,?)',
            (inn, json.dumps(doc, ensure_ascii=False), _now()),
        )

    def kv_get(self, key, default=None) -> Any:
        row = self.one('SELECT value FROM kv WHERE key=?', (key,))
        if not row:
            return default
        try:
            return json.loads(row[0])
        except Exception:
            return default

    kv_hook = None  # история настроек (settings_history.SettingsHistory): watches(key), record(key, было, стало)

    def kv_set(self, key, value) -> None:
        hook = self.kv_hook if self.kv_hook is not None and self.kv_hook.watches(key) else None
        before = self.kv_get(key) if hook else None
        self.write('INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)', (key, json.dumps(value, ensure_ascii=False)))
        if hook:
            try:
                hook.record(key, before, value)
            except Exception as exc:  # история не должна мешать сохранению настроек
                print('История настроек не записана:', exc)

    def backup(self, dst) -> str:
        """Согласованная копия базы «на ходу» (встроенный механизм SQLite backup)."""
        return self._backup(dst, lambda tmp: None)

    def backup_checked(self, dst) -> str:
        """Копия базы; архив .zip перед упаковкой проходит полную проверку SQLite."""
        return self._backup(dst, self._verify_copy)

    @staticmethod
    def _verify_copy(tmp) -> None:
        res = DbZip.integrity(tmp)
        if res != 'ok':
            raise ValueError('копия не прошла проверку: ' + res)

    def _backup(self, dst, verify) -> str:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if DbZip.is_zip(dst):
            tmp = dst + '.tmp'
            try:
                for ext in ('', '-wal', '-shm', '-journal'):  # остаток прерванной копии — не дописывать в него
                    if os.path.exists(tmp + ext):
                        os.remove(tmp + ext)
                self.backup(tmp)
                verify(tmp)
                return DbZip.pack(tmp, dst)
            finally:
                for ext in ('', '-wal', '-shm', '-journal'):
                    if os.path.exists(tmp + ext):
                        os.remove(tmp + ext)
        # отдельное соединение и без общей блокировки записи: в режиме WAL копия читает согласованный снимок, а сохранения
        # КП в это время не ждут (копия большой базы — секунды)
        src, out = sqlite3.connect(self.path, timeout=30), sqlite3.connect(dst)
        try:
            src.backup(out)
        finally:
            out.close()
            src.close()
        return dst

    def restore_sqlite(self, src, log=lambda text: None) -> str:
        """Заменить содержимое базы файлом SQLite «на ходу» встроенным backup (файл и WAL руками не подменяются)."""
        chk = sqlite3.connect(src, timeout=30)
        try:
            res = [row[0] for row in chk.execute('PRAGMA integrity_check').fetchall()]
            if res != ['ok']:
                raise ValueError('Файл базы повреждён: ' + '; '.join(str(x) for x in res[:3]))
            tables = {row[0] for row in chk.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            need = {'catalog', 'kp', 'kv', 'managers', 'clients'}
            if not need <= tables:
                raise ValueError('Это не база программы: нет таблиц ' + ', '.join(sorted(need - tables)))
            # сначала — временная копия: миграции и размер страницы на ней; рабочая база меняется, только когда копия готова
            # (копия от прежней версии или с другим размером страницы не оставит программу с базой, которая не запускается)
            tmpdir = tempfile.mkdtemp(prefix='restore-', dir=os.path.dirname(self.path))
            tmp = os.path.join(tmpdir, 'restore.sqlite3')
            tmp_conn = sqlite3.connect(tmp)
            chk.backup(tmp_conn)
            tmp_conn.close()
        finally:
            chk.close()
        try:
            try:
                Store(tmp).conn().close()  # схема и миграции до текущей версии программы
            except Exception as exc:
                raise ValueError(
                    f'Файл базы от несовместимой версии программы — база не заменена ({str(exc)[:200]})'
                ) from exc
            page = self.scalar('PRAGMA page_size')
            tmp_conn = sqlite3.connect(tmp)
            try:
                tmp_conn.execute('PRAGMA journal_mode=DELETE')
                if tmp_conn.execute('PRAGMA page_size').fetchone()[0] != page:
                    tmp_conn.execute(f'PRAGMA page_size={int(page)}')
                    tmp_conn.execute('VACUUM')
                bak = os.path.join(
                    os.path.dirname(self.path),
                    'backup',
                    'kp-{}-before-restore.zip'.format(datetime.now().strftime('%Y%m%d-%H%M%S')),
                )
                with self.lock:
                    self.backup(bak)
                    conn = self.conn()
                    conn.commit()
                    tmp_conn.backup(conn)
                    conn.commit()
            finally:
                tmp_conn.close()
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
        self.migrations_up()  # на всякий случай: схема уже текущая, миграций не останется
        with self.lock:
            conn = self.conn()
            for name in ('catalog', 'managers', 'clients', 'suppliers', 'kp', 'types', 'settings'):
                self._bump_data(conn, name)  # версии справочников — чтобы браузеры перекачали данные
            conn.execute(
                'INSERT OR REPLACE INTO kv (key, value) VALUES (?,?)', ('catepoch', json.dumps(os.urandom(6).hex()))
            )
            conn.commit()
        log(f'База заменена из файла {src}, прежняя сохранена: {bak}')
        return bak

    def migrate_json(self, data_dir: str, log=lambda text: None) -> int:
        """Однократно переносит каталог, журнал, контрагентов, проверки, ключи и типы из файлов в базу."""
        if self.kv_get('migrated_json'):
            return 0
        count = 0

        def read_json(path) -> str:
            with open(path, encoding='utf-8-sig') as handle:
                return handle.read()

        cat = os.path.join(data_dir, 'catalog')
        if os.path.isdir(cat):
            for name in os.listdir(cat):
                if name.endswith('.json'):
                    try:
                        self.catalog_put(name[:-5], read_json(os.path.join(cat, name)))
                        count += 1
                    except Exception as exc:
                        log(f'catalog {name}: {exc}')
        kpd = os.path.join(data_dir, 'kp')
        if os.path.isdir(kpd):
            for kid in os.listdir(kpd):
                folder = os.path.join(kpd, kid)
                if not os.path.isdir(folder):
                    continue
                for field, file_name in (('state', 'state.json'), ('meta', 'meta.json'), ('docx', 'docx.txt')):
                    file_path = os.path.join(folder, file_name)
                    if os.path.isfile(file_path):
                        try:
                            self.kp_set(
                                kid, field, read_json(file_path).strip() if field == 'docx' else read_json(file_path)
                            )
                        except Exception as exc:
                            log(f'kp {kid}: {exc}')
                count += 1
        for file_name in os.listdir(data_dir) if os.path.isdir(data_dir) else []:
            match = re.match(r'^counter-(\d{4})\.txt$', file_name)
            if match:
                try:
                    v = int(read_json(os.path.join(data_dir, file_name)).strip() or 0)
                    cur = self.one('SELECT n FROM counters WHERE year=?', (int(match.group(1)),))
                    if not cur or cur[0] < v:
                        self.write('INSERT OR REPLACE INTO counters (year, n) VALUES (?,?)', (int(match.group(1)), v))
                except Exception:
                    pass
        clients_dir = os.path.join(data_dir, 'clients')
        if os.path.isdir(clients_dir):
            for name in os.listdir(clients_dir):
                if name.endswith('.json'):
                    try:
                        self.client_put(name[:-5], json.loads(read_json(os.path.join(clients_dir, name))))
                        count += 1
                    except Exception:
                        pass
        checks_dir = os.path.join(data_dir, 'checks')
        if os.path.isdir(checks_dir):
            for name in os.listdir(checks_dir):
                if name.endswith('.json'):
                    try:
                        self.check_put(name[:-5], json.loads(read_json(os.path.join(checks_dir, name))))
                    except Exception:
                        pass
        for key, file_name in (('integrations', 'integrations.json'), ('types', 'types.json')):
            file_path = os.path.join(data_dir, file_name)
            if os.path.isfile(file_path):
                try:
                    self.kv_set(key, json.loads(read_json(file_path)))
                except Exception:
                    pass
        self.kv_set('migrated_json', _now())
        return count
