# Hace que VELOCITY MUSIC arranque solo al iniciar sesion en Windows,
# oculto (sin ventanas). Metodo: carpeta de Inicio (no requiere admin).
# Ejecutar UNA vez:
#   powershell -ExecutionPolicy Bypass -File ".\scripts\install-autostart.ps1"

$Vbs     = 'C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\start-hidden.vbs'
$Startup = [Environment]::GetFolderPath('Startup')
$Link    = Join-Path $Startup 'VelocityMusic.vbs'

Copy-Item -Path $Vbs -Destination $Link -Force

Write-Output "Autostart instalado en: $Link"
Write-Output "Velocity Music arrancara solo cada vez que inicies sesion en Windows."
