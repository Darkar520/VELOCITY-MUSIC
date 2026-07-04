# Velocity Music — Proceso de Release (staging → producción)

Objetivo: **nada llega a producción sin pasar por pruebas y una puerta de
calidad**. Las implementaciones se hacen y validan en un entorno aislado antes
de promocionarse a la instancia en vivo.

---

## 1. Entornos

| Entorno | Frontend | Backend | Datos |
|---|---|---|---|
| **Local / Sandbox** | `cd frontend && npm run dev` (vite, :5173) | `npm run start:staging` (:3001) | `data-staging/` (aislado) |
| **Staging** | Cloudflare Pages **preview** (rama `develop` o PR → URL `*.pages.dev`) | instancia local :3001 | `data-staging/` |
| **Producción** | Cloudflare Pages **production** → `velocitymusic.uk` | guardián :3000 (cluster + PostgreSQL) | PostgreSQL |

- **Producción NUNCA se toca directo.** El frontend de prod se sirve por el
  Worker de Cloudflare desde Pages (rama `main`); el backend por el guardián.
- El **sandbox de backend** (`npm run start:staging`) corre en el puerto 3001
  con `data-staging/`, así que **no corrompe** los datos de producción.

## 2. Ramas

```
feature/*  →  develop  →  main (producción)
```

- `feature/xxx`: trabajo de una feature/fix. Se prueba en local.
- `develop`: integración. Push aquí genera un **preview de Cloudflare Pages**
  (URL propia) para validar el frontend sin tocar `velocitymusic.uk`.
- `main`: **solo código probado y aprobado**. Merge a `main` = release.

Regla de oro: **no commitear directo a `main`**. Se abre PR desde `develop`.

## 3. Puertas de calidad (gates)

Ningún cambio se promociona si no pasa TODAS:

1. **Local — pre-push hook** (`.githooks/pre-push`): corre los tests antes de
   cada `git push`. Instalar una vez: `npm run setup:hooks`.
2. **Local — preflight**: `npm run preflight` corre tests + build y muestra el
   checklist de invariantes (docs/GUARDRAILS.md). Correr antes de abrir PR.
3. **CI — GitHub Actions** (`.github/workflows/ci.yml`): corre en cada push/PR a
   `develop` y `main`. Tests (unit + property-based) + build. Debe salir verde.
4. **Protección de rama** (configurar en GitHub → Settings → Branches):
   - Require pull request before merging a `main`.
   - Require status checks to pass → seleccionar el job **`verify`**.
   - Así GitHub **bloquea el merge a `main`** si el CI está rojo.

## 4. Flujo paso a paso

```bash
# 1. Nueva feature
git checkout develop && git pull
git checkout -b feature/mi-cambio

# 2. Implementar + probar en sandbox
npm run start:staging                 # backend aislado :3001
cd frontend && npm run dev            # frontend local :5173

# 3. Puerta local
npm run preflight                     # tests + build + checklist

# 4. Push (el hook corre tests). Genera preview de Pages.
git push -u origin feature/mi-cambio

# 5. PR a develop → validar en el preview de Pages → merge
# 6. PR de develop a main → CI verde + revisión → merge = release

# 7. Promover backend a producción (si cambió src/**)
#    Reiniciar el proceso; el guardián lo revive con el código nuevo.
```

## 5. Despliegue del frontend

- **Producción**: Pages construye `main` con `cd frontend && npm install &&
  npm run build:pages` (salida `frontend/dist`) y lo sirve en `velocitymusic.uk`
  vía el Worker. Al desplegar, los clientes reciben el aviso de actualización.
- **Staging**: Pages construye cualquier rama/PR como **preview** con su propia
  URL. Ahí se valida antes de merge a `main`.

## 6. Despliegue del backend

- El backend corre desde el árbol de trabajo local en `main` (guardián :3000).
- Cambios en `src/**` requieren reiniciar el proceso Node:
  ```powershell
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  # el guardián lo revive en ~30s con USE_POSTGRES=1, CLUSTER=1, JWT_SECRET, ADMIN_KEY
  ```
- Verificar tras reiniciar: `GET /api/status` → `{"status":"operational"}`.

## 7. Variables de entorno de producción (guardián)

Definidas en `scripts/velocity-guardian.ps1`:

- `JWT_SECRET` — secreto largo aleatorio (obligatorio).
- `ADMIN_KEY` — clave del panel admin (≥8 chars; sin ella el panel se deshabilita).
- `GOOGLE_CLIENT_ID` — OAuth de Google.
- `USE_POSTGRES=1`, `DATABASE_URL`, `CLUSTER=1`.

Nunca se commitean valores reales de secretos fuera del guardián local.

## 8. Rollback

- **Frontend**: en Cloudflare Pages → Deployments → *Rollback* al deploy previo.
- **Backend**: `git revert <commit>` en `main`, reiniciar el proceso.
- La base de datos JSON tiene respaldo `.bak`; PostgreSQL se respalda con
  `pg_dump` (ver §9).

## 9. Backups

- **PostgreSQL** (producción): tarea programada de Windows con
  `pg_dump -U velocity velocity_music > backup.sql` (diario recomendado).
- **JSON** (fallback): escritura atómica + `.bak` automático.

---

### Checklist de promoción a `main`

- [ ] `npm run preflight` en verde (tests + build).
- [ ] Probado en sandbox (:3001) y/o preview de Pages.
- [ ] CI en verde en el PR.
- [ ] Invariantes de `docs/GUARDRAILS.md` respetadas.
- [ ] Sin secretos ni datos sensibles en el diff.
- [ ] Si tocó el Service Worker, subí `CACHE = 'velocity-vN'`.
