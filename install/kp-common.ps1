# Общее для установщиков «Конструктора КП»: постоянная папка программы — C:\KP.
# Совместимо с PowerShell 2.0 (Windows 7).
$ErrorActionPreference = 'Stop'
$KP = 'C:\KP'
$TASK = 'Конструктор КП — сервер отдела'

function Need-Admin($script, $more) {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # перезапуск с правами администратора (окно UAC)
    Start-Process powershell -Verb RunAs -ArgumentList (('-NoProfile -ExecutionPolicy Bypass -File "{0}" ' -f $script) + [string]$more) | Out-Null
    exit 0
  }
}

function Find-Exe($dir) {
  Get-ChildItem -LiteralPath $dir -Filter 'Конструктор КП*.exe' -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Sort-Object Name | Select-Object -First 1
}

function Task-Exists { schtasks /Query /TN $TASK > $null 2>&1; return ($LASTEXITCODE -eq 0) }

$PORT = 17845

# процессы программы: EXE «Конструктор КП» (где бы ни лежал), любой EXE из папки программы и тот, кто занял порт 17845.
# Через WMI — он видит и процессы сервера отдела, запущенные Планировщиком от имени SYSTEM (Get-Process их путь не показывает).
function Get-KPProcs($dir) {
  $dir = ([string]$dir).TrimEnd('\')
  $all = @(Get-WmiObject Win32_Process -ErrorAction SilentlyContinue)
  $out = @($all | Where-Object { ($_.Name -like 'Конструктор КП*.exe') -or
    ($dir -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir + '\', [StringComparison]::OrdinalIgnoreCase) -and $_.Name -like '*.exe') })
  foreach ($line in @(netstat -ano 2>$null)) {
    if ($line -match ('^\s*TCP\s+\S+:' + $PORT + '\s+(0\.0\.0\.0:0|\[::\]:0)\s+\S+\s+(\d+)\s*$')) {
      $procId = [int]$matches[2]
      if ($procId -gt 4 -and -not ($out | Where-Object { $_.ProcessId -eq $procId })) {
        $p = $all | Where-Object { $_.ProcessId -eq $procId } | Select-Object -First 1
        if ($p -and $p.Name -notmatch '^(svchost|System|lsass|services)\.exe$') { $out += $p } } }
  }
  return ,$out
}

# остановить программу полностью (в том числе сервер отдела): попросить закрыться (база сохраняется корректно),
# остановить задачу Планировщика, завершить оставшиеся процессы вместе с дочерними; true — ничего не осталось
function Stop-KP($dir) {
  if (-not $dir) { $dir = $KP }
  try { $wc = New-Object Net.WebClient; $wc.Proxy = $null; $wc.UploadString(('http://127.0.0.1:{0}/api/shutdown' -f $PORT), '') | Out-Null } catch { }
  for ($k = 0; $k -lt 16 -and (Get-KPProcs $dir).Count; $k++) { Start-Sleep -Milliseconds 500 }
  if (Task-Exists) { schtasks /End /TN $TASK > $null 2>&1 }
  for ($k = 0; $k -lt 5; $k++) {
    $left = Get-KPProcs $dir
    if (-not $left.Count) { break }
    foreach ($p in $left) {
      Write-Host ('  завершаю ' + $p.Name + ' (PID ' + $p.ProcessId + ')')
      taskkill /PID $p.ProcessId /T /F > $null 2>&1
      if ($LASTEXITCODE -ne 0) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }
    Start-Sleep -Seconds 2
  }
  return -not (Get-KPProcs $dir).Count
}

# адрес отвечает — программа работает
function Ping-KP { try { $wc = New-Object Net.WebClient; $wc.Proxy = $null; $wc.DownloadString(('http://127.0.0.1:{0}/api/ping' -f $PORT)) | Out-Null; return $true } catch { return $false } }

function Start-KP($exe) {
  if (Task-Exists) { schtasks /Run /TN $TASK > $null 2>&1; Write-Host '  сервер отдела запускается' }
  else { Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) | Out-Null; Write-Host '  программа запускается' }
  for ($k = 0; $k -lt 30 -and -not (Ping-KP); $k++) { Start-Sleep -Seconds 1 }
  return (Ping-KP)
}

# прежние файлы управления сервером: их заменили «2. Остановить сервер.cmd», «3. Запустить сервер.cmd»,
# «4. Удалить сервер отдела.cmd» и «5. Резервная копия базы.bat»
function Remove-OldServerFiles {
  foreach ($n in @('2. Остановить и удалить сервер отдела.bat', '3. Резервная копия базы.bat')) {
    $f = Join-Path $KP ('server-setup\' + $n)
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } }
}

function Done($text) { Write-Host ''; Write-Host $text -ForegroundColor Green; Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null; exit 1 }
