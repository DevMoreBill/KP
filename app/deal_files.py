"""Документы сделки: договор, спецификация, счёт, акт, УПД, сканы — та же проверка файлов и удаление автором, что у КП."""

import os
import re
from datetime import date, timedelta

from kp_files import KpFiles


class DealFiles(KpFiles):
    """Документы сделки в data/deal_files/<сделка>; вид документа (kind) — из KINDS."""

    FOLDER = 'deal_files'
    TABLE = 'deal_files'
    OWNER = 'deal_id'
    OWNER_ID = re.compile(r'^d\d{1,9}$')
    OWNER_BAD = 'Недопустимый номер сделки'
    WHOSE = 'сделки'
    PER_ONE = 'одну сделку'
    LIMIT_KEYS = {'fileMB': 'kp.fileMB', 'filesMax': 'deal.filesMax', 'filesMB': 'deal.filesMB'}
    EXTRA = ('kind',)
    KINDS = {
        'contract': 'Договор',
        'spec': 'Спецификация',
        'invoice': 'Счёт',
        'act': 'Акт',
        'upd': 'УПД',
        'other': 'Прочее',
    }
    CLOSING = ('act', 'upd')

    @classmethod
    def of(cls, store) -> 'DealFiles':
        """Документы сделок этой базы: папка deal_files — рядом с файлом базы (data)."""
        return cls(store, os.path.dirname(os.path.abspath(store.path)))

    def add_kind(self, did: str, kind: str, name, data, author: str = '', by_id: str = '') -> dict:
        """Прикрепить документ вида kind. ValueError — понятным текстом."""
        if kind not in self.KINDS:
            raise ValueError('Выберите, что это за документ: договор, спецификация, счёт, акт, УПД или прочее')
        return self.add(did, name, data, '', author, by_id, {'kind': kind})

    def kinds(self, ids: list[str]) -> dict[str, list[str]]:
        """Виды документов у сделок: {сделка: [вид, …]} (без документов — нет в ответе)."""
        want = sorted({str(x) for x in ids if self.OWNER_ID.match(str(x or ''))})
        out: dict[str, list[str]] = {}
        for start in range(0, len(want), self.QUERY_IDS_MAX):
            part = want[start : start + self.QUERY_IDS_MAX]
            rows = self.store.all(
                'SELECT DISTINCT deal_id, kind FROM deal_files WHERE deal_id IN ({})'.format(','.join('?' * len(part))),
                part,
            )
            for did, kind in rows:
                out.setdefault(did, []).append(kind)
        return out

    def has_closing(self, did: str) -> bool:
        """Есть акт или УПД."""
        return any(kind in self.CLOSING for kind in self.kinds([did]).get(did, []))


class DealClosing:
    """Закрывающие документы: поставка отмечена или сделка выиграна (за последние RECENT_DAYS дней), а акта и УПД нет —
    напомнить, не запрещая закрыть сделку; давние сделки не напоминают."""

    RECENT_DAYS = 30

    def __init__(self, store) -> None:
        self.store = store

    @classmethod
    def shipped(cls, deal: dict) -> bool:
        """Сделка выиграна или поставка отмечена — недавно."""
        from crm_exec import ExecPlan

        since = (date.today() - timedelta(days=cls.RECENT_DAYS)).isoformat()
        done = (deal.get('exec') or {}).get('done')
        ship = (done.get(ExecPlan.SHIP) if isinstance(done, dict) else None) or {}
        won = deal.get('stage') == 'won' and str(deal.get('stageAt') or '')[:10] >= since
        delivered = deal.get('stage') != 'lost' and str(ship.get('at') or '') >= since
        return won or delivered

    def due(self, deal: dict) -> bool:
        """Пора прикрепить акт или УПД."""
        return self.shipped(deal) and not DealFiles.of(self.store).has_closing(deal.get('id') or '')
