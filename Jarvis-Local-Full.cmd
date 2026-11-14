@echo off
title Jarvis (local, full speed)
cd /d "%~dp0"
set JARVIS_BRAIN=ollama
rem No graphics cap: full speed, more heat and fan noise. Use Jarvis-Local.cmd for the capped one.
set JARVIS_GPU_CAP=0
echo Brain: LOCAL (Ollama on this laptop), NO graphics cap. Nothing leaves your machine, writes enabled.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
