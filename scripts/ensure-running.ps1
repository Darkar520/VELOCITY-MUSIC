# Lightweight watchdog: if guardian or backend is down, start them.
# Designed for Scheduled Task every 5 minutes. Safe if already running.
$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port = 3000
$LogDir = Join-Path $Proj 'logs'
$Log = Join-Path $LogDir 'ensure.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function ELog($m) {
  $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $m
  try { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 } catch {}
}

function PortUp {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function HttpUp {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/status" -f $Port) -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function GuardianAlive {
  $found = $false
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like '*velocity-guardian.ps1*') { $found = $true }
  }
  return $found
}

function PgUp {
  try {
    $r = & 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1 | Out-String
    return ($r -match 'accepting|aceptando')
  } catch { return $false }
}

# 1) PostgreSQL
if (-not (PgUp)) {
  ELog 'PG down - Start-Service'
  try { Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 3
  if (-not (PgUp)) {
    try {
      & 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' start -D 'C:\Program Files\PostgreSQL\16\data' -w -t 20 2>&1 | Out-Null
    } catch {}
  }
}

# 2) Guardian
if (-not (GuardianAlive)) {
  ELog 'Guardian missing - launching'
  $guard = Join-Path $Proj 'scripts\velocity-guardian.ps1'
  $arg = '-NoProfile -ExecutionPolicy Bypass -File "' + $guard + '"'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arg -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 15
}

# 3) Backend HTTP
if (-not (HttpUp)) {
  ELog 'HTTP status fail - restart guardian path'
  # Let guardian handle restart; if still down after wait, force node start via guardian loop
  Start-Sleep -Seconds 20
  if (-not (HttpUp)) {
    ELog 'Still down after wait'
  } else {
    ELog 'Recovered'
  }
} else {
  # Quiet success - only log every run is noisy; log OK lightly
  # ELog 'OK'
}
