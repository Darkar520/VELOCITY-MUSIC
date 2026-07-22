import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TTL por defecto de un enlace de stream firmado (23h).
 * Nota: el TTL de la firma (23h) es deliberadamente mayor que el del caché
 * de yt-dlp en streamCache.js (≈5h). Esto es correcto: si la URL subyacente
 * expira antes de que expire la firma, handleAudioError re-resuelve la URL
 * de forma automática. El TTL largo cubre sesiones largas sin re-firma.
 */
export const DEFAULT_STREAM_TTL_SECONDS = 23 * 3600;

/**
 * Mensaje canónico para HMAC (orden fijo, UTF-8).
 * El prefijo v1 evita colisiones con otros usos del mismo secreto.
 */
export function canonicalStreamMessage({ exp, artist, title, id, quality, stream }) {
  return [
    'v1',
    String(exp ?? ''),
    String(artist ?? ''),
    String(title ?? ''),
    String(id ?? ''),
    String(quality ?? ''),
    String(stream ?? ''),
  ].join('\n');
}

function hmacBase64Url(secret, message) {
  return createHmac('sha256', String(secret))
    .update(message, 'utf8')
    .digest('base64url');
}

/**
 * Firma parámetros de stream.
 * @param {{ artist?: string, title?: string, id?: string, quality?: string, stream?: string }} params
 * @param {string} secret
 * @param {{ nowMs?: number, ttlSeconds?: number }} [opts]
 * @returns {{ exp: number, sig: string }}
 */
export function signStreamParams(params, secret, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const ttl = opts.ttlSeconds ?? DEFAULT_STREAM_TTL_SECONDS;
  const exp = Math.floor(nowMs / 1000) + Math.max(1, Math.floor(ttl));
  const message = canonicalStreamMessage({
    exp,
    artist: params.artist,
    title: params.title,
    id: params.id,
    quality: params.quality,
    stream: params.stream,
  });
  const sig = hmacBase64Url(secret, message);
  return { exp, sig };
}

/**
 * Verifica firma + caducidad. Comparación en tiempo constante.
 * @param {Record<string, unknown>} params query (artist, title, id, quality, stream, exp, sig)
 * @param {string} secret
 * @param {{ nowMs?: number }} [opts]
 * @returns {boolean}
 */
export function verifyStreamParams(params, secret, opts = {}) {
  try {
    if (!secret) return false;
    const expRaw = params?.exp;
    const sig = String(params?.sig ?? '');
    if (expRaw === undefined || expRaw === null || expRaw === '' || !sig) return false;

    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) return false;

    const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
    // Rechazar expirados. No se acepta skew hacia el pasado (fail-closed).
    if (exp < nowSec) return false;

    const message = canonicalStreamMessage({
      exp,
      artist: params.artist,
      title: params.title,
      id: params.id,
      quality: params.quality,
      stream: params.stream,
    });
    const expected = hmacBase64Url(secret, message);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Construye la querystring firmada para /api/stream-proxy (sin path).
 */
export function buildSignedStreamQuery(params, secret, opts = {}) {
  const { exp, sig } = signStreamParams(params, secret, opts);
  const q = new URLSearchParams();
  if (params.artist) q.set('artist', String(params.artist));
  if (params.title) q.set('title', String(params.title));
  if (params.id) q.set('id', String(params.id));
  if (params.quality) q.set('quality', String(params.quality));
  if (params.stream) q.set('stream', String(params.stream));
  q.set('exp', String(exp));
  q.set('sig', sig);
  return { exp, sig, query: q.toString() };
}
