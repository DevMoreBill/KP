@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Сборка "Конструктор КП.exe"...
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% -m pip install --upgrade -r requirements-build.txt || goto :err
%PY% -m PyInstaller --noconfirm --clean kp.spec || goto :err
echo.
echo Готово: dist\Конструктор КП.exe
pause
exit /b 0
:err
echo.
echo Ошибка сборки. Нужен установленный Python 3.8+ (https://www.python.org/downloads/).
pause
exit /b 1
