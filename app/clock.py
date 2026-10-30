"""Время сервера: метка «сейчас» до секунды — одна на всю программу."""

from datetime import datetime


class Clock:
    """Метки времени сервера."""

    @staticmethod
    def now() -> str:
        """Сейчас — «ГГГГ-ММ-ДДTчч:мм:сс», местное время сервера без долей секунды."""
        return datetime.now().isoformat(timespec='seconds')
