"""Клиент по контакту: телефон, e-mail, ФИО контактного лица — для поиска, новой сделки и сделок из Битрикс24."""

import json
import re


class ContactKey:
    """Ключи контакта для поиска: телефон — последние 10 цифр, почта — строчными, ФИО — слова."""

    PHONE_DIGITS = 10
    PHONE_MIN = 7
    WORD_MIN = 2
    EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
    PHONE_RE = re.compile(r'^[\d\s()+.\-]+$')

    @classmethod
    def phone(cls, value) -> str:
        digits = re.sub(r'\D', '', str(value or ''))
        return digits[-cls.PHONE_DIGITS :] if len(digits) >= cls.PHONE_MIN else ''

    @classmethod
    def email(cls, value) -> str:
        text = str(value or '').strip().lower()
        return text if cls.EMAIL_RE.match(text) else ''

    @classmethod
    def words(cls, value) -> list[str]:
        text = re.sub(r'[^a-zа-я\s-]', ' ', str(value or '').lower().replace('ё', 'е'))
        return [word for word in text.split() if len(word) >= cls.WORD_MIN]

    @classmethod
    def kind(cls, text) -> str:
        """Что ввели: «email», «phone», «name» или пусто."""
        value = str(text or '').strip()
        if cls.email(value):
            return 'email'
        if cls.PHONE_RE.match(value) and cls.phone(value):
            return 'phone'
        return 'name' if len(cls.words(value)) >= 1 else ''

    @classmethod
    def contacts(cls, doc) -> list[dict]:
        """Контакты клиента (список «contacts») и его собственные телефон и почта."""
        data = doc if isinstance(doc, dict) else {}
        rows = [row for row in (data.get('contacts') or []) if isinstance(row, dict)]
        own = {key: data.get(key) for key in ('phone', 'email') if data.get(key)}
        return [*rows, own] if own else rows

    @classmethod
    def search_text(cls, doc) -> str:
        """Добавка к строке поиска клиента: имена, телефоны (10 цифр) и почта контактов."""
        parts: list[str] = []
        for row in cls.contacts(doc):
            parts += [str(row.get('name') or ''), cls.phone(row.get('phone')), cls.email(row.get('email'))]
            parts += [cls.phone(row.get('mobile'))]
        return ' '.join(part for part in parts if part)


class ClientMatch:
    """Поиск клиентов по контакту и отметка, чем совпал (телефон, почта, ФИО — какого контакта)."""

    LIMIT = 8
    MATCHED_BY = {'phone': 'телефон', 'email': 'e-mail', 'name': 'контакт'}

    def __init__(self, store) -> None:
        self.store = store

    def find(self, text, limit: int = LIMIT) -> list[dict]:
        """Клиенты, у которых есть такой контакт: [{id, name, inn, by, contact}]."""
        kind = ContactKey.kind(text)
        if not kind:
            return []
        key = self._key(kind, text)
        if not key:
            return []
        rows = self.store.all(
            "SELECT doc FROM clients WHERE search LIKE ? ESCAPE '\\' ORDER BY used_at DESC, updated DESC LIMIT ?",
            ('%' + re.sub(r'([%_\\])', r'\\\1', key) + '%', limit * 4),
        )
        out = []
        for (doc,) in rows:
            client = json.loads(doc)
            contact = self.contact_of(client, kind, text)
            if contact is not None:
                out.append(self._card(client, kind, contact))
        return out[:limit]

    def any_of(self, phones=(), emails=(), names=()) -> list[dict]:
        """Клиенты по любому из контактов (без повторов) — для компании и контакта Битрикс24."""
        found: dict[str, dict] = {}
        queries = [*phones, *emails, *names]
        for query in queries:
            for card in self.find(query):
                found.setdefault(card['id'], card)
        return list(found.values())

    @staticmethod
    def _key(kind, text) -> str:
        keys = {
            'phone': ContactKey.phone,
            'email': ContactKey.email,
            'name': lambda value: ' '.join(ContactKey.words(value)),
        }
        return keys[kind](text)

    @staticmethod
    def contact_of(client, kind, text) -> dict | None:
        """Контакт клиента, совпавший с запросом, или None."""
        for row in ContactKey.contacts(client):
            if ClientMatch._same(row, kind, text):
                return row
        return None

    @staticmethod
    def _same(row, kind, text) -> bool:
        if kind == 'phone':
            want = ContactKey.phone(text)
            return want in {ContactKey.phone(row.get('phone')), ContactKey.phone(row.get('mobile'))}
        if kind == 'email':
            return ContactKey.email(row.get('email')) == ContactKey.email(text)
        wanted = ContactKey.words(text)
        have = ContactKey.words(row.get('name'))
        return bool(wanted) and all(any(word.startswith(part) for word in have) for part in wanted)

    def _card(self, client, kind, contact) -> dict:
        return {
            'id': client.get('id') or '',
            'name': client.get('name') or '',
            'inn': client.get('inn') or '',
            'by': self.MATCHED_BY[kind],
            'contact': {key: contact.get(key) or '' for key in ('name', 'post', 'phone', 'email')},
        }
