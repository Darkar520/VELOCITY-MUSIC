# Start Velocity backend once (detached). Safe to call if already up.
$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port = 3000
$LogDir = Join-Path $Proj 'logs'
$BackLog = Join-Path $LogDir 'backend.log'
$EnvFile = Join-Path $Proj '.env'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log($m) {
  $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $m
  try { Add-Content (Join-Path $LogDir 'ensure.log') $line -Encoding UTF8 } catch {}
}

# Already healthy?
try {
  $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 3
  if ($r.StatusCode -eq 200) { Log 'backend already OK'; exit 0 }
} catch {}

# Load .env into this process
if (Test-Path $EnvFile) {
  Get-Content $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($k, $v, 'Process')
  }
}

$env:USE_POSTGRES = '1'
$env:NODE_ENV = 'production'
# Single process on home PC (stable). Override in .env if needed.
if (-not $env:WEB_CONCURRENCY) { $env:WEB_CONCURRENCY = '1' }
# Prefer single process: disable multi-worker cluster on constrained machines
$env:CLUSTER = '0'

$node = (Get-Command node -EA SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { Log 'ERROR no node.exe'; exit 1 }
if (-not $env:JWT_SECRET -or -not $env:DATABASE_URL) { Log 'ERROR .env incomplete'; exit 1 }

# Kill only dead/stale velocity listeners holding the port without HTTP
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and ($_.CommandLine -like '*cluster.js*' -or $_.CommandLine -like '*server.js*' -or $_.CommandLine -like "*$Proj*")) {
    Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue
  }
}
Start-Sleep -Seconds 1

Log 'Starting node server.js (single process)'
# server.js via direct node — no cluster fork storm
$p = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $Proj -WindowStyle Hidden -PassThru
Log ('Started PID=' + $p.Id)
try {
  $proc = Get-Process -Id $p.Id -ErrorAction Stop
  $proc.PriorityClass = 'High'
  Log ('Priority High set for PID=' + $p.Id)
} catch {}

# Wait for HTTP
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { Log 'backend HTTP OK'; exit 0 }
  } catch {}
}
Log 'WARN backend started but HTTP not ready yet'
exit 1
