"""Образец объёма карточки по категории каталога и данные той же модели из каталога — для запроса к ИИ."""

import json
import re
import statistics
import threading
import time
from collections import Counter, defaultdict


class KeyNorm:
    """«Мощность, кВт», «Мощность (кВт)» и «мощность» — одна характеристика."""

    UNIT = re.compile(r'\s*[,(].*$')
    SPACE = re.compile(r'\s+')

    @classmethod
    def of(cls, k) -> str:
        return cls.SPACE.sub(' ', cls.UNIT.sub('', str(k or '')).replace('ё', 'е').lower()).strip()


class CategoryProfile:
    """Медианный объём заполнения карточек категории; устаревший образец пересчитывается в фоне."""

    MIN_CARDS = 3
    KEY_SHARE = 0.3
    TOP_KEYS = 30
    TOP_LABELS = 10
    FRESH = 600
    _cache: dict = {}
    _busy: set = set()
    _lock = threading.Lock()

    def __init__(self, store) -> None:
        self.store = store

    def get(self, cat: str) -> dict | None:
        """Образец категории или None, если карточек мало."""
        cat = str(cat or '')
        rev, now = self.store.data_rev('catalog'), time.time()
        with self._lock:
            hit = self._cache.get(cat)
            if hit and (hit[0] == rev or now - hit[1] < self.FRESH):
                return hit[2]
            if hit and cat not in self._busy:
                self._busy.add(cat)
                threading.Thread(target=self._rebuild, args=(cat, rev), daemon=True, name='ai-profile').start()
                return hit[2]
        return self._rebuild(cat, rev)

    def _rebuild(self, cat: str, rev) -> dict | None:
        try:
            cards = [
                c
                for c in (self._card(doc) for (doc,) in self.store.all('SELECT doc FROM catalog WHERE cat = ?', (cat,)))
                if c
            ]
            prof = self._profile(cat, cards) if len(cards) >= self.MIN_CARDS else None
            with self._lock:
                self._cache[cat] = (rev, time.time(), prof)
            return prof
        finally:
            with self._lock:
                self._busy.discard(cat)

    @staticmethod
    def _card(text: str) -> dict | None:
        """Блоки описания, группы и строки карточки; None — опция или пустая."""
        try:
            d = json.loads(text)
        except ValueError:
            return None
        if d.get('kind') == 'option':
            return None
        feats = [f for f in (d.get('features') or []) if isinstance(f, dict) and str(f.get('text') or '').strip()]
        groups = [
            g
            for g in (d.get('groups') or [])
            if isinstance(g, dict) and any(isinstance(r, dict) and r.get('v') for r in (g.get('rows') or []))
        ]
        rows = [r for g in groups for r in g['rows'] if isinstance(r, dict) and r.get('k') and r.get('v')]
        if not feats and not rows:
            return None
        return {
            'feats': [(str(f.get('label') or '').strip(), len(str(f['text']))) for f in feats],
            'groups': [str(g.get('name') or '').strip() for g in groups],
            'keys': [str(r['k']).strip() for r in rows],
        }

    def _profile(self, cat: str, L: list[dict]) -> dict:
        def med(xs):
            return round(statistics.median(xs)) if xs else 0

        n = len(L)
        keys, shown, labels, gnames = Counter(), defaultdict(Counter), Counter(), Counter()
        for c in L:
            for k in {KeyNorm.of(x) for x in c['keys'] if x}:
                keys[k] += 1
            for x in c['keys']:
                shown[KeyNorm.of(x)][x] += 1
            labels.update({lb for lb, _ in c['feats'] if lb})
            gnames.update({g for g in c['groups'] if g})
        block = [ln for c in L for _, ln in c['feats']]
        return {
            'cat': cat,
            'cards': n,
            'features': med([len(c['feats']) for c in L]),
            'blockChars': med(block),
            'descChars': med([sum(ln for _, ln in c['feats']) for c in L]),
            'groups': med([len(c['groups']) for c in L]),
            'rows': med([len(c['keys']) for c in L]),
            'keys': [
                {'k': shown[k].most_common(1)[0][0], 'share': round(v / n, 2)}
                for k, v in keys.most_common(self.TOP_KEYS)
                if v / n >= self.KEY_SHARE
            ],
            'labels': [lb for lb, v in labels.most_common(self.TOP_LABELS) if v / n >= 0.15],
            'groupNames': [g for g, v in gnames.most_common(8) if v / n >= 0.15],
        }


class ModelFacts:
    """Карточки каталога с тем же наименованием (слова и числа в любом порядке) — исходные данные для ИИ."""

    LIMIT = 2
    MAX_ROWS = 80
    MAX_TEXT = 3000
    WORD = re.compile(r'\d+(?:[.,]\d+)?|[a-zа-яё]+', re.I)

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def words(cls, name) -> frozenset:
        """«Компрессор G 11, 7,5 бар» → {компрессор, g, 11, 7.5, бар}."""
        return frozenset(w.lower().replace('ё', 'е').replace(',', '.') for w in cls.WORD.findall(str(name or '')))

    def find(self, maker: str = '', model: str = '', name: str = '', exclude: str = '') -> list[dict]:
        """[{name, rows: [[k, v]], text}] — до LIMIT карточек, кроме exclude."""
        key = self.words(name)
        if len(key) < 2:
            return []
        # предотбор по самому длинному латинскому слову: LIKE в SQLite не различает регистр только у латиницы
        lat = [x for x in key if re.match(r'^[a-z0-9]{2,}$', x)]
        where, args = [], ()
        if lat:
            where.append('name LIKE ?')
            args += ('%' + max(lat, key=len) + '%',)
        if maker:
            where.append('maker = ? COLLATE NOCASE')
            args += (str(maker).strip(),)
        sql = 'SELECT id, doc FROM catalog' + (' WHERE ' + ' AND '.join(where) if where else '')
        out = []
        for cid, text in self.store.all(sql, args):
            if cid == exclude:
                continue
            try:
                d = json.loads(text)
            except ValueError:
                continue
            if d.get('kind') == 'option' or self.words(d.get('name')) != key:
                continue
            fact = self._facts(d)
            if fact['rows'] or fact['text']:
                out.append(fact)
            if len(out) >= self.LIMIT:
                break
        return out

    def _facts(self, d: dict) -> dict:
        rows = [
            [str(r.get('k')), str(r.get('v'))]
            for g in (d.get('groups') or [])
            if isinstance(g, dict)
            for r in (g.get('rows') or [])
            if isinstance(r, dict) and r.get('k') and r.get('v')
        ][: self.MAX_ROWS]
        text = '\n'.join(
            f'{f.get("label") or ""}: {f.get("text") or ""}'
            for f in (d.get('features') or [])
            if isinstance(f, dict) and f.get('text')
        )[: self.MAX_TEXT]
        return {'name': str(d.get('name') or ''), 'rows': rows, 'text': text}
