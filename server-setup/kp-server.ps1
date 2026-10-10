# Управление сервером отдела «Конструктора КП»: остановить полностью, запустить, удалить.
# Запускается файлами «2. Остановить сервер.cmd», «3. Запустить сервер.cmd», «4. Удалить сервер отдела.cmd»
# (права администратора запрашиваются сами). Папка программы — на уровень выше папки server-setup.
param([string]$Action = 'stop', [switch]$Quiet)
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$common = @((Join-Path $here 'kp-common.ps1'), (Join-Path (Split-Path $here -Parent) 'install\kp-common.ps1')) |
  Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $common) { Write-Host 'Нет файла kp-common.ps1 (папка install или server-setup) — скачайте полный комплект программы.' -ForegroundColor Red; Read-Host 'Enter — закрыть' | Out-Null; exit 1 }
. $common
Need-Admin $MyInvocation.MyCommand.Definition ('-Action ' + $Action + $(if ($Quiet) { ' -Quiet' } else { '' }))
$ErrorActionPreference = 'Continue'
$dir = Split-Path $here -Parent

function Ok($text) { Done $text; exit 0 }

function Stop-Report {
  Write-Host 'Останавливаю «Конструктор КП» (сервер отдела и все процессы программы)…' -ForegroundColor Cyan
  if (Stop-KP $dir) { return $true }
  $left = Get-KPProcs $dir
  Write-Host ('Не удалось завершить: ' + (($left | ForEach-Object { $_.Name + ' (PID ' + $_.ProcessId + ')' }) -join ', ')) -ForegroundColor Red
  return $false
}

switch ($Action) {
  'stop' {
    $ok = Stop-Report
    if ($Quiet) { if ($ok) { exit 0 } else { exit 1 } }
    if ($ok) { Ok ('Программа остановлена полностью: процессов «Конструктор КП» не осталось, порт ' + $PORT + ' свободен.' + "`n" +
      'Запустить снова — «3. Запустить сервер.cmd» (или сам запустится при перезагрузке компьютера).') }
    Fail 'Перезагрузите компьютер — процесс завершится вместе с Windows.'
  }
  'start' {
    $exe = Find-Exe $dir
    if (-not $exe) { Fail ('В папке ' + $dir + ' нет «Конструктор КП.exe».') }
    if ($Quiet) { if ((Ping-KP) -or (Start-KP $exe.FullName)) { exit 0 } else { exit 1 } }
    if (Ping-KP) { Ok ('Программа уже работает: http://' + $env:COMPUTERNAME + ':' + $PORT + '/') }
    Write-Host 'Запускаю «Конструктор КП»…' -ForegroundColor Cyan
    if (Start-KP $exe.FullName) { Ok ('Сервер работает: http://' + $env:COMPUTERNAME + ':' + $PORT + '/') }
    Fail 'Программа не ответила за 30 секунд. Запустите «2. Остановить сервер.cmd», затем снова этот файл; если не поможет — перезагрузите компьютер.'
  }
  'task' {
    $ok = Set-KPTask
    if ($Quiet) { if ($ok) { exit 0 } else { exit 1 } }
    if ($ok) { Ok 'Задача Планировщика настроена для сервера: без ограничения времени работы, работает и от батареи (ИБП), обычный приоритет.' }
    Fail 'Не удалось настроить задачу Планировщика: её нет (сначала «1. Установить сервер отдела.bat») или PowerShell старше 3.0.'
  }
  'remove' {
    $ok = Stop-Report
    schtasks /Delete /TN $TASK /F > $null 2>&1
    netsh advfirewall firewall delete rule name='Конструктор КП' > $null 2>&1
    net share 'КП' /delete /y > $null 2>&1
    $p = Join-Path $dir 'settings.json'
    if (Test-Path -LiteralPath $p) {
      try { $j = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json; $j.mode = 'local'
        [IO.File]::WriteAllText($p, ($j | ConvertTo-Json), (New-Object Text.UTF8Encoding $false)) } catch { } }
    if (-not $ok) { Fail 'Сервер отдела удалён из автозапуска, но процесс не завершился — перезагрузите компьютер.' }
    Ok ('Сервер отдела остановлен и удалён: нет автозапуска, правила брандмауэра и общей папки КП.' + "`n" +
      'Программа снова работает как обычная (только на этом компьютере). Данные (папка data) и готовые КП не тронуты.')
  }
  default { Fail ('Неизвестное действие: ' + $Action) }
}
