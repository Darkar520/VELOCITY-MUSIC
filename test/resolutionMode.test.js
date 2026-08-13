import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  resolveActiveMode,
  isFullResolutionAllowed,
  createModeWatchdog,
} from '../src/services/resolutionMode.js';

const RUNS = { numRuns: 100 };

// Feature: velocity-music-streaming, Property 46: Resolución del modo activo
// (tabla de decisión). Sin config → full; full+detectado → full;
// full+no detectado → degraded + indicación.
// Validates: Requirements 14.1, 14.2, 14.3
test('Property 46: tabla de decisión del modo activo', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.constant(undefined),
        fc.record({ requested: fc.constantFrom('full', 'degraded') }),
      ),
      fc.boolean(),
      async (config, detected) => {
        const probe = async () => detected;
        const { mode, notice } = await resolveActiveMode(config ?? {}, probe);
        const requested = (config && config.requested) ?? 'full';

        if (requested !== 'full') {
          assert.equal(mode, 'degraded');
          return;
        }
        if (detected) {
          assert.equal(mode, 'full');
          assert.equal(notice, null);
        } else {
          assert.equal(mode, 'degraded');
          assert.ok(typeof notice === 'string' && notice.length > 0);
        }
      },
    ),
    RUNS,
  );

  // Sin configuración explícita → full cuando el extractor está disponible.
  const r = await resolveActiveMode({}, async () => true);
  assert.equal(r.mode, 'full');

  // Sonda que excede el timeout → degraded.
  const slow = await resolveActiveMode({ requested: 'full' }, () => new Promise(() => {}), {
    timeoutMs: 20,
  });
  assert.equal(slow.mode, 'degraded');
});

// Feature: velocity-music-streaming, Property 47: El modo degraded rechaza la
// resolución de pista completa.
// Validates: Requirements 14.5
test('Property 47: modo degraded rechaza resolución de pista completa', () => {
  fc.assert(
    fc.property(fc.constantFrom('full', 'degraded'), (mode) => {
      assert.equal(isFullResolutionAllowed(mode), mode === 'full');
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 48: el watchdog de modo recupera
// el backend de 'degraded' a 'full' automáticamente cuando yt-dlp reaparece.
test('Property 48: watchdog recupera el modo full sin reinicio', async () => {
  // Sonda falla N veces y luego empieza a responder.
  let failing = true;
  const probe = async () => !failing;
  let recovered = 0;
  const mode = { value: 'degraded' };
  const wd = createModeWatchdog({
    probe,
    isDegraded: () => mode.value === 'degraded',
    onRecover: () => { mode.value = 'full'; recovered += 1; },
    intervalMs: 5,
  });
  wd.start();
  try {
    // Primer intento: sonda falla → sigue degradado.
    await wd.tick();
    assert.equal(mode.value, 'degraded');
    assert.equal(recovered, 0);

    // La sonda empieza a responder → el watchdog recupera y se detiene.
    failing = false;
    await wd.tick();
    assert.equal(mode.value, 'full');
    assert.equal(recovered, 1);

    // Ya en full: el tick ya no sondea (no debe recaerse ni re-saltar).
    await wd.tick();
    assert.equal(recovered, 1);
  } finally {
    wd.stop();
  }
});

test('watchdog: sonda que lanza excepción no rompe la recuperación posterior', async () => {
  let calls = 0;
  const probe = async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return true;
  };
  let recovered = 0;
  const mode = { value: 'degraded' };
  const wd = createModeWatchdog({
    probe,
    isDegraded: () => mode.value === 'degraded',
    onRecover: () => { mode.value = 'full'; recovered += 1; },
    intervalMs: 5,
  });
  try {
    await wd.tick(); // excepción → sigue degradado
    assert.equal(mode.value, 'degraded');
    await wd.tick(); // segunda sonda OK → full
    assert.equal(mode.value, 'full');
    assert.equal(recovered, 1);
  } finally {
    wd.stop();
  }
});

test('watchdog: el intervalo periódico sondea hasta recuperar (timers reales)', async () => {
  let attempts = 0;
  const probe = async () => (++attempts >= 3);
  let recovered = 0;
  const mode = { value: 'degraded' };
  const wd = createModeWatchdog({
    probe,
    isDegraded: () => mode.value === 'degraded',
    onRecover: () => { mode.value = 'full'; recovered += 1; },
    intervalMs: 10,
  });
  wd.start();
  await new Promise((r) => setTimeout(r, 80));
  wd.stop();
  assert.equal(mode.value, 'full');
  assert.equal(recovered, 1);
  // No debe seguir disparándose tras recuperarse.
  const probesAfter = attempts;
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(attempts <= probesAfter + 1, 'el watchdog debe detenerse al recuperar');
});
