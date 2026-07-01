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

    let targetUrl;
    try {
      const resolved = await resolveUrl({ artist: v.artist, title: v.title, stream, videoId, quality });
      targetUrl = resolved && resolved.url;
    } catch (err) {
      const status = err && err.status ? err.status : 502;
      return res.status(status).json({ error: 'No se pudo resolver la pista.' });
    }
    if (!targetUrl) {
      return res.status(404).json({ error: 'No se encontró una fuente de audio.' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;

      const upstream = await fetchImpl(targetUrl, { headers, signal: controller.signal });
      clearTimeout(timer);

      const cls = classifyUpstreamStatus(upstream.status);
      if (!cls.pass) {
        return res
          .status(502)
          .json({ error: `La fuente de audio respondió ${upstream.status}.` });
      }

      const responseHeaders = buildResponseHeaders((name) => upstream.headers.get(name));
      res.writeHead(upstream.status, responseHeaders);

      if (!upstream.body) return res.end();
      // Streaming progresivo: la reproducción puede empezar antes de transferir todo. (15.3)
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (err) {
      clearTimeout(timer);
      // Timeout o fallo de conexión → 504. (4.7)
      if (!res.headersSent) {
        return res.status(504).json({ error: 'La fuente de audio no está disponible.' });
      }
      // Error tras enviar cabeceras → terminar sin estado adicional. (4.8)
      return res.end();
    }
  };
}
