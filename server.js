import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

import { createApp } from './src/app.js';
import { StreamCache } from './src/services/streamCache.js';
import { createLimiter, createInflight } from './src/lib/concurrency.js';
import { normalizeText } from './src/lib/normalize.js';
import { resolveActiveMode } from './src/services/resolutionMode.js';
import { probeYtDlp, createYtDlpExtractor, createYtDlpCatalog, createSoundCloudCatalog, createSoundCloudExtractor, YT_DLP_BIN_DIR } from './src/extractors/ytdlp.js';
import { createYTMusicCatalog, createYTMusicArtist, createYTMusicAlbum, createYTMusicLyrics, createYTMusicSearchAll, createYTMusicRadio, createYTMusicSong } from './src/extractors/ytmusic.js';
import { installYtDlpByDownload } from './src/services/extractorSetup.js';
import {
  createMemoryUserRepo,
  createMemoryPlaylistRepo,
  createMemoryFavoritesRepo,
  createMemoryHistoryRepo,
  createMemoryTrackRepo,
} from './src/repositories/memory.js';
import {
  createJsonUserRepo,
  createJsonPlaylistRepo,
  createJsonFavoritesRepo,
  createJsonHistoryRepo,
  createJsonSavedAlbumsRepo,
  createJsonSavedPlaylistsRepo,
  createJsonTrackMetaRepo,
  createJsonStatsRepo,
} from './src/repositories/jsondb.js';
import { query } from './src/db/pool.js';
import {
  createPgUserRepo,
  createPgPlaylistRepo,
  createPgFavoritesRepo,
  createPgHistoryRepo,
  createPgSavedAlbumsRepo,
  createPgSavedPlaylistsRepo,
  createPgTrackMetaRepo,
  createPgStatsRepo,
} from './src/repositories/postgres.js';
import { initSchema } from './src/db/init.js';

const PORT = process.env.PORT || 3000;
const USE_POSTGRES = process.env.USE_POSTGRES === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Máximo de procesos yt-dlp simultáneos POR PROCESO. En cluster, el lanzador
// reparte el total entre workers vía WORKER_RESOLVE_CONCURRENCY.
const RESOLVE_CONCURRENCY = Number(process.env.WORKER_RESOLVE_CONCURRENCY || process.env.RESOLVE_CONCURRENCY) || 4;

// Re-exportar para compatibilidad y pruebas.
export { StreamCache } from './src/services/streamCache.js';
export { isUsableUrl } from './src/lib/normalize.js';
export { createApp } from './src/app.js';

// Evita que errores no capturados (p.ej. sockets TLS de descarga) derriben el proceso.
process.on('uncaughtException', (err) => {
  console.error('⚠️  Error no capturado (proceso continúa):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Promesa rechazada sin manejar (proceso continúa):', reason?.message || reason);
});

export async function bootstrap() {
  // Caché de URLs de audio persistente en disco: sobrevive reinicios y comparte
  // resultados entre peticiones. TTL por entrada (≈4 h) igual que antes.
  const cache = new StreamCache({ persistPath: path.join(__dirname, 'data', 'stream-cache.json') });
  // Volcar la caché a disco al salir para no perder resoluciones recientes.
  for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
    try { process.on(sig, () => { cache.flush(); if (sig !== 'exit') process.exit(0); }); } catch {}
  }

  // Repositorios: PostgreSQL si USE_POSTGRES=1; si no, en memoria (uso personal).
  // Con Postgres: aplicar el esquema (idempotente) antes de crear los repos.
  if (USE_POSTGRES) { await initSchema(); }
  const repos = USE_POSTGRES
    ? {
        userRepo: createPgUserRepo(query),
        playlistRepo: createPgPlaylistRepo(query),
        favoritesRepo: createPgFavoritesRepo(query),
        historyRepo: createPgHistoryRepo(query),
        savedAlbumsRepo: createPgSavedAlbumsRepo(query),
        savedPlaylistsRepo: createPgSavedPlaylistsRepo(query),
        trackMetaRepo: createPgTrackMetaRepo(query),
        statsRepo: createPgStatsRepo(query),
        trackRepo: null,
      }
    : {
        // Persistencia en archivo JSON (sobrevive reinicios; no se borra con el tiempo).
        userRepo: createJsonUserRepo(),
        playlistRepo: createJsonPlaylistRepo(),
        favoritesRepo: createJsonFavoritesRepo(),
        historyRepo: createJsonHistoryRepo(),
        savedAlbumsRepo: createJsonSavedAlbumsRepo(),
        savedPlaylistsRepo: createJsonSavedPlaylistsRepo(),
        trackMetaRepo: createJsonTrackMetaRepo(),
        statsRepo: createJsonStatsRepo(),
        trackRepo: null,
      };

  // Detección de yt-dlp y modo activo (14.1–14.3).
  let activeMode = 'degraded';
  const refreshMode = async () => {
    const { mode } = await resolveActiveMode({ requested: 'full' }, probeYtDlp);
    activeMode = mode;
    return activeMode;
  };
  const { notice } = await resolveActiveMode({ requested: 'full' }, probeYtDlp);
  await refreshMode();

  // ── Resolución de audio escalable ──
  // 1) Límite de concurrencia: como máximo RESOLVE_CONCURRENCY procesos yt-dlp
  //    a la vez; el resto espera en cola (no colapsa el servidor).
  // 2) Deduplicación en vuelo: si varias personas piden la MISMA pista a la vez,
  //    se lanza un solo yt-dlp y todas comparten el resultado.
  const resolveLimit = createLimiter(RESOLVE_CONCURRENCY);
  const resolveInflight = createInflight();
  const baseExtractor = createYtDlpExtractor({
    // SoundCloud como último recurso cuando ambos clientes YT fallan:
    // busca la misma pista en SC como fallback de reproducción.
    scFallback: createSoundCloudExtractor(),
  });
  const extractorImpl = (args = {}) => {
    const q = args.quality ? `#${args.quality}` : '';
    const key = args.videoId
      ? `yt:${args.videoId}${q}`
      : `${normalizeText(args.artist)}:${normalizeText(args.title)}${q}`;
    return resolveInflight(key, () => resolveLimit(() => baseExtractor(args)));
  };

  const ytmCatalog = createYTMusicCatalog();
  const ytdlpCatalog = createYtDlpCatalog();
  const catalogWithFallback = async (q, limit) => {
    try { const r = await ytmCatalog(q, limit); if (Array.isArray(r) && r.length) return r; } catch {}
    try { return await ytdlpCatalog(q, limit); } catch { return []; }
  };

  const app = createApp({
    cache,
    // Catálogo: YouTube Music API (rápido, portadas de álbum, solo canciones).
    // Fallback a yt-dlp si ytmusic-api falla.
    catalogImpl: catalogWithFallback,
    catalogTimeoutMs: 12000,
    resolveTimeoutMs: 95000, // 5 clientes YT(15s c/u) + backoff(7s) + SC(15s) + margen
    extractorImpl,
    artistImpl: createYTMusicArtist(),
    albumImpl: createYTMusicAlbum(),
    radioImpl: createYTMusicRadio(),
    lyricsByIdImpl: createYTMusicLyrics(),
    searchAllImpl: (() => {
      const ytSearchAll = createYTMusicSearchAll();
      const scCatalog = createSoundCloudCatalog();
      // Búsqueda combinada: YouTube Music (principal) + SoundCloud (indie/underground).
      // Los resultados de SC se añaden a las canciones con una etiqueta de fuente,
      // para que el frontend pueda distinguirlos (source='soundcloud') si hace falta.
      return async (q, limit) => {
        const [ytData, scTracks] = await Promise.allSettled([
          ytSearchAll(q, limit),
          scCatalog(q, Math.min(limit ?? 10, 10)),
        ]);
        const yt = ytData.status === 'fulfilled' ? ytData.value : { songs: [], albums: [], artists: [] };
        const sc = scTracks.status === 'fulfilled' ? scTracks.value : [];
        // Mezclar canciones de SC al final de las de YT (no reemplazar, ampliar).
        return {
          songs: [...(yt.songs || []), ...sc],
          albums: yt.albums || [],
          artists: yt.artists || [],
        };
      };
    })(),
    songByIdImpl: createYTMusicSong(),
    getActiveMode: () => activeMode,
    setActiveMode: refreshMode,
    extractorProbe: probeYtDlp,
    installExtractorImpl: () => installYtDlpByDownload({ binDir: YT_DLP_BIN_DIR, probe: probeYtDlp }),
    startTime: Date.now(),
    ...repos,
  });

  app.listen(PORT, () => {
    console.log('=======================================================');
    console.log(`🎵 Velocity Music (MuStreamer) backend en: http://localhost:${PORT}`);
    console.log(`🔊 Modo de resolución activo: ${activeMode}`);
    if (notice) console.log(`⚠️  ${notice}`);
    console.log(`🗄️  Almacén: ${USE_POSTGRES ? 'PostgreSQL' : 'archivo JSON (persistente)'}`);
    console.log('=======================================================');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootstrap().catch((err) => {
    console.error('Error al arrancar:', err);
    process.exitCode = 1;
  });
}
