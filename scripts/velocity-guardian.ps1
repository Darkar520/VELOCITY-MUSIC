# ════════════════════════════════════════════════════════════════
#  velocity-guardian.ps1  —  VELOCITY MUSIC
#  Mantiene SIEMPRE vivos PostgreSQL, el backend (puerto 3000) y
#  el Named Tunnel de Cloudflare → velocitymusic.uk.
#  Diseñado para ejecutarse sin ventana vía carpeta de Inicio.
# ════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Continue'

$Proj      = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port      = 3000
$PgPort    = 5432
$PgCtl     = 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe'
$PgIsReady = 'C:\Program Files\PostgreSQL\16\bin\pg_isready.exe'
$PgDataDir = 'C:\Program Files\PostgreSQL\16\data'
$PgLogFile = 'C:\Program Files\PostgreSQL\16\data\log\pg_guardian.log'
$CfExe     = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$CfConfig  = 'C:\Users\irisp\.cloudflared\config.yml'
$PublicUrl = 'https://velocitymusic.uk'
$LogDir    = Join-Path $Proj 'logs'
$BackLog   = Join-Path $LogDir 'backend.log'
$CfLog     = Join-Path $LogDir 'tunnel.log'
$GuardLog  = Join-Path $LogDir 'guardian.log'
$UrlFile   = Join-Path $Proj  'current-url.txt'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# URL fija — nunca cambia con Named Tunnel
[System.IO.File]::WriteAllText($UrlFile, $PublicUrl, [System.Text.Encoding]::UTF8)

# ── Log helper ──
function Log($msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] $msg" -f (Get-Date)
  $line | Out-File -FilePath $GuardLog -Append -Encoding utf8
}

# ── Instancia única: evita duplicados si se lanza dos veces ──
$mutex = New-Object System.Threading.Mutex($false, 'Global\VelocityMusicGuardian')
if (-not $mutex.WaitOne(0)) { exit 0 }

Log "Guardian iniciado (PID: $PID)"

# ── Evitar suspensión (SO + wake lock por software) ──
try {
  powercfg /change standby-timeout-ac 0   | Out-Null
  powercfg /change standby-timeout-dc 0   | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-dc 0 | Out-Null
} catch {}
# SetThreadExecutionState: ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
# Impide que Windows suspenda el sistema mientras este proceso esté vivo.
try {
  $code = @'
using System;using System.Runtime.InteropServices;
public class SleepBlock {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
  public const uint ES_CONTINUOUS      = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_AWAYMODE        = 0x00000040;
  public static void Prevent() { SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_AWAYMODE); }
}
'@
  Add-Type -TypeDefinition $code -Language CSharp
  [SleepBlock]::Prevent()
} catch {}

# ── Tests ──
function Test-Postgres {
  try {
    $result = & $PgIsReady -h localhost -p $PgPort 2>&1
    return $result -match 'aceptando conexiones|accepting connections'
  } catch { return $false }
}
function Test-Backend { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }
function Test-Tunnel  { [bool](Get-Process cloudflared -ErrorAction SilentlyContinue) }

# ── Starters ──
function Start-Postgres {
  Log "PostgreSQL caido — intentando arrancar con pg_ctl..."
  # Intentar primero con net start (funciona si ya tenemos permisos de admin)
  try {
    $svc = Get-Service postgresql-x64-16 -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Stopped') {
      net start postgresql-x64-16 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Log "PostgreSQL iniciado via servicio Windows"
        return
      }
    }
  } catch {}
  # Fallback: pg_ctl start (no requiere admin, funciona como usuario actual)
  try {
    & $PgCtl start -D $PgDataDir -w -l $PgLogFile 2>&1 | Out-Null
    Log "PostgreSQL iniciado via pg_ctl"
  } catch {
    Log "ERROR arrancando PostgreSQL: $($_.Exception.Message)"
  }
}

function Wait-Postgres {
  # Esperar hasta 30 segundos a que PostgreSQL acepte conexiones
  for ($i = 0; $i -lt 15; $i++) {
    if (Test-Postgres) { return $true }
    Start-Sleep -Seconds 2
  }
  Log "WARN: PostgreSQL no respondio tras 30 segundos"
  return $false
}

function Start-Backend {
  # No arrancar el backend si PostgreSQL no está listo
  if (-not (Test-Postgres)) {
    Log "Backend no iniciado: PostgreSQL no esta disponible"
    return
  }
  Log "Iniciando backend (cluster mode)..."
  ("`n===== Backend iniciado {0} =====" -f (Get-Date)) | Out-File -FilePath $BackLog -Append -Encoding utf8
  $envVars  = 'set GOOGLE_CLIENT_ID=1096324357690-vuhqbq7vphbm54da9lbhbffv8ane18d9.apps.googleusercontent.com'
  $envVars += '&& set USE_POSTGRES=1'
  $envVars += '&& set DATABASE_URL=postgresql://velocity:VelocityDB2026!@localhost:5432/velocity_music'
  $envVars += '&& set PGSSL=0'
  $envVars += '&& set PG_MAX_POOL_SIZE=3'
  $envVars += '&& set PG_IDLE_TIMEOUT_MS=30000'
  $envVars += '&& set PG_CONN_TIMEOUT_MS=10000'
  $envVars += '&& set JWT_SECRET=42861e47db4b0dcbd80a0ccdfd9690f307531ed3deed7a81a858fa4692607be8fd09f434e3e37067ddec0370fa0aa2b315c9a51e564e2bfb13d9a61aa323e555'
  $envVars += '&& set ADMIN_KEY=2RzFDO9pI68zqIaYBMhmRaaSwU3NH6ME'
  $envVars += '&& set CLUSTER=1'
  $cmd = '{0}&& npm run start:cluster >> "{1}" 2>&1' -f $envVars, $BackLog
  Start-Process -FilePath $env:ComSpec `
    -ArgumentList '/c', $cmd `
    -WorkingDirectory $Proj -WindowStyle Hidden | Out-Null
  Log "Backend lanzado"
}

function Start-Tunnel {
  Log "Iniciando tunnel Cloudflare..."
  # Named Tunnel con config.yml — URL fija velocitymusic.uk, sin límite de tráfico
  Start-Process -FilePath $CfExe `
    -ArgumentList 'tunnel', '--config', $CfConfig, 'run' `
    -WindowStyle Hidden -RedirectStandardError $CfLog | Out-Null
  Log "Tunnel lanzado"
}

# ── Bucle guardián: PostgreSQL → Backend → Tunnel ──
while ($true) {
  # 1. PostgreSQL primero (el backend depende de él)
  if (-not (Test-Postgres)) {
    Start-Postgres
    Wait-Postgres
    Start-Sleep -Seconds 3
  }
  # 2. Backend (solo si PostgreSQL está listo)
  if (-not (Test-Backend)) {
    Start-Backend
    Start-Sleep -Seconds 8
  }
  # 3. Tunnel
  if (-not (Test-Tunnel)) {
    Start-Tunnel
    Start-Sleep -Seconds 5
  }
  Start-Sleep -Seconds 15
}
