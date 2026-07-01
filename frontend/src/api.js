// Cliente del backend de Velocity Music.
// En desarrollo, Vite hace proxy de /api -> http://localhost:3000 (ver vite.config.js).
// En producción, el backend sirve este frontend como estático, así que /api es el mismo origen.

let token = localStorage.getItem('velocity.token') || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('velocity.token', t);
  else localStorage.removeItem('velocity.token');
}
export function getToken() {
  return token;
}
export function isAuthed() {
  return !!token;
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let _onUnauthorized = null;
export function setOnUnauthorized(fn) { _onUnauthorized = fn; }

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) { setToken(null); if (_onUnauthorized) _onUnauthorized(); }
    throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  }
  return data;
}

export const api = {
  // ── Estado / catálogo ──
  async status() {
    return jsonOrThrow(await fetch('/api/status'));
  },
  async search(q, signal) {
    const data = await jsonOrThrow(await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal }));
    return data.results || [];
  },
  // Búsqueda combinada: { songs, albums, artists }
  async searchAll(q, signal) {
    return jsonOrThrow(await fetch(`/api/search/all?q=${encodeURIComponent(q)}`, { signal }));
  },
  // URL de streaming (proxy que resuelve con yt-dlp). Se usa como src del <audio>.
  // quality: 'high' | 'medium' | 'low' (mapeado desde la preferencia del usuario)
  streamUrl({ artist, title, id, quality }) {
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (id) params.set('id', id);
    if (quality) params.set('quality', quality);
    return `/api/stream-proxy?${params.toString()}`;
  },
  // Precarga (warm-up) de la resolución de una pista en la caché del backend.
  // No descarga audio: solo fuerza a que yt-dlp resuelva la URL y quede cacheada,
  // para que al reproducir esa pista el arranque sea instantáneo.
  prefetchStream({ artist, title, id, quality }) {
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (id) params.set('id', id);
    if (quality) params.set('quality', quality);
    // redirect:'manual' → no seguimos el 302 (no descargamos el audio),
    // solo disparamos la resolución que llena el StreamCache del backend.
    return fetch(`/api/resolve?${params.toString()}`, { redirect: 'manual' }).catch(() => {});
  },
  async lyrics({ artist, title, album, duration, id, sync }, signal) {
    const params = new URLSearchParams({ artist, title });
    if (album) params.set('album', album);
    if (duration) params.set('duration', String(duration));
    if (id) params.set('id', id);
    if (sync) params.set('sync', '1');
    const res = await fetch(`/api/lyrics?${params.toString()}`, { signal });
    if (res.status === 404) return null;
    return jsonOrThrow(res);
  },
  // Perfil de artista (top canciones + álbumes reales).
  async artist(id, signal) {
    return jsonOrThrow(await fetch(`/api/artist?id=${encodeURIComponent(id)}`, { signal }));
  },
  // Álbum completo (metadatos + pistas).
  async album(id, signal) {
    return jsonOrThrow(await fetch(`/api/album?id=${encodeURIComponent(id)}`, { signal }));
  },
  // Radio / relacionadas a una canción (reproducción tipo Spotify).
  async radio(id, signal) {
    const d = await jsonOrThrow(await fetch(`/api/radio?id=${encodeURIComponent(id)}`, { signal }));
    return d.tracks || [];
  },

  // ── Autenticación ──
  async register(email, password) {
    return jsonOrThrow(await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }));
  },
  async login(email, password) {
    const data = await jsonOrThrow(await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }));
    if (data.token) setToken(data.token);
    return data;
  },
  logout() { setToken(null); },

  // ── Favoritos ──
  async favorites() {
    const d = await jsonOrThrow(await fetch('/api/favorites', { headers: authHeaders() }));
    return d.favorites || [];
  },
  async addFavorite(trackId) {
    return jsonOrThrow(await fetch('/api/favorites', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ trackId }),
    }));
  },
  async removeFavorite(trackId) {
    return jsonOrThrow(await fetch(`/api/favorites/${encodeURIComponent(trackId)}`, {
      method: 'DELETE', headers: authHeaders(),
    }));
  },

  // ── Playlists ──
  async playlists() {
    const d = await jsonOrThrow(await fetch('/api/playlists', { headers: authHeaders() }));
    return d.playlists || [];
  },
  async createPlaylist(name) {
    const d = await jsonOrThrow(await fetch('/api/playlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name }),
    }));
    return d.id;
  },
  async playlistTracks(id) {
    const d = await jsonOrThrow(await fetch(`/api/playlists/${encodeURIComponent(id)}`, { headers: authHeaders() }));
    return d.tracks || [];
  },
  async addToPlaylist(id, trackId) {
    return jsonOrThrow(await fetch(`/api/playlists/${encodeURIComponent(id)}/tracks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ trackId }),
    }));
  },
  async removeFromPlaylist(id, trackId) {
    return jsonOrThrow(await fetch(`/api/playlists/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`, {
      method: 'DELETE', headers: authHeaders(),
    }));
  },
  async deletePlaylist(id) {
    return jsonOrThrow(await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: authHeaders(),
    }));
  },

  // ── Historial ──
  async history() {
    const d = await jsonOrThrow(await fetch('/api/history', { headers: authHeaders() }));
    return d.history || [];
  },
  async recordHistory(trackId) {
    return jsonOrThrow(await fetch('/api/history', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ trackId }),
    }));
  },

  // ── Álbumes guardados ──
  async savedAlbums() {
    const d = await jsonOrThrow(await fetch('/api/albums/saved', { headers: authHeaders() }));
    return d.albums || [];
  },
  async saveAlbum(album) {
    return jsonOrThrow(await fetch('/api/albums/saved', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ album }),
    }));
  },
  async unsaveAlbum(albumId) {
    return jsonOrThrow(await fetch(`/api/albums/saved/${encodeURIComponent(albumId)}`, {
      method: 'DELETE', headers: authHeaders(),
    }));
  },

  // ── Metadatos de pistas (sincronización entre dispositivos) ──
  // Sube los metadatos de un lote de pistas para que otros dispositivos puedan
  // renderizar la biblioteca del usuario. Silencioso ante errores.
  async saveTracks(tracks) {
    if (!tracks || !tracks.length) return;
    try {
      await fetch('/api/tracks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tracks }),
      });
    } catch {}
  },
  // Recupera (hidrata) metadatos de pistas por sus IDs.
  async getTracks(ids) {
    if (!ids || !ids.length) return [];
    try {
      const d = await jsonOrThrow(await fetch(`/api/tracks?ids=${encodeURIComponent(ids.join(','))}`, { headers: authHeaders() }));
      return d.tracks || [];
    } catch { return []; }
  },
};
