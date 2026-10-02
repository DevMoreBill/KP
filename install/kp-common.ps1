# Общее для установщиков «Конструктора КП»: постоянная папка программы — C:\KP.
# Совместимо с PowerShell 2.0 (Windows 7).
$ErrorActionPreference = 'Stop'
$KP = 'C:\KP'
$TASK = 'Конструктор КП — сервер отдела'

function Need-Admin($script) {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # перезапуск с правами администратора (окно UAC)
    Start-Process powershell -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script) | Out-Null
    exit 0
  }
}

function Find-Exe($dir) {
  Get-ChildItem -LiteralPath $dir -Filter 'Конструктор КП*.exe' -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Sort-Object Name | Select-Object -First 1
}

function Task-Exists { schtasks /Query /TN $TASK > $null 2>&1; return ($LASTEXITCODE -eq 0) }

# остановить программу, запущенную из C:\KP (в том числе сервер отдела)
function Stop-KP {
  if (Task-Exists) { schtasks /End /TN $TASK > $null 2>&1 }
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($KP + '\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
    Write-Host ('  останавливаю ' + $_.ProcessName); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

function Start-KP($exe) {
  if (Task-Exists) { schtasks /Run /TN $TASK > $null 2>&1; Write-Host '  сервер отдела запущен' }
  else { Start-Process -FilePath $exe -WorkingDirectory $KP | Out-Null; Write-Host '  программа запущена' }
}

function Done($text) { Write-Host ''; Write-Host $text -ForegroundColor Green; Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null; exit 1 }
