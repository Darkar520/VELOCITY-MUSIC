/**
 * offlineDurability.test.jsx — invariante del usuario: "una vez descargada, una
 * canción NO se pierde nunca".
 *
 * Cubre las dos causas reales por las que una biblioteca ya descargada volvía a
 * aparecer como no descargada:
 *   1. El almacenamiento no era persistente → el navegador podía desalojar
 *      IndexedDB entera (presión de disco en Chrome, inactividad en iOS).
 *   2. Las lecturas de mantenimiento usaban getAll(), materializando todos los
 *      blobs a la vez; el arranque tardaba tanto que `downloaded` seguía vacío y
 *      el auto-reanudado re-descargaba lo que ya estaba en disco.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stub mínimo de IndexedDB con soporte de cursor ────────────────────────────
function makeIDBStub(records) {
  const store = new Map(records.map((r) => [r.id, r]));
  const req = (resultFn) => {
    const r = { onsuccess: null, onerror: null, result: undefined };
    setTimeout(() => { r.result = resultFn(); r.onsuccess?.(); }, 0);
    return r;
  };
  const objectStore = {
    getAllKeys: () => req(() => [...store.keys()]),
    get: (id) => req(() => store.get(id)),
    put: (rec) => { store.set(rec.id, rec); return req(() => true); },
    delete: (id) => { store.delete(id); return req(() => true); },
    openCursor: () => {
      const entries = [...store.values()];
      let i = 0;
      const r = { onsuccess: null, onerror: null, result: null };
      const step = () => {
        if (i >= entries.length) { r.result = null; r.onsuccess?.(); return; }
        const value = entries[i++];
        r.result = { value, continue: () => setTimeout(step, 0) };
        r.onsuccess?.();
      };
      setTimeout(step, 0);
      return r;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = { objectStore: () => objectStore, oncomplete: null, onerror: null };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  return {
    open: () => {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
      setTimeout(() => r.onsuccess?.(), 0);
      return r;
    },
    __store: store,
  };
}

const BIG = 3 * 1024 * 1024; // 3 MB por pista, como en producción

describe('almacenamiento persistente (anti-desalojo)', () => {
  beforeEach(() => { vi.resetModules(); });

  it('solicita persistencia cuando aún no la tiene', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    const offline = await import('../offline.js');
    await expect(offline.ensurePersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalled();
  });

  it('no vuelve a pedirla si ya es persistente', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    const offline = await import('../offline.js');
    await expect(offline.ensurePersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('degrada sin lanzar si el navegador no soporta la API', async () => {
    vi.stubGlobal('navigator', {});
    const offline = await import('../offline.js');
    await expect(offline.ensurePersistentStorage()).resolves.toBe(false);
  });
});

describe('lecturas de mantenimiento sin cargar todos los blobs', () => {
  beforeEach(() => { vi.resetModules(); });

  it('listMetas devuelve la metadata de todas las pistas', async () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({
      id: 't' + i, meta: { id: 't' + i, title: 'T' + i, artist: 'A' }, blob: { size: BIG }, at: i,
    }));
    vi.stubGlobal('indexedDB', makeIDBStub(recs));
    const offline = await import('../offline.js');
    const metas = await offline.listMetas();
    expect(metas).toHaveLength(5);
    expect(metas.map((m) => m.id)).toContain('t3');
  });

  it('listMetas nunca usa getAll (evita materializar la biblioteca entera)', async () => {
    const recs = [{ id: 'a', meta: { id: 'a' }, blob: { size: BIG }, at: 0 }];
    const stub = makeIDBStub(recs);
    let getAllCalls = 0;
    vi.stubGlobal('indexedDB', {
      ...stub,
      open: () => {
        const r = stub.open();
        const origResult = r.result;
        r.result = {
          ...origResult,
          transaction: (...a) => {
            const tx = origResult.transaction(...a);
            const os = tx.objectStore();
            return { ...tx, objectStore: () => ({ ...os, getAll: () => { getAllCalls++; return os.openCursor(); } }) };
          },
        };
        return r;
      },
    });
    const offline = await import('../offline.js');
    await offline.listMetas();
    expect(getAllCalls).toBe(0);
  });

  it('pruneInvalid solo borra registros sin blob y conserva los válidos', async () => {
    const recs = [
      { id: 'ok1', meta: { id: 'ok1' }, blob: { size: BIG }, at: 1 },
      { id: 'roto', meta: { id: 'roto' }, blob: { size: 0 }, at: 2 },
      { id: 'ok2', meta: { id: 'ok2' }, blob: { size: BIG }, at: 3 },
    ];
    const stub = makeIDBStub(recs);
    vi.stubGlobal('indexedDB', stub);
    const offline = await import('../offline.js');
    const bad = await offline.pruneInvalid();
    expect(bad).toEqual(['roto']);
    // Invariante: una descarga válida NUNCA se borra en el mantenimiento.
    expect(stub.__store.has('ok1')).toBe(true);
    expect(stub.__store.has('ok2')).toBe(true);
  });

  it('downloadsInfo suma bytes y ordena por recencia', async () => {
    const recs = [
      { id: 'a', meta: { id: 'a' }, blob: { size: 1000 }, at: 10 },
      { id: 'b', meta: { id: 'b' }, blob: { size: 2000 }, at: 30 },
      { id: 'c', meta: { id: 'c' }, blob: { size: 3000 }, at: 20 },
    ];
    vi.stubGlobal('indexedDB', makeIDBStub(recs));
    const offline = await import('../offline.js');
    const info = await offline.downloadsInfo();
    expect(info.count).toBe(3);
    expect(info.bytes).toBe(6000);
    expect(info.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('listIds sigue leyendo solo claves (camino barato del arranque)', async () => {
    const recs = Array.from({ length: 120 }, (_, i) => ({
      id: 'd' + i, meta: { id: 'd' + i }, blob: { size: BIG }, at: i,
    }));
    vi.stubGlobal('indexedDB', makeIDBStub(recs));
    const offline = await import('../offline.js');
    const ids = await offline.listIds();
    expect(ids).toHaveLength(120);
  });
});
