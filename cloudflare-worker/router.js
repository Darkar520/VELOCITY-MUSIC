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

// Prefijos que van al backend (tunnel → laptop).
// IMPORTANTE: /auth/* NO va al tunnel. El callback de Google es HTML/JS
// estático en Pages; si dependiera del backend y éste cae un segundo,
// el usuario ve 502 y no puede ni terminar el login.
const BACKEND_PREFIXES = ['/api/', '/img/'];

// Rutas de backend EXACTAS (sin subpath). El proxy de carátulas se invoca como
// `/img?u=...`, cuyo pathname es `/img` SIN barra final — por eso no casaba con
// el prefijo `/img/` y las portadas caían al index.html de Pages (bug carátula).
const BACKEND_EXACT = ['/img'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Rutas de backend ──────────────────────────────────────
    const isBackend =
      BACKEND_PREFIXES.some(p => path.startsWith(p)) ||
      BACKEND_EXACT.includes(path);

    if (isBackend) {
      const isAudio = path === '/api/stream-proxy';
      // Reenviar al tunnel preservando method, headers y body.
      // Se construye un nuevo Request explícitamente para garantizar
      // que el body de POST/DELETE se reenvíe correctamente (en algunos
      // casos fetch(request) puede perder el body al reutilizarse el stream).
      const init = {
        method: request.method,
        headers: request.headers,
        redirect: 'follow',
      };
      if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = request.body;
      }
      // Un audio firmado no es un asset estático. El caché de Cloudflare puede
      // convertir Range en una transferencia completa y conservar cuerpos
      // incompletos; además debe volver al origen para validar la caducidad.
      if (isAudio) init.cache = 'no-store';
      // No combinar Request.cache='no-store' con cf.cacheTtl: workerd rechaza
      // esa combinación, aunque las dos opciones funcionen por separado.
      const response = await fetch(new Request(request.url, init));
      if (!isAudio) return response;
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'private, no-store, no-transform');
      headers.set('CDN-Cache-Control', 'no-store');
      headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
