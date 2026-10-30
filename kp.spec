# -*- mode: python ; coding: utf-8 -*-
# Сборка «Конструктор КП.exe»: pyinstaller --noconfirm --clean kp.spec
# Имя EXE можно переопределить переменной окружения KP_EXE_NAME.
import os

NAME = os.environ.get('KP_EXE_NAME') or 'Конструктор КП'
import re as _re
_v = _re.search(r"VERSION = '([\d.]+)'", open('app/version.py', encoding='utf-8').read()).group(1)
VERSION = tuple(int(x) for x in (_v + '.0.0.0').split('.')[:4])

version_info = None
if os.name == 'nt':
    from PyInstaller.utils.win32.versioninfo import (
        FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo)
    version_info = VSVersionInfo(
        ffi=FixedFileInfo(filevers=VERSION, prodvers=VERSION),
        kids=[
            StringFileInfo([StringTable('041904B0', [
                StringStruct('CompanyName', 'ООО ПНЕВМОТЕХ'),
                StringStruct('FileDescription', 'Конструктор КП ПНЕВМОТЕХ'),
                StringStruct('FileVersion', '.'.join(map(str, VERSION))),
                StringStruct('InternalName', 'kp_server'),
                StringStruct('OriginalFilename', NAME + '.exe'),
                StringStruct('ProductName', 'Конструктор КП'),
                StringStruct('ProductVersion', '.'.join(map(str, VERSION))),
            ])]),
            VarFileInfo([VarStruct('Translation', [0x0419, 1200])]),
        ],
    )

# Стандартная библиотека Python — с запасом для будущих обновлений патчем: новый модуль программы (папка update) может
# импортировать любой из этих модулей, и новый EXE для него не нужен. Почта, XML и HTML, сеть, архивы, точные вычисления,
# потоки, журналы, сравнение текстов. Не входят: tkinter, unittest, pydoc, multiprocessing, xmlrpc, asyncio (не нужны).
from PyInstaller.utils.hooks import collect_submodules
STDLIB = [m for pkg in ('email', 'xml', 'html', 'http', 'urllib', 'json', 'concurrent', 'logging', 'sqlite3', 'importlib', 'ctypes', 'encodings')
          for m in collect_submodules(pkg) if not _re.search(r'_codecs_(jp|hk|cn|kr|tw|iso2022)|encodings\.(cp93[2-9]|cp949|cp950|euc_|gb|big5|hz|iso2022|johab|shift_jis)', m)] + [
    'difflib', 'textwrap', 'unicodedata', 'fractions', 'decimal', 'statistics', 'numbers', 'cmath', 'random', 'secrets', 'hmac', 'hashlib',
    'tarfile', 'lzma', 'bz2', 'zlib', 'gzip', 'zipfile', 'shutil', 'tempfile', 'glob', 'fnmatch', 'filecmp', 'pathlib', 'mimetypes',
    'configparser', 'tomllib', 'csv', 'calendar', 'locale', 'gettext', 'string', 'pprint', 'reprlib', 'copy', 'pickle', 'struct', 'array',
    'base64', 'binascii', 'quopri', 'codecs', 'smtplib', 'imaplib', 'poplib', 'ftplib', 'mailbox', 'socketserver', 'selectors', 'ssl', 'ipaddress',
    'uuid', 'sched', 'queue', 'heapq', 'bisect', 'graphlib', 'dataclasses', 'enum', 'typing', 'contextlib', 'contextvars', 'functools', 'itertools',
    'operator', 'weakref', 'shlex', 'argparse', 'getpass', 'colorsys', 'inspect', 'ast', 'tokenize', 'traceback', 'warnings', 'pkgutil', 'platform',
    'mmap', 'fileinput', 'timeit']

a = Analysis(
    ['app/launcher.py'],      # загрузчик: обновление (патч) из папки update рядом с EXE, затем kp_server
    pathex=['app'],
    binaries=[],
    datas=[
        ('app/web', 'app/web'),
        ('app/icon.ico', 'app'),
        ('app/equipment_types.json', 'app'),
        ('templates', 'templates'),
    ],
    hiddenimports=['kp_server', 'web_api', 'admin_accounts', 'admin_access', 'admin_journal', 'catalog_save', 'admin_base', 'admin_feeds_api', 'admin_system_api', 'admin_records_api', 'admin_data_api', 'version', 'net', 'geo', 'feeds', 'feed_files', 'feed_update', 'genset_tide', 'genset_sheets', 'feed_photo', 'imgfetch', 'maker_logos', 'auth_users', 'admin_rights', 'ai_llm', 'ai_profile', 'app_update', 'update_sign', 'ed25519', 'db_health', 'admin_overview', 'data_bundle', 'settings_history', 'backup_mirror', 'backup_webdav', 'connections', 'catalog_sync', 'catalog_patch', 'supplier_scope', 'data_file', 'catalog_admin', 'crm', 'deal_autofill', 'deal_rules', 'bitrix_my', 'crm_auto', 'bitrix_mirror_load', 'bitrix_mirror', 'crm_funnels', 'client_match', 'client_contacts', 'phone', 'crm_exec', 'crm_money', 'onec', 'bitrix_clients', 'bitrix_companies', 'bitrix_docs', 'bitrix_comms', 'bitrix_diff', 'deal_reg_audit', 'company_card', 'kp_transfer', 'deal_econ', 'bitrix_econ_list', 'catalog_quality', 'deal_files', 'deal_intake', 'feedback', 'crm_time', 'crm_month', 'bitrix', 'bitrix_rules', 'user_prefs', 'platform', 'pdf_text', 'doc_images', 'doc_text', 'tz_parse', 'station_rules', 'ocr_win', 'defaults', 'lists', 'kp_track', 'kp_files', 'our_docs', 'features', 'smtplib', 'email.message', 'email.utils', 'importlib.abc', 'importlib.util', 'ipaddress', 'csv', 'zipfile', 'calendar', 'decimal',
                   'statistics', 'uuid', 'base64', 'html', 'html.parser', 'http.client', 'email', 'shutil', 'tempfile', 'subprocess', 'ctypes',
                   'config', 'data_setup', 'storage', 'counterparty', 'equipment_types', 'kp_templates', 'cbr', 'workcal', 'desktop', 'pdf_convert', 'catalog_migrate', 'admin', 'images', 'maintenance', 'logistics_api', 'china_freight', 'server_task', 'server_log', 'admin_alerts',
                   'sqlite3', '_sqlite3', 'gzip'] + STDLIB,
    # sqlite3 НЕ исключать: на нём работает база данных программы
    excludes=['tkinter', 'unittest', 'pydoc', 'pydoc_data', 'lib2to3', 'multiprocessing', 'xmlrpc', 'curses', 'test'],
    noarchive=False,
)
# азиатские кодировки (японская, китайская, корейская) программе не нужны — EXE легче почти на мегабайт
a.binaries = [b for b in a.binaries if not _re.search(r'_codecs_(jp|hk|cn|kr|tw|iso2022)', b[0])]
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=NAME,
    debug=False,
    strip=False,
    upx=False,            # UPX повышает число ложных срабатываний антивирусов
    console=False,        # без чёрного окна — как прежний EXE
    icon='app/icon.ico',
    version=version_info,
)
