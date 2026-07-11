# P0 — Runbook de rotación (Fase 5)

Ejecutar **solo después** de desplegar el código P0 (guardian sin secretos + stream firmado + install protegido).

## 1. Generar secretos nuevos (fuera del repo)

```powershell
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('ADMIN_KEY=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('PG_PASS=' + require('crypto').randomBytes(24).toString('base64url'))"
```

## 2. Actualizar Postgres

```sql
ALTER USER velocity WITH PASSWORD 'EL_NUEVO_PASSWORD';
```

## 3. Actualizar `.env` (raíz del proyecto, nunca commit)

Reemplazar:

- `JWT_SECRET=...` (nuevo)
- `ADMIN_KEY=...` (nuevo)
- `DATABASE_URL=postgresql://velocity:EL_NUEVO_PASSWORD@localhost:5432/velocity_music`

Resto igual (`ALLOWED_ORIGIN`, `GOOGLE_CLIENT_ID`, `USE_POSTGRES=1`, `CLUSTER=1`, `NODE_ENV=production`).

## 4. Reiniciar backend

El guardián recargará `.env` al relanzar Node. Opciones:

```powershell
# Detener solo procesos Node del proyecto / dejar que el guardián revive en ~15–30s
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

## 5. Checklist de verificación (todos en verde)

| # | Check | Esperado |
|---|--------|----------|
| 1 | `GET /api/status` | operational |
| 2 | `GET /api/health` | 200, db green |
| 3 | Login web | OK (tokens viejos mueren → re-login) |
| 4 | Play 30s + skip | audio continuo |
| 5 | `GET /api/stream-proxy?artist=A&title=B` sin sig | 401 |
| 6 | `GET /api/resolve?artist=A&title=B` sin Bearer | 401 |
| 7 | Admin con **nueva** key | 200; key vieja → 401 |
| 8 | `POST /api/setup/extractor/install` sin key | 401/503 |
| 9 | `git ls-files .env` | vacío |

## Notas

- Rotar `JWT_SECRET` invalida **todos** los JWT y firmas de stream en vuelo.
- Los secretos viejos en el **historial de git** siguen quemados: la rotación es la mitigación real; purgar history es opcional y aparte.
- No pegues secretos reales en issues, PRs ni chat.
