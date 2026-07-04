/**
 * Velocity Music — Cloudflare Worker Router
 *
 * Enrutamiento en el edge:
 *   /api/*  /img/*  /auth/*  → tunnel (backend en la laptop)
 *   todo lo demás            → Cloudflare Pages (frontend estático 24/7)
 *
 * Así el frontend está siempre disponible aunque la laptop esté apagada,
 * y el backend solo entra en juego para streaming/búsqueda/auth.
 */

// URL base del Pages project (frontend estático)
const PAGES_URL = 'https://velocity-music.pages.dev';

// Prefijos que siempre van al backend (tunnel → laptop)
const BACKEND_PREFIXES = ['/api/', '/img/', '/auth/'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Rutas de backend ──────────────────────────────────────
    const isBackend = BACKEND_PREFIXES.some(p => path.startsWith(p));

    if (isBackend) {
      // Reenviar al tunnel tal cual. Si la laptop está apagada,
      // el tunnel devolverá un error 5xx (el worker lo pasa al cliente).
      const backendUrl = new URL(request.url);
      // El tunnel ya maneja velocitymusic.uk → localhost:3000,
      // así que simplemente dejamos pasar la request original.
      // Este bloque no se ejecuta en Worker routes que excluyen /api —
      // solo aplica si el Worker intercepta todo el tráfico.
      return fetch(request);
    }

    // ── Frontend (Pages) ─────────────────────────────────────
    // Reescribir la URL al Pages project manteniendo path + query.
    const pagesUrl = new URL(path + url.search, PAGES_URL);
    const pagesRequest = new Request(pagesUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    const response = await fetch(pagesRequest);

    // Si Pages devuelve 404 (ruta SPA no encontrada), servir index.html
    // para que React Router maneje la navegación del lado del cliente.
    if (response.status === 404) {
      const indexUrl = new URL('/index.html', PAGES_URL);
      return fetch(new Request(indexUrl.toString(), pagesRequest));
    }

    return response;
  },
};
