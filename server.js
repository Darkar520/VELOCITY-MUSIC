import { pathToFileURL } from 'node:url';

import { createApp } from './src/app.js';
import { StreamCache } from './src/services/streamCache.js';
import { resolveActiveMode } from './src/services/resolutionMode.js';
import { probeYtDlp, createYtDlpExtractor, createYtDlpCatalog, YT_DLP_BIN_DIR } from './src/extractors/ytdlp.js';
import { createYTMusicCatalog, createYTMusicArtist, createYTMusicAlbum, createYTMusicLyrics, createYTMusicSearchAll, createYTMusicRadio } from './src/extractors/ytmusic.js';
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
} from './src/repositories/jsondb.js';
import { query } from './src/db/pool.js';
import {
  createPgUserRepo,
  createPgPlaylistRepo,
  createPgFavoritesRepo,
  createPgHistoryRepo,
} from './src/repositories/postgres.js';

const PORT = process.env.PORT || 3000;
const USE_POSTGRES = process.env.USE_POSTGRES === '1';

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

async function bootstrap() {
  const cache = new StreamCache();

  // Repositorios: PostgreSQL si USE_POSTGRES=1; si no, en memoria (uso personal).
  const repos = USE_POSTGRES
    ? {
        userRepo: createPgUserRepo(query),
        playlistRepo: createPgPlaylistRepo(query),
        favoritesRepo: createPgFavoritesRepo(query),
        historyRepo: createPgHistoryRepo(query),
        trackRepo: null,
      }
    : {
        // Persistencia en archivo JSON (sobrevive reinicios; no se borra con el tiempo).
        userRepo: createJsonUserRepo(),
        playlistRepo: createJsonPlaylistRepo(),
        favoritesRepo: createJsonFavoritesRepo(),
        historyRepo: createJsonHistoryRepo(),
        savedAlbumsRepo: createJsonSavedAlbumsRepo(),
        // trackRepo en null: el catálogo es YouTube Music (IDs dinámicos), por lo que
        // no validamos existencia local de pista al guardar favoritos/listas/historial.
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
    resolveTimeoutMs: 35000,
    extractorImpl: createYtDlpExtractor(),
    artistImpl: createYTMusicArtist(),
    albumImpl: createYTMusicAlbum(),
    radioImpl: createYTMusicRadio(),
    lyricsByIdImpl: createYTMusicLyrics(),
    searchAllImpl: createYTMusicSearchAll(),
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
