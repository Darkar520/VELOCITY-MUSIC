/**
 * TrackMenu — tests de comportamiento del menú de 3 puntos.
 * Fija: no renderiza sin pista (ni con id desconocido), acciones principales,
 * etiqueta de fav según estado, alternancia descargar/eliminar descarga y la
 * entrada condicional "Ir a la playlist" (sólo para la pista en reproducción).
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrackMenu } from '../TrackMenu.jsx';
import { usePlayerStore } from '../../store/playerStore.js';
import { useLibraryStore } from '../../store/libraryStore.js';
import { T, makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

function setup(over = {}) {
  const props = {
    trackId: 't1', onClose: vi.fn(), T,
    addToTarget: vi.fn(), onToggleFav: vi.fn(), goArtist: vi.fn(), goAlbum: vi.fn(),
    shareTrack: vi.fn(), addToQueue: vi.fn(), download: vi.fn(), removeDownload: vi.fn(),
    playingFrom: null, goToPlayingPlaylist: vi.fn(),
    ...over,
  };
  render(<TrackMenu {...props} />);
  return props;
}

describe('TrackMenu', () => {
  beforeEach(() => { resetStores(); seedCatalog([makeTrack()]); });
  afterEach(cleanup);

  it('sin trackId no renderiza nada', () => {
    const { container } = render(<TrackMenu trackId={null} onClose={() => {}} T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('con un id desconocido no renderiza (no crashea)', () => {
    const { container } = render(<TrackMenu trackId="___nope___" onClose={() => {}} T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('muestra título y artista de la pista', () => {
    setup();
    expect(screen.getByText('Toxicity')).toBeTruthy();
    expect(screen.getByText(/System of a Down/)).toBeTruthy();
  });

  it('"Añadir a la cola" encola y cierra el menú', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Añadir a la cola'));
    expect(p.addToQueue).toHaveBeenCalledWith('t1');
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('"Ir al álbum" y "Ir al artista" navegan con los metadatos de la pista', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Ir al álbum'));
    expect(p.goAlbum).toHaveBeenCalledWith('ALB1', 'Toxicity', 'System of a Down', 'Toxicity', expect.any(String));
    cleanup();
    const p2 = setup();
    fireEvent.click(screen.getByText('Ir al artista'));
    expect(p2.goArtist).toHaveBeenCalledWith('ART1', 'System of a Down');
  });

  it('la etiqueta de fav depende del estado en libraryStore', () => {
    setup();
    expect(screen.getByText('Añadir a Me gusta')).toBeTruthy();
    cleanup();
    useLibraryStore.setState({ favs: ['t1'] });
    setup();
    expect(screen.getByText('Quitar de Me gusta')).toBeTruthy();
  });

  it('alterna entre Descargar y Eliminar descarga según downloaded', () => {
    setup();
    expect(screen.getByText('Descargar (offline)')).toBeTruthy();
    cleanup();
    usePlayerStore.setState({ downloaded: new Set(['t1']) });
    const p = setup();
    fireEvent.click(screen.getByText('Eliminar descarga'));
    expect(p.removeDownload).toHaveBeenCalledWith('t1');
  });

  it('"Ir a la playlist" sólo aparece si la pista del menú es la que suena', () => {
    // playingFrom presente pero la pista actual es OTRA → no debe ofrecerse.
    usePlayerStore.setState({ track: makeTrack({ id: 'otra' }) });
    setup({ playingFrom: { kind: 'mix', label: 'Mix X' } });
    expect(screen.queryByText('Ir a la mezcla')).toBeNull();
    cleanup();
    // Ahora la pista actual sí es la del menú.
    usePlayerStore.setState({ track: makeTrack() });
    const p = setup({ playingFrom: { kind: 'mix', label: 'Mix X' } });
    fireEvent.click(screen.getByText('Ir a la mezcla'));
    expect(p.goToPlayingPlaylist).toHaveBeenCalledTimes(1);
  });

  it('"Compartir enlace" y "Añadir a playlist" delegan en sus callbacks', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Añadir a playlist'));
    expect(p.addToTarget).toHaveBeenCalledWith('t1');
    cleanup();
    const p2 = setup();
    fireEvent.click(screen.getByText('Compartir enlace'));
    expect(p2.shareTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });
});
