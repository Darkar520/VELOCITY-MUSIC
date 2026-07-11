/**
 * useHomeFeed — feed personal profundo con VARIOS mixes por sección.
 */
import { useEffect, useRef, useMemo } from 'react';
import { api } from '../api.js';
import { dedupeByTitle, capPerArtist } from '../helpers.js';
import { SEED_ROWS, DISCOVERY, GENRES, MOODS } from '../constants.js';
import { trackById, normalizeTrack } from '../catalog.js';
import { shouldSkipFeedRegen } from '../feed/feedSig.js';
import {
  shuffle, pick, artistKey, tracksFromIds, ensureManyMixes,
  offlineMixes, favArtistMixes, recentSliceMixes, playlistMixes, mixesByArtist,
} from '../feed/mixBuilders.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

const RADIO_CONCURRENCY = 2;
const MIN_MIX = 4;

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

function cap1(s) {
  return (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
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

  const contentSig = useMemo(() => {
    const pl = (playlists || []).map((p) => `${p.id}:${(p.trackIds || []).length}`).join(';');
    const sp = (savedPlaylists || []).map((p) => p.playlistId || p.id || '').join(',');
    const dl = [...(effectiveDownloaded || [])].slice(0, 40).join(',');
    return [
      (favs || []).slice(0, 40).join(','),
      (recent || []).slice(0, 40).join(','),
      pl, sp, dl,
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

    const lib = useLibraryStore.getState();
    const favIds = [...(lib.favs || [])];
    const recentIds = [...(lib.recent || [])];
    const pls = [...(lib.playlists || [])];
    const savedPls = [...(lib.savedPlaylists || [])];
    const dlIds = [...(downloadedRef.current || [])];
    const searches = [...new Set((recentSearches || []).map((s) => (s || '').trim()).filter(Boolean))].slice(0, 8);
    const prefs = Array.isArray(onboardPrefs) ? onboardPrefs : [];

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

    const seedPool = [];
    const seenArtist = new Set();
    for (const t of ranked) {
      const a = artistKey(t);
      if (!a || seenArtist.has(a)) continue;
      seenArtist.add(a);
      seedPool.push(t);
      if (seedPool.length >= 14) break;
    }
    const seeds = pick(seedPool, 10);

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

      const mixFromQueryDeep = async (label, q) => {
        try {
          const raw = await api.search(q + vSfx);
          const base = raw.map(normalizeTrack).find((t) => t.id);
          if (!base) return null;
          const m = await mixFromSeed(base, 50);
          return m ? { ...m, label } : null;
        } catch { return null; }
      };

      const buildDiscoveryMixes = async (baseTracks, max = 5) => {
        const bases = pick((baseTracks || []).filter(Boolean), max);
        if (!bases.length) return [];
        const known = new Set([...recentIds, ...favIds, ...dlIds, ...bases.map((s) => s.id)]);
        const mixes = clean(await mapPool(bases, RADIO_CONCURRENCY, async (s) => {
          try {
            const rel = await api.radio(s.id, 40);
            let tracks = capPerArtist(dedupeByTitle(rel.map(normalizeTrack)), 3)
              .filter((t) => t.id && !known.has(t.id))
              .slice(0, 40);
            if (tracks.length < MIN_MIX) return null;
            return { label: `Como ${s.artist || s.title}`, tracks };
          } catch { return null; }
        }));
        return ensureManyMixes(mixes, { min: 3, max: 8, prefix: 'Hallazgo' });
      };

      const sections = [];
      /** Solo publica si hay ≥2 mixes; si hay 1, intenta expandir; si no, renombra y parte. */
      const pushRich = (section, mixes, { min = 2, prefix } = {}) => {
        if (!alive()) return;
        let list = ensureManyMixes(clean(mixes), { min, max: 10, prefix: prefix || section });
        if (list.length < 2) return; // no desperdiciar fila de 1 tarjeta
        sections.push({ section, mixes: list });
        setHomeRows([...sections]);
        setHomeLoading(false);
      };

      const hasHistory = seeds.length > 0 || searches.length > 0 || favIds.length > 0
        || pls.some((p) => (p.trackIds || []).length >= MIN_MIX) || dlIds.length >= MIN_MIX;

      // ═══ 1) RECIENTES (arriba del feed, varios mixes) ═══
      {
        const rMixes = recentSliceMixes(recentIds);
        if (rMixes.length >= 2) pushRich('Escuchado recientemente', rMixes, { prefix: 'Reciente' });
        else if (rMixes.length === 1 && (rMixes[0].tracks || []).length >= 8) {
          pushRich('Escuchado recientemente', rMixes, { min: 2, prefix: 'Reciente' });
        }
      }

      // ═══ 2) BIBLIOTECA LOCAL multi-mix ═══
      {
        const favMix = favArtistMixes(favIds);
        if (favMix.length) pushRich('De tus Me gusta', favMix, { prefix: 'Like' });
      }
      {
        const plm = playlistMixes(pls);
        if (plm.length >= 2) pushRich('Desde tus playlists', plm, { prefix: 'Playlist' });
        else if (plm.length === 1) {
          const expanded = ensureManyMixes(plm, { min: 2, prefix: plm[0].label || 'Playlist' });
          if (expanded.length >= 2) pushRich('Desde tus playlists', expanded, { prefix: 'Playlist' });
        }
      }
      {
        const saved = playlistMixes(
          (savedPls || []).map((p) => ({
            name: p.name,
            trackIds: p.trackIds || [],
          })),
        );
        if (saved.length >= 2) pushRich('Playlists que guardaste', saved, { prefix: 'Guardada' });
      }
      {
        const off = offlineMixes(dlIds);
        if (off.length >= 2) pushRich('Listas para offline', off, { prefix: 'Offline' });
        else if (off.length === 1) {
          const expanded = ensureManyMixes(off, { min: 2, prefix: 'Offline' });
          if (expanded.length >= 2) pushRich('Tus descargas por artista', expanded, { prefix: 'Offline' });
        }
      }

      // ═══ 3) HECHO PARA TI — varios radios de semillas ═══
      if (hasHistory && seeds.length && alive()) {
        const made = clean(await mapPool(seeds.slice(0, 8), RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
        pushRich('Hecho para ti', made, { prefix: 'Para ti' });
      }

      // ═══ 4) BÚSQUEDAS ═══
      if (searches.length && alive()) {
        const used = new Set(seeds.map(artistKey));
        const searchMixes = clean(await mapPool(searches.slice(0, 8), RADIO_CONCURRENCY, async (term) => {
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
        pushRich('Inspirado en tus búsquedas', searchMixes, { prefix: 'Búsqueda' });
      }

      // ═══ 5) MOMENTO ACTUAL ═══
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
          if (fresh.length >= 8) break;
        }
        if (fresh.length) {
          const mixes = clean(await mapPool(fresh.slice(0, 6), RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
          pushRich('Tu momento actual', mixes, { prefix: 'Ahora' });
        }
      }

      // ═══ 6) PORQUE TE GUSTA ═══
      if (seeds.length && alive()) {
        const bs = pick(seeds, 6);
        const mixes = clean(await mapPool(bs, RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
        pushRich('Porque te gusta', mixes, { prefix: 'Porque' });
      }

      // ═══ 7) FAVORITOS EXPANDIDOS — un mix por fav seed ═══
      if (favIds.length && alive()) {
        const favSeeds = favIds.slice(0, 8).map(trackById).filter(Boolean);
        const mixes = clean(await mapPool(favSeeds, RADIO_CONCURRENCY, async (t) => {
          const m = await mixFromSeed(t, 50);
          return m ? { ...m, label: `Más ${t.artist || t.title}` } : null;
        }));
        // + locales por artista
        const local = favArtistMixes(favIds);
        pushRich('Tus favoritos expandidos', [...mixes, ...local], { prefix: 'Favorito' });
      }

      // ═══ 8) MÁS COMO TUS PLAYLISTS ═══
      if (pls.length && alive()) {
        const plSeeds = pls
          .map((p) => {
            for (const id of p.trackIds || []) {
              const t = trackById(id);
              if (t) return { playlist: p, seed: t };
            }
            return null;
          })
          .filter(Boolean)
          .slice(0, 6);
        const mixes = clean(await mapPool(plSeeds, RADIO_CONCURRENCY, async ({ playlist, seed }) => {
          const m = await mixFromSeed(seed, 50);
          return m ? { ...m, label: 'Como ' + (playlist.name || 'tu playlist') } : null;
        }));
        pushRich('Más como tus playlists', mixes, { prefix: 'Playlist+' });
      }

      // ═══ 9) DESCUBRIMIENTO multi ═══
      if (alive()) {
        const discSeeds = pick(dedupeByTitle([
          ...seeds,
          ...favIds.slice(0, 10).map(trackById).filter(Boolean),
          ...recentIds.slice(0, 10).map(trackById).filter(Boolean),
        ]), 6);
        const disc = await buildDiscoveryMixes(discSeeds, 6);
        pushRich('Descubrimiento para ti', disc, { prefix: 'Descubre' });
      }

      // ═══ 10) GÉNEROS a fondo (multi) ═══
      if (prefs.length && alive()) {
        const genreMixes = clean(await mapPool(
          prefs.slice(0, 8),
          RADIO_CONCURRENCY,
          (p) => mixFromQueryDeep(p.label, p.q),
        ));
        pushRich('Tus géneros a fondo', genreMixes, { prefix: 'Género' });
      }

      // ═══ 11) ARTISTAS DE TU UNIVERSO ═══
      if (alive()) {
        const byArtist = new Map();
        for (const t of ranked.slice(0, 100)) {
          const k = artistKey(t);
          if (!k) continue;
          if (!byArtist.has(k)) byArtist.set(k, t);
        }
        const topArtists = [...byArtist.values()].slice(0, 8);
        const artistMixes = clean(await mapPool(topArtists, RADIO_CONCURRENCY, (s) => mixFromSeed(s, 50)));
        pushRich('Artistas de tu universo', artistMixes, { prefix: 'Artista' });
      }

      // ═══ 12) DNA musical — VARIOS clusters de semillas ═══
      if (alive()) {
        const pool = dedupeByTitle([
          ...seeds,
          ...favIds.slice(0, 12).map(trackById).filter(Boolean),
          ...pls.flatMap((p) => (p.trackIds || []).slice(0, 4).map(trackById).filter(Boolean)),
          ...recentIds.slice(0, 10).map(trackById).filter(Boolean),
        ]);
        const clusters = [
          pick(pool, 5),
          pick(pool, 5),
          pick(pool, 5),
          pick(pool, 5),
        ].filter((c) => c.length >= 2);
        const dnaMixes = clean(await mapPool(clusters, 1, async (cluster, idx) => {
          try {
            const rels = await mapPool(cluster, RADIO_CONCURRENCY, (s) =>
              api.radio(s.id, 40).catch(() => []),
            );
            const tracks = capPerArtist(
              dedupeByTitle([...cluster, ...rels.flat().map(normalizeTrack)]),
              3,
            ).filter((t) => t.id).slice(0, 50);
            if (tracks.length < 8) return null;
            const labels = ['Tu DNA musical', 'Tu firma sonora', 'Núcleo de gustos', 'Esencia personal'];
            return { label: labels[idx] || `DNA ${idx + 1}`, tracks };
          } catch { return null; }
        }));
        pushRich('Hecho solo para vos', dnaMixes, { prefix: 'DNA' });
      }

      // ═══ 13) MÁS PROFUNDIDAD — varios ángulos ═══
      if (alive()) {
        const altA = pick(ranked.slice(0, 40), 5);
        const altB = pick(seeds, 5);
        const altC = pick(favIds.map(trackById).filter(Boolean), 5);
        const deepMixes = [];
        for (const [label, group] of [
          ['Nuevos hallazgos de tu onda', altA],
          ['Ramas de tu gusto', altB],
          ['Más allá de tus likes', altC],
        ]) {
          if (!group.length) continue;
          const m = await buildDiscoveryMixes(group, 2);
          if (m[0]) deepMixes.push({ ...m[0], label });
          if (m[1]) deepMixes.push({ ...m[1], label: label + ' · extra' });
        }
        if (prefs.length) {
          const more = clean(await mapPool(
            pick(prefs, 4),
            RADIO_CONCURRENCY,
            (p) => mixFromQueryDeep('Más ' + p.label, p.q),
          ));
          deepMixes.push(...more);
        }
        pushRich('Más profundidad para ti', deepMixes, { prefix: 'Profundidad' });
      }

      // Sin historial: genérico solo como último recurso
      if (!hasHistory && !prefs.length && alive() && sections.length < 2) {
        pushRich('Éxitos del momento', clean(await mapPool(pick(SEED_ROWS, 6), RADIO_CONCURRENCY, (s) => mixFromSearch(s.label, s.q))), { prefix: 'Hit' });
        pushRich('Explora géneros', clean(await mapPool(pick(GENRES, 8), RADIO_CONCURRENCY, (g) => mixFromSearch(g.label, g.q))), { prefix: 'Género' });
        pushRich('Para descubrir', clean(await mapPool(pick(DISCOVERY, 6), RADIO_CONCURRENCY, (d) => mixFromSearch(d.label, d.q))), { prefix: 'Nuevo' });
      }

      if (alive()) {
        feedSigRef.current = sig;
        setHomeLoading(false);
      }
    })();
  }, [authed, libReady, contentSig, feedNonce, setHomeRows, setHomeLoading, setFeedNonce]);

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
