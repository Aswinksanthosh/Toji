@echo off
title Jarvis (local)
cd /d "%~dp0"
set JARVIS_BRAIN=ollama
rem Graphics cap while the local brain runs: this percent of the card's top speed. Change 80 to taste.
if not defined JARVIS_GPU_PERCENT set JARVIS_GPU_PERCENT=80
echo Brain: LOCAL (Ollama on this laptop). Nothing leaves your machine, writes enabled.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
