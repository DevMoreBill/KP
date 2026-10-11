# -*- coding: utf-8 -*-
"""Распознавание текста встроенными средствами Windows 10/11 — без сторонних программ и библиотек.

• Сканы ТЗ: картинки (PNG, JPEG, TIFF, BMP) и PDF без текстового слоя. PDF рисуется постранично встроенным в Windows
  Windows.Data.Pdf, текст распознаёт Windows.Media.Ocr (язык — русский, если установлен пакет распознавания; иначе —
  языки профиля пользователя). Вызов — Windows PowerShell 5.1 (есть в каждой Windows 10) со скриптом ниже: WinRT-классы
  доступны из .NET без установки чего-либо.
• Не Windows или нет PowerShell — WinOcr.available() = False, распознавание не выполняется (ValueError с пояснением).
• Файл пишется во временную папку и удаляется после распознавания; ошибки — понятным текстом, без путей.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile


class WinOcr:
    TIMEOUT = 240          # с — на весь документ
    MAX_PAGES = 40
    IMAGE_EXT = {b'\x89PNG': '.png', b'\xff\xd8\xff': '.jpg', b'II*\x00': '.tif', b'MM\x00*': '.tif', b'BM': '.bmp'}

    # скрипт PowerShell: -In файл, -Out JSON {pages:[текст], total, lang}; NOENGINE — нет языка распознавания
    SCRIPT = r'''param([string]$In, [string]$Out, [string]$Kind, [int]$MaxPages = 40)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ext = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asOp = $ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asAct = $ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($op, [Type]$t) { $task = $asOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAction($op) { $task = $asAct.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
$ru = New-Object Windows.Globalization.Language 'ru'
if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($ru)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($ru) }
else { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { throw 'NOENGINE' }
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
function OcrStream($stream) {
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $w = $dec.PixelWidth; $h = $dec.PixelHeight; $k = [Math]::Min(1.0, $max / [Math]::Max($w, $h))
  $tr = New-Object Windows.Graphics.Imaging.BitmapTransform
  $tr.ScaledWidth = [uint32][Math]::Floor($w * $k); $tr.ScaledHeight = [uint32][Math]::Floor($h * $k)
  $bmp = Await ($dec.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $tr,
    [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  ($res.Lines | ForEach-Object { $_.Text }) -join "`n"
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($In)) ([Windows.Storage.StorageFile])
$pages = New-Object System.Collections.ArrayList
$total = 1
if ($Kind -eq 'pdf') {
  $pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $total = $pdf.PageCount
  for ($i = 0; $i -lt [Math]::Min($total, $MaxPages); $i++) {
    $page = $pdf.GetPage($i)
    $s = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $o = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $pw = $page.Size.Width; $ph = $page.Size.Height
    $k = [Math]::Min(3.0, $max / [Math]::Max($pw, $ph))
    $o.DestinationWidth = [uint32]($pw * $k); $o.DestinationHeight = [uint32]($ph * $k)
    AwaitAction ($page.RenderToStreamAsync($s, $o))
    [void]$pages.Add([string](OcrStream $s))
    $page.Dispose(); $s.Dispose()
  }
} else {
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  [void]$pages.Add([string](OcrStream $stream))
  $stream.Dispose()
}
$json = ConvertTo-Json -InputObject @{ pages = @($pages); total = $total; lang = $engine.RecognizerLanguage.LanguageTag } -Depth 3 -Compress
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding $false))
'''

    @classmethod
    def powershell(cls):
        """путь к Windows PowerShell или None (не Windows)"""
        if os.name != 'nt':
            return None
        root = os.environ.get('SystemRoot') or r'C:\Windows'
        p = os.path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        return p if os.path.isfile(p) else shutil.which('powershell.exe')

    @classmethod
    def available(cls):
        return cls.powershell() is not None

    @classmethod
    def image_ext(cls, data):
        for sig, ext in cls.IMAGE_EXT.items():
            if data[:len(sig)] == sig:
                return ext
        return None

    @staticmethod
    def _clean(msg):
        """сообщение без путей и служебных строк PowerShell"""
        s = re.sub(r'[A-Za-z]:\\[^\s\'"]+', '…', str(msg or ''))
        s = next((x.strip() for x in s.splitlines() if x.strip() and not x.strip().startswith(('At ', 'строка:', '+ ', 'CategoryInfo', 'FullyQualifiedErrorId'))), '')
        return s[:200]

    @classmethod
    def recognize(cls, data, kind):
        """kind — 'pdf' или 'image'; → {'pages': [текст страницы], 'total': страниц, 'lang': язык}; ValueError — понятным текстом"""
        ps = cls.powershell()
        if not ps:
            raise ValueError('распознавание сканов доступно на сервере под Windows 10/11 (встроенное распознавание текста Windows)')
        ext = '.pdf' if kind == 'pdf' else (cls.image_ext(data) or '.png')
        tmp = tempfile.mkdtemp(prefix='kp-ocr-')
        try:
            src, out, script = (os.path.join(tmp, n) for n in ('in' + ext, 'out.json', 'ocr.ps1'))
            with open(src, 'wb') as f:
                f.write(data)
            with open(script, 'w', encoding='utf-8-sig') as f:
                f.write(cls.SCRIPT)
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            try:
                r = subprocess.run([ps, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
                                    '-In', src, '-Out', out, '-Kind', 'pdf' if kind == 'pdf' else 'image', '-MaxPages', str(cls.MAX_PAGES)],
                                   capture_output=True, timeout=cls.TIMEOUT, creationflags=flags)
            except subprocess.TimeoutExpired:
                raise ValueError('распознавание текста не уложилось в %d с — сократите документ или пришлите текстовый PDF' % cls.TIMEOUT)
            if not os.path.isfile(out):
                err = (r.stderr or b'').decode('utf-8', 'replace') + (r.stdout or b'').decode('utf-8', 'replace')
                if 'NOENGINE' in err:
                    raise ValueError('в Windows не установлен язык распознавания текста: «Параметры» → «Время и язык» → «Язык» → '
                                     'Русский → «Параметры» → «Распознавание текста», затем повторите')
                raise ValueError('встроенное распознавание Windows не сработало' + (': ' + cls._clean(err) if cls._clean(err) else ''))
            with open(out, encoding='utf-8-sig') as f:
                d = json.load(f)
            pages = d.get('pages')
            pages = [pages] if isinstance(pages, str) else [str(p or '') for p in (pages or [])]
            return {'pages': pages, 'total': int(d.get('total') or len(pages)), 'lang': str(d.get('lang') or '')}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
