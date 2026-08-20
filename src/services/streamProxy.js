import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { MAX_REDIRECTS, isRedirectStatus, resolveRedirect } from '../lib/redirectPolicy.js';

/**
 * Stream_Proxy — reenvía audio upstream al cliente con soporte de HTTP Range y
 * streaming progresivo.
 *
 * La lógica pura (validación, construcción de cabeceras, mapeo de estado y la
 * planificación de Range) se separa para poder probarla con PBT; el handler de
 * Express integra el I/O.
 *
 * Requisitos: 4.1–4.8, 15.3
 *
 * ── Normalización de Range (2026-08, bug 'no se puede reproducir lo no
 * descargado') ──
 * Los URLs que devuelve yt-dlp hoy (cliente android_vr, el único que evita
 * los PO tokens de YouTube) SOLO sirven rangos ACOTADOS y por debajo de ~1 MiB:
 *   bytes=0-4095        → 206
 *   bytes=0-            → 403   ← lo que envía el <audio> del navegador
 *   bytes=1000000-      → 403   ← seek normal
 *   sin Range           → 403   ← descargas / prebuffer
 *   bytes=0-1048575     → 403   ← chunk > ~1 MiB
 * Antes, el proxy reenviaba el Range del cliente 'sin modificar' (Requisito
 * 4.2), así que TODA reproducción de streaming fallaba con 502 y solo las
 * pistas descargadas (blob:) sonaban. El proxy ahora ACOTA todo Range abierto
 * o grande a chunks de RANGE_CHUNK_BYTES y, para peticiones sin Range,
 * encadena chunks hasta el final entregando un cuerpo 200 completo. El
 * navegador recibe un 206 honesto (Content-Range incluido) y continúa pidiendo
 * el siguiente trozo solo; el streaming/seek/descargas vuelven a funcionar
 * contra googlevideo sin tocar el contrato del cliente.
 */

export const PROXY_TIMEOUT_MS = 10000;

/**
 * Tamaño máximo del chunk que se pide upstream. googlevideo (URLs android_vr)
 * sirve rangos acotados de hasta ~768 KiB–1 MiB; 512 KiB deja margen y
 * equivale a ~26 s de Opus 160 kbps (el navegador pide el siguiente trozo
 * cuando lo necesita).
 */
export const RANGE_CHUNK_BYTES = 512 * 1024;

/** Valida artist/title: no vacíos, cada uno [1, 256]. (4.5) */
export function validateProxyParams(artist, title) {
  const a = String(artist ?? '').trim();
  const t = String(title ?? '').trim();
  if (!a || a.length > 256) return { ok: false, param: 'artist' };
  if (!t || t.length > 256) return { ok: false, param: 'title' };
  return { ok: true, artist: a, title: t };
}

/**
 * Construye las cabeceras de respuesta a partir de las cabeceras upstream.
 * (4.1, 4.3, 4.4) — `getHeader(name)` lee una cabecera upstream (case-insensitive).
 */
export function buildResponseHeaders(getHeader) {
  const headers = {
    'Content-Type': getHeader('content-type') || 'audio/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=14400',
  };
  for (const name of ['content-range', 'content-length']) {
    const value = getHeader(name);
    if (value) headers[name] = value;
  }
  return headers;
}

/**
 * Mapea el estado upstream a la acción del proxy.
 * 200/206 → pasar; cualquier otro → 502. (4.6)
 */
export function classifyUpstreamStatus(status) {
  if (status === 200 || status === 206) return { pass: true, status };
  return { pass: false, status: 502 };
}

/**
 * Parsea `Content-Range: bytes <start>-<end>/<total>` (o `*` para total).
 * @returns {{ start: number|null, end: number|null, total: number|null } | null}
 */
export function parseContentRange(value) {
  if (!value || typeof value !== 'string') return null;
  // Formas: `bytes S-E/T` (206), `bytes */T` (416), `bytes S-E/*` (total desconocido).
  const m = /^\s*bytes\s+(\d+|\*)\s*(?:-\s*(\d+|\*))?\s*\/\s*(\d+|\*)\s*$/i.exec(value.trim());
  if (!m) return null;
  const num = (s) => (s === '*' ? null : Number(s));
  const start = num(m[1]);
  const end = num(m[2] ?? '*');
  const total = num(m[3]);
  if (start !== null && end !== null && end < start) return null;
  return { start, end, total };
}

/**
 * Planifica qué Range enviar upstream a partir del Range del cliente.
 *
 *   sin Range                 → { kind: 'full' }        (encadenar chunks 0→fin, responder 200)
 *   bytes=N-   (abierto)      → { kind: 'bounded', range: bytes=N-(N+CHUNK-1) }
 *   bytes=N-M  ≤ CHUNK        → { kind: 'passthrough' } (se reenvía tal cual)
 *   bytes=N-M  > CHUNK        → { kind: 'bounded', range: bytes=N-(N+CHUNK-1) }
 *   bytes=-S   (sufijo)       → { kind: 'passthrough' } (raro en media)
 *   malformado                → { kind: 'passthrough' } (que decida el upstream)
 *
 * @param {string|undefined|null} clientRange
 * @returns {{ kind: 'full' } | { kind: 'passthrough', range: string } | { kind: 'bounded', range: string }}
 */
export function planUpstreamRange(clientRange) {
  if (!clientRange || typeof clientRange !== 'string') return { kind: 'full' };
  const raw = clientRange.trim();
  const m = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i.exec(raw);
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'passthrough', range: clientRange };

  const startRaw = m[1];
  const endRaw = m[2];

  // Sufijo (bytes=-N): sin start conocido; se reenvía tal cual.
  if (startRaw === '') return { kind: 'passthrough', range: clientRange };

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) return { kind: 'passthrough', range: clientRange };

  // Acotado (bytes=N-M).
  if (endRaw !== '') {
    const end = Number(endRaw);
    if (!Number.isFinite(end) || end < start) return { kind: 'passthrough', range: clientRange };
    if (end - start + 1 <= RANGE_CHUNK_BYTES) return { kind: 'passthrough', range: clientRange };
    return { kind: 'bounded', range: 'bytes=' + start + '-' + (start + RANGE_CHUNK_BYTES - 1) };
  }

  // Abierto (bytes=N-): acotar a un chunk.
  return { kind: 'bounded', range: 'bytes=' + start + '-' + (start + RANGE_CHUNK_BYTES - 1) };
}

/**
 * Crea el handler de Express del Stream_Proxy.
 *
 * @param {object} deps
 * @param {(params:object, ctx:object)=>Promise<{url:string}>} deps.resolveUrl
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {number} [deps.timeoutMs]
 */
export function createStreamProxyHandler({ resolveUrl, fetchImpl = fetch, timeoutMs = PROXY_TIMEOUT_MS }) {
  return async function streamProxyHandler(req, res) {
    const v = validateProxyParams(req.query.artist, req.query.title);
    if (!v.ok) {
      return res
        .status(400)
        .json({ error: 'Parámetro "' + v.param + '" faltante o inválido.' });
    }

    const stream = String(req.query.stream || '').trim() || undefined;
    const videoId = String(req.query.id || '').trim() || undefined;
    const quality = String(req.query.quality || '').trim() || undefined;

    const plan = planUpstreamRange(req.headers.range);

    // Fetch upstream con redirects manuales (misma política que antes: cada
    // salto se valida con redirectPolicy para evitar SSRF vía open-redirect).
    const fetchUpstream = async (url, rangeHeader, signal) => {
      const headers = {};
      if (rangeHeader) headers.Range = rangeHeader;
      let currentUrl = url;
      let upstream = await fetchImpl(currentUrl, { headers, signal, redirect: 'manual' });
      let hops = 0;
      while (isRedirectStatus(upstream.status)) {
        if (hops >= MAX_REDIRECTS) {
          return { kind: 'redirectBlocked', reason: 'too_many' };
        }
        const next = resolveRedirect(currentUrl, upstream.headers.get('location'));
        if (!next.ok) {
          return { kind: 'redirectBlocked', reason: next.reason };
        }
        currentUrl = next.url;
        hops += 1;
        upstream = await fetchImpl(currentUrl, { headers, signal, redirect: 'manual' });
      }
      return { kind: 'ok', upstream };
    };

    // Relay 200/206 simple (modos passthrough/bounded).
    const relayUpstream = (upstream) => {
      const responseHeaders = buildResponseHeaders((name) => upstream.headers.get(name));
      res.writeHead(upstream.status, responseHeaders);
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body).pipe(res);
    };

    // Modo 'full' (cliente sin Range — descargas/prebuffer): encadena chunks
    // acotados desde 0 hasta el final y los sirve como UN cuerpo 200 con
    // Content-Length = tamaño total (streaming progresivo). El timeout del
    // intento cubre la resolución + el PRIMER chunk; después la transferencia
    // fluye libre, igual que el relay simple (4.7 no debe matar descargas lentas).
    const streamFull = async (url, signal, clearDeadline) => {
      let start = 0;
      let first = true;
      let contentLength = null;
      // Reintentos de chunk con backoff: googlevideo aplica límites de ráfaga
      // por IP; un 403 puntual de un chunk se cura solo en ~1-2 s. Sin esto,
      // una descarga completa (muchos chunks seguidos) quedaba truncada en el
      // primer 403 de mitad de stream.
      // Reintentos de chunk SOLO para 403 y SOLO a mitad de stream: los 403
      // por ráfaga de googlevideo se curan en ~1-2 s. El PRIMER chunk falla
      // rápido (sin reintentos) para que el reintento con forceRefresh del
      // handler re-resuelva una URL fresca; reintentar una URL caducada 3 veces
      // solo añadiría latencia. Fallos no transitorios (redirect bloqueado,
      // red, otros estados) no se reintentan aquí.
      const fetchChunk = async (range, allowRetries) => {
        const attempts = allowRetries ? 3 : 1;
        let last;
        for (let i = 0; i < attempts; i++) {
          if (i > 0) await sleep(i === 1 ? 800 : i === 2 ? 1800 : 3200);
          try {
            last = await fetchUpstream(url, range, signal);
          } catch {
            last = { kind: 'networkError' };
          }
          if (
            last.kind === 'ok' &&
            (last.upstream.status === 206 || last.upstream.status === 200 || last.upstream.status === 416)
          ) {
            return last;
          }
          if (!allowRetries) return last;
          if (!(last.kind === 'ok' && last.upstream.status === 403)) return last;
        }
        return last;
      };
      while (true) {
        let r = await fetchChunk('bytes=' + start + '-' + (start + RANGE_CHUNK_BYTES - 1), !first);
        if (r.kind !== 'ok') {
          if (res.headersSent) { res.end(); return { kind: 'ok', upstream: null }; }
          if (typeof clearDeadline === 'function') clearDeadline();
          return r;
        }
        const up = r.upstream;

        // CDN que ignora Range → cuerpo completo; servir tal cual y terminar.
        if (up.status === 200) {
          if (first) {
            if (!res.headersSent) {
              const headers = buildResponseHeaders((name) => up.headers.get(name));
              res.writeHead(200, headers);
            }
            if (typeof clearDeadline === 'function') clearDeadline();
            first = false;
          }
          if (up.body) Readable.fromWeb(up.body).pipe(res);
          res.end();
          return { kind: 'ok', upstream: null };
        }

        // Fin del archivo alcanzado antes de lo esperado (416).
        if (up.status === 416) {
          if (first) {
            if (typeof clearDeadline === 'function') clearDeadline();
            return { kind: 'upstreamBad', status: 416 };
          }
          res.end();
          return { kind: 'ok', upstream: null };
        }

        if (up.status !== 206) {
          if (first) {
            if (typeof clearDeadline === 'function') clearDeadline();
            return { kind: 'upstreamBad', status: up.status };
          }
          // Error a mitad de stream: terminar sin estado adicional (4.8).
          res.end();
          return { kind: 'ok', upstream: null };
        }

        if (first) {
          if (!res.headersSent) {
            const cr0 = parseContentRange(up.headers.get('content-range'));
            if (cr0 && cr0.total != null) contentLength = cr0.total;
            const fullHeaders = {
              'Content-Type': up.headers.get('content-type') || 'audio/mp4',
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=14400',
            };
            // Content-Length honesto (total del archivo): si el stream muere a
            // mitad, el cliente detecta el cuerpo corto y reintenta la descarga
            // en lugar de aceptar un blob truncado silenciosamente.
            if (contentLength != null) fullHeaders['Content-Length'] = String(contentLength);
            res.writeHead(200, fullHeaders);
          }
          if (typeof clearDeadline === 'function') clearDeadline();
          first = false;
        }

        try {
          if (up.body) await pipeline(Readable.fromWeb(up.body), res, { end: false });
        } catch {
          // Error de red a mitad del cuerpo: terminar sin estado adicional (4.8).
          if (!res.headersSent) return { kind: 'networkError' };
          res.end();
          return { kind: 'ok', upstream: null };
        }

        const cr = parseContentRange(up.headers.get('content-range'));
        if (!cr || cr.end == null || cr.total == null) break; // sin límites conocidos → terminamos
        if (contentLength == null && cr.total != null) contentLength = cr.total;
        if (cr.end >= cr.total - 1) break;
        start = cr.end + 1;
        // Pequeño respiro entre chunks: reduce la presión de ráfaga sobre el
        // rate-limit por IP de googlevideo (los chunks encadenados sin pausa
        // disparaban 403 en descargas completas).
        await sleep(120);
      }
      res.end();
      return { kind: 'ok', upstream: null };
    };

    /** Backoff simple entre reintentos de chunk. */
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Un intento = resolver (con o sin caché) + fetch upstream. Devuelve un
    // resultado tipado sin escribir en `res` (salvo en el modo 'full', que
    // empieza a transmitir en cuanto tiene el primer chunk), para poder
    // reintentar limpiamente con forceRefresh.
    const attempt = async (forceRefresh) => {
      let targetUrl;
      try {
        const resolved = await resolveUrl({ artist: v.artist, title: v.title, stream, videoId, quality }, { forceRefresh });
        targetUrl = resolved && resolved.url;
      } catch (err) {
        return { kind: 'resolveError', status: err && err.status ? err.status : 502 };
      }
      if (!targetUrl) return { kind: 'notFound' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const clearDeadline = () => clearTimeout(timer);

      if (plan.kind === 'full') {
        return streamFull(targetUrl, controller.signal, clearDeadline);
      }

      try {
        const rangeHeader = plan.range || undefined;
        const r = await fetchUpstream(targetUrl, rangeHeader, controller.signal);
        clearDeadline();
        if (r.kind !== 'ok') return r;
        const cls = classifyUpstreamStatus(r.upstream.status);
        if (!cls.pass) return { kind: 'upstreamBad', status: r.upstream.status };
        return { kind: 'ok', upstream: r.upstream };
      } catch {
        clearDeadline();
        return { kind: 'networkError' };
      }
    };

    // 1er intento con caché. Si el upstream falla (URL de audio expirada/403) o
    // hay error de red, se reintenta UNA vez re-resolviendo con URL fresca.
    let r = await attempt(false);
    if (r.kind === 'upstreamBad' || r.kind === 'networkError') {
      r = await attempt(true);
    }

    // Si ya se enviaron cabeceras (p.ej. fallo durante el pipe), solo terminar. (4.8)
    if (res.headersSent) return res.end();

    if (r.kind === 'ok' && r.upstream) {
      try {
        relayUpstream(r.upstream);
        return;
      } catch {
        if (!res.headersSent) return res.status(504).json({ error: 'La fuente de audio no está disponible.' });
        return res.end();
      }
    }
    if (r.kind === 'redirectBlocked') {
      // No se reintenta: re-resolver daría el mismo salto. Se responde 502 sin
      // revelar el destino bloqueado.
      return res.status(502).json({ error: 'La fuente de audio redirigió a un destino no permitido.' });
    }
    if (r.kind === 'notFound') return res.status(404).json({ error: 'No se encontró una fuente de audio.' });
    if (r.kind === 'resolveError') return res.status(r.status).json({ error: 'No se pudo resolver la pista.' });
    if (r.kind === 'networkError') return res.status(504).json({ error: 'La fuente de audio no está disponible.' });
    // upstreamBad tras reintento.
    return res.status(502).json({ error: 'La fuente de audio respondió ' + r.status + '.' });
  };
}
