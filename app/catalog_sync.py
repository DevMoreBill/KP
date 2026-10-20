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
        state = self.state()
        try:
            since = int(since)
        except (TypeError, ValueError):
            return None
        if since <= 0 or epoch != state['epoch'] or since > state['seq']:
            return None
        total = self.store.scalar('SELECT COUNT(*) FROM catalog WHERE seq > ?', (since,))
        if total > self.MAX_DELTA:
            return None
        items = self.store.joined('SELECT light AS x FROM catalog WHERE seq > ? ORDER BY seq', (since,))
        gone = [rec[0] for rec in self.store.all('SELECT id FROM catalog_gone WHERE seq > ?', (since,))]
        return dict(state, full=False, items=items, gone=gone)

    def delta_json(self, data: dict) -> str:
        epoch, gone = json.dumps(data['epoch']), json.dumps(data['gone'], ensure_ascii=False)
        return f'{{"epoch":{epoch},"seq":{int(data["seq"])},"full":false,"items":[{data["items"]}],"gone":{gone}}}'

    def full_json(self) -> str:
        state = self.state()
        epoch, items = json.dumps(state['epoch']), self.store.catalog_light()
        return f'{{"epoch":{epoch},"seq":{int(state["seq"])},"full":true,"items":{items},"gone":[]}}'

    def search(self, query: str) -> list[str]:
        """id позиций со всеми словами запроса (от двух букв); база отдаёт их одной строкой."""
        words = [word for word in re.split(r'\s+', norm(query)) if len(word) >= self.MIN_WORD][:8]
        if not words:
            return []
        where = ' AND '.join(["search LIKE ? ESCAPE '\\'"] * len(words))
        ids = self.store.joined(
            f'SELECT id AS x FROM catalog WHERE {where} LIMIT {self.SEARCH_LIMIT}',
            tuple(like_arg(word) for word in words),
            '\n',
        )
        return ids.split('\n') if ids else []
