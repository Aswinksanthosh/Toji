@echo off
title Jarvis (local)
cd /d "%~dp0"
set JARVIS_BRAIN=ollama
echo Brain: LOCAL (Ollama on this laptop). Nothing leaves your machine, writes enabled.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
