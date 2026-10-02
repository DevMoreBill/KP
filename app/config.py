# -*- coding: utf-8 -*-
"""Настройки и пути программы: папки данных, режим работы (settings.json), база данных, общие помощники.

settings.json (рядом с EXE):
  mode       — "local" (один компьютер) или "server" (сервер отдела, доступен по сети);
  port       — порт (по умолчанию 17845);
  dataDir    — папка данных на локальном диске (пусто — папка data рядом с программой);
  docsShare  — сетевой путь к папке готовых КП для сотрудников (заполняет установка сервера отдела).
"""
import json
import os
import re
import sys

APP_TITLE = 'Конструктор КП ПНЕВМОТЕХ'
BASE_PORT = 17845
FROZEN = getattr(sys, 'frozen', False)

# root — папка, где лежит EXE (или скрипт); bundle — встроенные в EXE файлы
ROOT = os.path.dirname(os.path.abspath(sys.executable if FROZEN else __file__))
BUNDLE = getattr(sys, '_MEIPASS', ROOT)
if not FROZEN:
    BUNDLE = os.path.dirname(ROOT)  # при запуске из исходников: корень репозитория

# обновление (патч) из папки «update» рядом с программой — включает launcher.py; APP_DIR — файлы интерфейса и справочники
UPDATE_DIR = os.environ.get('KP_UPDATE_DIR') or ''
APP_DIR = os.path.join(UPDATE_DIR, 'app') if UPDATE_DIR and os.path.isdir(os.path.join(UPDATE_DIR, 'app', 'web')) else os.path.join(BUNDLE, 'app')

SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}


def message_box(text, error=True):
    """Сообщение пользователю: у EXE без консоли нет другого способа что-то показать."""
    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, text, APP_TITLE, 0x10 if error else 0x40)
            return
        except Exception:
            pass
    try:
        print(text, file=sys.stderr)
    except Exception:
        pass


def read_text(path):
    with open(path, 'r', encoding='utf-8-sig') as f:
        return f.read()


def write_text(path, text):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def write_bytes(path, data):
    with open(path, 'wb') as f:
        f.write(data)


# ---------- папки данных и режим работы ----------
SETTINGS = {}


def resolve_dirs():
    data_dir = os.path.join(ROOT, 'data')
    docs_dir = os.path.join(ROOT, 'Коммерческие предложения')
    settings = os.path.join(ROOT, 'settings.json')
    if os.path.exists(settings):
        try:
            st = json.loads(read_text(settings))
            SETTINGS.update(st)
            if st.get('dataDir'):
                data_dir = os.path.join(st['dataDir'], 'data')
                docs_dir = os.path.join(st['dataDir'], 'Коммерческие предложения')
        except Exception:
            pass
    else:
        try:
            write_text(settings, '{\n  "mode": "local",\n  "port": 17845,\n  "dataDir": "",\n  "docsShare": ""\n}\n')
        except Exception:
            pass
    return data_dir, docs_dir


DATA_DIR, DOCS_DIR = resolve_dirs()
# mode: "local" — программа для одного компьютера; "server" — сервер отдела, доступен по сети (http://имя-компьютера:порт)
SERVER_MODE = str(SETTINGS.get('mode', 'local')).lower() == 'server'
if SETTINGS.get('port'):
    try:
        BASE_PORT = int(SETTINGS['port'])
    except (TypeError, ValueError):
        pass
DOCS_SHARE = str(SETTINGS.get('docsShare') or '').strip()   # сетевой путь к папке КП для сотрудников, напр. \\\\SERVER\\КП
STORE = None


def store():
    global STORE
    if STORE is None:
        from storage import Store
        STORE = Store(os.path.join(DATA_DIR, 'kp.sqlite3'))
    return STORE
IMG_DIR = os.path.join(DATA_DIR, 'img')




def safe_id(s):
    if not SAFE_ID.match(s or ''):
        raise ValueError('Недопустимый идентификатор: %s' % s)
    return s


def safe_file(s):
    s = re.sub(r'[\\/:*?"<>|]', '', s or '').strip()
    return s or 'КП.docx'


def safe_dir(s):
    """Имя подпапки (фамилия менеджера): без путей и запрещённых символов."""
    s = re.sub(r'[\\/:*?"<>|.]', '', s or '').strip()
    return s[:60]


def docs_path(rel):
    """Путь к файлу КП по относительному имени из docx.txt (с подпапкой менеджера или без)."""
    parts = [safe_file(x) for x in re.split(r'[\\/]', rel or '') if x]
    return os.path.join(DOCS_DIR, *parts) if parts else os.path.join(DOCS_DIR, 'КП.docx')
