/**
 * useLibrarySync — sincronización de biblioteca entre store y backend.
 *
 * Responsabilidades:
 *   1. Hidratar el libraryStore desde localStorage al montar (offline-first).
 *      Clave: 'velocity.lib.<identidad>' — la identidad canónica deriva de la
 *      sub del JWT (misma online/offline, estable ante rotación de token);
 *      ver cacheIdentity() y libCacheCandidates(). Per-usuario, evita mezclar
 *      cuentas.
 *      Antes había duplicación con App.jsx — este hook es ahora la ÚNICA fuente.
 *   2. Cuando authed=true, hacer fetch inicial de favs/playlists/recent/saved.
 *   3. Re-persistir cache cuando el store cambia.
 *
 *   - Eventos remotos now-playing: no se consumen en el frontend; el backend conserva solo telemetría compatible.
 *   - Feed personalizado (depende de too many inputs, queda en App.jsx)
 *   - Upload de pendingFavs offline: lo maneja useLibraryActions con outbox por cuenta.
 *
 * Uso:
 *   useLibrarySync({ authed });
 */
import { useEffect, useRef } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';
import { api, getToken, getAuthGeneration } from '../api.js';
import { allCached, saveMeta, trackById, normalizeTrack, cacheTrack } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import {
  loadPendingFavs,
  mergeFavoriteIds,
  cacheIdentity,
  legacyCacheIdentities,
  favoriteIntentVersion,
  loadFavoriteIntents,
  pruneAcknowledgedFavoriteIntents,
} from '../favoriteOutbox.js';
import { backfillLibraryLyrics } from '../offlineLibrary.js';
// El alias NO puede llamarse `offline`: el hook recibe un parámetro booleano
// con ese mismo nombre y lo sombreaba, así que `offline.listIds()` lanzaba
// TypeError de forma sincrónica (antes del .catch) y el catch global del
// efecto se lo tragaba. Consecuencia: en la rama online nunca se ejecutaban
// el backfill de metadatos, saveMeta() ni writeLibCache(), de modo que la
// caché local quedaba sin los metadatos de la biblioteca y al abrir la app
// sin internet no se veía nada.
import * as offlineDb from '../offline.js';

/**
 * Lee las descargas de IndexedDB sin poder romper el resto del sync.
 * Cualquier fallo (o un módulo mockeado a medias) degrada a listas vacías.
 */
async function readDownloads() {
  const safe = async (fn) => {
    try {
      return typeof fn === 'function' ? await fn() : [];
    } catch { return []; }
  };
  const [ids, metas] = await Promise.all([
    safe(offlineDb.listIds),
    safe(offlineDb.listMetas),
  ]);
  return [Array.isArray(ids) ? ids : [], Array.isArray(metas) ? metas : []];
}

function libCacheKey(email) {
  return 'velocity.lib.' + cacheIdentity(email, getToken());
}

/**
 * Claves candidatas para LEER la caché, de más a menos canónica.
 *
 * La primaria deriva de cacheIdentity(), que con JWT usa la sub de la cuenta:
 * misma clave online que offline y estable entre rotaciones de token. Las
 * restantes son claves legacy de versiones anteriores (por email, o por
 * sufijo del token en invitados): permiten leer cachés escritas antes de la
 * migración sin pérdida; el primer cambio del store las re-escribe bajo la
 * clave canónica (efecto 3), completando la migración sola.
 */
function libCacheCandidates(email) {
  const candidates = [libCacheKey(email)];
  try {
    const normalized = String(email || '').trim().toLowerCase();
    const stored = String(localStorage.getItem('velocity.email') || '').trim().toLowerCase();
    const legacyEmail = normalized || stored;
    if (legacyEmail) candidates.push(`velocity.lib.${legacyEmail}`);
  } catch { /* localStorage indisponible */ }
  const token = getToken() || '';
  if (token) candidates.push(`velocity.lib.guest-${token.slice(-12)}`);
  return [...new Set(candidates)];
}

/** Cantidad de contenido real de una caché (para elegir entre candidatas). */
function libCacheScore(cached) {
  if (!cached || typeof cached !== 'object') return -1;
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return len(cached.favs) + len(cached.playlists) + len(cached.savedAlbums)
    + len(cached.savedPlaylists) + len(cached.recent);
}

function readLibCache(email) {
  // Se elige la candidata con MÁS contenido, no la primera que exista.
  // Regresión: un arranque sin backend dejaba la clave canónica creada pero
  // vacía; al existir, ganaba sobre la legacy por email y la biblioteca real
  // (286 favoritos) quedaba inalcanzable para siempre ("no aparece nada"
  // incluso en modo offline). La canónica se evalúa primero, así que en
  // empate sigue ganando ella y no se mezclan cuentas: las candidatas son
  // solo las de ESTA identidad (sub, email actual/almacenado, token actual).
  let best = null;
  let bestScore = -1;
  for (const key of libCacheCandidates(email)) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const score = libCacheScore(parsed);
      if (score > bestScore) { best = parsed; bestScore = score; }
    } catch { /* clave corrupta: probar la siguiente candidata */ }
  }
  return best;
}

function writeLibCache(favIds, pls, albums, savedPls, recentIds, email, { confirmed = null } = {}) {
  try {
    const key = libCacheKey(email);
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* corrupta: sin protección */ }
    const arr = (v) => (Array.isArray(v) ? v : []);
    // Protección anti-vaciado permanente (regresión: una caché con 286
    // favoritos acabó reducida a 1). POR COLECCIÓN: pasar de N elementos a 0
    // en la caché exige la confirmación de la respuesta íntegra del servidor
    // para ESA colección. Vaciados transitorios o parciales (401 espurio,
    // cuerpo no-JSON tomado por [], fallo de red en parte del sync) conservan
    // los últimos datos conocidos de las colecciones no confirmadas.
    const protect = (next, field) => (
      arr(next).length || !arr(prev?.[field]).length || confirmed?.[field]
        ? arr(next)
        : arr(prev[field])
    );
    const outFavs = protect(favIds, 'favs');
    const outRecent = protect(recentIds, 'recent');
    const outPls = protect(pls, 'playlists');
    const outAlbums = protect(albums, 'savedAlbums');
    const outSavedPls = protect(savedPls, 'savedPlaylists');
    const libIds = new Set([...outFavs, ...outRecent]);
    outPls.forEach(p => (p.trackIds || []).forEach(id => libIds.add(id)));
    outAlbums.forEach(a => (a.trackIds || []).forEach(id => libIds.add(id)));
    outSavedPls.forEach(p => (p.trackIds || []).forEach(id => libIds.add(id)));
    // Filtrar covers data:/blob: para no exceder quota de localStorage.
    const tracks = [...libIds].map(trackById).filter(Boolean).map(t =>
      (typeof t.cover === 'string' && (t.cover.startsWith('data:') || t.cover.startsWith('blob:')))
        ? { ...t, cover: '' } : t
    );
    // No CREAR una entrada vacía. Si nunca hubo caché bajo esta clave y no hay
    // nada que guardar (arranque con el backend caído, store recién reseteado),
    // escribirla dejaría una canónica vacía que bloquea la lectura de las
    // claves legacy y hace permanente la pérdida de biblioteca.
    const nothingToStore = !outFavs.length && !outPls.length && !outAlbums.length
      && !outSavedPls.length && !outRecent.length && !tracks.length;
    if (!prev && nothingToStore) return;
    localStorage.setItem(key, JSON.stringify({
      favs: outFavs,
      playlists: outPls,
      savedAlbums: outAlbums,
      savedPlaylists: outSavedPls,
      recent: outRecent,
      tracks,
    }));
  } catch { /* quota excedido */ }
}

async function hydrateSavedAlbums(albums) {
  const result = (Array.isArray(albums) ? albums : []).map((album) => ({ ...album }));
  const queue = result
    .map((album, index) => ({ album, index }))
    .filter(({ album }) => album?.albumId && (!Array.isArray(album.trackIds) || !album.trackIds.length || album.trackIds.some((id) => !trackById(id))));

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      try {
        const detail = await api.album(item.album.albumId);
        const tracks = Array.isArray(detail?.tracks) ? detail.tracks : [];
        tracks.forEach(normalizeTrack);
        if (tracks.length) {
          result[item.index] = {
            ...item.album,
            trackIds: tracks.map((track) => track.id).filter(Boolean),
          };
        }
      } catch { /* se reintentará en el siguiente arranque */ }
    }
  };

  await Promise.all([worker(), worker()]);
  return result;
}

export function useLibrarySync({ authed, email = '', offline = false } = {}) {
  const cacheKey = libCacheKey(email);
  const didInitRef = useRef(null);
  const emptyIntentRef = useRef({ cacheKey: null, values: null });

  // ─── 1. Hidratar desde localStorage al montar/cambiar de cuenta ────
  useEffect(() => {
    const store = useLibraryStore.getState();
    if (!authed) {
      // La biblioteca es sensible a la cuenta: nunca conservamos el estado
      // anterior mientras la sesión está cerrada o cambia de identidad.
      if (didInitRef.current !== null || store.favs.length || store.playlists.length || store.recent.length || store.savedAlbums.length || store.savedPlaylists.length) store.reset();
      didInitRef.current = null;
      return;
    }
    if (didInitRef.current === cacheKey) return;
    didInitRef.current = cacheKey;
    store.reset();
    const c = readLibCache(email);
    if (!c) return;
    const scope = cacheIdentity(email, getToken());
    const legacyScopes = legacyCacheIdentities(email, getToken());
    const pending = loadPendingFavs(globalThis.localStorage, scope, legacyScopes);
    const localIntents = loadFavoriteIntents(scope);
    if (Array.isArray(c.tracks))        c.tracks.forEach(cacheTrack);
    if (Array.isArray(c.favs))          store.setFavs(mergeFavoriteIds(mergeFavoriteIds(c.favs, pending), localIntents));
    if (Array.isArray(c.playlists))     store.setPlaylists(c.playlists);
    if (Array.isArray(c.savedAlbums))   store.setSavedAlbums(c.savedAlbums);
    if (Array.isArray(c.savedPlaylists)) store.setSavedPlaylists(c.savedPlaylists);
    if (Array.isArray(c.recent))        store.setRecent(c.recent);
  }, [authed, cacheKey, email]);

  // ─── 2. Fetch inicial cuando authed ───────────────────────────────
  useEffect(() => {
    if (!authed) return;
    let cancel = false;
    const requestCacheKey = cacheKey;
    const requestAuthGeneration = getAuthGeneration();
    const requestScope = cacheIdentity(email, getToken());
    const requestLegacyScopes = legacyCacheIdentities(email, getToken());
    const requestIntentVersion = favoriteIntentVersion(requestScope);
    const isCurrent = () => (
      !cancel
      && didInitRef.current === requestCacheKey
      && getAuthGeneration() === requestAuthGeneration
    );
    // ── Sin conexión: NO llamar a la red. Se conserva lo hidratado desde
    // localStorage y se incorporan las descargas de IndexedDB al catálogo
    // (para que el feed offline y la reproducción de descargas funcionen).
    // Antes se intentaban los 5 fetches y solo se actuaba si alguno resolvía;
    // con el backend inalcanzable cada intento esperaba su timeout y, si la
    // caché local era la única fuente, la biblioteca quedaba tal cual (OK),
    // pero sin garantía explícita. Ahora el camino offline es directo.
    const isOffline = offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
    // Un `offline` MAL DETECTADO no debe impedir la PRIMERA sincronización.
    // Regresión (Brave en móvil): `backendDown` sale de un único ping a
    // /api/status; en cuanto daba falso negativo, esta rama devolvía siempre
    // antes de tocar la red, así que 'velocity.lib.<identidad>' no se creaba
    // NUNCA en ese navegador y cada arranque encontraba la biblioteca vacía
    // (Me gusta · 0, sin playlists ni álbumes) mientras las descargas —que
    // viven en IndexedDB y no pasan por el ping— sí se veían. Login y
    // streaming tampoco pasan por el ping, de ahí la asimetría.
    // Si no hay caché utilizable no hay NADA que preservar, así que vale la
    // pena intentar la red: cada petición ya degrada a null por su cuenta y
    // writeLibCache no crea entradas vacías (no puede envenenar la clave).
    const skipNetwork = isOffline && libCacheScore(readLibCache(email)) > 0;
    (async () => {
      try {
        if (skipNetwork) {
          const [, downloadedMetas] = await readDownloads();
          downloadedMetas.forEach(cacheTrack);
          // Persistir los metadatos en el catálogo: sin esto, un arranque
          // offline posterior vuelve a quedarse sin títulos ni carátulas.
          if (downloadedMetas.length) saveMeta();
          if (isCurrent()) {
            const st = useLibraryStore.getState();
            writeLibCache(st.favs, st.playlists, st.savedAlbums, st.savedPlaylists, st.recent, email);
          }
          return;
        }
        const [fav, pls, hist, albums, savedPls] = await Promise.all([
          api.favorites().catch(() => null),
          api.playlists().catch(() => null),
          api.history().catch(() => null),
          api.savedAlbums().catch(() => null),
          api.savedPlaylists().catch(() => null),
        ]);
        if (!isCurrent()) return;
        const store = useLibraryStore.getState();
        const pending = loadPendingFavs(globalThis.localStorage, requestScope, requestLegacyScopes);
        // Incluir intenciones posteriores al inicio de esta petición: el
        // response puede representar el estado remoto anterior al toggle.
        const recentIntents = loadFavoriteIntents(requestScope, requestIntentVersion);
        if (fav !== null) {
          // El backend confirma la cuenta, pero la outbox y la última intención
          // local conservan operaciones que todavía no aparecen en la respuesta.
          store.setFavs(mergeFavoriteIds(mergeFavoriteIds(fav, pending), recentIntents));
        } else {
          store.setFavs(mergeFavoriteIds(mergeFavoriteIds(store.favs, pending), recentIntents));
        }
        pruneAcknowledgedFavoriteIntents(requestScope, requestIntentVersion);
        if (hist !== null)     store.setRecent(hist.map(h => h.trackId));
        if (savedPls !== null) store.setSavedPlaylists(savedPls);
        if (pls !== null) {
          // `null` = fallo de red en ESA playlist; `[]` = playlist realmente
          // vacía. Antes ambos casos colapsaban a `[]`, así que un timeout
          // puntual vaciaba la playlist y el efecto 3 persistía el vacío,
          // haciendo permanente la pérdida.
          const cachedPls = store.playlists || [];
          // Pintar YA los nombres desde la respuesta del servidor conservando
          // los trackIds locales: resolver los trackIds frescos requiere una
          // petición por playlist y no debe retrasar el render (mismo patrón
          // que álbumes guardados más abajo).
          if (isCurrent()) {
            store.setPlaylists(pls.map((p) => ({
              id: p.id,
              name: p.name,
              trackIds: (cachedPls.find((c) => c.id === p.id)?.trackIds) || [],
            })));
          }
          const withTracks = await Promise.all(pls.map(async p => {
            const ids = await api.playlistTracks(p.id).catch(() => null);
            if (ids === null) {
              const cached = cachedPls.find((c) => c.id === p.id);
              return { id: p.id, name: p.name, trackIds: cached?.trackIds || [] };
            }
            return { id: p.id, name: p.name, trackIds: ids };
          }));
          if (isCurrent()) store.setPlaylists(withTracks);
        }

        // Los álbumes antiguos solo guardan metadata en backend. Expandirlos a
        // trackIds permite que el backfill alcance sus canciones y que el
        // resultado quede cacheado localmente para el siguiente arranque.
        let hydratedAlbums = null;
        if (albums !== null) {
          const cachedAlbums = store.savedAlbums || [];
          const mergedAlbums = albums.map((album) => ({
            ...(cachedAlbums.find((cached) => cached.albumId === album.albumId) || {}),
            ...album,
          }));
          // Pintar primero con lo que ya se sabe (nombre/caráula del backend o
          // de la caché local): la expansión a trackIds dispara una petición
          // por álbum (2 workers en paralelo) y no debe retrasar —ni impedir—
          // que la sección sea visible.
          if (isCurrent()) store.setSavedAlbums(mergedAlbums);
          hydratedAlbums = await hydrateSavedAlbums(mergedAlbums);
          if (isCurrent()) store.setSavedAlbums(hydratedAlbums);
        }
        if (!isCurrent()) return;

        // Las descargas son otra fuente de verdad: sus metadatos deben entrar
        // al catálogo antes de programar letras, aunque nunca hayan sido parte
        // de favoritos o playlists.
        const [downloadedIds, downloadedMetas] = await readDownloads();
        downloadedMetas.forEach(cacheTrack);

        // Subir metadatos locales al backend (sync cross-device).
        const local = allCached().map(slimTrack).filter(Boolean);
        if (local.length) api.saveTracks(local).catch(() => {});

        // Hidratar metadatos de todas las colecciones que alimentan el
        // backfill: favoritos, playlists propias/guardadas, álbumes guardados
        // y descargas. Antes solo se cubrían favoritos y playlists propias.
        if (fav !== null || pls !== null || albums !== null || savedPls !== null || downloadedIds.length) {
          const libraryState = useLibraryStore.getState();
          const finalFavs = libraryState.favs || [];
          const recentIds = hist !== null ? hist.map(h => h.trackId) : (libraryState.recent || []);
          const currentPls = libraryState.playlists;
          const currentAlbums = libraryState.savedAlbums;
          const finalSavedPlaylists = libraryState.savedPlaylists;
          const allIds = new Set([...finalFavs, ...recentIds, ...(downloadedIds || [])]);
          currentPls.forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          (savedPls || []).forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          (currentAlbums || []).forEach(a => (a.trackIds || []).forEach(id => allIds.add(id)));
          const missing = [...allIds].filter(id => id && !trackById(id));
          for (let i = 0; i < missing.length && isCurrent(); i += 300) {
            const metas = await api.getTracks(missing.slice(i, i + 300)).catch(() => []);
            if (isCurrent() && metas.length) metas.forEach(normalizeTrack);
          }
          if (isCurrent()) {
            saveMeta();
            const finalPlaylists = useLibraryStore.getState().playlists;
            const finalAlbums = useLibraryStore.getState().savedAlbums;
            // Cada colección solo puede vaciarse en caché si SU respuesta fue
            // íntegra (no null). Un fallo de red en cualquiera conserva los
            // últimos datos conocidos de esa colección (ver writeLibCache).
            writeLibCache(finalFavs, finalPlaylists, finalAlbums, finalSavedPlaylists, recentIds, email, {
              confirmed: {
                favs: fav !== null,
                playlists: pls !== null,
                savedAlbums: albums !== null,
                savedPlaylists: savedPls !== null,
                recent: hist !== null,
              },
            });
            // Sincronización silenciosa por cuenta y por pista. Las fallidas
            // permanecen pendientes y se reintentan en el siguiente arranque.
            backfillLibraryLyrics({
              scope: cacheIdentity(email, getToken()),
              favs: finalFavs,
              playlists: finalPlaylists,
              savedAlbums: finalAlbums,
              savedPlaylists: finalSavedPlaylists,
              downloadedIds: downloadedIds || [],
            });
          }
        }
      } catch { /* silent — offline o backend caído */ }
    })();
    return () => { cancel = true; };
  }, [authed, email, cacheKey, offline]);

  // ─── 3. Re-persistir cache cuando el store cambia ────────────────
  const favs = useLibraryStore((s) => s.favs);
  const playlists = useLibraryStore((s) => s.playlists);
  const savedAlbums = useLibraryStore((s) => s.savedAlbums);
  const savedPlaylists = useLibraryStore((s) => s.savedPlaylists);
  const recent = useLibraryStore((s) => s.recent);
  const emptyIntents = useLibraryStore((s) => s.emptyIntents);

  useEffect(() => {
    if (!authed || didInitRef.current !== cacheKey) {
      emptyIntentRef.current = { cacheKey: null, values: null };
      return;
    }
    const current = { ...(emptyIntents || {}) };
    const previous = emptyIntentRef.current;
    const baseline = previous.cacheKey === cacheKey ? (previous.values || {}) : {};
    const confirmed = {};
    ['favs', 'playlists', 'savedAlbums', 'savedPlaylists', 'recent'].forEach((field) => {
      if ((Number(current[field]) || 0) > (Number(baseline[field]) || 0)) confirmed[field] = true;
    });
    writeLibCache(favs, playlists, savedAlbums, savedPlaylists, recent, email, { confirmed });
    emptyIntentRef.current = { cacheKey, values: current };
  }, [authed, cacheKey, email, favs, playlists, savedAlbums, savedPlaylists, recent, emptyIntents]);
}

export default useLibrarySync;
