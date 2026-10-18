# -*- coding: utf-8 -*-
"""Образец объёма для автозаполнения карточки с ИИ — по тому, как уже заполнен каталог.

• CategoryProfile — для каждой категории: сколько обычно блоков описания и какой длины, сколько групп и строк
  характеристик, какие характеристики и темы описания встречаются у большинства карточек (медианы, без пустых
  карточек и опций). Считается одним проходом по каталогу и хранится до изменения каталога (data_rev).
• ModelFacts — достоверные данные этой же позиции, уже имеющиеся в каталоге (другие карточки с тем же наименованием —
  те же слова и числа в любом порядке, например из фидов поставщиков): ИИ получает их как исходные данные. Другие исполнения
  той же модели (7,5 и 10 бар, на ресивере и напольное) не берутся — их значения отличаются.
"""
import json
import re
import statistics
import threading
import time
from collections import Counter, defaultdict


class KeyNorm:
    """Сравнение названий характеристик: «Мощность, кВт», «Мощность (кВт)» и «мощность» — одна характеристика."""
    UNIT = re.compile(r'\s*[,(].*$')
    SPACE = re.compile(r'\s+')

    @classmethod
    def of(cls, k):
        return cls.SPACE.sub(' ', cls.UNIT.sub('', str(k or '')).replace('ё', 'е').lower()).strip()


class CategoryProfile:
    """Средний объём заполнения карточек каталога по категориям."""
    MIN_CARDS = 3          # меньше карточек — образца нет
    KEY_SHARE = 0.3        # характеристика «типичная», если есть хотя бы у такой доли карточек
    TOP_KEYS = 30
    TOP_LABELS = 10
    _cache = {}
    _lock = threading.Lock()

    def __init__(self, store):
        self.store = store

    FRESH = 600            # с — образец категории пересчитывается не чаще (каталог меняется при каждом сохранении КП —
                           # ценами, а объём описаний и характеристик за минуты не меняется)

    def get(self, cat):
        """Образец категории или None (мало карточек). Считается только по этой категории (индекс catalog_cat), а не по
        всему каталогу: 20 000 карточек разбирались около 4 с на каждый запрос после сохранения КП."""
        cat = str(cat or '')
        rev, now = self.store.data_rev('catalog'), time.time()
        with self._lock:
            hit = self._cache.get(cat)
            if hit and (hit[0] == rev or now - hit[1] < self.FRESH):
                return hit[2]
            if hit and cat not in self._busy:          # устарел — прежний образец сейчас, новый считается в фоне
                self._busy.add(cat)
                threading.Thread(target=self._rebuild, args=(cat, rev), daemon=True, name='ai-profile').start()
                return hit[2]
        return self._rebuild(cat, rev)

    _busy = set()

    def _rebuild(self, cat, rev):
        try:
            cards = [c for c in (self._card(doc) for (doc,) in self.store.all('SELECT doc FROM catalog WHERE cat = ?', (cat,))) if c]
            prof = self._profile(cat, cards) if len(cards) >= self.MIN_CARDS else None
            with self._lock:
                self._cache[cat] = (rev, time.time(), prof)
            return prof
        finally:
            with self._lock:
                self._busy.discard(cat)

    @staticmethod
    def _card(text):
        """Что заполнено в карточке: блоки описания, группы и строки. None — опция или пустая карточка."""
        try:
            d = json.loads(text)
        except ValueError:
            return None
        if d.get('kind') == 'option':
            return None
        feats = [f for f in (d.get('features') or []) if isinstance(f, dict) and str(f.get('text') or '').strip()]
        groups = [g for g in (d.get('groups') or []) if isinstance(g, dict) and any(isinstance(r, dict) and r.get('v') for r in (g.get('rows') or []))]
        rows = [r for g in groups for r in g['rows'] if isinstance(r, dict) and r.get('k') and r.get('v')]
        if not feats and not rows:
            return None
        return {'feats': [(str(f.get('label') or '').strip(), len(str(f['text']))) for f in feats],
                'groups': [str(g.get('name') or '').strip() for g in groups], 'keys': [str(r['k']).strip() for r in rows]}

    def _profile(self, cat, L):
        med = lambda xs: int(round(statistics.median(xs))) if xs else 0
        n = len(L)
        keys, shown, labels, gnames = Counter(), defaultdict(Counter), Counter(), Counter()
        for c in L:
            for k in set(KeyNorm.of(x) for x in c['keys'] if x):
                keys[k] += 1
            for x in c['keys']:
                shown[KeyNorm.of(x)][x] += 1
            labels.update(set(lb for lb, _ in c['feats'] if lb))
            gnames.update(set(g for g in c['groups'] if g))
        block = [ln for c in L for _, ln in c['feats']]
        return {
            'cat': cat, 'cards': n,
            'features': med([len(c['feats']) for c in L]), 'blockChars': med(block), 'descChars': med([sum(ln for _, ln in c['feats']) for c in L]),
            'groups': med([len(c['groups']) for c in L]), 'rows': med([len(c['keys']) for c in L]),
            'keys': [{'k': shown[k].most_common(1)[0][0], 'share': round(v / n, 2)} for k, v in keys.most_common(self.TOP_KEYS) if v / n >= self.KEY_SHARE],
            'labels': [lb for lb, v in labels.most_common(self.TOP_LABELS) if v / n >= 0.15],
            'groupNames': [g for g, v in gnames.most_common(8) if v / n >= 0.15],
        }


class ModelFacts:
    """Данные той же позиции, уже имеющиеся в каталоге: наименование совпадает словами и числами (порядок, регистр и знаки не важны)."""
    LIMIT = 2
    MAX_ROWS = 80
    MAX_TEXT = 3000
    WORD = re.compile(r'\d+(?:[.,]\d+)?|[a-zа-яё]+', re.I)

    def __init__(self, store):
        self.store = store

    @classmethod
    def words(cls, name):
        """Слова и числа наименования: «Винтовой компрессор G 11, 7,5 бар» → {винтовой, компрессор, g, 11, 7.5, бар}."""
        return frozenset(w.lower().replace('ё', 'е').replace(',', '.') for w in cls.WORD.findall(str(name or '')))

    def find(self, maker='', model='', name='', exclude=''):
        """[{name, rows: [[k, v]], text}] — до LIMIT карточек с тем же наименованием (без карточки exclude)."""
        key = self.words(name)
        if len(key) < 2:
            return []
        # сначала — по столбцу названия (самое длинное слово или число наименования), карточки разбираются только у совпавших
        # (латиница и цифры: LIKE в SQLite без учёта регистра только для латиницы); такого слова нет — перебор, как раньше
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

    def _facts(self, d):
        rows = [[str(r.get('k')), str(r.get('v'))] for g in (d.get('groups') or []) if isinstance(g, dict)
                for r in (g.get('rows') or []) if isinstance(r, dict) and r.get('k') and r.get('v')][:self.MAX_ROWS]
        text = '\n'.join('%s: %s' % (f.get('label') or '', f.get('text') or '') for f in (d.get('features') or [])
                         if isinstance(f, dict) and f.get('text'))[:self.MAX_TEXT]
        return {'name': str(d.get('name') or ''), 'rows': rows, 'text': text}
