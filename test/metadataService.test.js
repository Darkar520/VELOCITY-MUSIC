import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  searchTracks,
  mapYouTubeMusicTrack,
  highResolutionArtwork,
  resolveLimit,
  MetadataError,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MIN_LIMIT,
  MAX_QUERY_LENGTH,
} from '../src/services/metadataService.js';

const RUNS = { numRuns: 100 };

// Feature: velocity-music-streaming, Property 1: Búsqueda con consulta válida
// devuelve una lista. Para toda cadena de consulta cuya longitud tras recortar
// esté en [1, 256], searchTracks resuelve con una lista (posiblemente vacía) de
// registros Track_Metadata.
// Validates: Requirements 1.1, 1.2
test('Property 1: consulta válida devuelve una lista', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: MAX_QUERY_LENGTH }),
      fc.array(fc.record({ id: fc.string(), title: fc.string(), artist: fc.string() }), {
        maxLength: 30,
      }),
      async (rawQuery, rawResults) => {
        // Asegurar que tras recortar queda en [1, 256].
        const q = ` ${rawQuery} `.slice(0, MAX_QUERY_LENGTH);
        if (q.trim().length < 1) return;
        const catalogImpl = async () => rawResults;
        const result = await searchTracks(q, { catalogImpl });
        assert.ok(Array.isArray(result));
        assert.equal(result.length, rawResults.length);
        for (const r of result) {
          assert.ok('id' in r && 'title' in r && 'artist' in r && 'streamUrl' in r);
        }
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 2: Validación de consulta de
// búsqueda. Para toda consulta ausente, vacía, solo espacios o > 256 caracteres,
// searchTracks falla con 400 y NO invoca el catálogo.
// Validates: Requirements 1.3, 1.4
test('Property 2: validación de consulta de búsqueda', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.constant(undefined),
        fc.constant(''),
        fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 8 }),
        fc
          .string({ minLength: MAX_QUERY_LENGTH + 1, maxLength: MAX_QUERY_LENGTH + 50 })
          .map((s) => s.padEnd(MAX_QUERY_LENGTH + 1, 'x')),
      ),
      async (badQuery) => {
        let invoked = false;
        const catalogImpl = async () => {
          invoked = true;
          return [];
        };
        await assert.rejects(
          () => searchTracks(badQuery, { catalogImpl }),
          (err) => err instanceof MetadataError && err.status === 400,
        );
        assert.equal(invoked, false);
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 3: Mapeo completo de metadatos con
// nulos para campos ausentes. Para todo resultado con cualquier subconjunto de
// campos, el Track_Metadata contiene todas las claves, con null en streamUrl y
// en cada campo ausente.
// Validates: Requirements 1.5
test('Property 3: mapeo completo con nulos para ausentes', () => {
  const KEYS = [
    'id',
    'title',
    'artist',
    'album',
    'durationMs',
    'artworkUrl',
    'streamUrl',
    'releaseDate',
    'genre',
  ];
  fc.assert(
    fc.property(
      fc.record(
        {
          id: fc.string(),
          title: fc.string(),
          artist: fc.string(),
          album: fc.string(),
          durationMs: fc.integer({ min: 0 }),
          artworkUrl: fc.webUrl(),
          releaseDate: fc.string(),
          genre: fc.string(),
        },
        { requiredKeys: [] },
      ),
      (raw) => {
        const mapped = mapYouTubeMusicTrack(raw);
        for (const k of KEYS) assert.ok(k in mapped, `falta la clave ${k}`);
        // streamUrl siempre null hasta resolver el audio.
        assert.equal(mapped.streamUrl, null);
        // Campos ausentes en el crudo → null en el mapeo.
        for (const k of ['id', 'title', 'artist', 'album', 'releaseDate', 'genre']) {
          if (!(k in raw)) assert.equal(mapped[k], null);
        }
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 4: La portada se normaliza a alta
// resolución (1200x1200). Para toda URL de portada en formato de tamaño conocido,
// artworkUrl referencia la variante 1200x1200.
// Validates: Requirements 1.6
test('Property 4: portada normalizada a 1200x1200', () => {
  fc.assert(
    fc.property(fc.integer({ min: 16, max: 320 }), (size) => {
      // Estilo iTunes/legacy
      const legacy = `https://is1.example.com/art/${size}x${size}bb.jpg`;
      assert.equal(
        highResolutionArtwork(legacy),
        'https://is1.example.com/art/1200x1200bb.jpg',
      );
      // Estilo Google/YouTube (conserva los flags de recorte/formato)
      const g = `https://lh3.googleusercontent.com/abc=w${size}-h${size}-l90-rj`;
      assert.match(highResolutionArtwork(g), /=w1200-h1200/);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 5: Los fallos del catálogo se
// mapean a 502. Para todo modo de fallo (error, inalcanzable o timeout 5 s),
// searchTracks falla con 502.
// Validates: Requirements 1.7
test('Property 5: fallos del catálogo → 502', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(fc.constant('throw'), fc.constant('timeout')),
      async (mode) => {
        const catalogImpl =
          mode === 'throw'
            ? async () => {
                throw new Error('upstream caído');
              }
            : () => new Promise(() => {}); // nunca resuelve → timeout
        await assert.rejects(
          () => searchTracks('consulta válida', { catalogImpl, timeoutMs: 20 }),
          (err) => err instanceof MetadataError && err.status === 502,
        );
      },
    ),
    { numRuns: 30 },
  );
});

// Feature: velocity-music-streaming, Property 6: El límite de resultados se
// determina y acota. Ausente → 30; explícito → acotado a [1, 30].
// Validates: Requirements 1.8, 1.9
test('Property 6: límite determinado y acotado', async () => {
  // resolveLimit puro
  fc.assert(
    fc.property(fc.integer({ min: -100, max: 1000 }), (n) => {
      const r = resolveLimit(n);
      assert.ok(r >= MIN_LIMIT && r <= MAX_LIMIT);
    }),
    RUNS,
  );
  assert.equal(resolveLimit(undefined), DEFAULT_LIMIT);
  assert.equal(resolveLimit(''), DEFAULT_LIMIT);

  // El límite efectivo se pasa realmente al catálogo.
  await fc.assert(
    fc.asyncProperty(
      fc.option(fc.integer({ min: -50, max: 200 }), { nil: undefined }),
      async (limit) => {
        let received;
        const catalogImpl = async (_q, lim) => {
          received = lim;
          return [];
        };
        await searchTracks('rock', { limit, catalogImpl });
        if (limit === undefined) {
          assert.equal(received, DEFAULT_LIMIT);
        } else {
          assert.ok(received >= MIN_LIMIT && received <= MAX_LIMIT);
        }
      },
    ),
    RUNS,
  );
});

// Unit (3.8 del plan): búsqueda válida sin coincidencias → lista vacía.
// Validates: Requirements 1.2
test('Unit: búsqueda con cero resultados devuelve lista vacía', async () => {
  const result = await searchTracks('xyznoexiste', { catalogImpl: async () => [] });
  assert.deepEqual(result, []);
});
