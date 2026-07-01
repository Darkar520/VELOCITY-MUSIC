import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  createSearchController,
  createLatestQueryTracker,
  searchFailureState,
  MIN_QUERY_CHARS,
  MAX_RESULTS,
} from '../public/app/lib/search.js';
import {
  crossfadeVolumes,
  clampCrossfade,
  bufferScheduler,
  LOOK_AHEAD_SECONDS,
} from '../public/app/lib/player.js';
import { listOfflineCompleted, planDownload, DOWNLOAD_STATUS } from '../public/app/lib/offline.js';
import { networkUiState, onNetworkFailure } from '../public/app/lib/net.js';
import {
  selectTheme,
  createThemeStore,
  themeForCoverFallback,
  accentForCover,
  THEMES,
} from '../public/app/lib/theme.js';

const RUNS = { numRuns: 100 };

// Reloj/temporizador simulado para el debounce.
function fakeTimers() {
  let now = 0;
  const tasks = new Map();
  let id = 0;
  return {
    setTimeoutImpl(fn, delay) {
      const at = now + delay;
      const tid = ++id;
      tasks.set(tid, { fn, at });
      return tid;
    },
    clearTimeoutImpl(tid) {
      tasks.delete(tid);
    },
    advance(ms) {
      now += ms;
      for (const [tid, t] of [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          tasks.delete(tid);
          t.fn();
        }
      }
    },
  };
}

// Feature: velocity-music-streaming, Property 43: El debounce de búsqueda
// dispara, cancela y limpia correctamente.
// Validates: Requirements 12.1, 12.2
test('Property 43: debounce dispara, cancela y limpia', () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 10 }),
      (value) => {
        const timers = fakeTimers();
        const searches = [];
        let clears = 0;
        const ctrl = createSearchController({
          onSearch: (v) => searches.push(v),
          onClear: () => (clears += 1),
          setTimeoutImpl: timers.setTimeoutImpl,
          clearTimeoutImpl: timers.clearTimeoutImpl,
        });
        ctrl.change(value);
        const valid = value.trim().length >= MIN_QUERY_CHARS;
        if (valid) {
          assert.equal(searches.length, 0); // aún no transcurren 300 ms
          timers.advance(300);
          assert.deepEqual(searches, [value]);
        } else {
          // < 2 chars → limpia y no hay búsqueda pendiente.
          assert.equal(clears, 1);
          assert.equal(ctrl.pending, false);
          timers.advance(1000);
          assert.equal(searches.length, 0);
        }
      },
    ),
    RUNS,
  );

  // Cambios sucesivos: solo se emite una búsqueda para el último valor.
  const timers = fakeTimers();
  const searches = [];
  const ctrl = createSearchController({
    onSearch: (v) => searches.push(v),
    onClear: () => {},
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  ctrl.change('ro');
  timers.advance(100);
  ctrl.change('rock');
  timers.advance(300);
  assert.deepEqual(searches, ['rock']);
});

// Feature: velocity-music-streaming, Property 44: Solo se muestran los resultados
// de la consulta más reciente.
// Validates: Requirements 12.3
test('Property 44: solo resultados de la consulta más reciente', () => {
  fc.assert(
    fc.property(
      fc.array(fc.array(fc.integer(), { maxLength: 80 }), { minLength: 1, maxLength: 6 }),
      (responses) => {
        const tracker = createLatestQueryTracker();
        // Emitir tantas consultas como respuestas.
        const tokens = responses.map(() => tracker.issue());
        // La más reciente es la última emitida.
        const latest = tokens[tokens.length - 1];
        // Respuestas fuera de orden: las viejas se descartan.
        for (let i = 0; i < tokens.length - 1; i++) {
          assert.equal(tracker.accept(tokens[i], responses[i]), null);
        }
        const shown = tracker.accept(latest, responses[responses.length - 1]);
        assert.ok(Array.isArray(shown));
        assert.ok(shown.length <= MAX_RESULTS);
        assert.deepEqual(shown, responses[responses.length - 1].slice(0, MAX_RESULTS));
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 45: El fallo de búsqueda conserva
// los resultados previos.
// Validates: Requirements 12.5
test('Property 45: fallo de búsqueda conserva resultados previos', () => {
  fc.assert(
    fc.property(fc.array(fc.anything(), { maxLength: 40 }), (prev) => {
      const state = searchFailureState(prev);
      assert.equal(state.error, true);
      assert.deepEqual(state.results, prev);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 41: La programación de crossfade
// respeta la duración y la presencia de pista siguiente.
// Validates: Requirements 10.5, 10.6
test('Property 41: programación de crossfade', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1, max: 12, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.boolean(),
      (duration, frac, hasNext) => {
        const d = clampCrossfade(duration);
        const elapsed = frac * d;
        const { outgoing, incoming } = crossfadeVolumes({ duration, elapsed, hasNext });
        if (!hasNext) {
          assert.equal(outgoing, 1);
          assert.equal(incoming, 0);
        } else {
          // Suma constante ~1; saliente baja, entrante sube.
          assert.ok(Math.abs(outgoing + incoming - 1) < 1e-9);
          assert.ok(outgoing >= -1e-9 && outgoing <= 1 + 1e-9);
          assert.ok(incoming >= -1e-9 && incoming <= 1 + 1e-9);
          // En el extremo final, entrante = volumen completo.
          const end = crossfadeVolumes({ duration, elapsed: d, hasNext: true });
          assert.ok(Math.abs(end.incoming - 1) < 1e-9);
        }
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 49: La programación del búfer
// mantiene el look-ahead.
// Validates: Requirements 15.2
test('Property 49: programación del búfer (look-ahead)', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 1000, noNaN: true }),
      fc.double({ min: 0, max: 1000, noNaN: true }),
      fc.double({ min: 1, max: 600, noNaN: true }),
      (pos, buffered, duration) => {
        const { shouldFetch, targetUntil } = bufferScheduler(pos, buffered, LOOK_AHEAD_SECONDS, duration);
        const p = Math.max(0, pos);
        const b = Math.max(p, buffered);
        const ahead = b - p;
        assert.equal(shouldFetch, ahead < LOOK_AHEAD_SECONDS);
        assert.ok(targetUntil <= duration + 1e-9);
        assert.ok(Math.abs(targetUntil - Math.min(p + LOOK_AHEAD_SECONDS, duration)) < 1e-9);
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 42: El Offline_Cache solo considera
// descargas completadas.
// Validates: Requirements 11.4, 11.6
test('Property 42: offline solo considera descargas completadas', () => {
  const recordArb = fc.record({
    trackId: fc.string({ minLength: 1, maxLength: 6 }),
    status: fc.constantFrom(DOWNLOAD_STATUS.COMPLETED, DOWNLOAD_STATUS.PARTIAL, DOWNLOAD_STATUS.FAILED),
  });
  fc.assert(
    fc.property(fc.array(recordArb, { maxLength: 30 }), (records) => {
      const listed = listOfflineCompleted(records);
      assert.ok(listed.every((r) => r.status === DOWNLOAD_STATUS.COMPLETED));
      // Una pista ya completada → plan = skip.
      const completed = records.find((r) => r.status === DOWNLOAD_STATUS.COMPLETED);
      if (completed) {
        assert.equal(planDownload(records, completed.trackId).action, 'skip');
      }
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 50: El manejo de fallos de red
// conserva una UI no bloqueante y navegable.
// Validates: Requirements 15.5, 15.6
test('Property 50: fallo de red conserva UI navegable', () => {
  fc.assert(
    fc.property(fc.boolean(), (inFlight) => {
      const loading = networkUiState({ inFlight });
      assert.equal(loading.navigable, true);
      const failed = onNetworkFailure();
      assert.equal(failed.error, true);
      assert.equal(failed.navigable, true);
      assert.equal(failed.loading, false);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 48: Selección y persistencia del
// Color_Theme.
// Validates: Requirements 13.8, 13.9, 13.10
test('Property 48: selección y persistencia del tema', () => {
  // selectTheme: nulo/ inválido → dark; válido → ese valor.
  fc.assert(
    fc.property(fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.constantFrom('dark', 'light')), (v) => {
      const t = selectTheme(v);
      assert.ok(t === 'dark' || t === 'light');
      if (v === 'dark' || v === 'light') assert.equal(t, v);
      else assert.equal(t, 'dark');
    }),
    RUNS,
  );

  // Round-trip de persistencia con storage simulado.
  fc.assert(
    fc.property(fc.constantFrom('dark', 'light'), (theme) => {
      const mem = new Map();
      const storage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, v),
      };
      const store = createThemeStore(storage);
      const applied = store.setTheme(theme);
      assert.equal(applied, theme);
      assert.equal(store.getPersistedTheme(), theme);
    }),
    RUNS,
  );
});

// Snapshot/tokens (13.1, 13.2, 13.8): tema oscuro y claro coherentes.
test('Snapshot: tokens de tema oscuro y claro', () => {
  assert.equal(THEMES.dark.background, '#121212');
  assert.equal(THEMES.dark.surface, '#1E1E1E');
  assert.equal(themeForCoverFallback('dark'), '#121212');
  assert.equal(themeForCoverFallback('light'), '#FAFAFA');
  // accentForCover: color dominante válido se respeta; inválido → acento del tema.
  assert.equal(accentForCover('dark', '#abcdef'), '#abcdef');
  assert.equal(accentForCover('dark', 'no-color'), THEMES.dark.accentPrimary);
});
