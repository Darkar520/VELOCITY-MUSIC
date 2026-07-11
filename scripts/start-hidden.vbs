' Boot Velocity stack hidden at logon (calls ensure-running, not a fragile infinite loop only).
Set sh = CreateObject("WScript.Shell")
' Immediate ensure
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\ensure-running.ps1""", 0, False
' Also start guardian as secondary (best-effort)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC\scripts\velocity-guardian.ps1""", 0, False
