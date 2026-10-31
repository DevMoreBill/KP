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

    LABEL_SHARE = 0.15

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
                card
                for card in (
                    self._card(doc) for (doc,) in self.store.all('SELECT doc FROM catalog WHERE cat = ?', (cat,))
                )
                if card
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
            doc = json.loads(text)
        except ValueError:
            return None
        if doc.get('kind') == 'option':
            return None
        feats = [
            feat
            for feat in (doc.get('features') or [])
            if isinstance(feat, dict) and str(feat.get('text') or '').strip()
        ]
        groups = [
            group
            for group in (doc.get('groups') or [])
            if isinstance(group, dict)
            and any(isinstance(row, dict) and row.get('v') for row in (group.get('rows') or []))
        ]
        rows = [
            row for group in groups for row in group['rows'] if isinstance(row, dict) and row.get('k') and row.get('v')
        ]
        if not feats and not rows:
            return None
        return {
            'feats': [(str(feat.get('label') or '').strip(), len(str(feat['text']))) for feat in feats],
            'groups': [str(group.get('name') or '').strip() for group in groups],
            'keys': [str(row['k']).strip() for row in rows],
        }

    def _profile(self, cat: str, cards: list[dict]) -> dict:
        def med(values):
            return round(statistics.median(values)) if values else 0

        count = len(cards)
        keys: Counter = Counter()
        shown: defaultdict = defaultdict(Counter)
        labels: Counter = Counter()
        gnames: Counter = Counter()
        # по разу на карточку, в порядке карточки: равные по частоте — в одном порядке при любом запуске сервера
        for card in cards:
            keys.update(dict.fromkeys((KeyNorm.of(x) for x in card['keys'] if x), 1))
            for x in card['keys']:
                shown[KeyNorm.of(x)][x] += 1
            labels.update(dict.fromkeys((label for label, _ in card['feats'] if label), 1))
            gnames.update(dict.fromkeys((group for group in card['groups'] if group), 1))
        block = [line for card in cards for _, line in card['feats']]
        return {
            'cat': cat,
            'cards': count,
            'features': med([len(card['feats']) for card in cards]),
            'blockChars': med(block),
            'descChars': med([sum(line for _, line in card['feats']) for card in cards]),
            'groups': med([len(card['groups']) for card in cards]),
            'rows': med([len(card['keys']) for card in cards]),
            'keys': [
                {'k': shown[k].most_common(1)[0][0], 'share': round(v / count, 2)}
                for k, v in keys.most_common(self.TOP_KEYS)
                if v / count >= self.KEY_SHARE
            ],
            'labels': [label for label, v in labels.most_common(self.TOP_LABELS) if v / count >= self.LABEL_SHARE],
            'groupNames': [group for group, v in gnames.most_common(8) if v / count >= self.LABEL_SHARE],
        }


class ModelFacts:
    """Карточки каталога с тем же наименованием (слова и числа в любом порядке) — исходные данные для ИИ."""

    KEY_MIN = 2

    LIMIT = 2
    MAX_ROWS = 80
    MAX_TEXT = 3000
    WORD = re.compile(r'\d+(?:[.,]\d+)?|[a-zа-яё]+', re.I)

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def words(cls, name) -> frozenset:
        """«Компрессор G 11, 7,5 бар» → {компрессор, g, 11, 7.5, бар}."""
        return frozenset(word.lower().replace('ё', 'е').replace(',', '.') for word in cls.WORD.findall(str(name or '')))

    def find(self, maker: str = '', model: str = '', name: str = '', exclude: str = '') -> list[dict]:
        """[{name, rows: [[k, v]], text}] — до LIMIT карточек, кроме exclude."""
        key = self.words(name)
        if len(key) < self.KEY_MIN:
            return []
        # предотбор по самому длинному латинскому слову: LIKE в SQLite не различает регистр только у латиницы
        lat = [x for x in key if re.match(r'^[a-z0-9]{2,}$', x)]
        where: list[str] = []
        args: tuple = ()
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
                doc = json.loads(text)
            except ValueError:
                continue
            if doc.get('kind') == 'option' or self.words(doc.get('name')) != key:
                continue
            fact = self._facts(doc)
            if fact['rows'] or fact['text']:
                out.append(fact)
            if len(out) >= self.LIMIT:
                break
        return out

    def _facts(self, doc: dict) -> dict:
        rows = [
            [str(row.get('k')), str(row.get('v'))]
            for group in (doc.get('groups') or [])
            if isinstance(group, dict)
            for row in (group.get('rows') or [])
            if isinstance(row, dict) and row.get('k') and row.get('v')
        ][: self.MAX_ROWS]
        text = '\n'.join(
            f'{feat.get("label") or ""}: {feat.get("text") or ""}'
            for feat in (doc.get('features') or [])
            if isinstance(feat, dict) and feat.get('text')
        )[: self.MAX_TEXT]
        return {'name': str(doc.get('name') or ''), 'rows': rows, 'text': text}
