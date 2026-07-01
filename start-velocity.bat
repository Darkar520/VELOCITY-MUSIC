@echo off
REM ============================================================
REM  VELOCITY MUSIC - Arranque automatico
REM  Levanta el backend + el tunel de Cloudflare y evita que
REM  la PC se suspenda mientras esten corriendo.
REM ============================================================

cd /d "%~dp0"

echo.
echo ==================================================
echo   VELOCITY MUSIC - Iniciando servidor...
echo ==================================================
echo.

REM --- 1. Evitar que la PC se suspenda (mientras este enchufada) ---
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
echo [OK] Suspension desactivada (con corriente).

REM --- 2. Arrancar el backend en una ventana propia ---
echo [OK] Iniciando backend (puerto 3000)...
start "Velocity Backend" cmd /k "npm start"

REM --- 3. Esperar a que el backend este listo ---
timeout /t 6 /nobreak >nul

REM --- 4. Arrancar el tunel de Cloudflare en otra ventana ---
echo [OK] Iniciando tunel de Cloudflare...
start "Velocity Tunnel" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000"

echo.
echo ==================================================
echo   Todo arrancado.
echo   La URL publica aparece en la ventana "Velocity Tunnel"
echo   (busca la linea con https://....trycloudflare.com)
echo ==================================================
echo.
echo Esta ventana se puede cerrar. Las otras dos deben
echo permanecer abiertas mientras uses la app.
echo.
pause
