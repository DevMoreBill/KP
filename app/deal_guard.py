"""Одна сделка на клиента: новое КП не заводит ещё одну сделку, пока у менеджера есть свежая незакрытая сделка того же
клиента (последнее КП в ней моложе срока «Значений программы»); исключения для клиентов задаёт администратор."""

import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum
from typing import Any

from clock import Clock
from crm import CrmBoard, DealBook
from defaults import SrvVal
from features import FeatureAccess, Viewer
from inn import Inn
from kp_track import Val


class DealMode(Enum):
    """Новые сделки по КП для клиента — выбор администратора в карточке клиента."""

    RULE = ''  # по общему правилу — не раньше срока после последнего КП незакрытой сделки
    ONCE = 'once'  # одну новую сделку можно, после неё — снова общее правило
    ALWAYS = 'always'  # новые сделки можно всегда (у клиента много параллельных задач)
    NEVER = 'never'  # нельзя, пока у менеджера есть незакрытая сделка клиента, — все КП в неё

    @classmethod
    def of(cls, value: object) -> 'DealMode':
        """Режим из записи; неизвестное — общее правило."""
        try:
            return cls(str(value or ''))
        except ValueError:
            return cls.RULE


class ClientDealRules:
    """Исключения клиентов — kv «dealRules»: {id клиента: {mode, by, at}}; клиента по общему правилу в записи нет.
    Отдельно от карточки клиента: её сохраняют и менеджеры (из КП), режим меняет только администратор."""

    KEY = 'dealRules'
    ID_MAX = 64
    ID_RE = re.compile(r'^[A-Za-z0-9_.:-]{1,64}$')
    AUTHOR_MAX = 120
    LABELS = {
        DealMode.ONCE: 'можно одну новую сделку',
        DealMode.ALWAYS: 'новые сделки — всегда',
        DealMode.NEVER: 'новые сделки запрещены',
    }

    def __init__(self, store) -> None:
        self.store = store

    def all(self) -> dict[str, dict]:
        """{id клиента: {mode, by, at}} — только исключения."""
        rules = self.store.kv_get(self.KEY) or {}
        if not isinstance(rules, dict):
            return {}
        return {
            str(cid): rec
            for cid, rec in rules.items()
            if isinstance(rec, dict) and DealMode.of(rec.get('mode')) is not DealMode.RULE
        }

    def mode_of(self, keys: list[str]) -> tuple[DealMode, str]:
        """Режим клиента по его ключам (id в справочнике, «inn» + ИНН) → (режим, id клиента с исключением)."""
        rules = self.all()
        found = next((key for key in keys if key in rules), '')
        return (DealMode.of(rules[found].get('mode')), found) if found else (DealMode.RULE, '')

    def put(self, cid: object, mode: object, author: str) -> tuple[dict | None, dict | None]:
        """Режим клиента (общее правило — исключение снимается) → (было, стало). ValueError — понятным текстом."""
        key = str(cid or '').strip()
        if not self.ID_RE.match(key):
            raise ValueError('Не выбран клиент')
        if str(mode or '') not in {item.value for item in DealMode}:
            raise ValueError('Неизвестный выбор для новых сделок')
        if not self.store.client_get(key):
            raise ValueError('Клиента нет в справочнике — сначала сохраните его карточку')
        chosen = DealMode(str(mode or ''))
        with self.store.lock:
            rules = self.all()
            before = rules.pop(key, None)
            after = None
            if chosen is not DealMode.RULE:
                after = {'mode': chosen.value, 'by': str(author or '')[: self.AUTHOR_MAX], 'at': Clock.now()}
                rules[key] = after
            self.store.kv_set(self.KEY, rules)
        return before, after

    def spend(self, cid: str) -> None:
        """«Можно одну новую сделку» использовано — у клиента снова общее правило."""
        if not cid:
            return
        with self.store.lock:
            rules = self.all()
            if DealMode.of((rules.get(cid) or {}).get('mode')) is DealMode.ONCE:
                del rules[cid]
                self.store.kv_set(self.KEY, rules)

    def labels(self) -> dict[str, str]:
        """{id клиента: подпись исключения} — для списка клиентов «Настроек»."""
        return {cid: self.LABELS[DealMode.of(rec.get('mode'))] for cid, rec in self.all().items()}

    def listing(self) -> list[dict[str, Any]]:
        """Исключения с названием и ИНН клиента, по названию."""
        rules = self.all()
        cards = self.store.clients_get(list(rules))
        rows = [
            {
                'id': cid,
                'name': str((cards.get(cid) or {}).get('name') or cid),
                'inn': str((cards.get(cid) or {}).get('inn') or ''),
                'mode': DealMode.of(rec.get('mode')).value,
                'label': self.LABELS[DealMode.of(rec.get('mode'))],
                'by': str(rec.get('by') or ''),
                'at': str(rec.get('at') or ''),
            }
            for cid, rec in rules.items()
        ]
        return sorted(rows, key=lambda row: row['name'].lower())


class DealSeen:
    """КП могли перенести в другую сделку, пока его правили: в открытое КП приходит сделка, где оно сейчас (dealId и
    _dealSeen), а при сохранении прежняя сделка, которую менеджер в КП не менял, не возвращает КП обратно."""

    FIELD = 'dealSeen'
    ID_MAX = 40

    @staticmethod
    def inject(text: str, did: str | None) -> str:
        """Состояние КП (JSON) со сделкой, где КП сейчас; КП без сделки — как сохранено."""
        if not did:
            return text
        try:
            state = json.loads(text)
        except ValueError:
            return text
        if not isinstance(state, dict):
            return text
        state.update(dealId=did, _dealSeen=did)
        return json.dumps(state, ensure_ascii=False)

    @classmethod
    def want(cls, meta: dict, want: str, cur: str | None) -> str:
        """Сделка, выбранная в КП; '' — та же, что менеджер видел при открытии, а КП с тех пор в другой сделке."""
        seen = str(meta.get(cls.FIELD) or '')[: cls.ID_MAX]
        return '' if cur and seen and seen != cur and want == seen else want


@dataclass(frozen=True)
class DealLock:
    """Незакрытая сделка клиента, в которую встаёт новое КП вместо новой сделки."""

    deal: str
    number: object
    title: str
    last: date  # день последнего КП в сделке (без КП — её создания)
    until: date | None  # с этого дня можно новую сделку; None — запрет администратора, пока сделка открыта
    basis: str = 'kp'  # last — день последнего КП ('kp') или создания сделки без КП ('created')

    def out(self) -> dict[str, Any]:
        return {
            'deal': self.deal,
            'number': self.number,
            'title': self.title,
            'last': self.last.isoformat(),
            'until': self.until.isoformat() if self.until else '',
            'reason': 'days' if self.until else 'client',
            'basis': self.basis,
        }


@dataclass(frozen=True)
class GuardVerdict:
    """Можно ли новую сделку клиента: lock — нельзя (сделка, в которую встанет КП); spend — клиент, у которого
    израсходовать «одну новую сделку», когда она будет создана."""

    mode: DealMode
    lock: DealLock | None = None
    spend: str = ''

    def out(self) -> dict[str, Any]:
        return {'mode': self.mode.value, 'lock': self.lock.out() if self.lock else None}


@dataclass(frozen=True)
class GuardPlan:
    """Сделка для DealBook.on_kp и что сказать менеджеру: lock — КП встало в незакрытую сделку вместо новой."""

    want: str | None
    lock: DealLock | None = None
    spend: str = ''


class DealGuard:
    """Правило «одна сделка на клиента»: решает при сохранении КП, подсказывает выбору сделки в разделе «Клиент» КП.
    Сделки — того менеджера, за которым была бы новая сделка КП (автор КП), того же клиента (ИНН, без ИНН — название) и
    той же задачи (КП для тендера — той же закупки)."""

    FEATURE = 'dealGuard'
    DAYS = 'crm.dealLockDays'
    NEW = 'new'
    MID_MAX = 64

    def __init__(self, store) -> None:
        self.store = store
        self.book = DealBook(store)
        self.rules = ClientDealRules(store)

    def plan(self, kid: str, meta: dict, want: str | None) -> GuardPlan:
        """КП сохраняется: новая сделка (выбрана «Отдельная новая сделка» или КП ещё без сделки) — только если правило
        позволяет; иначе want — свежая незакрытая сделка клиента."""
        if not self._makes_new(kid, want):
            return GuardPlan(want)
        verdict = self.check(meta, self.manager_of(meta))
        if verdict.lock:
            return GuardPlan(verdict.lock.deal, verdict.lock)
        return GuardPlan(want, spend=verdict.spend)

    def done(self, plan: GuardPlan, did: str | None) -> None:
        """Сделка из КП создана — «одна новая сделка» клиента израсходована."""
        if did and plan.spend:
            self.rules.spend(plan.spend)

    def check(self, meta: dict, mid: str) -> GuardVerdict:
        """Можно ли новую сделку клиента КП у менеджера mid."""
        if not self.applies(mid):
            return GuardVerdict(DealMode.RULE)
        mode, cid = self.rules.mode_of(self.client_keys(meta))
        if mode is DealMode.ALWAYS:
            return GuardVerdict(mode)
        if mode is DealMode.ONCE:
            return GuardVerdict(mode, spend=cid)
        return GuardVerdict(mode, self._lock(meta, mid, mode))

    def applies(self, mid: str) -> bool:
        """Правило включено («Функции программы») для менеджера."""
        access = FeatureAccess(self.store)
        return access.allowed(access.config(), self.FEATURE, Viewer(admin=False, uid=mid))

    @classmethod
    def manager_of(cls, meta: dict) -> str:
        """Менеджер, за которым была бы новая сделка КП (как в DealBook._from_kp)."""
        return str(meta.get('authorId') or meta.get('managerId') or '')[: cls.MID_MAX]

    @staticmethod
    def client_keys(meta: dict) -> list[str]:
        """Ключи клиента КП в справочнике: «inn» + ИНН и id карточки."""
        inn = Inn.key(meta.get('clientInn'))
        keys = [f'inn{inn}'] if inn else []
        own = str(meta.get('clientId') or '')
        if own and own not in keys:
            keys.append(own)
        return keys

    @staticmethod
    def _same_kind(mark: dict | None, tender: str) -> bool:
        """Сделка той же задачи: КП для тендера — только в сделку с КП той же закупки (другая закупка — своя сделка),
        обычное КП — в сделку с обычными КП или без КП."""
        if not mark:
            return not tender
        return tender in mark['tenders']

    def _makes_new(self, kid: str, want: str | None) -> bool:
        if want == self.NEW:
            return True
        if want and self.book.get(want):
            return False
        cur = self.book.deal_of(kid)
        return not cur or not (self.book.get(cur) or self.book.in_trash(cur))

    def _lock(self, meta: dict, mid: str, mode: DealMode) -> DealLock | None:
        days = SrvVal.get(self.store, self.DAYS)
        if mode is DealMode.RULE and days <= 0:
            return None
        inn, name = Inn.key(meta.get('clientInn')), str(meta.get('client') or '')
        if not (inn or name.strip()):
            return None
        deals = CrmBoard(self.store).pick([mid], inn, name)
        marks = self.book.kp_marks([deal['id'] for deal in deals])
        tender = DealBook.tender_of(meta)
        today = date.today()
        best: tuple[str, DealLock] | None = None
        for deal in deals:
            mark = marks.get(deal['id'])
            if not self._same_kind(mark, tender):
                continue
            stamp = str((mark or {}).get('last') or deal.get('created') or deal.get('updated') or '')
            day = Val.day(stamp)
            if not day:
                continue
            until = day + timedelta(days=days) if mode is DealMode.RULE else None
            if until and until <= today:
                continue
            if best is None or stamp > best[0]:
                title = str(deal.get('title') or deal.get('client') or '')
                basis = 'kp' if (mark or {}).get('last') else 'created'
                best = (stamp, DealLock(deal['id'], deal.get('number'), title, day, until, basis))
        return best[1] if best else None
