"""Каталог в браузере: докачка изменений по номеру правки, поиск по характеристикам — на сервере."""

import json
import re

from storage import like_arg, norm


class CatalogSync:
    MAX_DELTA = 3000
    SEARCH_LIMIT = 20000
    MIN_WORD = 2

    def __init__(self, store) -> None:
        self.store = store

    def state(self) -> dict:
        return {'epoch': self.store.catalog_epoch(), 'seq': int(self.store.data_rev('catalog') or 0)}

    def delta(self, since, epoch: str) -> dict | None:
        """{epoch, seq, full, items — карточки JSON через запятую, gone}; None — нужен каталог целиком."""
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
        items = self.store.joined('SELECT light AS x FROM catalog WHERE seq > ? ORDER BY seq', (since,))
        gone = [r[0] for r in self.store.all('SELECT id FROM catalog_gone WHERE seq > ?', (since,))]
        return dict(st, full=False, items=items, gone=gone)

    def delta_json(self, d: dict) -> str:
        epoch, gone = json.dumps(d['epoch']), json.dumps(d['gone'], ensure_ascii=False)
        return f'{{"epoch":{epoch},"seq":{int(d["seq"])},"full":false,"items":[{d["items"]}],"gone":{gone}}}'

    def full_json(self) -> str:
        st = self.state()
        epoch, items = json.dumps(st['epoch']), self.store.catalog_light()
        return f'{{"epoch":{epoch},"seq":{int(st["seq"])},"full":true,"items":{items},"gone":[]}}'

    def search(self, q: str) -> list[str]:
        """id позиций со всеми словами запроса (от двух букв); база отдаёт их одной строкой."""
        words = [w for w in re.split(r'\s+', norm(q)) if len(w) >= self.MIN_WORD][:8]
        if not words:
            return []
        where = ' AND '.join(["search LIKE ? ESCAPE '\\'"] * len(words))
        ids = self.store.joined(
            f'SELECT id AS x FROM catalog WHERE {where} LIMIT {self.SEARCH_LIMIT}',
            tuple(like_arg(w) for w in words),
            '\n',
        )
        return ids.split('\n') if ids else []
