# ════════════════════════════════════════════════════════════════
#  velocity-guardian.ps1  —  VELOCITY MUSIC
#  Mantiene SIEMPRE vivos el backend (puerto 3000) y el Named Tunnel
#  de Cloudflare → velocitymusic.uk (URL FIJA, sin límite de tráfico).
#  Diseñado para ejecutarse sin ventana vía carpeta de Inicio.
# ════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Continue'

$Proj      = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port      = 3000
$CfExe     = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$CfConfig  = 'C:\Users\irisp\.cloudflared\config.yml'
$PublicUrl = 'https://velocitymusic.uk'
$LogDir    = Join-Path $Proj 'logs'
$BackLog   = Join-Path $LogDir 'backend.log'
$CfLog     = Join-Path $LogDir 'tunnel.log'
$UrlFile   = Join-Path $Proj  'current-url.txt'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# URL fija — nunca cambia con Named Tunnel
[System.IO.File]::WriteAllText($UrlFile, $PublicUrl, [System.Text.Encoding]::UTF8)

# ── Instancia única: evita duplicados si se lanza dos veces ──
$mutex = New-Object System.Threading.Mutex($false, 'Global\VelocityMusicGuardian')
if (-not $mutex.WaitOne(0)) { exit 0 }

# ── Evitar suspensión ──
try {
  powercfg /change standby-timeout-ac 0   | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
} catch {}

function Test-Backend { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }
function Test-Tunnel  { [bool](Get-Process cloudflared -ErrorAction SilentlyContinue) }

function Start-Backend {
  ("`n===== Backend iniciado {0} =====" -f (Get-Date)) | Out-File -FilePath $BackLog -Append -Encoding utf8
  $envVars  = 'set GOOGLE_CLIENT_ID=1096324357690-vuhqbq7vphbm54da9lbhbffv8ane18d9.apps.googleusercontent.com'
  $envVars += '&& set USE_POSTGRES=1'
  $envVars += '&& set DATABASE_URL=postgresql://velocity:VelocityDB2026!@localhost:5432/velocity_music'
  $envVars += '&& set JWT_SECRET=42861e47db4b0dcbd80a0ccdfd9690f307531ed3deed7a81a858fa4692607be8fd09f434e3e37067ddec0370fa0aa2b315c9a51e564e2bfb13d9a61aa323e555'
  $envVars += '&& set CLUSTER=1'
  $cmd = '{0}&& npm run start:cluster >> "{1}" 2>&1' -f $envVars, $BackLog
  Start-Process -FilePath $env:ComSpec `
    -ArgumentList '/c', $cmd `
    -WorkingDirectory $Proj -WindowStyle Hidden | Out-Null
}

function Start-Tunnel {
  # Named Tunnel con config.yml — URL fija velocitymusic.uk, sin límite de tráfico
  Start-Process -FilePath $CfExe `
    -ArgumentList 'tunnel', '--config', $CfConfig, 'run' `
    -WindowStyle Hidden -RedirectStandardError $CfLog | Out-Null
}

# ── Bucle guardián ──
while ($true) {
  if (-not (Test-Backend)) { Start-Backend; Start-Sleep -Seconds 6 }
  if (-not (Test-Tunnel))  { Start-Tunnel;  Start-Sleep -Seconds 7 }
  Start-Sleep -Seconds 15
}
