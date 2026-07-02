# Quita el arranque automatico de VELOCITY MUSIC y detiene los procesos.
#   powershell -ExecutionPolicy Bypass -File ".\scripts\uninstall-autostart.ps1"

$Startup = [Environment]::GetFolderPath('Startup')
$Link    = Join-Path $Startup 'VelocityMusic.vbs'
Remove-Item -Path $Link -Force -ErrorAction SilentlyContinue

# Cierra el tunel y el backend si siguen vivos
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Output "Autostart eliminado y procesos detenidos."
