/**
 * useHomeFeed — genera el feed personalizado de la home.
 *
 * Recibe: { authed, libReady, downloaded, recentSearches, onboardPrefs }
 * Lee del libraryStore: favs, recent
 * Lee del playerStore: downloaded (fallback si prop no se pasa)
 * Escribe en libraryStore: homeRows, homeLoading, feedNonce
 *
 * Política del feed (preservada del original):
 *   - Score por recencia (12 - i*0.4), favs (+6), descargas (+4)
 *   - Hasta 8 seeds con artistas distintos, shuffle
 *   - Variación temporal cada 6h (timeSlot) para rotar queries
 *   - Cancela si feedTokenRef cambia (otra generación empezó)
 *   - No arranca hasta que libReady=true
 */
import { useEffect, useRef } from 'react';
import { api } from '../api.js';
import { dedupeByTitle, capPerArtist, slimTrack } from '../helpers.js';
import { SEED_ROWS, DISCOVERY, GENRES, MOODS } from '../constants.js';
import { trackById, normalizeTrack } from '../catalog.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

export function useHomeFeed({ authed, libReady, downloaded, recentSearches, onboardPrefs }) {
  const feedSigRef = useRef('');
  const feedTokenRef = useRef(0);
  const prevFeedNonceRef = useRef(0);

  // Suscribirse al feedNonce del store para detectar invalidations
  const feedNonce = useLibraryStore((s) => s.feedNonce);
  const setHomeRows = useLibraryStore((s) => s.setHomeRows);
  const setHomeLoading = useLibraryStore((s) => s.setHomeLoading);
  const setFeedNonce = useLibraryStore((s) => s.setFeedNonce);

  // Si downloaded prop no viene, leer del playerStore
  const playerDownloaded = usePlayerStore((s) => s.downloaded);
  const effectiveDownloaded = downloaded || playerDownloaded;
  const downloadedRef = useRef(effectiveDownloaded);
  downloadedRef.current = effectiveDownloaded;

  // Limpiar firma al cambiar feedNonce (nuevo login u otro trigger)
  if (prevFeedNonceRef.current !== feedNonce) {
    prevFeedNonceRef.current = feedNonce;
    feedSigRef.current = '';
  }

  // Suscripción a favs y recent (lecturas finas para no re-renderizar App)
  const favs = useLibraryStore((s) => s.favs);
  const recent = useLibraryStore((s) => s.recent);
  const homeRows = useLibraryStore((s) => s.homeRows);

  useEffect(() => {
    if (!authed) return;
    if (!libReady) {
      const retry = setTimeout(() => setFeedNonce(useLibraryStore.getState().feedNonce + 1), 800);
      return () => clearTimeout(retry);
    }
    const score = {};
    recent.forEach((id, i) => { score[id] = (score[id] || 0) + Math.max(1, 12 - i * 0.4); });
    favs.forEach(id => { score[id] = (score[id] || 0) + 6; });
    [...downloadedRef.current].forEach(id => { score[id] = (score[id] || 0) + 4; });
    const ranked = Object.keys(score).map(trackById).filter(Boolean).sort((a, b) => score[b.id] - score[a.id]);
    const seedPool = []; const seenArtist = new Set();
    for (const t of ranked) { const a = (t.artist || '').toLowerCase(); if (seenArtist.has(a)) continue; seenArtist.add(a); seedPool.push(t); if (seedPool.length >= 8) break; }
    for (let i = seedPool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seedPool[i], seedPool[j]] = [seedPool[j], seedPool[i]]; }
    const seeds = seedPool.slice(0, 6);
    const topSearches = [...new Set((recentSearches || []).map(s => (s || '').trim()).filter(Boolean))].slice(0, 6);
    const prefsSig = Array.isArray(onboardPrefs) ? onboardPrefs.map(p => p.q).join(',') : '';
    const timeSlot = Math.floor(Date.now() / (6 * 3600 * 1000));
    const sig = seeds.map(s => s.id).join('|') + '::' + topSearches.join('|') + '::' + prefsSig + '#' + feedNonce + '@' + timeSlot;
    if (feedSigRef.current && sig === feedSigRef.current && homeRows.length) return;
    feedSigRef.current = sig;
    const myToken = ++feedTokenRef.current;
    const alive = () => myToken === feedTokenRef.current;
    setHomeLoading(true);
    (async () => {
      const clean = (arr) => arr.filter(Boolean);
      const pick = (arr, n) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
      const cap1 = (s) => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
      const vary = () => Math.floor(Date.now() / (6 * 3600 * 1000)) % 5;
      const VARY_SFXS = ['', ' hits', ' top songs', ' best', ' popular'];
      const vSfx = VARY_SFXS[vary()];
      const mixFromSeed = async (seed, limit = 50) => {
        try {
          const rel = await api.radio(seed.id, limit);
          const tracks = capPerArtist(dedupeByTitle([seed, ...rel.map(normalizeTrack)]), 8).filter(t => t.id).slice(0, limit);
          return tracks.length >= 6 ? { label: seed.artist || seed.title || 'Mezcla', tracks } : null;
        } catch { return null; }
      };
      const mixFromQuery = async (label, q) => {
        try {
          const raw = await api.search(q + vSfx);
          const base = raw.map(normalizeTrack).find(t => t.id);
          if (!base) return null;
          const rel = await api.radio(base.id, 50);
          const tracks = capPerArtist(dedupeByTitle([base, ...rel.map(normalizeTrack)]), 6).filter(t => t.id).slice(0, 50);
          return tracks.length >= 6 ? { label, tracks } : null;
        } catch { return null; }
      };
      const mixFromSearch = async (label, q) => {
        try {
          const raw = await api.search(q + vSfx);
          const tracks = dedupeByTitle(raw.map(normalizeTrack)).filter(t => t.id).slice(0, 50);
          return tracks.length >= 6 ? { label, tracks } : null;
        } catch { return null; }
      };
      const genreCards = async (q, n = 4) => {
        try {
          const raw = await api.search(q + vSfx);
          const cand = dedupeByTitle(raw.map(normalizeTrack)).filter(t => t.id);
          const artists = []; const seen = new Set();
          for (const t of cand) { const a = (t.artist || '').trim(); const k = a.toLowerCase(); if (!a || seen.has(k)) continue; seen.add(k); artists.push(a); if (artists.length >= n) break; }
          return clean(await Promise.all(artists.map(a => mixFromSearch(a, a))));
        } catch { return []; }
      };
      const buildDiscovery = async (baseTracks, label = 'Nuevos hallazgos') => {
        const bases = (baseTracks || []).filter(Boolean);
        if (!bases.length) return null;
        const known = new Set([...recent, ...favs, ...[...downloadedRef.current], ...bases.map(s => s.id)]);
        try {
          const rels = await Promise.all(bases.slice(0, 5).map(s => api.radio(s.id, 50).catch(() => [])));
          let tracks = capPerArtist(dedupeByTitle(rels.flat().map(normalizeTrack)), 3).filter(t => t.id && !known.has(t.id));
          for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
          const out = tracks.slice(0, 50);
          return out.length >= 8 ? { label, tracks: out } : null;
        } catch { return null; }
      };

      const sections = [];
      const pushSection = (section, mixes) => { if (!mixes.length || !alive()) return; sections.push({ section, mixes }); setHomeRows([...sections]); setHomeLoading(false); };
      const prefs = Array.isArray(onboardPrefs) ? onboardPrefs : [];
      const hasHistory = seeds.length > 0 || topSearches.length > 0 || favs.length > 0;

      const freshSeeds = [];
      { const seenA = new Set(); for (const id of recent) { const t = trackById(id); if (!t) continue; const a = (t.artist || '').toLowerCase(); if (!a || seenA.has(a)) continue; seenA.add(a); freshSeeds.push(t); if (freshSeeds.length >= 6) break; } }

      if (hasHistory) {
        if (seeds.length) pushSection('Hecho para ti', clean(await Promise.all(seeds.slice(0, 6).map(s => mixFromSeed(s, 50)))));
        if (topSearches.length) {
          const searchMixes = [];
          const usedArtists = new Set(seeds.map(s => (s.artist || '').toLowerCase().replace(/\s+/g, '')));
          await Promise.all(topSearches.map(async (term) => {
            try {
              const raw = await api.search(term);
              const base = raw.map(normalizeTrack).find(t => t.id);
              if (!base) return;
              const artistKey = (base.artist || '').toLowerCase().replace(/\s+/g, '');
              if (usedArtists.has(artistKey)) return;
              usedArtists.add(artistKey);
              const rel = await api.radio(base.id, 50);
              const tracks = capPerArtist(dedupeByTitle([base, ...rel.map(normalizeTrack)]), 6).filter(t => t.id).slice(0, 50);
              if (tracks.length >= 6) searchMixes.push({ label: cap1(base.artist || term), tracks });
            } catch {}
          }));
          if (searchMixes.length) pushSection('Inspirado en tus búsquedas', searchMixes);
        }
        if (freshSeeds.length) pushSection('Tu momento actual', clean(await Promise.all(freshSeeds.slice(0, 5).map(s => mixFromSeed(s, 50)))));
        if (seeds.length) { const bs = pick(seeds, 4); pushSection('Porque te gusta ' + (bs[0]?.artist || 'tu música'), clean(await Promise.all(bs.map(s => mixFromSeed(s, 50))))); }
        if (favs.length) {
          const favSeeds = favs.slice(0, 5);
          try {
            const radios = await Promise.all(favSeeds.map(id => api.radio(id, 50).catch(() => [])));
            const merged = capPerArtist(dedupeByTitle(radios.flat().map(normalizeTrack)), 4).filter(t => t.id).slice(0, 50);
            if (merged.length >= 8) pushSection('Tus favoritos expandidos', [{ label: 'Mix de Favoritos', tracks: merged }]);
          } catch {}
        }
        { const disc = await buildDiscovery(seeds.length ? seeds : freshSeeds, 'Descubrimiento para ti'); if (disc) pushSection('Descubrimiento para ti', [disc]); }
        pushSection('Tendencias ahora', clean(await Promise.all(pick(SEED_ROWS, 6).map(s => mixFromSearch(s.label, s.q)))));
      } else {
        const baseTracks = [];
        if (prefs.length) {
          try {
            const resolved = await Promise.all(prefs.map(async (p) => { try { const raw = await api.search(p.q); return raw.map(normalizeTrack).find(t => t.id) || null; } catch { return null; } }));
            baseTracks.push(...resolved.filter(Boolean));
          } catch {}
        }
        pushSection('Basado en tus gustos', clean(await Promise.all(prefs.map(p => mixFromSearch(p.label, p.q)))));
        for (const p of pick(prefs, 6)) { if (!alive()) break; pushSection('Lo mejor de ' + p.label, await genreCards(p.q, 4)); }
        { const disc = await buildDiscovery(baseTracks, 'Descubre para ti'); if (disc) pushSection('Descubre para ti', [disc]); }
        pushSection('Estados de ánimo', clean(await Promise.all(pick(MOODS, 8).map(m => mixFromSearch('Mix ' + m.label, m.q)))));
        pushSection('Tendencias ahora', clean(await Promise.all(pick(SEED_ROWS, 6).map(s => mixFromSearch(s.label, s.q)))));
      }
      if (!hasHistory && !prefs.length) {
        pushSection('Éxitos del momento', clean(await Promise.all(pick(SEED_ROWS, 6).map(s => mixFromSearch(s.label, s.q)))));
        pushSection('Explora géneros', clean(await Promise.all(pick(GENRES, 8).map(g => mixFromSearch(g.label, g.q)))));
        pushSection('Estados de ánimo', clean(await Promise.all(pick(MOODS, 8).map(m => mixFromSearch('Mix ' + m.label, m.q)))));
        pushSection('Para descubrir', clean(await Promise.all(pick(DISCOVERY, 6).map(d => mixFromSearch(d.label, d.q)))));
      }
      if (alive()) setHomeLoading(false);
    })();
  }, [authed, libReady, recent, favs, recentSearches, onboardPrefs, feedNonce, homeRows.length, setHomeRows, setHomeLoading, setFeedNonce]);

  // Refresco dinámico del feed al volver tras un rato.
  useEffect(() => {
    let h = 0;
    const v = () => {
      if (document.visibilityState === 'hidden') h = Date.now();
      else if (h && Date.now() - h > 720000) { h = 0; setFeedNonce(useLibraryStore.getState().feedNonce + 1); }
    };
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [setFeedNonce]);
}

export default useHomeFeed;
