"""Объединение сделок и дубли сделок: КП, дела, документы, звонки и письма Битрикс24, комментарии выбранных сделок
переходят в одну, выбранные — в корзину; «Дубли сделок» в «Отделе» — незакрытые сделки одного клиента у одного менеджера."""

import re
from dataclasses import dataclass, field
from typing import Any

from bitrix import BitrixLinks
from bitrix_comms import DealComms
from clock import Clock
from crm import DealBook, TaskBook
from crm_funnels import Funnels
from deal_files import DealFiles
from inn import Inn


class MergedDeals:
    """Куда объединена сделка (kv «dealMerged»: {сделка: итоговая}): звонки и письма Битрикс24 её сделки и ссылки на неё
    ведут в итоговую; сделку вернули из корзины — снова она сама."""

    KEY = 'dealMerged'
    HOPS = 10  # цепочка объединений: № 1 → № 2 → № 3

    def __init__(self, store) -> None:
        self.store = store

    def put(self, sources: list[str], target: str) -> None:
        """Сделки sources объединены в target."""
        with self.store.lock:
            known = self._all()
            known.update(dict.fromkeys(sources, target))
            self.store.kv_set(self.KEY, known)

    def target_of(self, did: str) -> str:
        """Сделка, в которую объединена did (по цепочке); не объединялась — она сама."""
        known = self._all()
        if did not in known:
            return did
        book, hops = DealBook(self.store), 0
        while did in known and hops < self.HOPS and not book.get(did):
            did, hops = known[did], hops + 1
        return did

    def sources(self) -> list[str]:
        """Все сделки, которые объединялись в другие."""
        return list(self._all())

    def _all(self) -> dict[str, str]:
        found = self.store.kv_get(self.KEY) or {}
        return {str(key): str(value) for key, value in found.items()} if isinstance(found, dict) else {}


@dataclass
class MergeReport:
    """Что перешло в итоговую сделку."""

    target: str
    number: Any
    merged: list[Any] = field(default_factory=list)  # номера объединённых сделок
    kps: int = 0
    tasks: int = 0
    files: int = 0
    talks: int = 0
    comments: int = 0
    bitrix_from: Any = ''  # номер сделки, чью сделку в Битрикс24 продолжает итоговая (у итоговой своей не было)
    bitrix_left: list[str] = field(default_factory=list)  # объединённые, чьи сделки в Битрикс24 остались своими

    def add(self, number: Any, moved: dict[str, int]) -> None:
        """Сделка number объединена: сколько чего перешло."""
        self.merged.append(number)
        for key, count in moved.items():
            setattr(self, key, getattr(self, key) + count)

    def out(self) -> dict[str, Any]:
        return {
            'deal': self.target,
            'number': self.number,
            'merged': self.merged,
            'kps': self.kps,
            'tasks': self.tasks,
            'files': self.files,
            'talks': self.talks,
            'comments': self.comments,
            'bitrixFrom': self.bitrix_from,
        }


class DealMerge:
    """«Объединить сделки» в карточке сделки: в итоговую — всё из выбранных, выбранные — в корзину (пустыми; вернуть
    их содержимое нельзя — объединяют дубли). Поля итоговой остаются, пустые — дополняются из выбранных."""

    FEATURE = 'dealMerge'
    ID_RE = re.compile(r'^d\d{1,9}$')
    MAX = 10  # сделок за одно объединение
    BLANKS = ('client', 'clientInn', 'clientId', 'title', 'expected', 'myCompany', 'source')
    FROM_HEAD = 'Из сделки № {}: {}'
    NOTE_HEAD = 'Заметка сделки № {}: {}'

    def __init__(self, store) -> None:
        self.store = store
        self.book = DealBook(store)

    def merge(self, target_id: str, source_ids: list[str], author: str) -> MergeReport:
        """Сделки source_ids — в target_id. ValueError — понятным текстом, LookupError — сделки нет."""
        target, sources = self._deals(target_id, source_ids)
        report = MergeReport(target=target['id'], number=target.get('number'))
        moved: list[tuple[str, str]] = []
        with self.store.lock:
            conn = self.store.conn()
            try:
                for source in sources:
                    self._absorb(conn, target, source, author, report, moved)
                self.book.recount(conn, target, author)
                conn.commit()
            except Exception:
                conn.rollback()
                DealFiles.undo(moved)
                raise
        for source in sources:
            self.book.remove(source['id'], author, f'объединена со сделкой № {report.number}')
        MergedDeals(self.store).put([source['id'] for source in sources], target['id'])
        links = BitrixLinks(self.store)
        report.bitrix_left = [source['id'] for source in sources if (links.get('deal', source['id']) or {}).get('bx')]
        return report

    def _deals(self, target_id: str, source_ids: list[str]) -> tuple[dict, list[dict]]:
        ids = list(dict.fromkeys(str(did) for did in source_ids if did))
        if not ids:
            raise ValueError('Отметьте сделки, которые объединить с этой')
        if len(ids) > self.MAX:
            raise ValueError(f'За один раз — не больше {self.MAX} сделок')
        if target_id in ids:
            raise ValueError('Сделку нельзя объединить саму с собой')
        target = self._need(target_id)
        if target['stage'] == Funnels.LOST:
            raise ValueError(f'Сделка № {target.get("number")} проиграна — объединяйте в незакрытую или выигранную')
        sources = [self._need(did) for did in ids]
        won = next((deal for deal in sources if deal['stage'] == Funnels.WON), None)
        if won and target['stage'] != Funnels.WON:
            raise ValueError(
                f'Сделка № {won.get("number")} выиграна — объединяйте в неё: откройте её и отметьте остальные'
            )
        return target, sources

    def _need(self, did: str) -> dict:
        deal = self.book.get(did)
        if not deal:
            raise LookupError('Сделка не найдена — обновите кабинет')
        return deal

    def _absorb(self, conn, target: dict, source: dict, author: str, report: MergeReport, moved: list) -> None:
        """Всё из source — в target (в открытой транзакции conn); source — с отметкой, куда объединена."""
        sid, tid = source['id'], target['id']
        kps = len(self.book.move_kps(conn, sid, tid))
        tasks = TaskBook.move_all(conn, sid, tid, target.get('managerId') or '')
        files = DealFiles.of(self.store).move(conn, sid, tid, moved)
        talks = DealComms.move(conn, sid, tid)
        renumbered = self._comments(target, source)
        self._fill(target, source)
        if BitrixLinks.adopt(conn, sid, tid, renumbered):
            report.bitrix_from = source.get('number')
        number = source.get('number')
        self.book.event(target, author, what='merge', kps=kps, tasks=tasks, files=files, **{'from': number})
        self.book.event(source, author, what='mergedInto', to=report.number)
        source['mergedInto'] = tid
        self.book.persist(conn, source, author)
        moved_counts = {'kps': kps, 'tasks': tasks, 'files': files, 'talks': talks, 'comments': len(renumbered)}
        report.add(number, moved_counts)

    def _comments(self, target: dict, source: dict) -> dict[int, int]:
        """Комментарии source — в ленту target с пометкой «Из сделки № …», по времени; заметка source — в заметку target,
        если там пусто, иначе комментарием. → {прежний номер комментария: новый}."""
        own = [row for row in target.get('comments') or [] if isinstance(row, dict)]
        theirs = [row for row in source.get('comments') or [] if isinstance(row, dict)]
        number, start = source.get('number'), max([int(row.get('id') or 0) for row in own] + [0])
        renumbered: dict[int, int] = {}
        added = []
        for offset, row in enumerate(theirs, 1):
            renumbered[int(row.get('id') or 0)] = start + offset
            text = self.FROM_HEAD.format(number, row.get('text') or '')
            added.append(self._comment(start + offset, row.get('at'), row.get('by'), text))
        note = str(source.get('note') or '').strip()
        if note and not str(target.get('note') or '').strip():
            target['note'] = note
        elif note and note not in str(target.get('note') or ''):
            stamp = source.get('updated') or Clock.now()
            added.append(
                self._comment(
                    start + len(theirs) + 1, stamp, source.get('manager'), self.NOTE_HEAD.format(number, note)
                )
            )
        merged = sorted([*own, *added], key=lambda row: str(row.get('at') or ''))
        target['comments'] = merged[-DealBook.COMMENTS_KEPT :]
        return renumbered

    @staticmethod
    def _comment(number: int, when: Any, who: Any, text: str) -> dict:
        return {'id': number, 'at': str(when or ''), 'by': str(who or ''), 'text': text[: DealBook.COMMENT_MAX]}

    def _fill(self, target: dict, source: dict) -> None:
        """Пустые поля итоговой — из source; поля Битрикс24 — из source, если воронка та же; отметки исполнения — вместе."""
        for key in self.BLANKS:
            if not target.get(key) and source.get(key):
                target[key] = source[key]
        same_funnel = (target.get('funnel') or Funnels.MAIN) == (source.get('funnel') or Funnels.MAIN)
        if same_funnel and isinstance(source.get('uf'), dict):
            target['uf'] = {**source['uf'], **(target.get('uf') or {})}
        mine, theirs = target.get('exec'), source.get('exec')
        if isinstance(theirs, dict) and theirs:
            mine = mine if isinstance(mine, dict) else {}
            done = {**(theirs.get('done') or {}), **(mine.get('done') or {})}
            target['exec'] = {
                **theirs,
                **mine,
                'done': done,
                'signed': mine.get('signed') or theirs.get('signed') or '',
            }


class DealDupes:
    """«Дубли сделок» в «Отделе»: незакрытые сделки одного клиента (ИНН, без ИНН — название) у одного менеджера, в одной
    воронке и по одной задаче (КП для тендера — одной закупки). Итоговой предлагается дальше всех продвинувшаяся
    (затем — с бо́льшим числом КП, затем — самая ранняя)."""

    FEATURE = 'dealDupes'
    GROUPS_MAX = 200

    def __init__(self, store) -> None:
        self.store = store
        self.book = DealBook(store)

    def groups(self, managers: list[str] | None) -> list[dict[str, Any]]:
        """Группы дублей менеджеров (None — всего отдела), по менеджеру и клиенту."""
        deals = [deal for deal in self.book.deals(managers, closed_days=0) if deal['stage'] not in Funnels.CLOSED]
        marks = self.book.kp_marks([deal['id'] for deal in deals])
        bunches: dict[tuple, list[dict]] = {}
        for deal in deals:
            key = self._key(deal, marks.get(deal['id']))
            if key:
                bunches.setdefault(key, []).append(deal)
        funnels = Funnels(self.store)
        found = [self._group(rows, marks, funnels) for rows in bunches.values() if len(rows) > 1]
        found.sort(key=lambda group: (group['manager'].lower(), group['client'].lower()))
        return found[: self.GROUPS_MAX]

    @staticmethod
    def _key(deal: dict, mark: dict | None) -> tuple | None:
        inn = Inn.key(deal.get('clientInn'))
        client = f'inn{inn}' if inn else str(deal.get('client') or '').strip().lower()
        if not client:
            return None
        tenders = ','.join(sorted(mark['tenders'])) if mark else ''
        return (deal.get('managerId') or '', client, deal.get('funnel') or Funnels.MAIN, tenders)

    def _group(self, rows: list[dict], marks: dict, funnels: Funnels) -> dict[str, Any]:
        def rank(deal: dict) -> tuple:
            keys = funnels.open_keys(deal.get('funnel') or Funnels.MAIN)
            stage = deal.get('fstage') or deal['stage']
            place = keys.index(stage) if stage in keys else -1
            return (-place, -int((marks.get(deal['id']) or {}).get('count') or 0), int(deal.get('number') or 0))

        rows = sorted(rows, key=rank)
        head = rows[0]
        return {
            'client': str(head.get('client') or ''),
            'inn': Inn.key(head.get('clientInn')),
            'manager': str(head.get('manager') or ''),
            'managerId': head.get('managerId') or '',
            'target': head['id'],
            'deals': [self._row(deal, marks.get(deal['id']) or {}) for deal in rows],
        }

    @staticmethod
    def _row(deal: dict, mark: dict) -> dict[str, Any]:
        return {
            'id': deal['id'],
            'number': deal.get('number'),
            'title': str(deal.get('title') or ''),
            'stage': deal.get('fstage') or deal['stage'],
            'funnel': deal.get('funnel') or Funnels.MAIN,
            'sum': deal.get('sum') or 0,
            'kps': int(mark.get('count') or 0),
            'last': str(mark.get('last') or '')[:10],
            'created': str(deal.get('created') or '')[:10],
        }
