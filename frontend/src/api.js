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
  // Ping ligero para detectar si el backend está caído (timeout 5s).
  async pingBackend() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('/api/status', { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch { return false; }
  },
  async search(q, signal) {
    const data = await jsonOrThrow(await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal, headers: authHeaders() }));
    return data.results || [];
  },
  // Búsqueda combinada: { songs, albums, artists }
  async searchAll(q, signal) {
    return jsonOrThrow(await fetch(`/api/search/all?q=${encodeURIComponent(q)}`, { signal, headers: authHeaders() }));
  },
  // URL base del proxy (sin firma). Preferir ensureStreamUrl para <audio>/descargas.
  // quality: 'high' | 'medium' | 'low' (mapeado desde la preferencia del usuario)
  // stream: URL directa (opcional, para SoundCloud/fuentes sin resolución).
  streamUrl({ artist, title, id, quality, stream }) {
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (id) params.set('id', id);
    if (quality) params.set('quality', quality);
    if (stream) params.set('stream', stream);  // URL directa: no requiere yt-dlp
    return `/api/stream-proxy?${params.toString()}`;
  },
  // Ensambla URL firmada a partir de exp/sig del backend (puro, sin red).
  buildSignedStreamUrl({ artist, title, id, quality, stream, exp, sig }) {
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (id) params.set('id', id);
    if (quality) params.set('quality', quality);
    if (stream) params.set('stream', stream);
    params.set('exp', String(exp));
    params.set('sig', String(sig));
    return `/api/stream-proxy?${params.toString()}`;
  },
  // Caché de firmas (clave por pista/calidad). Margen 60s antes de exp.
  _streamSignCache: new Map(),
  _streamSignKey({ artist, title, id, quality, stream }) {
    return [artist || '', title || '', id || '', quality || '', stream || ''].join('\0');
  },
  // Obtiene URL firmada lista para <audio src> o fetch de blob.
  // Requiere JWT (Bearer). Reutiliza firma en caché si queda >60s de vida.
  async ensureStreamUrl({ artist, title, id, quality, stream }) {
    const key = this._streamSignKey({ artist, title, id, quality, stream });
    const now = Math.floor(Date.now() / 1000);
    const hit = this._streamSignCache.get(key);
    if (hit && hit.exp - now > 60) return hit.url;

    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (id) params.set('id', id);
    if (quality) params.set('quality', quality);
    if (stream) params.set('stream', stream);
    const data = await jsonOrThrow(
      await fetch(`/api/stream-sign?${params.toString()}`, { headers: authHeaders() }),
    );
    const url = this.buildSignedStreamUrl({
      artist, title, id, quality, stream,
      exp: data.exp,
      sig: data.sig,
    });
    this._streamSignCache.set(key, { exp: Number(data.exp), url });
    // Evitar crecimiento ilimitado de la caché.
    if (this._streamSignCache.size > 200) {
      const oldest = this._streamSignCache.keys().next().value;
      this._streamSignCache.delete(oldest);
    }
    return url;
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
    // Requiere JWT (resolve está protegido).
    return fetch(`/api/resolve?${params.toString()}`, {
      redirect: 'manual',
      headers: authHeaders(),
    }).catch(() => {});
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
  async radio(id, limit, signal) {
    const params = new URLSearchParams({ id: String(id) });
    if (limit && typeof limit === 'number') params.set('limit', String(Math.min(50, limit)));
    const d = await jsonOrThrow(await fetch(`/api/radio?${params.toString()}`, { signal }));
    return d.tracks || [];
  },

  // ── Autenticación ──
  async register(email, password, displayName) {
    return jsonOrThrow(await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
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
  async guestLogin() {
    const data = await jsonOrThrow(await fetch('/api/auth/guest', { method: 'POST' }));
    if (data.token) setToken(data.token);
    return data;
  },
  async me() {
    return jsonOrThrow(await fetch('/api/me', { headers: authHeaders() }));
  },
  async updateProfile(patch) {
    const body = typeof patch === 'string' ? { displayName: patch } : (patch || {});
    return jsonOrThrow(await fetch('/api/me', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }));
  },
  async deleteAccount() {
    const data = await jsonOrThrow(await fetch('/api/me', { method: 'DELETE', headers: authHeaders() }));
    setToken(null);
    return data;
  },
  logout() { setToken(null); },

  // ── Inicio de sesión con Google ──
  async authConfig() {
    try { return await jsonOrThrow(await fetch('/api/auth/config')); } catch { return {}; }
  },
  async googleLogin(credential) {
    const data = await jsonOrThrow(await fetch('/api/auth/google', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    }));
    if (data.token) setToken(data.token);
    return data;
  },

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
  async importPlaylist(url) {
    return jsonOrThrow(await fetch('/api/playlists/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ url }),
    }));
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

  // ── Playlists/Mixes guardados en biblioteca ──
  async savedPlaylists() {
    const d = await jsonOrThrow(await fetch('/api/playlists/saved', { headers: authHeaders() }));
    return d.playlists || [];
  },
  async savePlaylist(playlist) {
    return jsonOrThrow(await fetch('/api/playlists/saved', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ playlist }),
    }));
  },
  async unsavePlaylist(playlistId) {
    return jsonOrThrow(await fetch(`/api/playlists/saved/${encodeURIComponent(playlistId)}`, {
      method: 'DELETE', headers: authHeaders(),
    }));
  },

  // ── Trazabilidad — eventos de sesión y errores de reproducción ──
  async sessionStart() {
    try { await fetch('/api/events/session-start', { method: 'POST', headers: authHeaders() }); } catch {}
  },
  async sessionEnd() {
    try { await fetch('/api/events/session-end', { method: 'POST', headers: authHeaders() }); } catch {}
  },
  async reportPlaybackError({ trackId, errorCode, errorMessage }) {
    try {
      await fetch('/api/events/playback-error', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ trackId, errorCode, errorMessage: errorMessage || '' }),
      });
    } catch {}
  },

  // ── Sincronización completa de biblioteca entre dispositivos ──
  async getLibrary() {
    try {
      return await jsonOrThrow(await fetch('/api/sync/library', { headers: authHeaders() }));
    } catch { return null; }
  },
  async pushLibrary(state) {
    if (!state) return;
    try {
      await fetch('/api/sync/library', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(state),
      });
    } catch {}
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

  // ── Now Playing: sincronización en tiempo real entre dispositivos ──
  async updateNowPlaying(state) {
    try {
      await fetch('/api/now-playing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(state),
      });
    } catch {}
  },
  async getNowPlaying() {
    try {
      return await jsonOrThrow(await fetch('/api/now-playing', { headers: authHeaders() }));
    } catch { return { nowPlaying: null }; }
  },
  // SSE: stream de actualizaciones en tiempo real. Retorna el EventSource.
  // EventSource no soporta headers custom, así que pasamos el token por query param.
  subscribeNowPlaying() {
    const t = getToken();
    const url = t ? `/api/now-playing/events?token=${encodeURIComponent(t)}` : '/api/now-playing/events';
    return new EventSource(url, { withCredentials: false });
  },
};
