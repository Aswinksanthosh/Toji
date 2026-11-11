@echo off
title Jarvis (read-only)
cd /d "%~dp0"
echo Starting Jarvis READ-ONLY: it can look and answer, but cannot press keys, type, click or change files.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" %*
echo.
pause
