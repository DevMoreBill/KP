"""Компании и контакты Битрикс24 → клиенты программы: по ИНН, иначе по контактам (телефон, почта, ФИО), без дублей."""

import base64
import json
import os
import re
from pathlib import Path
from typing import Any

from bitrix_companies import BitrixCompanyFind
from client_contacts import ClientContacts
from client_match import ClientMatch, ContactKey


class BitrixClients:
    """Слияние клиента Битрикса с базой: реквизиты юрлица — из программы (актуальны), контакты Битрикса — дописываются.

    Компания без ИНН ищется по контактам: одно совпадение с общим словом в названии — та же компания, иначе — выбор в
    сделке («clientPick»; контактное лицо бывает общим у нескольких компаний),
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
        found = self._by_contacts(info['people']) if self.rules.company()['byPeople'] else []
        if len(found) == 1 and self._same_firm(out['company'] and out['name'], found[0].get('name')):
            client = self.store.client_get(found[0]['id']) or {}
            return self._linked(out, self._merge(client, info['people']))
        if found:
            return dict(out, pick=found[: self.PICK_MAX])
        if not (out['name'] or info['people']):
            return out
        return self._linked(out, self._merge(self._new(info), info['people']))

    @staticmethod
    def _same_firm(theirs: Any, ours: Any) -> bool:
        """Компания Битрикса — тот же клиент, что найден по контакту: в названиях общее значимое слово (контактное лицо
        бывает общим у нескольких компаний — иначе выбор в сделке). Контакт без компании — по контакту."""
        return not theirs or bool(BitrixCompanyFind.words(theirs) & BitrixCompanyFind.words(ours))

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
        rules = self.rules.contacts()
        if self.rules.allow(rules['dir'], 'in'):
            for person in people:
                if not self._wanted(doc, person, rules):
                    continue
                changed = self._add(rows, person) or changed
            kept = [row for row in rows if not (rules['junk'] and self.junk(row))]
            changed = changed or len(kept) != len(rows)
            rows = kept
        if changed:
            doc['contacts'] = rows[: self.CONTACTS_MAX]
            self.store.client_put(doc['id'], doc, self.sync.WHO)
        return doc

    @classmethod
    def _wanted(cls, doc: dict, person: dict, rules: dict) -> bool:
        """Контакт Битрикса загружать в карточку клиента: не удалён в программе, не пустой («1»), с телефоном или почтой
        (если контакты без них не загружаются)."""
        if ClientContacts.is_gone(doc, person) or (rules['junk'] and cls.junk(person)):
            return False
        return rules['bare'] or bool(ContactKey.phone(person.get('phone')) or ContactKey.email(person.get('email')))

    @staticmethod
    def junk(person: dict) -> bool:
        """Пустой контакт: в имени нет букв и нет ни телефона, ни почты (такие в Битрикс24 бывают — «1», «-»)."""
        name = str(person.get('name') or '')
        letters = any(char.isalpha() for char in name)
        return not letters and not ContactKey.phone(person.get('phone')) and not ContactKey.email(person.get('email'))

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


class BitrixClientOut:
    """Клиент сделки по регламенту → Битрикс24: телефон и почта компании, контакты (привязаны к компании и сделке),
    файл КП — в поле «ТКП / счёт». Каждое значение отправляется один раз (отметки в связях обмена)."""

    PDF = 'КП (PDF)'
    WORD = 'КП (Word)'

    def __init__(self, sync) -> None:
        self.sync = sync
        self.api = sync.api
        self.store = sync.store
        self.rules = sync.rules
        self.links = sync.links

    def push(self, deal: dict, company_id: str | None, bid: str) -> None:
        if not company_id:
            return
        client = self._client(deal)
        if not client:
            return
        if self.rules.can('company', 'out') and self.rules.company()['fill']:
            self.company_comm(company_id, client)
        people_rules = self.rules.contacts()
        if self.rules.allow(people_rules['dir'], 'out'):
            people = self.people(company_id, client, deal.get('managerId'))
            if people and people_rules['deal']:
                self.bind_deal(deal['id'], bid, people[0])

    def _client(self, deal: dict) -> dict:
        cid = deal.get('clientId') or ('inn' + deal['clientInn'] if deal.get('clientInn') else '')
        found = self.store.client_get(cid) if cid else None
        return found if isinstance(found, dict) else {}

    def company_comm(self, company_id: str, client: dict) -> None:
        """Телефон и почта компании из справочника — в компанию Битрикса: только дописываются и только не занятые
        другой компанией (прежние не трогаются, чужие карточки не меняются)."""
        key = f'comm|{company_id}'
        link = self.links.get('file', key)
        sent = dict((link or {}).get('sent') or {})
        fields: dict[str, list] = {}
        find = BitrixCompanyFind(self.api)
        for field, kind in (('phone', 'PHONE'), ('email', 'EMAIL')):
            value = str(client.get(field) or '').strip()
            if not value or sent.get(field) == value:
                continue
            sent[field] = value
            owners = find.owners('COMPANY', kind, value)
            if not owners:
                fields[kind] = [{'VALUE': value, 'VALUE_TYPE': 'WORK'}]
        if fields:
            self.api.call('crm.company.update', {'id': company_id, 'fields': fields})
        if sent != (link or {}).get('sent'):
            self.links.put('file', key, company_id, sent)

    def people(self, company_id: str, client: dict, manager_id: str | None) -> list[str]:
        """Контакты клиента → контакты Битрикса этой компании: найденный по телефону или почте — только с тем же ФИО
        (контактные лица бывают общими у нескольких компаний, а телефон приёмной — у разных людей); телефон или почта у
        другого человека — контакт не создаётся и чужая карточка не меняется (до правки телефона или почты в программе)."""
        out = []
        rules = self.rules.contacts()
        rows = [row for row in client.get('contacts') or [] if isinstance(row, dict) and row.get('name')]
        for row in rows[: rules['max']]:
            key, comm = self.person_key(client, row), self.comm(row)
            link = self.links.get('file', key)
            if link and link['bx']:
                if rules['fill']:
                    self._fill_comm(client, row, link)
                out.append(str(link['bx']))
                continue
            if link and (link['sent'] or {}).get('comm') == comm:
                continue  # прежде занят другим человеком — пока данные те же, не пробуем
            bx_id, busy = self._find(row)
            if busy:
                self.links.put('file', key, '', {'company': str(company_id), 'comm': comm, 'busy': True})
                self.sync.log.add(
                    f'Контакт «{row["name"]}»: телефон или почта в Битрикс24 у другого человека — контакт не создан, '
                    'чужая карточка не изменена',
                    'warn',
                    mid=manager_id,
                )
                continue
            if not bx_id and not rules['create']:
                continue  # в Битриксе такого контакта нет, а создавать контакты правило не разрешает
            bx_id = bx_id or self._add(company_id, row, manager_id)
            self._join(company_id, bx_id)
            self.remember(self.links, client, row, bx_id, company_id, comm)
            out.append(str(bx_id))
        return out

    @staticmethod
    def comm(row: dict) -> dict:
        """Телефон и почта контакта в сравнимом виде (что уже отправлено в Битрикс)."""
        return {'phone': ContactKey.phone(row.get('phone')), 'email': ContactKey.email(row.get('email'))}

    def _fill_comm(self, client: dict, row: dict, link: dict) -> None:
        """Телефон и почту, дописанные в программе после отправки контакта, — в контакт Битрикса (чего там ещё нет и что
        не записано у другого контакта)."""
        sent = dict((link.get('sent') or {}).get('comm') or {})
        now = self.comm(row)
        if all(not value or sent.get(key) == value for key, value in now.items()):
            return
        found = self.api.call('crm.contact.get', {'id': link['bx']}) or {}
        have = {
            'phone': {
                ContactKey.phone(item.get('VALUE')) for item in found.get('PHONE') or [] if isinstance(item, dict)
            },
            'email': {
                ContactKey.email(item.get('VALUE')) for item in found.get('EMAIL') or [] if isinstance(item, dict)
            },
        }
        find = BitrixCompanyFind(self.api)
        fields = {
            kind: [{'VALUE': str(row.get(key) or '').strip(), 'VALUE_TYPE': 'WORK'}]
            for key, kind in (('phone', 'PHONE'), ('email', 'EMAIL'))
            if now[key]
            and now[key] not in have[key]
            and not set(find.owners('CONTACT', kind, str(row.get(key) or '').strip())) - {str(link['bx'])}
        }
        if fields:
            self.api.call('crm.contact.update', {'id': link['bx'], 'fields': fields})
        self.links.put(
            'file', self.person_key(client, row), link['bx'], dict(link.get('sent') or {}, comm={**sent, **now})
        )

    @staticmethod
    def person_key(client: dict, row: dict) -> str:
        return 'person|{}|{}'.format(client.get('id') or '', ' '.join(ContactKey.words(row.get('name'))))

    @classmethod
    def remember(cls, links, client: dict, row: dict, bx_id: Any, company_id: Any, comm: dict | None = None) -> None:
        """Контакт уже есть в Битриксе (создан с компанией или найден) — повторно не создаётся."""
        data: dict[str, Any] = {'company': str(company_id)}
        if comm:
            data['comm'] = comm
        links.put('file', cls.person_key(client, row), str(bx_id), data)

    def _find(self, row: dict) -> tuple[str, bool]:
        """(контакт Битрикса с тем же телефоном или почтой и тем же ФИО, телефон или почта у другого человека)."""
        find = BitrixCompanyFind(self.api)
        ids: list[str] = []
        for kind, value in (('PHONE', row.get('phone')), ('EMAIL', row.get('email'))):
            if value:
                ids += [x for x in find.owners('CONTACT', kind, str(value).strip()) if x not in ids]
        if not ids:
            return '', False
        people = self.api.list(
            'crm.contact.list',
            {'filter': {'ID': ids}, 'select': ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME']},
            limit=len(ids),
        )
        same = [str(person['ID']) for person in people if self.same_person(row.get('name'), person)]
        return (same[0], False) if same else ('', True)

    @staticmethod
    def same_person(name: Any, person: dict) -> bool:
        """ФИО совпадает: общих слов не меньше двух (или всё имя, если в одном из ФИО одно слово)."""
        ours = set(ContactKey.words(name))
        theirs = set(
            ContactKey.words(' '.join(str(person.get(key) or '') for key in ('LAST_NAME', 'NAME', 'SECOND_NAME')))
        )
        common = ours & theirs
        return bool(common) and len(common) >= min(2, len(ours), len(theirs))

    def _add(self, company_id: str, row: dict, manager_id: str | None) -> str:
        parts = str(row['name']).split()
        fields: dict[str, Any] = {
            'LAST_NAME': parts[0] if len(parts) > 1 else '',
            'NAME': ' '.join(parts[1:]) if len(parts) > 1 else parts[0],
            'POST': row.get('post') or '',
            'COMPANY_ID': company_id,
            'OPENED': 'Y',
            'PHONE': [{'VALUE': row['phone'], 'VALUE_TYPE': 'WORK'}] if row.get('phone') else [],
            'EMAIL': [{'VALUE': row['email'], 'VALUE_TYPE': 'WORK'}] if row.get('email') else [],
        }
        user = self.sync._user_of(manager_id)
        if user:
            fields['ASSIGNED_BY_ID'] = user
        return str(self.api.call('crm.contact.add', {'fields': fields}))

    def _join(self, company_id: str, contact_id: str) -> None:
        """Связка контакта с компанией (у найденного контакта её могло не быть)."""
        try:
            self.api.call('crm.company.contact.add', {'id': company_id, 'fields': {'CONTACT_ID': contact_id}})
        except Exception:
            return

    def _pdf(self, word: tuple | None) -> tuple | None:
        """PDF рядом с Word-файлом КП: создать, если его ещё нет (не вышло — уйдёт Word)."""
        if not word or not isinstance(word[1], str):
            return None
        import pdf_convert
        from counterparty import Counterparties

        pdf = os.path.splitext(word[1])[0] + '.pdf'
        try:
            pdf_convert.convert_file(word[1], pdf, Counterparties(self.store).keys().get('convertapiKey'))
        except Exception:
            return None
        return (os.path.basename(pdf), pdf) if os.path.isfile(pdf) else None

    def bind_deal(self, did: str, bid: str, contact_id: str) -> None:
        key = f'dealperson|{did}'
        link = self.links.get('file', key)
        if link and link['bx'] == contact_id:
            return
        self.api.call(
            'crm.deal.contact.items.set', {'id': bid, 'items': [{'CONTACT_ID': contact_id, 'IS_PRIMARY': 'Y'}]}
        )
        self.links.put('file', key, contact_id, {'deal': bid})

    def tkp(self, deal: dict, bid: str, kps: list, field: dict | None) -> None:
        """Файл последнего КП (PDF, иначе Word) — в поле «ТКП / счёт» сделки Битрикса; новое КП — новый файл."""
        if not field or not kps:
            return
        offer = kps[0]
        files = {what: (name, path) for name, path, what in self.sync.files(offer['id'])}
        picked = files.get(self.PDF) or self._pdf(files.get(self.WORD)) or files.get(self.WORD)
        if not picked:
            return
        name, path = picked
        key = f'tkp|{deal["id"]}'
        link = self.links.get('file', key)
        if link and link['sent'].get('name') == name and link['sent'].get('kp') == offer['id']:
            return
        try:
            data = path if isinstance(path, bytes) else Path(path).read_bytes()
        except OSError:
            return
        value: Any = {'fileData': [name, base64.b64encode(data).decode('ascii')]}
        self.api.call(
            'crm.deal.update', {'id': bid, 'fields': {field['code']: [value] if field.get('multiple') else value}}
        )
        self.links.put('file', key, bid, {'name': name, 'kp': offer['id']})
