# -*- coding: utf-8 -*-
"""Подготовка данных при запуске: папки, стартовый каталог из EXE, сверка нумерации КП с файлами."""
import os
import re
import shutil
from datetime import datetime

from config import BUNDLE, DATA_DIR, DOCS_DIR, IMG_DIR, read_text, store


def prepare_dirs():
    for d in (DATA_DIR, IMG_DIR, DOCS_DIR):
        os.makedirs(d, exist_ok=True)


def sync_counter_with_files():
    """Номер КП не должен повторить уже существующий файл (например, если базу восстановили из старой копии)."""
    year = datetime.now().year
    top = 0
    for dp, dn, fn in os.walk(DOCS_DIR):
        for name in fn:
            m = re.match(r'^(\d{4})-(\d{3,})_', name)
            if m and int(m.group(1)) == year:
                top = max(top, int(m.group(2)))
    if top:
        store().ensure_counter_at_least(year, top)


def seed_catalog():
    """Первый запуск на новом компьютере: стартовый каталог с фото из EXE — сразу в базу."""
    st = store()
    if st.catalog_count():
        return False
    seed = os.path.join(BUNDLE, 'seed', 'data')
    img = os.path.join(seed, 'img')
    if os.path.isdir(img):   # изображения — с папками категорий (см. app/images.py)
        for dp, dn, fn in os.walk(img):
            for name in fn:
                src = os.path.join(dp, name)
                target = os.path.join(IMG_DIR, os.path.relpath(src, img))
                if not os.path.exists(target):
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    shutil.copyfile(src, target)
    cat = os.path.join(seed, 'catalog')
    if os.path.isdir(cat):
        for name in os.listdir(cat):
            if name.endswith('.json'):
                st.catalog_put(name[:-5], read_text(os.path.join(cat, name)))
    return True
