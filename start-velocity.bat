@echo off
REM ============================================================
REM  VELOCITY MUSIC - Arranque automatico
REM  Levanta el backend + el tunel y muestra/copia la URL.
REM ============================================================

cd /d "%~dp0"

echo.
echo ==================================================
echo   VELOCITY MUSIC - Iniciando servidor...
echo ==================================================
echo.

REM --- 1. Evitar suspension ---
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
echo [OK] Suspension desactivada.

REM --- 2. Backend ---
echo [OK] Iniciando backend...
start "Velocity Backend" cmd /k "npm start"
timeout /t 6 /nobreak >nul

REM --- 3. Tunel con log a archivo ---
set LOGFILE=%TEMP%\vel-tunnel.log
if exist "%LOGFILE%" del "%LOGFILE%"
echo [OK] Iniciando tunel...
start "Velocity Tunnel" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000 2> "%LOGFILE%""

REM --- 4. Detectar URL con PowerShell y mostrarla ---
echo [OK] Esperando URL publica (15 segundos)...
timeout /t 15 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$log = $env:TEMP + '\vel-tunnel.log';" ^
  "for ($i=0; $i -lt 10; $i++) {" ^
  "  try { $c = Get-Content $log -EA Stop;" ^
  "    $m = $c | Select-String 'https://[a-z0-9-]+\.trycloudflare\.com';" ^
  "    if ($m) { $url = $m[-1].Matches[0].Value; break } } catch {}; Start-Sleep 2 };" ^
  "if ($url) {" ^
  "  Write-Host '';" ^
  "  Write-Host '================================================' -FG Green;" ^
  "  Write-Host '  URL PUBLICA LISTA PARA COMPARTIR:' -FG Green;" ^
  "  Write-Host '';" ^
  "  Write-Host ('  ' + $url) -FG Yellow;" ^
  "  Write-Host '';" ^
  "  Write-Host '  Copiada al portapapeles. Solo pega (Ctrl+V).' -FG Green;" ^
  "  Write-Host '================================================' -FG Green;" ^
  "  Set-Clipboard $url" ^
  "} else {" ^
  "  Write-Host 'No se detecto la URL.' -FG Red;" ^
  "  Write-Host 'Abre la ventana Velocity Tunnel y busca la linea trycloudflare.com' -FG Yellow" ^
  "}"

echo.
echo Esta ventana se puede cerrar.
echo Las ventanas "Velocity Backend" y "Velocity Tunnel" deben seguir abiertas.
echo.
pause
