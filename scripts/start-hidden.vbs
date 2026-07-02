' Lanza el guardián de VELOCITY MUSIC en segundo plano, totalmente oculto
' (sin ventana de PowerShell). Lo usa la tarea programada al iniciar sesión.
Set sh = CreateObject("WScript.Shell")
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\velocity-guardian.ps1"""
sh.Run cmd, 0, False
