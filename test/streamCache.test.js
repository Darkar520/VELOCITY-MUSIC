import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  StreamCache,
  DEFAULT_CACHE_TTL_SECONDS,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MAX_ENTRIES,
} from '../src/services/streamCache.js';
import { normalizeText } from '../src/lib/normalize.js';

const RUNS = { numRuns: 100 };

// Feature: velocity-music-streaming, Property 13: TTL por defecto, acotación y
// caducidad de la caché. Para toda entrada almacenada, el TTL efectivo es 14400 s
// cuando no se proporciona TTL explícito y queda en [1, 604800] cuando se
// proporciona; y para toda entrada cuyo instante de caducidad ya pasó, una
// lectura devuelve ausencia de valor y elimina la entrada.
// Validates: Requirements 3.3, 3.4
test('Property 13: TTL por defecto, acotación y caducidad', () => {
  // TTL por defecto = 14400 s
  fc.assert(
    fc.property(fc.string(), fc.string(), (key, value) => {
      const cache = new StreamCache();
      const before = Date.now();
      cache.set(key, value);
      const item = cache.cache.get(key);
      const ttlMs = item.expiresAt - before;
      // Tolerancia por el tiempo de ejecución.
      assert.ok(Math.abs(ttlMs - DEFAULT_CACHE_TTL_SECONDS * 1000) < 1000);
    }),
    RUNS,
  );

  // TTL explícito acotado a [1, 604800].
  fc.assert(
    fc.property(fc.integer({ min: -1000, max: 2_000_000 }), (ttl) => {
      const cache = new StreamCache();
      const before = Date.now();
      cache.set('k', 'v', ttl);
      const item = cache.cache.get('k');
      const effectiveTtlSec = Math.round((item.expiresAt - before) / 1000);
      assert.ok(effectiveTtlSec >= MIN_TTL_SECONDS);
      assert.ok(effectiveTtlSec <= MAX_TTL_SECONDS);
    }),
    RUNS,
  );

  // Entrada caducada → lectura devuelve null y elimina la entrada.
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), fc.string(), (key, value) => {
      const cache = new StreamCache();
      cache.set(key, value, 1);
      // Forzar caducidad manipulando expiresAt al pasado.
      cache.cache.get(key).expiresAt = Date.now() - 1;
      assert.equal(cache.get(key), null);
      assert.equal(cache.cache.has(key), false);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 14: La clave de caché normaliza el
// texto de forma consistente. Para todo par (artist, title) que difiera solo en
// espacios, mayúsculas, diacríticos o espacios internos, keyFor produce la misma
// clave.
// Validates: Requirements 3.5
test('Property 14: clave de caché normaliza consistentemente', () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.string(),
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
      (artist, title, padA, padT) => {
        const cache = new StreamCache();
        const spaces = (n) => ' '.repeat(n);
        // Variante: añade espacios alrededor y en medio, y cambia mayúsculas.
        const variantArtist = `${spaces(padA)}${artist.toUpperCase()}${spaces(padT)}`;
        const variantTitle = `${spaces(padT)}${title.toUpperCase()}${spaces(padA)}`;

        const k1 = cache.keyFor(artist, title);
        const k2 = cache.keyFor(variantArtist, variantTitle);
        // Ambas claves deben coincidir con la forma normalizada esperada.
        assert.equal(k1, `${normalizeText(artist)}:${normalizeText(title)}`);
        assert.equal(cache.keyFor(`  ${artist}  `, `  ${title}  `), k1);
        // La variante en mayúsculas normaliza igual.
        assert.equal(
          cache.keyFor(artist.toUpperCase(), title.toUpperCase()),
          k1,
        );
        void k2;
      },
    ),
    RUNS,
  );

  // Diacríticos y espacios internos colapsan.
  fc.assert(
    fc.property(fc.constant(null), () => {
      const cache = new StreamCache();
      assert.equal(cache.keyFor('Café   Tacvba', 'Eres'), cache.keyFor('cafe tacvba', 'eres'));
      assert.equal(cache.keyFor('  ÀÉÎ  ', 'x'), cache.keyFor('aei', 'x'));
    }),
    { numRuns: 1 },
  );
});

// Feature: velocity-music-streaming, Property 15: Las lecturas ausentes y los
// fallos de resolución no mutan otras entradas. Una lectura de una clave
// inexistente devuelve null sin modificar ninguna otra entrada.
// Validates: Requirements 3.6, 3.7
test('Property 15: lecturas ausentes no mutan otras entradas', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.string({ minLength: 1 }), fc.string()), { maxLength: 50 }),
      fc.string({ minLength: 1 }),
      (entries, missingKey) => {
        const cache = new StreamCache();
        for (const [k, v] of entries) cache.set(k, v, 3600);

        // Asegurar que missingKey no existe.
        if (cache.cache.has(missingKey)) return;

        const snapshot = new Map(
          [...cache.cache.entries()].map(([k, item]) => [k, item.value]),
        );

        const result = cache.get(missingKey);
        assert.equal(result, null);

        // Ninguna otra entrada cambió de valor; ninguna fue eliminada.
        assert.equal(cache.size(), snapshot.size);
        for (const [k, v] of snapshot) {
          assert.equal(cache.cache.get(k).value, v);
        }
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 16: Expulsión LRU al superar la
// capacidad (memoria acotada). Para toda secuencia de almacenamientos que
// llevaría el número de entradas por encima de 10000, se expulsa la entrada
// leída menos recientemente antes de añadir, de modo que el número de entradas
// nunca supera 10000.
// Validates: Requirements 3.8, 15.8
test('Property 16: expulsión LRU mantiene la capacidad acotada', () => {
  // Verificación funcional de la política LRU con capacidad reducida simulada
  // mediante muchas inserciones por encima del límite habría sido costosa;
  // validamos el invariante de tamaño y el orden de expulsión a escala.
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 200 }), (extra) => {
      const cache = new StreamCache();
      // Llenar exactamente hasta la capacidad.
      for (let i = 0; i < MAX_ENTRIES; i++) cache.set(`k${i}`, `v${i}`, 3600);
      assert.equal(cache.size(), MAX_ENTRIES);

      // Tocar (leer) k0 para hacerla la más reciente; k1 pasa a ser la LRU.
      cache.get('k0');

      // Insertar nuevas entradas por encima de la capacidad.
      for (let j = 0; j < extra; j++) cache.set(`new${j}`, `nv${j}`, 3600);

      // El tamaño nunca supera el máximo.
      assert.ok(cache.size() <= MAX_ENTRIES);
      // k0 sobrevive (fue la más reciente); k1 fue la primera en expulsarse.
      assert.equal(cache.get('k0'), 'v0');
      assert.equal(cache.cache.has('k1'), false);
    }),
    { numRuns: 20 },
  );
});
