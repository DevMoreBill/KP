"""Число из текста: «1 234,5», «1234.5», «1e5» — одно правило на весь сервер (ввод, файлы, ответы сервисов)."""

import math
import re


class Num:
    """Разбор числа: пробелы любые (обычный, неразрывный, узкий, табуляция) не важны, запятая — десятичный знак; только
    цифры 0–9, знак, точка и порядок; «inf», «nan», «1_000», «12,5 %», «1.234,5» и логическое значение — не число."""

    SPACE = re.compile(r'\s+')
    FORMAT = re.compile(r'[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?', re.ASCII)

    @classmethod
    def parse(cls, value: object) -> float | None:
        """Число или None (пусто, не число, бесконечность)."""
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return cls._finite(value)
        text = cls.SPACE.sub('', str(value)).replace(',', '.')
        return cls._finite(float(text)) if cls.FORMAT.fullmatch(text) else None

    @classmethod
    def of(cls, text: object) -> float:
        """Число из текста, найденного как число (часть выражения); не число — ValueError."""
        number = cls.parse(text)
        if number is None:
            raise ValueError(f'не число: {text!r}')
        return number

    @staticmethod
    def _finite(value: float) -> float | None:
        try:
            number = float(value)
        except OverflowError:  # целое больше, чем помещается в float
            return None
        return number if math.isfinite(number) else None
