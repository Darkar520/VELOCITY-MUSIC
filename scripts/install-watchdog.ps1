# Installs:
# 1) Autostart guardian at logon
# 2) ensure-running.ps1 every 5 minutes (recovers if guardian dies / OOM)
# 3) PostgreSQL service recovery (restart on failure)
#
# Run once:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1

$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'

# --- Autostart (existing) ---
& (Join-Path $Proj 'scripts\install-autostart.ps1')

# --- ensure-running every 5 min (wrapper .cmd avoids path-with-spaces bugs) ---
$taskName = 'VelocityMusicEnsure'
$cmdPath = Join-Path $Proj 'scripts\run-ensure.cmd'
try { schtasks /Delete /TN $taskName /F 2>$null | Out-Null } catch {}
$create = schtasks /Create /TN $taskName /TR "`"$cmdPath`"" /SC MINUTE /MO 5 /RL LIMITED /F 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
  Write-Host "OK Scheduled task: $taskName (every 5 min)"
} else {
  Write-Host ('WARN ensure task: ' + $create)
}

# --- PostgreSQL auto-restart on crash ---
try {
  sc.exe failure postgresql-x64-16 reset= 86400 actions= restart/15000/restart/30000/restart/60000 | Out-Null
  sc.exe failureflag postgresql-x64-16 1 | Out-Null
  sc.exe config postgresql-x64-16 start= auto | Out-Null
  Write-Host 'OK PostgreSQL service recovery: restart on failure'
} catch {
  Write-Host ('WARN PG recovery: ' + $_.Exception.Message)
}

# Ensure WEB_CONCURRENCY in .env
$envFile = Join-Path $Proj '.env'
if (Test-Path $envFile) {
  $raw = Get-Content $envFile -Raw -Encoding UTF8
  if ($raw -notmatch '(?m)^WEB_CONCURRENCY=') {
    Add-Content -LiteralPath $envFile -Value "`nWEB_CONCURRENCY=2`n" -Encoding UTF8
    Write-Host 'OK Added WEB_CONCURRENCY=2 to .env'
  } else {
    Write-Host 'OK WEB_CONCURRENCY already in .env'
  }
}

Write-Host ''
Write-Host 'Watchdog installed. Boot stack now with:'
Write-Host ('  powershell -ExecutionPolicy Bypass -File "' + (Join-Path $Proj 'scripts\restart-velocity.ps1') + '"')
