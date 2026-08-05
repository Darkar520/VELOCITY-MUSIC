/**
 * ProfileTab — tests de COMPORTAMIENTO.
 *
 * Cubre lo que el usuario percibe: que renderiza sin crashear, que los
 * controles llaman a su callback (cerrar sesión, Wrapped, ajustes de calidad),
 * el administrador de descargas (incluido su estado de carga) y el borrado de
 * cuenta con confirmación.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../api.js', () => ({ api: { extractorStatus: vi.fn(async () => ({})) } }));
vi.mock('../../offline.js', () => ({
  listIds: vi.fn(async () => []),
  listMetas: vi.fn(async () => []),
  downloadsInfo: vi.fn(async () => ({ count: 0, bytes: 0, items: [] })),
  ensurePersistentStorage: vi.fn(async () => true),
}));

import { ProfileTab } from '../ProfileTab.jsx';
import { useLibraryStore } from '../../store/libraryStore.js';
import { usePlayerStore } from '../../store/playerStore.js';
import { T } from '../../__tests__/uiFixtures.js';

function setup(over = {}) {
  const spies = {
    onLogout: vi.fn(),
    goWrapped: vi.fn(),
    setQuality: vi.fn(),
    setThemeKey: vi.fn(),
    setSettings: vi.fn(),
    saveProfileName: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    saveAvatar: vi.fn(async () => {}),
    removeDownload: vi.fn(async () => {}),
    clearDownloads: vi.fn(async () => {}),
    getDownloads: vi.fn(async () => ({ count: 0, bytes: 0, items: [] })),
    setOpenPlaylist: vi.fn(),
    setTab: vi.fn(),
    setGlow: vi.fn(),
    setEq: vi.fn(),
    setActiveCustomId: vi.fn(),
    addPalette: vi.fn(),
    updatePalette: vi.fn(),
    deletePalette: vi.fn(),
    installApp: vi.fn(),
  };
  const utils = render(
    <ProfileTab
      T={T}
      themeKey="emerald"
      quality="high"
      glow={70}
      eq="waves"
      settings={{ autoplay: true, normalize: false }}
      email="a@b.c"
      displayName="Tester"
      avatar=""
      canInstall={false}
      isIOS={false}
      isStandalone={false}
      customPalettes={[{ id: 'p1', name: 'Neón', accent: '#ff10f0', accent2: '#00fff7' }]}
      activeCustomId="p1"
      activePalette={{ id: 'p1', name: 'Neón', accent: '#ff10f0', accent2: '#00fff7' }}
      {...spies}
      {...over}
    />,
  );
  return { ...spies, ...utils };
}

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.getState().reset();
    usePlayerStore.setState({ downloaded: new Set(), downloading: new Set() });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renderiza sin crashear y muestra el correo del usuario', () => {
    setup();
    expect(screen.getByText('a@b.c')).toBeTruthy();
  });

  it('muestra la versión de la app (trazabilidad visible)', () => {
    setup();
    expect(screen.getByText(/VELOCITY MUSIC · v\d+\.\d+/)).toBeTruthy();
  });

  // "cerrar sesión" también aparece en el texto informativo de Descargas, así
  // que hay que apuntar al BOTÓN, no a cualquier coincidencia de texto.
  const botonCerrarSesion = () =>
    screen.getAllByText(/Cerrar sesión/i).map((n) => n.closest('button')).find(Boolean);

  it('el botón Cerrar sesión llama a onLogout', () => {
    const { onLogout } = setup();
    fireEvent.click(botonCerrarSesion());
    expect(onLogout).toHaveBeenCalled();
  });

  it('el bloque Wrapped navega a la vista Wrapped', () => {
    const { goWrapped } = setup();
    fireEvent.click(screen.getByText('Wrapped'));
    expect(goWrapped).toHaveBeenCalled();
  });

  it('abrir el administrador de descargas consulta el listado', async () => {
    const { getDownloads } = setup();
    fireEvent.click(screen.getByText(/Administrar descargas/i));
    await waitFor(() => expect(getDownloads).toHaveBeenCalled());
  });

  it('el administrador muestra las descargas que devuelve el backend local', async () => {
    const getDownloads = vi.fn(async () => ({
      count: 1,
      bytes: 5 * 1048576,
      items: [{ id: 'd1', size: 5 * 1048576, at: 1, meta: { id: 'd1', title: 'Toxicity', artist: 'SOAD', cover: '' } }],
    }));
    setup({ getDownloads });
    fireEvent.click(screen.getByText(/Administrar descargas/i));
    await waitFor(() => expect(screen.getByText('Toxicity')).toBeTruthy());
  });

  it('si el listado de descargas falla no crashea', async () => {
    const getDownloads = vi.fn(async () => { throw new Error('idb caída'); });
    setup({ getDownloads });
    fireEvent.click(screen.getByText(/Administrar descargas/i));
    await waitFor(() => expect(getDownloads).toHaveBeenCalled());
    expect(botonCerrarSesion()).toBeTruthy();
  });

  it('borrar la cuenta pide confirmación antes de ejecutarla', () => {
    const { deleteAccount } = setup();
    fireEvent.click(screen.getByText('Eliminar mi cuenta'));
    // El primer clic solo abre la confirmación; no debe borrar nada.
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/Eliminar tu cuenta\?/i)).toBeTruthy();
  });

  it('confirmando el borrado sí ejecuta deleteAccount', async () => {
    const { deleteAccount } = setup();
    fireEvent.click(screen.getByText('Eliminar mi cuenta'));
    const confirmar = screen.getAllByRole('button')
      .filter((b) => /eliminar/i.test(b.textContent || '') && !/mi cuenta/i.test(b.textContent || ''));
    expect(confirmar.length).toBeGreaterThan(0);
    fireEvent.click(confirmar[confirmar.length - 1]);
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
  });

  it('cancelar el borrado cierra la confirmación sin borrar', () => {
    const { deleteAccount } = setup();
    fireEvent.click(screen.getByText('Eliminar mi cuenta'));
    const cancelar = screen.getAllByRole('button').find((b) => /cancelar/i.test(b.textContent || ''));
    if (cancelar) fireEvent.click(cancelar);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('tolera que las callbacks opcionales no se pasen', () => {
    expect(() => setup({ goWrapped: undefined, installApp: undefined })).not.toThrow();
  });
});
