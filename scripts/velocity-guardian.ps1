# velocity-guardian.ps1 - keeps PG + backend :3000 + cloudflared alive
# Independent of IDEs. Safe defaults for low-RAM desktops.

$ErrorActionPreference = 'Continue'

$Proj      = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port      = 3000
$PgPort    = 5432
$PgCtl     = 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe'
$PgIsReady = 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe'
$PgDataDir = 'C:\Program Files\PostgreSQL\16\data'
# NEVER write pg_ctl log inside data\log (sharing violation + slow fsync with AV)
$PgLogFile = Join-Path $LogDir 'pg_ctl_start.log'
$CfExe     = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$CfConfig  = 'C:\Users\irisp\.cloudflared\config.yml'
$PublicUrl = 'https://velocitymusic.uk'
$LogDir    = Join-Path $Proj 'logs'
$BackLog   = Join-Path $LogDir 'backend.log'
$CfLog     = Join-Path $LogDir 'tunnel.log'
$GuardLog  = Join-Path $LogDir 'guardian.log'
$UrlFile   = Join-Path $Proj  'current-url.txt'
$HeartbeatEvery = 4   # log heartbeat every N loops (~1 min if sleep=15)

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
try { [System.IO.File]::WriteAllText($UrlFile, $PublicUrl, [System.Text.Encoding]::UTF8) } catch {}

function Log([string]$msg) {
  $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $msg
  try { Add-Content -LiteralPath $GuardLog -Value $line -Encoding UTF8 } catch {}
}

$mutex = New-Object System.Threading.Mutex($false, 'Global\VelocityMusicGuardian')
if (-not $mutex.WaitOne(0)) {
  # Another guardian claims the mutex - exit quietly
  exit 0
}

Log ("Guardian started PID=" + $PID)

$NodeExe = $null
try {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $NodeExe = $cmd.Source }
} catch {}
if (-not $NodeExe) { $NodeExe = 'C:\Program Files\nodejs\node.exe' }

try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change standby-timeout-dc 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-dc 0 | Out-Null
} catch {}

function Test-Postgres {
  try {
    $result = & $PgIsReady -h localhost -p $PgPort 2>&1 | Out-String
    return ($result -match 'accepting connections|aceptando conexiones')
  } catch { return $false }
}

function Test-BackendPort {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-BackendHttp {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/status" -f $Port) -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

function Test-Tunnel {
  return [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)
}

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { return }
    $val = $line.Substring($eq + 1).Trim()
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $existing = [Environment]::GetEnvironmentVariable($key, 'Process')
    if ($null -eq $existing -or $existing -eq '') {
      [Environment]::SetEnvironmentVariable($key, $val, 'Process')
    }
  }
  return $true
}

function Start-Postgres {
  Log 'PostgreSQL down - starting...'
  # If postgres.exe already running (recovery), wait - do NOT start a second copy.
  if (Get-Process postgres -ErrorAction SilentlyContinue) {
    Log 'postgres.exe present - waiting for recovery (no second start)'
    return
  }
  try {
    $svc = Get-Service postgresql-x64-16 -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') {
      try { Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Seconds 4
      if (Test-Postgres) { Log 'PostgreSQL started via service'; return }
      net start postgresql-x64-16 2>&1 | Out-Null
      Start-Sleep -Seconds 4
      if (Test-Postgres) { Log 'PostgreSQL started via net start'; return }
    }
  } catch {}
  try {
    # Log OUTSIDE data dir to avoid sharing violation with postgres log collector
    & $PgCtl start -D $PgDataDir -w -t 60 -l $PgLogFile 2>&1 | Out-Null
    Log 'PostgreSQL started via pg_ctl'
  } catch {
    Log ('ERROR PostgreSQL: ' + $_.Exception.Message)
  }
}

function Wait-Postgres {
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-Postgres) { return $true }
    Start-Sleep -Seconds 2
  }
  Log 'WARN: PostgreSQL not ready after 40s'
  return $false
}

function Start-Backend {
  if (-not (Test-Postgres)) {
    Log 'Backend skip: PostgreSQL not ready'
    return
  }
  $envFile = Join-Path $Proj '.env'
  if (-not (Import-DotEnv $envFile)) {
    Log 'ERROR: missing .env'
    return
  }
  if (-not $env:JWT_SECRET -or -not $env:DATABASE_URL) {
    Log 'ERROR: .env incomplete (JWT_SECRET / DATABASE_URL)'
    return
  }
  if (-not (Test-Path -LiteralPath $NodeExe)) {
    Log ('ERROR: node not found: ' + $NodeExe)
    return
  }

  if (-not $env:USE_POSTGRES) { $env:USE_POSTGRES = '1' }
  if (-not $env:CLUSTER) { $env:CLUSTER = '1' }
  if (-not $env:NODE_ENV) { $env:NODE_ENV = 'production' }
  # Cap workers on home PCs (memory). Explicit WEB_CONCURRENCY in .env wins via Import-DotEnv.
  if (-not $env:WEB_CONCURRENCY) { $env:WEB_CONCURRENCY = '2' }

  Log 'Starting backend node cluster.js detached...'
  try {
    $p = Start-Process -FilePath $NodeExe `
      -ArgumentList 'cluster.js' `
      -WorkingDirectory $Proj `
      -WindowStyle Hidden `
      -PassThru `
      -ErrorAction Stop
    Log ('Backend started PID=' + $p.Id)
  } catch {
    Log ('ERROR Start-Process: ' + $_.Exception.Message)
    try {
      $inner = 'cd /d "{0}" && set WEB_CONCURRENCY=2&& node cluster.js >> "{1}" 2>&1' -f $Proj, $BackLog
      Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('start "VelocityBackend" /MIN cmd /c "{0}"' -f $inner) -WindowStyle Hidden | Out-Null
      Log 'Backend started via cmd fallback'
    } catch {
      Log ('ERROR fallback: ' + $_.Exception.Message)
    }
  }
}

function Start-Tunnel {
  if (-not (Test-Path -LiteralPath $CfExe)) {
    Log ('WARN: cloudflared missing')
    return
  }
  if (Test-Tunnel) { return }
  Log 'Starting Cloudflare tunnel...'
  try {
    Start-Process -FilePath $CfExe `
      -ArgumentList @('tunnel', '--config', $CfConfig, 'run') `
      -WindowStyle Hidden | Out-Null
    Log 'Tunnel started'
  } catch {
    Log ('ERROR tunnel: ' + $_.Exception.Message)
  }
}

$loop = 0
while ($true) {
  $loop++
  try {
    if (-not (Test-Postgres)) {
      Start-Postgres
      [void](Wait-Postgres)
      Start-Sleep -Seconds 2
    }

    $portUp = Test-BackendPort
    $httpUp = $false
    if ($portUp) { $httpUp = Test-BackendHttp }

    if (-not $portUp -or -not $httpUp) {
      if ($portUp -and -not $httpUp) {
        Log 'Backend port open but /api/status dead - killing stale node and restarting'
        # Kill only Velocity cluster processes
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
          if ($_.CommandLine -and ($_.CommandLine -like '*cluster.js*' -or $_.CommandLine -like ("*{0}*" -f $Proj))) {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
          }
        }
        Start-Sleep -Seconds 2
      } else {
        Log 'Backend down - restarting'
      }
      Start-Backend
      Start-Sleep -Seconds 12
    }

    if (-not (Test-Tunnel)) {
      Start-Tunnel
      Start-Sleep -Seconds 4
    }

    if (($loop % $HeartbeatEvery) -eq 0) {
      $pg = Test-Postgres
      $be = Test-BackendPort
      $http = if ($be) { Test-BackendHttp } else { $false }
      $cf = Test-Tunnel
      Log ("heartbeat pg={0} port={1} http={2} tunnel={3}" -f $pg, $be, $http, $cf)
    }
  } catch {
    Log ('ERROR loop: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 15
}
