# Primary recovery: Scheduled Task (2 min) + watchdog-loop.vbs (60 s).
# Does NOT depend on a long-lived PowerShell guardian process.
$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port = 3000
$LogDir = Join-Path $Proj 'logs'
$Log = Join-Path $LogDir 'ensure.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Keep C:\velocity-ops copy fresh for schtasks (path without spaces)
try {
  $short = 'C:\velocity-ops'
  if (Test-Path $short) {
    Copy-Item -Force (Join-Path $Proj 'scripts\ensure-running.ps1') (Join-Path $short 'ensure-running.ps1') -ErrorAction SilentlyContinue
    Copy-Item -Force (Join-Path $Proj 'scripts\start-backend-once.ps1') (Join-Path $short 'start-backend-once.ps1') -ErrorAction SilentlyContinue
  }
} catch {}

function ELog($m) {
  $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $m
  try { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 } catch {}
}

function PgReady {
  try {
    $r = & 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1 | Out-String
    return ($r -match 'accepting|aceptando')
  } catch { return $false }
}

function HttpOk {
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function TunnelUp {
  return [bool](Get-Process cloudflared -EA SilentlyContinue)
}

# --- 1) PostgreSQL ---
if (-not (PgReady)) {
  ELog 'PG down'
  # If postgres already recovering, wait
  if (Get-Process postgres -EA SilentlyContinue) {
    ELog 'postgres.exe running - wait recovery'
    for ($i = 0; $i -lt 30; $i++) {
      if (PgReady) { break }
      Start-Sleep 2
    }
  }
  if (-not (PgReady)) {
    try { Start-Service postgresql-x64-16 -EA SilentlyContinue } catch {}
    Start-Sleep 3
  }
  if (-not (PgReady)) {
    $pgLog = Join-Path $LogDir 'pg_ctl_start.log'
    try {
      $null = & 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' start -D 'C:\Program Files\PostgreSQL\16\data' -w -t 60 -l $pgLog 2>&1
    } catch {}
    Start-Sleep 2
  }
  if (PgReady) { ELog 'PG OK' } else { ELog 'PG STILL DOWN'; exit 1 }
}

# --- 2) Backend ---
if (-not (HttpOk)) {
  ELog 'Backend HTTP down - start-backend-once'
  & (Join-Path $Proj 'scripts\start-backend-once.ps1')
  Start-Sleep 3
  if (HttpOk) { ELog 'Backend recovered' } else { ELog 'Backend STILL DOWN' }
}

# --- 3) Tunnel ---
if (-not (TunnelUp)) {
  $cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  $cfg = 'C:\Users\irisp\.cloudflared\config.yml'
  if (Test-Path $cf) {
    ELog 'Starting tunnel'
    Start-Process -FilePath $cf -ArgumentList @('tunnel','--config',$cfg,'run') -WindowStyle Hidden | Out-Null
  }
}

if ((PgReady) -and (HttpOk)) {
  # Keep Velocity node at High priority (Photoshop can steal CPU otherwise)
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $c = $_.CommandLine
    if ($c -and ($c -like '*server.js*' -or $c -like '*cluster.js*' -or $c -like "*$Proj*")) {
      try { (Get-Process -Id $_.ProcessId).PriorityClass = 'High' } catch {}
    }
  }
  foreach ($n in @('postgres', 'cloudflared')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
      try { $_.PriorityClass = 'High' } catch {}
    }
  }
  ELog 'OK all up'
}
