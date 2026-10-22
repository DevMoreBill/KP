"""«Отчёт за месяц» в Excel для руководителя («Кабинет → Отдел»): итоги отдела, по менеджерам, КП и сделки месяца."""

import json
import re
from datetime import date
from typing import Any

from catalog_admin import XlsxBook
from crm import DealBook, Stages
from kp_track import DealTrack


class MonthReport:
    """Книга за месяц ГГГГ-ММ: КП — по дате КП, сделки — созданные или закрытые в этом месяце."""

    MONTH = re.compile(r'^(\d{4})-(0[1-9]|1[0-2])$')
    KOPECKS = 100
    PERCENT = 100
    CLOSED = ('won', 'lost')
    NAMES = (
        'январь',
        'февраль',
        'март',
        'апрель',
        'май',
        'июнь',
        'июль',
        'август',
        'сентябрь',
        'октябрь',
        'ноябрь',
        'декабрь',
    )

    def __init__(self, store, month: str) -> None:
        if not self.MONTH.match(str(month or '')):
            raise ValueError('Укажите месяц в виде ГГГГ-ММ')
        self.store = store
        self.month = str(month)
        self.labels = {str(row.get('key') or ''): str(row.get('label') or '') for row in Stages.all(store)}
        self.status = dict(DealTrack.STATUSES)

    @classmethod
    def current(cls) -> str:
        return date.today().isoformat()[:7]

    def title(self) -> str:
        year, num = self.month.split('-')
        return f'Отчёт отдела продаж — {self.NAMES[int(num) - 1]} {year}'

    def file_name(self) -> str:
        return f'Отчёт за {self.month}.xlsx'

    def xlsx(self) -> bytes:
        kps = self._kps()
        deals = self._deals()
        book = XlsxBook()
        book.add('Итоги', ['Показатель', 'Значение'], self._totals(kps, deals))
        book.add(
            'По менеджерам',
            ['Менеджер', 'КП', 'Сумма КП, ₽', 'Новых сделок', 'Выиграно', 'Выиграно, ₽', 'Проиграно'],
            self._by_manager(kps, deals),
        )
        book.add(
            'КП',
            ['№', 'Дата', 'Клиент', 'Менеджер', 'Сумма, ₽', 'Ход'],
            [
                [
                    row['number'],
                    row['date'],
                    row['client'],
                    row['manager'],
                    row['rub'],
                    self.status.get(row['status'], ''),
                ]
                for row in kps
            ],
        )
        book.add(
            'Сделки',
            ['№', 'Сделка', 'Клиент', 'Менеджер', 'Стадия', 'Сумма, ₽', 'Создана', 'Закрыта', 'Причина проигрыша'],
            [
                [
                    row.get('number') or '',
                    row.get('title') or '',
                    row.get('client') or '',
                    row['managerName'],
                    self.labels.get(row['stage']) or row['stage'],
                    self._rub(row.get('sum')),
                    str(row.get('created') or '')[:10],
                    str(row.get('stageAt') or '')[:10] if row['stage'] in self.CLOSED else '',
                    row.get('lostReason') or '' if row['stage'] == 'lost' else '',
                ]
                for row in deals
            ],
        )
        return book.bytes()

    def _rub(self, kop: Any) -> float:
        try:
            return round(float(kop or 0) / self.KOPECKS, 2)
        except (TypeError, ValueError):
            return 0.0

    def _in_month(self, text: Any) -> bool:
        return str(text or '')[:7] == self.month

    def _kps(self) -> list[dict]:
        from admin import econ_rub

        out = []
        for number, meta_text, track_text in self.store.all(
            'SELECT number, meta, track FROM kp WHERE meta IS NOT NULL AND substr(updated, 1, 7) >= ?', (self.month,)
        ):
            meta = self._obj(meta_text)
            if not self._in_month(meta.get('date')):
                continue
            manager = meta.get('manager')
            out.append(
                {
                    'number': meta.get('number') or number or '',
                    'date': str(meta.get('date'))[:10],
                    'client': str(meta.get('client') or ''),
                    'manager': str(manager.get('name') if isinstance(manager, dict) else manager or ''),
                    'rub': self._rub(econ_rub(meta)[0]),
                    'status': self._obj(track_text).get('status') or 'new',
                }
            )
        return sorted(out, key=lambda row: (row['date'], str(row['number'])))

    def _deals(self) -> list[dict]:
        names = dict(self.store.all('SELECT id, name FROM managers'))
        rows = self.store.all(f'SELECT {DealBook.COLS} FROM deals WHERE substr(updated, 1, 7) >= ?', (self.month,))
        out = []
        for row in rows:
            deal = DealBook._out(row)
            closed = deal['stage'] in self.CLOSED and self._in_month(deal.get('stageAt'))
            if self._in_month(deal.get('created')) or closed:
                deal['managerName'] = names.get(deal['managerId']) or ''
                deal['closedHere'] = closed
                out.append(deal)
        return sorted(out, key=lambda deal: str(deal.get('created') or ''))

    def _totals(self, kps: list[dict], deals: list[dict]) -> list[list]:
        won = [deal for deal in deals if deal['closedHere'] and deal['stage'] == 'won']
        lost = [deal for deal in deals if deal['closedHere'] and deal['stage'] == 'lost']
        closed = len(won) + len(lost)
        return [
            ['Отчёт', self.title()],
            ['КП выпущено', len(kps)],
            ['КП на сумму, ₽', round(sum(row['rub'] for row in kps), 2)],
            ['Новых сделок', sum(1 for deal in deals if self._in_month(deal.get('created')))],
            ['Выиграно сделок', len(won)],
            ['Выиграно на сумму, ₽', round(sum(self._rub(deal.get('sum')) for deal in won), 2)],
            ['Проиграно сделок', len(lost)],
            ['Конверсия закрытых, %', round(len(won) / closed * self.PERCENT) if closed else '—'],
            ['Сформирован', date.today().isoformat()],
        ]

    def _by_manager(self, kps: list[dict], deals: list[dict]) -> list[list]:
        table: dict[str, list] = {}

        def line(name: str) -> list:
            return table.setdefault(name or '— не назначен —', [name or '— не назначен —', 0, 0.0, 0, 0, 0.0, 0])

        for row in kps:
            entry = line(row['manager'])
            entry[1] += 1
            entry[2] = round(entry[2] + row['rub'], 2)
        for deal in deals:
            entry = line(deal['managerName'])
            entry[3] += 1 if self._in_month(deal.get('created')) else 0
            if deal['closedHere'] and deal['stage'] == 'won':
                entry[4] += 1
                entry[5] = round(entry[5] + self._rub(deal.get('sum')), 2)
            entry[6] += 1 if deal['closedHere'] and deal['stage'] == 'lost' else 0
        return sorted(table.values(), key=lambda entry: -entry[2])

    @staticmethod
    def _obj(text: Any) -> dict:
        try:
            got = json.loads(text or '{}')
        except (TypeError, ValueError):
            return {}
        return got if isinstance(got, dict) else {}
