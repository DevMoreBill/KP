# -*- coding: utf-8 -*-
"""Сохранение КП в PDF: DOCX → PDF средствами, которые уже есть на компьютере-сервере.

1. Microsoft Word (если установлен) — через COM из Windows PowerShell: результат как при «Сохранить как PDF» в Word.
2. LibreOffice (если установлен) — soffice --headless --convert-to pdf.
Если нет ни того ни другого, программа предлагает печать из предпросмотра КП («Сохранить как PDF» в браузере).
Преобразования выполняются по одному: Word и LibreOffice не любят параллельные запуски.
"""
import glob
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading

LOCK = threading.Lock()
WORD_TIMEOUT = 150
LO_TIMEOUT = 240

# Word: Documents.Open(файл, без вопросов о преобразовании, только чтение, не в недавние) → ExportAsFixedFormat(PDF = 17).
# У службы (SYSTEM) Word без папки Desktop в профиле systemprofile не открывает документы — создаём её.
WORD_PS = r'''
$ErrorActionPreference = 'Stop'
foreach ($d in @("$env:WINDIR\System32\config\systemprofile\Desktop", "$env:WINDIR\SysWOW64\config\systemprofile\Desktop")) {
  if (-not (Test-Path -LiteralPath $d)) { try { New-Item -ItemType Directory -Path $d -Force | Out-Null } catch {} }
}
$w = New-Object -ComObject Word.Application
try {
  $w.Visible = $false
  $w.DisplayAlerts = 0
  $doc = $w.Documents.Open($env:KP_PDF_IN, $false, $true, $false)
  try { $doc.ExportAsFixedFormat($env:KP_PDF_OUT, 17) } finally { $doc.Close(0) }
} finally {
  $w.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)
}
'''


def _no_window():
    return {'creationflags': 0x08000000} if os.name == 'nt' else {}


def soffice_path():
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


def word_available():
    if os.name != 'nt':
        return False
    try:
        import winreg
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r'Word.Application\CLSID'))
        return True
    except Exception:
        return False


def available():
    return {'word': word_available(), 'libreoffice': bool(soffice_path())}


def _ok(path):
    return os.path.isfile(path) and os.path.getsize(path) > 100


def _word(src, dst):
    ps = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    env = dict(os.environ, KP_PDF_IN=src, KP_PDF_OUT=dst)
    r = subprocess.run([ps if os.path.isfile(ps) else 'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                        '-Command', WORD_PS], env=env, capture_output=True, timeout=WORD_TIMEOUT, **_no_window())
    if not _ok(dst):
        err = (r.stderr or r.stdout or b'').decode('cp866' if os.name == 'nt' else 'utf-8', 'replace').strip()
        raise RuntimeError('Word: ' + (err.splitlines()[0] if err else 'файл PDF не создан'))


def _libreoffice(src, dst):
    exe = soffice_path()
    out_dir = tempfile.mkdtemp(prefix='kp_pdf_')
    profile = tempfile.mkdtemp(prefix='kp_lo_')
    try:
        subprocess.run([exe, '-env:UserInstallation=' + pathlib.Path(profile).as_uri(), '--headless', '--norestore', '--nologo',
                        '--convert-to', 'pdf', '--outdir', out_dir, src], capture_output=True, timeout=LO_TIMEOUT, **_no_window())
        res = os.path.join(out_dir, os.path.splitext(os.path.basename(src))[0] + '.pdf')
        if not _ok(res):
            raise RuntimeError('LibreOffice: файл PDF не создан')
        shutil.move(res, dst)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


def convert_file(src, dst):
    """DOCX-файл src → PDF-файл dst. Ошибка RuntimeError с понятным текстом, если преобразовать нечем или не вышло."""
    tried = []
    with LOCK:
        for name, ok, fn in (('Word', word_available, _word), ('LibreOffice', lambda: bool(soffice_path()), _libreoffice)):
            if not ok():
                continue
            try:
                if os.path.exists(dst):
                    os.remove(dst)
                fn(src, dst)
                return dst
            except subprocess.TimeoutExpired:
                tried.append('%s не успел за отведённое время' % name)
            except Exception as e:
                tried.append(str(e) or name)
    if not tried:
        raise RuntimeError('на компьютере-сервере нет Microsoft Word или LibreOffice — сохраните PDF через печать из предпросмотра')
    raise RuntimeError('; '.join(tried))


def convert_bytes(data):
    d = tempfile.mkdtemp(prefix='kp_pdfb_')
    try:
        src, dst = os.path.join(d, 'kp.docx'), os.path.join(d, 'kp.pdf')
        with open(src, 'wb') as f:
            f.write(data)
        convert_file(src, dst)
        with open(dst, 'rb') as f:
            return f.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)
