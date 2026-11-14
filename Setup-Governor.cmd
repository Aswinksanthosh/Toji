@echo off
title Graphics temperature cap setup
cd /d "%~dp0"
if /i "%1"=="remove" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-governor.ps1" -Remove
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-governor.ps1"
)
echo.
pause
