@echo off
title Jarvis
cd /d "%~dp0"
echo Starting Jarvis with WRITES enabled: it can open apps, type, click, press keys,
echo create files and ask the Gemini app. Use Jarvis-ReadOnly.cmd for the safe version.
echo Press Ctrl-C to stop.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
