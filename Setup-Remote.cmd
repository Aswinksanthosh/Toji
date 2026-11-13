@echo off
title Jarvis remote setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-remote.ps1"
echo.
pause
