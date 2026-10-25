"""Звонки и письма Битрикс24 по сделке (таблица deal_comm): длительность и итог звонка, запись разговора, тема и текст письма."""

import re
from datetime import UTC, datetime, timedelta
from html import unescape
from html.parser import HTMLParser
from typing import Any

from kp_track import Val


class MailText(HTMLParser):
    """Текст письма из HTML: без разметки, стилей и скриптов, абзацы — переводами строк."""

    SKIP = frozenset(('style', 'script', 'head', 'title'))
    BREAKS = frozenset(('br', 'p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'))
    LINES = re.compile(r'\n\s*\n\s*\n+')

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in self.SKIP:
            self.hidden += 1
        elif tag in self.BREAKS:
            self.parts.append('\n')

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.hidden = max(0, self.hidden - 1)
        elif tag in self.BREAKS:
            self.parts.append('\n')

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)

    @staticmethod
    def plain(text: str) -> str:
        """Текст без BB-кодов Битрикса."""
        return unescape(re.sub(r'\[/?[a-zA-Z*]{1,10}(=[^\]]{0,200})?\]', '', text)).strip()

    @classmethod
    def from_html(cls, text: str) -> str:
        parser = cls()
        parser.feed(text)
        parser.close()
        joined = re.sub(r'[ \t\r\f\v]+', ' ', ''.join(parser.parts))
        return cls.LINES.sub('\n\n', '\n'.join(line.strip() for line in joined.split('\n'))).strip()


class DealComms:
    """Звонки и письма сделки из Битрикс24 — строки ленты сделки (только для чтения)."""

    KEEP = 200
    BODY_MAX = 20000
    PREVIEW = 300
    TEXT_MAX = 1000
    SUBJECT_MAX = 300

    def __init__(self, store) -> None:
        self.store = store

    def put(self, row: dict) -> None:
        self.store.write(
            'INSERT INTO deal_comm (bx_id, deal_id, kind, dir, at, dur, subject, result, note, body, peer, record, mid, updated) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bx_id) DO UPDATE SET deal_id=excluded.deal_id, '
            'kind=excluded.kind, dir=excluded.dir, at=excluded.at, dur=COALESCE(excluded.dur, deal_comm.dur), '
            'subject=excluded.subject, result=COALESCE(excluded.result, deal_comm.result), note=excluded.note, '
            'body=excluded.body, peer=excluded.peer, record=COALESCE(excluded.record, deal_comm.record), mid=excluded.mid, '
            'updated=excluded.updated',
            (
                row['bx'],
                row['deal'],
                row['kind'],
                row.get('dir') or '',
                row.get('at') or '',
                row.get('dur'),
                str(row.get('subject') or '')[: self.SUBJECT_MAX],
                row.get('result'),
                str(row.get('note') or '')[: self.TEXT_MAX],
                str(row.get('body') or '')[: self.BODY_MAX],
                str(row.get('peer') or '')[: self.SUBJECT_MAX],
                row.get('record'),
                row.get('mid') or '',
                Val.now(),
            ),
        )

    def call_stats(self, bx_id: str, dur: int | None, result: str | None, record: str | None) -> None:
        self.store.write(
            'UPDATE deal_comm SET dur=COALESCE(?, dur), result=COALESCE(?, result), record=COALESCE(?, record) WHERE bx_id=?',
            (dur, result, record, bx_id),
        )

    def of(self, did: str) -> list:
        """Звонки и письма сделки, новые сверху; taskId — дело программы, связанное с тем же делом Битрикса."""
        rows = self.store.all(
            'SELECT c.bx_id, c.kind, c.dir, c.at, c.dur, c.subject, c.result, c.note, c.body, c.peer, c.record, c.mid, '
            "l.local_id FROM deal_comm c LEFT JOIN bx_link l ON l.kind='task' AND l.bx_id=c.bx_id "
            'WHERE c.deal_id=? ORDER BY c.at DESC LIMIT ?',
            (did, self.KEEP),
        )
        names = self._names()
        keys = (
            'id',
            'kind',
            'dir',
            'at',
            'dur',
            'subject',
            'result',
            'note',
            'body',
            'peer',
            'record',
            'mid',
            'taskId',
        )
        out = []
        for row in rows:
            item = dict(zip(keys, row, strict=True))
            item['by'] = names.get(item.pop('mid') or '', '')
            body = item.get('body') or ''
            if len(body) > self.PREVIEW:  # письмо целиком — по нажатию (body)
                item['body'], item['long'] = body[: self.PREVIEW].rstrip() + '…', True
            out.append({key: value for key, value in item.items() if value not in (None, '')})
        return out

    def body(self, did: str, bx_id: str) -> str | None:
        """Текст письма целиком; письмо не этой сделки — None."""
        row = self.store.one('SELECT body FROM deal_comm WHERE deal_id=? AND bx_id=?', (did, bx_id))
        return (row[0] or '') if row else None

    def _names(self) -> dict:
        return {mid: name or '' for mid, name in self.store.all('SELECT id, name FROM managers')}


class BitrixComms:
    """Загрузка звонков и писем сделок из Битрикс24: из списка дел (crm.activity.list) и статистики телефонии."""

    CALL = '2'
    MAIL = '4'
    KINDS = {CALL: 'call', MAIL: 'mail'}
    DIRS = {'1': 'in', '2': 'out'}
    HTML = '3'
    SELECT = ('DIRECTION', 'START_TIME', 'END_TIME', 'DESCRIPTION_TYPE', 'SETTINGS', 'CREATED')
    # итог звонка телефонии по коду (voximplant.statistic.get, CALL_FAILED_CODE)
    RESULTS = {'200': 'состоялся', '304': 'пропущен', '603': 'отклонён', '486': 'занято', '480': 'не отвечает'}
    LONG_CALL = timedelta(hours=6)
    STATS_BATCH = 50
    SWEEP_EVERY = timedelta(minutes=30)
    SWEEP_KEEP = 500
    SWEEP_LIMIT = 300
    RECORD_URL = re.compile(r'^https?://[^\s"\'<>]{4,2000}$')

    def __init__(self, sync) -> None:
        self.sync = sync
        self.store = sync.store
        self.book = DealComms(sync.store)

    def enabled(self) -> bool:
        from features import FeatureAccess

        return FeatureAccess(self.store).is_on('bxComms') and self.sync.rules.can('task', 'in')

    def take(self, rows: list) -> int:
        """Звонки (сделанные) и письма из дел Битрикса по связанным сделкам → лента сделки. → сколько записано."""
        if not self.enabled():
            return 0
        count, calls = 0, []
        for activity in rows:
            row = self._row(activity)
            if not row:
                continue
            self.book.put(row)
            count += 1
            if row['kind'] == 'call':
                calls.append(row['bx'])
        self._stats(calls)
        return count

    def sweep(self, did: str) -> int:
        """Карточка сделки: звонки и письма сделки целиком (раньше подключения обмена) — не чаще раза в полчаса. → сколько."""
        link = self.sync.links.get('deal', did)
        if not link or not self.enabled():
            return 0
        tried = self.store.kv_get('bxCommAt') or {}
        last = tried.get(did) or ''
        now = datetime.now(UTC)
        if last and now - datetime.fromisoformat(last) < self.SWEEP_EVERY:
            return 0
        tried[did] = now.isoformat(timespec='seconds')
        self.store.kv_set('bxCommAt', dict(list(tried.items())[-self.SWEEP_KEEP :]))
        rows = self.sync.api.list(
            'crm.activity.list',
            {
                'filter': {'OWNER_TYPE_ID': 2, 'OWNER_ID': link['bx'], 'TYPE_ID': [self.CALL, self.MAIL]},
                'select': self.fields(),
            },
            limit=self.SWEEP_LIMIT,
        )
        return self.take(rows)

    @classmethod
    def fields(cls) -> list:
        return [
            'ID',
            'OWNER_ID',
            'SUBJECT',
            'DEADLINE',
            'COMPLETED',
            'TYPE_ID',
            'RESPONSIBLE_ID',
            'DESCRIPTION',
            'PROVIDER_ID',
            *cls.SELECT,
        ]

    def _row(self, activity: dict) -> dict | None:
        kind = self.KINDS.get(str(activity.get('TYPE_ID') or ''))
        if not kind or (kind == 'call' and activity.get('COMPLETED') != 'Y'):
            return None
        did = self.sync.links.local('deal', activity.get('OWNER_ID'))
        if not did:
            return None
        from bitrix import BitrixTime

        start = BitrixTime.local(activity.get('START_TIME') or activity.get('CREATED') or activity.get('DEADLINE'))
        text = str(activity.get('DESCRIPTION') or '')
        found = activity.get('SETTINGS')
        settings = found if isinstance(found, dict) else {}
        row: dict[str, Any] = {
            'bx': str(activity['ID']),
            'deal': did,
            'kind': kind,
            'dir': self.DIRS.get(str(activity.get('DIRECTION') or ''), ''),
            'at': (start or Val.now())[:19],
            'subject': str(activity.get('SUBJECT') or '').strip(),
            'mid': self.sync._mid_of(activity.get('RESPONSIBLE_ID')) or '',
        }
        if kind == 'mail':
            html = str(activity.get('DESCRIPTION_TYPE') or '') == self.HTML
            row['body'] = MailText.from_html(text) if html else MailText.plain(text)
            row['peer'] = self._peer(settings, row['dir'])
        else:
            row['note'] = MailText.plain(text)
            row['dur'] = self._duration(activity)
        return row

    @staticmethod
    def _peer(settings: dict, way: str) -> str:
        found = settings.get('EMAIL_META')
        meta = found if isinstance(found, dict) else {}
        return str(meta.get('from' if way == 'in' else 'to') or '').strip()

    def _duration(self, activity: dict) -> int | None:
        try:
            start = datetime.fromisoformat(str(activity.get('START_TIME') or ''))
            end = datetime.fromisoformat(str(activity.get('END_TIME') or ''))
        except ValueError:
            return None
        span = end - start
        return int(span.total_seconds()) if timedelta(0) < span < self.LONG_CALL else None

    def _stats(self, ids: list) -> None:
        """Телефония: длительность, итог и запись разговора; без доступа к телефонии вебхука — только из дела."""
        for start in range(0, len(ids), self.STATS_BATCH):
            part = ids[start : start + self.STATS_BATCH]
            try:
                rows = self.sync.api.list(
                    'voximplant.statistic.get', {'FILTER': {'CRM_ACTIVITY_ID': part}}, limit=self.STATS_BATCH * 2
                )
            except Exception:  # нет права «Телефония» у вебхука: звонки остаются без записи
                return
            for stat in rows:
                self._stat(stat)

    def _stat(self, stat: dict) -> None:
        bx_id = str(stat.get('CRM_ACTIVITY_ID') or '')
        if not bx_id:
            return
        code = str(stat.get('CALL_FAILED_CODE') or '')
        result = self.RESULTS.get(code) or str(stat.get('CALL_FAILED_REASON') or '').strip() or None
        record = str(stat.get('CALL_RECORD_URL') or '').strip()
        try:
            dur = int(str(stat.get('CALL_DURATION')))
        except (TypeError, ValueError):
            dur = None
        self.book.call_stats(bx_id, dur, result, record if self.RECORD_URL.match(record) else None)
