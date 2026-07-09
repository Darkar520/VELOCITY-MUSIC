import { Readable } from 'node:stream';

/**
 * Stream_Proxy — reenvía audio upstream al cliente con soporte de HTTP Range y
 * streaming progresivo.
 *
 * La lógica pura (validación, construcción de cabeceras, mapeo de estado) se
 * separa para poder probarla con PBT; el handler de Express integra el I/O.
 *
 * Requisitos: 4.1–4.8, 15.3
 */

export const PROXY_TIMEOUT_MS = 10000;

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
        .json({ error: `Parámetro "${v.param}" faltante o inválido.` });
    }

    const stream = String(req.query.stream || '').trim() || undefined;
    const videoId = String(req.query.id || '').trim() || undefined;
    const quality = String(req.query.quality || '').trim() || undefined;

    // Un intento = resolver (con o sin caché) + fetch upstream. Devuelve un
    // resultado tipado sin escribir en `res`, para poder reintentar limpiamente.
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
      try {
        const headers = {};
        if (req.headers.range) headers.Range = req.headers.range;
        const upstream = await fetchImpl(targetUrl, { headers, signal: controller.signal });
        clearTimeout(timer);
        const cls = classifyUpstreamStatus(upstream.status);
        if (!cls.pass) return { kind: 'upstreamBad', status: upstream.status };
        return { kind: 'ok', upstream };
      } catch (err) {
        clearTimeout(timer);
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

    if (r.kind === 'ok') {
      try {
        const upstream = r.upstream;
        const responseHeaders = buildResponseHeaders((name) => upstream.headers.get(name));
        res.writeHead(upstream.status, responseHeaders);
        if (!upstream.body) return res.end();
        // Streaming progresivo: la reproducción puede empezar antes de transferir todo. (15.3)
        Readable.fromWeb(upstream.body).pipe(res);
        return;
      } catch (err) {
        if (!res.headersSent) return res.status(504).json({ error: 'La fuente de audio no está disponible.' });
        return res.end();
      }
    }
    if (r.kind === 'notFound') return res.status(404).json({ error: 'No se encontró una fuente de audio.' });
    if (r.kind === 'resolveError') return res.status(r.status).json({ error: 'No se pudo resolver la pista.' });
    if (r.kind === 'networkError') return res.status(504).json({ error: 'La fuente de audio no está disponible.' });
    // upstreamBad tras reintento.
    return res.status(502).json({ error: `La fuente de audio respondió ${r.status}.` });
  };
}
