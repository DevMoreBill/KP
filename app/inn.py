"""ИНН: цифры из любого ввода — одна очистка на весь сервер."""

import re


class Inn:
    """ИНН из ввода, базы и ответов сервисов."""

    NOT_DIGIT = re.compile(r'\D')
    MAX = 12  # ИНН физического лица; у организации — 10

    @classmethod
    def digits(cls, value: object) -> str:
        """Только цифры значения (пусто и None — '')."""
        return cls.NOT_DIGIT.sub('', str(value or ''))

    @classmethod
    def key(cls, value: object) -> str:
        """Цифры, не длиннее 12, — так ИНН хранится в базе и сравнивается."""
        return cls.digits(value)[: cls.MAX]
