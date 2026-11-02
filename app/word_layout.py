"""Раскладка сохранённого КП в Microsoft Word сервера отдела: сколько листов, сколько из них занял титул (первый раздел),
насколько заполнен каждый лист — для самопроверки КП после сохранения."""

import os
import re
from typing import Any

import pdf_convert


class WordLayout:
    """Word (COM через PowerShell, как для PDF) открывает файл только для чтения и пересчитывает листы (вид «Разметка
    страницы»). Заполнение листа — нижний край самого нижнего абзаца на нём (строка текста или картинка в строке) от
    верхнего поля, в процентах высоты между полями; -1 — Word не сообщил положение строк листа (не тревога)."""

    TIMEOUT = 150
    LINE = re.compile(r'KPLAYOUT (\d{1,5}) (\d{1,5}) ((?:-1|\d{1,3})(?:,(?:-1|\d{1,3}))*|)(?:\s|$)')
    FULL = 100
    SCRIPT = (
        pdf_convert.SYSTEM_DESKTOP
        + r"""$w = New-Object -ComObject Word.Application
try {
  $w.Visible = $false
  $w.DisplayAlerts = 0
  $w.AutomationSecurity = 3
  $doc = $w.Documents.Open($env:KP_DOC_IN, $false, $true, $false)
  try {
    try { $doc.ActiveWindow.View.Type = 3 } catch {}
    $doc.Repaginate()
    $pages = [int]$doc.ComputeStatistics(2)
    $cover = 0
    if ($doc.Sections.Count -gt 1) { $cover = [int]$doc.Sections.Item(1).Range.Information(3) }
    $setup = $doc.Sections.Item($doc.Sections.Count).PageSetup
    $top = [double]$setup.TopMargin
    $usable = [Math]::Max(1, [double]$setup.PageHeight - $top - [double]$setup.BottomMargin)
    $low = New-Object 'double[]' ($pages + 2)
    $seen = New-Object 'bool[]' ($pages + 2)
    foreach ($p in $doc.Paragraphs) {
      $r = $p.Range
      $at = [Math]::Max($r.Start, $r.End - 1)
      $mark = $doc.Range($at, $at)
      $page = [int]$mark.Information(3)
      $y = [double]$mark.Information(6)
      if ($page -lt 1 -or $page -gt $pages -or $y -lt 0) { continue }
      $size = [double]$r.Font.Size
      if ($size -le 0 -or $size -gt 200) { $size = 10 }
      $h = $size * 1.25
      foreach ($s in $r.InlineShapes) { if ([double]$s.Height -gt $h) { $h = [double]$s.Height } }
      $seen[$page] = $true
      if ($y + $h -gt $low[$page]) { $low[$page] = $y + $h }
    }
    $fill = @()
    for ($i = 1; $i -le $pages; $i++) {
      if (-not $seen[$i]) { $fill += -1; continue }
      $fill += [int][Math]::Round([Math]::Max(0, [Math]::Min(1, ($low[$i] - $top) / $usable)) * 100)
    }
    [Console]::Out.WriteLine('KPLAYOUT ' + $pages + ' ' + $cover + ' ' + ($fill -join ','))
  } finally { $doc.Close(0) }
} finally {
  $w.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)
}
"""
    )

    @staticmethod
    def available() -> bool:
        return pdf_convert.word_available()

    @classmethod
    def measure(cls, path: str) -> dict[str, Any]:
        """{'available': False} — на сервере нет Word; иначе pages, cover (листов первого раздела; 0 — раздел один) и fill —
        заполнение листов по порядку, %."""
        if not cls.available():
            return {'available': False}
        with pdf_convert.LOCK:
            proc = pdf_convert.powershell(cls.SCRIPT, dict(os.environ, KP_DOC_IN=path), cls.TIMEOUT)
        out = cls.parse(proc.stdout.decode('ascii', 'replace'))
        if out is None:
            err = (proc.stderr or b'').decode('cp866', 'replace').strip()
            raise RuntimeError(err.splitlines()[0] if err else 'Word не сообщил раскладку файла')
        return out

    @classmethod
    def parse(cls, text: str) -> dict[str, Any] | None:
        """Строка сценария «KPLAYOUT листов титул заполнение,…» → словарь; нет строки — None."""
        match = cls.LINE.search(text or '')
        if not match:
            return None
        fill = [min(cls.FULL, int(x)) for x in match.group(3).split(',') if x]  # -1 — положение строк не известно
        return {'available': True, 'pages': int(match.group(1)), 'cover': int(match.group(2)), 'fill': fill}
