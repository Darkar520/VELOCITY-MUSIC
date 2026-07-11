' Lanza el watchdog de Velocity al iniciar sesión (oculto).
Option Explicit
Dim sh, loopVbs, fso, startup
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

loopVbs = "C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\watchdog-loop.vbs"

' Evitar múltiples bucles: si ya hay wscript con watchdog-loop, no relanzar
Dim wmi, procs, p, cmd, already
already = False
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("Select CommandLine from Win32_Process Where Name='wscript.exe' Or Name='cscript.exe'")
For Each p In procs
  cmd = LCase("" & p.CommandLine)
  If InStr(cmd, "watchdog-loop.vbs") > 0 Then already = True
Next
On Error GoTo 0

If Not already Then
  sh.Run "wscript.exe //B """ & loopVbs & """", 0, False
End If

' Arranque inmediato (no esperar 60s del bucle)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\ensure-running.ps1""", 0, False
