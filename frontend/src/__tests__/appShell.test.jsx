/**
 * appShell.test.jsx — tests de COMPORTAMIENTO del shell (App).
 *
 * Estos tests son la red de seguridad del troceado de App.jsx: fijan los cuatro
 * flujos críticos que hoy viven en handlers/efectos inline y que se van a mover
 * a hooks SIN cambiar comportamiento:
 *   1. play → el <audio> recibe una URL FIRMADA y se llama audio.play()
 *   2. error de media → ladder de reintentos (400/900/1800/3500/7000/12000 ms)
 *      y, agotado, salto a la siguiente pista con anti-cascada
 *   3. resume desde la posición guardada (sessionPosition)
 *   4. logout → limpieza de token/estado
 *
 * Se mockea api y offline; el <audio> de jsdom no reproduce, así que play() se
 * espía sobre HTMLMediaElement.prototype.
 */
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── URL firmada que devuelve el mock de firma ─────────────────────────────
const SIGNED = '/api/stream-proxy?artist=A&title=B&id=t1&quality=high&exp=9999999999&sig=SIG';

// vi.mock se iza al principio del módulo: el mock debe crearse con vi.hoisted.
const apiMock = vi.hoisted(() => ({
  // auth / perfil
  me: vi.fn(async () => ({ displayName: 'Tester', avatar: '', email: 'a@b.c' })),
  updateProfile: vi.fn(async (p) => p),
  logout: vi.fn(async () => {}),
  pingBackend: vi.fn(async () => true),
  // biblioteca
  favorites: vi.fn(async () => []),
  playlists: vi.fn(async () => []),
  history: vi.fn(async () => []),
  savedAlbums: vi.fn(async () => []),
  savedPlaylists: vi.fn(async () => []),
  getTracks: vi.fn(async () => []),
  saveTracks: vi.fn(async () => {}),
  playlistTracks: vi.fn(async () => []),
  savePlayStats: vi.fn(async () => {}),
  // catálogo
  search: vi.fn(async () => []),
  searchAll: vi.fn(async () => ({ songs: [], albums: [], artists: [] })),
  radio: vi.fn(async () => []),
  artist: vi.fn(async () => ({})),
  album: vi.fn(async () => ({})),
  // streaming
  streamUrl: vi.fn(() => '/api/stream-proxy?unsigned=1'),
  peekStreamUrl: vi.fn(() => null),
  ensureStreamUrl: vi.fn(async () => SIGNED),
  warmStreamUrl: vi.fn(() => {}),
  prefetchStream: vi.fn(async () => {}),
  _streamSignCache: { clear: vi.fn(), delete: vi.fn() },
  _streamSignKey: vi.fn(() => 'k'),
  // telemetría
  recordHistory: vi.fn(async () => {}),
  updateNowPlaying: vi.fn(async () => {}),
  reportPlaybackError: vi.fn(async () => {}),
  sessionStart: vi.fn(async () => {}),
  sessionEnd: vi.fn(async () => {}),
  addFavorite: vi.fn(async () => {}),
  removeFavorite: vi.fn(async () => {}),
}));

vi.mock('../api.js', () => ({
  api: apiMock,
  isAuthed: () => true,
  setOnUnauthorized: () => {},
  setToken: vi.fn(),
  getToken: () => 'tok',
  getAuthGeneration: () => 1,
}));

vi.mock('../offline.js', () => ({
  getBlob: vi.fn(async () => null),
  saveBlob: vi.fn(async () => {}),
  removeBlob: vi.fn(async () => {}),
  listBlobs: vi.fn(async () => []),
  getLyrics: vi.fn(async () => null),
  saveLyrics: vi.fn(async () => {}),
  ids: vi.fn(async () => []),
  init: vi.fn(async () => {}),
}));

// El feed hace fan-out de red; irrelevante para estos flujos.
vi.mock('../hooks/useHomeFeed.js', () => ({ useHomeFeed: () => {}, default: () => {} }));

import App from '../App.jsx';
import { usePlayerStore } from '../store/playerStore.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { cacheTrack } from '../catalog.js';
import { makeTrack } from './uiFixtures.js';

let playSpy;

function seedTracks() {
  const a = makeTrack({ id: 't1', title: 'Toxicity', artist: 'SOAD' });
  const b = makeTrack({ id: 't2', title: 'Aerials', artist: 'SOAD' });
  cacheTrack(a); cacheTrack(b);
  return { a, b };
}

/** El <audio> principal es el primero del árbol (los otros 2 son pre-buffer). */
function mainAudio(container) {
  return container.querySelector('audio');
}

describe('App shell — flujos críticos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.ensureStreamUrl.mockResolvedValue(SIGNED);
    apiMock.peekStreamUrl.mockReturnValue(null);
    useLibraryStore.getState().reset();
    usePlayerStore.setState({
      track: null, playing: false, time: 0, duration: 0, queue: [],
      loadingAudio: false, playSrc: null, downloaded: new Set(), downloading: new Set(),
    });
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => {
    // Restaurar timers SIEMPRE: si un test con fake timers falla antes de su
    // useRealTimers, los siguientes se cuelgan en waitFor.
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('monta el shell autenticado sin crashear (error boundary no se activa)', async () => {
    render(<App />);
    await waitFor(() => expect(screen.queryByText(/Algo salió mal/i)).toBeNull());
    // El <audio> principal existe.
    expect(document.querySelector('audio')).toBeTruthy();
  });

  // ── FLUJO 1: play → URL firmada + audio.play() ───────────────────────────
  it('flujo play: la pista recibe una URL FIRMADA (exp+sig) y se llama play()', async () => {
    const { a } = seedTracks();
    const { container } = render(<App />);

    await act(async () => {
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });

    // La firma se pide por el camino único (ensureStreamUrl) …
    await waitFor(() => expect(apiMock.ensureStreamUrl).toHaveBeenCalled());
    // … y la URL aplicada al <audio> es la firmada (lleva exp y sig).
    await waitFor(() => {
      const src = mainAudio(container).getAttribute('src') || '';
      expect(src).toContain('exp=');
      expect(src).toContain('sig=');
    });
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it('flujo play: nunca se asigna al <audio> una URL sin firmar', async () => {
    const { a } = seedTracks();
    const { container } = render(<App />);
    await act(async () => {
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });
    await waitFor(() => expect(mainAudio(container).getAttribute('src')).toBeTruthy());
    expect(mainAudio(container).getAttribute('src')).not.toContain('unsigned=1');
  });

  // ── FLUJO 2: ladder de reintentos + anti-cascada ──────────────────────────
  it('flujo error: el primer fallo reintenta con firma fresca tras ~400ms', async () => {
    vi.useFakeTimers();
    const { a } = seedTracks();
    const { container } = render(<App />);
    await act(async () => {
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    const audio = mainAudio(container);
    // Necesita un src real para que handleAudioError no ignore el evento.
    expect(audio.getAttribute('src')).toBeTruthy();
    const callsBefore = apiMock.ensureStreamUrl.mock.calls.length;

    await act(async () => { fireEvent.error(audio); });
    // Antes del primer delay (400ms) no debe haber re-firma.
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(apiMock.ensureStreamUrl.mock.calls.length).toBe(callsBefore);
    // Pasado el primer escalón sí.
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(apiMock.ensureStreamUrl.mock.calls.length).toBeGreaterThan(callsBefore);
  }, 20000);

  it('flujo error: agotados los 6 reintentos salta a la siguiente pista de la cola', async () => {
    vi.useFakeTimers();
    const { a, b } = seedTracks();
    const { container } = render(<App />);
    await act(async () => {
      usePlayerStore.setState({ queue: [a.id, b.id] });
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const audio = mainAudio(container);
    expect(audio.getAttribute('src')).toBeTruthy();

    // 6 escalones del ladder: 400, 900, 1800, 3500, 7000, 12000.
    const DELAYS = [400, 900, 1800, 3500, 7000, 12000];
    for (const d of DELAYS) {
      await act(async () => { fireEvent.error(audio); });
      await act(async () => { await vi.advanceTimersByTimeAsync(d + 50); });
    }
    // 7º error: se agota el ladder → salto (tras 1s) a la siguiente pista.
    await act(async () => { fireEvent.error(audio); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });

    // Aserción síncrona: bajo fake timers waitFor no avanza el reloj.
    expect(usePlayerStore.getState().track?.id).toBe(b.id);
  }, 20000);

  it('flujo error: sin src real el error se ignora (cambio de pista, no cuenta como fallo)', async () => {
    const { container } = render(<App />);
    const audio = mainAudio(container);
    expect(audio.getAttribute('src')).toBeFalsy();
    // No debe lanzar ni pedir firma.
    await act(async () => { fireEvent.error(audio); });
    expect(apiMock.ensureStreamUrl).not.toHaveBeenCalled();
  });

  // ── FLUJO 3: resume desde posición guardada ──────────────────────────────
  it('flujo resume: al haber sessionPosition el <audio> salta a esa posición', async () => {
    const { a } = seedTracks();
    const { container } = render(<App />);
    await act(async () => {
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });
    await waitFor(() => expect(mainAudio(container).getAttribute('src')).toBeTruthy());

    // Fijar la posición de sesión en la machine y simular metadatos listos.
    await act(async () => {
      usePlayerStore.getState().patchMachine({ sessionPosition: 42, srcStatus: 'ready' });
    });
    const audio = mainAudio(container);
    // jsdom no implementa duration/readyState: simularlos para applySessionResume.
    Object.defineProperty(audio, 'readyState', { value: 2, configurable: true });
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    let seeked = 0;
    Object.defineProperty(audio, 'currentTime', {
      get: () => seeked, set: (v) => { seeked = v; }, configurable: true,
    });

    await act(async () => { fireEvent.loadedMetadata(audio); });
    expect(seeked).toBe(42);
  });

  // ── Fin de pista: nunca espera a la red (pantalla bloqueada) ─────────────
  it('onEnded avanza a la siguiente de la cola sin llamar a la red', async () => {
    const { a, b } = seedTracks();
    const { container } = render(<App />);
    await act(async () => {
      usePlayerStore.setState({ queue: [a.id, b.id] });
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });
    await waitFor(() => expect(mainAudio(container).getAttribute('src')).toBeTruthy());

    // La red se cuelga: si onEnded esperara a radio/search, la reproducción se
    // detendría con la pantalla bloqueada. Debe avanzar igualmente.
    apiMock.radio.mockImplementation(() => new Promise(() => {}));
    apiMock.search.mockImplementation(() => new Promise(() => {}));

    await act(async () => { fireEvent.ended(mainAudio(container)); });

    await waitFor(() => expect(usePlayerStore.getState().track?.id).toBe(b.id));
  });

  it('onEnded al final de la cola sin continuación preparada detiene honestamente', async () => {
    const { a } = seedTracks();
    const { container } = render(<App />);
    await act(async () => {
      usePlayerStore.setState({ queue: [a.id] });
      usePlayerStore.getState().dispatchPolicy({ type: 'TRACK_SET', trackId: a.id, intent: 'play' });
    });
    await waitFor(() => expect(mainAudio(container).getAttribute('src')).toBeTruthy());

    await act(async () => { fireEvent.ended(mainAudio(container)); });
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(false));
  });

  // ── FLUJO 4: logout → limpieza ──────────────────────────────────────────
  it('flujo logout: cierra sesión, resetea la biblioteca y limpia el perfil local', async () => {
    // window.location.reload no existe en jsdom: se sustituye para poder asertar.
    const reload = vi.fn();
    const origLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...origLocation, reload, href: origLocation.href },
    });
    localStorage.setItem('velocity.email', 'a@b.c');
    localStorage.setItem('velocity.name', 'Tester');

    render(<App />);
    // Ir a la pestaña de perfil (en jsdom innerWidth=1024 → layout desktop con
    // Sidebar, cuyos elementos se identifican por texto) y pulsar "Cerrar sesión".
    await act(async () => { fireEvent.click(screen.getByText('Perfil')); });
    const matches = await screen.findAllByText(/Cerrar sesión/i);
    const btn = matches.find((el) => el.closest('button'))?.closest('button') || matches[0];
    await act(async () => {
      useLibraryStore.getState().setFavs(['t1', 't2']);
      fireEvent.click(btn);
    });

    expect(apiMock.logout).toHaveBeenCalled();
    expect(apiMock.sessionEnd).toHaveBeenCalled();
    expect(useLibraryStore.getState().favs).toEqual([]);
    expect(localStorage.getItem('velocity.email')).toBeNull();
    expect(localStorage.getItem('velocity.name')).toBeNull();
    expect(reload).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: origLocation });
  });
});
