/**
 * AddToPlaylistModal — tests de comportamiento del modal "Añadir a playlist".
 * Fija: no renderiza sin objetivo, estado vacío de playlists, alta/baja por
 * playlist, modo multi-selección y creación de playlist nueva.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AddToPlaylistModal } from '../AddToPlaylistModal.jsx';
import { T, makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

function setup(over = {}) {
  const props = {
    trackId: 't1', onClose: vi.fn(),
    playlists: [{ id: 'p1', name: 'Rock', trackIds: [] }],
    createPlaylist: vi.fn(async () => 'pNew'),
    addToPlaylist: vi.fn(), removeFromPlaylist: vi.fn(), T,
    ...over,
  };
  render(<AddToPlaylistModal {...props} />);
  return props;
}

describe('AddToPlaylistModal', () => {
  beforeEach(() => { resetStores(); seedCatalog([makeTrack(), makeTrack({ id: 't2', title: 'Aerials' })]); });
  afterEach(cleanup);

  it('sin objetivo (trackId null) no renderiza nada', () => {
    const { container } = render(<AddToPlaylistModal trackId={null} onClose={() => {}} playlists={[]} T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('con selección vacía (array) no renderiza nada', () => {
    const { container } = render(<AddToPlaylistModal trackId={[]} onClose={() => {}} playlists={[]} T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('muestra título y artista de la pista objetivo', () => {
    setup();
    expect(screen.getByText(/Toxicity · System of a Down/)).toBeTruthy();
  });

  it('sin playlists muestra el estado vacío', () => {
    setup({ playlists: [] });
    expect(screen.getByText(/Aún no tienes playlists/i)).toBeTruthy();
  });

  it('pulsar una playlist añade la pista', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Rock'));
    expect(p.addToPlaylist).toHaveBeenCalledWith('p1', 't1');
  });

  it('si la pista ya está en la playlist, pulsar la quita', () => {
    const p = setup({ playlists: [{ id: 'p1', name: 'Rock', trackIds: ['t1'] }] });
    fireEvent.click(screen.getByText('Rock'));
    expect(p.removeFromPlaylist).toHaveBeenCalledWith('p1', 't1');
    expect(p.addToPlaylist).not.toHaveBeenCalled();
  });

  it('modo multi: indica el número de canciones y añade todas', () => {
    const p = setup({ trackId: ['t1', 't2'] });
    expect(screen.getByText(/2 canciones seleccionadas/)).toBeTruthy();
    fireEvent.click(screen.getByText('Rock'));
    expect(p.addToPlaylist).toHaveBeenCalledWith('p1', 't1');
    expect(p.addToPlaylist).toHaveBeenCalledWith('p1', 't2');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('crear playlist nueva la crea, añade la pista y cierra', async () => {
    const p = setup();
    fireEvent.change(screen.getByPlaceholderText('Nueva playlist…'), { target: { value: 'Metal' } });
    fireEvent.submit(screen.getByPlaceholderText('Nueva playlist…').closest('form'));
    await waitFor(() => expect(p.createPlaylist).toHaveBeenCalledWith('Metal'));
    await waitFor(() => expect(p.addToPlaylist).toHaveBeenCalledWith('pNew', 't1'));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('el botón Cerrar llama onClose', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
