import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildStatus, MAX_CACHE_ENTRIES_REPORTED } from '../src/services/status.js';

const RUNS = { numRuns: 100 };

// Feature: velocity-music-streaming, Property 21: La respuesta de estado cumple
// su esquema. status ∈ {operational, degraded}; resolutionMode ∈ {full,
// degraded}; cacheEntries entero [0, 1000000] = tamaño de la caché; uptimeSeconds
// ≥ 0.
// Validates: Requirements 5.1, 5.3, 14.4
test('Property 21: la respuesta de estado cumple su esquema', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('full', 'degraded'),
      fc.integer({ min: 0, max: 2_000_000 }),
      fc.double({ min: 0, max: 1e9, noNaN: true }),
      (mode, cacheSize, uptime) => {
        const r = buildStatus({ resolutionMode: mode, cacheSize, uptime });
        assert.ok(['operational', 'degraded'].includes(r.status));
        assert.ok(['full', 'degraded'].includes(r.resolutionMode));
        assert.ok(Number.isInteger(r.cacheEntries));
        assert.ok(r.cacheEntries >= 0 && r.cacheEntries <= MAX_CACHE_ENTRIES_REPORTED);
        // Con modo válido y uptime válido → operational y cacheEntries refleja el tamaño acotado.
        assert.equal(r.cacheEntries, Math.min(MAX_CACHE_ENTRIES_REPORTED, cacheSize));
        assert.ok(r.uptimeSeconds >= 0);
        assert.equal(r.status, 'operational');
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 22: El estado degradado identifica
// los campos no disponibles y conserva los demás.
// Validates: Requirements 5.4
test('Property 22: estado degradado identifica campos no disponibles', () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.integer({ min: 0, max: 5000 }),
      (badMode, badUptime, cacheSize) => {
        // Forzar al menos un campo no determinable.
        if (!badMode && !badUptime) return;
        const r = buildStatus({
          resolutionMode: badMode ? 'invalid' : 'full',
          cacheSize,
          uptime: badUptime ? -1 : 1234.9,
        });
        assert.equal(r.status, 'degraded');
        assert.ok(Array.isArray(r.degradedFields));
        if (badMode) {
          assert.ok(r.degradedFields.includes('resolutionMode'));
          assert.equal(r.resolutionMode, null);
        } else {
          // Campo conservado.
          assert.equal(r.resolutionMode, 'full');
        }
        if (badUptime) {
          assert.ok(r.degradedFields.includes('uptimeSeconds'));
          assert.equal(r.uptimeSeconds, null);
        } else {
          assert.equal(r.uptimeSeconds, 1234);
        }
        // cacheEntries siempre conservado.
        assert.equal(r.cacheEntries, cacheSize);
      },
    ),
    RUNS,
  );
});

// Unit (8.4 del plan): caché vacía → cacheEntries == 0.
// Validates: Requirements 5.3
test('Unit: caché vacía reporta cacheEntries 0', () => {
  const r = buildStatus({ resolutionMode: 'full', cacheSize: 0, uptime: 10 });
  assert.equal(r.cacheEntries, 0);
  assert.equal(r.status, 'operational');
});
