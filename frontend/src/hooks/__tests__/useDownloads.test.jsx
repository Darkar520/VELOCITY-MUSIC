/**
 * useDownloads — tests de COMPORTAMIENTO de las descargas offline.
 *
 * Blinda los invariantes que ya causaron incidencias en producción:
 *  - No re-descargar lo que YA está en IndexedDB (fuente de verdad), aunque el
 *    estado de React vaya por detrás por la hidratación asíncrona.
 *  - Reconciliar la cola de pendientes con el disco.
 *  - Parar el lote cuando se agota la cuota, en vez de fallar pista a pista.
 *  - Marcar como descargada solo cuando el blob está realmente guardado.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  ensureStreamUrl: vi.fn(async () => '/api/stream-proxy?exp=1&sig=x'),
  saveTracks: vi.fn(async () => {}),
  _streamSignCache: { clear: vi.fn() },
}));

const offlineMock = vi.hoisted(() => {
  class QuotaError extends Error {
    constructor(m = 'Almacenamiento lleno') { super(m); this.name = 'QuotaError'; }
  }
  return {
    saveTrack: vi.fn(async () => {}),
    listIds: vi.fn(async () => []),
    deleteTrack: vi.fn(async () => true),
    deleteAll: vi.fn(async () => true),
    downloadsInfo: vi.fn(async () => ({ count: 0, bytes: 0, items: [] })),
    ensurePersistentStorage: vi.fn(async () => true),
    QuotaError,
  };
});

vi.mock('../../api.js', () => ({ api: apiMock }));
vi.mock('../../offline.js', () => offlineMock);
vi.mock('../../offlineLibrary.js', () => ({ scheduleLibraryOfflineSync: vi.fn() }));

import { useDownloads } from '../useDownloads.js';
import { usePlayerStore } from '../../store/playerStore.js';
import { cacheTrack } from '../../catalog.js';
import { makeTrack } from '../../__tests__/uiFixtures.js';

function setup() {
  const showToast = vi.fn();
  const pendingRef = { current: new Set() };
  const savePending = vi.fn();
  const hook = renderHook(() => useDownloads({ quality: 'high', showToast, pendingRef, savePending }));
  return { ...hook, showToast, pendingRef, savePending };
}

describe('useDownloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offlineMock.listIds.mockResolvedValue([]);
    offlineMock.saveTrack.mockResolvedValue(undefined);
    apiMock.ensureStreamUrl.mockResolvedValue('/api/stream-proxy?exp=1&sig=x');
    usePlayerStore.setState({ downloaded: new Set(), downloading: new Set() });
    // fetch devuelve un blob con tamaño válido
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => ({ size: 4096, type: 'audio/webm' }) })));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('descarga una pista y la marca como descargada', async () => {
    const t = makeTrack({ id: 'x1', title: 'Toxicity', artist: 'SOAD' });
    cacheTrack(t);
    const { result } = setup();
    await act(async () => { await result.current.download(t); });
    expect(offlineMock.saveTrack).toHaveBeenCalled();
    expect(usePlayerStore.getState().downloaded.has('x1')).toBe(true);
  });

  it('no marca como descargada si guardar falla', async () => {
    offlineMock.saveTrack.mockRejectedValue(new Error('io'));
    const t = makeTrack({ id: 'x2' });
    cacheTrack(t);
    const { result, showToast } = setup();
    await act(async () => { await result.current.download(t); });
    expect(usePlayerStore.getState().downloaded.has('x2')).toBe(false);
    expect(showToast).toHaveBeenCalled();
  });

  it('avisa de cuota agotada con un mensaje claro', async () => {
    offlineMock.saveTrack.mockRejectedValue(new offlineMock.QuotaError());
    const t = makeTrack({ id: 'x3' });
    cacheTrack(t);
    const { result, showToast } = setup();
    await act(async () => { await result.current.download(t); });
    expect(showToast.mock.calls.flat().join(' ')).toMatch(/lleno/i);
  });

  it('pide almacenamiento persistente al descargar (anti-desalojo)', async () => {
    const t = makeTrack({ id: 'x4' });
    cacheTrack(t);
    const { result } = setup();
    await act(async () => { await result.current.download(t); });
    expect(offlineMock.ensurePersistentStorage).toHaveBeenCalled();
  });

  it('downloadMany NO re-descarga lo que ya está en IndexedDB', async () => {
    const a = makeTrack({ id: 'm1' }); const b = makeTrack({ id: 'm2' });
    cacheTrack(a); cacheTrack(b);
    // El disco ya tiene m1: React aún no lo refleja (hidratación asíncrona).
    offlineMock.listIds.mockResolvedValue(['m1']);
    const { result } = setup();
    await act(async () => { await result.current.downloadMany(['m1', 'm2']); });
    const guardadas = offlineMock.saveTrack.mock.calls.map((c) => c[0].id);
    expect(guardadas).not.toContain('m1');
    expect(guardadas).toContain('m2');
    // Y m1 queda reconciliada como descargada, no re-bajada.
    expect(usePlayerStore.getState().downloaded.has('m1')).toBe(true);
  });

  it('downloadMany purga de la cola pendiente lo que ya está en disco', async () => {
    const a = makeTrack({ id: 'p1' }); const b = makeTrack({ id: 'p2' });
    cacheTrack(a); cacheTrack(b);
    offlineMock.listIds.mockResolvedValue(['p1']);
    const { result, pendingRef, savePending } = setup();
    pendingRef.current = new Set(['p1', 'p2']);
    await act(async () => { await result.current.downloadMany(['p1', 'p2']); });
    expect(pendingRef.current.has('p1')).toBe(false);
    expect(savePending).toHaveBeenCalled();
  });

  it('downloadMany para el lote cuando se agota la cuota', async () => {
    const ids = ['q1', 'q2', 'q3', 'q4'];
    ids.forEach((id) => cacheTrack(makeTrack({ id })));
    offlineMock.saveTrack.mockRejectedValue(new offlineMock.QuotaError());
    const { result, showToast } = setup();
    await act(async () => { await result.current.downloadMany(ids); });
    expect(showToast.mock.calls.flat().join(' ')).toMatch(/lleno/i);
  });

  it('si todo está descargado avisa y no descarga nada', async () => {
    const a = makeTrack({ id: 'z1' });
    cacheTrack(a);
    offlineMock.listIds.mockResolvedValue(['z1']);
    const { result, showToast } = setup();
    await act(async () => { await result.current.downloadMany(['z1']); });
    expect(offlineMock.saveTrack).not.toHaveBeenCalled();
    expect(showToast.mock.calls.flat().join(' ')).toMatch(/todo/i);
  });

  it('removeDownload borra del disco y del estado', async () => {
    usePlayerStore.setState({ downloaded: new Set(['r1']) });
    const { result } = setup();
    await act(async () => { await result.current.removeDownload('r1'); });
    expect(offlineMock.deleteTrack).toHaveBeenCalledWith('r1');
    expect(usePlayerStore.getState().downloaded.has('r1')).toBe(false);
  });

  it('clearDownloads vacía disco y estado', async () => {
    usePlayerStore.setState({ downloaded: new Set(['c1', 'c2']) });
    const { result } = setup();
    await act(async () => { await result.current.clearDownloads(); });
    expect(offlineMock.deleteAll).toHaveBeenCalled();
    expect(usePlayerStore.getState().downloaded.size).toBe(0);
  });

  it('un blob vacío no se guarda como descarga válida', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => ({ size: 0, type: '' }) })));
    const t = makeTrack({ id: 'e1' });
    cacheTrack(t);
    const { result } = setup();
    await act(async () => { await result.current.download(t); });
    expect(usePlayerStore.getState().downloaded.has('e1')).toBe(false);
  });
});
