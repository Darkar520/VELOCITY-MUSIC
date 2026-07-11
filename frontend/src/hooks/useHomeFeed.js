/**
 * useHomeFeed — feed personalizado profundo de la home.
 *
 * Prioridad:
 *   1) Carruseles desde TU biblioteca (likes, playlists, descargas) — sin API.
 *   2) Radios / búsquedas ancladas a TUS semillas (recent, favs, playlists, searches).
 *   3) Casi nada genérico (SEED_ROWS/MOODS solo como último recurso sin historial).
 *
 * Robustez:
 *   - No cancela el feed solo porque cambió la referencia de un array (usa firma de contenido).
 *   - Concurrencia limitada para radio/search (evita rate-limit que dejaba solo 3 filas).
 *   - Firma completed solo al TERMINAR la generación.
 */
import { useEffect, useRef, useMemo } from 'react';
import { api } from '../api.js';
import { dedupeByTitle, capPerArtist } from '../helpers.js';
import { SEED_ROWS, DISCOVERY, GENRES, MOODS } from '../constants.js';
import { trackById, normalizeTrack } from '../catalog.js';
import { shouldSkipFeedRegen } from '../feed/feedSig.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

const RADIO_CONCURRENCY = 2;
const MIN_MIX = 6;

/** Ejecuta async tasks con límite de concurrencia. */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, n) {
  return shuffle(arr).slice(0, n);
}

function cap1(s) {
  return (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
}

function artistKey(t) {
  return (t?.artist || '').toLowerCase().replace(/\s+/g, '');
}

/** Tracks locales desde ids (catálogo). */
function tracksFromIds(ids, limit = 50) {
  return dedupeByTitle((ids || []).map(trackById).filter(Boolean)).slice(0, limit);
}

/** Mezcla local si hay suficientes pistas en catálogo. */
function localMix(label, ids, min = MIN_MIX) {
  const tracks = tracksFromIds(ids, 50);
  return tracks.length >= min ? { label, tracks } : null;
}

export function useHomeFeed({ authed, libReady, downloaded, recentSearches, onboardPrefs }) {
  const feedSigRef = useRef('');
  const feedTokenRef = useRef(0);
  const prevFeedNonceRef = useRef(0);

  const feedNonce = useLibraryStore((s) => s.feedNonce);
  const setHomeRows = useLibraryStore((s) => s.setHomeRows);
  const setHomeLoading = useLibraryStore((s) => s.setHomeLoading);
  const setFeedNonce = useLibraryStore((s) => s.setFeedNonce);

  const playerDownloaded = usePlayerStore((s) => s.downloaded);
  const effectiveDownloaded = downloaded || playerDownloaded;
  const downloadedRef = useRef(effectiveDownloaded);
  downloadedRef.current = effectiveDownloaded;

  const favs = useLibraryStore((s) => s.favs);
  const recent = useLibraryStore((s) => s.recent);
  const playlists = useLibraryStore((s) => s.playlists);
  const savedPlaylists = useLibraryStore((s) => s.savedPlaylists);

  // Firma de contenido (no identidad de array) → no reinicia el feed a medias.
  const contentSig = useMemo(() => {
    const pl = (playlists || []).map((p) => `${p.id}:${(p.trackIds || []).length}`).join(';');
    const sp = (savedPlaylists || []).map((p) => p.playlistId || p.id || '').join(',');
    const dl = [...(effectiveDownloaded || [])].slice(0, 40).join(',');
    return [
      (favs || []).slice(0, 40).join(','),
      (recent || []).slice(0, 40).join(','),
      pl,
      sp,
      dl,
      (recentSearches || []).slice(0, 8).join('|'),
      Array.isArray(onboardPrefs) ? onboardPrefs.map((p) => p.q).join(',') : '',
    ].join('::');
  }, [favs, recent, playlists, savedPlaylists, effectiveDownloaded, recentSearches, onboardPrefs]);

  if (prevFeedNonceRef.current !== feedNonce) {
    prevFeedNonceRef.current = feedNonce;
    feedSigRef.current = '';
  }

  useEffect(() => {
    if (!authed) return;
    if (!libReady) {
      const retry = setTimeout(() => setFeedNonce(useLibraryStore.getState().feedNonce + 1), 800);
      return () => clearTimeout(retry);
    }

    // Snapshot estable al inicio (evita deps volátiles a mitad de gen).
    const lib = useLibraryStore.getState();
    const favIds = [...(lib.favs || [])];
    const recentIds = [...(lib.recent || [])];
    const pls = [...(lib.playlists || [])];
    const savedPls = [...(lib.savedPlaylists || [])];
    const dlIds = [...(downloadedRef.current || [])];
    const searches = [...new Set((recentSearches || []).map((s) => (s || '').trim()).filter(Boolean))].slice(0, 8);
    const prefs = Array.isArray(onboardPrefs) ? onboardPrefs : [];

    // Score unificado: recent + favs + downloads + tracks de playlists.
    const score = {};
    recentIds.forEach((id, i) => { score[id] = (score[id] || 0) + Math.max(1, 14 - i * 0.35); });
    favIds.forEach((id) => { score[id] = (score[id] || 0) + 8; });
    dlIds.forEach((id) => { score[id] = (score[id] || 0) + 5; });
    pls.forEach((p) => {
      (p.trackIds || []).slice(0, 40).forEach((id, i) => {
        score[id] = (score[id] || 0) + Math.max(1, 4 - i * 0.05);
      });
    });

    const ranked = Object.keys(score)
      .map(trackById)
      .filter(Boolean)
      .sort((a, b) => score[b.id] - score[a.id]);

    // Seeds de artistas distintos (hasta 12 para profundidad).
    const seedPool = [];
    const seenArtist = new Set();
    for (const t of ranked) {
      const a = artistKey(t);
      if (!a || seenArtist.has(a)) continue;
      seenArtist.add(a);
      seedPool.push(t);
      if (seedPool.length >= 12) break;
    }
    const seeds = pick(seedPool, 8);

    const timeSlot = Math.floor(Date.now() / (6 * 3600 * 1000));
    const sig = `${contentSig}#${feedNonce}@${timeSlot}`;
    if (shouldSkipFeedRegen({ completedSig: feedSigRef.current, nextSig: sig })) return;

    const myToken = ++feedTokenRef.current;
    const alive = () => myToken === feedTokenRef.current;
    setHomeLoading(true);

    (async () => {
      const clean = (arr) => (arr || []).filter(Boolean);
      const vary = () => Math.floor(Date.now() / (6 * 3600 * 1000)) % 5;
      const VARY_SFXS = ['', ' hits', ' top songs', ' best', ' popular'];
      const vSfx = VARY_SFXS[vary()];

      const mixFromSeed = async (seed, limit = 50) => {
        if (!seed?.id) return null;
        try {
          const rel = await api.radio(seed.id, limit);
          const tracks = capPerArtist(
            dedupeByTitle([seed, ...rel.map(normalizeTrack)]),
            8,
          ).filter((t) => t.id).slice(0, limit);
          return tracks.length >= MIN_MIX
            ? { label: seed.artist || seed.title || 'Mezcla', tracks }
            : null;
        } catch { return null; }
      };

      const mixFromSearch = async (label, q) => {
        try {
          const raw = await api.search((q || label) + vSfx);
          const tracks = dedupeByTitle(raw.map(normalizeTrack)).filter((t) => t.id).slice(0, 50);
          return tracks.length >= MIN_MIX ? { label, tracks } : null;
        } catch { return null; }
      };

      /** Radio desde query: busca → radio de la mejor pista (profundo, no genérico plano). */
      const mixFromQueryDeep = async (label, q) => {
        try {
          const raw = await api.search(q + vSfx);
          const base = raw.map(normalizeTrack).find((t) => t.id);
          if (!base) return null;
          return mixFromSeed({ ...base }, 50).then((m) => (m ? { ...m, label } : null));
        } catch { return null; }
      };

      const buildDiscovery = async (baseTracks, label) => {
        const bases = (baseTracks || []).filter(Boolean).slice(0, 6);
        if (!bases.length) return null;
        const known = new Set([
          ...recentIds, ...favIds, ...dlIds,
          ...bases.map((s) => s.id),
        ]);
        try {
          const rels = await mapPool(bases, RADIO_CONCURRENCY, (s) =>
            api.radio(s.id, 40).catch(() => []),
          );
          let tracks = capPerArtist(
            dedupeByTitle(rels.flat().map(normalizeTrack)),
            3,
          ).filter((t) => t.id && !known.has(t.id));
          tracks = shuffle(tracks).slice(0, 50);
          return tracks.length >= 8 ? { label, tracks } : null;
        } catch { return null; }
      };

      const sections = [];
      const pushSection = (section, mixes) => {
        if (!alive()) return;
        const ok = clean(Array.isArray(mixes) ? mixes : [mixes]);
        if (!ok.length) return;
        sections.push({ section, mixes: ok });
        setHomeRows([...sections]);
        setHomeLoading(false);
      };

      const hasHistory = seeds.length > 0 || searches.length > 0 || favIds.length > 0
        || pls.some((p) => (p.trackIds || []).length >= MIN_MIX) || dlIds.length >= MIN_MIX;

      // ── 1) BIBLIOTECA LOCAL (instantánea, sin API) ─────────────────
      const localFav = localMix('Tus Me gusta', favIds, MIN_MIX);
      const localDl = localMix('Tus descargas', dlIds, MIN_MIX);
      const localRecent = localMix('Seguí escuchando', recentIds, MIN_MIX);
      const plMixes = pls
        .filter((p) => (p.trackIds || []).length >= MIN_MIX)
        .slice(0, 8)
        .map((p) => localMix(p.name || 'Playlist', p.trackIds, MIN_MIX))
        .filter(Boolean);
      const savedMixes = (savedPls || [])
        .filter((p) => (p.trackIds || []).length >= MIN_MIX)
        .slice(0, 6)
        .map((p) => localMix(p.name || 'Guardada', p.trackIds, MIN_MIX))
        .filter(Boolean);

      if (localRecent) pushSection('Escuchado recientemente', [localRecent]);
      if (localFav) pushSection('De tus Me gusta', [localFav]);
      if (plMixes.length) pushSection('Desde tus playlists', plMixes);
      if (savedMixes.length) pushSection('Playlists que guardaste', savedMixes);
      if (localDl) pushSection('Listas para offline', [localDl]);

      // ── 2) PERSONAL PROFUNDO (radio anclado a tus semillas) ────────
      if (hasHistory && seeds.length && alive()) {
        const madeForYou = clean(await mapPool(seeds.slice(0, 6), RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
        if (madeForYou.length) pushSection('Hecho para ti', madeForYou);
      }

      if (searches.length && alive()) {
        const used = new Set(seeds.map(artistKey));
        const searchMixes = clean(await mapPool(searches.slice(0, 6), RADIO_CONCURRENCY, async (term) => {
          try {
            const raw = await api.search(term);
            const base = raw.map(normalizeTrack).find((t) => t.id);
            if (!base) return null;
            const ak = artistKey(base);
            if (ak && used.has(ak)) return null;
            if (ak) used.add(ak);
            const m = await mixFromSeed(base, 50);
            return m ? { ...m, label: cap1(base.artist || term) } : null;
          } catch { return null; }
        }));
        if (searchMixes.length) pushSection('Inspirado en tus búsquedas', searchMixes);
      }

      // Semillas por recencia pura (momento actual)
      if (alive()) {
        const fresh = [];
        const seenA = new Set();
        for (const id of recentIds) {
          const t = trackById(id);
          if (!t) continue;
          const a = artistKey(t);
          if (!a || seenA.has(a)) continue;
          seenA.add(a);
          fresh.push(t);
          if (fresh.length >= 6) break;
        }
        if (fresh.length) {
          const mixes = clean(await mapPool(fresh.slice(0, 5), RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
          if (mixes.length) pushSection('Tu momento actual', mixes);
        }
      }

      // Porque te gusta X (artista top distinto)
      if (seeds.length && alive()) {
        const bs = pick(seeds, 5);
        const mixes = clean(await mapPool(bs, RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
        if (mixes.length) {
          pushSection('Porque te gusta ' + (bs[0]?.artist || 'tu música'), mixes);
        }
      }

      // Favoritos expandidos (radio merge)
      if (favIds.length && alive()) {
        try {
          const favSeeds = favIds.slice(0, 6).map(trackById).filter(Boolean);
          const radios = await mapPool(favSeeds, RADIO_CONCURRENCY, (t) =>
            api.radio(t.id, 40).catch(() => []),
          );
          const merged = capPerArtist(
            dedupeByTitle(radios.flat().map(normalizeTrack)),
            4,
          ).filter((t) => t.id).slice(0, 50);
          if (merged.length >= 8) {
            pushSection('Tus favoritos expandidos', [{ label: 'Mix de Favoritos', tracks: merged }]);
          }
        } catch { /* noop */ }
      }

      // Desde playlists → radio de 1 seed por playlist (profundidad)
      if (pls.length && alive()) {
        const plSeeds = pls
          .map((p) => {
            const ids = p.trackIds || [];
            for (const id of ids) {
              const t = trackById(id);
              if (t) return { playlist: p, seed: t };
            }
            return null;
          })
          .filter(Boolean)
          .slice(0, 5);
        const mixes = clean(await mapPool(plSeeds, RADIO_CONCURRENCY, async ({ playlist, seed }) => {
          const m = await mixFromSeed(seed, 50);
          return m ? { ...m, label: 'Como ' + (playlist.name || 'tu playlist') } : null;
        }));
        if (mixes.length) pushSection('Más como tus playlists', mixes);
      }

      // Descubrimiento anclado a TODA tu biblioteca
      if (alive()) {
        const discSeeds = pick(
          dedupeByTitle([
            ...seeds,
            ...favIds.slice(0, 10).map(trackById).filter(Boolean),
            ...recentIds.slice(0, 10).map(trackById).filter(Boolean),
          ]),
          6,
        );
        const disc = await buildDiscovery(discSeeds, 'Descubrimiento para ti');
        if (disc) pushSection('Descubrimiento para ti', [disc]);
      }

      // Géneros de onboarding → DEEP (search + radio), no lista plana
      if (prefs.length && alive()) {
        const genreMixes = clean(await mapPool(
          prefs.slice(0, 8),
          RADIO_CONCURRENCY,
          (p) => mixFromQueryDeep(p.label, p.q),
        ));
        if (genreMixes.length) pushSection('Tus géneros a fondo', genreMixes);
      }

      // Artistas frecuentes en biblioteca → un carrusel por artista (profundo)
      if (alive()) {
        const byArtist = new Map();
        for (const t of ranked.slice(0, 80)) {
          const k = artistKey(t);
          if (!k) continue;
          if (!byArtist.has(k)) byArtist.set(k, t);
        }
        const topArtists = [...byArtist.values()].slice(0, 6);
        const artistMixes = clean(await mapPool(topArtists, RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
        if (artistMixes.length) pushSection('Artistas de tu universo', artistMixes);
      }

      // ── 3) DOS CARRUSELES FINALES SIEMPRE PROFUNDOS (no genéricos) ─
      // Mezcla maestra: radio de semillas + favs + playlists (todo junto).
      if (alive()) {
        const masterSeeds = pick(
          dedupeByTitle([
            ...seeds,
            ...favIds.slice(0, 8).map(trackById).filter(Boolean),
            ...pls.flatMap((p) => (p.trackIds || []).slice(0, 3).map(trackById).filter(Boolean)),
            ...recentIds.slice(0, 6).map(trackById).filter(Boolean),
          ]),
          7,
        );
        if (masterSeeds.length) {
          try {
            const rels = await mapPool(masterSeeds, RADIO_CONCURRENCY, (s) =>
              api.radio(s.id, 50).catch(() => []),
            );
            const known = new Set([...favIds, ...recentIds, ...dlIds]);
            let tracks = capPerArtist(
              dedupeByTitle([
                ...masterSeeds,
                ...rels.flat().map(normalizeTrack),
              ]),
              3,
            ).filter((t) => t.id);
            // Preferir novedad pero rellenar con known si hace falta
            const fresh = tracks.filter((t) => !known.has(t.id));
            const rest = tracks.filter((t) => known.has(t.id));
            tracks = [...fresh, ...rest].slice(0, 50);
            if (tracks.length >= 8) {
              pushSection('Hecho solo para vos', [{
                label: 'Tu DNA musical',
                tracks,
              }]);
            }
          } catch { /* noop */ }
        }
      }

      // Segunda fila final: otra muestra / ángulo de descubrimiento personal
      if (alive()) {
        const altSeeds = pick(
          dedupeByTitle([
            ...ranked.slice(0, 30),
            ...seeds,
          ]),
          6,
        );
        const deep = await buildDiscovery(altSeeds, 'Nuevos hallazgos de tu onda');
        if (deep) {
          pushSection('Más profundidad para ti', [deep]);
        } else if (prefs.length) {
          // Fallback personal: géneros deep, NUNCA SEED_ROWS genéricos
          const more = clean(await mapPool(
            pick(prefs, 4),
            RADIO_CONCURRENCY,
            (p) => mixFromQueryDeep('Más ' + p.label, p.q),
          ));
          if (more.length) pushSection('Más de lo que te gusta', more);
        }
      }

      // Sin historial ni biblioteca: solo entonces genérico
      if (!hasHistory && !prefs.length && alive() && sections.length < 2) {
        pushSection('Éxitos del momento', clean(await mapPool(pick(SEED_ROWS, 6), RADIO_CONCURRENCY, (s) => mixFromSearch(s.label, s.q))));
        pushSection('Explora géneros', clean(await mapPool(pick(GENRES, 8), RADIO_CONCURRENCY, (g) => mixFromSearch(g.label, g.q))));
        pushSection('Estados de ánimo', clean(await mapPool(pick(MOODS, 6), RADIO_CONCURRENCY, (m) => mixFromSearch('Mix ' + m.label, m.q))));
        pushSection('Para descubrir', clean(await mapPool(pick(DISCOVERY, 6), RADIO_CONCURRENCY, (d) => mixFromSearch(d.label, d.q))));
      }

      if (alive()) {
        feedSigRef.current = sig;
        setHomeLoading(false);
      }
    })();
  }, [authed, libReady, contentSig, feedNonce, setHomeRows, setHomeLoading, setFeedNonce]);

  // Refresco al volver tras un rato largo
  useEffect(() => {
    let h = 0;
    const v = () => {
      if (document.visibilityState === 'hidden') h = Date.now();
      else if (h && Date.now() - h > 720000) {
        h = 0;
        setFeedNonce(useLibraryStore.getState().feedNonce + 1);
      }
    };
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [setFeedNonce]);
}

export default useHomeFeed;
