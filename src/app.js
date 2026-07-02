import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { StreamCache } from './services/streamCache.js';
import { searchTracks, MetadataError } from './services/metadataService.js';
import { resolve as resolveAudio, ResolveError } from './services/audioResolver.js';
import { createStreamProxyHandler } from './services/streamProxy.js';
import { buildStatus } from './services/status.js';
import { isFullResolutionAllowed } from './services/resolutionMode.js';
import { createAuthService, AuthError } from './services/authService.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createPlaylistService, PlaylistError } from './services/playlistService.js';
import { createFavoritesService, FavoritesError } from './services/favoritesService.js';
import { createHistoryService, HistoryError } from './services/historyService.js';
import { extractorStatus } from './services/extractorSetup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Crea la aplicación Express cableando todos los servicios.
 *
 * Todas las dependencias se inyectan para poder probar la app sin red ni
 * PostgreSQL. `getActiveMode()` devuelve el Resolution_Mode activo en cada
 * momento (lo fija el arranque tras la sonda de yt-dlp).
 */
export function createApp(deps = {}) {
  const {
    cache = new StreamCache(),
    catalogImpl,
    catalogTimeoutMs = 20000,
    resolveTimeoutMs = 30000,
    extractorImpl,
    artistImpl = null,
    albumImpl = null,
    radioImpl = null,
    lyricsByIdImpl = null,
    searchAllImpl = null,
    getActiveMode = () => 'degraded',
    setActiveMode = null,
    extractorProbe = null,
    installExtractorImpl = null,
    startTime = Date.now(),
    userRepo,
    playlistRepo,
    favoritesRepo,
    historyRepo,
    savedAlbumsRepo,
    trackMetaRepo,
    songByIdImpl = null,
    statsRepo,
    trackRepo,
    jwtSecret,
    staticDir = path.join(__dirname, '..', 'public'),
  } = deps;

  const app = express();
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGIN || '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
      exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  if (staticDir) app.use(express.static(staticDir));

  const authService = userRepo ? createAuthService({ userRepo, jwtSecret }) : null;
  const requireAuth = authService ? createRequireAuth(authService, userRepo) : null;
  const playlistService = playlistRepo
    ? createPlaylistService({ playlistRepo, trackRepo })
    : null;
  const favoritesService = favoritesRepo
    ? createFavoritesService({ favoritesRepo, trackRepo })
    : null;
  const historyService = historyRepo ? createHistoryService({ historyRepo, trackRepo }) : null;

  // Resolver compartido para /api/resolve y el proxy.
  const doResolve = (params) =>
    resolveAudio(params, {
      cache,
      mode: getActiveMode(),
      extractorImpl,
      catalogImpl,
      timeoutMs: resolveTimeoutMs,
    });

  // Caché de búsqueda en memoria (resultados, no audio). TTL 5 minutos, máx 200 entradas.
  const searchCache = new Map();
  const SEARCH_CACHE_TTL = 5 * 60 * 1000;
  const SEARCH_CACHE_MAX = 200;
  const searchCacheSet = (key, val) => {
    // Evicción LRU: si supera el límite, borrar la entrada más antigua.
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldest = searchCache.keys().next().value;
      searchCache.delete(oldest);
    }
    searchCache.set(key, val);
  };

  // ---- Metadatos ----
  app.get('/api/search', async (req, res) => {
    const qRaw = String(req.query.q ?? '').trim();
    const cacheKey = `${qRaw}|${req.query.limit ?? ''}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ results: cached.results });
    }
    try {
      const results = await searchTracks(qRaw, {
        limit: req.query.limit,
        catalogImpl,
        timeoutMs: catalogTimeoutMs,
      });
      const deduped = dedupeTracks(results);
      searchCacheSet(cacheKey, { results: deduped, at: Date.now() });
      if (statsRepo) statsRepo.incr('searches').catch(() => {});
      res.setHeader('X-Cache', 'MISS');
      return res.json({ results: deduped });
    } catch (err) {
      if (err instanceof MetadataError) return res.status(err.status).json({ error: err.message });
      return res.status(502).json({ error: 'El catálogo de YouTube Music no está disponible.' });
    }
  });

  // ---- Letras (YouTube Music nativo + lrclib + lyrics.ovh, con timeout) ----
  const lyricsCache = new Map();
  const LYRICS_CACHE_MAX = 500;
  const lyricsCacheSet = (key, val) => {
    if (lyricsCache.size >= LYRICS_CACHE_MAX) {
      const oldest = lyricsCache.keys().next().value;
      lyricsCache.delete(oldest);
    }
    lyricsCache.set(key, val);
  };
  let lrclibDownUntil = 0; // circuit breaker: si lrclib falla, se salta un rato
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  app.get('/api/lyrics', async (req, res) => {
    const artist = String(req.query.artist || '').trim();
    const title = String(req.query.title || '').trim();
    const album = String(req.query.album || '').trim();
    const duration = String(req.query.duration || '').trim();
    const id = String(req.query.id || '').trim();
    const syncOnly = String(req.query.sync || '') === '1';
    if (!artist || !title) return res.status(400).json({ error: 'Se requieren artist y title.' });

    const key = `${artist}|${title}`.toLowerCase();
    const cached = lyricsCache.get(key);
    if (cached && Date.now() - cached.at < 7 * 86400000) {
      // En modo sync solo sirve la caché si ya es sincronizada.
      if (!syncOnly || cached.data.synced) return res.json(cached.data);
    }

    const clean = (s) => s.replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|remaster|feat\.?|ft\.?)[^\)\]]*[\)\]]/gi, '').trim();
    const head = { 'User-Agent': 'VelocityMusic/1.0 (personal use)' };
    const finish = (data) => { lyricsCacheSet(key, { data, at: Date.now() }); return res.json(data); };

    const lrcGet = (ms) => (async () => {
      try {
        const u = new URL('https://lrclib.net/api/get');
        u.searchParams.set('artist_name', artist);
        u.searchParams.set('track_name', title);
        if (album) u.searchParams.set('album_name', album);
        if (duration) u.searchParams.set('duration', duration);
        const r = await withTimeout(fetch(u, { headers: head }), ms);
        if (r.ok) { const d = await r.json(); if (d && (d.syncedLyrics || d.plainLyrics)) return { synced: d.syncedLyrics || null, plain: d.plainLyrics || null }; }
      } catch {}
      return null;
    })();
    const lrcSearch = (ms) => (async () => {
      try {
        const u = new URL('https://lrclib.net/api/search');
        u.searchParams.set('q', `${clean(title)} ${artist}`);
        const r = await withTimeout(fetch(u, { headers: head }), ms);
        if (r.ok) { const arr = await r.json(); if (Array.isArray(arr) && arr.length) { const b = arr.find(x => x.syncedLyrics) || arr.find(x => x.plainLyrics) || arr[0]; if (b && (b.syncedLyrics || b.plainLyrics)) return { synced: b.syncedLyrics || null, plain: b.plainLyrics || null }; } }
      } catch {}
      return null;
    })();

    // ── Modo "solo sincronizada": solo lrclib con timeout largo (lrclib puede tardar) ──
    if (syncOnly) {
      const [g, se] = await Promise.all([lrcGet(15000), lrcSearch(15000)]);
      const synced = (g && g.synced) || (se && se.synced);
      if (synced) return finish({ source: 'lrclib', synced, plain: (g && g.plain) || (se && se.plain) || null });
      const plain = (g && g.plain) || (se && se.plain);
      if (plain) return finish({ source: 'lrclib', synced: null, plain });
      return res.status(404).json({ error: 'Sin letra sincronizada.' });
    }

    // ── Modo rápido: muestra algo al instante (nativo YT + lrclib corto + ovh) ──
    const ytP = (id && typeof lyricsByIdImpl === 'function')
      ? withTimeout(lyricsByIdImpl(id), 4000).then(p => (p && p.trim()) ? p.trim() : null).catch(() => null)
      : Promise.resolve(null);
    const [g, se] = await Promise.all([lrcGet(4000), lrcSearch(4000)]);
    const synced = (g && g.synced) || (se && se.synced);
    if (synced) return finish({ source: 'lrclib', synced, plain: (g && g.plain) || (se && se.plain) || null });
    const yt = await ytP;
    if (yt) return finish({ source: 'youtube-music', synced: null, plain: yt });
    const plain = (g && g.plain) || (se && se.plain);
    if (plain) return finish({ source: 'lrclib', synced: null, plain });
    try {
      const r = await withTimeout(fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(clean(title))}`, { headers: head }), 3500);
      if (r.ok) { const d = await r.json(); if (d && d.lyrics && d.lyrics.trim()) return finish({ source: 'lyrics.ovh', synced: null, plain: d.lyrics.trim() }); }
    } catch {}
    return res.status(404).json({ error: 'Letra no encontrada.' });
  });

  // ---- Búsqueda combinada (canciones + álbumes + artistas) ----
  app.get('/api/search/all', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Falta el parámetro q.' });
    if (typeof searchAllImpl !== 'function') return res.status(501).json({ error: 'No disponible.' });
    try {
      const data = await withTimeout(searchAllImpl(q, 20), 12000);
      return res.json(data);
    } catch {
      return res.status(502).json({ error: 'No se pudo buscar.' });
    }
  });

  // ---- Artista (perfil: top canciones + álbumes reales) ----
  // Caché en memoria para artistas, álbumes y radio: TTL 45 min, máx 150 entradas.
  const detailCache = new Map();
  const DETAIL_CACHE_TTL = 45 * 60 * 1000;
  const DETAIL_CACHE_MAX = 150;
  const detailCacheSet = (key, val) => {
    if (detailCache.size >= DETAIL_CACHE_MAX) {
      const oldest = detailCache.keys().next().value;
      detailCache.delete(oldest);
    }
    detailCache.set(key, { data: val, at: Date.now() });
  };
  const detailCacheGet = (key) => {
    const e = detailCache.get(key);
    if (e && Date.now() - e.at < DETAIL_CACHE_TTL) return e.data;
    if (e) detailCache.delete(key);
    return null;
  };

  app.get('/api/artist', async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Se requiere id de artista.' });
    if (typeof artistImpl !== 'function') return res.status(501).json({ error: 'No disponible.' });
    const cacheKey = `artist:${id}`;
    const cached = detailCacheGet(cacheKey);
    if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(cached); }
    try {
      const data = await withTimeout(artistImpl(id), 12000);
      detailCacheSet(cacheKey, data);
      res.setHeader('X-Cache', 'MISS');
      return res.json(data);
    } catch {
      return res.status(502).json({ error: 'No se pudo obtener el artista.' });
    }
  });

  // ---- Álbum (metadatos + pistas reales) ----
  app.get('/api/album', async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Se requiere id de álbum.' });
    if (typeof albumImpl !== 'function') return res.status(501).json({ error: 'No disponible.' });
    const cacheKey = `album:${id}`;
    const cached = detailCacheGet(cacheKey);
    if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(cached); }
    try {
      const data = await withTimeout(albumImpl(id), 12000);
      detailCacheSet(cacheKey, data);
      res.setHeader('X-Cache', 'MISS');
      return res.json(data);
    } catch {
      return res.status(502).json({ error: 'No se pudo obtener el álbum.' });
    }
  });

  // ---- Radio / relacionadas (reproducción tipo Spotify) ----
  app.get('/api/radio', async (req, res) => {
    const id = String(req.query.id || '').trim();
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 25));
    if (!id) return res.status(400).json({ error: 'Se requiere id de pista.' });
    if (typeof radioImpl !== 'function') return res.status(501).json({ error: 'No disponible.' });
    const cacheKey = `radio:${id}:${limit}`;
    const cached = detailCacheGet(cacheKey);
    if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(cached); }
    try {
      const tracks = await withTimeout(radioImpl(id, limit), 12000);
      const result = { tracks: Array.isArray(tracks) ? tracks : [] };
      detailCacheSet(cacheKey, result);
      res.setHeader('X-Cache', 'MISS');
      return res.json(result);
    } catch {
      return res.status(502).json({ error: 'No se pudo obtener la radio.' });
    }
  });

  // ---- Resolución de audio ----
  app.get('/api/resolve', async (req, res) => {
    const mode = getActiveMode();
    const stream = String(req.query.stream || '').trim() || undefined;
    const videoId = String(req.query.id || '').trim() || undefined;
    const quality = String(req.query.quality || '').trim() || undefined;
    // En modo degraded sin URL explícita: rechazar resolución de pista completa (14.5).
    if (!isFullResolutionAllowed(mode) && !stream) {
      return res.status(503).json({
        error: 'La resolución de pistas completas no está disponible actualmente.',
      });
    }
    try {
      const result = await doResolve({
        artist: req.query.artist,
        title: req.query.title,
        stream,
        videoId,
        quality,
      });
      if (result.status === 302) return res.redirect(302, result.url);
      // Degradado en tiempo de petición.
      return res.status(503).json({ error: result.message });
    } catch (err) {
      if (err instanceof ResolveError) return res.status(err.status).json({ error: err.message });
      return res.status(502).json({ error: 'No se pudo resolver el audio.' });
    }
  });

  // ---- Proxy de streaming ----
  app.get(
    '/api/stream-proxy',
    createStreamProxyHandler({ resolveUrl: (params) => doResolve(params), timeoutMs: 20000 }),
  );

  // ---- Estado ----
  app.get('/api/status', (req, res) => {
    res.json(
      buildStatus({
        resolutionMode: getActiveMode(),
        cacheSize: cache.size(),
        uptime: (Date.now() - startTime) / 1000,
      }),
    );
  });

  // ---- Calidades de audio disponibles ----
  app.get('/api/qualities', (req, res) => {
    res.json({
      qualities: [
        { id: 'high',   label: 'Alta (Opus ~160kbps)',  selector: 'bestaudio[acodec=opus]/bestaudio' },
        { id: 'medium', label: 'Media (AAC ~128kbps)', selector: 'bestaudio[ext=m4a]/bestaudio' },
        { id: 'low',    label: 'Baja (~64kbps)',        selector: 'worstaudio' },
      ],
      default: 'high',
    });
  });

  // ---- Asistente de configuración del extractor (yt-dlp) ----
  app.get('/api/setup/extractor', async (req, res) => {
    try {
      const status = await extractorStatus(extractorProbe);
      return res.json(status);
    } catch {
      return res.status(500).json({ error: 'No se pudo determinar el estado del extractor.' });
    }
  });

  app.post('/api/setup/extractor/install', async (req, res) => {
    if (typeof installExtractorImpl !== 'function') {
      return res.status(501).json({ error: 'La instalación automática no está disponible.' });
    }
    try {
      const result = await installExtractorImpl();
      if (result.installed && typeof setActiveMode === 'function') {
        await setActiveMode();
      }
      return res.json({ ...result, resolutionMode: getActiveMode() });
    } catch (err) {
      return res
        .status(500)
        .json({ error: 'Fallo durante la instalación.', detail: String(err.message || err) });
    }
  });

  // ---- Autenticación ----
  if (authService) {
    app.post('/api/auth/register', async (req, res) => {
      try {
        const user = await authService.register(req.body || {});
        return res.status(201).json(user);
      } catch (err) {
        if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Error de registro.' });
      }
    });
    app.post('/api/auth/login', async (req, res) => {
      try {
        const result = await authService.login(req.body || {});
        if (statsRepo) statsRepo.incr('logins').catch(() => {});
        return res.json(result);
      } catch (err) {
        if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Error de inicio de sesión.' });
      }
    });
  }

  // ---- Biblioteca (protegida) ----
  if (requireAuth && playlistService) {
    app.get('/api/playlists', requireAuth, wrap(async (req, res) => {
      res.json({ playlists: await playlistService.list(req.userId) });
    }, PlaylistError));
    app.post('/api/playlists', requireAuth, wrap(async (req, res) => {
      const id = await playlistService.create(req.userId, (req.body || {}).name);
      res.status(201).json({ id });
    }, PlaylistError));
    app.get('/api/playlists/:id', requireAuth, wrap(async (req, res) => {
      res.json({ tracks: await playlistService.getTracks(req.userId, req.params.id) });
    }, PlaylistError));
    app.post('/api/playlists/:id/tracks', requireAuth, wrap(async (req, res) => {
      await playlistService.addTrack(req.userId, req.params.id, (req.body || {}).trackId);
      res.status(201).json({ ok: true });
    }, PlaylistError));
    app.delete('/api/playlists/:id/tracks/:trackId', requireAuth, wrap(async (req, res) => {
      await playlistService.removeTrack(req.userId, req.params.id, req.params.trackId);
      res.json({ ok: true });
    }, PlaylistError));
    app.delete('/api/playlists/:id', requireAuth, wrap(async (req, res) => {
      await playlistService.delete(req.userId, req.params.id);
      res.json({ ok: true });
    }, PlaylistError));
  }

  if (requireAuth && favoritesService) {
    app.get('/api/favorites', requireAuth, wrap(async (req, res) => {
      res.json({ favorites: await favoritesService.list(req.userId) });
    }, FavoritesError));
    app.post('/api/favorites', requireAuth, wrap(async (req, res) => {
      res.json(await favoritesService.add(req.userId, (req.body || {}).trackId));
    }, FavoritesError));
    app.delete('/api/favorites/:trackId', requireAuth, wrap(async (req, res) => {
      res.json(await favoritesService.remove(req.userId, req.params.trackId));
    }, FavoritesError));
  }

  if (requireAuth && historyService) {
    app.get('/api/history', requireAuth, wrap(async (req, res) => {
      res.json({ history: await historyService.list(req.userId) });
    }, HistoryError));
    app.post('/api/history', requireAuth, wrap(async (req, res) => {
      if (statsRepo) statsRepo.incr('plays').catch(() => {});
      if (userRepo && typeof userRepo.recordPlay === 'function') userRepo.recordPlay(req.userId).catch(() => {});
      res.status(201).json(await historyService.record(req.userId, (req.body || {}).trackId));
    }, HistoryError));
  }

  // ---- Álbumes guardados en biblioteca (protegido) ----
  if (requireAuth && savedAlbumsRepo) {
    app.get('/api/albums/saved', requireAuth, wrap(async (req, res) => {
      res.json({ albums: await savedAlbumsRepo.list(req.userId) });
    }));
    app.post('/api/albums/saved', requireAuth, wrap(async (req, res) => {
      await savedAlbumsRepo.add(req.userId, (req.body || {}).album);
      res.status(201).json({ ok: true });
    }));
    app.delete('/api/albums/saved/:albumId', requireAuth, wrap(async (req, res) => {
      await savedAlbumsRepo.remove(req.userId, req.params.albumId);
      res.json({ ok: true });
    }));
  }

  // ---- Metadatos de pistas (sincronización entre dispositivos) ----
  // El frontend sube los metadatos de las pistas que el usuario reproduce,
  // guarda o añade a playlists, y los descarga (hidrata) en cualquier otro
  // dispositivo para renderizar su biblioteca sin depender de la caché local.
  if (requireAuth && trackMetaRepo) {
    app.post('/api/tracks', requireAuth, wrap(async (req, res) => {
      await trackMetaRepo.upsertMany((req.body || {}).tracks || []);
      res.status(201).json({ ok: true });
    }));
    app.get('/api/tracks', requireAuth, wrap(async (req, res) => {
      const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300);
      if (!ids.length) return res.json({ tracks: [] });
      const found = await trackMetaRepo.getMany(ids);
      const foundIds = new Set(found.map((t) => t.id));
      // Recuperación: los IDs que no tenemos guardados, intentar resolverlos por
      // el catálogo (best-effort) y guardarlos para la próxima vez.
      const missing = ids.filter((id) => !foundIds.has(id));
      if (missing.length && typeof songByIdImpl === 'function') {
        const resolved = await Promise.all(
          missing.slice(0, 40).map((id) => withTimeout(songByIdImpl(id), 8000).catch(() => null)),
        );
        const ok = resolved.filter((t) => t && t.id && t.title);
        if (ok.length) { await trackMetaRepo.upsertMany(ok); found.push(...ok); }
      }
      res.json({ tracks: found });
    }));
  }

  // ---- Panel de trazabilidad / métricas (protegido por clave) ----
  // Uso: GET /api/admin/stats?key=TU_ADMIN_KEY
  // La clave se define con la variable de entorno ADMIN_KEY (por defecto 'velocity-admin').
  if (statsRepo) {
    const ADMIN_KEY = process.env.ADMIN_KEY || 'velocity-admin';
    app.get('/api/admin/stats', wrap(async (req, res) => {
      if (String(req.query.key || '') !== ADMIN_KEY) {
        return res.status(401).json({ error: 'Clave de administrador inválida.' });
      }
      const data = await statsRepo.summary();
      // Si el navegador lo pide, devolver un panel HTML legible; si no, JSON.
      const wantsHtml = String(req.query.html || '') === '1' || (req.headers.accept || '').includes('text/html');
      if (!wantsHtml) return res.json(data);
      const fmtDate = (t) => t ? new Date(t).toLocaleString('es') : '—';
      const rows = data.users.map((u) => `<tr><td>${u.email}</td><td>${u.loginCount}</td><td>${u.playCount}</td><td>${fmtDate(u.lastActive || u.lastLogin)}</td><td>${new Date(u.createdAt).toLocaleDateString('es')}</td></tr>`).join('');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Velocity · Métricas</title>
        <style>body{font-family:system-ui,sans-serif;background:#04060a;color:#f4f7fb;margin:0;padding:24px}h1{font-size:20px;margin:0 0 4px}p{color:#8b97a8;margin:0 0 20px;font-size:13px}
        .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}.card{background:#10151e;border:1px solid #ffffff14;border-radius:14px;padding:16px 20px;min-width:120px}
        .card .n{font-size:28px;font-weight:800;color:#10d9a0}.card .l{font-size:11px;color:#8b97a8;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
        table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #ffffff10}th{color:#8b97a8;font-size:11px;text-transform:uppercase;letter-spacing:1px}</style></head>
        <body><h1>VELOCITY MUSIC · Trazabilidad</h1><p>Actualizado: ${new Date().toLocaleString('es')}</p>
        <div class="cards">
          <div class="card"><div class="n">${data.totals.registeredUsers}</div><div class="l">Usuarios</div></div>
          <div class="card"><div class="n">${data.totals.logins}</div><div class="l">Inicios de sesión</div></div>
          <div class="card"><div class="n">${data.totals.plays}</div><div class="l">Reproducciones</div></div>
          <div class="card"><div class="n">${data.totals.searches}</div><div class="l">Búsquedas</div></div>
        </div>
        <table><thead><tr><th>Email</th><th>Logins</th><th>Reproducciones</th><th>Última actividad</th><th>Registrado</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Sin usuarios aún.</td></tr>'}</tbody></table>
        </body></html>`);
    }));
  }

  return app;
}

/** Envuelve un handler async mapeando errores tipados a su código HTTP. */
function wrap(handler, ErrorType) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (ErrorType && err instanceof ErrorType) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Error interno.' });
    }
  };
}

/** Quita pistas duplicadas (misma canción subida varias veces) por artista+título. */
function dedupeTracks(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks || []) {
    const norm = `${(t.artist || '').toLowerCase().trim()}|${(t.title || '').toLowerCase().replace(/\s*[\(\[].*$/, '').trim()}`;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(t);
  }
  return out;
}
