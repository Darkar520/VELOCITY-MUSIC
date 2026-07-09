import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  createPlaylistService,
  PlaylistError,
  MAX_NAME_LENGTH,
} from '../src/services/playlistService.js';
import { createFavoritesService, FavoritesError } from '../src/services/favoritesService.js';
import { createHistoryService, HistoryError } from '../src/services/historyService.js';
import {
  createMemoryPlaylistRepo,
  createMemoryFavoritesRepo,
  createMemoryHistoryRepo,
  createMemoryTrackRepo,
} from '../src/repositories/memory.js';

const RUNS = { numRuns: 100 };
const USER_A = 'user-a';
const USER_B = 'user-b';

function makePlaylistService(trackIds = []) {
  const playlistRepo = createMemoryPlaylistRepo();
  const trackRepo = createMemoryTrackRepo(trackIds);
  return { svc: createPlaylistService({ playlistRepo, trackRepo }), trackRepo };
}

// Feature: velocity-music-streaming, Property 29: Validación de nombre de lista.
// [1,100] tras recortar → persiste y devuelve id; vacío/>100 → 400 sin persistir.
// Validates: Requirements 7.1, 7.7
test('Property 29: validación de nombre de lista', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 160 }), async (name) => {
      const { svc } = makePlaylistService();
      const trimmed = name.trim();
      if (trimmed.length >= 1 && trimmed.length <= MAX_NAME_LENGTH) {
        const id = await svc.create(USER_A, name);
        assert.ok(id);
        const lists = await svc.list(USER_A);
        assert.equal(lists.length, 1);
      } else {
        await assert.rejects(
          () => svc.create(USER_A, name),
          (e) => e instanceof PlaylistError && e.status === 400,
        );
        assert.deepEqual(await svc.list(USER_A), []);
      }
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 30: Invariante de orden de
// inserción. Las pistas se añaden al final (permite duplicados) y al eliminar una
// aparición se conserva el orden relativo.
// Validates: Requirements 7.2, 7.3
test('Property 30: invariante de orden de inserción', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom('t1', 't2', 't3', 't4'), { maxLength: 30 }),
      fc.array(fc.constantFrom('t1', 't2', 't3', 't4'), { maxLength: 10 }),
      async (adds, removes) => {
        const { svc } = makePlaylistService(['t1', 't2', 't3', 't4']);
        const id = await svc.create(USER_A, 'mi lista');
        const model = [];
        for (const t of adds) {
          await svc.addTrack(USER_A, id, t);
          model.push(t);
        }
        for (const t of removes) {
          await svc.removeTrack(USER_A, id, t);
          const idx = model.indexOf(t);
          if (idx !== -1) model.splice(idx, 1);
        }
        assert.deepEqual(await svc.getTracks(USER_A, id), model);
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 31: El listado está aislado por
// propietario.
// Validates: Requirements 7.4
test('Property 31: listado de listas aislado por propietario', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length >= 1), {
        maxLength: 8,
      }),
      fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length >= 1), {
        maxLength: 8,
      }),
      async (aNames, bNames) => {
        const { svc } = makePlaylistService();
        for (const n of aNames) await svc.create(USER_A, n);
        for (const n of bNames) await svc.create(USER_B, n);
        const aLists = await svc.list(USER_A);
        const bLists = await svc.list(USER_B);
        assert.equal(aLists.length, aNames.length);
        assert.equal(bLists.length, bNames.length);
        assert.ok(aLists.every((p) => p.userId === USER_A));
        assert.ok(bLists.every((p) => p.userId === USER_B));
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 32: Control de acceso y existencia
// no muta datos. Lista ajena → 403; inexistente → 404; sin cambios.
// Validates: Requirements 7.5, 7.8
test('Property 32: acceso/existencia de listas no muta datos', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('read', 'add', 'remove', 'delete'), async (op) => {
      const { svc } = makePlaylistService(['tx']);
      const id = await svc.create(USER_A, 'lista de A');
      await svc.addTrack(USER_A, id, 'tx');
      const before = await svc.getTracks(USER_A, id);

      // Acceso por USER_B (ajeno) → 403.
      const run = (pid) => {
        if (op === 'read') return svc.getTracks(USER_B, pid);
        if (op === 'add') return svc.addTrack(USER_B, pid, 'tx');
        if (op === 'remove') return svc.removeTrack(USER_B, pid, 'tx');
        return svc.delete(USER_B, pid);
      };
      await assert.rejects(() => run(id), (e) => e instanceof PlaylistError && e.status === 403);

      // Identificador inexistente → 404.
      await assert.rejects(
        () => run('no-existe'),
        (e) => e instanceof PlaylistError && e.status === 404,
      );

      // Datos sin cambios.
      assert.deepEqual(await svc.getTracks(USER_A, id), before);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 33: El borrado elimina la lista y
// sus asociaciones.
// Validates: Requirements 7.6
test('Property 33: borrado elimina lista y asociaciones', async () => {
  const { svc } = makePlaylistService(['t1', 't2']);
  const id = await svc.create(USER_A, 'temporal');
  await svc.addTrack(USER_A, id, 't1');
  await svc.delete(USER_A, id);
  assert.deepEqual(await svc.list(USER_A), []);
  await assert.rejects(() => svc.getTracks(USER_A, id), (e) => e.status === 404);
});

// Feature: velocity-music-streaming, Property 34: El límite de capacidad se aplica
// con 409.
// Validates: Requirements 7.9
test('Property 34: límite de capacidad con 409', async () => {
  // Repo simulado con conteo grande para no insertar 10000 elementos reales.
  const playlistRepo = createMemoryPlaylistRepo();
  const trackRepo = createMemoryTrackRepo(['t']);
  const svc = createPlaylistService({ playlistRepo, trackRepo });
  const id = await svc.create(USER_A, 'llena');
  // Forzar trackCount a 10000.
  const original = playlistRepo.trackCount.bind(playlistRepo);
  playlistRepo.trackCount = async () => 10000;
  await assert.rejects(
    () => svc.addTrack(USER_A, id, 't'),
    (e) => e instanceof PlaylistError && e.status === 409,
  );
  playlistRepo.trackCount = original;
});

// Unit (11.8 del plan): añadir a lista con 10000 pistas → 409 sin cambios.
// Validates: Requirements 7.9
test('Unit: añadir a lista llena deja la lista sin cambios', async () => {
  const playlistRepo = createMemoryPlaylistRepo();
  const trackRepo = createMemoryTrackRepo(['t']);
  const svc = createPlaylistService({ playlistRepo, trackRepo });
  const id = await svc.create(USER_A, 'llena');
  playlistRepo.trackCount = async () => 10000;
  const before = await playlistRepo.getTracks(id);
  await assert.rejects(() => svc.addTrack(USER_A, id, 't'), (e) => e.status === 409);
  assert.deepEqual(await playlistRepo.getTracks(id), before);
});

// ---------- Favorites ----------

// Feature: velocity-music-streaming, Property 35: Favoritos como conjunto
// idempotente.
// Validates: Requirements 8.1, 8.2, 8.3, 8.4
test('Property 35: favoritos idempotentes', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.tuple(fc.constantFrom('add', 'remove'), fc.constantFrom('a', 'b', 'c')), {
        maxLength: 40,
      }),
      async (ops) => {
        const favoritesRepo = createMemoryFavoritesRepo();
        const trackRepo = createMemoryTrackRepo(['a', 'b', 'c']);
        const svc = createFavoritesService({ favoritesRepo, trackRepo });
        const model = new Set();
        let clock = 1;
        for (const [op, t] of ops) {
          if (op === 'add') {
            await svc.add(USER_A, t, clock++);
            model.add(t);
          } else {
            await svc.remove(USER_A, t);
            model.delete(t);
          }
        }
        const listed = new Set(await svc.list(USER_A));
        assert.deepEqual(listed, model);
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 36: Listado de favoritos aislado y
// ordenado por recencia.
// Validates: Requirements 8.5
test('Property 36: favoritos aislados y ordenados por recencia', async () => {
  const favoritesRepo = createMemoryFavoritesRepo();
  const trackRepo = createMemoryTrackRepo(['a', 'b', 'c']);
  const svc = createFavoritesService({ favoritesRepo, trackRepo });
  await svc.add(USER_A, 'a', 1);
  await svc.add(USER_A, 'b', 2);
  await svc.add(USER_A, 'c', 3);
  await svc.add(USER_B, 'a', 5);
  assert.deepEqual(await svc.list(USER_A), ['c', 'b', 'a']);
  assert.deepEqual(await svc.list(USER_B), ['a']);
});

// Feature: velocity-music-streaming, Property 37: Auth y existencia en favoritos
// no mutan el conjunto (pista inexistente → 404).
// Validates: Requirements 8.6, 8.7
test('Property 37: existencia en favoritos → 404 sin mutar', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('add', 'remove'), async (op) => {
      const favoritesRepo = createMemoryFavoritesRepo();
      const trackRepo = createMemoryTrackRepo(['existe']);
      const svc = createFavoritesService({ favoritesRepo, trackRepo });
      await svc.add(USER_A, 'existe', 1);
      const before = await svc.list(USER_A);
      await assert.rejects(
        () => (op === 'add' ? svc.add(USER_A, 'fantasma') : svc.remove(USER_A, 'fantasma')),
        (e) => e instanceof FavoritesError && e.status === 404,
      );
      assert.deepEqual(await svc.list(USER_A), before);
    }),
    RUNS,
  );
});

// ---------- History ----------

// Feature: velocity-music-streaming, Property 38: El historial registra y
// devuelve entradas (round-trip).
// Validates: Requirements 9.1
test('Property 38: historial round-trip', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('a', 'b', 'c'), fc.integer({ min: 1, max: 1e12 }), async (trackId, at) => {
      const historyRepo = createMemoryHistoryRepo();
      const trackRepo = createMemoryTrackRepo(['a', 'b', 'c']);
      const svc = createHistoryService({ historyRepo, trackRepo });
      const entry = await svc.record(USER_A, trackId, at);
      assert.equal(entry.trackId, trackId);
      assert.equal(entry.userId, USER_A);
      assert.equal(entry.playedAt, at);
      const list = await svc.list(USER_A);
      assert.ok(list.some((e) => e.trackId === trackId && e.playedAt === at));
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 39: Listado de historial aislado,
// ordenado y acotado (≤ 100).
// Validates: Requirements 9.2, 9.3, 9.6
test('Property 39: historial aislado, ordenado y acotado', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 150 }), async (n) => {
      const historyRepo = createMemoryHistoryRepo();
      const trackRepo = createMemoryTrackRepo(['t']);
      const svc = createHistoryService({ historyRepo, trackRepo });
      for (let i = 0; i < n; i++) await svc.record(USER_A, 't', i + 1);
      await svc.record(USER_B, 't', 999999);
      const list = await svc.list(USER_A);
      assert.ok(list.length <= 100);
      assert.equal(list.length, Math.min(n, 100));
      // Solo entradas de USER_A.
      assert.ok(list.every((e) => e.userId === USER_A));
      // Orden descendente por playedAt.
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i - 1].playedAt >= list[i].playedAt);
      }
    }),
    { numRuns: 40 },
  );
});

// Feature: velocity-music-streaming, Property 40: Peticiones de historial
// inválidas no persisten (trackId ausente/inexistente → 400).
// Validates: Requirements 9.4, 9.5
test('Property 40: registro inválido de historial no persiste', async () => {
  await fc.assert(
    fc.asyncProperty(fc.oneof(fc.constant(''), fc.constant(null), fc.constant('fantasma')), async (bad) => {
      const historyRepo = createMemoryHistoryRepo();
      const trackRepo = createMemoryTrackRepo(['real']);
      const svc = createHistoryService({ historyRepo, trackRepo });
      await assert.rejects(
        () => svc.record(USER_A, bad),
        (e) => e instanceof HistoryError && e.status === 400,
      );
      assert.deepEqual(await svc.list(USER_A), []);
    }),
    RUNS,
  );
});

// Unit (13.5 del plan): historial vacío → [].
// Validates: Requirements 9.6
test('Unit: historial vacío devuelve []', async () => {
  const svc = createHistoryService({
    historyRepo: createMemoryHistoryRepo(),
    trackRepo: createMemoryTrackRepo(),
  });
  assert.deepEqual(await svc.list('nadie'), []);
});
