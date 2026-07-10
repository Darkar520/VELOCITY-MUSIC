# Instala Velocity Music para que arranque SOLO al iniciar sesión en Windows,
# independiente de IDEs/CLIs (Antigravity, Codex, Kilo, etc.).
#
# Ejecutar UNA vez:
#   powershell -ExecutionPolicy Bypass -File ".\scripts\install-autostart.ps1"
#
# Método dual:
#   1) Carpeta Inicio (VBS oculto) — no requiere admin
#   2) Tarea programada al logon con reintentos — más robusta (si hay permisos)

$ErrorActionPreference = 'Stop'
$Proj   = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC'
$VbsSrc = Join-Path $Proj 'scripts\start-hidden.vbs'
$Startup = [Environment]::GetFolderPath('Startup')
$Link   = Join-Path $Startup 'VelocityMusic.vbs'
$TaskName = 'VelocityMusicGuardian'

if (-not (Test-Path -LiteralPath $VbsSrc)) {
  Write-Error "No se encuentra $VbsSrc"
  exit 1
}

# 1) Startup folder
Copy-Item -Path $VbsSrc -Destination $Link -Force
Write-Host "OK Startup: $Link"

# 2) Scheduled task (best-effort)
try {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Link`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "OK Tarea programada: $TaskName (al iniciar sesion, reintenta si falla)"
} catch {
  Write-Host "WARN: no se pudo crear tarea programada ($($_.Exception.Message)). El acceso por Startup sigue activo."
}

Write-Host ""
Write-Host "Velocity Music arrancara al iniciar sesion, oculto, sin depender de IDEs."
Write-Host "Para arrancar YA sin reiniciar:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$Proj\scripts\start-hidden.vbs`""
Write-Host "  o: wscript `"$Link`""
