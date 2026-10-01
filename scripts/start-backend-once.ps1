# Start Velocity backend once (detached). Only a listener owned by this checkout
# may be restarted. -DryRun validates the target without changing processes.
param(
  [switch]$Restart,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Proj = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port = 3000
$LogDir = Join-Path $Proj 'logs'
$EnvFile = Join-Path $Proj '.env'
$ServerScript = Join-Path $Proj 'server.js'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log($message) {
  $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $message
  try { Add-Content (Join-Path $LogDir 'ensure.log') $line -Encoding UTF8 } catch {}
}

function Get-ListenerPids {
  # Enumerate all listeners so an absent port is an empty result, not a query error.
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalPort -eq $Port } |
      Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-VelocityPortOwner {
  $listenerPids = @(Get-ListenerPids)
  if ($listenerPids.Count -eq 0) { return $null }
  if ($listenerPids.Count -ne 1 -or [int]$listenerPids[0] -le 0) {
    throw "Puerto $Port con propietarios múltiples o desconocidos; no se detiene ningún proceso."
  }

  $ownerPid = [int]$listenerPids[0]
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction Stop
  $expectedPath = (Resolve-Path -LiteralPath $ServerScript -ErrorAction Stop).Path
  if (-not $owner -or $owner.Name -ine 'node.exe' -or
      -not ([string]$owner.CommandLine).ToLowerInvariant().Contains($expectedPath.ToLowerInvariant())) {
    throw "PID $ownerPid ocupa el puerto $Port, pero no acredita este server.js con ruta absoluta; no se detiene."
  }
  return $owner
}

function Test-BackendHttp {
  try {
    $response = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch { return $false }
}

function Import-BackendEnv {
  if (-not (Test-Path -LiteralPath $EnvFile)) { throw 'Falta .env de producción.' }
  Get-Content -LiteralPath $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { return }
    $value = $line.Substring($eq + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }

  $env:USE_POSTGRES = '1'
  $env:NODE_ENV = 'production'
  if (-not $env:WEB_CONCURRENCY) { $env:WEB_CONCURRENCY = '1' }
  $env:CLUSTER = '0'
  if (-not $env:JWT_SECRET -or -not $env:DATABASE_URL) {
    throw 'Configuración de producción incompleta.'
  }
}

function Start-VelocityBackend {
  $owner = Get-VelocityPortOwner
  $healthy = Test-BackendHttp
  if ($owner -and $healthy -and -not $Restart) {
    Log 'backend already OK'
    return 0
  }
  if (-not $owner -and $healthy) {
    throw "El puerto $Port responde por HTTP sin propietario identificable; no se inicia otro backend."
  }

  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  if (-not (Test-Path -LiteralPath $node)) { throw 'No se encontró node.exe.' }
  if (-not (Test-Path -LiteralPath $ServerScript)) { throw 'No se encontró server.js del proyecto.' }

  if ($DryRun) {
    if ($owner) { Log "DRY RUN: se reiniciaría solo PID $($owner.ProcessId) del puerto $Port." }
    else { Log "DRY RUN: se iniciaría backend en puerto $Port." }
    return 0
  }

  # Validate runtime configuration before stopping a live process.
  Import-BackendEnv

  if ($owner) {
    # Recheck PID identity immediately before stopping it; PID reuse must fail closed.
    $current = Get-VelocityPortOwner
    if (-not $current -or $current.ProcessId -ne $owner.ProcessId -or
        $current.CreationDate -ne $owner.CreationDate) {
      throw 'Cambió el propietario del puerto durante la validación; no se detiene.'
    }
    Log "Stopping only Velocity PID $($owner.ProcessId) on port $Port."
    Stop-Process -Id $owner.ProcessId -Force -ErrorAction Stop
  }

  # The named mutex prevents watchdog and scheduled invocations from racing.
  for ($i = 0; $i -lt 20; $i++) {
    if (@(Get-ListenerPids).Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if (@(Get-ListenerPids).Count -ne 0) {
    throw "El puerto $Port sigue ocupado; no se inicia otro backend."
  }

  $quotedScript = '"' + $ServerScript + '"'
  Log 'Starting node server.js (single process, absolute script path)'
  $started = Start-Process -FilePath $node -ArgumentList $quotedScript -WorkingDirectory $Proj -WindowStyle Hidden -PassThru -ErrorAction Stop
  Log ('Started PID=' + $started.Id)
  try { (Get-Process -Id $started.Id -ErrorAction Stop).PriorityClass = 'High' } catch {}

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-BackendHttp) {
      $listener = Get-VelocityPortOwner
      if ($listener -and $listener.ProcessId -eq $started.Id) {
        Log 'backend HTTP OK; listener belongs to the started PID'
        return 0
      }
      throw "El puerto $Port respondió, pero no pertenece al PID iniciado; no se declara sano."
    }
  }
  throw 'Backend iniciado, pero HTTP no respondió a tiempo.'
}

$mutex = New-Object System.Threading.Mutex($false, 'Global\VelocityMusicBackendStart')
$acquired = $false
$exitCode = 1
try {
  try { $acquired = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if ($acquired) { $exitCode = Start-VelocityBackend }
  else { Log 'Otro inicio del backend está en progreso; se omite este intento.'; $exitCode = 0 }
} catch {
  Log ('ERROR backend start: ' + $_.Exception.Message)
  $exitCode = 1
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
exit $exitCode
