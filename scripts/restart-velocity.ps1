# Reinicia SOLO la pila Velocity (no mata node de Adobe, MCP, etc.)
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\scripts\restart-velocity.ps1

$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port = 3000

Write-Host "=== Velocity: reinicio limpio (solo procesos del proyecto) ==="

# 1) Matar SOLO node que corre cluster.js / server.js / npm start del proyecto
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $cmd = $_.CommandLine
  if ($cmd -and ($cmd -match [regex]::Escape($Proj) -or $cmd -match 'cluster\.js|server\.js|velocity-music')) {
    Write-Host "  Stop PID $($_.ProcessId): $($cmd.Substring(0, [Math]::Min(100, $cmd.Length)))"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

# 2) Matar guardian PowerShell de Velocity
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $cmd = $_.CommandLine
  if ($cmd -and $cmd -match 'velocity-guardian\.ps1') {
    Write-Host "  Stop guardian PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 2

# 3) PostgreSQL (no bloquear si pg_ctl escribe a stderr)
$ready = & 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1 | Out-String
if ($ready -notmatch 'accepting|aceptando') {
  Write-Host "  Arrancando PostgreSQL..."
  try { Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue } catch {}
  try { net start postgresql-x64-16 2>&1 | Out-Null } catch {}
  Start-Sleep -Seconds 3
  $ready2 = & 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1 | Out-String
  if ($ready2 -notmatch 'accepting|aceptando') {
    $null = & 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' start -D 'C:\Program Files\PostgreSQL\16\data' -w -t 25 2>&1
  }
  Start-Sleep -Seconds 2
}

# 4) Guardian oculto
$vbs = Join-Path $Proj 'scripts\start-hidden.vbs'
Write-Host "  Lanzando guardian..."
Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`"" -WindowStyle Hidden
Start-Sleep -Seconds 12

# 5) Verificación
$pg = $false
try {
  $r = & 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1 | Out-String
  $pg = $r -match 'accepting|aceptando'
} catch {}
$be = [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
$cf = [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)

Write-Host ""
Write-Host ("  PostgreSQL:  " + $(if ($pg) { 'OK' } else { 'FALLO' }))
Write-Host ("  Backend :3000 " + $(if ($be) { 'OK' } else { 'FALLO' }))
Write-Host ("  Tunnel:       " + $(if ($cf) { 'OK' } else { 'FALLO' }))
if ($be) {
  try {
    $h = (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 5).Content
    Write-Host "  Health: $h"
  } catch { Write-Host "  Health: error $($_.Exception.Message)" }
}
Write-Host "=== Fin ==="
