# Instala persistencia Opción A (autostart + tarea + bucle watchdog).
$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$short = 'C:\velocity-ops'

New-Item -ItemType Directory -Force -Path $short | Out-Null
Copy-Item -Force (Join-Path $Proj 'scripts\ensure-running.ps1') (Join-Path $short 'ensure-running.ps1')
Copy-Item -Force (Join-Path $Proj 'scripts\start-backend-once.ps1') (Join-Path $short 'start-backend-once.ps1')
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\velocity-ops\ensure-running.ps1
'@ | Set-Content -Path (Join-Path $short 'run-ensure.cmd') -Encoding ASCII

# Startup folder
$Startup = [Environment]::GetFolderPath('Startup')
Copy-Item -Force (Join-Path $Proj 'scripts\start-hidden.vbs') (Join-Path $Startup 'VelocityMusic.vbs')
Write-Host '  Startup: VelocityMusic.vbs'

# Launch watchdog loop now if not running
$already = $false
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*watchdog-loop.vbs*') { $already = $true }
}
if (-not $already) {
  Start-Process -FilePath 'wscript.exe' -ArgumentList @('//B', (Join-Path $Proj 'scripts\watchdog-loop.vbs')) -WindowStyle Hidden
  Write-Host '  Watchdog loop: started'
} else {
  Write-Host '  Watchdog loop: already running'
}

# Scheduled task every 2 minutes (backup if wscript dies)
$task = 'VelocityMusicEnsure'
cmd /c "schtasks /Delete /TN $task /F >nul 2>&1"
$tr = 'C:\velocity-ops\run-ensure.cmd'
$out = cmd /c "schtasks /Create /TN $task /TR $tr /SC MINUTE /MO 2 /RL LIMITED /F" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Write-Host '  Task VelocityMusicEnsure: every 2 min' }
else { Write-Host ("  WARN task: " + $out.Trim()) }

# On logon
$task2 = 'VelocityMusicOnLogon'
cmd /c "schtasks /Delete /TN $task2 /F >nul 2>&1"
$out2 = cmd /c "schtasks /Create /TN $task2 /TR $tr /SC ONLOGON /RL LIMITED /F" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Write-Host '  Task VelocityMusicOnLogon: OK' }
else { Write-Host ("  WARN onlogon: " + $out2.Trim()) }

# PG recovery if admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  cmd /c "sc config postgresql-x64-16 start= auto" | Out-Null
  cmd /c "sc failure postgresql-x64-16 reset= 86400 actions= restart/10000/restart/20000/restart/60000" | Out-Null
  try { Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue } catch {}
  Write-Host '  PostgreSQL: Automatic + failure restart'
} else {
  Write-Host '  PostgreSQL recovery: needs Admin (skipped)'
}
