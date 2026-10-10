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
if (-not (Stop-KP $KP)) { Fail 'Программа не остановилась — перезагрузите компьютер и запустите обновление снова.' }
$dst = Join-Path $KP 'update'
# прежнее обновление — в update.prev: если новое не запустится, программа сама вернётся к нему
$prev = Join-Path $KP 'update.prev'
if (Test-Path -LiteralPath $dst) {
  if (Test-Path -LiteralPath $prev) { Remove-Item -LiteralPath $prev -Recurse -Force }
  Move-Item -LiteralPath $dst -Destination $prev }
$failed = Join-Path $KP 'update.failed'
if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
Write-Host '  копирую файлы обновления'
Copy-Item -LiteralPath $new -Destination $dst -Recurse -Force
# новые файлы управления сервером отдела (остановить / запустить / удалить) — в C:\KP\server-setup
$ss = Join-Path $here 'server-setup'
if (Test-Path -LiteralPath $ss) {
  New-Item -ItemType Directory -Force -Path (Join-Path $KP 'server-setup') | Out-Null
  Get-ChildItem -LiteralPath $ss | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $KP 'server-setup') -Force }
  Remove-OldServerFiles }
if (-not (Start-KP $exe.FullName)) { Write-Host '  программа ещё запускается — откройте её через минуту' -ForegroundColor Yellow }
Done ('Готово: установлена версия ' + $ver + '. Откройте программу (в браузере обновите страницу: Ctrl+F5).')
