"""Компания сделки в Битрикс24 без дублей: поиск перед созданием и проверка, что связанные компании не удалены."""

import re
from datetime import date
from typing import Any

from client_match import ContactKey
from inn import Inn


class BitrixCompanyFind:
    """Компания клиента в Битриксе — только подтверждённая: по ИНН в реквизитах; по телефону или почте самой компании
    (не её контактных лиц — они бывают общими у нескольких компаний), если такая компания одна, её ИНН не другой и в
    названии есть общее слово; по названию без формы собственности и кавычек, если такая компания одна и ИНН не другой.
    Телефон или почта, занятые другой компанией, отмечаются в conflicts — новая компания создаётся без них (иначе её
    удалит контроль дублей портала), в чужую карточку ничего не пишется."""

    COMPANY = 4  # ENTITY_TYPE_ID компании в реквизитах
    COMM_MAX = 10
    NAME_ROWS = 10
    WORD_MIN = 3
    FORMS = re.compile(r'\b(ооо|оао|зао|пао|ао|нао|ип|тоо|фгуп|муп|гуп|ано|нко|ук)\b')
    QUOTES = re.compile(r'[«»"\'“”„]')
    COMMON = frozenset(
        (
            'компания',
            'группа',
            'завод',
            'торговый',
            'дом',
            'фирма',
            'холдинг',
            'предприятие',
            'производственная',
            'производственное',
            'производственный',
            'научно',
            'управляющая',
            'рус',
            'русь',
            'россия',
            'центр',
            'сервис',
        )
    )

    def __init__(self, api) -> None:
        self.api = api
        self.conflicts: dict[str, set[str]] = {'phone': set(), 'email': set()}

    def by_inn(self, inn: str) -> str:
        rows = self.api.list(
            'crm.requisite.list',
            {'filter': {'RQ_INN': inn, 'ENTITY_TYPE_ID': self.COMPANY}, 'select': ['ID', 'ENTITY_ID']},
            limit=5,
        )
        return str(rows[0].get('ENTITY_ID') or '') if rows else ''

    def by_comm(self, client: dict, inn: str, name: str) -> tuple[str, str]:
        """(id компании, чем нашлась) — по телефону и почте самой компании клиента; не подтвердилась — ('', '')."""
        for key, kind, label, norm in (
            ('email', 'EMAIL', 'почте', ContactKey.email),
            ('phone', 'PHONE', 'телефону', ContactKey.phone),
        ):
            value = str(client.get(key) or '').strip()
            if not value or not norm(value):
                continue
            ids = self.owners('COMPANY', kind, value)
            if not ids:
                continue
            sure = [cid for cid in ids if self._ours(cid, inn, name)]
            if len(sure) == 1:
                return sure[0], label
            self.conflicts[key].add(norm(value))  # занят другой компанией или неоднозначно — не наш, не трогаем
        return '', ''

    def by_name(self, name: str, inn: str) -> str:
        core = self.core(name)
        if not core:
            return ''
        rows = self.api.list(
            'crm.company.list', {'filter': {'%TITLE': core}, 'select': ['ID', 'TITLE']}, limit=self.NAME_ROWS
        )
        same = [row for row in rows if self.core(row.get('TITLE')) == core]
        if len(same) != 1:
            return ''
        cid = str(same[0].get('ID') or '')
        return cid if self._inn_fits(cid, inn) else ''

    def owners(self, entity: str, kind: str, value: str) -> list[str]:
        """Чьи (компаний или контактов Битрикса) этот телефон или почта."""
        found = self.api.call('crm.duplicate.findbycomm', {'entity_type': entity, 'type': kind, 'values': [value]})
        ids = found.get(entity) if isinstance(found, dict) else None
        return [str(x) for x in ids or []]

    def free(self, key: str, value: Any) -> bool:
        """Телефон или почту можно записать в новую компанию: не заняты другой компанией."""
        norm = ContactKey.email if key == 'email' else ContactKey.phone
        return norm(value) not in self.conflicts[key]

    def _ours(self, cid: str, inn: str, name: str) -> bool:
        if not self._inn_fits(cid, inn):
            return False
        if inn and self._inns(cid):
            return True  # ИНН совпал
        rows = self.api.list('crm.company.list', {'filter': {'ID': cid}, 'select': ['ID', 'TITLE']}, limit=1)
        return bool(rows) and bool(self.words(rows[0].get('TITLE')) & self.words(name))

    def _inn_fits(self, cid: str, inn: str) -> bool:
        """ИНН компании Битрикса не противоречит клиенту (нет реквизитов или нет ИНН у клиента — не противоречит)."""
        inns = self._inns(cid)
        return not inn or not inns or inn in inns

    def _inns(self, cid: str) -> set[str]:
        rows = self.api.list(
            'crm.requisite.list',
            {'filter': {'ENTITY_ID': cid, 'ENTITY_TYPE_ID': self.COMPANY}, 'select': ['ID', 'RQ_INN']},
            limit=5,
        )
        return {Inn.digits(row.get('RQ_INN')) for row in rows} - {''}

    @classmethod
    def core(cls, name: Any) -> str:
        """«ООО «НПС Снабжение»» и «"НПС СНАБЖЕНИЕ" ООО» → «нпс снабжение»."""
        text = cls.QUOTES.sub(' ', str(name or '').lower().replace('ё', 'е'))
        return ' '.join(cls.FORMS.sub(' ', text).split())

    @classmethod
    def words(cls, name: Any) -> set[str]:
        """Значимые слова названия (без формы собственности и общих слов вроде «компания», «завод»)."""
        words = re.findall(r'[a-zа-я0-9]+', cls.core(name))
        return {word for word in words if len(word) >= cls.WORD_MIN and word not in cls.COMMON}


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
        inn = Inn.digits(deal.get('clientInn'))
        return inn or str(deal.get('client') or '').strip().lower()
