import cors from 'cors';
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRateLimiter } from './middleware/rateLimit.js';

import { StreamCache } from './services/streamCache.js';
import { searchTracks, MetadataError } from './services/metadataService.js';
import { resolve as resolveAudio, ResolveError } from './services/audioResolver.js';
import { createStreamProxyHandler } from './services/streamProxy.js';
import { buildStatus } from './services/status.js';
import { isFullResolutionAllowed } from './services/resolutionMode.js';
import { createAuthService, AuthError } from './services/authService.js';
import { sendWelcomeEmail } from './services/mailer.js';
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
    savedPlaylistsRepo,
    trackMetaRepo,
    songByIdImpl = null,
    statsRepo,
    trackRepo,
    jwtSecret,
    // ── Nuevos repos y servicios de trazabilidad ──
    errorRepo   = null,
    sessionRepo = null,
    syncSvc     = null,
    healthSvc   = null,
    staticDir = path.join(__dirname, '..', 'public'),
  } = deps;

  const app = express();
  // Detrás de ngrok/proxy: usar X-Forwarded-For para obtener la IP real del cliente.
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  // ── Cabeceras de seguridad (sin CSP para no romper fuentes/imágenes/OAuth) ──
  // Se aplican a todas las respuestas; son inocuas para audio, Range y portadas.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'browsing-topics=()');
    next();
  });
  // Compresión gzip para respuestas de texto (JSON/HTML/JS/CSS). NO comprime el
  // audio (audio/* no es comprimible) ni el proxy de streaming (rompería Range).
  app.use(compression({
    filter: (req, res) => {
      if (req.path === '/api/stream-proxy' || req.path === '/img') return false;
      return compression.filter(req, res);
    },
  }));
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGIN || '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
      exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  // ── Rate limiting por IP (protege endpoints costosos/sensibles) ──
  // No se aplica a /api/stream-proxy ni /img para no afectar la reproducción.
  const authLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: 40, message: 'Demasiados intentos. Espera unos minutos.' });
  const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 150 });
  app.use('/api/auth', authLimiter);
  for (const p of ['/api/search', '/api/search/all', '/api/resolve', '/api/radio', '/api/artist', '/api/album', '/api/lyrics']) {
    app.use(p, apiLimiter);
  }
  if (staticDir) app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
      const p = filePath.replace(/\\/g, '/');
      // Assets con hash en el nombre → inmutables, caché de 1 año.
      if (/\/assets\/.+\.(js|css|woff2?|png|jpe?g|svg|gif|webp)$/i.test(p)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // App shell y service worker → siempre revalidar para recibir versiones nuevas.
      } else if (/\/(index\.html|sw\.js|manifest\.webmanifest)$/i.test(p)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));

  // ── Proxy de carátulas ──
  // Sirve imágenes de portada remotas desde el MISMO origen. Esto evita el
  // problema de CORS/caché que impedía mostrar la carátula en el reproductor
  // grande (la extracción de color hace una 2ª petición con crossOrigin que
  // envenenaba la caché), y permite que el service worker las cachee offline.
  // Allowlist estricta de hosts de imágenes (previene SSRF / proxy abierto).
  const COVER_HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com|ytimg\.com|mzstatic\.com)$/i;
  app.get('/img', async (req, res) => {
    let url;
    try { url = new URL(String(req.query.u || '')); } catch { return res.status(400).end(); }
    if (url.protocol !== 'https:' || !COVER_HOSTS.test(url.hostname)) return res.status(400).end();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'VelocityMusic/1.0' } });
      if (!r.ok) return res.status(502).end();
      const type = r.headers.get('content-type') || 'image/jpeg';
      if (!type.startsWith('image/')) return res.status(415).end();
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 días
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch { return res.status(502).end(); }
  });

  const authService = userRepo ? createAuthService({ userRepo, jwtSecret }) : null;
  const requireAuth = authService ? createRequireAuth(authService, userRepo) : null;
  // Auth opcional: devuelve el userId si hay un token válido, si no null (sin bloquear).
  const optionalUserId = (req) => {
    if (!authService) return null;
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) return null;
    const r = authService.verifyToken(t);
    return r ? r.userId : null;
  };
  const playlistService = playlistRepo
    ? createPlaylistService({ playlistRepo, trackRepo })
    : null;
  const favoritesService = favoritesRepo
    ? createFavoritesService({ favoritesRepo, trackRepo })
    : null;
  const historyService = historyRepo ? createHistoryService({ historyRepo, trackRepo }) : null;

  // Resolver compartido para /api/resolve y el proxy. `opts.forceRefresh` re-resuelve
  // ignorando la caché (para recuperarse de URLs de audio expiradas/403).
  const doResolve = (params, opts = {}) =>
    resolveAudio(params, {
      cache,
      mode: getActiveMode(),
      extractorImpl,
      catalogImpl,
      timeoutMs: resolveTimeoutMs,
      forceRefresh: !!opts.forceRefresh,
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
      if (statsRepo) {
        statsRepo.incr('searches').catch(() => {});
        // Trazabilidad por usuario (si viene autenticado): qué buscó y cuándo.
        if (qRaw && typeof statsRepo.recordSearch === 'function') {
          const uid = optionalUserId(req);
          if (uid) statsRepo.recordSearch(uid, qRaw).catch(() => {});
        }
      }
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
      if (statsRepo) {
        statsRepo.incr('searches').catch(() => {});
        if (typeof statsRepo.recordSearch === 'function') {
          const uid = optionalUserId(req);
          if (uid) statsRepo.recordSearch(uid, q).catch(() => {});
        }
      }
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
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 50));
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
    createStreamProxyHandler({ resolveUrl: (params, opts) => doResolve(params, opts), timeoutMs: 85000 }),
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

  // ---- Configuración pública de auth (la consume el frontend) ----
  app.get('/api/auth/config', (req, res) => {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
  });

  // ---- Autenticación ----
  if (authService) {
    app.post('/api/auth/register', async (req, res) => {
      try {
        const user = await authService.register(req.body || {});
        // Correo de bienvenida (best-effort, no bloquea la respuesta).
        sendWelcomeEmail(user.email, user.displayName).catch(() => {});
        return res.status(201).json(user);
      } catch (err) {
        if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Error de registro.' });
      }
    });
    // ---- Modo invitado (cuenta anónima efímera) ----
    app.post('/api/auth/guest', async (req, res) => {
      try {
        const result = await authService.guest();
        if (statsRepo) statsRepo.incr('logins').catch(() => {});
        return res.json(result);
      } catch (err) {
        if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'No se pudo crear la sesión de invitado.' });
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
    // ---- Inicio de sesión con Google (verifica el ID token con Google) ----
    app.post('/api/auth/google', async (req, res) => {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(501).json({ error: 'Inicio con Google no está configurado.' });
      const credential = (req.body || {}).credential;
      if (!credential) return res.status(400).json({ error: 'Falta el token de Google.' });
      try {
        const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
        if (!r.ok) return res.status(401).json({ error: 'Token de Google inválido.' });
        const p = await r.json();
        if (p.aud !== clientId) return res.status(401).json({ error: 'Token de Google no válido para esta app.' });
        if (!(p.email_verified === true || p.email_verified === 'true')) return res.status(401).json({ error: 'El correo de Google no está verificado.' });
        const email = String(p.email || '').trim().toLowerCase();
        if (!email) return res.status(401).json({ error: 'Google no devolvió un correo.' });
        const result = await authService.googleAuth({ email });
        if (statsRepo) statsRepo.incr('logins').catch(() => {});
        if (result.created) sendWelcomeEmail(result.email, result.displayName).catch(() => {});
        return res.json(result);
      } catch (err) {
        if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
        return res.status(502).json({ error: 'No se pudo verificar con Google.' });
      }
    });
  }

  // ---- Perfil del usuario (protegido) ----
  if (requireAuth && authService) {
    app.get('/api/me', requireAuth, async (req, res) => {
      try { return res.json(await authService.getProfile(req.userId)); }
      catch (err) { if (err instanceof AuthError) return res.status(err.status).json({ error: err.message }); return res.status(500).json({ error: 'Error.' }); }
    });
    app.post('/api/me', requireAuth, async (req, res) => {
      try { return res.json(await authService.updateProfile(req.userId, req.body || {})); }
      catch (err) { if (err instanceof AuthError) return res.status(err.status).json({ error: err.message }); return res.status(500).json({ error: 'Error.' }); }
    });
    app.delete('/api/me', requireAuth, async (req, res) => {
      try { return res.json(await authService.deleteAccount(req.userId)); }
      catch (err) { if (err instanceof AuthError) return res.status(err.status).json({ error: err.message }); return res.status(500).json({ error: 'Error.' }); }
    });
  }

  // ---- Biblioteca (protegida) ----
  // IMPORTANTE: las rutas con path literal (/api/playlists/saved) deben
  // registrarse ANTES de las rutas con parámetro (:id), o Express captura
  // "saved" como si fuera un id de playlist normal.
  if (requireAuth && savedPlaylistsRepo) {
    app.get('/api/playlists/saved', requireAuth, wrap(async (req, res) => {
      res.json({ playlists: await savedPlaylistsRepo.list(req.userId) });
    }));
    app.post('/api/playlists/saved', requireAuth, wrap(async (req, res) => {
      await savedPlaylistsRepo.add(req.userId, (req.body || {}).playlist);
      res.status(201).json({ ok: true });
    }));
    app.delete('/api/playlists/saved/:playlistId', requireAuth, wrap(async (req, res) => {
      await savedPlaylistsRepo.remove(req.userId, req.params.playlistId);
      res.json({ ok: true });
    }));
  }

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
      const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
      res.status(201).json(await historyService.record(req.userId, (req.body || {}).trackId, undefined, userAgent));
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

  // ---- Salud de la base de datos (público) ----
  app.get('/api/health', async (req, res) => {
    const result = healthSvc
      ? await healthSvc(startTime)
      : { status: 'ok', db: 'n/a', latencyMs: null, uptime: Math.floor((Date.now() - startTime) / 1000) };
    return res.status(result.db === 'red' ? 503 : 200).json(result);
  });

  // ---- Eventos de trazabilidad ----
  const eventLimiter20 = createRateLimiter({ windowMs: 60_000, max: 20 });
  const eventLimiter10 = createRateLimiter({ windowMs: 60_000, max: 10 });

  app.post('/api/events/playback-error', eventLimiter20, async (req, res) => {
    const body = req.body || {};
    if (!body.trackId)   return res.status(400).json({ error: 'Falta el campo "trackId".' });
    if (!body.errorCode) return res.status(400).json({ error: 'Falta el campo "errorCode".' });
    const userId = optionalUserId(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
    if (errorRepo) {
      await errorRepo.recordError({ userId, trackId: body.trackId, errorCode: body.errorCode, errorMessage: body.errorMessage || '', userAgent }).catch(() => {});
      if (userId) errorRepo.checkAndFlagUser(userId).catch(() => {});
    }
    return res.status(201).json({ ok: true });
  });

  if (requireAuth && sessionRepo) {
    app.post('/api/events/session-start', requireAuth, eventLimiter10, wrap(async (req, res) => {
      const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
      const id = await sessionRepo.startSession({ userId: req.userId, userAgent });
      res.status(201).json({ ok: true, sessionId: id });
    }));
    app.post('/api/events/session-end', requireAuth, eventLimiter10, wrap(async (req, res) => {
      const result = await sessionRepo.endSession(req.userId);
      if (!result) return res.status(409).json({ error: 'No hay sesión activa que cerrar.' });
      res.json({ ok: true, durationSeconds: result.duration_seconds });
    }));
  }

  // ---- Sincronización completa de biblioteca ----
  if (requireAuth && syncSvc) {
    app.get('/api/sync/library', requireAuth, wrap(async (req, res) => {
      const library = await withTimeout(syncSvc.getLibrary(req.userId), 10_000);
      res.json(library);
    }));
    app.post('/api/sync/library', requireAuth, wrap(async (req, res) => {
      const result = await withTimeout(syncSvc.pushLibrary(req.userId, req.body || {}), 10_000);
      res.json(result);
    }));
  }

  // ---- Metadatos de pistas (sincronización entre dispositivos) ----
  // El frontend sube los metadatos de las pistas que el usuario reproduce,
  // guarda o añade a playlists, y los descarga (hidrata) en cualquier otro
  // dispositivo para renderizar su biblioteca sin depender de la caché local.
  if (requireAuth && trackMetaRepo) {    app.post('/api/tracks', requireAuth, wrap(async (req, res) => {
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
  // La clave se define con la variable de entorno ADMIN_KEY. SIN default: si no
  // está configurada, el panel queda DESHABILITADO (no se expone con clave débil).
  const ADMIN_KEY = process.env.ADMIN_KEY || '';
  const ADMIN_ENABLED = ADMIN_KEY.length >= 8;
  if (statsRepo && !ADMIN_ENABLED) {
    app.get('/api/admin/stats', (req, res) => res.status(503).json({ error: 'Panel de administración deshabilitado (ADMIN_KEY no configurada).' }));
  }
  if (statsRepo && ADMIN_ENABLED) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtDate = (t) => t ? new Date(t).toLocaleString('es') : '—';
    const STYLE = `body{font-family:system-ui,sans-serif;background:#04060a;color:#f4f7fb;margin:0;padding:24px}a{color:#10d9a0;text-decoration:none}a:hover{text-decoration:underline}
      h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;color:#cdd6e2}.sub{color:#8b97a8;margin:0 0 20px;font-size:13px}
      .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}.card{background:#10151e;border:1px solid #ffffff14;border-radius:14px;padding:16px 20px;min-width:120px}
      .card .n{font-size:28px;font-weight:800;color:#10d9a0}.card .l{font-size:11px;color:#8b97a8;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
      table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #ffffff10;vertical-align:top}th{color:#8b97a8;font-size:11px;text-transform:uppercase;letter-spacing:1px}
      input{background:#10151e;border:1px solid #ffffff20;border-radius:10px;padding:8px 12px;color:#f4f7fb;font-size:13px;width:280px;margin-bottom:14px}
      .tag{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:#1b2230;color:#8b97a8}.guest{background:#3a2a10;color:#e0a458}`;
    const page = (title, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

    app.get('/api/admin/stats', wrap(async (req, res) => {
      if (String(req.query.key || '') !== ADMIN_KEY) {
        return res.status(401).json({ error: 'Clave de administrador inválida.' });
      }
      const key = encodeURIComponent(String(req.query.key));
      const wantsHtml = String(req.query.html || '') === '1' || (req.headers.accept || '').includes('text/html');
      const userParam = String(req.query.user || '').trim();

      // ── Vista detalle de un usuario ──
      if (userParam) {
        const act = (typeof statsRepo.userActivity === 'function') ? await statsRepo.userActivity(userParam, 200) : null;
        if (!act) { if (!wantsHtml) return res.status(404).json({ error: 'Usuario no encontrado.' }); return res.status(404).send(page('No encontrado', '<p>Usuario no encontrado.</p>')); }
        if (!wantsHtml) return res.json(act);
        const u = act.user;
        const top = act.topTracks.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.title || t.trackId)}</td><td>${esc(t.artist)}</td><td>${t.count}</td></tr>`).join('') || '<tr><td colspan="4">Sin datos.</td></tr>';
        const plays = act.plays.map((p) => `<tr><td>${esc(p.title || p.trackId)}</td><td>${esc(p.artist)}</td><td>${fmtDate(p.at)}</td></tr>`).join('') || '<tr><td colspan="3">Sin reproducciones.</td></tr>';
        const searches = act.searches.map((s) => `<tr><td>${esc(s.q)}</td><td>${fmtDate(s.at)}</td></tr>`).join('') || '<tr><td colspan="2">Sin búsquedas.</td></tr>';
        return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(page(`Usuario · ${u.email}`, `
          <p class="sub"><a href="/api/admin/stats?key=${key}&html=1">← Volver</a></p>
          <h1>${esc(u.displayName || u.email)} ${u.isGuest ? '<span class="tag guest">invitado</span>' : ''}</h1>
          <p class="sub">${esc(u.email)} · registrado ${fmtDate(u.createdAt)}</p>
          <div class="cards">
            <div class="card"><div class="n">${u.loginCount}</div><div class="l">Inicios de sesión</div></div>
            <div class="card"><div class="n">${u.playCount}</div><div class="l">Reproducciones</div></div>
            <div class="card"><div class="n">${act.searches.length}</div><div class="l">Búsquedas (recientes)</div></div>
            <div class="card"><div class="n">${fmtDate(u.lastActive || u.lastLogin)}</div><div class="l">Última actividad</div></div>
          </div>
          <h2>Top canciones</h2>
          <table><thead><tr><th>#</th><th>Canción</th><th>Artista</th><th>Veces</th></tr></thead><tbody>${top}</tbody></table>
          <h2>Reproducciones recientes</h2>
          <table><thead><tr><th>Canción</th><th>Artista</th><th>Cuándo</th></tr></thead><tbody>${plays}</tbody></table>
          <h2>Búsquedas recientes</h2>
          <table><thead><tr><th>Búsqueda</th><th>Cuándo</th></tr></thead><tbody>${searches}</tbody></table>`));
      }

      // ── Vista general ──
      const data = await statsRepo.summary();
      if (!wantsHtml) return res.json(data);
      const rows = data.users.map((u) => {
        const ident = encodeURIComponent(u.id || u.email);
        return `<tr><td><a href="/api/admin/stats?key=${key}&html=1&user=${ident}">${esc(u.email)}</a> ${u.isGuest ? '<span class="tag guest">invitado</span>' : ''}</td><td>${esc(u.displayName || '')}</td><td>${u.loginCount}</td><td>${u.playCount}</td><td>${fmtDate(u.lastActive || u.lastLogin)}</td><td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('es') : '—'}</td></tr>`;
      }).join('');
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(page('Velocity · Trazabilidad', `
        <h1>VELOCITY MUSIC · Trazabilidad</h1><p class="sub">Actualizado: ${new Date().toLocaleString('es')} · toca un correo para ver su detalle</p>
        <div class="cards">
          <div class="card"><div class="n">${data.totals.registeredUsers}</div><div class="l">Usuarios</div></div>
          <div class="card"><div class="n">${data.totals.logins}</div><div class="l">Inicios de sesión</div></div>
          <div class="card"><div class="n">${data.totals.plays}</div><div class="l">Reproducciones</div></div>
          <div class="card"><div class="n">${data.totals.searches}</div><div class="l">Búsquedas</div></div>
        </div>
        <input id="f" placeholder="Filtrar por correo…" oninput="for(const r of document.querySelectorAll('tbody tr')){r.style.display=r.innerText.toLowerCase().includes(this.value.toLowerCase())?'':'none'}" />
        <table><thead><tr><th>Email</th><th>Nombre</th><th>Logins</th><th>Reprod.</th><th>Última actividad</th><th>Registrado</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Sin usuarios aún.</td></tr>'}</tbody></table>`));
    }));
  }

  // ---- Presencia en tiempo real (Admin_Key) ----
  if (ADMIN_ENABLED && sessionRepo) {
    app.get('/api/admin/presence', async (req, res) => {
      if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'Clave de administrador inválida.' });
      try {
        const users = await sessionRepo.listActive(500);
        return res.json({ users });
      } catch { return res.status(502).json({ error: 'No se pudo obtener la presencia.' }); }
    });
  }

  // ---- Alertas de errores de reproducción (Admin_Key) ----
  if (ADMIN_ENABLED && errorRepo) {
    app.get('/api/admin/alerts', async (req, res) => {
      if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'Clave de administrador inválida.' });
      try {
        const alerts = await errorRepo.listActiveAlerts();
        return res.json({ alerts });
      } catch { return res.status(502).json({ error: 'No se pudo obtener las alertas.' }); }
    });
    app.post('/api/admin/alerts/:alertId/resolve', async (req, res) => {
      if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'Clave de administrador inválida.' });
      try {
        const ok = await errorRepo.resolveAlert(req.params.alertId);
        return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Alerta no encontrada o ya resuelta.' });
      } catch { return res.status(502).json({ error: 'No se pudo resolver la alerta.' }); }
    });
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
