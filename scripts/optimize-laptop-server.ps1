# Optimiza la laptop para que Velocity (backend) tenga prioridad y mas RAM libre.
# Ejecutar como Administrador para el maximo efecto:
#   powershell -ExecutionPolicy Bypass -File .\scripts\optimize-laptop-server.ps1
#
# Sin admin: aplica lo que pueda (prioridad de procesos, plan de energia basico).

$ErrorActionPreference = 'Continue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host "=== Velocity laptop optimizer ==="
Write-Host ("Admin: " + $isAdmin)

# 1) Plan de energia alto rendimiento
try {
  powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null
  if ($LASTEXITCODE -ne 0) {
    # Crear/activar "High performance" por alias
    powercfg /duplicatescheme 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null | Out-Null
    powercfg /setactive SCHEME_MIN 2>$null
  }
  powercfg /change standby-timeout-ac 0
  powercfg /change standby-timeout-dc 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change hibernate-timeout-dc 0
  powercfg /change monitor-timeout-ac 0
  Write-Host "OK Power plan: no sleep/hibernate"
} catch { Write-Host ("WARN powercfg: " + $_.Exception.Message) }

# 2) Prioridad alta SOLO a Velocity (server.js/cluster) + Postgres + tunnel
#    No elevar todos los node.exe (Adobe, MCP, IDEs).
$projHint = 'VELOCITY MUSIC'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $c = $_.CommandLine
  if ($c -and ($c -like '*server.js*' -or $c -like '*cluster.js*' -or $c -like "*$projHint*")) {
    try {
      $p = Get-Process -Id $_.ProcessId -ErrorAction Stop
      $p.PriorityClass = 'High'
      Write-Host ("OK priority High: velocity node PID=" + $_.ProcessId)
    } catch {}
  }
}
foreach ($name in @('postgres', 'cloudflared')) {
  Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $_.PriorityClass = 'High'
      Write-Host ("OK priority High: " + $name + " PID=" + $_.Id)
    } catch {}
  }
}

# 3) Bajar prioridad de apps pesadas comunes (no las cierra)
foreach ($n in @('Photoshop','Adobe Desktop Service','Creative Cloud','Discord','Steam','Chrome','msedge','Code','Antigravity','Cursor','Slack','Teams')) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $_.PriorityClass = 'BelowNormal'
      Write-Host ("OK priority BelowNormal: " + $_.ProcessName + " " + $_.Id)
    } catch {}
  }
}

if ($isAdmin) {
  # 4) Servicios que comen RAM/disco (seguros de parar en un mini-servidor casero)
  $stopServices = @(
    'SysMain',           # Superfetch
    'WSearch',           # Windows Search indexer
    'DiagTrack',         # Telemetria
    'dmwappushservice'
  )
  foreach ($s in $stopServices) {
    try {
      $svc = Get-Service $s -ErrorAction SilentlyContinue
      if ($svc -and $svc.Status -eq 'Running') {
        Stop-Service $s -Force -ErrorAction SilentlyContinue
        Set-Service $s -StartupType Manual -ErrorAction SilentlyContinue
        Write-Host ("OK stopped service: " + $s)
      }
    } catch {}
  }

  # 5) PostgreSQL auto + recovery
  try {
    sc.exe config postgresql-x64-16 start= auto | Out-Null
    sc.exe failure postgresql-x64-16 reset= 86400 actions= restart/10000/restart/20000/restart/60000 | Out-Null
    Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue
    Write-Host 'OK PostgreSQL Automatic + restart on failure'
  } catch {}

  # 6) Preferir que el SO no ponga apps en segundo plano agresivo
  try {
    reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 10 /f | Out-Null
    reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 0xffffffff /f | Out-Null
    Write-Host 'OK multimedia system profile tweaks'
  } catch {}
} else {
  Write-Host 'INFO: re-run as Administrator to stop SysMain/WSearch and lock PG recovery'
}

# 7) Liberar standby list (requiere RAMMap o EmptyStandbyList; best-effort)
try {
  [System.GC]::Collect()
} catch {}

# 8) Asegurar backend Velocity
$ensure = Join-Path $PSScriptRoot 'ensure-running.ps1'
if (Test-Path $ensure) {
  Write-Host 'Starting ensure-running...'
  & $ensure
}

# 9) Re-apply high priority after start
Start-Sleep 2
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $c = $_.CommandLine
  if ($c -and ($c -like '*server.js*' -or $c -like '*cluster.js*' -or $c -like "*$projHint*")) {
    try { (Get-Process -Id $_.ProcessId).PriorityClass = 'High' } catch {}
  }
}
foreach ($name in @('postgres', 'cloudflared')) {
  Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.PriorityClass = 'High' } catch {}
  }
}

$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$total = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Write-Host ("RAM free: {0} GB / {1} GB" -f $free, $total)
Write-Host '=== Done ==='
Write-Host 'Tip: cierra Photoshop/Chrome pesado cuando sirvas musica a otros.'
