# -*- coding: utf-8 -*-
"""Подготовка данных при запуске: папки, признак новой базы, сверка нумерации КП с файлами."""
import os
import re
from datetime import datetime

from config import DATA_DIR, DOCS_DIR, IMG_DIR, store


def prepare_dirs():
    for d in (DATA_DIR, IMG_DIR, DOCS_DIR):
        os.makedirs(d, exist_ok=True)


def sync_counter_with_files():
    """Номер КП не должен повторить уже существующий файл (например, если базу восстановили из старой копии)."""
    year = datetime.now().year
    top = 0
    for _, _, files in os.walk(DOCS_DIR):
        for name in files:
            m = re.match(r'^(\d{4})-(\d{3,})_', name)
            if m and int(m.group(1)) == year:
                top = max(top, int(m.group(2)))
    if top:
        store().ensure_counter_at_least(year, top)


class FreshBase:
    """Новая пустая база (первый запуск на новом компьютере). Каталог и фото в EXE не входят — они хранятся
    в базе на сервере отдела; на новый компьютер переносятся файлом базы («Настройки» → «Обслуживание»)."""

    @staticmethod
    def check():
        return not store().catalog_count()
