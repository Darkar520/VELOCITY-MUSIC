import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { selectAudioFormat } from '../src/services/audioFormat.js';
import {
  resolve,
  matchYouTubeMusicCandidate,
  ResolveError,
} from '../src/services/audioResolver.js';
import { StreamCache } from '../src/services/streamCache.js';
import { normalizeText } from '../src/lib/normalize.js';

const RUNS = { numRuns: 100 };

// Feature: velocity-music-streaming, Property 9: La selección de formato sigue la
// preferencia y excluye lossless. Opus/webm ~160 si existe; si no AAC/m4a ~256;
// si no mejor audio; nunca lossless.
// Validates: Requirements 2.5, 2.6, 2.7
test('Property 9: selección de formato y exclusión de lossless', () => {
  const fmtArb = fc.record({
    ext: fc.constantFrom('webm', 'm4a', 'mp3', 'flac', 'wav'),
    acodec: fc.constantFrom('opus', 'aac', 'mp3', 'flac', 'alac', 'wav'),
    abr: fc.integer({ min: 32, max: 1411 }),
    vcodec: fc.constant('none'),
  });
  fc.assert(
    fc.property(fc.array(fmtArb, { maxLength: 12 }), (formats) => {
      const sel = selectAudioFormat(formats);
      if (sel === null) return;
      // Nunca lossless.
      const codec = String(sel.acodec).toLowerCase();
      assert.ok(!['flac', 'alac', 'wav', 'pcm', 'tta', 'ape'].some((c) => codec.includes(c)));

      const audioOnly = formats.filter(
        (f) =>
          (!f.vcodec || f.vcodec === 'none') &&
          !['flac', 'alac', 'wav'].some((c) => String(f.acodec).toLowerCase().includes(c)),
      );
      const hasOpus = audioOnly.some(
        (f) => f.ext === 'webm' || f.acodec.includes('opus'),
      );
      const hasAac = audioOnly.some((f) => f.ext === 'm4a' || f.acodec.includes('aac'));
      // Preferencia: si hay opus, se elige opus; si no pero hay aac, se elige aac.
      if (hasOpus) {
        assert.ok(sel.ext === 'webm' || codec.includes('opus'));
      } else if (hasAac) {
        assert.ok(sel.ext === 'm4a' || codec.includes('aac'));
      }
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 7: Validación de artist/title en la
// resolución. Para todo par con alguno ausente/vacío/solo espacios o fuera de
// [1,200], responde 400, identifica el parámetro y no intenta resolución.
// Validates: Requirements 2.1, 2.2
test('Property 7: validación de artist/title', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.record({ artist: fc.constant('  '), title: fc.string({ minLength: 1, maxLength: 50 }) }),
        fc.record({ artist: fc.string({ minLength: 1, maxLength: 50 }), title: fc.constant('') }),
        fc.record({
          artist: fc.string({ minLength: 201, maxLength: 260 }).map((s) => s.padEnd(201, 'x')),
          title: fc.constant('ok'),
        }),
      ),
      async (params) => {
        let extractorCalled = false;
        const extractorImpl = async () => {
          extractorCalled = true;
          return 'https://x/y';
        };
        await assert.rejects(
          () => resolve(params, { mode: 'full', extractorImpl }),
          (err) => err instanceof ResolveError && err.status === 400 && typeof err.param === 'string',
        );
        assert.equal(extractorCalled, false);
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 8: La resolución exitosa redirige a
// la fuente esperada según el modo y la entrada (302 + Location).
// Validates: Requirements 2.3, 2.4, 2.11
test('Property 8: resolución exitosa redirige a la fuente esperada', async () => {
  const nonBlank = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length >= 1);
  // URL de stream explícita válida → se usa sin extractor.
  await fc.assert(
    fc.asyncProperty(
      fc.webUrl(),
      nonBlank,
      nonBlank,
      async (streamUrl, artist, title) => {
        let extractorCalled = false;
        const r = await resolve(
          { artist, title, stream: streamUrl },
          {
            cache: new StreamCache(),
            mode: 'full',
            extractorImpl: async () => {
              extractorCalled = true;
              return 'https://other/url';
            },
          },
        );
        assert.equal(r.status, 302);
        assert.equal(r.url, streamUrl);
        assert.equal(extractorCalled, false);
      },
    ),
    RUNS,
  );

  // Full_Mode sin stream explícito → usa la URL del extractor.
  await fc.assert(
    fc.asyncProperty(fc.webUrl(), async (extractedUrl) => {
      const r = await resolve(
        { artist: 'A', title: 'B' },
        { cache: new StreamCache(), mode: 'full', extractorImpl: async () => extractedUrl },
      );
      assert.equal(r.status, 302);
      assert.equal(r.url, extractedUrl);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 10: El emparejamiento prefiere
// candidatos por contención normalizada.
// Validates: Requirements 2.10
test('Property 10: emparejamiento por contención normalizada', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.array(fc.record({ artist: fc.string(), title: fc.string() }), { maxLength: 10 }),
      (artist, title, noise) => {
        const good = {
          artist: `The ${artist} Band`,
          title: `${title} (Official Audio)`,
        };
        const tracks = [...noise, good];
        const picked = matchYouTubeMusicCandidate(tracks, artist, title);
        assert.ok(picked);
        assert.ok(normalizeText(picked.artist).includes(normalizeText(artist)));
        assert.ok(normalizeText(picked.title).includes(normalizeText(title)));
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 11: Full_Mode degrada ante fallo
// del extractor (modo efectivo `degraded` + indicación).
// Validates: Requirements 2.8
test('Property 11: Full_Mode degrada ante fallo del extractor', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('throw', 'null', 'timeout'), async (failMode) => {
      const cache = new StreamCache();
      const extractorImpl =
        failMode === 'throw'
          ? async () => {
              throw new Error('yt-dlp falló');
            }
          : failMode === 'null'
            ? async () => null
            : () => new Promise(() => {});
      const r = await resolve(
        { artist: 'A', title: 'B' },
        { cache, mode: 'full', extractorImpl, timeoutMs: 20 },
      );
      assert.equal(r.status, 'degraded');
      assert.equal(r.mode, 'degraded');
      // No se cacheó nada en el fallo.
      assert.equal(cache.size(), 0);
    }),
    { numRuns: 30 },
  );
});

// Feature: velocity-music-streaming, Property 12: La resolución se cachea y los
// hits no vuelven a resolver.
// Validates: Requirements 3.1, 3.2
test('Property 12: resolución cacheada, hits sin re-resolver', async () => {
  const nonBlank = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => s.trim().length >= 1);
  await fc.assert(
    fc.asyncProperty(nonBlank, nonBlank, fc.webUrl(), async (artist, title, url) => {
        const cache = new StreamCache();
        let calls = 0;
        const extractorImpl = async () => {
          calls += 1;
          return url;
        };
        const r1 = await resolve({ artist, title }, { cache, mode: 'full', extractorImpl });
        assert.equal(r1.status, 302);
        assert.equal(calls, 1);

        const r2 = await resolve({ artist, title }, { cache, mode: 'full', extractorImpl });
        assert.equal(r2.status, 302);
        assert.equal(r2.url, url);
        assert.equal(r2.fromCache, true);
        // El extractor no se invocó de nuevo.
        assert.equal(calls, 1);
      },
    ),
    RUNS,
  );
});

// Unit (4.9 del plan): sin URL explícita y sin resultado del extractor → 404 sin
// cachear, dejando la caché intacta.
// Validates: Requirements 2.9, 3.7
test('Unit: sin fuente reproducible → 404 sin cachear', async () => {
  const cache = new StreamCache();
  cache.set(cache.keyFor('Existente', 'Cancion'), 'https://kept/url', 3600);
  const sizeBefore = cache.size();

  // mode distinto de full y sin stream → 404.
  await assert.rejects(
    () => resolve({ artist: 'Nueva', title: 'Pista' }, { cache, mode: 'degraded' }),
    (err) => err instanceof ResolveError && err.status === 404,
  );
  assert.equal(cache.size(), sizeBefore);
  assert.equal(cache.get(cache.keyFor('Existente', 'Cancion')), 'https://kept/url');
});
