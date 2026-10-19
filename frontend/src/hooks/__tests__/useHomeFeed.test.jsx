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
  getToken: () => '',
}));

import { useHomeFeed } from '../useHomeFeed.js';
import { useLibraryStore } from '../../store/libraryStore.js';
import { cacheTrack } from '../../catalog.js';
import { api } from '../../api.js';
import { clearFeedCache } from '../../feed/feedCache.js';
import {genreArtists} from '../../feed/tasteProfile.js';

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
  it('scroll demand fetches new artists and appends a 50-song section with new IDs', async () => {
    api.search.mockImplementation(q=>Promise.resolve(Array.from({length:10},(_,i)=>({id:`${q}-${i}`,title:`${q} song ${i}`,artist:q,cover:''}))));
    api.radio.mockImplementation(()=>Promise.resolve(Array.from({length:8},(_,artist)=>Array.from({length:10},(_,i)=>({id:`more-${artist}-${i}`,title:`more ${artist} ${i}`,artist:`More ${artist}`}))).flat()));
    const rock={label:'Rock',q:'rock'};
    const props={...PROPS,onboardPrefs:{genres:[rock],artists:[]}};
    const first=renderHook(()=>useHomeFeed(props));
    await waitFor(()=>expect(useLibraryStore.getState().homeLoading).toBe(false),{timeout:10000});
    const before=useLibraryStore.getState().homeRows;
    const rockMix=before.find(r=>r.section==='El sonido que elegiste')?.mixes[0];
    expect(rockMix?.tracks).toHaveLength(50);
    expect(new Set(rockMix.tracks.map(t=>t.artist)).size).toBeGreaterThanOrEqual(10);
    const oldIds=new Set(before.flatMap(r=>r.mixes).flatMap(m=>m.tracks).map(t=>t.id));
    const later=genreArtists([rock])[11].name;
    expect(api.search.mock.calls.some(([q])=>q===later)).toBe(false);
    act(()=>window.dispatchEvent(new Event('velocity:feed-more')));
    await waitFor(()=>expect(useLibraryStore.getState().homeRows.some(r=>r.section.startsWith('Más por descubrir'))).toBe(true),{timeout:10000});
    const added=useLibraryStore.getState().homeRows.at(-1);
    expect(api.search.mock.calls.some(([q])=>q===later)).toBe(true);
    expect(added.mixes.every(m=>m.tracks.length===50)).toBe(true);
    expect(added.mixes.some(m=>m.tracks.some(t=>!oldIds.has(t.id)))).toBe(true);
    first.unmount();
    const priorCalls=api.search.mock.calls.filter(([q])=>q===later).length;
    const reopened=renderHook(()=>useHomeFeed(props));
    await waitFor(()=>expect(useLibraryStore.getState().homeLoading).toBe(false),{timeout:10000});
    expect(useLibraryStore.getState().homeRows.filter(r=>r.section==='Más por descubrir 1')).toHaveLength(1);
    api.radio.mockImplementation(()=>Promise.resolve(Array.from({length:12},(_,artist)=>Array.from({length:10},(_,i)=>({id:`radio-${artist}-${i}`,title:`radio ${artist} ${i}`,artist:`Related ${artist}`}))).flat()));
    act(()=>window.dispatchEvent(new Event('velocity:feed-more')));
    expect(api.search.mock.calls.filter(([q])=>q===later)).toHaveLength(priorCalls);
    await waitFor(()=>expect(useLibraryStore.getState().homeRows.some(r=>r.section==='Más por descubrir 2')).toBe(true),{timeout:10000});
    expect(useLibraryStore.getState().homeRows.at(-1).mixes.every(m=>m.tracks.length===50)).toBe(true);
    reopened.unmount();
  });
  it('unrelated downloaded files do not become a new account taste signal', async () => {
    cacheTrack({id:'unrelated',title:'An unrelated download',artist:'Bad Bunny'});
    api.search.mockImplementation(q=>Promise.resolve([{id:q,title:q,artist:q}]));
    renderHook(()=>useHomeFeed({...PROPS,downloaded:new Set(['unrelated']),onboardPrefs:{genres:[{label:'Metal',q:'metal hits'}],artists:[]}}));
    await waitFor(()=>expect(useLibraryStore.getState().homeRows.some(s=>s.section==='Sigue descubriendo')).toBe(true));
    expect(api.radio).not.toHaveBeenCalled();
    expect(api.search.mock.calls.some(([q])=>q.includes('Bad Bunny'))).toBe(false);
    expect(useLibraryStore.getState().homeRows.flatMap(s=>s.mixes).flatMap(m=>m.tracks).some(t=>t.artist==='Bad Bunny')).toBe(false);
  });
  it('rejects uploaders with similar names and shares a duplicate artist search', async () => {
    api.search.mockImplementation(q=>Promise.resolve([{id:q,title:q,artist:q},{id:q+'junk',title:'Compilation',artist:q+' Fan Uploads'}]));
    renderHook(()=>useHomeFeed({...PROPS,onboardPrefs:{genres:[{label:'Metal',q:'metal hits'}],artists:[{name:'Metallica'}]}}));
    await waitFor(()=>expect(useLibraryStore.getState().homeRows.some(s=>s.section==='Sigue descubriendo')).toBe(true));
    expect(api.search.mock.calls.filter(([q])=>q==='Metallica')).toHaveLength(1);
    expect(useLibraryStore.getState().homeRows.flatMap(s=>s.mixes).flatMap(m=>m.tracks).some(t=>t.artist.includes('Fan Uploads'))).toBe(false);
  });
  it('a new account receives selected genres without any listening history', async () => {
    api.search.mockImplementation(q => Promise.resolve(Array.from({length:4},(_,i)=>({id:q+i,title:`${q} song ${i}`,artist:q,cover:''}))));
    renderHook(()=>useHomeFeed({...PROPS,libReady:false,onboardPrefs:{genres:[{label:'Metal',q:'metal hits'}],artists:[]}}));
    await waitFor(()=>expect(useLibraryStore.getState().homeRows.some(s=>s.mixes.some(m=>m.label==='Metal'))).toBe(true));
  });
  it('publishes a fast artist while a different genre is still pending', async () => {
    api.search.mockImplementation(q => q==='slow genre'?new Promise(()=>{}):Promise.resolve([{id:'fast',title:'Fast song',artist:q}]));
    renderHook(()=>useHomeFeed({...PROPS,onboardPrefs:{genres:[{label:'Slow',q:'slow genre'}],artists:[{name:'Deftones'}]}}));
    await waitFor(()=>expect(useLibraryStore.getState().homeRows[0]?.mixes[0]?.label).toBe('Deftones'));
    expect(useLibraryStore.getState().homeLoading).toBe(false);
  });
  it('an artist-only preference change regenerates recommendations and rejects late old results', async () => {
    let finishOld;
    api.search.mockImplementation(q=>q==='Old artist'?new Promise(r=>{finishOld=r;}):Promise.resolve([{id:q,title:q,artist:q}])) ;
    const {rerender}=renderHook(p=>useHomeFeed(p),{initialProps:{...PROPS,onboardPrefs:{genres:[],artists:[{name:'Old artist'}]}}});
    await waitFor(()=>expect(typeof finishOld).toBe('function'));
    rerender({...PROPS,onboardPrefs:{genres:[],artists:[{name:'New artist'}]}});
    await waitFor(()=>expect(useLibraryStore.getState().homeRows[0]?.mixes[0]?.label).toBe('New artist'));
    await act(async()=>finishOld([{id:'old',title:'Old',artist:'Old artist'}]));
    expect(useLibraryStore.getState().homeRows.flatMap(s=>s.mixes).some(m=>m.label==='Old artist')).toBe(false);
  });
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
