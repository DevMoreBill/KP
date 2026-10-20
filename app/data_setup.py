"""Подготовка данных при запуске: папки, признак новой базы, сверка нумерации КП с файлами."""

import os
import re
from datetime import datetime

from config import DATA_DIR, DOCS_DIR, IMG_DIR, store


def prepare_dirs() -> None:
    for d in (DATA_DIR, IMG_DIR, DOCS_DIR):
        os.makedirs(d, exist_ok=True)


def sync_counter_with_files() -> None:
    """Номер КП не повторяет файл в папке КП (база восстановлена из старой копии)."""
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
    """Новая пустая база: каталог и фото не входят в EXE, переносятся файлом базы."""

    @staticmethod
    def check() -> bool:
        return not store().catalog_count()
