@echo off
chcp 65001 >nul
rem Обновление «Конструктора КП» в C:\KP без скачивания полного комплекта. Запрос прав администратора — разрешите.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-update.ps1"
