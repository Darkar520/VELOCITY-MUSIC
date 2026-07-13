$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'

Write-Host '=== INSTALL WATCHDOG ==='
& (Join-Path $Proj 'scripts\install-watchdog.ps1')

Write-Host '=== KILL OLD VELOCITY NODE/GUARDIAN ==='
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -like '*velocity-guardian*') { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -like '*cluster*' -or $_.CommandLine -like '*server.js*' -or $_.CommandLine -like "*$Proj*") {
    Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue
  }
}
Start-Sleep 2

Write-Host '=== ENSURE NOW ==='
& (Join-Path $Proj 'scripts\ensure-running.ps1')
Start-Sleep 5
& (Join-Path $Proj 'scripts\ensure-running.ps1')
Start-Sleep 3

Write-Host '=== VERIFY ==='
& 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe' -h localhost -p 5432
try { Write-Host 'LOCAL status' (Invoke-WebRequest http://127.0.0.1:3000/api/status -UseBasicParsing -TimeoutSec 5).Content } catch { Write-Host 'LOCAL status FAIL' $_.Exception.Message }
try { Write-Host 'LOCAL health' (Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing -TimeoutSec 5).Content } catch { Write-Host 'LOCAL health FAIL' $_.Exception.Message }
try { Write-Host 'LOCAL config' (Invoke-WebRequest http://127.0.0.1:3000/api/auth/config -UseBasicParsing -TimeoutSec 5).Content } catch { Write-Host 'LOCAL config FAIL' $_.Exception.Message }
try { Write-Host 'PUBLIC status' (Invoke-WebRequest https://velocitymusic.uk/api/status -UseBasicParsing -TimeoutSec 12).Content } catch { Write-Host 'PUBLIC status FAIL' $_.Exception.Message }
try { Write-Host 'PUBLIC config' (Invoke-WebRequest https://velocitymusic.uk/api/auth/config -UseBasicParsing -TimeoutSec 12).Content } catch { Write-Host 'PUBLIC config FAIL' $_.Exception.Message }

Write-Host '=== ENSURE LOG ==='
Get-Content (Join-Path $Proj 'logs\ensure.log') -Tail 20 -EA SilentlyContinue

Write-Host '=== NODE ==='
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*cluster*' -or $_.CommandLine -like "*$Proj*") {
    Write-Host $_.ProcessId $_.CommandLine.Substring(0, [Math]::Min(120, $_.CommandLine.Length))
  }
}
