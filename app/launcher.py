# -*- coding: utf-8 -*-
"""Точка входа «Конструктор КП.exe».

Обновления без нового EXE: рядом с программой (C:\\KP) — папка «update» с кодом и интерфейсом новой версии
(update\\version.json, update\\app\\*.py, update\\app\\web\\…, update\\templates\\…). Если её версия новее встроенной в EXE,
модули программы и интерфейс берутся из неё; иначе — встроенные (устаревший патч после установки нового EXE не мешает).
Устанавливает папку «update» установщик патча («Установить обновление.cmd»).
"""
import importlib.abc
import importlib.util
import json
import os
import sys

import version

ROOT = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
UPD = os.path.join(ROOT, 'update')


def _update_version():
    try:
        with open(os.path.join(UPD, 'version.json'), 'r', encoding='utf-8-sig') as f:
            return str(json.load(f).get('version') or '')
    except (OSError, ValueError):
        return ''


class _UpdateFinder(importlib.abc.MetaPathFinder):
    """Модули программы (app\\*.py) — из папки обновления, раньше встроенных в EXE."""
    def __init__(self, folder):
        self.folder = folder

    def find_spec(self, name, path=None, target=None):
        if '.' in name:
            return None
        f = os.path.join(self.folder, name + '.py')
        return importlib.util.spec_from_file_location(name, f) if os.path.isfile(f) else None


def activate_update():
    uv = _update_version()
    app = os.path.join(UPD, 'app')
    if getattr(sys, 'frozen', False) and uv and os.path.isfile(os.path.join(app, 'kp_server.py')) \
            and version.as_tuple(uv) > version.as_tuple(version.VERSION):
        os.environ['KP_UPDATE_DIR'] = UPD
        os.environ['KP_BASE_VERSION'] = version.VERSION     # версия, встроенная в EXE («Настройки → Обновления»)
        os.environ['KP_UPDATE_VERSION'] = uv
        sys.meta_path.insert(0, _UpdateFinder(app))
        sys.modules.pop('version', None)          # версия — тоже из обновления
        return True
    return False


if __name__ == '__main__':
    activate_update()
    import kp_server
    sys.exit(kp_server.main())
