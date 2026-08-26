import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  favorites: vi.fn(), playlists: vi.fn(), history: vi.fn(), savedAlbums: vi.fn(), savedPlaylists: vi.fn(),
  playlistTracks: vi.fn(), album: vi.fn(), getTracks: vi.fn(), saveTracks: vi.fn(),
  getToken: vi.fn(() => ''), getAuthGeneration: vi.fn(() => 0),
}));
vi.mock('../api.js', () => ({ api, getToken: api.getToken, getAuthGeneration: api.getAuthGeneration }));
vi.mock('../catalog.js', () => ({
  allCached: vi.fn(() => []), saveMeta: vi.fn(), trackById: vi.fn(() => null),
  normalizeTrack: vi.fn(), cacheTrack: vi.fn(),
}));
vi.mock('../helpers.js', () => ({ slimTrack: vi.fn((track) => track) }));
vi.mock('../offlineLibrary.js', () => ({ backfillLibraryLyrics: vi.fn() }));
vi.mock('../offline.js', () => ({ listIds: vi.fn(async () => []), listMetas: vi.fn(async () => []) }));

const { useLibrarySync } = await import('../hooks/useLibrarySync.js');
const { useLibraryStore } = await import('../store/libraryStore.js');
const offlineDb = await import('../offline.js');
const catalog = await import('../catalog.js');

beforeEach(() => {
  useLibraryStore.getState().reset();
  localStorage.clear();
  vi.clearAllMocks();
  api.favorites.mockResolvedValue([]);
  api.playlists.mockResolvedValue([]);
  api.history.mockResolvedValue([]);
  api.savedAlbums.mockResolvedValue([]);
  api.savedPlaylists.mockResolvedValue([]);
  api.playlistTracks.mockResolvedValue([]);
  api.album.mockResolvedValue({ tracks: [] });
  api.getTracks.mockResolvedValue([]);
  api.saveTracks.mockResolvedValue({});
  api.getToken.mockReturnValue('');
  api.getAuthGeneration.mockReturnValue(0);
  // Aislamiento: restaurar las implementaciones del módulo offline y del
  // catálogo (clearAllMocks borra llamadas, no implementaciones previas).
  offlineDb.listIds.mockResolvedValue([]);
  offlineDb.listMetas.mockResolvedValue([]);
  catalog.trackById.mockReturnValue(null);
});

afterEach(() => cleanup());

describe('useLibrarySync account isolation', () => {
  it('clears shared library state when authentication is lost', () => {
    useLibraryStore.setState({
      favs: ['account-a'],
      playlists: [{ id: 'p1', trackIds: ['account-a'] }],
      recent: ['account-a'],
      savedAlbums: [{ albumId: 'al1' }],
      savedPlaylists: [{ playlistId: 'mix-a' }],
    });

    renderHook(() => useLibrarySync({ authed: false, email: 'a@example.com' }));

    expect(useLibraryStore.getState()).toMatchObject({
      favs: [], playlists: [], recent: [], savedAlbums: [], savedPlaylists: [],
    });
  });

  it('resets the previous account before hydrating a new account', async () => {
    api.favorites.mockResolvedValue(null);
    localStorage.setItem('velocity.lib.b@example.com', JSON.stringify({ favs: ['account-b'] }));
    const { rerender } = renderHook(({ authed, email }) => useLibrarySync({ authed, email }), {
      initialProps: { authed: true, email: 'a@example.com' },
    });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    act(() => { useLibraryStore.getState().setFavs(['account-a']); });
    await act(async () => { rerender({ authed: false, email: 'a@example.com' }); });
    await waitFor(() => expect(useLibraryStore.getState().favs).toEqual([]));
    await act(async () => { rerender({ authed: true, email: 'b@example.com' }); });
    await waitFor(() => expect(useLibraryStore.getState().favs).toEqual(['account-b']));

    expect(useLibraryStore.getState().favs).toEqual(['account-b']);
      });

      it('offline: hidrata desde la caché local sin llamar a la red y conserva la biblioteca', async () => {
        const cached = {
          favs: ['offline-1', 'offline-2'],
          playlists: [{ id: 'p-off', name: 'Offline PL', trackIds: ['offline-1'] }],
          savedAlbums: [{ albumId: 'al-off', name: 'Album Off', trackIds: [] }],
          savedPlaylists: [{ playlistId: 'sp-off', name: 'Guardada Off', trackIds: [] }],
          recent: ['offline-1'],
          tracks: [{ id: 'offline-1', title: 'T1', artist: 'A1', cover: 'https://cdn/x.jpg' }],
        };
        localStorage.setItem('velocity.lib.a@example.com', JSON.stringify(cached));

        renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com', offline: true }));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        const s = useLibraryStore.getState();
        expect(s.favs).toEqual(['offline-1', 'offline-2']);
        expect(s.playlists).toHaveLength(1);
        expect(s.savedAlbums).toHaveLength(1);
        expect(s.savedPlaylists).toHaveLength(1);
        // Sin red: ningún fetch a la API.
        expect(api.favorites).not.toHaveBeenCalled();
        expect(api.playlists).not.toHaveBeenCalled();
        expect(api.history).not.toHaveBeenCalled();
        expect(api.savedAlbums).not.toHaveBeenCalled();
        expect(api.savedPlaylists).not.toHaveBeenCalled();
      });
    });

describe('useLibrarySync: el módulo offline no queda sombreado por el parámetro', () => {
  it('offline: incorpora los metadatos de las descargas al catálogo', async () => {
    // Regresión: el parámetro booleano `offline` sombreaba el import del
    // módulo offline.js, así que `offline.listIds()` lanzaba TypeError y el
    // catch global se lo tragaba. Las descargas nunca llegaban al catálogo.
    const { cacheTrack, saveMeta } = catalog;
    offlineDb.listMetas.mockResolvedValue([{ id: 'dl-1', title: 'Descargada', artist: 'A' }]);

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com', offline: true }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(offlineDb.listMetas).toHaveBeenCalled();
    // forEach pasa (item, index, array): comprobamos el primer argumento.
    expect(cacheTrack.mock.calls[0][0]).toEqual({ id: 'dl-1', title: 'Descargada', artist: 'A' });
    expect(saveMeta).toHaveBeenCalled();
  });

  it('online: completa el backfill de metadatos y persiste el catálogo', async () => {
    // Regresión: el TypeError abortaba todo lo que venía después, incluidos
    // api.getTracks (backfill), saveMeta() y writeLibCache(). Resultado: la
    // caché local se quedaba sin metadatos y offline no se veía nada.
    const { saveMeta } = catalog;
    api.favorites.mockResolvedValue(['fav-1']);
    api.getTracks.mockResolvedValue([{ id: 'fav-1', title: 'Favorita', artist: 'A' }]);

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));

    await waitFor(() => expect(saveMeta).toHaveBeenCalled());
    expect(offlineDb.listMetas).toHaveBeenCalled();
    // El backfill pidió los metadatos que faltaban en el catálogo.
    expect(api.getTracks).toHaveBeenCalledWith(expect.arrayContaining(['fav-1']));
    // Y la biblioteca quedó persistida para el siguiente arranque offline.
    await waitFor(() => {
      const raw = localStorage.getItem('velocity.lib.a@example.com');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw).favs).toEqual(['fav-1']);
    });
  });

  it('un fallo de playlistTracks no vacía los trackIds ya conocidos', async () => {
    // Regresión: `catch(() => [])` colapsaba "fallo de red" y "playlist vacía",
    // así que un timeout puntual vaciaba la playlist y el efecto de
    // persistencia grababa el vacío de forma permanente.
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      playlists: [{ id: 'p1', name: 'Mi PL', trackIds: ['t1', 't2'] }],
    }));
    api.playlists.mockResolvedValue([{ id: 'p1', name: 'Mi PL' }]);
    api.playlistTracks.mockRejectedValue(new Error('timeout'));

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    await waitFor(() => {
      const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'p1');
      expect(pl?.trackIds).toEqual(['t1', 't2']);
    });
  });

  it('una playlist realmente vacía sí se refleja como vacía', async () => {
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      playlists: [{ id: 'p1', name: 'Mi PL', trackIds: ['t1'] }],
    }));
    api.playlists.mockResolvedValue([{ id: 'p1', name: 'Mi PL' }]);
    api.playlistTracks.mockResolvedValue([]);

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));

    await waitFor(() => {
      const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'p1');
      expect(pl?.trackIds).toEqual([]);
    });
  });
});

describe('useLibrarySync: identidad de caché estable y caché a prueba de vaciados', () => {
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwtWithSub = (sub, sig) => [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub }), sig || 'sig'].join('.');
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it('offline sin email: hidrata desde la clave canónica derivada del sub del token', async () => {
    // Regresión (sospechoso C): sin velocity.email la identidad caía a
    // guest-<últimos 12 del token>, distinta de la clave que escribió la
    // sesión online (<email>). Offline la caché era inalcanzable y el efecto 1
    // dejaba el store vacío tras reset().
    api.getToken.mockReturnValue(jwtWithSub('acc-off'));
    localStorage.setItem('velocity.lib.u:acc-off', JSON.stringify({
      favs: ['f1', 'f2'],
      playlists: [],
      savedAlbums: [],
      savedPlaylists: [],
      recent: [],
      tracks: [],
    }));

    renderHook(() => useLibrarySync({ authed: true, email: '', offline: true }));
    await tick();

    expect(useLibraryStore.getState().favs).toEqual(['f1', 'f2']);
  });

  it('la rotación del token (misma cuenta) no pierde la biblioteca hidratada', async () => {
    api.getToken.mockReturnValue(jwtWithSub('acc-rot', 'firma-vieja'));
    localStorage.setItem('velocity.lib.u:acc-rot', JSON.stringify({
      favs: ['keep-1'], playlists: [], savedAlbums: [], savedPlaylists: [], recent: [], tracks: [],
    }));
    const { rerender } = renderHook(
      ({ offline }) => useLibrarySync({ authed: true, email: '', offline }),
      { initialProps: { offline: true } },
    );
    await tick();
    expect(useLibraryStore.getState().favs).toEqual(['keep-1']);

    // Rota el token: misma sub, firma distinta. La identidad (y la clave)
    // deben seguir siendo las mismas; un cambio de clave dispararía reset().
    api.getToken.mockReturnValue(jwtWithSub('acc-rot', 'firma-nueva'));
    await act(async () => { rerender({ offline: true }); });
    await tick();

    expect(useLibraryStore.getState().favs).toEqual(['keep-1']);
  });

  it('lee cachés legacy escritas por email y migra a la clave canónica', async () => {
    api.getToken.mockReturnValue(jwtWithSub('acc-mig'));
    localStorage.setItem('velocity.email', 'legacy@x.com');
    localStorage.setItem('velocity.lib.legacy@x.com', JSON.stringify({
      favs: ['lf1'], playlists: [], savedAlbums: [], savedPlaylists: [], recent: [], tracks: [],
    }));

    renderHook(() => useLibrarySync({ authed: true, email: '', offline: true }));
    await tick();

    expect(useLibraryStore.getState().favs).toEqual(['lf1']);
    // El primer persistido re-escribe bajo la clave canónica (migración).
    await waitFor(() => {
      const raw = localStorage.getItem('velocity.lib.u:acc-mig');
      expect(raw && JSON.parse(raw).favs).toEqual(['lf1']);
    });
  });

  it('un sync parcial no vacía en caché las colecciones sin confirmación del servidor', async () => {
    // Regresión (sospechosos A+D): respuestas vacías —o cuerpos no-JSON que
    // colapsaban a []— sobrescribían una caché buena de forma permanente.
    // Ahora, solo las colecciones cuya respuesta fue íntegra pueden quedar
    // vacías; las que fallaron conservan sus últimos datos conocidos.
    const rich = {
      favs: Array.from({ length: 286 }, (_, i) => `f${i}`),
      playlists: [{ id: 'p1', name: 'PL', trackIds: ['t1'] }],
      savedAlbums: [{ albumId: 'al1', name: 'Disco', cover: 'c.jpg', trackIds: [] }],
      savedPlaylists: [{ playlistId: 'mix1', name: 'Mix', trackIds: [] }],
      recent: ['r1'],
      tracks: [],
    };
    api.getToken.mockReturnValue(jwtWithSub('acc-guard'));
    localStorage.setItem('velocity.lib.u:acc-guard', JSON.stringify(rich));
    api.favorites.mockRejectedValue(new Error('red caída'));     // sin confirmar → protegida
    api.history.mockRejectedValue(new Error('red caída'));       // sin confirmar → protegida
    api.playlists.mockResolvedValue([]);                          // confirmada → vaciada
    api.savedAlbums.mockResolvedValue([]);                        // confirmada → vaciada
    api.savedPlaylists.mockResolvedValue([]);                     // confirmada → vaciada

    renderHook(() => useLibrarySync({ authed: true, email: '', offline: false }));
    // saveMeta() corre justo después del intento de escritura final: al haber
    // llegado ahí, el guard ya decidió sobre la caché.
    await waitFor(() => expect(catalog.saveMeta).toHaveBeenCalled());
    await tick();

    const raw = JSON.parse(localStorage.getItem('velocity.lib.u:acc-guard'));
    expect(raw.favs).toHaveLength(286);
    expect(raw.recent).toEqual(['r1']);
    expect(raw.playlists).toEqual([]);
    expect(raw.savedAlbums).toEqual([]);
    expect(raw.savedPlaylists).toEqual([]);
  });

  it('un vaciado confirmado por las cinco colecciones del servidor sí se persiste', async () => {
    api.getToken.mockReturnValue(jwtWithSub('acc-wipe'));
    localStorage.setItem('velocity.lib.u:acc-wipe', JSON.stringify({
      favs: ['f1'], playlists: [], savedAlbums: [], savedPlaylists: [], recent: [], tracks: [],
    }));
    api.favorites.mockResolvedValue([]);
    api.playlists.mockResolvedValue([]);
    api.history.mockResolvedValue([]);
    api.savedAlbums.mockResolvedValue([]);
    api.savedPlaylists.mockResolvedValue([]);

    renderHook(() => useLibrarySync({ authed: true, email: '', offline: false }));
    await waitFor(() => expect(catalog.saveMeta).toHaveBeenCalled());

    await waitFor(() => {
      const raw = JSON.parse(localStorage.getItem('velocity.lib.u:acc-wipe'));
      expect(raw.favs).toEqual([]);
    });
  });

  it('un borrado local del último favorito persiste [] sin desactivar el guard', async () => {
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      favs: ['fav-last'], playlists: [], savedAlbums: [], savedPlaylists: [], recent: [], tracks: [],
    }));

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com', offline: true }));
    await tick();
    act(() => { useLibraryStore.getState().removeFav('fav-last'); });

    await waitFor(() => {
      const raw = JSON.parse(localStorage.getItem('velocity.lib.a@example.com'));
      expect(raw.favs).toEqual([]);
    });
  });

  it('un borrado local del último álbum persiste [] sin desactivar el guard', async () => {
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      favs: [], playlists: [], savedAlbums: [{ albumId: 'album-last', name: 'Último' }],
      savedPlaylists: [], recent: [], tracks: [],
    }));

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com', offline: true }));
    await tick();
    act(() => { useLibraryStore.getState().unsaveAlbum('album-last'); });

    await waitFor(() => {
      const raw = JSON.parse(localStorage.getItem('velocity.lib.a@example.com'));
      expect(raw.savedAlbums).toEqual([]);
    });
  });

  it('los álbumes guardados se pintan sin esperar la hidratación de trackIds', async () => {
    // Regresión (sospechoso E): store.setSavedAlbums ocurría DESPUÉS de una
    // petición api.album por cada álbum; si eran lentas o fallaban, la sección
    // tardaba o no llegaba a verse incluso CON conexión.
    api.savedAlbums.mockResolvedValue([{ albumId: 'al-9', name: 'Disco Lento', cover: 'c.jpg' }]);
    api.album.mockImplementation(() => new Promise(() => {}));

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));

    await waitFor(() => {
      expect(useLibraryStore.getState().savedAlbums[0]).toMatchObject({ albumId: 'al-9', name: 'Disco Lento' });
    });
  });

  it('las playlists propias se pintan conservando trackIds locales aunque playlistTracks no resuelva', async () => {
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      favs: [],
      playlists: [{ id: 'pl-9', name: 'Nombre viejo', trackIds: ['t1', 't2'] }],
      savedAlbums: [],
      savedPlaylists: [],
      recent: [],
      tracks: [],
    }));
    api.playlists.mockResolvedValue([{ id: 'pl-9', name: 'PL renombrada' }]);
    api.playlistTracks.mockImplementation(() => new Promise(() => {}));

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));

    await waitFor(() => {
      const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'pl-9');
      expect(pl).toMatchObject({ name: 'PL renombrada' });
      expect(pl.trackIds).toEqual(['t1', 't2']);
    });
  });
});
