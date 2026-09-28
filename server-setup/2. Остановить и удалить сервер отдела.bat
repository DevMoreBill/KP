@echo off
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 ( echo Запустите от имени администратора. & pause & exit /b 1 )
cd /d "%~dp0.."
schtasks /End /TN "Конструктор КП — сервер отдела" >nul 2>&1
schtasks /Delete /TN "Конструктор КП — сервер отдела" /F >nul 2>&1
taskkill /IM "Конструктор КП*.exe" /F >nul 2>&1
netsh advfirewall firewall delete rule name="Конструктор КП" >nul 2>&1
net share КП /delete /y >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='settings.json'; if (Test-Path $p) { $j=Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json; $j.mode='local'; [IO.File]::WriteAllText((Join-Path (Get-Location) $p), ($j | ConvertTo-Json), (New-Object Text.UTF8Encoding $false)) }"
echo Сервер отдела остановлен и удалён. Программа снова работает как обычная (только на этом компьютере).
echo Данные (папка data) и готовые КП не тронуты.
pause
