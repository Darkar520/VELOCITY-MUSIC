# ═══════════════════════════════════════════════════════════════
#  SERVER MODE — Opción A: laptop dedicada a Velocity Music
#
#  Un solo comando (mejor como Administrador):
#    powershell -ExecutionPolicy Bypass -File .\scripts\server-mode.ps1
#
#  Hace:
#    1) Ajusta energia / prioridades / servicios (si admin)
#    2) Instala autostart + tarea cada 2 min + bucle watchdog
#    3) Fuerza CLUSTER=0 WEB_CONCURRENCY=1 en .env
#    4) Levanta PG + backend + tunnel
#    5) Verifica local y publico
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Continue'
$Proj = Split-Path $PSScriptRoot -Parent
if (-not $Proj) { $Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC' }
Set-Location $Proj

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host ''
Write-Host '============================================'
Write-Host '  VELOCITY MUSIC — SERVER MODE (Opcion A)'
Write-Host '============================================'
Write-Host ("  Admin: {0}" -f $isAdmin)
Write-Host ("  Proyecto: {0}" -f $Proj)
Write-Host ''

# --- .env: single process ---
$envFile = Join-Path $Proj '.env'
if (Test-Path $envFile) {
  $lines = Get-Content $envFile -Encoding UTF8
  $hasWc = $false
  $hasCl = $false
  $out = foreach ($line in $lines) {
    if ($line -match '^\s*WEB_CONCURRENCY\s*=') { $hasWc = $true; 'WEB_CONCURRENCY=1' }
    elseif ($line -match '^\s*CLUSTER\s*=') { $hasCl = $true; 'CLUSTER=0' }
    elseif ($line -match '^\s*USE_POSTGRES\s*=') { 'USE_POSTGRES=1' }
    elseif ($line -match '^\s*NODE_ENV\s*=') { 'NODE_ENV=production' }
    else { $line }
  }
  if (-not $hasWc) { $out += 'WEB_CONCURRENCY=1' }
  if (-not $hasCl) { $out += 'CLUSTER=0' }
  $out | Set-Content -LiteralPath $envFile -Encoding UTF8
  Write-Host '[1/6] .env: CLUSTER=0 WEB_CONCURRENCY=1 USE_POSTGRES=1'
} else {
  Write-Host '[1/6] WARN: no hay .env — crea uno desde .env.example'
}

# --- Optimize ---
Write-Host '[2/6] Optimizando energia y prioridades...'
& (Join-Path $PSScriptRoot 'optimize-laptop-server.ps1')

# --- Install persistence ---
Write-Host '[3/6] Instalando autostart + watchdog...'
& (Join-Path $PSScriptRoot 'install-server-mode.ps1')

# --- Kill stale multi-process velocity ---
Write-Host '[4/6] Limpiando procesos viejos de Velocity...'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $c = $_.CommandLine
  if ($c -and ($c -like '*cluster.js*' -or $c -like '*server.js*' -or $c -like "*$Proj*")) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -like '*velocity-guardian*') {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2

# --- Bring stack up ---
Write-Host '[5/6] Levantando stack...'
& (Join-Path $PSScriptRoot 'ensure-running.ps1')
Start-Sleep -Seconds 4
& (Join-Path $PSScriptRoot 'ensure-running.ps1')
Start-Sleep -Seconds 2

# Priority again after start
$projHint = 'VELOCITY MUSIC'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $c = $_.CommandLine
  if ($c -and ($c -like '*server.js*' -or $c -like '*cluster.js*' -or $c -like "*$projHint*")) {
    try { (Get-Process -Id $_.ProcessId).PriorityClass = 'High' } catch {}
  }
}
foreach ($n in @('postgres', 'cloudflared')) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.PriorityClass = 'High' } catch {}
  }
}

# --- Verify ---
Write-Host '[6/6] Verificacion...'
Write-Host ''
$pg = $false
try {
  $pr = & 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1 | Out-String
  $pg = $pr -match 'accepting|aceptando'
  Write-Host ("  PostgreSQL:  {0}" -f $(if ($pg) { 'OK' } else { 'FALLO' }))
} catch { Write-Host '  PostgreSQL:  FALLO' }

$localOk = $false
try {
  $s = Invoke-WebRequest 'http://127.0.0.1:3000/api/status' -UseBasicParsing -TimeoutSec 5
  $localOk = ($s.StatusCode -eq 200)
  Write-Host ("  Local API:   OK  {0}" -f $s.Content)
} catch { Write-Host '  Local API:   FALLO' }

try {
  $h = Invoke-WebRequest 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 5
  Write-Host ("  Local health:{0} {1}" -f $h.StatusCode, $h.Content)
} catch { Write-Host '  Local health: FALLO' }

try {
  $p = Invoke-WebRequest 'https://velocitymusic.uk/api/status' -UseBasicParsing -TimeoutSec 12
  Write-Host ("  Public API:  OK  {0}" -f $p.Content)
} catch { Write-Host ("  Public API:  FALLO  {0}" -f $_.Exception.Message) }

try {
  $c = Invoke-WebRequest 'https://velocitymusic.uk/api/auth/config' -UseBasicParsing -TimeoutSec 12
  Write-Host ("  Google cfg:  {0}" -f $c.Content)
} catch { Write-Host '  Google cfg:  FALLO' }

$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$total = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Write-Host ("  RAM libre:   {0} GB / {1} GB" -f $free, $total)

$watch = $false
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*watchdog-loop.vbs*') { $watch = $true }
}
Write-Host ("  Watchdog:    {0}" -f $(if ($watch) { 'OK (bucle 60s)' } else { 'no detectado (se relanza al login / tarea)' }))

Write-Host ''
Write-Host '============================================'
if ($localOk -and $pg) {
  Write-Host '  SERVER MODE ACTIVO'
  Write-Host '  velocitymusic.uk deberia responder.'
} else {
  Write-Host '  ALGO FALLO — revisa logs\ensure.log'
}
Write-Host '============================================'
Write-Host ''
Write-Host 'Reglas de oro en modo servidor:'
Write-Host '  - No hibernar / no apagar la laptop'
Write-Host '  - Cierra Photoshop/Chrome pesado si hay usuarios'
Write-Host '  - No ejecutes: Get-Process node | Stop-Process'
Write-Host '  - Si cae:  .\scripts\ensure-running.ps1'
Write-Host ''
if (-not $isAdmin) {
  Write-Host 'TIP: vuelve a ejecutar este script como Administrador'
  Write-Host '     para detener SysMain/WSearch y fijar recovery de PostgreSQL.'
  Write-Host ''
}
