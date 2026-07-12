// ═══════════════════════════════════════════════════════════════
// Service Worker de Velocity Music (PWA).
//
// Estrategia:
//  - App shell (navegación e index.html): network-first con fallback a caché,
//    para que la app abra aunque no haya internet.
//  - Assets con hash (/assets/*.js, *.css, íconos): cache-first (inmutables).
//  - Peticiones a /api/ (streaming, auth, catálogo): SIEMPRE red, nunca caché.
//  - El audio descargado NO lo maneja el SW: vive en IndexedDB (offline.js).
// ═══════════════════════════════════════════════════════════════

const CACHE = 'velocity-v36';
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
