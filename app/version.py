"""Версия программы; пакет обновления применяется, только если его версия новее."""

VERSION = '3.179.0'


def as_tuple(v) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in str(v).strip().split('.')[:4])
    except ValueError:
        return (0,)
