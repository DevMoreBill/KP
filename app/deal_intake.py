"""Заявка из письма или ТЗ: клиент (ИНН, название), контакт, тема, запрошенные бренд и товар, модели каталога.

Правилами — всегда; нейросеть, если её включил администратор, уточняет название, контакт и суть. ИНН, телефон и почта
берутся только такими, какие есть в тексте (ответ нейросети без них не принимается).
"""

import json
import re
from collections import Counter
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr
from html import unescape
from itertools import pairwise
from typing import Any

from client_match import ClientMatch, ContactKey
from crm_funnels import DealFields
from deal_autofill import FieldKind, ListMatch, Words
from deal_rules import DealRegs
from doc_text import DocText
from kp_track import Val


class MailText:
    """Письмо .eml: тема, отправитель, текст (без цитаты ответа) и текст вложенных документов."""

    ATTACH_MAX = 3
    QUOTE = re.compile(r'^\s*(>|-{2,}\s*(original|исходное|пересылаемое)|(от|from):\s.+(отправлено|sent)?)', re.I)

    @classmethod
    def read(cls, data: bytes) -> dict:
        msg = BytesParser(policy=policy.default).parsebytes(data)
        if not isinstance(msg, EmailMessage):
            raise ValueError('письмо не прочитано')
        name, address = parseaddr(str(msg.get('From') or ''))
        parts = [cls._body(msg)]
        for part in list(msg.iter_attachments())[: cls.ATTACH_MAX]:
            parts.append(cls._attachment(part))
        return {
            'subject': str(msg.get('Subject') or '').strip(),
            'name': name.strip(),
            'email': address.strip().lower(),
            'text': '\n\n'.join(text for text in parts if text),
        }

    @classmethod
    def _body(cls, msg: EmailMessage) -> str:
        part = msg.get_body(preferencelist=('plain', 'html'))
        if part is None:
            return ''
        text = str(part.get_content())
        if part.get_content_type() == 'text/html':
            text = unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?i)<br\s*/?>|</p>', '\n', text)))
        return cls.unquoted(text)

    @classmethod
    def unquoted(cls, text: str) -> str:
        """Текст до цитаты ответа («> …», «От: … Отправлено: …»)."""
        lines = []
        for line in text.splitlines():
            if cls.QUOTE.match(line):
                break
            lines.append(line)
        return '\n'.join(lines).strip()

    @staticmethod
    def _attachment(part: Any) -> str:
        try:
            doc = DocText.extract(str(part.get_filename() or 'file')[:200], part.get_content())
        except Exception:  # вложение не документ (картинка, архив) — без него
            return ''
        return str(doc.get('text') or '')


class IntakeRules:
    """Что можно найти в тексте правилами."""

    INN = re.compile(r'ИНН\D{0,12}?(\d{12}|\d{10})(?!\d)', re.I)
    EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
    PHONE = re.compile(r'(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?:\s*(?:доб|вн)\.?\s*\d{1,5})?')
    COMPANY = re.compile(r'\b(ООО|АО|ПАО|ЗАО|ОАО|ИП|ФГУП|МУП|ГУП|ФГБУ|ГБУ)\s*[«"“]([^»"”\n]{2,80})[»"”]', re.I)
    SIGN = re.compile(r'(?:[Сс] уважением|[Сс]пасибо)[,!.]?\s*\n\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё.]+){1,2})')
    FIO = re.compile(r'^[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё.]+){1,2}$')
    FREE_MAIL = (
        'gmail.',
        'mail.ru',
        'yandex.',
        'ya.ru',
        'bk.ru',
        'inbox.ru',
        'list.ru',
        'rambler.',
        'outlook.',
        'icloud.',
    )
    LINE_MAX = 200
    TOPIC_MIN = 3

    def __init__(self, own_emails: set[str], own_phones: set[str], own_domains: set[str]) -> None:
        self.own_emails = own_emails
        self.own_phones = own_phones
        self.own_domains = own_domains

    def inn(self, text: str) -> str:
        found = self.INN.search(text)
        return found.group(1) if found else ''

    def emails(self, text: str) -> list[str]:
        out = []
        for raw in self.EMAIL.findall(text):
            email = raw.lower().strip('.')
            if email in self.own_emails or email.split('@')[-1] in self.own_domains:
                continue
            out.append(email)
        return list(dict.fromkeys(out))

    def phones(self, text: str) -> list[str]:
        return list(
            dict.fromkeys(
                raw.strip() for raw in self.PHONE.findall(text) if ContactKey.phone(raw) not in self.own_phones
            )
        )

    def company(self, text: str) -> str:
        found = self.COMPANY.search(text)
        return f'{found.group(1).upper()} «{found.group(2).strip()}»' if found else ''

    def person(self, text: str) -> str:
        found = self.SIGN.search(text)
        return found.group(1).strip() if found else ''

    def topic(self, text: str) -> str:
        for raw in text.splitlines():
            line = raw.strip()
            if len(line) > self.TOPIC_MIN and not re.match(r'(?i)(добрый|здравствуй|уважаем|привет)', line):
                return line[: self.LINE_MAX]
        return ''


class CatalogPick:
    """Модели каталога, названные в тексте: код модели (буквы и цифры) — в тексте, без пробелов и дефисов."""

    LATIN = str.maketrans('АВЕКМНОРСТХУ', 'ABEKMHOPCTXY')
    KEY_MIN = 3
    SHOWN = 6

    def __init__(self, items: list[dict]) -> None:
        self.items = items

    @classmethod
    def key(cls, text: str) -> str:
        return re.sub(r'[\s\-_./,()]+', '', str(text or '').upper().translate(cls.LATIN))

    def _codes(self, name: str) -> list[str]:
        words = re.split(r'\s+', str(name or ''))
        codes = [word for word in words if re.search(r'\d', word)]
        pairs = [f'{one}{two}' for one, two in pairwise(words) if re.search(r'\d', two)]
        return [self.key(code) for code in [*pairs, *codes] if len(self.key(code)) >= self.KEY_MIN]

    def models(self, text: str) -> list[dict]:
        compact = self.key(text)
        scored = []
        for item in self.items:
            hits = [code for code in self._codes(item.get('name') or '') if code in compact]
            if hits:
                scored.append((max(len(code) for code in hits), item))
        scored.sort(key=lambda row: -row[0])
        return [self._row(item) for _score, item in scored[: self.SHOWN]]

    @staticmethod
    def _row(item: dict) -> dict:
        attrs = item['attrs'] if isinstance(item.get('attrs'), dict) else {}
        return {'id': item.get('id'), 'name': item.get('name') or '', 'maker': str(attrs.get('maker') or '')}

    def makers(self, text: str) -> list[str]:
        """Производители каталога, названные в тексте целым словом («Atlas Copco» = «atlas-copco»)."""
        low = str(text or '').lower().replace('ё', 'е')
        names = {str((item.get('attrs') or {}).get('maker') or '').strip() for item in self.items}
        return sorted(name for name in names if Words.key(name) and re.search(self._word(name), low))

    @staticmethod
    def _word(name: str) -> str:
        words = re.findall(r'[a-zа-я0-9]+', name.lower().replace('ё', 'е'))
        return r'(?<![a-zа-я0-9])' + r'[\s-]*'.join(map(re.escape, words)) + r'(?![a-zа-я0-9])'


class DealIntake:
    """Разбор заявки → поля новой сделки (менеджер проверяет и правит перед созданием)."""

    NOTE_MAX = 1500
    TEXT_MAX = 20000
    AI_TEXT = 8000
    AI_KEYS = ('company', 'inn', 'person', 'phone', 'email', 'topic', 'brand', 'goods', 'summary')

    def __init__(self, store) -> None:
        self.store = store

    def read(self, name: str, data: bytes) -> dict:
        """Файл заявки → {text, subject, name, email}. ValueError — понятным текстом."""
        try:
            if str(name or '').lower().endswith('.eml'):
                return MailText.read(data)
            doc = DocText.extract(str(name or '')[:200], data)
        except Exception as exc:  # повреждённый или чужой файл — понятным текстом, без трассировки
            raise ValueError(f'Файл не прочитан: {str(exc)[:200]}') from None
        return {'text': str(doc.get('text') or ''), 'subject': '', 'name': '', 'email': ''}

    def parse(self, mail: dict) -> dict:
        """{text, subject?, name?, email?} → поля сделки: клиент, контакт, тема, заметка, бренд, товар, модели."""
        text = str(mail.get('text') or '')[: self.TEXT_MAX]
        if not text.strip() and not mail.get('subject'):
            raise ValueError('Вставьте текст письма или ТЗ, либо выберите файл')
        whole = f'{mail.get("subject") or ""}\n{text}'
        rules = self._rules()
        pick = CatalogPick(self._catalog())
        found = {
            'company': rules.company(whole),
            'inn': rules.inn(whole),
            'person': mail.get('name') if IntakeRules.FIO.match(str(mail.get('name') or '')) else rules.person(text),
            'phone': next(iter(rules.phones(whole)), ''),
            'email': mail.get('email') or next(iter(rules.emails(whole)), ''),
            'topic': str(mail.get('subject') or '') or rules.topic(text),
            'brand': ', '.join(pick.makers(whole)),
            'goods': '',
            'summary': text.strip()[: self.NOTE_MAX],
        }
        neural = self._neural(whole, found)
        found.update(neural)
        models = pick.models(whole)
        if not found['goods'] and models:
            found['goods'] = '; '.join(row['name'] for row in models[:2])
        return {
            **found,
            'ai': bool(neural),
            'client': self._client(found),
            'models': models,
            'uf': self._bitrix_fields(found),
        }

    def _rules(self) -> IntakeRules:
        emails, phones, domains = set(), set(), set()
        for doc in json.loads(self.store.managers_list() or '[]'):
            email = str(doc.get('email') or '').lower()
            if email:
                emails.add(email)
                domain = email.split('@')[-1]
                if not domain.startswith(IntakeRules.FREE_MAIL):
                    domains.add(domain)
            if doc.get('phone'):
                phones.add(ContactKey.phone(str(doc['phone'])))
        return IntakeRules(emails, phones, domains)

    def _catalog(self) -> list[dict]:
        try:
            rows = json.loads(self.store.catalog_light() or '[]')
        except ValueError:
            return []
        return [row for row in rows if isinstance(row, dict) and row.get('name')]

    def _neural(self, text: str, found: dict) -> dict:
        """Уточнение нейросетью (если включена); ИНН, телефон и почта — только из текста."""
        import ai_llm

        if not ai_llm.status(self.store)['enabled']:
            return {}
        prompt = (
            'Это входящая заявка клиента компании-поставщика оборудования (письмо или ТЗ). Верни JSON с ключами: '
            'company (название организации клиента с формой, например ООО «Ромашка»), inn, person (ФИО контактного лица), '
            'phone, email, topic (что нужно клиенту — одной строкой до 120 знаков), brand (запрошенные производители через '
            'запятую), goods (запрошенное оборудование — модели или виды, до 150 знаков), summary (суть заявки для '
            'менеджера: 2–4 предложения, сроки, объект, количество). Данных нет — пустая строка. Наши собственные '
            'реквизиты и подписи сотрудников поставщика не бери.\n\nЗаявка:\n' + text[: self.AI_TEXT]
        )
        try:
            answer = json.loads(re.sub(r'^```(?:json)?|```$', '', ai_llm.AiAsk.ask(self.store, prompt)['text'].strip()))
        except Exception:  # нейросеть недоступна или ответила не JSON — хватит правил
            return {}
        if not isinstance(answer, dict):
            return {}
        out = {
            key: Val.text(answer.get(key), self.NOTE_MAX) for key in self.AI_KEYS if str(answer.get(key) or '').strip()
        }
        digits = re.sub(r'\D', '', text)
        if out.get('inn') and out['inn'] not in digits:
            out.pop('inn')
        if out.get('phone') and ContactKey.phone(out['phone']) not in {
            ContactKey.phone(x) for x in IntakeRules.PHONE.findall(text)
        }:
            out['phone'] = found['phone']
        if out.get('email') and out['email'].lower() not in text.lower():
            out['email'] = found['email']
        return out

    def _client(self, found: dict) -> dict:
        """Клиент из справочника — по ИНН, иначе по телефону или почте; нет — что вписать в поле «Клиент»."""
        inn = found.get('inn') or ''
        card = self.store.client_get(f'inn{inn}') if inn else None
        if not card:
            phones = [found['phone']] if found.get('phone') else []
            emails = [found['email']] if found.get('email') else []
            cards = ClientMatch(self.store).any_of(phones=phones, emails=emails) if phones or emails else []
            card = cards[0] if len(cards) == 1 else None
        if card:
            return {
                'id': card.get('id') or '',
                'name': card.get('name') or '',
                'inn': card.get('inn') or '',
                'known': True,
            }
        return {'id': '', 'name': found.get('company') or '', 'inn': inn, 'known': False}

    def _bitrix_fields(self, found: dict) -> dict:
        """Поля регламента Битрикс24: тема запроса, запрошенные бренд и товар (списки — по совпадению значений)."""
        regs = DealRegs(self.store)
        if not regs.enabled():
            return {}
        codes = regs.codes()
        fields = DealFields(self.store).by_code()
        out: dict[str, Any] = {}
        for key, value in (('topic', found['topic']), ('askBrand', found['brand']), ('askGoods', found['goods'])):
            field = fields.get(codes.get(key) or '')
            if not field or not value:
                continue
            if field.get('type') in FieldKind.LISTS:
                matched = ListMatch(field.get('items') or [], Counter()).best(Words.stems(value))
                if matched:
                    out[field['code']] = matched
            elif field.get('type') in ('string', ''):
                out[field['code']] = value[: self.NOTE_MAX]
        return out

    def attach_contact(self, client_id: str, contact: Any, author: str) -> None:
        """Контакт из заявки — в карточку клиента, если такого там ещё нет (по телефону или почте)."""
        if not client_id or not isinstance(contact, dict):
            return
        client = self.store.client_get(client_id)
        if not client:
            return
        person = self._person(contact)
        if not (person.get('phone') or person.get('email')):
            return
        rows = [dict(row) for row in client.get('contacts') or [] if isinstance(row, dict)]
        for kind in ('phone', 'email'):
            if person.get(kind) and ClientMatch.contact_of(client, kind, person[kind]):
                return
        doc = {key: value for key, value in client.items() if key != '_rev'}
        doc['contacts'] = [*rows, person]
        self.store.client_put(client_id, doc, author)

    @staticmethod
    def _person(contact: dict) -> dict:
        name = Val.text(contact.get('name'), DealRegs.NAME_MAX)
        phone = Val.text(contact.get('phone'), DealRegs.NAME_MAX)
        email = Val.text(contact.get('email'), DealRegs.NAME_MAX).lower()
        digits = re.sub(r'\D', '', phone)
        return {
            'name': name,
            'phone': phone if DealRegs.PHONE_MIN <= len(digits) <= DealRegs.PHONE_MAX else '',
            'email': email if IntakeRules.EMAIL.fullmatch(email) else '',
        }
