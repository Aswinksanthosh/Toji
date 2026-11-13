@echo off
title Jarvis remote buttons
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\remote.ps1"
echo.
pause
