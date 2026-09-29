# -*- coding: utf-8 -*-
"""Открытие файлов и папок на компьютере, где работает программа (Word, проводник)."""
import os
import subprocess
import sys


def open_file(path):
    if os.name == 'nt':
        os.startfile(path)
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    else:
        subprocess.Popen(['xdg-open', path])


def show_in_folder(path):
    if os.name == 'nt':
        subprocess.Popen('explorer.exe /select,"%s"' % path)
    else:
        open_file(os.path.dirname(path))


def open_folder(path):
    if os.name == 'nt':
        subprocess.Popen('explorer.exe "%s"' % path)
    else:
        open_file(path)
