"""Проверка регламента по отделу: сколько открытых сделок не заполнено для своей текущей стадии и у кого больше."""

from collections import Counter

from crm import DealBook
from crm_funnels import Funnels
from deal_rules import DealRegs


class RegAudit:
    """Сводка для «Отдела»: по менеджерам (сделок с пробелами из открытых) и по пунктам регламента."""

    SAMPLES = 5
    TOP_ITEMS = 8

    def __init__(self, store) -> None:
        self.store = store
        self.regs = DealRegs(store)

    def report(self) -> dict:
        """{on, deals, gaps, managers: [{id, name, open, gaps, samples}], items: [{label, n}]}."""
        if not self.regs.enabled():
            return {'on': False, 'deals': 0, 'gaps': 0, 'managers': [], 'items': []}
        people: dict[str, dict] = {}
        items: Counter = Counter()
        total = 0
        for deal in DealBook(self.store).deals(None):
            if deal.get('stage') in Funnels.CLOSED:
                continue
            total += 1
            row = people.setdefault(
                deal.get('managerId') or '',
                {
                    'id': deal.get('managerId') or '',
                    'name': deal.get('manager') or '— не назначен —',
                    'open': 0,
                    'gaps': 0,
                    'samples': [],
                },
            )
            row['open'] += 1
            names = self._gaps(deal)
            if not names:
                continue
            row['gaps'] += 1
            items.update(names)
            if len(row['samples']) < self.SAMPLES:
                row['samples'].append({'deal': deal['id'], 'title': deal.get('title') or '', 'missing': names})
        managers = sorted((row for row in people.values() if row['open']), key=lambda row: (-row['gaps'], row['name']))
        return {
            'on': True,
            'deals': total,
            'gaps': sum(row['gaps'] for row in managers),
            'managers': managers,
            'items': [{'label': label, 'n': count} for label, count in items.most_common(self.TOP_ITEMS)],
        }

    def _gaps(self, deal: dict) -> list[str]:
        stage = deal.get('fstage') or deal.get('stage') or ''
        try:
            target = self.regs.target(deal, stage)
        except ValueError:
            return []
        gaps = self.regs.missing(deal, target)
        labels = dict(DealRegs.CLIENT)
        return [item.label for item in gaps['fields']] + [labels[key] for key in gaps['client']]
