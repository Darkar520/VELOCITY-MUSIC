# Security P0 — Semana 1 (Plan de ejecución)

> **Para ejecución agentic:** usar `executing-plans` o `subagent-driven-development` tarea a tarea.  
> Checkboxes (`- [ ]`) = trazabilidad de avance.  
> **Regla de oro:** ninguna fase se cierra sin **Doble check A + B** en verde. Si falla B, no se avanza.

**Goal:** Cerrar los 5 riesgos P0 de la auditoría sin romper reproducción, auth, cluster ni CI.

**Architecture (decisiones cerradas — no reabrir en ejecución):**

| # | Decisión | Por qué (y no la alternativa) |
|---|----------|-------------------------------|
| 1 | Secretos solo en `.env` (gitignore); guardian **lee** `.env`, nunca los hardcodea | Hardcode en git ya filtró JWT/ADMIN/DB. Rotación sin re-commitear secretos. |
| 2 | Stream: **URL firmada HMAC** (`exp` + `sig`), no solo `Authorization` en el proxy | `<audio src>` y Service Worker **no envían** Bearer. Auth JWT en el proxy cortaría el audio. |
| 3 | `/api/resolve` y firmado de stream: **JWT Bearer** | Ya usan `fetch`; cabe `Authorization` sin tocar el elemento media. |
| 4 | Clave HMAC = `JWT_SECRET` (mismo secreto, purpose distinto en el payload) | Un secreto menos que rotar; `purpose` en el mensaje evita reutilizar tokens JWT como firma de stream. |
| 5 | `POST /api/setup/extractor/install`: **ADMIN_KEY obligatorio** si `NODE_ENV=production`; en test/dev sin prod, se mantiene usable o se mockea | Elimina RCE/abuso de descarga en el host público. |
| 6 | Dependencias: `npm audit fix` + pin `nodemailer@^9.0.3` | Cierra High de mailer sin reescribir el mailer (API compatible en createTransport). |

**Tech stack:** Node 18+ / Express, `crypto` nativo (HMAC), PowerShell guardian, `node --test`, sin frameworks nuevos.

**No-regresión (invariantes GUARDRAILS que este plan no puede violar):**

- Continuidad de audio (§3): un solo `<audio>`, proxy sin gzip, sin rate-limit en stream.
- Stream sigue siendo same-origin `/api/stream-proxy?...`.
- Logout/revocación JWT intactos.
- `npm run verify` verde al cierre de cada fase de código (Fases 1–5).
- Tras rotación (Fase 0/ops): re-login esperado; no “sesión eterna” con el secreto viejo.

**Orden de ejecución (obligatorio):**

```
Fase 1 (código secretos) → Fase 2 (stream/resolve) → Fase 3 (extractor) → Fase 4 (deps)
        → Fase 5 ops (rotar + reiniciar prod) → Fase 6 cierre (auditoría final)
```

Código **antes** de rotar en prod: si rotas primero y el guardian aún hardcodea valores viejos, el proceso sigue arrancando con secretos filtrados o inconsistentes.

---

## Mapa de archivos

| Archivo | Rol en este plan |
|---------|------------------|
| `.env.example` | Plantilla sin secretos reales; documentar vars |
| `.env` | **Solo local**, nunca git — secretos de prod/dev |
| `scripts/velocity-guardian.ps1` | Carga `.env`, lanza cluster **sin** literales de secreto |
| `server.js` / `cluster.js` | Carga temprana de env (dev/`npm start` sin guardian) |
| `src/lib/loadEnv.js` | Parser mínimo `.env` (sin dependencia nueva si es posible) |
| `src/lib/streamSign.js` | `signStreamQuery` / `verifyStreamQuery` (puro, testeable) |
| `src/services/streamProxy.js` | Validar firma **antes** de resolver/upstream |
| `src/app.js` | Rutas resolve auth, endpoint de firma, install admin, wiring |
| `frontend/src/api.js` | `streamUrl` firmado; `prefetchStream`/`resolve` con Bearer |
| `frontend/src/App.jsx` | Solo si hace falta await al firmar (mínimo; preferir cache en `api.js`) |
| `test/streamSign.test.js` | Nuevo — crypto de firmas |
| `test/streamProxy.test.js` / `regression.test.js` / `server.test.js` / `hardening.test.js` | Actualizar expectativas |
| `test/frontend.test.js` | `streamUrl` puede ser async o devolver URL con `sig` |
| `package.json` / lock | nodemailer + audit fix |
| `docs/GUARDRAILS.md` | §5/§6: stream firmado + install admin |
| `docs/RELEASE.md` | Secretos vía `.env`, rotación |

---

## Criterio de “Doble check” (todas las fases)

Tras cada fase de código:

| Check | Comando / acción | Esperado |
|-------|------------------|----------|
| **A — Automatizado** | `npm run verify` (o subset documentado si aún no hay build-touch) | exit 0, 0 fails |
| **B — Manual / semántico** | Lista de aserciones de la fase (abajo) | Todas sí |

Registrar en el PR/notas: `Fase N | A: PASS | B: PASS | commit <sha>`.

---

# Fase 0 — Preparación (sin tocar prod aún)

**Objetivo:** inventario y generadores listos; cero cambios de runtime.

- [ ] **0.1** Confirmar que `.env` está en `.gitignore` y **no** está trackeado:  
  `git check-ignore -v .env` · `git ls-files .env` → vacío.
- [ ] **0.2** Generar **offline** (no commitear) los valores nuevos (guardar en gestor local temporal, p. ej. bloc de notas cifrado o password manager — **nunca** en el chat ni en el commit):

```powershell
# JWT_SECRET (64+ bytes hex)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# ADMIN_KEY (>= 32 chars)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# Postgres password (sin caracteres que rompan URL: evitar @ : / ? #)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

- [ ] **0.3** Anotar impacto de rotación: **todos los JWT actuales mueren** al cambiar `JWT_SECRET` → usuarios re-login. Esperado y aceptable.

**Doble check Fase 0**

| A | No aplica código | — |
| B | Secretos generados fuera del repo; plan de ventana de mantenimiento (5–10 min) acordado | Sí/No |

---

# Fase 1 — Quitar secretos del guardian + carga `.env`

**Objetivo:** el proceso **solo** obtiene secretos del entorno / `.env` no versionado. El archivo trackeado no contiene JWT, ADMIN_KEY ni password de DB.

### Task 1.1 — Cargador de entorno

**Files:**

- Create: `src/lib/loadEnv.js`
- Modify: `server.js` (primera línea útil de bootstrap)
- Modify: `cluster.js` (igual, **antes** de forkar workers)

- [ ] **1.1.1** Implementar `loadEnv(rootDir)`:
  - Lee `path.join(rootDir, '.env')` si existe.
  - Parsea `KEY=VALUE` (ignora líneas vacías y `#`).
  - **No sobrescribe** variables ya definidas en `process.env` (prioridad: SO/guardian > archivo).
  - No loguea valores.

- [ ] **1.1.2** Llamar `loadEnv` al inicio de `server.js` y `cluster.js`.

- [ ] **1.1.3** Test unitario mínimo en `test/loadEnv.test.js`:  
  archivo temporal con `FOO=bar`, no pisa `process.env.FOO` preexistente.

### Task 1.2 — Guardian sin literales

**Files:**

- Modify: `scripts/velocity-guardian.ps1`
- Modify: `.env.example`

- [ ] **1.2.1** En `Start-Backend`, **eliminar** toda cadena `set JWT_SECRET=...`, `ADMIN_KEY=...`, `DATABASE_URL=...password...`.  
  Sustituir por carga de `$Proj\.env`:

```powershell
# Pseudológica obligatoria:
# 1) Si no existe .env → Log error + no arrancar backend
# 2) Parsear KEY=VALUE (trim, skip #)
# 3) Exportar a $env:KEY para el proceso hijo
# 4) Arrancar: npm run start:cluster (sin concatenar secretos en la cmdline si es evitable;
#    preferible: el hijo hereda $env:* y loadEnv no pisa)
```

Requisitos duros del guardian post-cambio:

- Sigue fijando solo lo no secreto si hace falta (`NODE_ENV=production` puede vivir en `.env`).
- **Prohibido** que `git grep -E "JWT_SECRET=.+[a-f0-9]{20}|ADMIN_KEY=.+|VelocityDB|postgresql://[^:]+:[^@]+@"` en `scripts/` devuelva secretos reales.
- Paths absolutos de binarios PG/cloudflared pueden quedarse (no son secretos de app).

- [ ] **1.2.2** Actualizar `.env.example` con todas las keys de prod (valores falsos):

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=cambia-me
ADMIN_KEY=cambia-me-min-8-chars
ALLOWED_ORIGIN=https://velocitymusic.uk
USE_POSTGRES=1
DATABASE_URL=postgresql://velocity:CAMBIAR@localhost:5432/velocity_music
PGSSL=0
CLUSTER=1
GOOGLE_CLIENT_ID=
# opcional SMTP_*
```

- [ ] **1.2.3** Documentar en `docs/RELEASE.md` §7: “secretos solo en `.env`; guardian no contiene secretos”.

### Task 1.3 — Verificación Fase 1 (sin rotar prod todavía)

- [ ] **A:** `npm run verify`
- [ ] **B1:** `git grep -n "JWT_SECRET=" scripts/` → solo comentarios o lectura de env, **sin** hex largo.
- [ ] **B2:** `git check-ignore -v .env` sigue ignorando.
- [ ] **B3:** Arranque local sandbox: copiar `.env.example` → `data-staging` flow `npm run start:staging` con un `.env` de prueba; `GET /api/status` → operational.

**Gate:** no mergear/rotar hasta A+B verdes.

**Commit sugerido:** `security: load secrets from .env; strip guardian hardcodes`

---

# Fase 2 — Proteger `/api/stream-proxy` y `/api/resolve`

**Objetivo:** Internet anónimo no resuelve ni proxyfica audio; clientes legítimos (JWT + firma) siguen reproduciendo sin corte.

### Diseño de firma (contrato)

Mensaje canónico (UTF-8, orden fijo):

```text
v1\n{exp}\n{artist}\n{title}\n{id}\n{quality}\n{stream}
```

- `exp`: unix seconds, TTL default **4h** (alineado a stream-cache).  
- `sig`: `base64url(HMAC-SHA256(JWT_SECRET, message))`.  
- Query en proxy: mismos `artist`, `title`, `id`, `quality`, `stream` + `exp` + `sig`.  
- Verificación: `timingSafeEqual` sobre buffers de igual longitud; rechazo si `exp < now`, params vacíos inválidos, o firma mala → **401** (no 500).  
- **Clock skew:** tolerancia `+60s` opcional solo hacia futuro en `exp` max; no aceptar `exp` en el pasado.

Endpoints:

| Método | Ruta | Auth | Comportamiento |
|--------|------|------|----------------|
| GET | `/api/stream-sign?...` | `requireAuth` | Devuelve `{ exp, sig }` o URL completa firmada |
| GET | `/api/stream-proxy?...&exp&sig` | Firma válida | Igual que hoy + verify al inicio |
| GET | `/api/resolve?...` | `requireAuth` | Igual que hoy; sin JWT → 401 |

Rate-limit: **no** añadir limiter al proxy. Sí se puede limitar `/api/stream-sign` con `apiLimiter` existente.

### Task 2.1 — Módulo puro + tests primero (TDD)

**Files:**

- Create: `src/lib/streamSign.js`
- Create: `test/streamSign.test.js`

- [ ] **2.1.1** Tests que fallen primero:
  - firma estable para mismos inputs;
  - cambio de un param → verify false;
  - exp pasado → false;
  - tampering de `sig` → false;
  - property-based ligero: random artist/title (printable) round-trip sign/verify dentro de TTL.

- [ ] **2.1.2** Implementar `signStreamParams(params, secret, nowMs)` / `verifyStreamParams(params, secret, nowMs)`.

- [ ] **A-parcial:** `node --test test/streamSign.test.js` PASS.

### Task 2.2 — Backend wiring

**Files:**

- Modify: `src/services/streamProxy.js` — al inicio del handler, si deps traen `verifySignature` o se valida en `app.js` middleware previo.
- Modify: `src/app.js`

Preferencia anti-regresión: validar firma en **wrapper** en `app.js` antes de `createStreamProxyHandler`, para no reescribir la lógica de Range/retry:

```js
app.get('/api/stream-proxy', (req, res, next) => {
  if (!verifyStreamParams(req.query, jwtSecret)) {
    return res.status(401).json({ error: 'Enlace de stream inválido o caducado.' });
  }
  return streamProxyHandler(req, res, next);
});
```

- [ ] **2.2.1** `GET /api/stream-sign` con `requireAuth` → `{ exp, sig }` (el cliente ensambla la URL; mantiene `streamUrl` simple).
- [ ] **2.2.2** `GET /api/resolve` envuelto en `requireAuth` (si no hay authService en tests, comportamiento actual de tests con userRepo).
- [ ] **2.2.3** Tests integración:
  - proxy sin `sig` → 401;
  - proxy con firma válida + mock resolve → 200/206 como hoy;
  - resolve sin Bearer → 401;
  - resolve con Bearer de test → redirect/JSON como hoy;
  - **regresión gzip:** proxy sigue sin `Content-Encoding: gzip`;
  - hardening: cabeceras de seguridad intactas.

Actualizar tests existentes que llaman proxy/resolve sin firma (`test/server.test.js`, `test/regression.test.js`, `test/streamProxy.test.js`) para firmar con el mismo helper de test.

### Task 2.3 — Frontend (mínimo cambio, máxima compatibilidad audio)

**Files:**

- Modify: `frontend/src/api.js` (principal)
- Modify: `frontend/src/App.jsx` **solo si** hay paths síncronos que no puedan await

Diseño recomendado (cero regresión de “playSrc síncrono”):

1. Caché en memoria: `Map` clave `${id}|${quality}|${stream}` → `{ exp, sig, url }`  
2. `async ensureStreamUrl(trackParams)` — si caché válida (>60s de margen), reutiliza; si no, `GET /api/stream-sign` con `authHeaders()`, monta URL.  
3. `streamUrl(...)` síncrono: **deprecado para playback**; o bien:
   - Opción **preferida:** `streamUrl` síncrono solo construye base; callers de play ya async → migrar esos a `ensureStreamUrl`.  
   - En `App.jsx`, los puntos que ya son `async` al poner `playSrc` (~3076, 3220, 3310, offline fetch) llaman `await api.ensureStreamUrl(...)`.  
4. `prefetchStream` añade `authHeaders()` y, si se desea, firma opcional (prefetch puede ir a `/api/resolve` autenticado).

- [ ] **2.3.1** Offline: blobs locales **no** pasan por proxy firmado (no romper offline).  
- [ ] **2.3.2** Invitado: tiene JWT → puede firmar; sin token → UX de login, no 500.  
- [ ] **2.3.3** Actualizar `test/frontend.test.js`:  
  - helper de armado de query sigue conteniendo `/api/stream-proxy`;  
  - si se exporta `buildSignedStreamUrl({...params, exp, sig})`, test unitario puro sin red.

### Task 2.4 — Docs invariantes

- [ ] `docs/GUARDRAILS.md` §3/§6: proxy exige firma; resolve exige JWT; firma no pasa por rate-limit del stream.  
- [ ] Comentar en §5 que rotar `JWT_SECRET` invalida firmas de stream en vuelo (TTL corto → OK).

**Doble check Fase 2**

| A | `npm run verify` | 0 fails |
| B1 | Manual sandbox: login → play canción → audio avanza; seek/Range OK | Sí |
| B2 | Sin token: `curl` resolve y proxy sin sig → 401 | Sí |
| B3 | Con firma expirada artificial → 401 | Sí |
| B4 | Cola auto-extend / siguiente pista (GUARDRAILS §3) no rompe | Sí |
| B5 | Descarga offline sigue funcionando | Sí |

**Commit sugerido:** `security: HMAC stream URLs + auth on resolve`

---

# Fase 3 — Proteger `POST /api/setup/extractor/install`

**Objetivo:** en producción no se puede instalar binarios sin admin.

### Task 3.1

**Files:** `src/app.js`, `test/hardening.test.js` (o nuevo)

- [ ] **3.1.1** Lógica:

```text
si NODE_ENV === 'production':
  ADMIN_KEY configurada (≥8) y checkAdminKey(req) OK → instalar
  si no → 401/503 (503 si admin deshabilitado, 401 si clave mala)
si no production:
  permitir (dev/CI) OR exigir admin si ADMIN_KEY está set — elegir:
  → REGLA FIJA: en production siempre admin; fuera de production, sin auth
     (tests actuales de install no se rompen)
```

- [ ] **3.1.2** Tests:
  - `NODE_ENV=production`, sin key → no 200;
  - `NODE_ENV=production`, key correcta → llega al impl mock;
  - `NODE_ENV=test`, sin key → comportamiento dev (permitido o mock 501).

- [ ] **3.1.3** Opcional defensa en profundidad: rate-limit ya en admin; si install no está bajo `/api/admin`, aplicar `adminLimiter` a esta ruta.

**Doble check Fase 3**

| A | `npm run verify` | PASS |
| B | `curl -X POST https://.../api/setup/extractor/install` sin key en prod → 401/503 | Tras deploy |
| B2 | GET status extractor puede seguir público (solo lectura) — confirmar intencional | Documentado |

**Commit sugerido:** `security: require ADMIN_KEY for extractor install in production`

---

# Fase 4 — `npm audit fix` + nodemailer ≥ 9.0.3

**Objetivo:** 0 vulnerabilidades High conocidas en deps de producción; mailer sigue no-op sin SMTP.

### Task 4.1

**Files:** `package.json`, `package-lock.json`, posiblemente `src/services/mailer.js` si la API rompe.

- [ ] **4.1.1** En rama limpia:

```bash
npm install nodemailer@^9.0.3
npm audit fix
npm audit
```

- [ ] **4.1.2** Si `audit fix` toca `compression`/`on-headers`, aceptar solo si `npm run verify` pasa.  
  **No** usar `npm audit fix --force` si arrastra majors no relacionados sin revisar el diff del lockfile.

- [ ] **4.1.3** Smoke mailer: sin SMTP_* → `mailerEnabled() === false`; con mock no es obligatorio enviar correo real.  
  Revisar changelog nodemailer 9: `createTransport` se mantiene; no cambiar HTML del welcome salvo breakage.

**Doble check Fase 4**

| A | `npm run verify` | PASS |
| B1 | `npm audit` → 0 high (ideal 0 total; low residual documentado) | |
| B2 | Diff de lockfile revisado (sin deps sorpresa) | |

**Commit sugerido:** `security: upgrade nodemailer; npm audit fix`

---

# Fase 5 — Rotación operativa (producción)

**Objetivo:** invalidar secretos filtrados en git history. **Solo después** de Fases 1–4 mergeadas y desplegadas en el árbol que corre el guardian.

### Runbook (orden estricto)

- [ ] **5.1** Ventana: avisar (si hay usuarios) “re-login en ~10 min”.  
- [ ] **5.2** En la máquina host, crear/actualizar `C:\Users\...\VELOCITY MUSIC\.env` con:
  - `JWT_SECRET` **nuevo**
  - `ADMIN_KEY` **nuevo**
  - `DATABASE_URL` con password **nuevo**
  - resto igual (`ALLOWED_ORIGIN`, `GOOGLE_CLIENT_ID`, `USE_POSTGRES=1`, `CLUSTER=1`, …)
- [ ] **5.3** Postgres — cambiar password del rol **antes** o **atómico** con el restart:

```sql
ALTER USER velocity WITH PASSWORD 'el-nuevo-password';
```

(Ajustar nombre de rol al real.) Actualizar `DATABASE_URL` en `.env` en el mismo minuto.

- [ ] **5.4** Reinicio controlado:

```powershell
# Detener node del proyecto (no matar procesos ajenos a ciegas si hay otros Node)
# Luego dejar que velocity-guardian.ps1 relance, o:
npm run start:cluster   # solo tras cargar .env
```

- [ ] **5.5** Verificaciones prod (B):

| # | Check | Esperado |
|---|--------|----------|
| 1 | `GET /api/status` | `operational` |
| 2 | `GET /api/health` | 200 / db green |
| 3 | Login web con cuenta real | JWT nuevo, biblioteca OK |
| 4 | Play 30s + skip pista | audio continuo |
| 5 | `GET /api/stream-proxy` sin sig | 401 |
| 6 | `GET /api/resolve` sin Bearer | 401 |
| 7 | Admin panel con **nueva** key | 200; key vieja 401 |
| 8 | `POST /api/setup/extractor/install` sin key | 401/503 |
| 9 | Confirmar proceso hijo **no** muestra secretos en `Get-CimInstance` cmdline si se evitó `set KEY=...` en cmd | preferible |

- [ ] **5.6** Post-rotación: los secretos viejos se consideran **quemados**. No reutilizar. Historial git: purga opcional (filter-repo) **solo** si el remoto es público/compartido; es operación aparte, no bloquea el cierre P0 si ya rotaste.

**Doble check Fase 5:** tabla 5.5 completa en verde + nota de hora UTC del corte.

---

# Fase 6 — Cierre y trazabilidad

- [ ] **6.1** Matriz de cumplimiento:

| # | Objetivo semana 1 | Evidencia | Estado |
|---|-------------------|-----------|--------|
| 1 | Rotar JWT / ADMIN / PG password | Runbook 5.x + re-login | |
| 2 | Guardian sin secretos; `.env` no commiteado | `git grep` + `git ls-files .env` | |
| 3 | Stream proxy + resolve protegidos | tests + curl 401 + play OK | |
| 4 | Extractor install protegido en prod | tests + curl | |
| 5 | audit + nodemailer ≥9.0.3 | `npm audit` + lockfile | |

- [ ] **6.2** `npm run verify` final en `main`/`develop`.  
- [ ] **6.3** Actualizar checklist en `docs/GUARDRAILS.md` si falta ítem “stream firmado”.  
- [ ] **6.4** **No** declarar “P0 cerrado” si falta cualquier celda de 6.1.

---

## Riesgos residuales (aceptados / fuera de semana 1)

| Residual | Por qué no se mete aquí |
|----------|-------------------------|
| JWT en `localStorage` | Mitigado parcialmente por CSP; cookies httpOnly = proyecto aparte |
| Guest spam | Rate limit auth ya existe; retención guest = P1 |
| Historial git con secretos viejos | Rotación mitiga; purga de history es P0-ops opcional |
| Catálogo `/api/search` público | No es proxy de audio; abuso menor; no tocar en P0 |

---

## Anti-patrones (prohibidos en la ejecución)

1. Meter secretos nuevos en el guardian “temporalmente”.  
2. Exigir solo Bearer en `/api/stream-proxy` (rompe `<audio>`).  
3. Firmar en el cliente con un secreto embebido.  
4. Añadir rate-limit al body del stream.  
5. `npm audit fix --force` a ciegas.  
6. Rotar en prod **antes** de que el código lea `.env`.  
7. Commitear `.env` o `velocity-db.json` “para probar”.  
8. Refactorizar `App.jsx` entero “de paso”.

---

## Estimación realista

| Fase | Esfuerzo | Riesgo regresión |
|------|----------|------------------|
| 1 Env/guardian | 1–2 h | Bajo |
| 2 Stream/resolve | 3–5 h | **Alto** (audio) — más tests |
| 3 Extractor | 30–45 min | Bajo |
| 4 Deps | 30–60 min | Bajo–medio |
| 5 Rotación ops | 30–45 min | Medio (ventana) |
| 6 Cierre | 30 min | — |

**Total:** ~1 día de ingeniería + ventana de ops corta.

---

## Handoff de ejecución

Plan guardado en:

`docs/superpowers/plans/2026-07-10-security-p0-week1.md`

**Opciones al implementar:**

1. **Subagent-driven** — una subtarea/fase con review entre gates A/B.  
2. **Inline** — misma sesión, commits por fase, no saltar gates.

Al cerrar cada fase, el ejecutor debe dejar constancia:

```text
FASE <n> DONE
A: npm run verify → PASS (N tests)
B: <lista checks manuales>
COMMIT: <sha>
```
