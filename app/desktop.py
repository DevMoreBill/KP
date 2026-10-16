# -*- coding: utf-8 -*-
"""Открытие файлов и папок на компьютере, где работает программа (Word, проводник)."""
import functools
import os
import subprocess
import sys


class DesktopError(RuntimeError):
    """Файл или папку не удалось открыть на этом компьютере (нет программы для такого файла и т. п.)."""


def _safe(fn):
    """Ошибка ОС при открытии — DesktopError с понятным текстом (ответ 422)."""
    @functools.wraps(fn)
    def run(path):
        try:
            return fn(path)
        except OSError as e:
            raise DesktopError('Не удалось открыть на этом компьютере: %s' % (e.strerror or 'нет программы для такого файла'))
    return run


@_safe
def open_file(path):
    if os.name == 'nt':
        os.startfile(path)
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    else:
        subprocess.Popen(['xdg-open', path])


@_safe
def show_in_folder(path):
    if os.name == 'nt':
        subprocess.Popen('explorer.exe /select,"%s"' % path)
    else:
        open_file(os.path.dirname(path))


@_safe
def open_folder(path):
    if os.name == 'nt':
        subprocess.Popen('explorer.exe "%s"' % path)
    else:
        open_file(path)
