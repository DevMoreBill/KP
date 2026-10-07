@echo off
rem Konstruktor KP: remove (see kp-server.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kp-server.ps1" -Action remove
