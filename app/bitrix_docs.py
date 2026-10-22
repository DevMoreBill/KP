"""Документы сделки → Битрикс24: в поле файлов сделки с подходящим названием, иначе комментарием с файлом в ленте."""

import base64
import re
from typing import Any

from crm_funnels import DealFields
from deal_files import DealFiles


class BitrixDealDocs:
    """Каждый документ отправляется один раз (отметка в связях обмена `doc|сделка|документ`).

    Поле подбирается по виду документа (FIELDS) среди полей сделки вида «файл»; в поле со многими файлами прежние файлы
    портала передаются их номерами — иначе Битрикс24 заменил бы их новым.
    """

    MEGABYTE = 1024 * 1024
    FIELDS = {
        'contract': r'договор',
        'spec': r'специфик',
        'invoice': r'^сч[её]т|сч[её]т на оплат',
        'act': r'закрыва|\bакт',
        'upd': r'закрыва|\bупд',
    }
    SKIP = r'ткп'  # поле «ТКП / счёт» — для файла КП (регламент), документы туда не кладутся

    def __init__(self, sync) -> None:
        self.sync = sync
        self.api = sync.api
        self.store = sync.store
        self.links = sync.links
        self.log = sync.log

    def push(self, deal: dict, bid: str) -> None:
        files = DealFiles.of(self.store)
        limit = self.sync.rules.send()['fileMB'] * self.MEGABYTE
        for rec in files.list(deal['id']):
            key = 'doc|{}|{}'.format(deal['id'], rec['id'])
            if self.links.get('file', key):
                continue
            got = files.read(deal['id'], rec['id'])
            if not got:
                continue
            data = got[1]
            if len(data) > limit:
                self.log.add(f'Документ «{rec["name"]}» больше предела файла — в Битрикс24 не отправлен', 'warn')
                self.links.put('file', key, bid, {'skip': 'size'})
                continue
            field = self._field(rec['kind'])
            where = self._to_field(bid, field, rec['name'], data) if field else self._to_feed(bid, rec, data)
            self.links.put('file', key, bid, {'to': where})

    def _field(self, kind: str) -> dict | None:
        """Поле сделки вида «файл» для документа этого вида (первое по порядку) или None."""
        want = self.FIELDS.get(kind)
        if not want:
            return None
        for row in DealFields(self.store).all():
            title = str(row.get('title') or '')
            if row.get('type') == 'file' and re.search(want, title, re.I) and not re.search(self.SKIP, title, re.I):
                return row
        return None

    def _to_field(self, bid: str, field: dict, name: str, data: bytes) -> str:
        new: Any = {'fileData': [name, base64.b64encode(data).decode('ascii')]}
        code = field['code']
        if field.get('multiple'):
            kept = [{'id': row['id']} for row in self._current(bid, code)]
            new = [*kept, new]
        self.api.call('crm.deal.update', {'id': bid, 'fields': {code: new}})
        return code

    def _current(self, bid: str, code: str) -> list[dict]:
        """Файлы поля сделки на портале: [{id, …}]."""
        deal = self.api.call('crm.deal.get', {'id': bid}) or {}
        value = deal.get(code) if isinstance(deal, dict) else None
        rows = value if isinstance(value, list) else [value] if value else []
        return [row for row in rows if isinstance(row, dict) and row.get('id')]

    def _to_feed(self, bid: str, rec: dict, data: bytes) -> str:
        kind = DealFiles.KINDS.get(rec['kind'], 'Документ')
        fields = {
            'ENTITY_ID': int(bid),
            'ENTITY_TYPE': 'deal',
            'COMMENT': f'Документ сделки — {kind}: {rec["name"]}',
            'FILES': [[rec['name'], base64.b64encode(data).decode('ascii')]],
        }
        self.api.call('crm.timeline.comment.add', {'fields': fields})
        return 'feed'
