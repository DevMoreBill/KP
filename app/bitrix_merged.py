"""Объединение сделок (deal_merge) в Битрикс24: у итоговой своя сделка в Битриксе и у дубля своя — сделка дубля
закрывается проигранной (стадия проигрыша её воронки, «Причина проигрыша», если поле в карте полей) с записью в ленте
«Объединена со сделкой № …». Очередь обмена — вид BitrixQueue.MERGED, выключатель — dealMergeBx."""

from typing import Any

from bitrix import BitrixError, BitrixQueue, BitrixSync, GoneDeal
from crm import DealBook
from crm_funnels import Funnels
from deal_merge import MergedDeals
from features import FeatureAccess


class MergedLose:
    """Сделка дубля в Битриксе после объединения — проигранной (запись очереди обмена BitrixQueue.MERGED)."""

    FEATURE = 'dealMergeBx'
    MARK = 'merged'  # в согласованных значениях связи: закрыта после объединения в сделку с этим id
    SWEPT = 'mergedSwept'  # в настройке связи: объединённые раньше поставлены в очередь (один раз)
    REASON = 'Объединена со сделкой № {}'
    CLOSED = ('S', 'F')  # семантика стадии Битрикса: успех, провал
    FAILURE = 'F'
    PARAMS = {'REGISTER_SONET_EVENT': 'N'}

    def __init__(self, sync: BitrixSync) -> None:
        self.sync = sync
        self.store = sync.store
        self.book = DealBook(sync.store)

    @classmethod
    def queue(cls, store, sources: list[str]) -> None:
        """Объединение сделок: сделки дублей, оставшиеся в Битриксе своими, — в очередь (если функция включена)."""
        if not FeatureAccess(store).is_on(cls.FEATURE):
            return
        for source in sources:
            BitrixQueue.touch(store, BitrixQueue.MERGED, source)

    @classmethod
    def sweep(cls, sync: BitrixSync) -> None:
        """Один раз: сделки, объединённые до этой функции, — в очередь, если их сделка в Битриксе осталась своей."""
        if sync.conf.get().get(cls.SWEPT):
            return
        sync.conf.mark(**{cls.SWEPT: True})
        book = DealBook(sync.store)
        left = [one for one in MergedDeals(sync.store).sources() if not book.get(one) and cls._link(sync, one)]
        cls.queue(sync.store, left)

    @classmethod
    def _link(cls, sync: BitrixSync, source: str) -> dict | None:
        """Связь дубля со своей сделкой в Битриксе, ещё не закрытой после объединения."""
        link = sync.links.get('deal', source)
        return link if link and link['bx'] and not link['sent'].get(cls.MARK) else None

    def push(self, source: str) -> None:
        """Сделку дубля source в Битриксе — проигранной. Пропуск: функция выключена, своей сделки в Битриксе нет
        (итоговая продолжила её), дубль вернули из корзины, итоговой нет, обмен в Битрикс правилами закрыт."""
        link, target = self._link(self.sync, source), self._target(source)
        if not link or not target or not FeatureAccess(self.store).is_on(self.FEATURE):
            return
        if not self.sync.rules.can('deal', 'out', target.get('managerId')):
            return
        bx_deal = self._bx_deal(source, link['bx'])
        if bx_deal is not None:
            self._close(source, link, target, bx_deal)

    def _target(self, source: str) -> dict | None:
        found = MergedDeals(self.store).target_of(source)
        return self.book.get(found) if found != source else None

    def _bx_deal(self, source: str, bid: str) -> dict | None:
        """Сделка дубля в Битриксе; удалена там — связь снимается, закрывать нечего (None)."""
        try:
            return self.sync.api.call('crm.deal.get', {'id': bid}) or {}
        except BitrixError as exc:
            if not GoneDeal.is_gone(exc):
                raise
        self.sync.links.forget('deal', source)
        return None

    def _close(self, source: str, link: dict, target: dict, bx_deal: dict) -> None:
        bid, cat = link['bx'], str(bx_deal.get('CATEGORY_ID') or '0')
        stages = self.sync.stage_list(cat)
        number = (self.book.trashed(source) or {}).get('number') or source
        head = f'Сделка № {number} объединена со сделкой № {target.get("number")} → Битрикс24 (сделка {bid})'
        sent = dict(link['sent'], **{self.MARK: target['id']})
        if self._closed(bx_deal, stages):
            self.sync.links.put('deal', source, bid, sent)
            self.sync.log.add(f'{head}: уже закрыта — не меняется', mid=target.get('managerId'))
            return
        reason = self.REASON.format(target.get('number'))
        fields = self._fields(cat, stages, reason)
        if fields:
            self.sync.api.call('crm.deal.update', {'id': bid, 'fields': fields, 'params': self.PARAMS})
            sent['stage'] = fields['STAGE_ID']
        if self.sync.sends('lostReason') and fields:
            sent['lostReason'] = reason
        comment = {'ENTITY_ID': int(bid), 'ENTITY_TYPE': 'deal', 'COMMENT': self._comment(target, reason)}
        self.sync.api.call('crm.timeline.comment.add', {'fields': comment})
        self.sync.links.put('deal', source, bid, sent)
        said = 'проиграна' if fields else 'запись в ленте (стадию в Битрикс24 программа не меняет — правила обмена)'
        self.sync.log.add(f'{head}: {said}', mid=target.get('managerId'))

    def _closed(self, bx_deal: dict, stages: list[dict]) -> bool:
        """Сделка в Битриксе уже закрыта (успех или провал) — её не трогают."""
        stage = bx_deal.get('STAGE_ID')
        found = str(bx_deal.get('STAGE_SEMANTIC_ID') or '')
        sem = found or next((row['sem'] for row in stages if row['id'] == stage), '')
        return sem in self.CLOSED

    def _fields(self, cat: str, stages: list[dict], reason: str) -> dict[str, Any]:
        """Стадия проигрыша и «Причина проигрыша» — если правила обмена отправляют стадию в Битрикс."""
        if not self.sync.sends('stage'):
            return {}
        fields: dict[str, Any] = {'STAGE_ID': self._lose_stage(cat, stages)}
        if self.sync.sends('lostReason'):
            fields[self.sync.rules.field('lostReason')['bx']] = reason
        return fields

    def _lose_stage(self, cat: str, stages: list[dict]) -> str:
        """Стадия проигрыша воронки: сопоставленная с этапом «Проиграно» или первая с семантикой «провал»."""
        failures = [row['id'] for row in stages if row['sem'] == self.FAILURE]
        mapped = self.sync.rules.stages(cat).get(Funnels.LOST)
        if mapped in failures:
            return str(mapped)
        if not failures:
            raise ValueError(f'В воронке Битрикс24 {cat} нет стадии проигрыша — закройте сделку вручную')
        return str(failures[0])

    def _comment(self, target: dict, reason: str) -> str:
        """Запись в ленту сделки дубля: куда объединена (название и сделка итоговой в Битриксе)."""
        title = str(target.get('title') or target.get('client') or '')
        own = (self.sync.links.get('deal', target['id']) or {}).get('bx')
        named = f' «{title}»' if title else ''
        where = f' (в Битрикс24 — сделка {own})' if own else ''
        return f'{reason}{named}{where}: КП, дела и документы — в ней. Закрыто программой «Конструктор КП».'
