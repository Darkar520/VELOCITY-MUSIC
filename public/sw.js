// Service worker mínimo: cachea el "app shell" para carga rápida e instalación.
// El audio y las llamadas a /api NO se cachean (siempre en vivo).
const CACHE = 'velocity-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/icon.svg',
  '/manifest.webmanifest',
  '/app/main.js',
  '/app/api.js',
  '/app/data.js',
  '/app/lib/search.js',
  '/app/lib/theme.js',
  '/app/lib/net.js',
  '/app/lib/player.js',
  '/app/lib/offline.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // No interceptar API ni audio.
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => cached)),
  );
});
