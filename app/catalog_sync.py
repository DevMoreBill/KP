# -*- coding: utf-8 -*-
"""Каталог 20 000+ позиций: браузер хранит каталог у себя и докачивает только изменения; поиск по характеристикам — на сервере.

• sync(since, epoch) — изменённые после номера since облегчённые карточки и удалённые id. Каталог целиком — если браузер
  ещё ничего не хранит (since=0), база заменена (другая epoch) или номер браузера новее серверного (база восстановлена из копии).
• search(q) — id позиций, в строке поиска которых есть все слова запроса (название, параметры, характеристики, артикул).
"""
import json
import re

from storage import like_arg, norm


class CatalogSync:
    MAX_DELTA = 3000           # изменений больше — проще отдать каталог целиком (он сжат и кэширован)
    SEARCH_LIMIT = 20000
    MIN_WORD = 2

    def __init__(self, store):
        self.store = store

    def state(self):
        return {'epoch': self.store.catalog_epoch(), 'seq': int(self.store.data_rev('catalog') or 0)}

    def delta(self, since, epoch):
        """{epoch, seq, full: False, items, gone} или None — нужен каталог целиком."""
        st = self.state()
        try:
            since = int(since)
        except (TypeError, ValueError):
            return None
        if since <= 0 or epoch != st['epoch'] or since > st['seq']:
            return None
        n = self.store.one('SELECT COUNT(*) FROM catalog WHERE seq > ?', (since,))[0]
        if n > self.MAX_DELTA:
            return None
        items = [r[0] for r in self.store.all('SELECT light FROM catalog WHERE seq > ? ORDER BY seq', (since,))]
        gone = [r[0] for r in self.store.all('SELECT id FROM catalog_gone WHERE seq > ?', (since,))]
        return dict(st, full=False, items=items, gone=gone)

    def delta_json(self, d):
        """Ответ без повторного разбора облегчённых карточек (они уже строки JSON)."""
        return ('{"epoch":%s,"seq":%d,"full":false,"items":[%s],"gone":%s}'
                % (json.dumps(d['epoch']), d['seq'], ','.join(d['items']), json.dumps(d['gone'], ensure_ascii=False)))

    def full_json(self):
        st = self.state()
        return '{"epoch":%s,"seq":%d,"full":true,"items":%s,"gone":[]}' % (json.dumps(st['epoch']), st['seq'], self.store.catalog_light())

    def search(self, q):
        """id позиций со всеми словами запроса; слова короче двух букв не учитываются."""
        words = [w for w in re.split(r'\s+', norm(q)) if len(w) >= self.MIN_WORD][:8]
        if not words:
            return []
        where = ' AND '.join(["search LIKE ? ESCAPE '\\'"] * len(words))
        return [r[0] for r in self.store.all('SELECT id FROM catalog WHERE %s LIMIT %d' % (where, self.SEARCH_LIMIT),
                                             tuple(like_arg(w) for w in words))]
