"""Расхождения с Битрикс24: сделки, у которых стадия, сумма или ответственный в программе и в Битриксе разные;
«Выровнять» — отправить сделку в Битрикс по значениям программы (очередь обмена)."""

from typing import Any

from bitrix import BitrixQueue, BitrixSync
from crm import DealBook


class BitrixDiff:
    """Сравнение связанных сделок с Битриксом (только чтение) и выравнивание по программе."""

    BATCH = 50
    LIMIT = 500
    KOPECKS = 100
    LABELS = {'stage': 'стадия', 'sum': 'сумма', 'currency': 'валюта', 'manager': 'ответственный'}
    RUB = 'RUB'  # сумма сделки программы — в рублях

    def __init__(self, store, sync: BitrixSync | None = None) -> None:
        self.store = store
        self.sync = sync or BitrixSync(store)

    def report(self) -> dict:
        """{rows: [{deal, title, manager, diffs: [{field, label, program, bitrix}]}], checked}."""
        links = dict(self.store.all("SELECT local_id, bx_id FROM bx_link WHERE kind='deal' LIMIT ?", (self.LIMIT,)))
        if not links:
            return {'rows': [], 'checked': 0}
        theirs = self._bitrix(list(links.values()))
        book = DealBook(self.store)
        rows = []
        for did, bx_id in links.items():
            deal, bx_deal = book.get(did), theirs.get(str(bx_id))
            if not deal or not bx_deal:
                continue
            diffs = self._compare(deal, bx_deal)
            if diffs:
                rows.append(
                    {
                        'deal': did,
                        'title': deal.get('title') or '',
                        'manager': deal.get('manager') or '',
                        'diffs': diffs,
                    }
                )
        return {'rows': rows, 'checked': len(theirs)}

    def _bitrix(self, ids: list) -> dict:
        out: dict[str, dict] = {}
        for start in range(0, len(ids), self.BATCH):
            part = [str(bx_id) for bx_id in ids[start : start + self.BATCH]]
            for row in self.sync.api.list(
                'crm.deal.list',
                {
                    'filter': {'ID': part},
                    'select': ['ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID', 'CATEGORY_ID'],
                },
                limit=self.BATCH,
            ):
                out[str(row.get('ID'))] = row
        return out

    def _compare(self, deal: dict, bx_deal: dict) -> list[dict[str, Any]]:
        mine: dict[str, Any] = {
            'stage': self.sync.bx_stage(deal, str(bx_deal.get('CATEGORY_ID') or '0')),
            'sum': round((deal.get('sum') or 0) / self.KOPECKS),
            'manager': str(self.sync.bx_user(deal.get('managerId')) or ''),
        }
        try:
            bx_sum = round(float(bx_deal.get('OPPORTUNITY') or 0))
        except (TypeError, ValueError):
            bx_sum = 0
        currency = str(bx_deal.get('CURRENCY_ID') or self.RUB)
        mine['currency'] = self.RUB
        if currency != self.RUB:
            mine['sum'] = None  # рубли с другой валютой не сравниваются — расхождение показывает строка «валюта»
        theirs = {
            'stage': str(bx_deal.get('STAGE_ID') or ''),
            'sum': bx_sum,
            'currency': currency,
            'manager': str(bx_deal.get('ASSIGNED_BY_ID') or ''),
        }
        return [
            {'field': key, 'label': label, 'program': mine[key], 'bitrix': theirs[key]}
            for key, label in self.LABELS.items()
            if mine[key] not in ('', None) and str(mine[key]) != str(theirs[key])
        ]

    def align(self, did: str) -> None:
        """Отправить сделку в Битрикс по значениям программы (при следующем обмене)."""
        if not DealBook(self.store).get(did):
            raise LookupError('Сделка не найдена')
        BitrixQueue.touch(self.store, 'deal', did)
