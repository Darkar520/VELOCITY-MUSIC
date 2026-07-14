$ErrorActionPreference = 'Continue'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port = 3000

Write-Host "=== Velocity Music Deploy ==="

# 1. PRE-FLIGHT
if ((Get-Location).Path -ne $Proj) { cd $Proj }
if (-not (Test-Path 'package.json')) { Write-Error "No estas en el directorio del proyecto"; exit 1 }
foreach ($tool in @('git','node','npm')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Write-Error "Falta: $tool"; exit 1 }
}
$pgIsReady = 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe'
if (-not (Test-Path $pgIsReady)) { $pgIsReady = 'pg_isready' }
$pgCheck = & $pgIsReady -h localhost -p 5432 2>&1 | Out-String
if ($pgCheck -notmatch 'accepting|aceptando') { Write-Warning "PostgreSQL no responde (puede estar en modo JSON)" }
Write-Host "[deploy] Pre-flight OK"

# 2. SYNC
Write-Host "[deploy] git pull..."
git fetch origin --prune
$gitStatus = git status --porcelain | Where-Object { -not $_.StartsWith('??') }
if ($gitStatus) { git stash push -m "deploy-stash-$(Get-Date -Format 'yyyyMMddHHmmss')" }
git checkout main
git pull origin main
if ($gitStatus) { git stash pop 2>$null }

# 3. DEPENDENCIES
Write-Host "[deploy] npm install..."
npm install --no-audit --no-fund 2>&1 | Out-Null
cd frontend
npm install --no-audit --no-fund 2>&1 | Out-Null
cd ..

# 4. BUILD
Write-Host "[deploy] Build frontend..."
cd frontend
$buildOutput = npm run build 2>&1
$buildExit = $LASTEXITCODE
cd ..
if ($buildExit -ne 0) { Write-Error "Build fallo"; exit 1 }
if (-not (Test-Path public/index.html)) { Write-Error "public/index.html no existe"; exit 1 }
$swVersion = "unknown"
if (Test-Path public/sw.js) {
    $swContent = Get-Content public/sw.js -Raw
    if ($swContent -match "CACHE = '([^']+)'") { $swVersion = $Matches[1] }
}
Write-Host "[deploy] SW version: $swVersion"

# 5. RESTART
Write-Host "[deploy] Restarting backend..."
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -and ($cmd -match [regex]::Escape($Proj) -or $cmd -match 'cluster\.js|server\.js|velocity-music')) {
        Write-Host "  Stop PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 2
$guardianRunning = $false
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -match 'velocity-guardian\.ps1') { $guardianRunning = $true }
}
if (-not $guardianRunning) {
    Write-Host "[deploy] Iniciando guardian..."
    $vbs = Join-Path $Proj 'scripts\start-hidden.vbs'
    if (Test-Path $vbs) { Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`"" -WindowStyle Hidden }
}
powershell -ExecutionPolicy Bypass -File (Join-Path $Proj 'scripts\ensure-running.ps1') 2>$null

# 6. HEALTH CHECK
Write-Host "[deploy] Health check..."
$retries = 0; $maxRetries = 15; $healthy = $false
while ($retries -lt $maxRetries -and -not $healthy) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            $data = $r.Content | ConvertFrom-Json
            Write-Host "[deploy] Backend OK - mode: $($data.resolutionMode), cache: $($data.cacheEntries)"
            $healthy = $true
        }
    } catch { $retries++; Write-Host "[deploy] Esperando... ($retries/$maxRetries)" }
}
if (-not $healthy) { Write-Warning "Backend no respondio tras $maxRetries intentos" }

# 7. VERIFY SW
try {
    $swServed = Invoke-WebRequest "http://127.0.0.1:$Port/sw.js" -UseBasicParsing -TimeoutSec 5
    if ($swServed.Content -match "CACHE = '([^']+)'") {
        $servedVersion = $Matches[1]
        if ($servedVersion -eq $swVersion) { Write-Host "[deploy] SW confirmado: $servedVersion" }
        else { Write-Warning "SW mismatch: esperado=$swVersion servido=$servedVersion" }
    }
} catch { Write-Warning "No se pudo verificar /sw.js" }

# 8. LOG
$LogDir = Join-Path $Proj 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
$deployLog = Join-Path $LogDir 'deploy.log'
$commit = (git rev-parse --short HEAD).Trim()
$entry = "[{0:yyyy-MM-dd HH:mm:ss}] deploy OK - SW {1} - commit {2}" -f (Get-Date), $swVersion, $commit
Add-Content -LiteralPath $deployLog -Value $entry -Encoding UTF8
Write-Host "[deploy] OK: $entry"
