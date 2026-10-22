"""Дела, которые кабинет ставит сам: звонок после отправки КП, напоминание о сделке без движения, решение до конца срока КП."""

import json
from datetime import date, timedelta
from typing import Any

from crm import DealBook, TaskBook
from crm_funnels import Funnels
from defaults import SrvVal
from kp_track import Val


def _obj(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        found = json.loads(raw or '{}')
    except (TypeError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


class AutoTasks:
    """Правила дел (сроки — «Значения программы», 0 — правило выключено); каждое дело — один раз на повод (`step`)."""

    WHO = 'Кабинет: дело само'
    SENT = 'auto:sent:'
    IDLE = 'auto:idle:'
    EXPIRE = 'auto:expire:'
    NEW = 'auto:new:'
    CLOSING = 'auto:closing:'
    END_OF_DAY = '17:00'

    def __init__(self, store) -> None:
        self.store = store
        self.tasks = TaskBook(store)

    def sync(self, deal: dict) -> int:
        """Дела по одной сделке. → сколько поставлено."""
        have = self.tasks.list(deal=deal['id'])
        self._settle_new(deal, have)
        steps = {task.get('step') for task in have if task.get('step')}
        wanted = self._closing(deal)
        if deal.get('stage') not in Funnels.CLOSED:
            offers = self._offers(deal['id'])
            wanted += [
                *self._new_request(deal),
                *self._after_sent(offers),
                *self._expiring(offers),
                *self._idle(deal, have),
            ]
        added = 0
        for step, body in wanted:
            if step in steps:
                continue
            task = self.tasks.add(body, deal.get('managerId') or '', self.WHO, deal['id'], step=step)
            self._to_bitrix(task['id'])
            steps.add(step)
            added += 1
        return added

    def sweep(self) -> int:
        """Все незакрытые сделки (по расписанию). → сколько дел поставлено."""
        book = DealBook(self.store)
        added = 0
        for (did,) in self.store.all("SELECT id FROM deals WHERE stage NOT IN ('won', 'lost')", ()):
            deal = book.get(did)
            if deal:
                added += self.sync(deal)
        return added

    def _days(self, key: str) -> int:
        return int(SrvVal.get(self.store, key))

    def _offers(self, did: str) -> list[dict]:
        rows = self.store.all(
            'SELECT k.id, k.meta, k.track FROM deal_kp l JOIN kp k ON k.id = l.kp_id WHERE l.deal_id=? AND k.meta IS NOT NULL',
            (did,),
        )
        return [{'id': kid, 'meta': _obj(meta), 'track': _obj(track)} for kid, meta, track in rows]

    def _after_sent(self, offers: list[dict]) -> list[tuple[str, dict]]:
        """КП отправлено, своего «перезвонить» нет — звонок через N дней после отправки."""
        days = self._days('crm.autoCallDays')
        if not days:
            return []
        out = []
        for offer in offers:
            track = offer['track']
            sent = Val.day(track.get('at')) if track.get('status') == 'sent' else None
            if not sent or track.get('followUp'):
                continue
            number = offer['meta'].get('number') or offer['id']
            due = max(sent + timedelta(days=days), date.today()).isoformat()
            body = {'kind': 'call', 'title': f'Обратная связь по КП № {number}', 'due': due}
            out.append((self.SENT + offer['id'], body))
        return out

    def _expiring(self, offers: list[dict]) -> list[tuple[str, dict]]:
        """Срок действия КП кончается через N дней (КП не выиграно и не проиграно) — «уточнить решение»."""
        days = self._days('crm.autoExpireDays')
        if not days:
            return []
        out = []
        today = date.today()
        for offer in offers:
            until = Val.day(offer['meta'].get('validUntil'))
            if (
                not until
                or offer['track'].get('status') in Funnels.CLOSED
                or not today <= until <= today + timedelta(days=days)
            ):
                continue
            number = offer['meta'].get('number') or offer['id']
            title = 'Уточнить решение: КП № {} действует до {}'.format(number, until.strftime('%d.%m'))
            out.append((self.EXPIRE + offer['id'], {'kind': 'call', 'title': title, 'due': today.isoformat()}))
        return out

    def _idle(self, deal: dict, have: list[dict]) -> list[tuple[str, dict]]:
        """Нет открытых дел и сделка не менялась N дней — «связаться с клиентом» (одно дело на каждый такой промежуток)."""
        days = self._days('crm.autoIdleDays')
        changed = Val.day(str(deal.get('updated') or '')[:10])
        if not days or not changed or any(task.get('state') == 'open' for task in have):
            return []
        if (date.today() - changed).days < days:
            return []
        body = {
            'kind': 'call',
            'title': f'Связаться с клиентом: по сделке нет движения {days} дн.',
            'due': date.today().isoformat(),
        }
        return [(self.IDLE + changed.isoformat(), body)]

    def _new_request(self, deal: dict) -> list[tuple[str, dict]]:
        """Регламент Битрикс24: к концу дня на стадии «Новая заявка» сделок не остаётся — взять в работу или закрыть."""
        from deal_rules import DealRegs

        funnel = deal.get('funnel') or Funnels.MAIN
        if funnel == Funnels.MAIN or deal.get('fstage') != Funnels(self.store).first(funnel):
            return []
        if not DealRegs(self.store).enabled():
            return []
        body = {
            'kind': 'task',
            'title': 'Новая заявка: взять в работу или закрыть до конца дня',
            'due': date.today().isoformat(),
            'time': self.END_OF_DAY,
        }
        return [(self.NEW + deal['id'], body)]

    def _closing(self, deal: dict) -> list[tuple[str, dict]]:
        """Поставка отмечена или сделка выиграна, а акта и УПД нет — «прикрепить закрывающие документы»."""
        from deal_files import DealClosing

        if not DealClosing(self.store).due(deal):
            return []
        body = {
            'kind': 'task',
            'title': 'Прикрепить закрывающие документы (акт или УПД)',
            'due': date.today().isoformat(),
        }
        return [(self.CLOSING + deal['id'], body)]

    def settle_closing(self, did: str) -> None:
        """Акт или УПД прикреплены — дело «прикрепить закрывающие документы» сделано."""
        from deal_files import DealFiles

        if not DealFiles.of(self.store).has_closing(did):
            return
        for task in self.tasks.list(deal=did):
            if task.get('step') == self.CLOSING + did and task.get('state') == 'open':
                self.tasks.update(task['id'], {'state': 'done'}, self.WHO)
                self._to_bitrix(task['id'])

    def _settle_new(self, deal: dict, have: list[dict]) -> None:
        """Сделка ушла с «Новой заявки» — её дело «взять в работу» сделано."""
        if deal.get('fstage') == Funnels(self.store).first(deal.get('funnel') or Funnels.MAIN):
            return
        for task in have:
            if task.get('step') == self.NEW + deal['id'] and task.get('state') == 'open':
                self.tasks.update(task['id'], {'state': 'done'}, self.WHO)
                self._to_bitrix(task['id'])

    def _to_bitrix(self, tid: Any) -> None:
        from bitrix import BitrixQueue

        BitrixQueue.touch(self.store, 'task', tid)
