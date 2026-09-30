@echo off
chcp 65001 >nul
rem Патч «Скопировать запрос» — ставится на работающую программу, сервер не останавливается.
rem Запускать от имени администратора на компьютере, где работает программа (сервер отдела).
net session >nul 2>&1
if errorlevel 1 (
  echo Нужны права администратора: правый клик по файлу - «Запуск от имени администратора».
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
