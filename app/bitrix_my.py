"""Наши компании Битрикс24 (реквизиты продавца в сделке, MYCOMPANY_ID): список с портала и выбор по умолчанию."""

import re
from typing import Any

from kp_track import Val


class MyCompanies:
    """Компании портала с отметкой «моя компания»; по умолчанию — выбранная в «Настройках», иначе ПНЕВМОТЕХ."""

    KEY = 'bitrix.my'
    PREFER = re.compile(r'пневмотех', re.IGNORECASE)
    ID_RE = re.compile(r'^\d{1,12}$')
    TITLE_MAX = 200
    LIST_MAX = 50

    def __init__(self, store) -> None:
        self.store = store

    def all(self) -> list[dict]:
        rows = (self.store.kv_get(self.KEY) or {}).get('list')
        return [row for row in rows if isinstance(row, dict) and row.get('id')] if isinstance(rows, list) else []

    def load(self, api: Any) -> list[dict]:
        """Загрузить список с портала (crm.company.list, IS_MY_COMPANY = Y) и запомнить."""
        rows = api.list(
            'crm.company.list', {'filter': {'IS_MY_COMPANY': 'Y'}, 'select': ['ID', 'TITLE']}, limit=self.LIST_MAX
        )
        found = [
            {'id': str(row.get('ID')), 'title': str(row.get('TITLE') or row.get('ID'))[: self.TITLE_MAX]}
            for row in rows
            if self.ID_RE.match(str(row.get('ID') or ''))
        ]
        self.store.kv_set(self.KEY, {'list': found, 'at': Val.now()})
        return found

    def default(self, chosen: str) -> str:
        """Компания по умолчанию: выбранная администратором (если она есть в списке), иначе ПНЕВМОТЕХ, иначе — ничего."""
        ids = [row['id'] for row in self.all()]
        if chosen in ids:
            return chosen
        return next((row['id'] for row in self.all() if self.PREFER.search(row['title'])), '')

    @classmethod
    def clean(cls, value: Any) -> str:
        """Ввод: номер компании или пусто. ValueError — с понятным текстом."""
        text = str(value or '').strip()
        if text and not cls.ID_RE.match(text):
            raise ValueError('Наша компания — выберите из списка')
        return text
