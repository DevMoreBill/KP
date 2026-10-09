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

a = Analysis(
    ['app/launcher.py'],      # загрузчик: обновление (патч) из папки update рядом с EXE, затем kp_server
    pathex=['app'],
    binaries=[],
    datas=[
        ('app/web', 'app/web'),
        ('app/icon.ico', 'app'),
        ('app/equipment_types.json', 'app'),
        ('templates', 'templates'),
        ('seed/data/catalog', 'seed/data/catalog'),
        ('seed/data/img', 'seed/data/img'),
    ],
    hiddenimports=['kp_server', 'version', 'geo', 'feeds', 'feed_files', 'imgfetch', 'auth_users', 'ai_llm', 'pdf_text', 'defaults', 'lists', 'importlib.abc', 'importlib.util', 'ipaddress', 'csv', 'zipfile', 'calendar', 'decimal',
                   'statistics', 'uuid', 'base64', 'html', 'html.parser', 'http.client', 'email', 'shutil', 'tempfile', 'subprocess', 'ctypes',
                   'config', 'data_setup', 'storage', 'counterparty', 'equipment_types', 'kp_templates', 'cbr', 'workcal', 'imgfetch', 'desktop', 'pdf_convert', 'catalog_migrate', 'admin', 'images', 'maintenance', 'logistics_api',
                   'sqlite3', '_sqlite3', 'gzip'],
    # sqlite3 НЕ исключать: на нём работает база данных программы
    excludes=['tkinter', 'unittest', 'pydoc', 'lib2to3', 'multiprocessing'],
    noarchive=False,
)
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
