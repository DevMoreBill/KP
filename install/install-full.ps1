# Установка «Конструктора КП» в постоянную папку C:\KP (полный комплект: EXE, сервер отдела, инструкция).
# Данные (база, изображения, шаблоны, готовые КП) в C:\KP сохраняются. Если программа раньше работала из другой
# папки — данные можно перенести оттуда. Дальше обновления ставятся патчем («Установить обновление.cmd»).
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
. (Join-Path $here 'kp-common.ps1')
Need-Admin $MyInvocation.MyCommand.Definition
$src = Split-Path $here -Parent
$exe = Find-Exe $src
if (-not $exe) { Fail ('Не найден «Конструктор КП.exe» рядом с папкой install: ' + $src) }
Write-Host 'Установка «Конструктора КП» в C:\KP' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $KP | Out-Null
Stop-KP
# перенос данных из прежней папки программы
if ((-not (Test-Path (Join-Path $KP 'data\kp.sqlite3'))) -and ($src.TrimEnd('\') -ne $KP)) {
  $old = Read-Host 'Если программа раньше работала из другой папки, укажите её (там лежит папка data), иначе нажмите Enter'
  $old = $old.Trim('"', ' ')
  if ($old -and (Test-Path -LiteralPath (Join-Path $old 'data'))) {
    foreach ($n in @('data', 'templates', 'Коммерческие предложения', 'settings.json')) {
      $p = Join-Path $old $n
      if (Test-Path -LiteralPath $p) { Write-Host ('  переношу ' + $n); Copy-Item -LiteralPath $p -Destination $KP -Recurse -Force }
    }
  } elseif ($old) { Write-Host '  в указанной папке нет папки data — начинаем с чистой базы' -ForegroundColor Yellow }
}
if ($src.TrimEnd('\') -ne $KP) {
  Write-Host '  копирую программу'
  Copy-Item -LiteralPath $exe.FullName -Destination $KP -Force
  foreach ($n in @('server-setup', 'Инструкция.txt', 'install')) {
    $p = Join-Path $src $n
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $KP -Recurse -Force }
  }
}
# обновление из прежнего комплекта уже входит в новый EXE
if (Test-Path (Join-Path $KP 'update')) { Remove-Item -LiteralPath (Join-Path $KP 'update') -Recurse -Force }
$target = Join-Path $KP $exe.Name
if (Task-Exists) { schtasks /Change /TN $TASK /TR ('"' + $target + '"') > $null 2>&1 }
# ярлык на рабочем столе
$lnk = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Конструктор КП.lnk'
$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($lnk); $s.TargetPath = $target; $s.WorkingDirectory = $KP; $s.Save()
Start-KP $target
Done 'Готово: программа установлена в C:\KP, ярлык «Конструктор КП» — на рабочем столе.'
