/**
 * Sidebar — tests de comportamiento de la navegación de escritorio.
 * Fija: render de la navegación y playlists, cambio de pestaña limpiando la
 * vista de detalle, y el caso "sin playlists" sin crash.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Sidebar } from '../Sidebar.jsx';
import { Icon } from '../../Icons.jsx';
import { T } from '../../__tests__/uiFixtures.js';

const NAV = [
  { id: 'home', label: 'Inicio', I: Icon.Home },
  { id: 'search', label: 'Explorar', I: Icon.Search },
  { id: 'library', label: 'Biblioteca', I: Icon.List },
  { id: 'profile', label: 'Yo', I: Icon.User },
];

function setup(over = {}) {
  const props = {
    tab: 'home', setTab: vi.fn(), nav: NAV, T,
    playlists: [{ id: 'p1', name: 'Rock', trackIds: [] }],
    setOpenPlaylist: vi.fn(), setView: vi.fn(),
    ...over,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe('Sidebar', () => {
  afterEach(cleanup);

  it('renderiza la marca y todos los elementos de navegación', () => {
    setup();
    expect(screen.getByText('MUSIC')).toBeTruthy();
    for (const n of NAV) expect(screen.getByText(n.label)).toBeTruthy();
  });

  it('cambiar de pestaña limpia la vista de detalle', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Explorar'));
    expect(p.setTab).toHaveBeenCalledWith('search');
    expect(p.setView).toHaveBeenCalledWith(null);
  });

  it('ir a Biblioteca cierra la playlist abierta', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Biblioteca'));
    expect(p.setTab).toHaveBeenCalledWith('library');
    expect(p.setOpenPlaylist).toHaveBeenCalledWith(null);
  });

  it('"Me gusta" abre la playlist especial liked en la biblioteca', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Me gusta'));
    expect(p.setTab).toHaveBeenCalledWith('library');
    expect(p.setOpenPlaylist).toHaveBeenCalledWith('liked');
  });

  it('pulsar una playlist del usuario la abre por id', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Rock'));
    expect(p.setOpenPlaylist).toHaveBeenCalledWith('p1');
  });

  it('"Tu perfil" navega a la pestaña de perfil', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Tu perfil'));
    expect(p.setTab).toHaveBeenCalledWith('profile');
  });

  it('sin playlists renderiza igual (estado vacío sin crash)', () => {
    setup({ playlists: [] });
    expect(screen.getByText('Me gusta')).toBeTruthy();
  });
});
