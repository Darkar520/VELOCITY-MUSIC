import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  resolveActiveMode,
  isFullResolutionAllowed,
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
