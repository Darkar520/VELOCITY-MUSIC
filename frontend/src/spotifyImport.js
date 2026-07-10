/**
 * Importación Spotify → lista "título - artista" para emparejar con YouTube Music.
 * Las playlists privadas / Made For You requieren un access token de la cuenta dueña.
 */

const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';

/** ¿Es una URL o URI de Spotify (playlist/álbum)? */
export function isSpotifyUrl(input) {
  const s = String(input || '').trim();
  if (!s) return false;
  return /spotify\.com\//i.test(s) || /^spotify:(playlist|album):/i.test(s) || /spotify\.link\//i.test(s);
}

/**
 * Extrae tipo e id de playlist/álbum.
 * @returns {{ type: 'playlist'|'album', id: string } | null}
 */
export function parseSpotifyResource(input) {
  const s = String(input || '').trim();
  if (!s) return null;

  let m = s.match(/spotify:playlist:([a-zA-Z0-9]+)/i);
  if (m) return { type: 'playlist', id: m[1] };
  m = s.match(/spotify:album:([a-zA-Z0-9]+)/i);
  if (m) return { type: 'album', id: m[1] };

  m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([a-zA-Z0-9]+)/i);
  if (m) return { type: 'playlist', id: m[1] };
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?album\/([a-zA-Z0-9]+)/i);
  if (m) return { type: 'album', id: m[1] };

  // Enlaces acortados no se resuelven aquí (necesitan redirect de red).
  if (/spotify\.link\//i.test(s)) return null;

  return null;
}

export function spotifyAuthUrl(clientId, redirectUri = `${window.location.origin}/`) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    show_dialog: 'false',
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/**
 * Descarga nombre + líneas "Título - Artista" de una playlist o álbum.
 * @throws {{ code: 'AUTH'|'FORBIDDEN'|'NOT_FOUND'|'EMPTY'|'NETWORK', message: string }}
 */
export async function fetchSpotifyTracks(resource, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { type, id } = resource;

  if (type === 'playlist') {
    const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name,tracks.total`, { headers });
    if (metaRes.status === 401) {
      const err = new Error('Sesión de Spotify expirada.');
      err.code = 'AUTH';
      throw err;
    }
    if (metaRes.status === 403) {
      const err = new Error('No tienes acceso a esta playlist (privada de otra cuenta o restringida).');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (metaRes.status === 404) {
      const err = new Error('Playlist no encontrada. ¿Enlace incorrecto?');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (!metaRes.ok) {
      const err = new Error('Spotify no pudo leer la playlist.');
      err.code = 'NETWORK';
      throw err;
    }
    const meta = await metaRes.json();
    const lines = await paginateSpotifyTracks(
      `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,artists(name)))`,
      headers,
      (item) => {
        const t = item && item.track;
        if (!t || !t.name) return null;
        const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(', ');
        return artists ? `${t.name} - ${artists}` : t.name;
      },
    );
    if (!lines.length) {
      const err = new Error('La playlist no tiene canciones legibles.');
      err.code = 'EMPTY';
      throw err;
    }
    return { name: meta.name || 'Playlist de Spotify', lines };
  }

  // Álbum
  const metaRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers });
  if (metaRes.status === 401) {
    const err = new Error('Sesión de Spotify expirada.');
    err.code = 'AUTH';
    throw err;
  }
  if (!metaRes.ok) {
    const err = new Error('No se pudo leer el álbum de Spotify.');
    err.code = metaRes.status === 404 ? 'NOT_FOUND' : 'NETWORK';
    throw err;
  }
  const album = await metaRes.json();
  const lines = await paginateSpotifyTracks(
    `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`,
    headers,
    (item) => {
      if (!item || !item.name) return null;
      const artists = (item.artists || []).map((a) => a.name).filter(Boolean).join(', ')
        || (album.artists || []).map((a) => a.name).join(', ');
      return artists ? `${item.name} - ${artists}` : item.name;
    },
  );
  if (!lines.length) {
    const err = new Error('El álbum no tiene canciones.');
    err.code = 'EMPTY';
    throw err;
  }
  return { name: album.name || 'Álbum de Spotify', lines };
}

async function paginateSpotifyTracks(startUrl, headers, mapItem) {
  const lines = [];
  let url = startUrl;
  while (url) {
    const res = await fetch(url, { headers });
    if (res.status === 401) {
      const err = new Error('Sesión de Spotify expirada.');
      err.code = 'AUTH';
      throw err;
    }
    if (!res.ok) {
      const err = new Error('Error al obtener canciones de Spotify.');
      err.code = 'NETWORK';
      throw err;
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const line = mapItem(item);
      if (line) lines.push(line);
    }
    url = data.next || null;
  }
  return lines;
}
