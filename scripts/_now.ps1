$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
Write-Host ('TIME ' + (Get-Date))
Write-Host '--- PG ---'
& 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432 2>&1
Get-Service postgresql* -EA SilentlyContinue | Format-Table Name, Status, StartType -AutoSize
Write-Host '--- PORT 3000 ---'
Get-NetTCPConnection -LocalPort 3000 -State Listen -EA SilentlyContinue | Format-Table OwningProcess, State
Write-Host '--- PROCESSES ---'
Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object {
  $c = $_.CommandLine
  if (-not $c) { return }
  if ($c -like '*velocity-guardian*' -or $c -like '*cluster.js*' -or $c -like '*cloudflared*tunnel*') {
    Write-Host ($_.ProcessId.ToString() + ' ' + $_.Name + ' ' + $c.Substring(0, [Math]::Min(140, $c.Length)))
  }
}
Write-Host '--- HTTP local ---'
foreach ($u in @('/api/status','/api/health','/api/auth/config')) {
  try {
    $r = Invoke-WebRequest -Uri ('http://127.0.0.1:3000' + $u) -UseBasicParsing -TimeoutSec 5
    Write-Host ($u + ' ' + $r.StatusCode + ' ' + $r.Content)
  } catch {
    Write-Host ($u + ' FAIL ' + $_.Exception.Message)
  }
}
Write-Host '--- HTTP public ---'
foreach ($u in @('/api/status','/api/health','/api/auth/config')) {
  try {
    $r = Invoke-WebRequest -Uri ('https://velocitymusic.uk' + $u) -UseBasicParsing -TimeoutSec 10
    Write-Host ('public' + $u + ' ' + $r.StatusCode + ' ' + $r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))
  } catch {
    Write-Host ('public' + $u + ' FAIL ' + $_.Exception.Message)
  }
}
Write-Host '--- GUARDIAN LOG ---'
Get-Content (Join-Path $Proj 'logs\guardian.log') -Tail 25 -EA SilentlyContinue
Write-Host '--- ENSURE LOG ---'
Get-Content (Join-Path $Proj 'logs\ensure.log') -Tail 15 -EA SilentlyContinue
Write-Host '--- BACKEND LOG ---'
Get-Content (Join-Path $Proj 'logs\backend.log') -Tail 30 -EA SilentlyContinue
Write-Host '--- MEM ---'
$os = Get-CimInstance Win32_OperatingSystem
'{0:N1} GB free / {1:N1} GB total' -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB)
Write-Host '--- TASKS ---'
schtasks /Query /TN VelocityMusicEnsure /FO LIST 2>&1 | Select-String -Pattern 'TaskName|Status|Next|Last'
schtasks /Query /TN VelocityMusicGuardian /FO LIST 2>&1 | Select-String -Pattern 'TaskName|Status|Next|Last'
