@echo off
title Jarvis shortcuts
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create-shortcuts.ps1"
echo.
pause
