/**
 * viewsSmoke.test.jsx — render real de las vistas extraídas de App.jsx.
 *
 * Sustituye (con valor de comportamiento) al test de regex que verificaba
 * "los módulos extraídos importan los símbolos que usan": renderizarlos de
 * verdad detecta cualquier ReferenceError por import faltante, que en producción
 * se manifiesta como el spinner infinito del AppErrorBoundary.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  searchAll: vi.fn(async () => ({ songs: [], albums: [], artists: [] })),
  search: vi.fn(async () => []),
  radio: vi.fn(async () => []),
  artist: vi.fn(async () => ({})),
  album: vi.fn(async () => ({})),
  streamUrl: () => 'mock://stream',
  lyrics: vi.fn(async () => ({ synced: null, plain: '' })),
}));
vi.mock('../../api.js', () => ({
  api: apiMock, isAuthed: () => true, setOnUnauthorized: () => {},
  setToken: vi.fn(), getToken: () => 't', getAuthGeneration: () => 1,
}));
vi.mock('../../offline.js', () => ({
  getBlob: vi.fn(async () => null), saveBlob: vi.fn(async () => {}),
  removeBlob: vi.fn(async () => {}), listBlobs: vi.fn(async () => []),
  getLyrics: vi.fn(async () => null), saveLyrics: vi.fn(async () => {}),
  ids: vi.fn(async () => []), init: vi.fn(async () => {}),
}));

import { DetailView } from '../DetailView.jsx';
import { HomeTab } from '../HomeTab.jsx';
import { LibraryTab } from '../LibraryTab.jsx';
import { ImportPlaylistModal } from '../../modals/ImportPlaylistModal.jsx';
import { T, makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

const noop = () => {};
const common = {
  T, play: noop, addToTarget: noop, onMenu: noop, onToggleFav: noop,
  goArtist: noop, goAlbum: noop, goMix: noop, downloadMany: noop,
  selecting: false, selection: new Set(), toggleSelect: noop, startSelection: noop,
  addToQueue: noop, removeFromQueue: noop,
};

describe('vistas extraídas — render real (sin imports faltantes)', () => {
  beforeEach(() => { resetStores(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('DetailView (álbum) renderiza sin ReferenceError', () => {
    const t = makeTrack(); seedCatalog([t]);
    render(
      <DetailView
        {...common}
        view={{ type: 'album', albumId: 'ALB1', name: 'Toxicity', artist: 'SOAD' }}
        setView={noop} detailLoading={false}
        detailData={{ type: 'album', name: 'Toxicity', artist: 'SOAD', tracks: [t], cover: t.cover }}
        saveAlbum={noop} unsaveAlbum={noop} savePlaylist={noop} unsavePlaylist={noop}
      />,
    );
    expect(screen.getByText(/Álbum/)).toBeTruthy();
    // "Toxicity" es título de álbum y de pista → varias coincidencias.
    expect(screen.getAllByText('Toxicity').length).toBeGreaterThan(0);
  });

  it('DetailView (mix) renderiza la lista embebida', () => {
    const t = makeTrack(); seedCatalog([t]);
    render(
      <DetailView
        {...common}
        view={{ type: 'mix', label: 'Mi mezcla', tracks: [t] }}
        setView={noop} detailLoading={false} detailData={null}
        saveAlbum={noop} unsaveAlbum={noop} savePlaylist={noop} unsavePlaylist={noop}
      />,
    );
    expect(screen.getByText('Mi mezcla')).toBeTruthy();
  });

  it('DetailView (artista) renderiza el estado de carga sin crash', () => {
    render(
      <DetailView
        {...common}
        view={{ type: 'artist', artistId: 'ART1', name: 'SOAD' }}
        setView={noop} detailLoading={true} detailData={null}
        saveAlbum={noop} unsaveAlbum={noop} savePlaylist={noop} unsavePlaylist={noop}
      />,
    );
    expect(screen.getByText('SOAD')).toBeTruthy();
  });

  it('HomeTab renderiza el saludo (incluye Avatar: import verificado en runtime)', () => {
    render(
      <HomeTab
        {...common} displayName="Tester" avatar="" email="a@b.c" setTab={noop}
        startAiDj={noop} onboardPrefs={[]} setOnboardPrefs={noop} backendDown={false}
      />,
    );
    expect(screen.getByText(/Buenos días|Buenas tardes|Buenas noches/)).toBeTruthy();
  });

  it('HomeTab en modo sin conexión muestra el aviso de backend caído', () => {
    render(
      <HomeTab
        {...common} displayName="Tester" avatar="" email="a@b.c" setTab={noop}
        startAiDj={noop} onboardPrefs={[]} setOnboardPrefs={noop} backendDown={true}
      />,
    );
    expect(screen.getByText(/Sin conexión al servidor/i)).toBeTruthy();
  });

  it('LibraryTab renderiza la biblioteca vacía sin crash', () => {
    render(
      <LibraryTab
        {...common} openPlaylist={null} setOpenPlaylist={noop} setShowImport={noop}
        hydrateTracks={noop} createPlaylist={noop} removeFromPlaylist={noop}
        deletePlaylist={noop} savePlaylist={noop} unsavePlaylist={noop}
      />,
    );
    expect(screen.getByText('Tu Biblioteca')).toBeTruthy();
  });

  it('ImportPlaylistModal renderiza y expone el bookmarklet importado', async () => {
    render(<ImportPlaylistModal onClose={noop} onImport={noop} onImportText={noop} T={T} />);
    // El modal usa SPOTIFY_BOOKMARKLET desde import/parsePlaylist.js: si el
    // import faltara, el render lanzaría ReferenceError.
    await waitFor(() => expect(document.querySelector('div')).toBeTruthy());
  });
});

describe('AppErrorBoundary — comportamiento', () => {
  afterEach(cleanup);

  it('captura el error, ofrece Reintentar y NO recarga automáticamente', async () => {
    const { AppErrorBoundary } = await import('../../App.jsx');
    const reload = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, reload } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // El throw es intencional: jsdom/React lo re-emiten como 'error' de window y
    // vitest lo contaría como fallo no controlado del run. Se silencia sólo aquí.
    const swallow = (e) => { e.preventDefault(); };
    window.addEventListener('error', swallow);

    const Boom = () => { throw new Error('boom de prueba'); };
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);

    expect(screen.getByText(/Algo salió mal/i)).toBeTruthy();
    expect(screen.getByText(/boom de prueba/)).toBeTruthy();
    const btn = screen.getByText(/Reintentar/i);
    // Regresión: no debe existir recarga automática (síntoma de carga infinita).
    expect(reload).not.toHaveBeenCalled();
    // La recarga es SIEMPRE por acción explícita del usuario.
    fireEvent.click(btn);
    expect(reload).toHaveBeenCalledTimes(1);

    window.removeEventListener('error', swallow);
    spy.mockRestore();
    Object.defineProperty(window, 'location', { configurable: true, value: orig });
  });
});
