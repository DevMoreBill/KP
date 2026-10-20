"""Распознавание сканов встроенным OCR Windows 10/11 через PowerShell (Windows.Media.Ocr, Windows.Data.Pdf)."""

import json
import os
import re
import shutil
import subprocess
import tempfile


class WinOcr:
    TIMEOUT = 240
    MAX_PAGES = 40
    IMAGE_EXT = {b'\x89PNG': '.png', b'\xff\xd8\xff': '.jpg', b'II*\x00': '.tif', b'MM\x00*': '.tif', b'BM': '.bmp'}

    # скрипт PowerShell: -In файл, -Out JSON {pages:[текст], total, lang}; NOENGINE — нет языка распознавания
    SCRIPT = r"""param([string]$In, [string]$Out, [string]$Kind, [int]$MaxPages = 40)
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
"""

    @classmethod
    def powershell(cls) -> str | None:
        if os.name != 'nt':
            return None
        root = os.environ.get('SYSTEMROOT') or r'C:\Windows'
        p = os.path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        return p if os.path.isfile(p) else shutil.which('powershell.exe')

    @classmethod
    def available(cls) -> bool:
        return cls.powershell() is not None

    @classmethod
    def image_ext(cls, data: bytes) -> str | None:
        for sig, ext in cls.IMAGE_EXT.items():
            if data[: len(sig)] == sig:
                return ext
        return None

    @staticmethod
    def _clean(msg) -> str:
        """Сообщение без путей и служебных строк PowerShell."""
        s = re.sub(r'[A-Za-z]:\\[^\s\'"]+', '…', str(msg or ''))
        s = next(
            (
                x.strip()
                for x in s.splitlines()
                if x.strip()
                and not x.strip().startswith(('At ', 'строка:', '+ ', 'CategoryInfo', 'FullyQualifiedErrorId'))
            ),
            '',
        )
        return s[:200]

    @classmethod
    def recognize(cls, data: bytes, kind: str) -> dict:
        """kind — «pdf» или «image» → {pages, total, lang}."""
        ps = cls.powershell()
        if not ps:
            raise ValueError(
                'распознавание сканов доступно на сервере под Windows 10/11 (встроенное распознавание текста Windows)'
            )
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
                r = subprocess.run(
                    [
                        ps,
                        '-NoProfile',
                        '-NonInteractive',
                        '-ExecutionPolicy',
                        'Bypass',
                        '-File',
                        script,
                        '-In',
                        src,
                        '-Out',
                        out,
                        '-Kind',
                        'pdf' if kind == 'pdf' else 'image',
                        '-MaxPages',
                        str(cls.MAX_PAGES),
                    ],
                    check=False,
                    capture_output=True,
                    timeout=cls.TIMEOUT,
                    creationflags=flags,
                )
            except subprocess.TimeoutExpired:
                raise ValueError(
                    f'распознавание текста не уложилось в {cls.TIMEOUT} с — сократите документ или пришлите текстовый PDF'
                ) from None
            if not os.path.isfile(out):
                err = (r.stderr or b'').decode('utf-8', 'replace') + (r.stdout or b'').decode('utf-8', 'replace')
                if 'NOENGINE' in err:
                    raise ValueError(
                        'в Windows не установлен язык распознавания текста: «Параметры» → «Время и язык» → «Язык» → '
                        'Русский → «Параметры» → «Распознавание текста», затем повторите'
                    )
                why = cls._clean(err)
                raise ValueError('встроенное распознавание Windows не сработало' + (': ' + why if why else ''))
            with open(out, encoding='utf-8-sig') as f:
                d = json.load(f)
            pages = d.get('pages')
            pages = [pages] if isinstance(pages, str) else [str(p or '') for p in (pages or [])]
            return {'pages': pages, 'total': int(d.get('total') or len(pages)), 'lang': str(d.get('lang') or '')}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
