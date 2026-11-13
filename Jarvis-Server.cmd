@echo off
title Jarvis (model server)
cd /d "%~dp0"
set JARVIS_BRAIN=openai
echo Brain: YOUR OWN MODEL SERVER (LM Studio, llama.cpp, Odysseus...). Writes enabled.
echo Needs JARVIS_OPENAI_MODEL set. See README-openai.md.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" --writes %*
echo.
pause
