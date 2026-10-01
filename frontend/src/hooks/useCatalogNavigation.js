/**
 * useCatalogNavigation — navegación del catálogo (artista, álbum, mezcla,
 * wrapped), hidratación de metadatos, AI DJ y compartir.
 *
 * Extraído de App.jsx sin cambio de comportamiento. Todas las funciones
 * conservan su firma y su cadena de fallbacks tal cual, porque son el resultado
 * de bugs reales ya corregidos:
 *
 *  - goArtist: filtra en cliente por artista coincidente (el backend a veces
 *    devuelve recomendaciones ajenas) y cae a búsqueda si no hay artistId.
 *  - goAlbum: en vista de álbum se FUERZA la portada del álbum sobre la
 *    artworkUrl de cada pista (YTM devuelve miniaturas de vídeo). Cadena de
 *    respaldo API → catálogo local → búsqueda → offline, para no acabar con
 *    "0 canciones" cuando la API responde vacío/502.
 *  - goToPlayingPlaylist: sólo navega si el origen sigue existiendo, y oculta
 *    el reproductor expandido para llegar limpio a la lista.
 */
import { api } from '../api.js';
import * as offline from '../offline.js';
import { dedupeByTitle, capPerArtist } from '../helpers.js';
import { cacheTrack, trackById, allCached, saveMeta, normalizeTrack } from '../catalog.js';

// El enlace compartido debe salir del mismo origen que sirve la aplicación.
// Evita dominios antiguos/inexistentes y mantiene funcionando los previews.
export function buildTrackShareUrl(id, origin = (typeof window !== 'undefined' ? window.location.origin : 'https://velocitymusic.uk')) {
  const trackId = String(id ?? '').trim();
  if (!trackId) return '';
  try {
    return new URL(`/track/${encodeURIComponent(trackId)}`, origin).toString();
  } catch {
    return '';
  }
}

function catalogIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function albumArtistMatches(actual, expected) {
  const expectedKey = catalogIdentity(expected);
  if (!expectedKey) return true;
  const actualText = String(actual || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (catalogIdentity(actualText) === expectedKey) return true;
  return actualText
    .split(/\s*(?:,|&|\bx\b|\bfeat(?:uring)?\.?\b)\s*/i)
    .map(catalogIdentity)
    .filter(Boolean)
    .includes(expectedKey);
}

/**
 * Acepta pistas de respaldo solo cuando existe evidencia de pertenencia al
 * álbum: albumId exacto, o nombre+artista exactos si todavía no hay ID.
 */
export function filterVerifiedAlbumTracks(tracks, { albumId, name, artist } = {}) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (albumId) return list.filter((track) => track?.albumId === albumId);
  const nameKey = catalogIdentity(name);
  if (!nameKey) return [];
  return list.filter((track) => (
    catalogIdentity(track?.album) === nameKey
    && albumArtistMatches(track?.artist, artist)
  ));
}

export function findVerifiedAlbumCandidate(albums, { name, artist } = {}) {
  const nameKey = catalogIdentity(name);
  if (!nameKey) return null;
  return (Array.isArray(albums) ? albums : []).find((album) => (
    album?.albumId
    && catalogIdentity(album.name) === nameKey
    && albumArtistMatches(album.artist, artist)
  )) || null;
}

export function useCatalogNavigation({
  setExpanded, setView, setOpenPlaylist, setTab,
  setDetailData, setDetailLoading, setCatVer,
  showToast, play,
  recent, favs, downloaded,
  playingFrom, playlists, savedPlaylists,
}) {
  const goMix = (mix) => {
    if (!mix || !mix.tracks) return;
    mix.tracks.forEach(cacheTrack);
    setExpanded(false);
    setView({ type:'mix', label: mix.label, tracks: mix.tracks });
  };

  const goWrapped = () => { setExpanded(false); setOpenPlaylist(null); setView({ type:'wrapped' }); };

  const startAiDj = async () => {
    showToast('AI DJ preparando tu estacion...');
    const score = {};
    recent.forEach((id, i) => { score[id] = (score[id] || 0) + Math.max(1, 12 - i * 0.4); });
    favs.forEach(id => { score[id] = (score[id] || 0) + 6; });
    [...downloaded].forEach(id => { score[id] = (score[id] || 0) + 4; });
    const ranked = Object.keys(score).map(trackById).filter(Boolean).sort((a, b) => score[b.id] - score[a.id]);
    const top = ranked.slice(0, 3);
    let pool = [];
    try {
      if (top.length) { const rels = await Promise.all(top.map(s => api.radio(s.id).catch(() => []))); pool = capPerArtist(dedupeByTitle([...top, ...rels.flat().map(normalizeTrack)]), 2).filter(t => t.id); }
      else { const raw = await api.search('top hits 2024'); pool = dedupeByTitle(raw.map(normalizeTrack)).filter(t => t.id); }
    } catch {}
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    if (!pool.length) { showToast('No se pudo iniciar el AI DJ'); return; }
    pool.forEach(cacheTrack);
    play(pool[0], pool.map(t => t.id), { radio: true });
    showToast('AI DJ sonando tu estacion personalizada');
  };

  // Recupera del backend los metadatos de pistas que no estén en caché local.
  const hydrateTracks = async (ids) => {
    const missing = (ids || []).filter(id => id && !trackById(id));
    if (!missing.length) return;
    try {
      for (let i = 0; i < missing.length; i += 300) {
        const metas = await api.getTracks(missing.slice(i, i + 300));
        metas.forEach(normalizeTrack);
      }
      saveMeta(); setCatVer(v => v + 1);
    } catch {}
  };

  const goArtist = (artistId, name) => {
    setExpanded(false); setView({ type:'artist', artistId, name });
    setDetailData(null); setDetailLoading(true);
    // Fallback de búsqueda: solo pistas cuyo artista coincida (evita basura genérica).
    const filterArtistTracks = (raw, artistName) => {
      const key = String(artistName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const tracks = dedupeByTitle(raw.map(normalizeTrack));
      if (!key) return tracks;
      const own = tracks.filter((t) => {
        const a = String(t.artist || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return a === key || a.startsWith(key + ' ') || a.includes(key) || key.includes(a);
      });
      return own.length ? own : tracks.slice(0, 8);
    };
    const fallback = () => api.search(name)
      .then((raw) => setDetailData({ type:'artist', name, topSongs: filterArtistTracks(raw, name), albums: [] }))
      .catch(() => { setDetailData({ type:'artist', name, topSongs: [], albums: [], error: true }); });
    if (!artistId) { fallback().finally(() => setDetailLoading(false)); return; }
    api.artist(artistId)
      .then((d) => {
        const artistName = d.name || name;
        // Cinturón y tirantes: filtrar en cliente por si el backend devuelve algo ajeno.
        const songs = dedupeByTitle((d.topSongs || []).map(normalizeTrack)).filter((t) => {
          if (!artistName) return true;
          const key = String(artistName).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const a = String(t.artist || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return !a || a === key || a.startsWith(key + ' ') || a.includes(key) || key.includes(a);
        });
        setDetailData({ type:'artist', name: artistName, thumbnail: d.thumbnail, topSongs: songs, albums: d.albums || [] });
      })
      .catch(fallback)
      .finally(() => setDetailLoading(false));
  };

  // Navegar al origen de la pista que se está reproduciendo. Soporta cualquier
  // tipo de origen (playlist, mix, álbum, artista). Al navegar, OCULTA el
  // reproductor expandido para que el usuario llegue limpio a la lista.
  const goToPlayingPlaylist = () => {
    if (!playingFrom) return;
    setExpanded(false); // ocultar reproductor expandido
    switch (playingFrom.kind) {
      case 'liked':
        setTab('library'); setView(null); setOpenPlaylist('liked');
        return;
      case 'user-playlist': {
        const exists = playlists.some(p => p.id === playingFrom.id);
        if (!exists) return;
        setTab('library'); setView(null); setOpenPlaylist(playingFrom.id);
        return;
      }
      case 'saved-playlist': {
        const exists = savedPlaylists?.some(p => p.playlistId === playingFrom.id);
        if (!exists) return;
        setTab('library'); setView(null); setOpenPlaylist('saved:' + playingFrom.id);
        return;
      }
      case 'mix':
        // Re-abrir el mix con los tracks que ya tenemos en playingFrom
        setTab('home'); setView({ type:'mix', label: playingFrom.label, tracks: playingFrom.tracks });
        return;
      case 'album':
        setView({ type:'album', albumId: playingFrom.albumId, name: playingFrom.name, artist: playingFrom.artist, cover: playingFrom.cover });
        return;
      case 'artist':
        setView({ type:'artist', artistId: playingFrom.artistId, name: playingFrom.name });
        // Trigger fetch de datos del artista
        goArtist(playingFrom.artistId, playingFrom.name);
        return;
    }
  };

  const goAlbum = (albumId, name, artist, songTitle, cover) => {
    setExpanded(false); setView({ type:'album', albumId, name, artist, cover });
    setDetailData(null); setDetailLoading(true);

    const applyTracks = (meta, tracks, { offline: isOff = false } = {}) => {
      const albumCover = meta.cover || cover || tracks.find((t) => t.cover)?.cover || '';
      const list = (tracks || []).map((t) => {
        // En vista de álbum: forzar SIEMPRE la portada del álbum, ignorando
        // artworkUrl propio del track (que YTM a veces es thumbnail de video).
        const n = normalizeTrack({ ...t, artworkUrl: albumCover, cover: albumCover });
        cacheTrack(n);
        return n;
      });
      if (!list.length) return false;
      setDetailData({
        type: 'album',
        albumId: meta.albumId || albumId,
        name: meta.name || name,
        artist: meta.artist || artist,
        artistId: meta.artistId,
        cover: albumCover,
        year: meta.year,
        tracks: list,
        offline: isOff || undefined,
      });
      return true;
    };

    const offlineFallback = async (aid, aName, aArtist, aCover) => {
      try {
        const metas = await offline.listMetas();
        const tracks = filterVerifiedAlbumTracks(metas, {
          albumId: aid,
          name: aName,
          artist: aArtist,
        }).map(normalizeTrack);
        if (!tracks.length) return false;
        return applyTracks({ name: aName, artist: aArtist, cover: aCover, albumId: aid }, tracks, { offline: true });
      } catch { return false; }
    };

    // Canciones ya en catálogo local (guardadas al ver el álbum antes).
    const catalogFallback = (aid, aName, aArtist) => {
      const tracks = filterVerifiedAlbumTracks(allCached(), {
        albumId: aid,
        name: aName,
        artist: aArtist,
      });
      if (!tracks.length) return false;
      return applyTracks({ albumId: aid, name: aName, artist: aArtist, cover }, tracks);
    };

    const searchFallback = async (aid, aName, aArtist) => {
      const q = `${aName || ''} ${aArtist || ''}`.trim();
      if (!q) return false;
      const r = await api.searchAll(q).catch(() => null);
      let songs = (r?.songs || []).map(normalizeTrack);
      let tracks = filterVerifiedAlbumTracks(songs, { albumId: aid, name: aName, artist: aArtist });
      if (!tracks.length) {
        const raw = await api.search(q).catch(() => []);
        songs = raw.map(normalizeTrack);
        tracks = filterVerifiedAlbumTracks(songs, { albumId: aid, name: aName, artist: aArtist });
      }
      if (!tracks.length) return false;
      const albId = aid || tracks.find((t) => t.albumId)?.albumId || null;
      return applyTracks({
        albumId: albId,
        name: aName,
        artist: aArtist,
        cover: cover || tracks[0]?.cover,
      }, tracks);
    };

    const loadAlbumApi = async (aid) => {
      const d = await api.album(aid);
      const albumCover = d.cover || cover || '';
      const tracks = (d.tracks || []).map((t) => normalizeTrack({
        ...t,
        // En vista álbum: forzar portada del álbum, no thumbnail de video
        artworkUrl: albumCover,
        cover: albumCover,
      }));
      if (!tracks.length) return false;
      return applyTracks({
        albumId: aid,
        name: d.name || name,
        artist: d.artist || artist,
        artistId: d.artistId,
        cover: albumCover,
        year: d.year,
      }, tracks);
    };

    (async () => {
      try {
        let aid = albumId;
        if (!aid) {
          const r = await api.searchAll(`${name} ${artist || ''}`.trim()).catch(() => null);
          const albumCandidate = findVerifiedAlbumCandidate(r?.albums, { name, artist });
          const songCandidate = filterVerifiedAlbumTracks(r?.songs, { name, artist })
            .find((track) => track?.albumId);
          aid = albumCandidate?.albumId || songCandidate?.albumId || null;
          if (!aid) {
            const raw = await api.search(`${songTitle || name} ${artist || ''}`.trim()).catch(() => []);
            aid = filterVerifiedAlbumTracks(raw, { name, artist })
              .find((track) => track?.albumId)?.albumId || null;
          }
        }
        let ok = false;
        if (aid) {
          try { ok = await loadAlbumApi(aid); } catch { ok = false; }
        }
        // API vacía/502 → catálogo → búsqueda → offline (antes: 0 canciones)
        if (!ok) ok = catalogFallback(aid || albumId, name, artist);
        if (!ok) ok = await searchFallback(aid || albumId, name, artist);
        if (!ok) ok = await offlineFallback(aid || albumId, name, artist, cover);
        if (!ok) setDetailData({ type: 'album', name, artist, cover, tracks: [], none: true });
      } catch {
        let ok = catalogFallback(albumId, name, artist);
        if (!ok) ok = await searchFallback(albumId, name, artist);
        if (!ok) ok = await offlineFallback(albumId, name, artist, cover);
        if (!ok) setDetailData({ type: 'album', name, artist, cover, tracks: [], none: true });
      } finally {
        setDetailLoading(false);
      }
    })();
  };

  const shareTrack = (t) => {
    const url = buildTrackShareUrl(t?.id);
    if (!url) { showToast('No se pudo compartir la canción'); return; }
    if (navigator.share) navigator.share({ title:t.title, text:`${t.title} — ${t.artist}`, url }).catch(()=>{});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado')).catch(() => showToast('No se pudo copiar'));
    else showToast(url);
  };

  return { goMix, goWrapped, startAiDj, hydrateTracks, goArtist, goToPlayingPlaylist, goAlbum, shareTrack };
}

export default useCatalogNavigation;
