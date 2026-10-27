"""Контакты клиента в карточке клиента: менеджер правит, добавляет и удаляет контакт (в Битрикс24 ничего не удаляется)."""

import re
from typing import Any

from kp_track import Val
from phone import Phone


class ClientContacts:
    """Список `contacts` клиента из справочника: правка по номеру строки, новый — первым; прочие поля контакта сохраняются."""

    LIMITS = {'name': 120, 'post': 120, 'phone': 40, 'email': 200}
    PHONE_MIN = 10
    PHONE_MAX = 15
    MAX = 30
    GONE = 'contactsGone'  # удалённые в программе: обмен с Битрикс24 и сохранение КП их не возвращают
    GONE_MAX = 200

    def __init__(self, store) -> None:
        self.store = store

    def save(self, cid: str, target: Any, raw: Any, author: str) -> list[dict]:
        """Записать контакт: `target` — {was: прежнее ФИО} или номер строки (правка), None — новый. ValueError — понятно."""
        with self.store.lock:  # прочитать и записать одним шагом: два менеджера сразу не теряют правки друг друга
            client = self.store.client_get(cid)
            if not isinstance(client, dict) or not client:
                raise LookupError('Клиент не найден в справочнике — сначала сохраните КП с этим клиентом')
            person = self.clean(raw)
            rows = [dict(row) for row in client.get('contacts') or [] if isinstance(row, dict)]
            spot = self._spot(rows, target)
            self._unique(rows, person['name'], spot)
            self._revive(client, person['name'])
            if spot is None:
                if len(rows) >= self.MAX:
                    raise ValueError(f'У клиента уже {self.MAX} контактов — исправьте один из них')
                rows.insert(0, person)
            else:
                rows[spot].update(person)
            doc = {key: value for key, value in client.items() if key != '_rev'}
            doc['contacts'] = rows
            self.store.client_put(cid, doc, author)
        return rows

    def remove(self, cid: str, was: Any, author: str) -> tuple[list[dict], dict]:
        """Удалить контакт по ФИО → (контакты, удалённый). Только в программе: в Битрикс24 контакт остаётся, обмен и
        сохранение КП его больше не добавляют (пока менеджер не впишет такой же контакт сам)."""
        with self.store.lock:
            client = self.store.client_get(cid)
            if not isinstance(client, dict) or not client:
                raise LookupError('Клиент не найден в справочнике')
            rows = [dict(row) for row in client.get('contacts') or [] if isinstance(row, dict)]
            key = self.key(was)
            gone = next((row for row in rows if self.key(row.get('name')) == key), None)
            if not key or gone is None:
                raise ValueError('Контакт уже удалён или изменён — откройте карточку клиента заново')
            doc = {name: value for name, value in client.items() if name != '_rev'}
            doc['contacts'] = [row for row in rows if row is not gone]
            mark = {field: str(gone.get(field) or '') for field in ('name', 'phone', 'email')}
            doc[self.GONE] = [mark, *self.gone(client)][: self.GONE_MAX]
            self.store.client_put(cid, doc, author)
        return doc['contacts'], gone

    @classmethod
    def gone(cls, client: dict) -> list[dict]:
        """Удалённые в программе контакты клиента."""
        rows = client.get(cls.GONE) if isinstance(client, dict) else None
        return [row for row in rows or [] if isinstance(row, dict)]

    @classmethod
    def is_gone(cls, client: dict, person: Any) -> bool:
        """Контакт удалён в программе (по ФИО) — не добавлять его снова автоматически."""
        key = cls.key((person or {}).get('name') if isinstance(person, dict) else '')
        return bool(key) and any(cls.key(row.get('name')) == key for row in cls.gone(client))

    @classmethod
    def _revive(cls, client: dict, name: str) -> None:
        """Менеджер сам вписал контакт с ФИО удалённого — запрет на его возврат снимается."""
        key = cls.key(name)
        if any(cls.key(row.get('name')) == key for row in cls.gone(client)):
            client[cls.GONE] = [row for row in cls.gone(client) if cls.key(row.get('name')) != key]

    def clean(self, raw: Any) -> dict:
        """Поля контакта после проверки: ФИО обязательно, телефон — 10–15 цифр, почта — адрес."""
        if not isinstance(raw, dict):
            raise ValueError('Нет данных контакта')
        person = {field: Val.text(raw.get(field), limit) for field, limit in self.LIMITS.items()}
        if not person['name']:
            raise ValueError('Укажите ФИО контакта')
        digits = re.sub(r'\D', '', person['phone'])
        if person['phone'] and not self.PHONE_MIN <= len(digits) <= self.PHONE_MAX:
            raise ValueError(f'Телефон — от {self.PHONE_MIN} до {self.PHONE_MAX} цифр')
        person['phone'] = Phone.format(person['phone'])
        if person['email'] and not Val.email(person['email']):
            raise ValueError('Почта указана с ошибкой')
        return person

    @classmethod
    def _spot(cls, rows: list[dict], target: Any) -> int | None:
        if isinstance(target, dict) and target.get('was'):
            # по прежнему ФИО: коллега мог тем временем добавить контакт, и номера строк сдвинулись
            was = cls.key(target['was'])
            found = [pos for pos, row in enumerate(rows) if cls.key(row.get('name')) == was]
            if not found:
                raise ValueError('Контакт уже изменили — откройте карточку клиента заново')
            return found[0]
        if target is None or target == '':
            return None
        try:
            spot = int(target)
        except (TypeError, ValueError):
            raise ValueError('Контакт не найден — обновите карточку клиента') from None
        if not 0 <= spot < len(rows):
            raise ValueError('Контакт не найден — обновите карточку клиента')
        return spot

    @staticmethod
    def key(name: Any) -> str:
        """ФИО для сравнения: без лишних пробелов и регистра."""
        return re.sub(r'\s+', ' ', str(name or '')).strip().lower()

    @classmethod
    def _unique(cls, rows: list[dict], name: str, spot: int | None) -> None:
        key = cls.key(name)
        for pos, row in enumerate(rows):
            if pos != spot and cls.key(row.get('name')) == key:
                raise ValueError(f'Контакт «{name}» уже есть — исправьте его')
