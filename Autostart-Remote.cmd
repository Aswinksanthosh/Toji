@echo off
title Remote buttons at sign-in
cd /d "%~dp0"
if /i "%1"=="remove" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\autostart-remote.ps1" -Remove
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\autostart-remote.ps1"
)
echo.
pause
