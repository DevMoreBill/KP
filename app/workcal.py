# -*- coding: utf-8 -*-
"""Производственный календарь РФ (рабочие = банковские дни) для графика платежей «Экономики сделки».

Источники (открытые, без ключа): isdayoff.ru (строка 0/1 на каждый день года), резерв — xmlcalendar.ru
(список нерабочих дней по месяцам, «*» — сокращённый рабочий день, «+» — перенесённый выходной).
Результат хранится в базе (kv «workcal:<год>»), обновляется раз в 30 дней. Нет связи и нет сохранённого —
приблизительный календарь: суббота, воскресенье и праздники ст. 112 ТК РФ, без переносов.
"""
import json
import time
from datetime import date, timedelta

from cbr import http_get

REFRESH = 30 * 86400
RETRY = 3600                    # нет связи — повторная попытка не раньше чем через час
_FAILED = {}
# нерабочие праздничные дни (ст. 112 ТК РФ): месяц, день
HOLIDAYS = [(1, d) for d in range(1, 9)] + [(2, 23), (3, 8), (5, 1), (5, 9), (6, 12), (11, 4)]


def _days_in_year(y):
    return (date(y + 1, 1, 1) - date(y, 1, 1)).days


def parse_isdayoff(text, y):
    """(нерабочие, сокращённые): по строке '0'/'1' на каждый день; у isdayoff '2' — сокращённый предпраздничный день."""
    s = text.strip()
    if len(s) != _days_in_year(y) or set(s) - set('01248'):
        raise ValueError('isdayoff: неожиданный ответ')
    return ''.join('1' if ch == '1' else '0' for ch in s), ''.join('1' if ch == '2' else '0' for ch in s)


def parse_xmlcalendar(obj, y):
    off, short = set(), set()
    for m in obj.get('months') or []:
        for tok in str(m.get('days') or '').split(','):
            tok = tok.strip()
            if not tok:
                continue
            if tok.endswith('*'):
                short.add((int(m['month']), int(tok.rstrip('*'))))
                continue
            off.add((int(m['month']), int(tok.rstrip('+'))))
    if not off:
        raise ValueError('xmlcalendar: пустой календарь')
    d0 = date(y, 1, 1)
    md = [((d0 + timedelta(i)).month, (d0 + timedelta(i)).day) for i in range(_days_in_year(y))]
    return ''.join('1' if x in off else '0' for x in md), ''.join('1' if x in short else '0' for x in md)


def approx(y):
    d0 = date(y, 1, 1)
    out = []
    for i in range(_days_in_year(y)):
        d = d0 + timedelta(i)
        out.append('1' if d.weekday() >= 5 or (d.month, d.day) in HOLIDAYS else '0')
    return ''.join(out)


def year(store, y):
    """{year, days: строка '0'/'1' (1 — нерабочий), short: '1' — сокращённый предпраздничный, src, approx}"""
    y = int(y)
    if not 2000 <= y <= 2100:
        raise ValueError('Год вне диапазона')
    key = 'workcal:%d' % y
    cached = store.kv_get(key)
    # сохранённый прежней версией (без сокращённых дней) — обновить при первой возможности
    if cached and time.time() - cached.get('fetched', 0) < REFRESH and 'short' in cached:
        return cached
    if time.time() - _FAILED.get(y, 0) < RETRY:
        return cached or {'year': y, 'days': approx(y), 'src': 'приблизительно: выходные и праздники без переносов (нет связи с календарём)', 'approx': True}
    errs = []
    for src, url, parse in (
            ('isdayoff.ru', 'https://isdayoff.ru/api/getdata?year=%d&cc=ru' % y, lambda b: parse_isdayoff(b.decode('utf-8'), y)),
            ('xmlcalendar.ru', 'https://xmlcalendar.ru/data/ru/%d/calendar.json' % y, lambda b: parse_xmlcalendar(json.loads(b.decode('utf-8-sig')), y))):
        try:
            days, short = parse(http_get(url))
            rec = {'year': y, 'days': days, 'short': short, 'src': 'производственный календарь (%s)' % src, 'approx': False, 'fetched': time.time()}
            store.kv_set(key, rec)
            return rec
        except Exception as e:
            errs.append('%s: %s' % (src, e))
    _FAILED[y] = time.time()
    if cached:
        return cached
    return {'year': y, 'days': approx(y), 'src': 'приблизительно: выходные и праздники без переносов (нет связи с календарём)',
            'approx': True, 'error': '; '.join(errs)[:300]}
