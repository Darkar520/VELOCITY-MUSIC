import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnv } from './src/lib/loadEnv.js';
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
  createMemoryRevokedTokensRepo,
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
  createJsonRevokedTokensRepo,
} from './src/repositories/jsondb.js';
import { query, checkConnection } from './src/db/pool.js';
import {
  createPgUserRepo,
  createPgPlaylistRepo,
  createPgFavoritesRepo,
  createPgHistoryRepo,
  createPgSavedAlbumsRepo,
  createPgSavedPlaylistsRepo,
  createPgTrackMetaRepo,
  createPgStatsRepo,
  createPgRevokedTokensRepo,
} from './src/repositories/postgres.js';
import * as errorRepoModule   from './src/repositories/errorRepo.js';
import * as sessionRepoModule from './src/repositories/sessionRepo.js';
import * as syncServiceModule from './src/services/syncService.js';
import * as healthServiceModule from './src/services/healthService.js';
import * as retentionServiceModule from './src/services/retentionService.js';
import * as nowPlayingModule from './src/services/nowPlayingService.js';
import { createTokenRevocationService } from './src/services/tokenRevocationService.js';
import { initSchema } from './src/db/init.js';
import { getPool } from './src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Cargar .env antes de leer PORT/USE_POSTGRES (no pisa vars del SO/guardian).
loadEnv(__dirname);

const PORT = process.env.PORT || 3000;
const USE_POSTGRES = process.env.USE_POSTGRES === '1';
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

  // Repositorios: PostgreSQL si USE_POSTGRES=1; si no, JSON persistente.
  // Con Postgres: verificar conexión + aplicar esquema antes de crear repos.
  if (USE_POSTGRES) {
    const ok = await checkConnection();
    if (!ok) {
      console.error('❌ No se pudo conectar a PostgreSQL. Verifica DATABASE_URL / credenciales.');
      process.exitCode = 1;
      process.exit(1);
    }
    await initSchema();
  }
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
        revokedTokensRepo: createPgRevokedTokensRepo(query),
        // ── Trazabilidad extendida ──
        errorRepo:   { recordError: (p) => errorRepoModule.recordError(query, p),   checkAndFlagUser: (uid) => errorRepoModule.checkAndFlagUser(query, uid),   listActiveAlerts: () => errorRepoModule.listActiveAlerts(query), resolveAlert: (id) => errorRepoModule.resolveAlert(query, id) },
        sessionRepo: { startSession: (p) => sessionRepoModule.startSession(query, p), endSession: (uid) => sessionRepoModule.endSession(query, uid), listActive: (lim) => sessionRepoModule.listActive(query, lim) },
        syncSvc:     { getLibrary: (uid) => syncServiceModule.getLibrary(query, uid),  pushLibrary: (uid, p) => syncServiceModule.pushLibrary(query, uid, p) },
        healthSvc:   (startTime) => healthServiceModule.check(getPool(), startTime),
    nowPlayingSvc: {
      update: (uid, p) => nowPlayingModule.updateNowPlaying(uid, p),
      get: (uid) => nowPlayingModule.getNowPlaying(uid),
      subscribe: (uid, res) => nowPlayingModule.subscribeNowPlaying(uid, res),
    },
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
        revokedTokensRepo: createJsonRevokedTokensRepo(),
        errorRepo: null, sessionRepo: null, syncSvc: null,
        healthSvc:   (startTime) => healthServiceModule.check(null, startTime),
    nowPlayingSvc: {
      update: (uid, p) => nowPlayingModule.updateNowPlaying(uid, p),
      get: (uid) => nowPlayingModule.getNowPlaying(uid),
      subscribe: (uid, res) => nowPlayingModule.subscribeNowPlaying(uid, res),
    },
      };

  // ── Servicio de revocación de tokens (logout real) ──
  // Necesita userRepo (para tokens_invalid_before) y revokedTokensRepo (para jti).
  // Si alguno falta, el servicio es null y requireAuth no verifica revocación.
  const revocationService = createTokenRevocationService({
    revokedTokensRepo: repos.revokedTokensRepo,
    userRepo: repos.userRepo,
  });

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

  // Iniciar el job de retención de datos solo en el worker 0 (o en proceso único).
  // Evita ejecuciones duplicadas en modo cluster.
  if (USE_POSTGRES && (process.env.WORKER_ID === '0' || !process.env.WORKER_ID)) {
    retentionServiceModule.start(query);
  }

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
      // YT Music principal; SoundCloud solo como cola y solo si título/artista
      // se parecen a la query (evita basura que no reproduce y "Charyl - System of a Down").
      return async (q, limit) => {
        const [ytData, scTracks] = await Promise.allSettled([
          ytSearchAll(q, limit),
          scCatalog(q, Math.min(limit ?? 8, 8)),
        ]);
        const yt = ytData.status === 'fulfilled' ? ytData.value : { songs: [], albums: [], artists: [] };
        const scRaw = scTracks.status === 'fulfilled' ? scTracks.value : [];
        const nq = String(q || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const sc = (scRaw || []).filter((t) => {
          if (!t || !t.id || !t.title) return false;
          if (!t.streamUrl && !t.stream) return false; // sin stream no se puede reproducir
          const blob = `${t.title || ''} ${t.artist || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          // Al menos un token significativo de la query debe aparecer.
          const tokens = nq.split(/\s+/).filter((w) => w.length > 2);
          if (!tokens.length) return false;
          const hits = tokens.filter((w) => blob.includes(w)).length;
          return hits >= Math.min(2, tokens.length) || blob.includes(nq);
        }).slice(0, 5);
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
    revocationService,
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
