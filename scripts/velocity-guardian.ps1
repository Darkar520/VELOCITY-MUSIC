# velocity-guardian.ps1 - VELOCITY MUSIC
# Keeps PostgreSQL, backend (:3000) and Cloudflare tunnel alive.
# Independent of IDEs/CLIs (Antigravity, Codex, Kilo, etc.).

$ErrorActionPreference = 'Continue'

$Proj      = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port      = 3000
$PgPort    = 5432
$PgCtl     = 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe'
$PgIsReady = 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe'
$PgDataDir = 'C:\Program Files\PostgreSQL\16\data'
$PgLogFile = 'C:\Program Files\PostgreSQL\16\data\log\pg_guardian.log'
$CfExe     = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$CfConfig  = 'C:\Users\irisp\.cloudflared\config.yml'
$PublicUrl = 'https://velocitymusic.uk'
$LogDir    = Join-Path $Proj 'logs'
$BackLog   = Join-Path $LogDir 'backend.log'
$CfLog     = Join-Path $LogDir 'tunnel.log'
$GuardLog  = Join-Path $LogDir 'guardian.log'
$UrlFile   = Join-Path $Proj  'current-url.txt'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
[System.IO.File]::WriteAllText($UrlFile, $PublicUrl, [System.Text.Encoding]::UTF8)

function Log([string]$msg) {
  $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $msg
  try { Add-Content -LiteralPath $GuardLog -Value $line -Encoding UTF8 } catch {}
}

$mutex = New-Object System.Threading.Mutex($false, 'Global\VelocityMusicGuardian')
if (-not $mutex.WaitOne(0)) {
  Log 'Another guardian instance is already running - exit'
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

try {
  $code = @'
using System;using System.Runtime.InteropServices;
public class SleepBlock {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_AWAYMODE = 0x00000040;
  public static void Prevent() { SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_AWAYMODE); }
}
'@
  Add-Type -TypeDefinition $code -Language CSharp
  [SleepBlock]::Prevent()
} catch {}

function Test-Postgres {
  try {
    $result = & $PgIsReady -h localhost -p $PgPort 2>&1 | Out-String
    return ($result -match 'accepting connections|aceptando conexiones')
  } catch { return $false }
}

function Test-Backend {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
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
  try {
    $svc = Get-Service postgresql-x64-16 -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Stopped') {
      net start postgresql-x64-16 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Log 'PostgreSQL started via Windows service'
        return
      }
    }
  } catch {}
  try {
    & $PgCtl start -D $PgDataDir -w -l $PgLogFile 2>&1 | Out-Null
    Log 'PostgreSQL started via pg_ctl'
  } catch {
    Log ('ERROR starting PostgreSQL: ' + $_.Exception.Message)
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
    Log 'ERROR: missing .env - backend not started'
    return
  }
  if (-not $env:JWT_SECRET -or -not $env:DATABASE_URL) {
    Log 'ERROR: .env incomplete (JWT_SECRET / DATABASE_URL) - backend not started'
    return
  }
  if (-not (Test-Path -LiteralPath $NodeExe)) {
    Log ('ERROR: node.exe not found: ' + $NodeExe)
    return
  }

  if (-not $env:USE_POSTGRES) { $env:USE_POSTGRES = '1' }
  if (-not $env:CLUSTER) { $env:CLUSTER = '1' }
  if (-not $env:NODE_ENV) { $env:NODE_ENV = 'production' }

  Log 'Starting backend (node cluster.js) detached...'
  try {
    $stamp = '`n===== Backend start {0} =====' -f (Get-Date)
    Add-Content -LiteralPath $BackLog -Value $stamp -Encoding UTF8
  } catch {}

  # Detached process: closing IDEs must NOT kill this node tree.
  # Do not redirect stdout+stderr to the same file (Windows lock issue).
  try {
    $p = Start-Process -FilePath $NodeExe `
      -ArgumentList 'cluster.js' `
      -WorkingDirectory $Proj `
      -WindowStyle Hidden `
      -PassThru `
      -ErrorAction Stop
    Log ('Backend started PID=' + $p.Id)
  } catch {
    Log ('ERROR Start-Process node: ' + $_.Exception.Message + ' - fallback cmd')
    try {
      $inner = 'cd /d "{0}" && node cluster.js >> "{1}" 2>&1' -f $Proj, $BackLog
      Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('start "VelocityBackend" /MIN cmd /c "{0}"' -f $inner) -WindowStyle Hidden | Out-Null
      Log 'Backend started via cmd fallback'
    } catch {
      Log ('ERROR fallback backend: ' + $_.Exception.Message)
    }
  }
}

function Start-Tunnel {
  if (-not (Test-Path -LiteralPath $CfExe)) {
    Log ('WARN: cloudflared missing: ' + $CfExe)
    return
  }
  Log 'Starting Cloudflare tunnel...'
  try {
    Start-Process -FilePath $CfExe `
      -ArgumentList @('tunnel', '--config', $CfConfig, 'run') `
      -WindowStyle Hidden `
      -RedirectStandardError $CfLog | Out-Null
    Log 'Tunnel started'
  } catch {
    Log ('ERROR tunnel: ' + $_.Exception.Message)
  }
}

while ($true) {
  try {
    if (-not (Test-Postgres)) {
      Start-Postgres
      [void](Wait-Postgres)
      Start-Sleep -Seconds 3
    }
    if (-not (Test-Backend)) {
      Log ('Backend not listening on :' + $Port + ' - restarting')
      Start-Backend
      Start-Sleep -Seconds 12
    }
    if (-not (Test-Tunnel)) {
      Start-Tunnel
      Start-Sleep -Seconds 5
    }
  } catch {
    Log ('ERROR guardian loop: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 15
}
