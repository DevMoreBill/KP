"""КП в PDF: Microsoft Word (COM), LibreOffice или ConvertAPI; присланный DOCX проверяется до Word."""

import glob
import io
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import threading
import zipfile

LOCK = threading.Lock()
WORD_TIMEOUT = 150
LO_TIMEOUT = 240

# У службы (SYSTEM) Word не открывает документы без папки systemprofile\Desktop — она создаётся только от имени SYSTEM
WORD_PS = r"""
$ErrorActionPreference = 'Stop'
if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
  foreach ($d in @("$env:WINDIR\System32\config\systemprofile\Desktop", "$env:WINDIR\SysWOW64\config\systemprofile\Desktop")) {
    try { if (-not (Test-Path -LiteralPath $d -ErrorAction SilentlyContinue)) { New-Item -ItemType Directory -Path $d -Force -ErrorAction SilentlyContinue | Out-Null } } catch {}
  }
}
$w = New-Object -ComObject Word.Application
try {
  $w.Visible = $false
  $w.DisplayAlerts = 0
  $w.AutomationSecurity = 3
  $doc = $w.Documents.Open($env:KP_PDF_IN, $false, $true, $false)
  try { $doc.ExportAsFixedFormat($env:KP_PDF_OUT, 17) } finally { $doc.Close(0) }
} finally {
  $w.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)
}
"""


def _no_window() -> dict:
    return {'creationflags': 0x08000000} if os.name == 'nt' else {}


def soffice_path() -> str | None:
    for n in ('soffice', 'libreoffice'):
        p = shutil.which(n)
        if p:
            return p
    if os.name == 'nt':
        for env in ('ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)'):
            base = os.environ.get(env)
            if base:
                for p in sorted(glob.glob(os.path.join(base, 'LibreOffice*', 'program', 'soffice.exe')), reverse=True):
                    return p
    return None


def word_available() -> bool:
    if os.name != 'nt':
        return False
    try:
        import winreg

        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r'Word.Application\CLSID'))
        return True
    except Exception:
        return False


def available(cloud_key: str | None = None) -> dict:
    return {'word': word_available(), 'libreoffice': bool(soffice_path()), 'cloud': bool(cloud_key)}


def _ok(path: str) -> bool:
    return os.path.isfile(path) and os.path.getsize(path) > 100


def _word(src: str, dst: str) -> None:
    ps = os.path.join(
        os.environ.get('WINDIR', r'C:\Windows'), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    )
    env = dict(os.environ, KP_PDF_IN=src, KP_PDF_OUT=dst)
    r = subprocess.run(  # noqa: PLW1510 — код выхода разбирается ниже
        [
            ps if os.path.isfile(ps) else 'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            WORD_PS,
        ],
        env=env,
        capture_output=True,
        timeout=WORD_TIMEOUT,
        **_no_window(),
    )
    if not _ok(dst):
        err = (r.stderr or r.stdout or b'').decode('cp866' if os.name == 'nt' else 'utf-8', 'replace').strip()
        raise RuntimeError('Word: ' + (err.splitlines()[0] if err else 'файл PDF не создан'))


def _libreoffice(src: str, dst: str) -> None:
    exe = soffice_path()
    out_dir = tempfile.mkdtemp(prefix='kp_pdf_')
    profile = tempfile.mkdtemp(prefix='kp_lo_')
    try:
        subprocess.run(  # noqa: PLW1510 — результат проверяется по файлу PDF
            [
                exe,
                '-env:UserInstallation=' + pathlib.Path(profile).as_uri(),
                '--headless',
                '--norestore',
                '--nologo',
                '--convert-to',
                'pdf',
                '--outdir',
                out_dir,
                src,
            ],
            capture_output=True,
            timeout=LO_TIMEOUT,
            **_no_window(),
        )
        res = os.path.join(out_dir, os.path.splitext(os.path.basename(src))[0] + '.pdf')
        if not _ok(res):
            raise RuntimeError('LibreOffice: файл PDF не создан')
        shutil.move(res, dst)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


CLOUD_URL = 'https://v2.convertapi.com/convert/docx/to/pdf'


def _cloud(src: str, dst: str, key: str) -> None:
    """ConvertAPI: POST multipart (File) → JSON с файлом в base64 (StoreFile=false — файл не хранится в сервисе)."""
    import base64
    import json
    import urllib.error
    import uuid

    from net import Net

    boundary = uuid.uuid4().hex
    with open(src, 'rb') as f:
        data = f.read()
    body = b''.join(
        [
            (f'--{boundary}\r\nContent-Disposition: form-data; name="StoreFile"\r\n\r\nfalse\r\n').encode(),
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="File"; filename="kp.docx"\r\n'
                'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n'
            ).encode(),
            data,
            (f'\r\n--{boundary}--\r\n').encode(),
        ]
    )
    try:
        res = json.loads(
            Net.request(
                CLOUD_URL,
                data=body,
                method='POST',
                timeout=120,
                limit=120 * 1024 * 1024,
                headers={
                    'Authorization': 'Bearer ' + key,
                    'Accept': 'application/json',
                    'Content-Type': 'multipart/form-data; boundary=' + boundary,
                },
            ).decode('utf-8')
        )
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode('utf-8')).get('Message')
        except Exception:
            msg = ''
        raise RuntimeError('ConvertAPI: %s' % (msg or f'ошибка {e.code}')) from e
    except OSError as e:
        raise RuntimeError(f'ConvertAPI недоступен: {e}') from e
    files = res.get('Files') or []
    if not files or not files[0].get('FileData'):
        raise RuntimeError('ConvertAPI: файл PDF не получен')
    with open(dst, 'wb') as f:
        f.write(base64.b64decode(files[0]['FileData']))
    if not _ok(dst):
        raise RuntimeError('ConvertAPI: файл PDF пустой')


def convert_file(src: str, dst: str, cloud_key: str | None = None) -> str:
    """DOCX-файл src → PDF-файл dst."""
    try:
        with open(src, 'rb') as fh:
            DocxCheck.check(fh.read(DocxCheck.MAX + 1))
    except ValueError as e:
        raise RuntimeError(str(e)) from e
    tried = []
    with LOCK:
        for name, ok, fn in (
            ('Word', word_available, _word),
            ('LibreOffice', lambda: bool(soffice_path()), _libreoffice),
            ('ConvertAPI', lambda: bool(cloud_key), lambda s, d: _cloud(s, d, cloud_key)),
        ):
            if not ok():
                continue
            try:
                if os.path.exists(dst):
                    os.remove(dst)
                fn(src, dst)
                return dst
            except subprocess.TimeoutExpired:
                tried.append(f'{name} не успел за отведённое время')
            except Exception as e:
                tried.append(str(e) or name)
    if not tried:
        raise RuntimeError(
            'на компьютере-сервере нет Microsoft Word или LibreOffice и не задан ключ ConvertAPI — сохраните PDF через печать из предпросмотра'
        )
    raise RuntimeError('; '.join(tried))


class DocxCheck:
    """В Word сервера — только .docx без макросов и внешних шаблонов и объектов."""

    MAX = 60 * 1024 * 1024
    PART = 2 * 1024 * 1024  # служебные части (типы, связи) больше — не документ Word, а «бомба» или подмена
    BAD_REL = re.compile(r'/(attachedTemplate|oleObject|frame|subDocument|package|control)$')

    @classmethod
    def check(cls, data: bytes) -> None:
        if len(data or b'') > cls.MAX:
            raise ValueError(f'документ больше {cls.MAX // 1024 // 1024} МБ')
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            names = set(z.namelist())
            if any(
                (n == '[Content_Types].xml' or n.endswith('.rels')) and z.getinfo(n).file_size > cls.PART for n in names
            ):
                raise ValueError('это не документ Word (.docx)')
            ct = z.read('[Content_Types].xml').decode('utf-8', 'replace') if '[Content_Types].xml' in names else ''
        except (zipfile.BadZipFile, KeyError, OSError, NotImplementedError):
            raise ValueError('это не документ Word (.docx)') from None
        if 'word/document.xml' not in names or 'wordprocessingml.document.main+xml' not in ct:
            raise ValueError('это не документ Word (.docx)')
        if 'macroEnabled' in ct or any(
            n.lower().endswith('vbaproject.bin') or n.lower().startswith('word/activex') for n in names
        ):
            raise ValueError('документ с макросами не преобразуется')
        for n in names:
            if n.endswith('.rels'):
                for m in re.finditer(r'<Relationship\b[^>]*>', z.read(n).decode('utf-8', 'replace')):
                    t = re.search(r'\bType="([^"]*)"', m.group(0))
                    if 'External' in m.group(0) and t and cls.BAD_REL.search(t.group(1)):
                        raise ValueError('документ ссылается на внешний шаблон или объект — не преобразуется')


def convert_bytes(data: bytes, cloud_key: str | None = None) -> bytes:
    DocxCheck.check(data)
    d = tempfile.mkdtemp(prefix='kp_pdfb_')
    try:
        src, dst = os.path.join(d, 'kp.docx'), os.path.join(d, 'kp.pdf')
        with open(src, 'wb') as f:
            f.write(data)
        convert_file(src, dst, cloud_key)
        with open(dst, 'rb') as f:
            return f.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)
