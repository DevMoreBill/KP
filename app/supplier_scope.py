"""Отбор позиций каталога для выгрузки: по поставщику, по разделам и по фильтру каталога."""

import json
import re
from typing import Any


class SupplierScope:
    NONE = 'Без поставщика'
    # цены, закупка, наценка и остатки: в выгрузку по поставщику не попадают, при загрузке не меняются
    PRICE_KEYS = (
        'price',
        'prices',
        'priceCur',
        'priceSrc',
        'priceLink',
        'rrc',
        'cost',
        'costCur',
        'costSrc',
        'costDisc',
        'costAt',
        'margin',
        'mmode',
        'stock',
    )
    MAX_NAME = 120
    COST_KEYS = ('cost', 'costCur', 'costSrc', 'costDisc', 'costAt', 'margin', 'mmode')
    # меняется фидом каждый день — не входит в сравнение «изменено и в файле, и в программе»
    VOLATILE = (*PRICE_KEYS, 'updatedAt', 'feed', 'priceAt', 'photoSource')

    def __init__(self, store) -> None:
        self.store = store
        self.sups = store.suppliers_list()
        feeds = (store.kv_get('feeds') or {}).get('items', [])
        by_id = {x.get('id'): x.get('name') for x in self.sups}
        self.feeds = {
            feed['id']: (by_id.get(feed.get('supplier')) or feed.get('name') or feed['id'])
            for feed in feeds
            if feed.get('id')
        }
        self.makers: dict = {}
        for sup in self.sups:  # точное название раньше списка производителей — как в окне каталога
            for maker in sup.get('makers') or []:
                self.makers.setdefault(self.key(maker), sup.get('name') or '')
        for sup in self.sups:
            if self.key(sup.get('name')):
                self.makers[self.key(sup.get('name'))] = sup.get('name')

    @staticmethod
    def key(text) -> str:
        """Сравнение названий — как norm() клиента: регистр, ё, кавычки, пробелы не важны."""
        return re.sub(r'\s+', ' ', re.sub(r'[«»"]', '', str(text or '').lower().replace('ё', 'е'))).strip()

    def name_of(self, feed: str, maker: str) -> str:
        if feed:
            return self.feeds.get(feed) or feed
        return self.makers.get(self.key(maker), '') if self.key(maker) else ''

    def _rows(self):
        return self.store.all(
            "SELECT id, COALESCE(json_extract(doc, '$.src'), json_extract(doc, '$.feed.id')), maker FROM catalog"
        )

    def groups(self) -> list[dict]:
        """[{name, count, dir}] — по убыванию числа позиций; dir — поставщик есть в справочнике; «Без поставщика» — в конце."""
        cnt: dict = {}
        title: dict = {}
        for _, feed, maker in self._rows():
            name = self.name_of(feed, maker) or self.NONE
            k = self.key(name)
            cnt[k] = cnt.get(k, 0) + 1
            title.setdefault(k, name)
        names = {self.key(x.get('name')) for x in self.sups}
        out = [{'name': title[k], 'count': count, 'dir': k in names} for k, count in cnt.items()]
        return sorted(out, key=lambda group: (group['name'] == self.NONE, -group['count'], group['name'].lower()))

    def ids(self, name: str) -> list[str]:
        want = self.key(name)
        if not want or len(str(name)) > self.MAX_NAME:
            raise ValueError('Поставщик не выбран')
        out = [cid for cid, feed, maker in self._rows() if self.key(self.name_of(feed, maker) or self.NONE) == want]
        if not out:
            raise ValueError(f'У поставщика «{str(name)[: self.MAX_NAME]}» нет позиций в каталоге')
        return out

    def docs(self, name: str) -> list[dict]:
        """Позиции поставщика без цен и остатков, по названию: [doc]."""
        ids, out = self.ids(name), []
        for i in range(0, len(ids), 500):
            part = ids[i : i + 500]
            out += [
                json.loads(doc)
                for (doc,) in self.store.all(
                    'SELECT doc FROM catalog WHERE id IN ({})'.format(','.join('?' * len(part))), tuple(part)
                )
            ]
        for doc in out:
            for k in self.PRICE_KEYS:
                doc.pop(k, None)
        return sorted(out, key=lambda doc: str(doc.get('name') or '').lower())

    @classmethod
    def strip(cls, doc: dict, keys) -> dict:
        """Позиция без этих полей (цен и остатков, которые не выгружаются)."""
        for k in keys:
            doc.pop(k, None)
        return doc

    @classmethod
    def keep_of(cls, doc: dict) -> list:
        """Поля, которых нет в файле выгрузки и которые при загрузке остаются как в базе (только известные)."""
        k = doc.get('keep') if isinstance(doc, dict) else None
        return [x for x in k if x in cls.PRICE_KEYS] if isinstance(k, list) else []

    @classmethod
    def merge(cls, new: dict, cur: dict, keep) -> dict:
        """Позиция из файла + убранные при выгрузке поля текущей позиции базы."""
        for k in keep:
            if k in cur:
                new[k] = cur[k]
            else:
                new.pop(k, None)
        return new


class ExportScope:
    """Выгрузка по разделам: внутри вида (категории, производители, поставщики, фиды) — «или», между видами — «и»."""

    KINDS = ('cats', 'makers', 'sups', 'feeds')
    NO_FEED = 'Не из фида'
    NO_MAKER = 'Без производителя'
    MAX = 1000

    def __init__(self, store) -> None:
        self.store = store
        self.scope = SupplierScope(store)
        self.feed_names = {
            feed['id']: (feed.get('name') or feed['id'])
            for feed in (store.kv_get('feeds') or {}).get('items', [])
            if feed.get('id')
        }

    def _rows(self):
        """[(id, категория, производитель, поставщик, фид)]"""
        out = []
        for cid, cat, maker, feed in self.store.all(
            "SELECT id, cat, maker, COALESCE(json_extract(doc, '$.src'), json_extract(doc, '$.feed.id')) FROM catalog"
        ):
            sup = self.scope.name_of(feed, maker) or SupplierScope.NONE
            out.append((cid, cat or '', str(maker or '').strip() or self.NO_MAKER, sup, feed or ''))
        return out

    def summary(self) -> dict:
        """Сочетания для окна выгрузки: {rows: [{cat, maker, sup, feed, n}], feeds: {id: название}} — счётчики считает окно."""
        cnt: dict = {}
        for _cid, cat, maker, sup, feed in self._rows():
            k = (cat, maker, sup, feed)
            cnt[k] = cnt.get(k, 0) + 1
        return {
            'rows': [
                {'cat': key_cat, 'maker': key_maker, 'sup': key_sup, 'feed': key_feed, 'n': name}
                for (key_cat, key_maker, key_sup, key_feed), name in cnt.items()
            ],
            'feeds': dict(self.feed_names, **{'': self.NO_FEED}),
        }

    @classmethod
    def clean(cls, pick) -> dict:
        """Выбор из запроса → {вид: множество}; ValueError — понятным текстом."""
        if not isinstance(pick, dict):
            raise ValueError('Неверный выбор позиций каталога')
        out = {}
        for k in cls.KINDS:
            v = pick.get(k) or []
            if not isinstance(v, list) or len(v) > cls.MAX or any(not isinstance(x, str) or len(x) > 200 for x in v):
                raise ValueError('Неверный выбор позиций каталога')
            if v:
                out[k] = set(v) if k not in {'makers', 'sups'} else {SupplierScope.key(x) for x in v}
        return out

    def ids(self, pick: dict) -> list[str]:
        """id позиций, подходящих под выбор (pick — после clean)."""
        out = []
        for cid, cat, maker, sup, feed in self._rows():
            if 'cats' in pick and cat not in pick['cats']:
                continue
            if 'makers' in pick and SupplierScope.key(maker) not in pick['makers']:
                continue
            if 'sups' in pick and SupplierScope.key(sup) not in pick['sups']:
                continue
            if 'feeds' in pick and feed not in pick['feeds']:
                continue
            out.append(cid)
        return out


class CatalogFilter:
    """«Выгрузить → Каталог по фильтру»."""

    NO_CAT = '__none__'  # «Без категории» в списке (пустое значение — «Все категории»)
    GROUPS = {
        'price': ('price', 'prices', 'priceCur', 'priceSrc', 'priceLink', 'margin', 'mmode'),
        'rrc': ('rrc',),
        'cost': ('cost', 'costCur', 'costSrc', 'costDisc', 'costAt'),
        'stock': ('stock',),
    }

    def __init__(self, store) -> None:
        self.store = store

    @staticmethod
    def clean(filt) -> dict:
        if not isinstance(filt, dict):
            raise ValueError('Неверный фильтр каталога')
        out: dict[str, Any] = {}
        for k in ('cat', 'maker', 'sup', 'q'):
            v = filt.get(k) or ''
            if not isinstance(v, str) or len(v) > 200:
                raise ValueError('Неверный фильтр каталога')
            if v.strip():
                out[k] = v.strip()
        for k in ('priced', 'instock'):
            if filt.get(k) is True:
                out[k] = True
        return out

    @classmethod
    def keep(cls, prices) -> list:
        """Поля цен и остатков, которые не выгружаются (группы не отмечены)."""
        want = set(prices or [])
        return [k for group, keys in cls.GROUPS.items() if group not in want for k in keys]

    @staticmethod
    def in_stock(stock) -> bool:
        if not isinstance(stock, dict) or stock.get('gone'):
            return False
        return stock['qty'] > 0 if isinstance(stock.get('qty'), (int, float)) else bool(stock.get('available'))

    def ids(self, filt) -> list[str]:
        from storage import like_arg, norm

        filt = self.clean(filt)
        scope = ExportScope(self.store)
        maker_key, supplier_key = SupplierScope.key(filt.get('maker', '')), SupplierScope.key(filt.get('sup', ''))
        cat_want = '' if filt.get('cat') == self.NO_CAT else filt.get('cat')
        ok = [
            cid
            for cid, cat, maker, sup, _feed in scope._rows()
            if ('cat' not in filt or cat == cat_want)
            and (not maker_key or SupplierScope.key(maker) == maker_key)
            and (not supplier_key or SupplierScope.key(sup) == supplier_key)
        ]
        if not ok or not ({'q', 'priced', 'instock'} & set(filt)):
            return ok
        words = norm(filt.get('q', '')).split()[:8]
        want, out = set(ok), []
        sql = 'SELECT id, light FROM catalog'
        args: tuple = ()
        if words:
            sql += ' WHERE ' + ' AND '.join("search LIKE ? ESCAPE '\\'" for _ in words)
            args = tuple(like_arg(word) for word in words)
        for cid, light in self.store.all(sql + ' ORDER BY name', args):
            if cid not in want:
                continue
            if filt.get('priced') or filt.get('instock'):
                try:
                    doc = json.loads(light)
                except ValueError:
                    continue
                if filt.get('priced') and not doc.get('price'):
                    continue
                if filt.get('instock') and not self.in_stock(doc.get('stock')):
                    continue
            out.append(cid)
        return out
