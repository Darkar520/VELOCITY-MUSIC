@echo off
:: ============================================================
::  VELOCITY MUSIC - Reinicio completo (requiere Administrador)
::  Ejecutar con clic derecho → "Ejecutar como administrador"
:: ============================================================

:: Auto-elevate if not admin
net session >nul 2>&1
if errorlevel 1 (
    echo Solicitando permisos de administrador...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0\.."

echo.
echo ============================================
echo   VELOCITY MUSIC - Reinicio completo
echo ============================================
echo.

:: 1. Matar procesos node que puedan estar colgados
echo [1/5] Limpiando procesos node colgados...
taskkill /f /im node.exe >nul 2>&1
echo       Hecho.
timeout /t 2 /nobreak >nul

:: 2. Iniciar PostgreSQL
echo [2/5] Iniciando PostgreSQL...
net start postgresql-x64-16
if errorlevel 1 (
    echo       PostgreSQL ya estaba corriendo o hubo un error menor.
) else (
    echo       PostgreSQL iniciado correctamente.
)
timeout /t 3 /nobreak >nul

:: 3. Verificar PostgreSQL
echo [3/5] Verificando PostgreSQL...
"C:\Program Files\PostgreSQL\16\bin\pg_isready.exe" -h localhost -p 5432
if errorlevel 1 (
    echo       [ERROR] PostgreSQL no responde. Verifica manualmente.
    pause
    exit /b 1
)
echo       PostgreSQL listo.

:: 4. Lanzar el guardian (backend + tunnel watchdog)
echo [4/5] Iniciando Velocity Guardian...
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0velocity-guardian.ps1"
timeout /t 8 /nobreak >nul

:: 5. Verificar backend
echo [5/5] Verificando backend...
powershell -NoProfile -Command "for ($i=0; $i -lt 15; $i++) { if (Get-NetTCPConnection -State Listen -LocalPort 3000 -EA SilentlyContinue) { Write-Host '      Backend escuchando en puerto 3000 - OK!' -FG Green; exit 0 }; Start-Sleep 2 }; Write-Host '      Backend aun no responde, espera unos segundos mas...' -FG Yellow"

echo.
echo ============================================
echo   RESULTADO:
echo ============================================
powershell -NoProfile -Command ^
  "$pg = [bool](Get-NetTCPConnection -State Listen -LocalPort 5432 -EA SilentlyContinue);" ^
  "$be = [bool](Get-NetTCPConnection -State Listen -LocalPort 3000 -EA SilentlyContinue);" ^
  "$cf = [bool](Get-Process cloudflared -EA SilentlyContinue);" ^
  "Write-Host ('  PostgreSQL:       ' + $(if($pg){'OK'}else{'FALLO'})) -FG $(if($pg){'Green'}else{'Red'});" ^
  "Write-Host ('  Backend Node.js:  ' + $(if($be){'OK'}else{'FALLO'})) -FG $(if($be){'Green'}else{'Red'});" ^
  "Write-Host ('  Cloudflare Tunnel:' + $(if($cf){'OK'}else{'FALLO'})) -FG $(if($cf){'Green'}else{'Red'});" ^
  "if ($pg -and $be -and $cf) { Write-Host ''; Write-Host '  Todo funcionando! velocitymusic.uk esta en linea.' -FG Green }"
echo.
echo ============================================
echo.
pause
