@echo off
title Jarvis
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" %*
echo.
pause
