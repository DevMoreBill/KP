"""Суммы в тексте сервера: «12 346 ₽» — разряды через пробел, без копеек; одна запись на всю программу."""


class Money:
    """Деньги текстом — в письмах, обмене с Битрикс24, проверках контрагентов и подключениях."""

    @staticmethod
    def whole(value: float) -> str:
        """12345.6 → «12 346»: целое, разряды через пробел."""
        return f'{value:,.0f}'.replace(',', ' ')

    @classmethod
    def rub(cls, value: float) -> str:
        """12345.6 → «12 346 ₽»."""
        return f'{cls.whole(value)} ₽'

    @staticmethod
    def rub_unbroken(value: float) -> str:
        """12345.6 → «12 346 ₽» с неразрывными пробелами в разрядах — строка не разрывается."""
        return f'{value:,.0f} ₽'.replace(',', '\u00a0')
