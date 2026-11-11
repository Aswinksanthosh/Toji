@echo off
title Jarvis (writes mode)
cd /d "%~dp0"
echo Starting Jarvis in WRITES mode: it can press keys, create files and ask the Gemini app.
echo Close private windows first. Press Ctrl-C to stop.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes
echo.
pause
