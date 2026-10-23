"""«Где тратится время» в «Отделе» кабинета: сколько дней сделки стоят на каждой стадии, сколько проходит от заявки
до первого КП, какая доля дел закрыта позже срока. По отделу целиком, без имён менеджеров."""

import json
import re
from collections import Counter
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any

from crm import DealBook, Stages
from crm_funnels import Funnels


class DealTime:
    """Сводка за последние DAYS дней (сделки, созданные или изменённые за это время)."""

    DAYS = 180
    DAY_S = 86400
    ROUND = 1
    REASONS = 5

    def __init__(self, store) -> None:
        self.store = store

    def report(self) -> dict[str, Any]:
        since = (date.today() - timedelta(days=self.DAYS)).isoformat()
        deals = [deal for deal in DealBook(self.store).deals() if str(deal.get('created') or deal['updated']) >= since]
        return {
            'days': self.DAYS,
            'deals': len(deals),
            'stages': self._stages(deals),
            'firstKp': self._first_kp(deals),
            'lateTasks': self._late_tasks(since),
            'losses': self._losses(deals),
        }

    @staticmethod
    def _when(text: Any) -> datetime | None:
        try:
            return datetime.fromisoformat(str(text)[:19])
        except ValueError:
            return None

    def _segments(self, deal: dict) -> list[tuple[str, float]]:
        """(стадия, дней на ней) по истории сделки; последняя незакрытая стадия — до сегодня."""
        moves = sorted(
            (row for row in deal.get('history') or [] if isinstance(row, dict) and row.get('what') == 'stage'),
            key=lambda row: str(row.get('at') or ''),
        )
        start = self._when(deal.get('created'))
        stage = str(moves[0].get('from') or '') if moves else deal['stage']
        out = []
        for move in moves:
            moved = self._when(move.get('at'))
            if start and moved:
                out.append((stage, (moved - start).total_seconds() / self.DAY_S))
            start, stage = moved, str(move.get('to') or '')
        if start and stage not in ('won', 'lost'):
            out.append((stage, (datetime.now() - start).total_seconds() / self.DAY_S))
        return out

    def _stages(self, deals: list[dict]) -> list[dict]:
        spent: dict[str, list[float]] = {}
        for deal in deals:
            for stage, days in self._segments(deal):
                spent.setdefault(stage, []).append(max(days, 0.0))
        out = []
        rows: list[dict] = Stages.all(self.store)
        for row in rows:
            key = str(row.get('key') or '')
            if row.get('closed') or not spent.get(key):
                continue
            values = spent[key]
            out.append(
                {
                    'key': key,
                    'label': row.get('label') or key,
                    'median': round(median(values), self.ROUND),
                    'deals': len(values),
                }
            )
        return out

    def _losses(self, deals: list[dict]) -> dict:
        """«Где теряем»: на какой стадии сделку проиграли и частые причины."""
        lost = [deal for deal in deals if deal.get('stage') == 'lost']
        by_stage: dict[str, int] = {}
        reasons: dict[str, int] = {}
        for deal in lost:
            stage = self._lost_from(deal)
            by_stage[stage] = by_stage.get(stage, 0) + 1
            reason = str(deal.get('lostReason') or '').strip() or 'причина не указана'
            reasons[reason] = reasons.get(reason, 0) + 1
        labels = {str(row.get('key') or ''): row.get('label') or row.get('key') for row in Stages.all(self.store)}
        stages = [
            {'key': key, 'label': labels.get(key) or 'стадия не известна', 'lost': count}
            for key, count in sorted(by_stage.items(), key=lambda item: -item[1])
        ]
        top = sorted(reasons.items(), key=lambda item: -item[1])[: self.REASONS]
        return {
            'lost': len(lost),
            'won': sum(1 for deal in deals if deal.get('stage') == 'won'),
            'stages': stages,
            'reasons': [{'text': text, 'lost': count} for text, count in top],
        }

    @staticmethod
    def _lost_from(deal: dict) -> str:
        moves = [
            row
            for row in deal.get('history') or []
            if isinstance(row, dict) and row.get('what') == 'stage' and row.get('to') == 'lost'
        ]
        return str(moves[-1].get('from') or '') if moves else ''

    def _first_kp(self, deals: list[dict]) -> dict:
        kps = DealBook(self.store).kps([deal['id'] for deal in deals])
        waits = []
        for deal in deals:
            start = self._when(deal.get('created'))
            dates = [self._when(row.get('savedAt') or row.get('date')) for row in kps.get(deal['id']) or []]
            first = min((when for when in dates if when), default=None)
            if start and first and first >= start:
                waits.append((first - start).total_seconds() / self.DAY_S)
        return {'median': round(median(waits), self.ROUND) if waits else None, 'deals': len(waits)}

    def _late_tasks(self, since: str) -> dict:
        rows = self.store.all(
            "SELECT due, substr(done_at, 1, 10) FROM crm_tasks WHERE state = 'done' AND done_at >= ?", (since,)
        )
        late = sum(1 for due, done in rows if done and due and done > due)
        return {'done': len(rows), 'late': late}


class StageOdds:
    """Вероятность выиграть сделку с каждой стадии — по сделкам, закрытым за последние DAYS дней: из прошедших через
    стадию сколько выиграно. Меньше MIN_CLOSED закрытых — процент из названия стадии («40% - ТКП»); нет ни того,
    ни другого — стадия в прогноз не входит (не выдумываем)."""

    DAYS = 365
    MIN_CLOSED = 5
    PERCENT = re.compile(r'^\s*(\d{1,3})\s*%')
    HUNDRED = 100

    def __init__(self, store) -> None:
        self.store = store

    def odds(self) -> dict[str, float]:
        """{стадия: доля 0…1}."""
        passed, won = self._history()
        out: dict[str, float] = {}
        for key, label in self._labels().items():
            closed = passed.get(key, 0)
            if closed >= self.MIN_CLOSED:
                out[key] = round(won.get(key, 0) / closed, 2)
                continue
            found = self.PERCENT.match(label)
            if found and int(found.group(1)) <= self.HUNDRED:
                out[key] = int(found.group(1)) / self.HUNDRED
        return out

    def _labels(self) -> dict[str, str]:
        labels = {str(row.get('key') or ''): str(row.get('label') or '') for row in Stages.all(self.store)}
        for funnel in Funnels(self.store).all():
            for row in funnel.get('stages') or []:
                labels[str(row.get('key') or '')] = str(row.get('label') or '')
        return labels

    def _history(self) -> tuple[Counter, Counter]:
        since = (date.today() - timedelta(days=self.DAYS)).isoformat()
        passed: Counter = Counter()
        won: Counter = Counter()
        for doc, stage in self.store.all("SELECT doc, stage FROM deals WHERE stage IN ('won', 'lost')", ()):
            deal = self._obj(doc)
            if str(deal.get('stageAt') or '')[:10] < since:
                continue
            seen = {str(deal.get('fstage') or '')}
            for row in deal.get('history') or []:
                if isinstance(row, dict) and row.get('what') == 'stage':
                    seen |= {str(row.get('from') or ''), str(row.get('to') or '')}
            seen.discard('')
            passed.update(seen)
            if stage == 'won':
                won.update(seen)
        return passed, won

    @staticmethod
    def _obj(raw: Any) -> dict:
        try:
            found = json.loads(raw or '{}')
        except (TypeError, ValueError):
            return {}
        return found if isinstance(found, dict) else {}
