"""Производственный календарь РФ (isdayoff.ru, резерв xmlcalendar.ru) с кэшем в kv «workcal:<год>»."""

import json
import time
from datetime import date, timedelta

from cbr import http_get

WEEKDAYS = 5
YEAR_MIN = 2000
YEAR_MAX = 2100

REFRESH = 30 * 86400
RETRY = 3600
_FAILED: dict[int, float] = {}
APPROX_SRC = 'приблизительно: выходные и праздники без переносов (нет связи с календарём)'
# нерабочие праздничные дни (ст. 112 ТК РФ): месяц, день
HOLIDAYS = [(1, day) for day in range(1, 9)] + [(2, 23), (3, 8), (5, 1), (5, 9), (6, 12), (11, 4)]


def _days_in_year(y: int) -> int:
    return (date(y + 1, 1, 1) - date(y, 1, 1)).days


def parse_isdayoff(text: str, y: int) -> tuple[str, str]:
    """(нерабочие, сокращённые); у isdayoff «2» — сокращённый предпраздничный день."""
    clean = text.strip()
    if len(clean) != _days_in_year(y) or set(clean) - set('01248'):
        raise ValueError('isdayoff: неожиданный ответ')
    return ''.join('1' if char == '1' else '0' for char in clean), ''.join(
        '1' if char == '2' else '0' for char in clean
    )


def parse_xmlcalendar(obj: dict, y: int) -> tuple[str, str]:
    off, short = set(), set()
    for month in obj.get('months') or []:
        for part in str(month.get('days') or '').split(','):
            tok = part.strip()
            if not tok:
                continue
            if tok.endswith('*'):
                short.add((int(month['month']), int(tok.rstrip('*'))))
                continue
            off.add((int(month['month']), int(tok.rstrip('+'))))
    if not off:
        raise ValueError('xmlcalendar: пустой календарь')
    first = date(y, 1, 1)
    days = [((first + timedelta(i)).month, (first + timedelta(i)).day) for i in range(_days_in_year(y))]
    return ''.join('1' if x in off else '0' for x in days), ''.join('1' if x in short else '0' for x in days)


def approx(y: int) -> str:
    first = date(y, 1, 1)
    out = []
    for i in range(_days_in_year(y)):
        day = first + timedelta(i)
        out.append('1' if day.weekday() >= WEEKDAYS or (day.month, day.day) in HOLIDAYS else '0')
    return ''.join(out)


def year(store, y) -> dict:
    """{year, days — «1» нерабочий, short — «1» сокращённый, src, approx}."""
    y = int(y)
    if not YEAR_MIN <= y <= YEAR_MAX:
        raise ValueError('Год вне диапазона')
    key = f'workcal:{y}'
    cached = store.kv_get(key)
    if cached and time.time() - cached.get('fetched', 0) < REFRESH and 'short' in cached:
        return cached
    if time.time() - _FAILED.get(y, 0) < RETRY:
        return cached or {'year': y, 'days': approx(y), 'src': APPROX_SRC, 'approx': True}
    errs = []
    for src, url, parse in (
        (
            'isdayoff.ru',
            f'https://isdayoff.ru/api/getdata?year={y}&cc=ru',
            lambda raw: parse_isdayoff(raw.decode('utf-8'), y),
        ),
        (
            'xmlcalendar.ru',
            f'https://xmlcalendar.ru/data/ru/{y}/calendar.json',
            lambda raw: parse_xmlcalendar(json.loads(raw.decode('utf-8-sig')), y),
        ),
    ):
        try:
            days, short = parse(http_get(url))
            rec = {
                'year': y,
                'days': days,
                'short': short,
                'src': f'производственный календарь ({src})',
                'approx': False,
                'fetched': time.time(),
            }
            store.kv_set(key, rec)
            return rec
        except Exception as exc:
            errs.append(f'{src}: {exc}')
    _FAILED[y] = time.time()
    if cached:
        return cached
    return {'year': y, 'days': approx(y), 'src': APPROX_SRC, 'approx': True, 'error': '; '.join(errs)[:300]}
