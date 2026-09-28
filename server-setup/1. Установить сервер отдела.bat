@echo off
chcp 65001 >nul
setlocal
rem ===== Сервер отдела: программа работает на ЭТОМ компьютере, сотрудники открывают её в браузере по сети =====
rem Запускать от имени администратора (правый клик → «Запуск от имени администратора»).
net session >nul 2>&1
if errorlevel 1 (
  echo Нужны права администратора: правый клик по файлу → «Запуск от имени администратора».
  pause & exit /b 1
)
cd /d "%~dp0.."
set "EXE="
for %%F in ("Конструктор КП*.exe") do if not defined EXE set "EXE=%%~fF"
if not defined EXE (
  echo Не найден «Конструктор КП.exe» в папке %CD%
  echo Положите папку «server-setup» рядом с EXE и запустите снова.
  pause & exit /b 1
)
set PORT=17845
echo.
echo [1/4] Настройка режима «сервер отдела»...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='settings.json'; $s=@{}; if (Test-Path $p) { try { $j=Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json; $j.PSObject.Properties | %% { $s[$_.Name]=$_.Value } } catch {} };" ^
  "$s['mode']='server'; $s['port']=%PORT%; $s['docsShare']='\\'+$env:COMPUTERNAME+'\КП';" ^
  "if (-not $s.ContainsKey('dataDir')) { $s['dataDir']='' };" ^
  "[IO.File]::WriteAllText((Join-Path (Get-Location) $p), ($s | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))"
echo [2/4] Разрешение входящих подключений в брандмауэре (порт %PORT%)...
netsh advfirewall firewall delete rule name="Конструктор КП" >nul 2>&1
netsh advfirewall firewall add rule name="Конструктор КП" dir=in action=allow protocol=TCP localport=%PORT% profile=domain,private >nul
echo [3/4] Общий доступ к папке с готовыми КП (только чтение): \\%COMPUTERNAME%\КП
if not exist "Коммерческие предложения" mkdir "Коммерческие предложения"
net share КП /delete /y >nul 2>&1
net share КП="%CD%\Коммерческие предложения" /GRANT:Все,READ >nul 2>&1 || net share КП="%CD%\Коммерческие предложения" /GRANT:Everyone,READ >nul 2>&1
echo [4/4] Автозапуск при включении компьютера (без входа пользователя)...
schtasks /Delete /TN "Конструктор КП — сервер отдела" /F >nul 2>&1
schtasks /Create /TN "Конструктор КП — сервер отдела" /TR "\"%EXE%\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul
schtasks /Run /TN "Конструктор КП — сервер отдела" >nul
rem ярлык для сотрудников
> "server-setup\Конструктор КП (сервер %COMPUTERNAME%).url" echo [InternetShortcut]
>>"server-setup\Конструктор КП (сервер %COMPUTERNAME%).url" echo URL=http://%COMPUTERNAME%:%PORT%/
echo.
echo ================================================================
echo  Готово. Сервер отдела запущен и будет стартовать вместе с Windows.
echo  Адрес для сотрудников:  http://%COMPUTERNAME%:%PORT%/
echo  Ярлык для рассылки:     server-setup\Конструктор КП (сервер %COMPUTERNAME%).url
echo  Готовые КП:             \\%COMPUTERNAME%\КП
echo  База данных:            data\kp.sqlite3  (делайте резервные копии папки data)
echo ================================================================
pause
