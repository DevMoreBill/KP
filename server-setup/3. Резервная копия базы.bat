@echo off
chcp 65001 >nul
rem Резервная копия: база (согласованная копия «на ходу») + изображения в папку backup\ГГГГ-ММ-ДД_ЧЧММ.
rem Запускать на компьютере-сервере. Можно поставить в Планировщик заданий на каждый вечер.
cd /d "%~dp0.."
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "try { (Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17845/api/backup' -TimeoutSec 60).dir } catch { '' }"`) do set "DST=%%d"
if not defined DST (
  echo Программа не запущена — копирую файлы базы напрямую.
  for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "DST=%CD%\backup\%%t"
  mkdir "%DST%" >nul 2>&1
  copy /y "data\kp.sqlite3" "%DST%\" >nul
)
robocopy "data\img" "%DST%\img" /E /NFL /NDL /NJH /NJS >nul
echo Резервная копия: %DST%
timeout /t 5
