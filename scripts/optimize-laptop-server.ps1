# Optimiza la laptop para Velocity (prioridad + menos basura del SO).
# Maximo efecto: Ejecutar como Administrador.
$ErrorActionPreference = 'Continue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
$projHint = 'VELOCITY MUSIC'

Write-Host ("  Optimizer Admin={0}" -f $isAdmin)

# Power: no sleep
try {
  powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { powercfg /setactive SCHEME_MIN 2>$null | Out-Null }
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change standby-timeout-dc 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-dc 0 | Out-Null
  powercfg /change monitor-timeout-ac 15 | Out-Null
  powercfg /hibernate off 2>$null | Out-Null
  Write-Host '  Power: High performance, no sleep/hibernate'
} catch { Write-Host ("  WARN power: " + $_.Exception.Message) }

function Set-VelNodeHigh {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $c = $_.CommandLine
    if ($c -and ($c -like '*server.js*' -or $c -like '*cluster.js*' -or $c -like "*$projHint*")) {
      try {
        (Get-Process -Id $_.ProcessId).PriorityClass = 'High'
        Write-Host ("  High: node PID=" + $_.ProcessId)
      } catch {}
    }
  }
  foreach ($name in @('postgres', 'cloudflared')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $_.PriorityClass = 'High'
        Write-Host ("  High: {0} PID={1}" -f $name, $_.Id)
      } catch {}
    }
  }
}

Set-VelNodeHigh

# Lower noisy apps (do not kill)
foreach ($n in @(
  'Photoshop','Adobe Desktop Service','Creative Cloud','CCXProcess','CoreSync',
  'Discord','Steam','steamwebhelper','Chrome','msedge','Code','Antigravity',
  'Cursor','Slack','Teams','OneDrive','SearchApp','SearchHost'
)) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $_.PriorityClass = 'BelowNormal'
      Write-Host ("  BelowNormal: {0} {1}" -f $_.ProcessName, $_.Id)
    } catch {}
  }
}

if ($isAdmin) {
  foreach ($s in @('SysMain','WSearch','DiagTrack','dmwappushservice','SysMain')) {
    try {
      $svc = Get-Service $s -ErrorAction SilentlyContinue
      if ($svc -and $svc.Status -eq 'Running') {
        Stop-Service $s -Force -ErrorAction SilentlyContinue
        Set-Service $s -StartupType Manual -ErrorAction SilentlyContinue
        Write-Host ("  Stopped service: " + $s)
      }
    } catch {}
  }
  try {
    sc.exe config postgresql-x64-16 start= auto | Out-Null
    sc.exe failure postgresql-x64-16 reset= 86400 actions= restart/10000/restart/20000/restart/60000 | Out-Null
    Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue
    Write-Host '  PostgreSQL: Automatic + failure restart'
  } catch {}
  try {
    reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 10 /f | Out-Null
    reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 0xffffffff /f | Out-Null
    Write-Host '  Multimedia profile tweaks'
  } catch {}
  # Prefer foreground services
  try {
    reg add "HKLM\SYSTEM\CurrentControlSet\Control\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 26 /f | Out-Null
  } catch {}
} else {
  Write-Host '  (Sin admin: no se detienen SysMain/WSearch ni recovery de PG)'
}

$os = Get-CimInstance Win32_OperatingSystem
Write-Host ("  RAM free: {0:N1} / {1:N1} GB" -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB))
