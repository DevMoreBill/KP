"""Открытие файлов и папок на компьютере, где работает программа (Word, проводник)."""

import functools
import os
import subprocess
import sys


class DesktopError(RuntimeError):
    """Файл или папку не удалось открыть на этом компьютере."""


def _safe(func):
    """Ошибка ОС — DesktopError с понятным текстом (ответ 422)."""

    @functools.wraps(func)
    def run(path: str):
        try:
            return func(path)
        except OSError as exc:
            why = exc.strerror or 'нет программы для такого файла'
            raise DesktopError(f'Не удалось открыть на этом компьютере: {why}') from exc

    return run


@_safe
def open_file(path: str) -> None:
    if os.name == 'nt':
        os.startfile(path)  # noqa: S606 — файл КП на своём компьютере: открыть программой Windows по умолчанию
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    else:
        subprocess.Popen(['xdg-open', path])


@_safe
def show_in_folder(path: str) -> None:
    if os.name == 'nt':
        subprocess.Popen(f'explorer.exe /select,"{path}"')
    else:
        open_file(os.path.dirname(path))


@_safe
def open_folder(path: str) -> None:
    if os.name == 'nt':
        subprocess.Popen(f'explorer.exe "{path}"')
    else:
        open_file(path)
