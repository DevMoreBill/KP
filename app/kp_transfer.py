"""Передача сохранённого КП другому менеджеру: КП (автор, менеджер и его контакты в КП) и, по умолчанию, сделка КП с её
открытыми делами; в Битрикс24 сделка уходит с новым ответственным."""

import json
from enum import Enum
from typing import Any

from bitrix import BitrixQueue
from crm import DealBook, TaskBook


class DealMove(Enum):
    """Что делать со сделкой КП."""

    WITH = 'with'  # сделка переходит вместе с КП
    KEEP = 'keep'  # только КП (в сделке остаются КП других менеджеров)


class KpTransfer:
    """План передачи (что изменится) и сама передача."""

    CONTACTS = ('name', 'position', 'phone', 'ext', 'mobile', 'email')

    def __init__(self, store) -> None:
        self.store = store

    def _doc(self, kid: str, field: str) -> dict:
        try:
            found = json.loads(self.store.kp_get(kid, field) or '{}')
        except ValueError:
            found = {}
        return found if isinstance(found, dict) else {}

    def _manager(self, mid: str) -> dict:
        rows = json.loads(self.store.managers_list() or '[]')
        found = next((row for row in rows if isinstance(row, dict) and row.get('id') == mid), None)
        if not found:
            raise ValueError('Менеджер не найден — выберите из списка')
        return found

    def plan(self, kid: str) -> dict:
        """{number, managerId, manager, deal: {id, title, others} | None} — others: сколько в сделке КП других менеджеров."""
        meta = self._doc(kid, 'meta')
        if not meta:
            raise LookupError('КП не найдено или ещё не сохранено')
        owner = str(meta.get('authorId') or meta.get('managerId') or '')
        book = DealBook(self.store)
        did = book.deal_of(kid)
        deal = book.get(did) if did else None
        others = 0
        if deal:
            for (other,) in self.store.all('SELECT kp_id FROM deal_kp WHERE deal_id=? AND kp_id<>?', (did, kid)):
                theirs = self._doc(other, 'meta')
                if str(theirs.get('authorId') or theirs.get('managerId') or '') not in ('', owner):
                    others += 1
        return {
            'number': meta.get('number') or kid,
            'managerId': owner,
            'manager': meta.get('manager') or '',
            'deal': {'id': did, 'title': deal.get('title') or '', 'others': others} if deal else None,
        }

    def move(self, kid: str, mid: str, author: str, deal: DealMove = DealMove.WITH) -> dict:
        """Передать КП менеджеру mid. → {kp, deal}. ValueError / LookupError — понятным текстом."""
        plan = self.plan(kid)
        if plan['managerId'] == mid:
            raise ValueError('КП уже закреплено за этим менеджером')
        card = self._manager(mid)
        name = str(card.get('name') or '')
        with self.store.lock:  # чтение и запись КП одним шагом: сохранение КП между ними не теряется
            self._put_state(kid, mid, card, author)
            self._put_meta(kid, mid, card, author)
        moved = None
        if plan['deal'] and deal is DealMove.WITH:
            did = plan['deal']['id']
            DealBook(self.store).update(did, {}, author, manager=(mid, name))
            TaskBook(self.store).move_deal(did, mid)
            BitrixQueue.touch(self.store, 'deal', did)
            moved = did
        return {'kp': kid, 'manager': name, 'deal': moved, 'from': plan['manager']}

    def _put_state(self, kid: str, mid: str, card: dict, author: str) -> None:
        state = self._doc(kid, 'state')
        if not state:
            return
        contacts = picked if isinstance(picked := state.get('manager'), dict) else {}
        state.update(
            managerId=mid,
            authorId=mid,
            manager=dict(contacts, **{key: str(card.get(key) or '') for key in self.CONTACTS}),
        )
        self.store.kp_set(kid, 'state', json.dumps(state, ensure_ascii=False), author)

    def _put_meta(self, kid: str, mid: str, card: dict, author: str) -> None:
        meta: dict[str, Any] = self._doc(kid, 'meta')
        meta.update(
            managerId=mid,
            authorId=mid,
            manager=str(card.get('name') or ''),
            managerPost=str(card.get('position') or ''),
        )
        self.store.kp_set(kid, 'meta', json.dumps(meta, ensure_ascii=False), author)
