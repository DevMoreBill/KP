"""Телефон в одном виде: российский номер — «+7 (900) 123-45-67», добавочный — « доб. 12», иностранный — «+» и цифры."""

import re
from typing import Any


class Phone:
    """Как бы ни ввели номер — «8 900 123 45 67», «(900)1234567», «+7-900-123-45-67» — в базу он ложится одинаково."""

    NATIONAL = 10  # цифр в российском номере без +7
    WITH_CODE = 11  # с 7 или 8 впереди
    TRUNK = ('7', '8')
    KEYS = frozenset({'phone', 'mobile', 'phones'})
    DEPTH = 4  # телефоны лежат в контактах и складах карточки, глубже — не телефоны
    EXTENSION = re.compile(r'\s*(?:,|;)?\s*(?:доб(?:авочный)?|вн(?:утр(?:енний)?)?|ext)\.?\s*:?\s*(\d{1,6})\s*$', re.I)
    NUMBER = re.compile(r'^\+?[\d\s()\-.]+$')

    @classmethod
    def format(cls, value: Any) -> str:
        """Номер в одном виде; не похожее на номер (короткий городской, текст) — как ввели, без лишних пробелов."""
        text = re.sub(r'\s+', ' ', str(value or '')).strip()
        found = cls.EXTENSION.search(text)
        number = text[: found.start()].strip() if found else text
        extension = f' доб. {found.group(1)}' if found else ''
        if not cls.NUMBER.match(number):
            return text
        digits = re.sub(r'\D', '', number)
        foreign = number.startswith('+') and not number.startswith('+7')
        national = '' if foreign else cls._national(digits)
        if national:
            return f'+7 ({national[:3]}) {national[3:6]}-{national[6:8]}-{national[8:]}{extension}'
        if number.startswith('+') and digits:
            return f'+{digits}{extension}'
        return text

    @classmethod
    def _national(cls, digits: str) -> str:
        if len(digits) == cls.WITH_CODE and digits[0] in cls.TRUNK:
            return digits[1:]
        return digits if len(digits) == cls.NATIONAL else ''

    @classmethod
    def doc(cls, data: Any, depth: int = 0) -> Any:
        """Документ справочника с телефонами в одном виде (phone, mobile, phones — в карточке, контактах, складах)."""
        if depth > cls.DEPTH:
            return data
        if isinstance(data, list):
            return [cls.doc(item, depth + 1) for item in data]
        if not isinstance(data, dict):
            return data
        return {key: cls._value(key, value, depth) for key, value in data.items()}

    @classmethod
    def _value(cls, key: str, value: Any, depth: int) -> Any:
        if key not in cls.KEYS:
            return cls.doc(value, depth + 1)
        if isinstance(value, list):
            return [cls.format(item) if isinstance(item, str) else item for item in value]
        return cls.format(value) if isinstance(value, str) else value
