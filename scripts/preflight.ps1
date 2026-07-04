# ════════════════════════════════════════════════════════════════
#  preflight.ps1 — Puerta de calidad local (antes de commitear/pushear).
#  Ejecuta: npm run preflight
#
#  Falla (exit 1) si los tests o el build no pasan. Recuerda las
#  invariantes críticas de docs/GUARDRAILS.md antes de promocionar.
# ════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "`n=== PREFLIGHT · Velocity Music ===" -ForegroundColor Cyan

# 1) Tests (unitarios + basados en propiedades)
Write-Host "`n[1/2] Tests..." -ForegroundColor Yellow
& node --test
if ($LASTEXITCODE -ne 0) { Write-Host "`nX Tests fallaron. No promociones." -ForegroundColor Red; exit 1 }

# 2) Build del frontend (producción)
Write-Host "`n[2/2] Build del frontend..." -ForegroundColor Yellow
Push-Location (Join-Path $root 'frontend')
try { & npm run build; if ($LASTEXITCODE -ne 0) { throw 'build failed' } }
catch { Pop-Location; Write-Host "`nX Build falló. No promociones." -ForegroundColor Red; exit 1 }
Pop-Location

Write-Host "`n✔ PREFLIGHT VERDE" -ForegroundColor Green
Write-Host "`nChecklist antes de promocionar a produccion (docs/GUARDRAILS.md):" -ForegroundColor Cyan
Write-Host "  [ ] No rompi continuidad de audio ni el streaming"
Write-Host "  [ ] Caratulas cargan y no desaparecen al cambiar de cancion"
Write-Host "  [ ] No expuse datos sensibles (JWT_SECRET / ADMIN_KEY / passwords)"
Write-Host "  [ ] Si toque el Service Worker, subi la version de cache"
Write-Host "  [ ] Probe en STAGING (rama develop / preview de Pages) antes de main"
Write-Host "  [ ] Cambio minimo, sin duplicar logica existente`n"
exit 0
