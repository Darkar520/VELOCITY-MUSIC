' Velocity Music — bucle permanente (cada 60s).
' Si el backend/PG se caen, ensure-running los levanta.
' Se lanza al iniciar sesión; no depende de un PowerShell frágil en bucle infinito.
Option Explicit
Dim sh, ensurePs, waitMs
Set sh = CreateObject("WScript.Shell")
ensurePs = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\ensure-running.ps1"""
waitMs = 60000

Do
  On Error Resume Next
  ' 1 = hide window, True = wait until ensure finishes
  sh.Run ensurePs, 0, True
  On Error GoTo 0
  WScript.Sleep waitMs
Loop
