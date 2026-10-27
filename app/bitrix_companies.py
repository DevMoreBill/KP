"""Компания сделки в Битрикс24 без дублей: поиск перед созданием и проверка, что связанные компании не удалены."""

import re
from datetime import date
from typing import Any

from client_match import ContactKey


class BitrixCompanyFind:
    """Где искать компанию до создания: по ИНН в реквизитах, по телефону и почте (как контроль дублей портала —
    иначе новая компания им же удаляется), по названию без формы собственности, кавычек и регистра."""

    COMPANY = 4  # ENTITY_TYPE_ID компании в реквизитах
    COMM_MAX = 10  # телефонов и почт клиента в одном запросе поиска дублей
    NAME_ROWS = 10
    FORMS = re.compile(r'\b(ооо|оао|зао|пао|ао|нао|ип|тоо|фгуп|муп|гуп|ано|нко|ук)\b')
    QUOTES = re.compile(r'[«»"\'“”„]')

    def __init__(self, api) -> None:
        self.api = api

    def by_inn(self, inn: str) -> str:
        rows = self.api.list(
            'crm.requisite.list',
            {'filter': {'RQ_INN': inn, 'ENTITY_TYPE_ID': self.COMPANY}, 'select': ['ID', 'ENTITY_ID']},
            limit=5,
        )
        return str(rows[0].get('ENTITY_ID') or '') if rows else ''

    def by_comm(self, client: dict) -> tuple[str, str]:
        """(id компании, чем нашлась) — по телефонам и почтам клиента и его контактов; не нашлась — ('', '')."""
        for kind, label, values in (
            ('EMAIL', 'почте', self._values(client, 'email', ContactKey.email)),
            ('PHONE', 'телефону', self._values(client, 'phone', ContactKey.phone)),
        ):
            if not values:
                continue
            found = self.api.call(
                'crm.duplicate.findbycomm', {'entity_type': 'COMPANY', 'type': kind, 'values': values}
            )
            ids = found.get('COMPANY') if isinstance(found, dict) else None
            if ids:
                return str(ids[0]), label
        return '', ''

    def by_name(self, name: str) -> str:
        core = self.core(name)
        if not core:
            return ''
        exact = self.api.list('crm.company.list', {'filter': {'TITLE': name}, 'select': ['ID']}, limit=2)
        if exact:
            return str(exact[0].get('ID') or '')
        rows = self.api.list(
            'crm.company.list', {'filter': {'%TITLE': core}, 'select': ['ID', 'TITLE']}, limit=self.NAME_ROWS
        )
        same = [row for row in rows if self.core(row.get('TITLE')) == core]
        return str(same[0].get('ID') or '') if len(same) == 1 else ''

    @classmethod
    def core(cls, name: Any) -> str:
        """«ООО «НПС Снабжение»» и «"НПС СНАБЖЕНИЕ" ООО» → «нпс снабжение»."""
        text = cls.QUOTES.sub(' ', str(name or '').lower().replace('ё', 'е'))
        return ' '.join(cls.FORMS.sub(' ', text).split())

    @staticmethod
    def _values(client: dict, key: str, norm) -> list[str]:
        rows = [client, *[row for row in client.get('contacts') or [] if isinstance(row, dict)]]
        seen: dict[str, str] = {}
        for row in rows:
            value = str(row.get(key) or '').strip()
            if value and norm(value) and norm(value) not in seen:
                seen[norm(value)] = value
        return list(seen.values())[: BitrixCompanyFind.COMM_MAX]


class BitrixCompanyCheck:
    """Раз в сутки: связанные со сделками компании ещё есть в Битриксе? Удалённую (например, контролем дублей)
    связь забываем, сделки клиента ставим в очередь — при отправке компания найдётся заново (оригинал, не дубль)."""

    KEY = 'companyCheck'
    BATCH = 50

    def __init__(self, sync) -> None:
        self.sync = sync
        self.api = sync.api
        self.store = sync.store
        self.conf = sync.conf
        self.log = sync.log

    def due(self) -> bool:
        return self.conf.get().get(self.KEY) != date.today().isoformat()

    def run(self) -> int:
        """Сколько связей с удалёнными компаниями найдено (их сделки — в очереди)."""
        rows = self.store.all("SELECT local_id, bx_id FROM bx_link WHERE kind='company'")
        gone: set[str] = set()
        for start in range(0, len(rows), self.BATCH):
            part = rows[start : start + self.BATCH]
            ids = [str(bx_id) for _local, bx_id in part]
            alive = {
                str(row.get('ID'))
                for row in self.api.list('crm.company.list', {'filter': {'ID': ids}, 'select': ['ID']}, limit=len(ids))
            }
            gone |= {str(local) for local, bx_id in part if str(bx_id) not in alive}
        if gone:
            self._relink(gone)
        self.conf.mark(**{self.KEY: date.today().isoformat()})
        return len(gone)

    def _relink(self, gone: set[str]) -> None:
        from bitrix import BitrixQueue
        from crm import DealBook

        for key in gone:
            self.store.write("DELETE FROM bx_link WHERE kind='company' AND local_id=?", (key,))
        deals = [row[0] for row in self.store.all("SELECT local_id FROM bx_link WHERE kind='deal'")]
        book, count = DealBook(self.store), 0
        for did in deals:
            deal = book.get(did) or {}
            if self.key(deal) in gone:
                BitrixQueue.touch(self.store, 'deal', did)
                count += 1
        self.log.add(
            f'В Битрикс24 удалены компании, связанные со сделками программы (вероятно, дубли): {len(gone)}. '
            f'Связи забыты, сделки отправятся заново с найденной компанией: {count}',
            'warn',
        )

    @staticmethod
    def key(deal: dict) -> str:
        """Ключ компании сделки в связях обмена: ИНН, иначе название строчными."""
        inn = re.sub(r'\D', '', str(deal.get('clientInn') or ''))
        return inn or str(deal.get('client') or '').strip().lower()
