"""Компании и контакты Битрикс24 → клиенты программы: по ИНН, иначе по контактам (телефон, почта, ФИО), без дублей."""

import json
import re
from typing import Any

from client_match import ClientMatch, ContactKey


class BitrixClients:
    """Слияние клиента Битрикса с базой: реквизиты юрлица — из программы (актуальны), контакты Битрикса — дописываются.

    Компания без ИНН ищется по контактам: одно совпадение — та же компания, несколько — выбор в сделке («clientPick»),
    ни одного — новый клиент с пометкой «без ИНН».
    """

    CONTACTS_MAX = 30
    PICK_MAX = 8
    CHUNK = 50
    NAME_WORDS = 2
    SOURCE = 'Битрикс24'
    COMPANY = 4
    CONTACT_SELECT = ('ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'POST', 'PHONE', 'EMAIL', 'COMPANY_ID')

    def __init__(self, sync) -> None:
        self.sync = sync
        self.api = sync.api
        self.store = sync.store
        self.rules = sync.rules

    # ---------------------------------------------------------------- из Битрикса
    def of_deal(self, bx_deal: dict) -> dict:
        """Клиент сделки Битрикса: по компании (с контактами самой сделки), а сделка без компании — по контакту."""
        cid = str(bx_deal.get('COMPANY_ID') or '')
        deal_people = self.people_of(self.deal_contacts(bx_deal))
        if cid and cid != '0':
            return self.of_company(cid, deal_people)
        if not deal_people:
            return {}
        key = 'c' + str(bx_deal.get('CONTACT_ID') or deal_people[0].get('name') or '')
        return self.resolve({'company': '', 'name': '', 'inn': '', 'people': deal_people, 'key': key})

    def of_company(self, cid: str, extra: list | None = None) -> dict:
        """Компания: реквизиты, её контакты (основные и привязанные списком связей) и extra — контакты сделки."""
        comp = self.api.call('crm.company.get', {'id': cid}) or {}
        req = self.api.list(
            'crm.requisite.list',
            {
                'filter': {'ENTITY_TYPE_ID': self.COMPANY, 'ENTITY_ID': cid},
                'select': ['ID', 'RQ_INN', 'RQ_KPP', 'RQ_OGRN'],
            },
            limit=3,
        )
        people = [
            self._person(row)
            for row in self.api.list(
                'crm.contact.list', {'filter': {'COMPANY_ID': cid}, 'select': list(self.CONTACT_SELECT)}, limit=20
            )
        ]
        linked = self.people_of(self._items('crm.company.contact.items.get', cid))
        return self.resolve(self._company(cid, comp, req[0] if req else {}, [*(extra or []), *people, *linked]))

    def deal_contacts(self, bx_deal: dict) -> list[str]:
        """Контакты сделки: основной (CONTACT_ID) и все привязанные к сделке."""
        ids = [str(bx_deal.get('CONTACT_ID') or '')]
        if bx_deal.get('ID'):
            ids += self._items('crm.deal.contact.items.get', bx_deal['ID'])
        return list(dict.fromkeys(cid for cid in ids if cid and cid != '0'))

    def _items(self, method: str, owner) -> list[str]:
        """Связанные контакты (crm.*.contact.items.get); старый портал без метода — пусто."""
        try:
            rows = self.api.call(method, {'id': owner}) or []
        except Exception:
            return []
        return [str(row.get('CONTACT_ID')) for row in rows if isinstance(row, dict) and row.get('CONTACT_ID')]

    def people_of(self, ids: list) -> list[dict]:
        """Контакты по номерам."""
        by_id = self._by_id(ids)
        return [by_id[cid] for cid in ids if cid in by_id]

    def _by_id(self, ids: list) -> dict[str, dict]:
        """{номер: контакт} — пачками по CHUNK."""
        out: dict[str, dict] = {}
        for start in range(0, len(ids), self.CHUNK):
            part = ids[start : start + self.CHUNK]
            rows = self.api.list(
                'crm.contact.list', {'filter': {'ID': part}, 'select': list(self.CONTACT_SELECT)}, limit=len(part)
            )
            out.update({str(row.get('ID')): self._person(row) for row in rows})
        return out

    def bulk(self, ids: list, deal_contacts: dict | None = None) -> dict:
        """Компании пачкой (загрузка тысяч сделок): {id: клиент} — компании, реквизиты, контакты — по CHUNK за запрос;
        deal_contacts {компания: [контакты сделок]} — контакты сделок дописываются к своей компании."""
        want = sorted({str(cid) for cid in ids if cid and str(cid) != '0'})
        extra = self._deal_people(deal_contacts or {})
        out: dict = {}
        for start in range(0, len(want), self.CHUNK):
            part = want[start : start + self.CHUNK]
            comps = {
                str(row.get('ID')): row
                for row in self.api.list(
                    'crm.company.list',
                    {'filter': {'ID': part}, 'select': ['ID', 'TITLE', 'PHONE', 'EMAIL']},
                    limit=len(part),
                )
            }
            reqs = self._reqs(part)
            people = self._people(part)
            for cid in part:
                rows = [*extra.get(cid, []), *people.get(cid, [])]
                info = self._company(cid, comps.get(cid, {}), reqs.get(cid, {}), rows)
                out[cid] = self.resolve(info)
        return out

    def _deal_people(self, deal_contacts: dict) -> dict:
        ids = list(dict.fromkeys(cid for rows in deal_contacts.values() for cid in rows))
        by_id = self._by_id(ids)
        return {company: [by_id[cid] for cid in rows if cid in by_id] for company, rows in deal_contacts.items()}

    def _reqs(self, part: list) -> dict:
        out: dict = {}
        for row in self.api.list(
            'crm.requisite.list',
            {
                'filter': {'ENTITY_TYPE_ID': self.COMPANY, 'ENTITY_ID': part},
                'select': ['ENTITY_ID', 'RQ_INN', 'RQ_KPP', 'RQ_OGRN'],
            },
            limit=len(part) * 3,
        ):
            if re.sub(r'\D', '', str(row.get('RQ_INN') or '')):
                out.setdefault(str(row.get('ENTITY_ID')), row)
        return out

    def _people(self, part: list) -> dict:
        out: dict = {}
        for row in self.api.list(
            'crm.contact.list',
            {'filter': {'COMPANY_ID': part}, 'select': list(self.CONTACT_SELECT)},
            limit=len(part) * 10,
        ):
            out.setdefault(str(row.get('COMPANY_ID')), []).append(self._person(row))
        return out

    def _company(self, cid: str, comp: dict, req: dict, people: list) -> dict:
        """Компания Битрикса: название, ИНН, реквизиты, контакты (люди и телефоны / почта самой компании)."""
        own = {
            'name': comp.get('TITLE') or '',
            'phone': self._first(comp.get('PHONE')),
            'email': self._first(comp.get('EMAIL')),
        }
        rows = [*people, own] if own['phone'] or own['email'] else people
        return {
            'company': cid,
            'name': comp.get('TITLE') or '',
            'inn': re.sub(r'\D', '', str(req.get('RQ_INN') or '')),
            'kpp': req.get('RQ_KPP') or '',
            'ogrn': req.get('RQ_OGRN') or '',
            'people': [row for row in rows if row.get('phone') or row.get('email') or row.get('name')],
            'key': cid,
        }

    @staticmethod
    def _first(values) -> str:
        rows = values if isinstance(values, list) else []
        return next((str(row.get('VALUE') or '') for row in rows if isinstance(row, dict) and row.get('VALUE')), '')

    def _person(self, row: dict) -> dict:
        name = ' '.join(str(row.get(key) or '').strip() for key in ('LAST_NAME', 'NAME', 'SECOND_NAME')).strip()
        return {
            'name': re.sub(r'\s+', ' ', name),
            'post': str(row.get('POST') or ''),
            'phone': self._first(row.get('PHONE')),
            'email': self._first(row.get('EMAIL')),
        }

    # ---------------------------------------------------------------- в базу клиентов
    def resolve(self, info: dict) -> dict:
        """Клиент программы для компании (контакта) Битрикса → {company, name, inn, clientId, pick}."""
        out = {'company': info.get('company') or '', 'name': info.get('name') or '', 'inn': info.get('inn') or ''}
        if not self.rules.can('company', 'in'):
            return out
        if out['inn']:
            client = self._by_inn(out['inn']) or self._new(info)
            return self._linked(out, self._merge(client, info['people']))
        found = self._by_contacts(info['people'])
        if len(found) == 1:
            client = self.store.client_get(found[0]['id']) or {}
            return self._linked(out, self._merge(client, info['people']))
        if found:
            return dict(out, pick=found[: self.PICK_MAX])
        if not (out['name'] or info['people']):
            return out
        return self._linked(out, self._merge(self._new(info), info['people']))

    @staticmethod
    def _linked(out: dict, client: dict) -> dict:
        return dict(
            out, clientId=client.get('id') or '', name=client.get('name') or out['name'], inn=client.get('inn') or ''
        )

    def _by_inn(self, inn: str) -> dict:
        doc = self.store.client_get('inn' + inn)
        if not doc:
            row = self.store.one('SELECT doc FROM clients WHERE inn=? LIMIT 1', (inn,))
            doc = json.loads(row[0]) if row and row[0] else None
        return doc if isinstance(doc, dict) else {}

    def _by_contacts(self, people: list) -> list[dict]:
        matcher = ClientMatch(self.store)
        names = [row['name'] for row in people if len(ContactKey.words(row.get('name'))) >= self.NAME_WORDS]
        return matcher.any_of(
            phones=[row['phone'] for row in people if ContactKey.phone(row.get('phone'))],
            emails=[row['email'] for row in people if ContactKey.email(row.get('email'))],
            names=names,
        )

    def _new(self, info: dict) -> dict:
        inn = info.get('inn') or ''
        doc: dict[str, Any] = {
            'id': 'inn' + inn if inn else 'bx' + str(info.get('key') or ''),
            'name': info.get('name') or (info['people'][0]['name'] if info.get('people') else 'Клиент из Битрикс24'),
            'inn': inn,
            'kpp': info.get('kpp') or '',
            'ogrn': info.get('ogrn') or '',
            'source': self.SOURCE,
        }
        if not inn:
            doc['noInn'] = True
        return doc

    def _merge(self, client: dict, people: list) -> dict:
        """Контакты Битрикса — в карточку клиента: новые добавляются, у известных дописываются пустые поля."""
        doc = {key: value for key, value in client.items() if key != '_rev'}
        rows = [dict(row) for row in (doc.get('contacts') or []) if isinstance(row, dict)]
        changed = not self.store.client_get(doc['id'])
        if self.rules.allow(self.rules.company()['contacts'], 'in'):
            for person in people:
                changed = self._add(rows, person) or changed
        if changed:
            doc['contacts'] = rows[: self.CONTACTS_MAX]
            self.store.client_put(doc['id'], doc, self.sync.WHO)
        return doc

    @staticmethod
    def _add(rows: list, person: dict) -> bool:
        same = next((row for row in rows if BitrixClients._same(row, person)), None)
        if same is None:
            rows.append({key: value for key, value in person.items() if value})
            return True
        filled = {key: value for key, value in person.items() if value and not same.get(key)}
        same.update(filled)
        return bool(filled)

    @staticmethod
    def _same(row: dict, person: dict) -> bool:
        phone = ContactKey.phone(person.get('phone'))
        email = ContactKey.email(person.get('email'))
        if phone and phone == ContactKey.phone(row.get('phone')):
            return True
        if email and email == ContactKey.email(row.get('email')):
            return True
        name = ' '.join(ContactKey.words(person.get('name')))
        return bool(name) and name == ' '.join(ContactKey.words(row.get('name')))
