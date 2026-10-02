@echo off
chcp 65001 >nul
rem Установка «Конструктора КП» в постоянную папку C:\KP (данные сохраняются). Запрос прав администратора — разрешите.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-full.ps1"
