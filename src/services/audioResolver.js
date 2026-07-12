import { normalizeText, isUsableUrl } from '../lib/normalize.js';

/**
 * Audio_Resolver — resuelve una URL de pista completa reproducible para
 * (artist, title) usando yt-dlp contra YouTube Music como ruta primaria.
 *
 * Orden de resolución (Requisitos 2.1–2.11, 3.1, 3.2, 3.7):
 *   1. Stream_Cache (clave normalizada). Hit → devuelve URL.
 *   2. URL `stream` http(s) explícita válida → usar sin invocar yt-dlp.
 *   3. Full_Mode + yt-dlp resuelve pista completa ≤ 10 s → usar esa URL.
 *   4. yt-dlp inalcanzable/error/timeout → degradar (modo efectivo `degraded`).
 *   5. Sin fuente reproducible → 404 (no cachear).
 *
 * El extractor se inyecta como `extractorImpl({ artist, title })` que devuelve
 * una URL directa o lanza/retorna null. El emparejamiento de candidatos del
 * catálogo (cuando se usa) se hace con `matchYouTubeMusicCandidate`.
 */

export const EXTRACTOR_TIMEOUT_MS = 10000;

export class ResolveError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'ResolveError';
    this.status = status;
    Object.assign(this, extra);
  }
}

/**
 * Resultado de resolución:
 *  { status: 302, url, fromCache, mode }                         éxito
 *  lanza ResolveError(400) parámetros inválidos
 *  { status: 'degraded', mode: 'degraded', message }             fallo extractor en full
 *  lanza ResolveError(404) sin fuente reproducible
 */
export async function resolve(params = {}, ctx = {}) {
  const { artist: rawArtist, title: rawTitle, stream, quality, duration } = params;
  const {
    cache,
    mode = 'full',
    extractorImpl,
    catalogImpl,
    timeoutMs = EXTRACTOR_TIMEOUT_MS,
    forceRefresh = false,
    mbEnrich = null,         // (artist, title, duration?) => {mbid, year, albumName, ...} | null
    fallbackChain = true,    // cadena de 3 tiers (YTM → YTM-clean → YT-plan). default ON.
  } = ctx;

  const artist = String(rawArtist ?? '').trim();
  const title = String(rawTitle ?? '').trim();

  // Validación de entrada (2.1, 2.2).
  const invalid = validateParam('artist', artist) || validateParam('title', title);
  if (invalid) {
    throw new ResolveError(400, invalid.message, { param: invalid.param });
  }

  const baseKey = params.videoId
    ? `yt:${params.videoId}`
    : cache
      ? cache.keyFor(artist, title)
      : `${normalizeText(artist)}:${normalizeText(title)}`;
  const key = quality ? `${baseKey}#${quality}` : baseKey;

  // 1) Caché. Con forceRefresh se omite (la URL cacheada expiró/falló): se
  //    re-resuelve y el cache.set posterior sobrescribe con la URL fresca.
  if (cache && !forceRefresh) {
    const cached = cache.get(key);
    if (cached) {
      return { status: 302, url: cached, fromCache: true, mode };
    }
  }

  // 2) URL de stream explícita válida (2.4) — sin invocar yt-dlp.
  if (isUsableUrl(stream)) {
    if (cache) cache.set(key, stream);
    return { status: 302, url: stream, fromCache: false, mode };
  }

  // 3) Full_Mode + yt-dlp (2.3, 2.5–2.7, 2.11).
  if (mode === 'full' && typeof extractorImpl === 'function') {
    const tierBudget = fallbackChain && typeof mbEnrich === 'function' ? 3 : 1;
    // 3 tiers x ~8-9s cada uno cabe en timeoutMs=30s. Sin fallbackChain se respeta
    // el comportamiento historico (1 intento, timeoutMs completo).
    const perTierMs = fallbackChain && typeof mbEnrich === 'function'
      ? Math.min(9000, Math.floor(timeoutMs / 3))
      : timeoutMs;

    let url = null;
    let mbData = null;

    // Tier 1: YTM con query original (comportamiento historico).
    try {
      url = await withTimeout(
        extractorImpl({ artist, title, videoId: params.videoId, quality, sourcePool: 'ytm' }),
        perTierMs,
      );
    } catch { url = null; }

    // Tier 2 y 3 solo si fallbackChain activo y MB disponible.
    if (!isUsableUrl(url) && fallbackChain && typeof mbEnrich === 'function') {
      try { mbData = await withTimeout(mbEnrich({ artist, title, duration }), 3000); }
      catch { mbData = null; }

      if (mbData) {
        // Query canonica limpia: artist + title (MB) + album opcional.
        const cleanArtist = artist;
        const cleanTitle = title;
        const cleanQuery = mbData.albumName
          ? `${cleanArtist} - ${cleanTitle} ${mbData.albumName}`.trim()
          : `${cleanArtist} - ${cleanTitle}`;

        // Tier 2: YTM con query limpia (mismo pool, query distinta).
        try {
          url = await withTimeout(
            extractorImpl({ artist: cleanArtist, title: cleanTitle, quality, sourcePool: 'ytm', query: cleanQuery }),
            perTierMs,
          );
        } catch { url = null; }

        // Tier 3: YouTube plano, query limpia (covers, lives, fan uploads).
        if (!isUsableUrl(url)) {
          try {
            url = await withTimeout(
              extractorImpl({ artist: cleanArtist, title: cleanTitle, quality, sourcePool: 'yt', query: cleanQuery }),
              perTierMs,
            );
          } catch { url = null; }
        }
      }
    }

    void tierBudget;
    if (isUsableUrl(url)) {
      if (cache) cache.set(key, url);
      return {
        status: 302,
        url,
        fromCache: false,
        mode: 'full',
        ...(mbData ? { mbid: mbData.mbid, mbEnriched: true } : {}),
      };
    }
    // 4) Degradación ante fallo del extractor (2.8).
    return {
      status: 'degraded',
      mode: 'degraded',
      message:
        'La resolución de pista completa no estuvo disponible para la pista solicitada.',
    };
  }

  // 5) Sin fuente reproducible (2.9) — no cachear (3.7).
  void catalogImpl;
  throw new ResolveError(
    404,
    `No se encontró una fuente de audio reproducible para "${artist} - ${title}".`,
  );
}

function validateParam(name, value) {
  if (!value || value.length < 1) {
    return { param: name, message: `El parámetro "${name}" es obligatorio.` };
  }
  if (value.length > 200) {
    return { param: name, message: `El parámetro "${name}" supera los 200 caracteres.` };
  }
  return null;
}

/**
 * Prefiere un candidato cuyo artista y título normalizados CONTENGAN
 * respectivamente el artista y el título solicitados normalizados (2.10).
 */
export function matchYouTubeMusicCandidate(tracks, artist, title) {
  if (!Array.isArray(tracks)) return null;
  const na = normalizeText(artist);
  const nt = normalizeText(title);

  const contained = tracks.find(
    (t) =>
      t &&
      normalizeText(t.artist).includes(na) &&
      normalizeText(t.title).includes(nt),
  );
  return contained ?? tracks[0] ?? null;
}

function withTimeout(promise, ms) {
  return new Promise((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve_(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
