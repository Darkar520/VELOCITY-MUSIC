import test from 'node:test';
import assert from 'node:assert/strict';

// catalog.js → api.js lee localStorage al importar; stub para Node.
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

const { ensureManyMixes, mixesByChunks } = await import('../frontend/src/feed/mixBuilders.js');

test('ensureManyMixes expande un solo mix grande en varios', () => {
  const tracks = Array.from({ length: 24 }, (_, i) => ({
    id: `t${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i % 6}`,
  }));
  const out = ensureManyMixes([{ label: 'Solo', tracks }], { min: 3, max: 8, prefix: 'X' });
  assert.ok(out.length >= 2, `esperado ≥2 mixes, got ${out.length}`);
  out.forEach((m) => assert.ok((m.tracks || []).length >= 3));
});

test('mixesByChunks no devuelve un solo chunk basura', () => {
  const tracks = Array.from({ length: 30 }, (_, i) => ({
    id: `id${i}`, title: `T${i}`, artist: 'Same',
  }));
  const chunks = mixesByChunks(tracks, { size: 10, maxMixes: 4, prefix: 'Offline' });
  assert.ok(chunks.length >= 2);
});

test('ensureManyMixes con 0 tracks → vacío', () => {
  assert.deepEqual(ensureManyMixes([], { min: 2 }), []);
});
