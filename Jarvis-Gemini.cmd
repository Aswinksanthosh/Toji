@echo off
title Jarvis (Gemini)
cd /d "%~dp0"
set JARVIS_BRAIN=gemini
if not defined JARVIS_DISABLE set JARVIS_DISABLE=browser
echo Brain: GEMINI (online, free key). Writes enabled.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
