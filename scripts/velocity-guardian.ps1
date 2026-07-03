# ════════════════════════════════════════════════════════════════
#  velocity-guardian.ps1  —  VELOCITY MUSIC
#  Mantiene SIEMPRE vivos el backend (puerto 3000, sirve la app + API)
#  y el túnel de Cloudflare (GRATIS y SIN límite de ancho de banda).
#  Escribe la URL pública actual en current-url.txt.
#  Diseñado para ejecutarse sin ventana vía carpeta de Inicio.
# ════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Continue'

$Proj    = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$Port    = 3000
$CfExe   = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$LogDir  = Join-Path $Proj 'logs'
$BackLog = Join-Path $LogDir 'backend.log'
$CfErr   = Join-Path $LogDir 'tunnel.log'      # cloudflared escribe sus logs (y la URL) en stderr
$CfOut   = Join-Path $LogDir 'tunnel.out.log'
$UrlFile = Join-Path $Proj  'current-url.txt'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ── Instancia única: evita duplicados si se lanza dos veces ──
$mutex = New-Object System.Threading.Mutex($false, 'Global\VelocityMusicGuardian')
if (-not $mutex.WaitOne(0)) { exit 0 }

# ── Evitar que la laptop se suspenda mientras sirve ──
try {
  powercfg /change standby-timeout-ac 0   | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
} catch {}

function Test-Backend { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }
function Test-Tunnel  { [bool](Get-Process cloudflared -ErrorAction SilentlyContinue) }

function Start-Backend {
  ("`n===== Backend iniciado {0} =====" -f (Get-Date)) | Out-File -FilePath $BackLog -Append -Encoding utf8
  Start-Process -FilePath $env:ComSpec `
    -ArgumentList '/c', ('set GOOGLE_CLIENT_ID=1096324357690-vuhqbq7vphbm54da9lbhbffv8ane18d9.apps.googleusercontent.com&& npm start >> "{0}" 2>&1' -f $BackLog) `
    -WorkingDirectory $Proj -WindowStyle Hidden | Out-Null
}

function Start-Tunnel {
  Set-Content -Path $CfErr -Value '' -Encoding utf8   # log limpio → leer la URL más reciente
  # cloudflared se lanza directo (su ruta tiene espacios; nada de cmd de por medio).
  Start-Process -FilePath $CfExe `
    -ArgumentList 'tunnel', '--url', ("http://localhost:{0}" -f $Port) `
    -WindowStyle Hidden -RedirectStandardError $CfErr -RedirectStandardOutput $CfOut | Out-Null
}

function Update-Url {
  if (Test-Path $CfErr) {
    $m = Select-String -Path $CfErr -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
         Select-Object -Last 1
    if ($m) {
      $url = [regex]::Match($m.Line, 'https://[a-z0-9-]+\.trycloudflare\.com').Value
      if ($url -and ((Get-Content $UrlFile -ErrorAction SilentlyContinue) -ne $url)) {
        Set-Content -Path $UrlFile -Value $url -Encoding utf8
      }
    }
  }
}

# ── Bucle guardián (chequeo de salud real) ──
while ($true) {
  if (-not (Test-Backend)) { Start-Backend; Start-Sleep -Seconds 6 }
  if (-not (Test-Tunnel))  { Start-Tunnel;  Start-Sleep -Seconds 7 }
  Update-Url
  Start-Sleep -Seconds 15
}
