# -*- coding: utf-8 -*-
"""Шаблоны КП: папка templates рядом с программой (base.docx — шапка и поля, template.json — цвета и тексты)."""
import json
import os
import re
import shutil

from config import BUNDLE, FROZEN, ROOT, SAFE_ID, read_text

# Папка «templates» рядом с программой (правится вручную: base.docx в Word, template.json в Блокноте).
TEMPLATES_DIR = os.path.join(ROOT, 'templates') if FROZEN else os.path.join(BUNDLE, 'templates')
TPL_FILES = re.compile(r'^(template\.json|base\.docx|[A-Za-z0-9_-]+\.(jpg|jpeg|png))$')


def ensure_templates():
    """Первый запуск EXE: раскладываем встроенные шаблоны рядом с программой (свои правки не перезаписываются)."""
    src = os.path.join(BUNDLE, 'templates')
    if not os.path.isdir(src) or os.path.normcase(src) == os.path.normcase(TEMPLATES_DIR):
        return
    for name in os.listdir(src):
        dst = os.path.join(TEMPLATES_DIR, name)
        if os.path.isdir(os.path.join(src, name)) and not os.path.exists(dst):
            shutil.copytree(os.path.join(src, name), dst)


def template_dirs():
    out = {}
    if os.path.isdir(TEMPLATES_DIR):
        for name in sorted(os.listdir(TEMPLATES_DIR)):
            d = os.path.join(TEMPLATES_DIR, name)
            if SAFE_ID.match(name) and os.path.isfile(os.path.join(d, 'template.json')):
                out[name] = d
    return out


def list_templates():
    res = []
    for tid, d in template_dirs().items():
        try:
            j = json.loads(read_text(os.path.join(d, 'template.json')))
        except Exception as e:
            res.append({'id': tid, 'name': tid, 'error': 'Ошибка в template.json: %s' % e})
            continue
        res.append({'id': tid, 'name': j.get('name') or tid, 'description': j.get('description', ''), 'filePrefix': j.get('filePrefix', ''),
                    'hasBase': os.path.isfile(os.path.join(d, 'base.docx')),
                    'clients': bool(j.get('clientsImage')) and os.path.isfile(os.path.join(d, j.get('clientsImage', '')))})
    return res
