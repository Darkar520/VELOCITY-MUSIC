// ═══════════════════════════════════════════════════════════════
// Service Worker de Velocity Music (PWA).
//
// Estrategia:
//  - App shell (navegación e index.html): network-first con fallback a caché,
//    para que la app abra aunque no haya internet.
//  - Assets con hash (/assets/*.js, *.css, íconos): cache-first (inmutables).
//  - Peticiones a /api/ (streaming, auth, catálogo): SIEMPRE red, nunca caché.
//  - Background Fetch guarda el audio en la misma IndexedDB que offline.js.
// ═══════════════════════════════════════════════════════════════

self.importScripts('/offline-artwork.js', '/downloads-db.js', '/downloads-worker.js');

const CACHE = 'velocity-v101';
const ARTWORK_CACHE = self.VelocityOfflineArtwork.CACHE;
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {})
  );
  // Activar inmediatamente sin esperar que los tabs viejos se cierren.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(async (keys) => {
        // Shell versions are disposable; album images are not. Preserve old
        // list-size images before removing their shell, including libraries
        // whose IDB records still contain remote URLs after a failed fetch.
        const artwork = await caches.open(ARTWORK_CACHE);
        for (const key of keys.filter(k => /^velocity-v\d+$/.test(k) && k !== CACHE)) {
          const old = await caches.open(key);
          try {
            for (const request of await old.keys()) {
              if (new URL(request.url).pathname !== '/img') continue;
              const response = await old.match(request);
              if (response?.ok && /^image\//i.test(response.headers.get('content-type') || '')) await artwork.put(request, response);
            }
            await caches.delete(key);
          } catch { /* retain the old cache if copying failed; retry on update */ }
        }
      })
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        // Notificar a todos los tabs que hay versión nueva.
        clients.forEach((c) => c.postMessage({ type: 'vm-updated' }));
      })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Solo gestionamos peticiones del mismo origen.
  if (url.origin !== self.location.origin) return;
  // Nunca interceptamos la API (streaming, auth, catálogo, letras).
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/offline-artwork/')) {
    event.respondWith(
      Promise.resolve().then(() => self.VelocityOfflineArtwork.respond(decodeURIComponent(url.pathname.slice('/offline-artwork/'.length)), self.VelocityDownloadDB.createStore()))
        .catch(() => new Response(null, { status: 404 }))
    );
    return;
  }
  if (url.pathname === '/img') {
    const image = (async () => {
      // A cached 512px album cover can satisfy 96px/900px views without a
      // server. This is also used by metadata repair before any network work.
      const cached = await self.VelocityOfflineArtwork.cached(request.url);
      if (cached) return cached;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try { return await fetch(request, { signal: controller.signal }); }
      finally { clearTimeout(timer); }
    })();
    event.respondWith(image.catch(() => new Response(null, { status: 503 })));
    event.waitUntil(image.then(async response => {
      if (response?.ok && /^image\//i.test(response.headers.get('content-type') || '')) {
        const cache = await caches.open(ARTWORK_CACHE);
        await cache.put(request, response.clone());
        await self.VelocityOfflineArtwork.remember(ARTWORK_CACHE,request.url);
      }
    }).catch(() => {}));
    return;
  }

  // Navegación (cargar la app): network-first, con fallback al shell cacheado.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(request)))
    );
    return;
  }

  // Assets con hash e íconos: cache-first (son inmutables).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        // Cachear solo respuestas OK del mismo origen.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// Permite que la app fuerce la activación de una nueva versión.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
