"""Исполнение сделки после договора: точки из расчёта сделки КП (оплаты, готовность, поставка, ПНР), план и факт, дела."""

from datetime import date, timedelta
from enum import Enum
from typing import Any

from crm import DealBook, Stages, TaskBook
from crm_funnels import Funnels
from kp_track import Val


class Sums(Enum):
    """Какие суммы показывать: все (экономика открыта) или только оплаты заказчика."""

    ALL = 'all'
    SALES = 'sales'


class ExecPlan:
    """Точки исполнения сделки: план — день от договора из «Экономики сделки» КП, факт — отметка менеджера.

    Начало отсчёта — дата подписания договора (отметка «Договор подписан»), до неё — дата договора в расчёте КП, иначе
    ожидаемая дата сделки (план «примерно»).
    """

    SIGN = 'sign'
    READY = 'ready'
    NOTIFY = 'notify'
    SHIP = 'delivery'
    PNR = 'pnr'
    NOTIFY_BEFORE = 2
    MONEY = ('sup', 'log', 'oth')
    ORDER = {'mile': 0, 'cust': 1, 'sup': 2, 'log': 3, 'oth': 4}
    LABELS = {
        SIGN: 'Договор / спецификация подписаны',
        NOTIFY: 'Уведомить клиента о готовности к отгрузке',
        READY: 'Готово к отгрузке',
        SHIP: 'Поставка заказчику',
        PNR: 'Пусконаладка (ПНР) завершена',
    }

    def __init__(self, deal: dict) -> None:
        self.deal = deal
        self.offer = self.main(deal)
        self.plan: dict = (self.offer or {}).get('plan') or {}
        self.state: dict = picked if isinstance(picked := deal.get('exec'), dict) else {}

    @staticmethod
    def main(deal: dict) -> dict | None:
        """КП, по расчёту которого идёт исполнение: последнее непроигранное с расчётом сроков."""
        kps = deal.get('kps') or []
        return next(
            (offer for offer in kps if isinstance(offer.get('plan'), dict) and offer.get('status') != 'lost'), None
        )

    def base(self) -> tuple[date | None, str]:
        """Начало отсчёта и откуда оно: «fact» — договор подписан, «plan» — дата в расчёте, «guess» — ожидаемая дата."""
        for value, how in (
            (self.state.get('signed'), 'fact'),
            (self.plan.get('start'), 'plan'),
            (self.deal.get('expected'), 'guess'),
        ):
            day = Val.day(value) if value else None
            if day:
                return day, how
        return None, ''

    def raw(self) -> list[dict]:
        """Точки по порядку: договор, оплаты и платежи графика, уведомление, готовность, поставка, ПНР."""
        out = [{'key': self.SIGN, 'day': 0, 'label': self.LABELS[self.SIGN], 'kind': 'mile'}]
        out += self._payments()
        out += self._miles()
        return sorted(out, key=lambda step: (step['day'], self.ORDER.get(step['kind'], 0)))

    def _payments(self) -> list[dict]:
        steps = self.plan.get('steps')
        if isinstance(steps, list) and steps:
            return [self._payment(row) for row in steps if isinstance(row, dict) and isinstance(row.get('d'), int)]
        pays = picked if isinstance(picked := self.plan.get('pays'), list) else []
        return [
            {'key': f'c{index}', 'day': row['d'], 'label': str(row.get('t') or 'Оплата заказчика'), 'kind': 'cust'}
            for index, row in enumerate(pays)
            if isinstance(row, dict) and isinstance(row.get('d'), int)
        ]

    @staticmethod
    def _payment(row: dict) -> dict:
        kind = row.get('p') if row.get('p') in ExecPlan.ORDER else 'oth'
        step: dict[str, Any] = {
            'key': 'p:' + str(row.get('k') or row.get('t') or '')[:60],
            'day': row['d'],
            'label': str(row.get('t') or '')[:120],
            'kind': kind,
        }
        if isinstance(row.get('a'), (int, float)):
            step['amount'] = round(row['a'])
        return step

    def _miles(self) -> list[dict]:
        out = []
        ready = self.plan.get('ready')
        if isinstance(ready, int):
            out.append(self._mile(self.NOTIFY, max(0, ready - self.NOTIFY_BEFORE)))
            out.append(self._mile(self.READY, ready))
        for key in (self.SHIP, self.PNR):
            day = self.plan.get(key)
            if isinstance(day, int):
                out.append(self._mile(key, day))
        return out

    def _mile(self, key: str, day: int) -> dict:
        return {'key': key, 'day': day, 'label': self.LABELS[key], 'kind': 'mile'}

    def steps(self, sums: 'Sums') -> list[dict]:
        """Точки с датой по плану и состоянием: done / overdue / next / wait; суммы закупки — только Sums.ALL."""
        start, _how = self.base()
        done = picked if isinstance(picked := self.state.get('done'), dict) else {}
        today = date.today().isoformat()
        out = []
        for step in self.raw():
            row = dict(step)
            row['plan'] = (start + timedelta(days=step['day'])).isoformat() if start else ''
            if row['kind'] in self.MONEY and sums is not Sums.ALL:
                row.pop('amount', None)
            fact = picked if isinstance(picked := done.get(step['key']), dict) else None
            row['state'] = self._state(row, fact, today)
            if fact:
                row['fact'] = fact.get('at') or ''
                row['by'] = fact.get('by') or ''
            out.append(row)
        upcoming = next((row for row in out if row['state'] != 'done'), None)
        if upcoming and upcoming['state'] == 'wait':
            upcoming['state'] = 'next'
        return out

    @staticmethod
    def _state(row: dict, fact, today: str) -> str:
        if fact:
            return 'done'
        return 'overdue' if row['plan'] and row['plan'] < today else 'wait'

    def view(self, sums: 'Sums') -> dict:
        """Исполнение для карточки: точки, ближайшая, сколько сделано, оплачено заказчиком (из суммы по графику)."""
        start, how = self.base()
        steps = self.steps(sums)
        cust = [step for step in steps if step['kind'] == 'cust']
        upcoming = next((step for step in steps if step['state'] in ('overdue', 'next')), None)
        return {
            'has': bool(self.plan),
            'kp': (self.offer or {}).get('number') or '',
            'kpId': (self.offer or {}).get('id') or '',
            'start': start.isoformat() if start else '',
            'how': how,
            'signed': self.state.get('signed') or '',
            'steps': steps,
            'next': upcoming,
            'done': sum(1 for step in steps if step['state'] == 'done'),
            'total': len(steps),
            'overdue': sum(1 for step in steps if step['state'] == 'overdue'),
            'paid': sum(step.get('amount') or 0 for step in cust if step['state'] == 'done'),
            'toPay': sum(step.get('amount') or 0 for step in cust),
            'money': sums is Sums.ALL,
        }

    @staticmethod
    def strip(kps: list) -> None:
        """Платежи графика (с суммами закупки) — только в исполнении сделки, в списке КП их нет."""
        for offer in kps:
            if isinstance(offer.get('plan'), dict):
                offer['plan'] = {key: value for key, value in offer['plan'].items() if key != 'steps'}

    def summary(self) -> dict | None:
        """Коротко для доски: только после договора — ближайшая точка, сделано из всех, просрочено."""
        if not self.state.get('signed'):
            return None
        view = self.view(Sums.SALES)
        upcoming = view['next']
        return {
            'done': view['done'],
            'total': view['total'],
            'overdue': view['overdue'],
            'next': {'label': upcoming['label'], 'plan': upcoming['plan'], 'state': upcoming['state']}
            if upcoming
            else None,
        }


class ExecBook:
    """Отметки исполнения в сделке (exec: signed, done {точка: {at, by}}) и ход этапа сделки по ним."""

    STAGE_BY_STEP = {ExecPlan.SIGN: 'contract', ExecPlan.READY: 'delivery', ExecPlan.SHIP: 'delivery'}

    def __init__(self, store) -> None:
        self.store = store
        self.book = DealBook(store)

    def deal(self, did: str) -> dict:
        deal = self.book.get(did)
        if not deal:
            raise LookupError('Сделка не найдена')
        deal['kps'] = self.book.kps([did])[did]
        return deal

    def mark(self, did: str, key: str, when: str, author: str) -> dict:
        """Отметить точку сделанной (when — дата) или снять отметку (when пусто). ValueError — с понятным текстом."""
        deal = self.deal(did)
        keys = {step['key'] for step in ExecPlan(deal).raw()}
        if key not in keys:
            raise ValueError('Нет такой точки исполнения — обновите карточку сделки')
        day = Val.day(when) if when else None
        if when and not day:
            raise ValueError('Дата — в формате ГГГГ-ММ-ДД')
        state = dict(deal.get('exec') or {})
        done = dict(state.get('done') or {})
        if day:
            done[key] = {'at': day.isoformat(), 'by': str(author or '')[:120]}
        else:
            done.pop(key, None)
        state['done'] = done
        if key == ExecPlan.SIGN:
            state['signed'] = day.isoformat() if day else ''
        self.book.put_exec(did, state, author, {'step': key, 'at': day.isoformat() if day else ''})
        if day:
            self._advance(did, key, author)
        deal = self.deal(did)
        ExecTasks(self.store).sync(deal)
        return deal

    def _advance(self, did: str, key: str, author: str) -> None:
        """Договор подписан — этап «Договор и оплата», готово / поставка — «Поставка» (своя воронка, только вперёд)."""
        target = self.STAGE_BY_STEP.get(key)
        deal = self.book.get(did)
        if not target or not deal or (deal.get('funnel') or Funnels.MAIN) != Funnels.MAIN:
            return
        keys = Stages.keys(self.store)
        if target not in keys or deal['stage'] in Funnels.CLOSED or deal['stage'] not in keys:
            return
        if keys.index(target) > keys.index(deal['stage']):
            self.book.update(did, {'stage': target}, author)


class ExecTasks:
    """Дела на ближайшие точки исполнения: программа ставит их ответственному сама (одно на точку), сделанная точка закрывает дело."""

    HORIZON = 7
    WHO = 'Исполнение сделки'
    TITLES = {
        'cust': 'Проверить оплату заказчика: {}',
        'sup': 'Оплатить поставщику: {}',
        'log': 'Оплатить перевозку: {}',
        'oth': '{}',
        ExecPlan.NOTIFY: 'Уведомить клиента о готовности к отгрузке',
        ExecPlan.READY: 'Проверить готовность к отгрузке',
        ExecPlan.SHIP: 'Проконтролировать поставку заказчику',
        ExecPlan.PNR: 'Проверить завершение ПНР',
    }
    KINDS = {ExecPlan.NOTIFY: 'call'}

    def __init__(self, store) -> None:
        self.store = store
        self.tasks = TaskBook(store)

    def sync(self, deal: dict) -> int:
        """Поставить дела на точки в ближайшие HORIZON дней (и просроченные), закрыть дела сделанных точек. → новых дел."""
        state = picked if isinstance(picked := deal.get('exec'), dict) else {}
        if not state.get('signed') or deal.get('stage') in Funnels.CLOSED:
            return 0
        have = {task.get('step'): task for task in self.tasks.list(deal=deal['id']) if task.get('step')}
        limit = (date.today() + timedelta(days=self.HORIZON)).isoformat()
        added = 0
        for step in ExecPlan(deal).steps(Sums.SALES):
            task = have.get(step['key'])
            if step['state'] == 'done':
                self._close(task)
            elif not task and step['plan'] and step['plan'] <= limit:
                self._add(deal, step)
                added += 1
        return added

    def _add(self, deal: dict, step: dict) -> None:
        key = step['key'] if step['kind'] == 'mile' else step['kind']
        title = self.TITLES.get(key, '{}').format(step['label'])
        due = max(step['plan'], date.today().isoformat())
        body = {'kind': self.KINDS.get(step['key'], 'task'), 'title': title, 'due': due}
        task = self.tasks.add(body, deal.get('managerId') or '', self.WHO, deal['id'], step=step['key'])
        self._to_bitrix(task['id'])

    def _close(self, task: dict | None) -> None:
        if task and task.get('state') == 'open':
            self.tasks.update(task['id'], {'state': 'done'})
            self._to_bitrix(task['id'])

    def _to_bitrix(self, tid) -> None:
        from bitrix import BitrixQueue

        BitrixQueue.touch(self.store, 'task', tid)

    def sweep(self) -> int:
        """Все сделки после договора (по расписанию): дела на подошедшие точки. → новых дел."""
        book = DealBook(self.store)
        rows = self.store.all(
            "SELECT id FROM deals WHERE stage NOT IN ('won', 'lost') AND doc LIKE ?", ('%"signed": "2%',)
        )
        added = 0
        for (did,) in rows:
            deal = book.get(did)
            if deal:
                deal['kps'] = book.kps([did])[did]
                added += self.sync(deal)
        return added
