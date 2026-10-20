"""Пути программы, режим работы из settings.json (mode, port, dataDir, docsShare, allowedHosts), база, общие помощники."""

import json
import os
import re
import sys
import time

APP_TITLE = 'Конструктор КП ПНЕВМОТЕХ'
STARTED = time.time()
BASE_PORT = 17845
FROZEN = getattr(sys, 'frozen', False)

ROOT = os.path.dirname(os.path.abspath(sys.executable if FROZEN else __file__))
BUNDLE = getattr(sys, '_MEIPASS', ROOT)
if not FROZEN:
    BUNDLE = os.path.dirname(ROOT)

# пакет обновления (папка «update», подключает launcher.py) подменяет файлы интерфейса и справочники
UPDATE_DIR = os.environ.get('KP_UPDATE_DIR') or ''
APP_DIR = (
    os.path.join(UPDATE_DIR, 'app')
    if UPDATE_DIR and os.path.isdir(os.path.join(UPDATE_DIR, 'app', 'web'))
    else os.path.join(BUNDLE, 'app')
)

SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}\Z')
MIME = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
}


def message_box(text: str, error: bool = True) -> None:
    """Окно сообщения: у EXE без консоли другого способа нет."""
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


def read_text(path: str) -> str:
    with open(path, encoding='utf-8-sig') as file:
        return file.read()


def write_text(path: str, text: str) -> None:
    with open(path, 'w', encoding='utf-8', newline='') as file:
        file.write(text)


def write_bytes(path: str, data: bytes) -> None:
    with open(path, 'wb') as file:
        file.write(data)


SETTINGS: dict = {}


def resolve_dirs() -> tuple[str, str]:
    data_dir = os.path.join(ROOT, 'data')
    docs_dir = os.path.join(ROOT, 'Коммерческие предложения')
    settings = os.path.join(ROOT, 'settings.json')
    if os.path.exists(settings):
        try:
            saved = json.loads(read_text(settings))
            SETTINGS.update(saved)
            if saved.get('dataDir'):
                data_dir = os.path.join(saved['dataDir'], 'data')
                docs_dir = os.path.join(saved['dataDir'], 'Коммерческие предложения')
        except Exception:
            pass
    else:
        try:
            write_text(settings, '{\n  "mode": "local",\n  "port": 17845,\n  "dataDir": "",\n  "docsShare": ""\n}\n')
        except Exception:
            pass
    return data_dir, docs_dir


DATA_DIR, DOCS_DIR = resolve_dirs()
SERVER_MODE = str(SETTINGS.get('mode', 'local')).lower() == 'server'
if SETTINGS.get('port'):
    try:
        BASE_PORT = int(SETTINGS['port'])
    except (TypeError, ValueError):
        pass
# имена сервера отдела для заголовка Host (защита от подмены DNS); пусто — IP, имя компьютера и внутренние зоны
_hosts = SETTINGS.get('allowedHosts')
ALLOWED_HOSTS = [str(x).strip().lower() for x in _hosts if str(x).strip()] if isinstance(_hosts, list) else []
DOCS_SHARE = str(SETTINGS.get('docsShare') or '').strip()
STORE = None


def store():
    global STORE
    if STORE is None:
        from storage import Store

        STORE = Store(os.path.join(DATA_DIR, 'kp.sqlite3'))
    return STORE


IMG_DIR = os.path.join(DATA_DIR, 'img')


class BadRequest(ValueError):
    """Неверный запрос — ответ 400 с понятным текстом."""


def safe_id(text: str) -> str:
    if not SAFE_ID.match(text or ''):
        raise BadRequest('Недопустимый идентификатор')
    return text


def safe_file(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', text or '').strip()
    return text if text.strip('. ') else 'КП.docx'


def safe_dir(text: str) -> str:
    """Имя подпапки менеджера без путей и запрещённых символов."""
    text = re.sub(r'[\\/:*?"<>|.]', '', text or '').strip()
    return text[:60]


def docs_path(rel: str) -> str:
    """Путь к файлу КП по имени из базы, не выходя из папки КП."""
    parts = [safe_file(x) for x in re.split(r'[\\/]', rel or '') if x]
    path = os.path.join(DOCS_DIR, *parts) if parts else os.path.join(DOCS_DIR, 'КП.docx')
    root = os.path.normcase(os.path.abspath(DOCS_DIR)) + os.sep
    if not os.path.normcase(os.path.abspath(path)).startswith(root):
        raise ValueError('Недопустимое имя файла КП')
    return path
