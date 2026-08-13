/**
 * useHomeFeed.test.jsx — Regresión feed: primer pintado rápido, aislamiento de
 * sección y desbloqueo de loading (nunca spinner indefinido).
 *
 * api mockeada (radio/search) para controlar la red; fake timers para el safety
 * unlock.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    radio: vi.fn(() => Promise.resolve([])),
    search: vi.fn(() => Promise.resolve([])),
    searchAll: vi.fn(() => Promise.resolve({ songs: [], albums: [], artists: [] })),
    streamUrl: () => 'mock://stream',
  },
  isAuthed: () => true,
}));

import { useHomeFeed } from '../useHomeFeed.js';
import { useLibraryStore } from '../../store/libraryStore.js';
import { cacheTrack } from '../../catalog.js';
import { api } from '../../api.js';
import { clearFeedCache } from '../../feed/feedCache.js';

function seedRecent(n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `r${i}`;
    cacheTrack({ id, title: `Song ${i}`, artist: `Artist ${i % 2}`, cover: 'https://cdn/x.jpg', url: 'mock://s' });
    ids.push(id);
  }
  return ids;
}

const PROPS = { authed: true, libReady: true, downloaded: new Set(), recentSearches: [], onboardPrefs: [] };

describe('useHomeFeed', () => {
  beforeEach(() => {
    useLibraryStore.getState().reset();
    clearFeedCache();
    vi.clearAllMocks();
    api.radio.mockImplementation(() => Promise.resolve([]));
    api.search.mockImplementation(() => Promise.resolve([]));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('primera sección barata (local) se publica y desbloquea el loading sin depender de la red', async () => {
    useLibraryStore.getState().setRecent(seedRecent(24));
    renderHook(() => useHomeFeed(PROPS));
    await waitFor(() => {
      const s = useLibraryStore.getState();
      expect(s.homeRows.length).toBeGreaterThanOrEqual(1);
      expect(s.homeLoading).toBe(false);
    });
    // La primera sección publicada es la local de "Escuchado recientemente".
    expect(useLibraryStore.getState().homeRows[0].section).toMatch(/reciente/i);
  });

  it('aislamiento: si la radio de red falla, las secciones locales siguen apareciendo y el loading se desbloquea', async () => {
    api.radio.mockImplementation(() => Promise.reject(new Error('tunnel 502')));
    api.search.mockImplementation(() => Promise.reject(new Error('tunnel 502')));
    useLibraryStore.getState().setRecent(seedRecent(24));
    renderHook(() => useHomeFeed(PROPS));
    await waitFor(() => {
      const s = useLibraryStore.getState();
      expect(s.homeRows.length).toBeGreaterThanOrEqual(1);
      expect(s.homeLoading).toBe(false);
    });
  });

  it('safety unlock: sin datos locales y con la red colgada, el loading se desbloquea en ≤30s', async () => {
    vi.useFakeTimers();
    // Red que nunca resuelve → el feed se apoyaría solo en el safety timer.
    api.radio.mockImplementation(() => new Promise(() => {}));
    api.search.mockImplementation(() => new Promise(() => {}));
    renderHook(() => useHomeFeed(PROPS));
    expect(useLibraryStore.getState().homeLoading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(useLibraryStore.getState().homeLoading).toBe(false);
  });

  it('modo offline: feed 100% local sin llamadas de red, incluso con biblioteca pequeña', async () => {
    // Biblioteca pequeña (12 tracks): con el umbral relajado (4) las secciones
    // locales SIEMPRE aparecen offline; antes se filtraban mixes < 10 tracks y
    // el feed desaparecía.
    useLibraryStore.getState().setRecent(seedRecent(12));
    renderHook(() => useHomeFeed({ ...PROPS, offline: true }));
    await waitFor(() => {
      const s = useLibraryStore.getState();
      expect(s.homeRows.length).toBeGreaterThanOrEqual(1);
      expect(s.homeLoading).toBe(false);
    });
    expect(useLibraryStore.getState().homeRows[0].section).toMatch(/reciente/i);
    // Sin red: jamás se llama a la API.
    expect(api.radio).not.toHaveBeenCalled();
    expect(api.search).not.toHaveBeenCalled();
  });

  it('modo offline con descargas: sección "Listas para offline" presente sin red', async () => {
    const dl = [];
    for (let i = 0; i < 8; i++) {
      const id = `dl${i}`;
      cacheTrack({ id, title: `Off ${i}`, artist: `Art ${i % 2}`, cover: 'https://cdn/y.jpg', url: 'mock://dl' });
      dl.push(id);
    }
    useLibraryStore.getState().setRecent(seedRecent(10));
    renderHook(() => useHomeFeed({ ...PROPS, downloaded: new Set(dl), offline: true }));
    await waitFor(() => expect(useLibraryStore.getState().homeLoading).toBe(false));
    const sections = useLibraryStore.getState().homeRows.map((s) => s.section);
    expect(sections.some((s) => /offline/i.test(s))).toBe(true);
    expect(api.radio).not.toHaveBeenCalled();
  });
});
