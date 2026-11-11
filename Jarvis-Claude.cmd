@echo off
title Jarvis (Claude)
cd /d "%~dp0"
set JARVIS_BRAIN=claude
rem The phone page cannot use Claude, so it uses the local model (no Gemini quota involved).
if not defined JARVIS_PHONE_BRAIN set JARVIS_PHONE_BRAIN=ollama
if not defined JARVIS_MODEL set JARVIS_MODEL=claude-sonnet-5-5
if not defined JARVIS_EFFORT set JARVIS_EFFORT=low
echo Brain: CLAUDE (online, uses your Claude subscription, Sonnet at low effort). Writes enabled.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
