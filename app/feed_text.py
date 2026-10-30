"""Текст и числа из фидов и страниц поставщиков: текст из HTML, разбор числа."""

import math
import re


def parse_number(v) -> float | None:
    """Число из фида; «nan», «inf» и прочее не число — None (иначе в карточку попало бы Infinity, а NaN ронял проверку фида)."""
    try:
        num = float(re.sub(r'[\s\xa0]', '', str(v)).replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) else None


def _html_text(text) -> str:
    """Описание из фида (часто HTML) → обычный текст с абзацами."""
    text = re.sub(r'(?i)<\s*(br|/p|/div|/li|/h\d)\s*/?>', '\n', str(text or ''))
    text = re.sub(r'(?i)<li[^>]*>', '• ', text)
    text = re.sub(r'<[^>]+>', '', text)
    for pattern, repl in (
        ('&nbsp;', ' '),
        ('&laquo;', '«'),
        ('&raquo;', '»'),
        ('&mdash;', '—'),
        ('&ndash;', '–'),
        ('&quot;', '"'),
        ('&amp;', '&'),
        ('&lt;', '<'),
        ('&gt;', '>'),
        ('&#039;', "'"),
    ):
        text = text.replace(pattern, repl)
    text = re.sub(r'\s*(?:\b(?:в|во|на|по)\s+)?#[A-Z0-9_]+#', '', text)  # шаблоны сайта: «в #REGION_NAME_DECLINE_PP#»
    lines = [re.sub(r'[ \t\xa0]+', ' ', x).strip() for x in text.split('\n')]
    return '\n'.join(x for x in lines if x)[:6000]
