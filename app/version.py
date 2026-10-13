# -*- coding: utf-8 -*-
"""Версия программы. Увеличивается с каждым выпуском; обновление (патч) применяется, только если его версия новее."""
VERSION = '3.86.2'


def as_tuple(v):
    try:
        return tuple(int(x) for x in str(v).strip().split('.')[:4])
    except ValueError:
        return (0,)
