@echo off
title Jarvis (Gemini)
cd /d "%~dp0"
set JARVIS_BRAIN=gemini
echo Brain: GEMINI (online, free key). Writes enabled.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
