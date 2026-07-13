$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $owningPid = $conn.OwningProcess
  Write-Host "Killing process $owningPid on port 3000..."
  Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "No process listening on port 3000."
}
