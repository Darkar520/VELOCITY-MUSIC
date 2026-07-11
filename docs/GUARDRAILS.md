# Velocity Music — Guardrails contra regresiones

Este documento fija las **invariantes críticas** del proyecto: cosas que ya se
rompieron alguna vez o que sostienen la experiencia principal. **Antes de
mergear cualquier cambio**, verifica que ninguna de estas se viole.

> Regla de oro: implementar algo NO debe romper otra cosa. Cambios mínimos,
> sin sobreingeniería, sin redundancia, sin regresiones.

---

## 1. Flujo de verificación obligatorio

Antes de cada commit que toque código:

```bash
npm run verify      # corre TODOS los tests (node --test) + build del frontend
```

- Debe salir **verde**: 0 tests fallando y build exitoso.
- Los tests de propiedad (fast-check) deben ser **deterministas** — si uno es
  flaky, se arregla el test o el código, nunca se ignora.
- Si tocas el frontend: `cd frontend && npm run build` (sale a `../public`).
- Si tocas el backend: reinicia el proceso Node (el guardián lo revive) y
  verifica `GET /api/status` → `{"status":"operational"}`.

## 2. Despliegue (cómo llega a los usuarios)

- **Frontend:** `npm run build` → escribe en `public/`. El backend sirve
  `public/` como estático. Los assets llevan hash en el nombre (cacheables
  para siempre); `index.html` y `sw.js` van con `no-cache`.
- **PWA auto-update:** al desplegar, los clientes instalados se actualizan
  solos (el SW detecta versión nueva y recarga **solo cuando la música está
  pausada**, para no cortar reproducción). No romper esto (ver §7).
- **Backend:** cambios en `src/**` requieren reiniciar Node. El guardián
  (`scripts/velocity-guardian.ps1`) mantiene vivos backend + túnel.
- **Público:** `https://velocitymusic.uk` vía Cloudflare Named Tunnel
  (sin límite de ancho de banda). URL fija.

---

## 3. Continuidad de audio — PRIORIDAD MÁXIMA

La reproducción NUNCA debe cortarse. Invariantes:

- **Un solo `<audio>` principal** reproduce; pre-buffers son auxiliares y se
  **vacían al ir a background** (Chrome confunde Media Session con 3 audios).
- **Lógica pura en `frontend/src/audioContinuity.js`** + tests en
  `test/audioContinuity.test.js`. No reintroducir comportamientos que fallen
  esos tests.
- **En background (document hidden): SOLO `audio.play()` suave.** NUNCA
  `forceReacquire` / `pause+load+play` / `load()` al cambiar de pista con la
  pantalla apagada o la app oculta. Eso **mata la sesión de media en Chrome**
  (Brave a veces aguanta; no es razón para volver al reacquire en bg).
- **Salir de la app / apagar pantalla (Chrome y todos):**
  - La música DEBE seguir. Watchdog en background (`startBackgroundWatch`):
    - si `paused` → soft `play()`
    - si **zombie** (`!paused` pero `currentTime` no avanza) → soft kick
      (`pause`+`play` **sin** `load`) — bug Chrome “pegado en el segundo N”
  - Restaurar posición **solo si rebobinó**, nunca si está en el mismo segundo.
  - Media Session `playing` solo con progreso real o play recuperado.
- **Vídeo YouTube/Facebook (robo real de foco de audio):**
  - Si tras keep-alive el audio sigue pausado → interrupción confirmada:
    Media Session **`paused`**, posición congelada.
  - Al volver a Velocity / play en notificación: restaurar segundo y `play()`.
- **Fade-in (`volume=0`) SOLO con página visible.** Si rAF se congela en
  background, el volume se queda en 0 → “suena en silencio”. En bg: `volume=vol`.
- **Auto-avance en segundo plano:** la cola se **pre-extiende** en última o
  **penúltima** pista (`shouldPreExtendQueue`). Así `next()` es síncrono al
  terminar con pantalla bloqueada. No resolver la siguiente con `await` en
  `onEnded` si se puede evitar.
- **`onPause` externo** no hace `setPlaying(false)`. Solo pause del usuario
  (toggle / Media Session pause) cambia la intención.
- **`playingRef`** DEBE estar declarado y sincronizado con `playing`.
- **Web Audio API** no debe secuestrar el `<audio>` para normalizar (suspende
  el contexto en background). Solo ajuste de volumen.
- El **proxy de streaming** (`/api/stream-proxy`) NO pasa por gzip ni por rate
  limiting (rompería Range/playback). Ver §6.
- **Firma HMAC obligatoria** en `/api/stream-proxy` (`exp` + `sig`). El
  `<audio>` no envía Bearer; firma vía `GET /api/stream-sign` →
  `api.ensureStreamUrl()`. Sin firma → 401.
- **Prefirma de cola:** actual + próximas pistas (`warmStreamUrl` /
  `peekStreamUrl`). `play()` / `next()` / `onEnded` ponen `playSrc` **en
  síncrono** si hay hit (margen ≥90s). No depender de `await` de red al
  avanzar con pantalla bloqueada.
- **`/api/resolve` requiere JWT** (prefetch/warm-up). Sin token → 401.
- **Compatibilidad:** Chrome, Brave, Edge, Opera, Safari iOS (PWA/móvil).
  No optimizar solo para un navegador a costa de otro.

### Checklist manual anti-regresión (móvil)

1. Cola ≥3 online → bloquear pantalla → debe avanzar a la siguiente.
2. Reproducir → abrir YouTube/FB vídeo → al volver a Velocity: audio reanuda
   con volumen real (no silencio zombie).
3. Offline descargada: no regresión de blob.
4. Media Session: play/pause/next en pantalla de bloqueo.

## 4. Carátulas

- `CoverImg` **reinicia** `loaded/failed` al cambiar `src` (si no, un fallo
  deja el fallback pegado en las siguientes canciones).
- `hiResCover(url, size)` pide el **tamaño real** (≈512 miniaturas, ≈900 el
  reproductor grande). No volver a 1200px en todo (era lento).
- Las carátulas se muestran directo desde su host (googleusercontent, etc.).
  El proxy `/img` existe pero **no** se usa para el `<audio>` ni para reproducir
  (proxeaba y causaba interferencia). Solo para descargas/casos puntuales.

## 5. Autenticación y privacidad

- Contraseñas: **solo hash scrypt con sal** (`scrypt$sal$hash`). Nunca texto
  plano, nunca en logs, nunca en respuestas ni en el panel admin.
- Google login: se guarda **solo el email verificado** (no tokens, no
  contraseña de Google).
- Modo invitado: cuenta anónima efímera (`*@velocity.guest`), token JWT normal.
- Redirect de Google OAuth registrado para `https://velocitymusic.uk`. Si
  cambia el dominio, hay que re-registrarlo en Google Cloud Console.
- **JWT TTL configurable** vía `JWT_TTL_DAYS` (default 30, rango 1..3650).
  Antes era ~10 años (indefinido). Si se cambia, los tokens existentes siguen
  válidos hasta su `exp`.
- **Cada JWT incluye `jti`** (JWT ID único de 32 hex chars). Esto permite
  revocación individual sin enumerar tokens emitidos.
- **Logout real**: `POST /api/auth/logout` revoca el `jti` actual; `POST
  /api/auth/logout-all` invalida todos los tokens del usuario vía
  `tokens_invalid_before` (columna BIGINT en `users`). El middleware
  `requireAuth` verifica ambos en cada petición protegida (fail-closed).
- **CORS fail-closed en producción**: si `NODE_ENV=production` y
  `ALLOWED_ORIGIN` no está seteado, se rechazan peticiones cross-origin.
  En dev se mantiene `'*'` por comodidad.
- **trust proxy = 1** (no `true`): solo se confía en el último hop
  (Cloudflare). Evita spoofing de IP para evadir rate limits.
- **Cabeceras de seguridad**: CSP estricta (script-src 'self'), HSTS en HTTPS,
  Permissions-Policy restrictivo. Aplicadas a todas las respuestas HTML/JSON.

## 6. Rendimiento y escalabilidad

- **gzip** solo para texto (JSON/HTML/JS/CSS); excluye `/api/stream-proxy` y
  `/img`.
- **Rate limiting** por IP en endpoints costosos (`/api/auth`, search, resolve,
  radio, artist, album, lyrics, stream-sign). NUNCA en el body del streaming.
- **`POST /api/setup/extractor/install`**: en `NODE_ENV=production` exige
  `ADMIN_KEY` (header `X-Admin-Key`). Sin ella → 401/503.
- **Resolución yt-dlp:** limitador de concurrencia (`RESOLVE_CONCURRENCY`, def.
  4) + deduplicación en vuelo (mismas peticiones simultáneas = 1 sola).
- **StreamCache** persistente en disco (`data/stream-cache.json`), TTL ~4h,
  se descartan expiradas al cargar. Volcado atómico.
- **Búsqueda (frontend):** solo la petición vigente actualiza la UI; se ignora
  `AbortError`; reintenta 1 vez antes de mostrar error. No mostrar "backend
  caído" ante cancelaciones/fallos transitorios.

## 7. PWA / Service Worker

- `sw.js`: navegación = network-first (shell siempre fresco); assets con hash =
  cache-first (inmutables); `/api/*` = siempre red.
- Al cambiar el SW, **subir la versión de cache** (`CACHE = 'velocity-vN'`).
- El backend sirve `index.html`/`sw.js` con `no-cache` y los assets con
  `immutable`. No invertir esto.
- Recarga automática **solo con música pausada**.

## 8. Base de datos

- **Por defecto: JSON** (`data/velocity-db.json`), persistente, escritura
  atómica con debounce. Editarlo directo con herramientas de FS, nunca a mano.
- **PostgreSQL: opt-in** (`USE_POSTGRES=1`). Los repos PG tienen paridad con
  los JSON (perfil, avatar, álbumes, metadatos, stats, search log). Migración:
  `npm run db:migrate`.
- **Cluster** (`npm run start:cluster`) SOLO con `USE_POSTGRES=1` (el JSON se
  corrompe entre procesos). Reparte `RESOLVE_CONCURRENCY` entre workers.

## 9. Herramientas y edición

- **NUNCA** editar archivos fuente con `Set-Content` / redirecciones de
  PowerShell: corrompió la codificación de `App.jsx` (UTF-8→Latin-1). Usar
  siempre las herramientas de edición del editor (preservan encoding).
- Terminal: PowerShell 5.1 — sin operador ternario `?:`, separar comandos con
  `;`, envolver rutas con espacios con `& "..."`.

## 10. Admin / trazabilidad

- Panel: `GET /api/admin/stats?html=1` con header `X-Admin-Key: <ADMIN_KEY>`
  (preferido) o `?key=<ADMIN_KEY>` (deprecado, emite warning). Vista general
  (usuarios, totales) y drill-down por usuario (reproducciones con título,
  búsquedas, top canciones).
- Protegido por `ADMIN_KEY` (variable de entorno, ≥8 caracteres). **SIN default**:
  si no está configurada, el panel queda **deshabilitado** (503). Nunca se
  expone con una clave débil.
- Comparación con `timingSafeEqual` (anti-timing attack).
- Rate-limit estricto en `/api/admin/*` (30 req/min por IP) para mitigar
  brute-force de `ADMIN_KEY`.
- Todo el HTML del panel escapa entrada de usuario (anti-XSS).
- SSE `/api/now-playing/events`: prefiere header `Authorization`, fallback a
  `?token=` con warning en stderr (EventSource nativo no soporta headers).

## 11. Proceso de release (staging → producción)

Ver **docs/RELEASE.md**. Reglas duras:

- **Nada llega a producción sin pasar la puerta de calidad** (tests + build).
- **No commitear directo a `main`**: `feature/* → develop → main` vía PR.
- Probar en **sandbox** (`npm run start:staging`, puerto 3001, `data-staging/`
  aislado) y/o en el **preview de Cloudflare Pages** antes de promocionar.
- Puertas: pre-push hook (`npm run setup:hooks`), `npm run preflight`, y CI
  (GitHub Actions). Merge a `main` bloqueado si el CI está rojo.
- Cabeceras de seguridad activas (nosniff, X-Frame-Options, Referrer-Policy,
  CSP, HSTS, Permissions-Policy).

---

## Checklist rápido antes de commitear

- [ ] `npm run verify` en verde.
- [ ] No rompí continuidad de audio (§3) ni el streaming (§6).
- [ ] Carátulas cargan y no desaparecen al cambiar de canción (§4).
- [ ] No expuse datos sensibles (§5).
- [ ] Si toqué el SW, subí la versión de cache (§7).
- [ ] Cambio mínimo, sin duplicar lógica existente.
