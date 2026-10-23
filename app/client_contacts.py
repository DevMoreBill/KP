"""Контакты клиента в карточке клиента: менеджер правит существующий контакт или добавляет новый (без удаления)."""

import re
from typing import Any

from kp_track import Val


class ClientContacts:
    """Список `contacts` клиента из справочника: правка по номеру строки, новый — первым; прочие поля контакта сохраняются."""

    LIMITS = {'name': 120, 'post': 120, 'phone': 40, 'email': 200}
    PHONE_MIN = 10
    PHONE_MAX = 15
    MAX = 30

    def __init__(self, store) -> None:
        self.store = store

    def save(self, cid: str, index: Any, raw: Any, author: str) -> list[dict]:
        """Записать контакт: `index` — номер в списке (правка) или None (новый). ValueError — понятным текстом."""
        client = self.store.client_get(cid)
        if not isinstance(client, dict) or not client:
            raise LookupError('Клиент не найден в справочнике — сначала сохраните КП с этим клиентом')
        person = self.clean(raw)
        rows = [dict(row) for row in client.get('contacts') or [] if isinstance(row, dict)]
        spot = self._spot(rows, index)
        self._unique(rows, person['name'], spot)
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
        if person['email'] and not Val.email(person['email']):
            raise ValueError('Почта указана с ошибкой')
        return person

    @staticmethod
    def _spot(rows: list[dict], index: Any) -> int | None:
        if index is None or index == '':
            return None
        try:
            spot = int(index)
        except (TypeError, ValueError):
            raise ValueError('Контакт не найден — обновите карточку клиента') from None
        if not 0 <= spot < len(rows):
            raise ValueError('Контакт не найден — обновите карточку клиента')
        return spot

    @staticmethod
    def _unique(rows: list[dict], name: str, spot: int | None) -> None:
        key = re.sub(r'\s+', ' ', name).strip().lower()
        for pos, row in enumerate(rows):
            if pos != spot and re.sub(r'\s+', ' ', str(row.get('name') or '')).strip().lower() == key:
                raise ValueError(f'Контакт «{name}» уже есть — исправьте его')
