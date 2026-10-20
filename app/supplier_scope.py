"""Отбор позиций каталога для выгрузки: по поставщику, по разделам и по фильтру каталога."""

import json
import re


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
        self.st = store
        self.sups = store.suppliers_list()
        feeds = (store.kv_get('feeds') or {}).get('items', [])
        by_id = {x.get('id'): x.get('name') for x in self.sups}
        self.feeds = {f['id']: (by_id.get(f.get('supplier')) or f.get('name') or f['id']) for f in feeds if f.get('id')}
        self.makers = {}
        for s in self.sups:  # точное название раньше списка производителей — как в окне каталога
            for m in s.get('makers') or []:
                self.makers.setdefault(self.key(m), s.get('name') or '')
        for s in self.sups:
            if self.key(s.get('name')):
                self.makers[self.key(s.get('name'))] = s.get('name')

    @staticmethod
    def key(s) -> str:
        """Сравнение названий — как norm() клиента: регистр, ё, кавычки, пробелы не важны."""
        return re.sub(r'\s+', ' ', re.sub(r'[«»"]', '', str(s or '').lower().replace('ё', 'е'))).strip()

    def name_of(self, feed: str, maker: str) -> str:
        if feed:
            return self.feeds.get(feed) or feed
        return self.makers.get(self.key(maker), '') if self.key(maker) else ''

    def _rows(self):
        return self.st.all(
            "SELECT id, COALESCE(json_extract(doc, '$.src'), json_extract(doc, '$.feed.id')), maker FROM catalog"
        )

    def groups(self) -> list[dict]:
        """[{name, count, dir}] — по убыванию числа позиций; dir — поставщик есть в справочнике; «Без поставщика» — в конце."""
        cnt, title = {}, {}
        for _, feed, maker in self._rows():
            n = self.name_of(feed, maker) or self.NONE
            k = self.key(n)
            cnt[k] = cnt.get(k, 0) + 1
            title.setdefault(k, n)
        names = {self.key(x.get('name')) for x in self.sups}
        out = [{'name': title[k], 'count': c, 'dir': k in names} for k, c in cnt.items()]
        return sorted(out, key=lambda g: (g['name'] == self.NONE, -g['count'], g['name'].lower()))

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
                json.loads(d)
                for (d,) in self.st.all(
                    'SELECT doc FROM catalog WHERE id IN ({})'.format(','.join('?' * len(part))), tuple(part)
                )
            ]
        for d in out:
            for k in self.PRICE_KEYS:
                d.pop(k, None)
        return sorted(out, key=lambda d: str(d.get('name') or '').lower())

    @classmethod
    def strip(cls, d: dict, keys) -> dict:
        """Позиция без этих полей (цен и остатков, которые не выгружаются)."""
        for k in keys:
            d.pop(k, None)
        return d

    @classmethod
    def keep_of(cls, d: dict) -> list:
        """Поля, которых нет в файле выгрузки и которые при загрузке остаются как в базе (только известные)."""
        k = d.get('keep') if isinstance(d, dict) else None
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
        self.st = store
        self.sc = SupplierScope(store)
        self.feed_names = {
            f['id']: (f.get('name') or f['id']) for f in (store.kv_get('feeds') or {}).get('items', []) if f.get('id')
        }

    def _rows(self):
        """[(id, категория, производитель, поставщик, фид)]"""
        out = []
        for cid, cat, maker, feed in self.st.all(
            "SELECT id, cat, maker, COALESCE(json_extract(doc, '$.src'), json_extract(doc, '$.feed.id')) FROM catalog"
        ):
            sup = self.sc.name_of(feed, maker) or SupplierScope.NONE
            out.append((cid, cat or '', str(maker or '').strip() or self.NO_MAKER, sup, feed or ''))
        return out

    def summary(self) -> dict:
        """Сочетания для окна выгрузки: {rows: [{cat, maker, sup, feed, n}], feeds: {id: название}} — счётчики считает окно."""
        cnt = {}
        for _cid, cat, maker, sup, feed in self._rows():
            k = (cat, maker, sup, feed)
            cnt[k] = cnt.get(k, 0) + 1
        return {
            'rows': [{'cat': c, 'maker': m, 'sup': s, 'feed': f, 'n': n} for (c, m, s, f), n in cnt.items()],
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
        self.st = store

    @staticmethod
    def clean(f) -> dict:
        if not isinstance(f, dict):
            raise ValueError('Неверный фильтр каталога')
        out = {}
        for k in ('cat', 'maker', 'sup', 'q'):
            v = f.get(k) or ''
            if not isinstance(v, str) or len(v) > 200:
                raise ValueError('Неверный фильтр каталога')
            if v.strip():
                out[k] = v.strip()
        for k in ('priced', 'instock'):
            if f.get(k) is True:
                out[k] = True
        return out

    @classmethod
    def keep(cls, prices) -> list:
        """Поля цен и остатков, которые не выгружаются (группы не отмечены)."""
        want = set(prices or [])
        return [k for g, keys in cls.GROUPS.items() if g not in want for k in keys]

    @staticmethod
    def in_stock(st) -> bool:
        if not isinstance(st, dict) or st.get('gone'):
            return False
        return st['qty'] > 0 if isinstance(st.get('qty'), (int, float)) else bool(st.get('available'))

    def ids(self, f) -> list[str]:
        from storage import like_arg, norm

        f = self.clean(f)
        sc = ExportScope(self.st)
        mk, sp = SupplierScope.key(f.get('maker', '')), SupplierScope.key(f.get('sup', ''))
        cat_want = '' if f.get('cat') == self.NO_CAT else f.get('cat')
        ok = [
            cid
            for cid, cat, maker, sup, _feed in sc._rows()
            if ('cat' not in f or cat == cat_want)
            and (not mk or SupplierScope.key(maker) == mk)
            and (not sp or SupplierScope.key(sup) == sp)
        ]
        if not ok or not ({'q', 'priced', 'instock'} & set(f)):
            return ok
        words = norm(f.get('q', '')).split()[:8]
        want, out = set(ok), []
        sql, args = 'SELECT id, light FROM catalog', ()
        if words:
            sql += ' WHERE ' + ' AND '.join("search LIKE ? ESCAPE '\\'" for _ in words)
            args = tuple(like_arg(w) for w in words)
        for cid, light in self.st.all(sql + ' ORDER BY name', args):
            if cid not in want:
                continue
            if f.get('priced') or f.get('instock'):
                try:
                    d = json.loads(light)
                except ValueError:
                    continue
                if f.get('priced') and not d.get('price'):
                    continue
                if f.get('instock') and not self.in_stock(d.get('stock')):
                    continue
            out.append(cid)
        return out
