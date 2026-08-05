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

  it('listMetas devuelve la metadata de todas las pistas (fallback sobre tracks)', async () => {
    // Sin store `meta` (biblioteca previa a v3): recorre `tracks` con cursor.
    const recs = Array.from({ length: 5 }, (_, i) => ({
      id: 't' + i, meta: { id: 't' + i, title: 'T' + i, artist: 'A' }, blob: { size: BIG }, at: i,
    }));
    vi.stubGlobal('indexedDB', makeIDBStub(recs));
    const offline = await import('../offline.js');
    const metas = await offline.listMetas();
    expect(metas).toHaveLength(5);
    expect(metas.map((m) => m.id)).toContain('t3');
  });

  it('el recorrido de tracks usa cursor, nunca getAll (no materializa los blobs)', async () => {
    // Invariante que importa: getAll sobre `tracks` cargaría TODOS los blobs.
    // Sobre el store ligero `meta` sí es correcto usarlo (son unos KB).
    const recs = [{ id: 'a', meta: { id: 'a' }, blob: { size: BIG }, at: 0 }];
    const stub = makeIDBStub(recs);
    let tracksGetAll = 0;
    vi.stubGlobal('indexedDB', {
      ...stub,
      open: () => {
        const r = stub.open();
        const orig = r.result;
        r.result = {
          ...orig,
          objectStoreNames: { contains: (n) => n === 'tracks' || n === 'lyrics' }, // sin `meta`
          transaction: (...a) => {
            const tx = orig.transaction(...a);
            const os = tx.objectStore();
            return { ...tx, objectStore: () => ({ ...os, getAll: () => { tracksGetAll++; return os.openCursor(); } }) };
          },
        };
        return r;
      },
    });
    const offline = await import('../offline.js');
    await offline.listMetas();
    expect(tracksGetAll).toBe(0);
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

// ── v3: integridad, cuota y store de metadatos separado ─────────────────────
function makeIDBStubV3(records, metaRecords = [], opts = {}) {
  const tracks = new Map(records.map((r) => [r.id, r]));
  const meta = new Map(metaRecords.map((r) => [r.id, r]));
  const maps = { tracks, meta };
  const req = (resultFn) => {
    const r = { onsuccess: null, onerror: null, result: undefined };
    setTimeout(() => { r.result = resultFn(); r.onsuccess?.(); }, 0);
    return r;
  };
  const mkStore = (name) => ({
    getAll: () => req(() => [...maps[name].values()]),
    getAllKeys: () => req(() => [...maps[name].keys()]),
    get: (id) => req(() => maps[name].get(id)),
    put: (rec) => { if (!opts.quota) maps[name].set(rec.id, rec); return req(() => true); },
    delete: (id) => { maps[name].delete(id); return req(() => true); },
    clear: () => { maps[name].clear(); return req(() => true); },
    openCursor: () => {
      const entries = [...maps[name].values()];
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
  });
  const db = {
    objectStoreNames: { contains: (n) => n === 'tracks' || n === 'meta' || n === 'lyrics' },
    transaction: () => {
      const tx = { objectStore: (n) => mkStore(n), oncomplete: null, onerror: null, onabort: null, error: opts.quota ? { name: 'QuotaExceededError' } : null };
      setTimeout(() => { if (opts.quota) tx.onerror?.(); else tx.oncomplete?.(); }, 0);
      return tx;
    },
  };
  return {
    open: () => {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
      setTimeout(() => r.onsuccess?.(), 0);
      return r;
    },
    __tracks: tracks,
    __meta: meta,
  };
}

describe('integridad del audio guardado', () => {
  beforeEach(() => { vi.resetModules(); });

  it('getBlob devuelve null si el blob está truncado (tamaño != registrado)', async () => {
    const recs = [{ id: 'trunc', meta: { id: 'trunc' }, blob: { size: 1000 }, size: 5000, at: 1 }];
    vi.stubGlobal('indexedDB', makeIDBStubV3(recs));
    const offline = await import('../offline.js');
    // Truncada → se trata como NO descargada y se vuelve a bajar, en vez de
    // reproducir audio cortado.
    await expect(offline.getBlob('trunc')).resolves.toBeNull();
  });

  it('getBlob devuelve el blob cuando el tamaño coincide', async () => {
    const recs = [{ id: 'ok', meta: { id: 'ok' }, blob: { size: 5000 }, size: 5000, at: 1 }];
    vi.stubGlobal('indexedDB', makeIDBStubV3(recs));
    const offline = await import('../offline.js');
    await expect(offline.getBlob('ok')).resolves.toEqual({ size: 5000 });
  });

  it('getBlob tolera registros antiguos sin campo size', async () => {
    const recs = [{ id: 'legacy', meta: { id: 'legacy' }, blob: { size: 4242 }, at: 1 }];
    vi.stubGlobal('indexedDB', makeIDBStubV3(recs));
    const offline = await import('../offline.js');
    await expect(offline.getBlob('legacy')).resolves.toEqual({ size: 4242 });
  });

  it('pruneInvalid borra los truncados y conserva los íntegros', async () => {
    const recs = [
      { id: 'bien', meta: { id: 'bien' }, blob: { size: 900 }, size: 900, at: 1 },
      { id: 'trunc', meta: { id: 'trunc' }, blob: { size: 100 }, size: 900, at: 2 },
    ];
    const stub = makeIDBStubV3(recs);
    vi.stubGlobal('indexedDB', stub);
    const offline = await import('../offline.js');
    await expect(offline.pruneInvalid()).resolves.toEqual(['trunc']);
    expect(stub.__tracks.has('bien')).toBe(true);
  });
});

describe('cuota agotada', () => {
  beforeEach(() => { vi.resetModules(); });

  it('saveTrack lanza QuotaError para que el lote pare', async () => {
    vi.stubGlobal('indexedDB', makeIDBStubV3([], [], { quota: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const offline = await import('../offline.js');
    await expect(offline.saveTrack({ id: 'x', cover: '' }, { size: 10, type: 'audio/webm' }))
      .rejects.toBeInstanceOf(offline.QuotaError);
  });

  it('saveTrack rechaza un blob vacío (no registra descargas fantasma)', async () => {
    vi.stubGlobal('indexedDB', makeIDBStubV3([]));
    const offline = await import('../offline.js');
    await expect(offline.saveTrack({ id: 'y', cover: '' }, { size: 0 })).rejects.toThrow();
  });
});

describe('store de metadatos separado (v3)', () => {
  beforeEach(() => { vi.resetModules(); });

  it('listMetas usa el store ligero cuando ya está poblado', async () => {
    const metaRecs = [{ id: 'm1', meta: { id: 'm1', title: 'Rápido' }, at: 1, size: 10, type: '' }];
    // `tracks` tiene otra cosa: si leyera de ahí, el título no coincidiría.
    const trackRecs = [{ id: 'zz', meta: { id: 'zz', title: 'Lento' }, blob: { size: 999 }, at: 1 }];
    vi.stubGlobal('indexedDB', makeIDBStubV3(trackRecs, metaRecs));
    const offline = await import('../offline.js');
    const metas = await offline.listMetas();
    expect(metas).toHaveLength(1);
    expect(metas[0].title).toBe('Rápido');
  });

  it('migra desde tracks cuando el store de metadatos está vacío, sin perder nada', async () => {
    const trackRecs = [
      { id: 'a', meta: { id: 'a', title: 'A' }, blob: { size: 111 }, at: 1 },
      { id: 'b', meta: { id: 'b', title: 'B' }, blob: { size: 222 }, at: 2 },
    ];
    const stub = makeIDBStubV3(trackRecs, []);
    vi.stubGlobal('indexedDB', stub);
    const offline = await import('../offline.js');
    const metas = await offline.listMetas();
    expect(metas.map((m) => m.id).sort()).toEqual(['a', 'b']);
    // El audio original sigue intacto: la migración es aditiva.
    expect(stub.__tracks.size).toBe(2);
  });

  it('deleteTrack limpia los dos stores (nada de descargas fantasma)', async () => {
    const stub = makeIDBStubV3(
      [{ id: 'g', meta: { id: 'g' }, blob: { size: 5 }, size: 5, at: 1 }],
      [{ id: 'g', meta: { id: 'g' }, at: 1, size: 5, type: '' }],
    );
    vi.stubGlobal('indexedDB', stub);
    const offline = await import('../offline.js');
    await offline.deleteTrack('g');
    expect(stub.__tracks.has('g')).toBe(false);
    expect(stub.__meta.has('g')).toBe(false);
  });

  it('deleteAll vacía audio y metadatos', async () => {
    const stub = makeIDBStubV3(
      [{ id: 'h', meta: { id: 'h' }, blob: { size: 5 }, size: 5, at: 1 }],
      [{ id: 'h', meta: { id: 'h' }, at: 1, size: 5, type: '' }],
    );
    vi.stubGlobal('indexedDB', stub);
    const offline = await import('../offline.js');
    await offline.deleteAll();
    expect(stub.__tracks.size).toBe(0);
    expect(stub.__meta.size).toBe(0);
  });
});
