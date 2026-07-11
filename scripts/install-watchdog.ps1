# Installs always-on recovery for Velocity (no long-lived fragile guardian required).
# Run as current user (admin optional for PG recovery flags):
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1

$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$short = 'C:\velocity-ops'

New-Item -ItemType Directory -Force -Path $short | Out-Null
Copy-Item -Force (Join-Path $Proj 'scripts\ensure-running.ps1') (Join-Path $short 'ensure-running.ps1')
Copy-Item -Force (Join-Path $Proj 'scripts\start-backend-once.ps1') (Join-Path $short 'start-backend-once.ps1')
# ensure-running uses absolute paths to Proj - OK

@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\velocity-ops\ensure-running.ps1
'@ | Set-Content -Path (Join-Path $short 'run-ensure.cmd') -Encoding ASCII

# Startup VBS still launches a guardian-like first boot
$Startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $Proj 'scripts\start-hidden.vbs'
Copy-Item -Force $vbs (Join-Path $Startup 'VelocityMusic.vbs')
Write-Host 'OK Startup VBS'

# Task every 2 minutes - PRIMARY recovery
$task = 'VelocityMusicEnsure'
cmd /c "schtasks /Delete /TN $task /F >nul 2>&1"
$tr = 'C:\velocity-ops\run-ensure.cmd'
$out = cmd /c "schtasks /Create /TN $task /TR $tr /SC MINUTE /MO 2 /RL LIMITED /F" 2>&1
Write-Host $out
cmd /c "schtasks /Query /TN $task /FO LIST" 2>&1 | findstr /i "TaskName Status Next"

# Logon task: run ensure immediately at login
$task2 = 'VelocityMusicOnLogon'
cmd /c "schtasks /Delete /TN $task2 /F >nul 2>&1"
$out2 = cmd /c "schtasks /Create /TN $task2 /TR $tr /SC ONLOGON /RL LIMITED /F" 2>&1
Write-Host $out2

# PG recovery (may need admin)
try {
  cmd /c "sc failure postgresql-x64-16 reset= 86400 actions= restart/10000/restart/20000/restart/60000"
  cmd /c "sc config postgresql-x64-16 start= auto"
  Write-Host 'OK PG service recovery flags (if access allowed)'
} catch {}

# .env: single process
$envFile = Join-Path $Proj '.env'
if (Test-Path $envFile) {
  $txt = Get-Content $envFile -Raw -Encoding UTF8
  if ($txt -notmatch '(?m)^WEB_CONCURRENCY=') {
    Add-Content $envFile "`r`nWEB_CONCURRENCY=1`r`nCLUSTER=0`r`n" -Encoding UTF8
  } else {
    $lines = Get-Content $envFile -Encoding UTF8 | ForEach-Object {
      if ($_ -match '^\s*WEB_CONCURRENCY\s*=') { 'WEB_CONCURRENCY=1' }
      elseif ($_ -match '^\s*CLUSTER\s*=') { 'CLUSTER=0' }
      else { $_ }
    }
    if ($txt -notmatch '(?m)^CLUSTER=') { $lines += 'CLUSTER=0' }
    $lines | Set-Content $envFile -Encoding UTF8
  }
  Write-Host 'OK .env CLUSTER=0 WEB_CONCURRENCY=1'
}

Write-Host ''
Write-Host 'Run now: powershell -ExecutionPolicy Bypass -File C:\velocity-ops\ensure-running.ps1'
