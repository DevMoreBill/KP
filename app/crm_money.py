"""Деньги отдела по сделкам: платёжный календарь (оплаты клиентов и платежи поставщикам по плану исполнения) и
просроченные оплаты клиентов («дебиторка») с делом «напомнить об оплате»."""

from collections.abc import Callable
from datetime import date

from crm import DealBook, TaskBook
from crm_exec import ExecPlan, Sums

INCOME = 'in'
SPEND = 'out'


class PayCalendar:
    """Платежи всех сделок отдела (или своих) по датам плана исполнения; суммы поставщикам — только тем, кому открыта экономика."""

    LOST = 'lost'

    def __init__(self, store) -> None:
        self.store = store

    def rows(self, managers: list | None, money_ok: Callable[[dict], bool]) -> list[dict]:
        """Платежи по дате: {deal, title, client, manager, dir in/out, label, plan, fact, amount, state, approx}."""
        book = DealBook(self.store)
        deals = [deal for deal in book.deals(managers) if deal.get('stage') != self.LOST]
        kps = book.kps([deal['id'] for deal in deals])
        out: list[dict] = []
        for deal in deals:
            deal['kps'] = kps.get(deal['id'], [])
            out += self._deal_rows(deal, Sums.ALL if ExecPlan.main(deal) and money_ok(deal) else Sums.SALES)
        return sorted(out, key=lambda row: (row['plan'], row['dir'], row['title']))

    def _deal_rows(self, deal: dict, sums: Sums) -> list[dict]:
        plan = ExecPlan(deal)
        _start, how = plan.base()
        rows = []
        for step in plan.steps(sums):
            kind = step['kind']
            if kind not in ('cust', *ExecPlan.MONEY) or not step.get('plan'):
                continue
            if kind != 'cust' and 'amount' not in step:
                continue
            rows.append(
                {
                    'deal': deal['id'],
                    'key': step['key'],
                    'title': deal.get('title') or '',
                    'client': deal.get('client') or '',
                    'manager': deal.get('manager') or '',
                    'dir': INCOME if kind == 'cust' else SPEND,
                    'label': step['label'],
                    'plan': step['plan'],
                    'fact': step.get('fact') or '',
                    'amount': step.get('amount'),
                    'state': step['state'],
                    'approx': how != 'fact',
                }
            )
        return rows

    @staticmethod
    def overdue(rows: list[dict]) -> list[dict]:
        """Просроченные оплаты клиентов (дебиторка)."""
        return [row for row in rows if row['dir'] == INCOME and row['state'] == 'overdue']


class PayReminder:
    """Дело «Напомнить об оплате» по просроченной оплате клиента — звонок сегодня ответственному сделки."""

    TITLE = 'Напомнить об оплате: {}'

    def __init__(self, store) -> None:
        self.store = store

    def add(self, deal: dict, label: str, author: str) -> dict:
        tasks = TaskBook(self.store)
        title = self.TITLE.format(label)[:200]
        same = next(
            (
                task
                for task in tasks.list(deal=deal['id'])
                if task.get('state') == 'open' and task.get('title') == title
            ),
            None,
        )
        if same:
            return same
        return tasks.add(
            {'kind': 'call', 'due': date.today().isoformat(), 'title': title},
            deal.get('managerId') or '',
            author,
            deal['id'],
        )
