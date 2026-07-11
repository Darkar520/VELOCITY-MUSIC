# Registers 5-minute watchdog using a SHORT path (no spaces) for schtasks reliability.
$ErrorActionPreference = 'Stop'
$shortDir = 'C:\velocity-ops'
$src = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts'

New-Item -ItemType Directory -Force -Path $shortDir | Out-Null
Copy-Item -Force (Join-Path $src 'ensure-running.ps1') (Join-Path $shortDir 'ensure-running.ps1')
Copy-Item -Force (Join-Path $src 'run-ensure.cmd') (Join-Path $shortDir 'run-ensure.cmd')

# Fix run-ensure.cmd to call local ensure-running.ps1
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\velocity-ops\ensure-running.ps1"
'@ | Set-Content -Path (Join-Path $shortDir 'run-ensure.cmd') -Encoding ASCII

# ensure-running.ps1 uses absolute Proj path already - OK

$task = 'VelocityMusicEnsure'
schtasks.exe /Delete /TN $task /F 2>$null | Out-Null
$result = schtasks.exe /Create /TN $task /TR 'C:\velocity-ops\run-ensure.cmd' /SC MINUTE /MO 5 /RL LIMITED /F 2>&1
Write-Host $result
schtasks.exe /Query /TN $task /FO LIST | Select-String -Pattern 'TaskName|Status|Next'
