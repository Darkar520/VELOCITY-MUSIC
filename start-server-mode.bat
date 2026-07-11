@echo off
:: Doble clic para activar modo servidor Velocity
cd /d "%~dp0"
echo.
echo  VELOCITY MUSIC - SERVER MODE
echo  (Clic derecho - Ejecutar como administrador = maximo efecto)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\server-mode.ps1"
echo.
pause
