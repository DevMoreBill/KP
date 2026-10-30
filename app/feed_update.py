"""Обновление цен или остатков фида из файлов: новые файлы — в черновик, полный список изменений, применение отмеченного."""

import json
import os
import re
import secrets
import shutil
import time
from datetime import date
from enum import Enum

import feed_files
import feed_prices
import feeds
from server_log import ErrorText


class Scope(Enum):
    """Что обновляется: цены (прайсы) или остатки (файл остатков)."""

    PRICE = 'price'
    STOCK = 'stock'

    @classmethod
    def of(cls, value: object) -> 'Scope':
        try:
            return cls(str(value))
        except ValueError:
            raise ValueError('Что обновить: цены или остатки') from None


class FeedDraft:
    """Черновик обновления: копия файлов фида и новые файлы; файлы фида меняются только при «Применить»."""

    FOLDER = 'feeds-draft'
    META = 'draft.json'
    TOKEN = re.compile(r'^[a-f0-9]{16}\Z')
    KEEP_SEC = 24 * 3600

    def __init__(self, data_dir: str, token: str) -> None:
        if not self.TOKEN.match(str(token or '')):
            raise ValueError('Черновик обновления не найден — начните заново')
        self.data_dir, self.token = data_dir, token
        self.root = os.path.join(data_dir, self.FOLDER, token)

    @classmethod
    def start(cls, data_dir: str, feed: dict, scope: Scope) -> 'FeedDraft':
        """Новый черновик: копия текущих файлов фида."""
        cls._clean(data_dir)
        draft = cls(data_dir, secrets.token_hex(8))
        src, dst = feed_files.feed_dir(data_dir, feed['id']), feed_files.feed_dir(draft.root, feed['id'])
        os.makedirs(dst, exist_ok=True)
        for name in os.listdir(src) if os.path.isdir(src) else []:
            if os.path.isfile(os.path.join(src, name)) and not name.endswith('.tmp'):
                shutil.copy2(os.path.join(src, name), os.path.join(dst, name))
        draft._write({'fid': feed['id'], 'scope': scope.value, 'at': time.time(), 'files': []})
        return draft

    @classmethod
    def _clean(cls, data_dir: str) -> None:
        """Брошенные черновики старше суток — удалить."""
        top = os.path.join(data_dir, cls.FOLDER)
        for name in os.listdir(top) if os.path.isdir(top) else []:
            path = os.path.join(top, name)
            if cls.TOKEN.match(name) and time.time() - os.path.getmtime(path) > cls.KEEP_SEC:
                shutil.rmtree(path, ignore_errors=True)

    def _write(self, info: dict) -> None:
        os.makedirs(self.root, exist_ok=True)
        with open(os.path.join(self.root, self.META), 'w', encoding='utf-8') as handle:
            json.dump(info, handle, ensure_ascii=False)

    def info(self, feed: dict) -> dict:
        """{fid, scope, files: [{kind, slot, name, meta, replaces}]}; черновик другого фида — ошибка."""
        try:
            with open(os.path.join(self.root, self.META), encoding='utf-8') as handle:
                info = json.load(handle)
        except (OSError, ValueError):
            raise ValueError('Черновик обновления не найден — начните заново') from None
        if info.get('fid') != feed['id']:
            raise ValueError('Черновик обновления не найден — начните заново')
        return info

    def scope(self, feed: dict) -> Scope:
        return Scope.of(self.info(feed).get('scope'))

    def put(self, feed: dict, name: str, data: bytes, slot: str | None) -> dict:
        """Новый файл в черновик (прайс — вместо выбранного или того же по имени, иначе новый); → запись о файле."""
        info = self.info(feed)
        scope = Scope.of(info['scope'])
        if scope is Scope.PRICE:
            slot, old = self._slot(feed, name, slot)
            meta = feed_files.save_file(self.root, feed['id'], 'price', data, name, slot)
            if old:  # валюта, выбранная у прайса вручную, сохраняется при замене файла
                meta.update({k: old[k] for k in ('curSet', 'curSheets') if old.get(k)})
            replaces = self._replaced(feed, slot)
        else:
            meta = feed_files.save_file(self.root, feed['id'], 'stock', data, name)
            slot, replaces = '', ((feed.get('files') or {}).get('stock') or {}).get('name', '')
        rec = {'kind': scope.value, 'slot': slot, 'name': meta['name'], 'meta': meta, 'replaces': replaces}
        info['files'] = [x for x in info['files'] if x['slot'] != slot] + [rec]
        self._write(info)
        return rec

    def _slot(self, feed: dict, name: str, slot: str | None) -> tuple:
        """Какой прайс заменяет файл: выбранный; тот же по имени; единственный прайс фида; иначе — новый прайс."""
        have = feeds.price_files(self.config(feed))
        if slot == feeds.PriceSlots.NEW:
            return feeds.PriceSlots.free(have, name), None
        slot, old = feeds.PriceSlots.pick(have, name, slot)
        own = feeds.price_files(feed)
        if old is None and len(own) == 1:  # у поставщика один прайс — новый файл его и заменяет, как бы ни назывался
            return own[0]['slot'], next(meta for meta in have if meta['slot'] == own[0]['slot'])
        return slot, old

    def move(self, feed: dict, slot: str, into: str) -> dict:
        """Файл, принятый не за тот прайс, — на место другого (into — слот прайса или «new» — новый прайс)."""
        info = self.info(feed)
        rec = next((x for x in info['files'] if x['slot'] == slot), None)
        if not rec or rec['kind'] != Scope.PRICE.value:
            raise ValueError('Файл не найден — выберите его заново')
        data = feed_files.read_file(self.root, feed['id'], 'price', slot) or b''
        info['files'] = [x for x in info['files'] if x['slot'] != slot]
        self._write(info)
        self._restore(feed, slot)
        return self.put(feed, rec['name'], data, into)

    def _restore(self, feed: dict, slot: str) -> None:
        """Слот черновика — снова как в фиде (прежний файл прайса или ничего)."""
        src = feed_files.file_path(feeds.DATA_DIR, feed['id'], 'price', slot)
        dst = feed_files.file_path(self.root, feed['id'], 'price', slot)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
        elif os.path.isfile(dst):
            os.remove(dst)

    @staticmethod
    def _replaced(feed: dict, slot: str) -> str:
        old = next((meta for meta in feeds.price_files(feed) if meta['slot'] == slot), None)
        return (old or {}).get('name', '')

    def set_cur(self, feed: dict, slot: str, cur: str) -> None:
        """Валюта нового прайса, если в файле её нет."""
        cur = str(cur or '').upper()[:3]
        if cur and not re.match(r'^[A-Z]{3}$', cur):
            raise ValueError('Валюта — трёхбуквенный код (EUR, USD, RUB, CNY)')
        info = self.info(feed)
        for rec in info['files']:
            if rec['slot'] == slot:
                rec['meta']['curSet'] = cur
        self._write(info)

    def config(self, feed: dict) -> dict:
        """Настройки фида с файлами черновика."""
        cfg = json.loads(json.dumps(feed))
        files = cfg.setdefault('files', {})
        staged = self.info(feed)['files']
        prices = [rec for rec in staged if rec['kind'] == Scope.PRICE.value]
        if prices:
            slots = {rec['slot'] for rec in prices}
            files['prices'] = [meta for meta in feeds.price_files(cfg) if meta['slot'] not in slots] + [
                dict(rec['meta'], slot=rec['slot']) for rec in prices
            ]
            files.pop('price', None)
        for rec in staged:
            if rec['kind'] == Scope.STOCK.value:
                files['stock'] = rec['meta']
        return cfg

    def commit(self, store, feed: dict) -> None:
        """Файлы черновика — в фид (как обычная загрузка файла)."""
        have = {meta['slot'] for meta in feeds.price_files(feed)}
        for rec in self.info(feed)['files']:
            kind, slot = rec['kind'], rec['slot'] or None
            data = feed_files.read_file(self.root, feed['id'], kind, slot)
            if data is None:
                continue
            pick = slot if kind == Scope.STOCK.value or slot in have else feeds.PriceSlots.NEW
            meta = feeds.feed_file_put(store, feed['id'], kind, data, rec['name'], pick)
            if kind == Scope.PRICE.value and rec['meta'].get('curSet'):
                feeds.feed_file_set(store, feed['id'], 'price', meta['slot'], 'cur', rec['meta']['curSet'])

    def drop(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


class PriceDiff:
    """Что изменилось у позиции: цены (РРЦ, цена КП, закупка) или наличие — было → стало."""

    SHARP_PCT = 20  # изменение цены больше ±20 % — подсвечивается
    PERCENT = 100
    PRICE_FIELDS = (('rrc', 'РРЦ'), ('price', 'Цена КП'), ('cost', 'Закупка'))

    @staticmethod
    def _money(doc: dict, field: str) -> tuple:
        if field == 'rrc':
            rrc = doc.get('rrc') or {}
            return rrc.get('price') or None, rrc.get('cur') or 'RUB'
        cur = doc.get('priceCur' if field == 'price' else 'costCur') or 'RUB'
        return doc.get(field) or None, cur

    @classmethod
    def _pct(cls, was: tuple, now: tuple) -> float | None:
        """was, now — (сумма, валюта); в разных валютах процент не считается."""
        (old, old_cur), (new, cur) = was, now
        if not (old and new and old_cur == cur):
            return None
        return round((new - old) / old * cls.PERCENT, 1)

    @classmethod
    def prices(cls, was: dict, doc: dict) -> list:
        out = []
        for field, label in cls.PRICE_FIELDS:
            old, old_cur = cls._money(was, field)
            new, cur = cls._money(doc, field)
            if (old, old_cur) == (new, cur) or not (old or new):
                continue
            out.append(
                {
                    'f': field,
                    'label': label,
                    'old': old,
                    'oldCur': old_cur,
                    'new': new,
                    'cur': cur,
                    'pct': cls._pct((old, old_cur), (new, cur)),
                }
            )
        rrc = next((change for change in out if change['f'] == 'rrc'), None)
        return [
            change
            for change in out
            if not (change['f'] == 'price' and rrc and (change['new'], change['cur']) == (rrc['new'], rrc['cur']))
        ]

    @staticmethod
    def _stock(stock: dict | None) -> dict:
        stock = stock or {}
        return {
            'text': feed_prices._stock_txt(stock),
            'qty': stock.get('qty'),
            'available': bool(stock.get('available')) and not stock.get('gone'),
            'wh': stock.get('wh') or [],
        }

    @classmethod
    def stock(cls, was: dict, doc: dict) -> list:
        old, new = cls._stock(was.get('stock')), cls._stock(doc.get('stock'))
        if (old['text'], old['wh']) == (new['text'], new['wh']):
            return []
        return [{'f': 'stock', 'label': 'Наличие', 'old': old, 'new': new}]

    @classmethod
    def row(cls, was: dict, doc: dict, scope: Scope, src: str) -> dict | None:
        """Строка списка изменений или None — видимых изменений нет (только даты)."""
        changes = cls.prices(was, doc) if scope is Scope.PRICE else cls.stock(was, doc)
        if not changes:
            return None
        attrs = doc.get('attrs') or {}
        row = {
            'id': doc['id'],
            'name': doc.get('name') or '',
            'model': attrs.get('model') or '',
            'maker': attrs.get('maker') or '',
            'src': src,
            'changes': changes,
        }
        row.update(cls._direction(changes, scope))
        return row

    @staticmethod
    def _way(change: dict) -> str:
        """Цена: новая, пропала, выросла или снизилась."""
        if not change['old']:
            return 'new'
        if not change['new']:
            return 'gone'
        return 'up' if change['new'] > change['old'] else 'down'

    @classmethod
    def _direction(cls, changes: list, scope: Scope) -> dict:
        if scope is Scope.STOCK:
            old, new = changes[0]['old'], changes[0]['new']
            way = 'qty'
            if new['available'] and not old['available']:
                way = 'in'
            elif old['available'] and not new['available']:
                way = 'out'
            return {'dir': way, 'pct': None, 'sharp': False}
        pcts = [change['pct'] for change in changes if change['pct'] is not None]
        pct = max(pcts, key=abs) if pcts else None
        ways = {cls._way(change) for change in changes}
        way = ways.pop() if len(ways) == 1 else 'mixed'
        return {'dir': way, 'pct': pct, 'sharp': pct is not None and abs(pct) > cls.SHARP_PCT}


class ChangeSink:
    """Куда идут изменённые фидом позиции: предпросмотр — только список; применение — в каталог, кроме снятых галочек."""

    def __init__(
        self, scope: Scope, cfg: dict, writer: 'feeds.CatalogPut | None' = None, skip: frozenset = frozenset()
    ) -> None:
        self.scope, self.cfg, self.writer, self.skip = scope, cfg, writer, skip
        self.rows: list = []
        self.written = 0
        self.conflicts = 0

    def _keys(self) -> tuple:
        return (*feeds.FeedRules.KEYS[self.scope.value], 'priceLink')

    def _snap(self, doc: dict) -> str:
        return json.dumps([doc.get(k) for k in self._keys()], sort_keys=True, ensure_ascii=False)

    def put(self, was: dict, doc: dict, src: str = 'card') -> bool:
        """was — позиция до изменений; изменения не своей части (цены или наличие) отбрасываются."""
        doc = feeds.FeedRules.keep(doc, was, self.cfg)
        if self._snap(doc) == self._snap(was):
            return False
        row = PriceDiff.row(was, doc, self.scope, src)
        if self.writer is None:
            if row:
                self.rows.append(row)
            return True
        if doc['id'] in self.skip:
            return False
        if not self.writer.put(was, doc):
            self.conflicts += 1
            return False
        self.written += 1
        if row:
            self.rows.append(row)
        return True


class FeedUpdate:
    """Обновить цены или остатки фида по файлам черновика: список изменений (без записи) и применение отмеченного."""

    LOG_ROWS = 3000
    MISSING_MAX = 1000

    def __init__(self, store, feed: dict, draft: FeedDraft) -> None:
        self.store, self.feed, self.draft = store, feed, draft
        self.scope = draft.scope(feed)

    def _cfg(self) -> dict:
        """Настройки фида с файлами черновика; обновляется только своя часть — цены или наличие."""
        cfg = self.draft.config(self.feed)
        cfg['fields'] = {k: k == self.scope.value for k, _ in feeds.FeedRules.FIELDS}
        return cfg

    def preview(self) -> dict:
        """Все изменения без записи в каталог."""
        cfg = self._cfg()
        return self._run(cfg, ChangeSink(self.scope, cfg))

    def apply(self, skip: list, author: str) -> dict:
        """Записать изменения (кроме позиций skip), файлы черновика — в фид; запись в журнал фида."""
        cfg = self._cfg()
        writer = feeds.CatalogPut(self.store, author or 'Фид «{}»'.format(self.feed['name']))
        sink = ChangeSink(self.scope, cfg, writer, frozenset(str(x) for x in skip or []))
        job = feeds._job(self.feed['id'], 'check')
        try:
            res = self._run(cfg, sink)
            self.draft.commit(self.store, self.feed)
        except Exception as exc:
            job.update(state='error', msg=ErrorText.of(exc)[:300])
            raise
        res.update(written=sink.written, conflicts=sink.conflicts, skipped=len(skip or []))
        self._log(res, author)
        job.update(state='done', result=None, msg=self._msg(res))
        self.draft.drop()
        return res

    def _run(self, cfg: dict, sink: ChangeSink) -> dict:
        root = self.draft.root
        feed = feeds.load(self.store, cfg, root=root)
        by_oid = {offer['oid']: offer for offer in feed['offers']}
        today = date.today().isoformat()
        docs = feeds._feed_docs(self.store, self.feed['id'])
        unpriced = []
        for doc in docs:
            offer = by_oid.get((doc.get('feed') or {}).get('oid'))
            if not offer:
                continue
            if self.scope is Scope.PRICE and not (offer.get('price') or offer.get('dealer')):
                unpriced.append({'id': doc['id'], 'name': doc.get('name'), 'why': 'нет цены в прайсе'})
            was = json.loads(json.dumps(doc))
            feeds._price_part(doc, offer, cfg, today)
            doc['updatedAt'] = feeds._now()
            sink.put(was, doc, 'feed')
        cards = None
        if feed.get('prices'):  # позиции производителя, заведённые вручную
            cards = feeds.price_cards(self.store, cfg, feed['prices'], today, stock=feed.get('stock'), sink=sink)[1]
        return self._report(sink, docs, unpriced, cards)

    def _report(self, sink: ChangeSink, docs: list, unpriced: list, cards: dict | None) -> dict:
        info = self.draft.info(self.feed)
        rows = sorted(sink.rows, key=lambda row: (not row['sharp'], row['name'].lower()))
        ways: dict = {}
        for row in rows:
            ways[row['dir']] = ways.get(row['dir'], 0) + 1
        missing = list(unpriced)
        if cards and self.scope is Scope.PRICE:
            missing += cards['missing'] + cards['noPrice'] + cards['unclear']
        return {
            'scope': self.scope.value,
            'files': [
                {k: rec[k] for k in ('slot', 'name', 'replaces')} | {'rows': rec['meta'].get('rows')}
                for rec in info['files']
            ],
            'checked': len(docs) + ((cards or {}).get('cards') or 0),
            'rows': rows,
            'counts': {'changed': len(rows), 'sharp': sum(1 for row in rows if row['sharp']), **ways},
            'missing': missing[: self.MISSING_MAX],
            'missingTotal': len(missing),
        }

    def _msg(self, res: dict) -> str:
        what = 'Цены' if self.scope is Scope.PRICE else 'Остатки'
        return f'{what}: изменено {res["written"]}, не применено {res["skipped"]}'

    def _log(self, res: dict, author: str) -> None:
        changes = [
            {
                'id': row['id'],
                'name': row['name'],
                'kind': change['f'],
                'old': change['old']['text'] if change['f'] == 'stock' else change['old'],
                'new': change['new']['text'] if change['f'] == 'stock' else change['new'],
                'cur': '' if change['f'] == 'stock' else change['cur'],
            }
            for row in res['rows']
            for change in row['changes']
        ][: self.LOG_ROWS]
        rec = {
            'at': feeds._now(),
            'kind': 'check',
            'scope': self.scope.value,
            'by': author,
            'files': [rec['name'] for rec in res['files']],
            'checked': res['checked'],
            'updated': res['written'],
            'skipped': res['skipped'],
            'price': changes if self.scope is Scope.PRICE else [],
            'stock': changes if self.scope is Scope.STOCK else [],
        }
        feeds._log_add(self.store, self.feed['id'], rec)
        feeds._mark(self.store, self.feed['id'], 'check', rec)
