@echo off
title Jarvis phone setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-phone.ps1"
echo.
pause
