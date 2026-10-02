# Обновление «Конструктора КП» в C:\KP без замены EXE: код и интерфейс новой версии — в папку C:\KP\update.
# Данные (база, изображения, шаблоны, готовые КП) не затрагиваются. Программа перезапускается сама.
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
. (Join-Path $here 'kp-common.ps1')
Need-Admin $MyInvocation.MyCommand.Definition
$new = Join-Path $here 'update'
$vj = [IO.File]::ReadAllText((Join-Path $new 'version.json'))
$ver = [regex]::Match($vj, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
Write-Host ('Обновление «Конструктора КП» до версии ' + $ver) -ForegroundColor Cyan
$exe = Find-Exe $KP
if (-not $exe) { Fail 'В C:\KP нет программы. Сначала один раз установите полный комплект: «install\Установить в C KP.cmd».' }
$m = [regex]::Match([string]$exe.VersionInfo.FileVersion, '(\d+)\D+(\d+)')
if ((-not $m.Success) -or ([int]$m.Groups[1].Value * 1000 + [int]$m.Groups[2].Value -lt 3002)) {
  Fail ('Программа в C:\KP (версия ' + $exe.VersionInfo.FileVersion + ') ещё не умеет ставить обновления. Один раз установите полный комплект версии 3.2 или новее.') }
Stop-KP
$dst = Join-Path $KP 'update'
if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
Write-Host '  копирую файлы обновления'
Copy-Item -LiteralPath $new -Destination $dst -Recurse -Force
Start-KP $exe.FullName
Done ('Готово: установлена версия ' + $ver + '. Откройте программу (в браузере обновите страницу: Ctrl+F5).')
