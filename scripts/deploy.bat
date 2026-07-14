@echo off
cd /d "%~dp0\.."
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 %*
pause
