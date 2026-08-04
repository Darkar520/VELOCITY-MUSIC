/**
 * frontend-feed-cache.test.js — Regresión feed: caché last-good.
 *
 * Verifica que el feed se persiste adelgazado y acotado, se rehidrata dentro de
 * su ventana de validez, caduca por antigüedad y tolera datos corruptos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Shim de localStorage antes de importar el módulo.
const _store = new Map();
global.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};

const { saveFeedCache, loadFeedCache, clearFeedCache, slimSections } =
  await import('../frontend/src/feed/feedCache.js');

function sampleSections(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    section: `Sección ${i}`,
    mixes: [{
      label: `Mix ${i}`,
      tracks: [{ id: `t${i}`, title: `T${i}`, artist: 'A', cover: 'c', url: 'u', extra: 'DROP' }],
    }],
  }));
}

test('feed cache: guarda y rehidrata las secciones', () => {
  clearFeedCache();
  saveFeedCache(sampleSections(3));
  const out = loadFeedCache();
  assert.ok(Array.isArray(out) && out.length === 3);
  assert.equal(out[0].section, 'Sección 0');
  assert.equal(out[0].mixes[0].tracks[0].id, 't0');
});

test('feed cache: adelgaza (descarta campos no esenciales) y acota', () => {
  const slim = slimSections(sampleSections(1));
  assert.equal(slim[0].mixes[0].tracks[0].extra, undefined, 'no persiste campos ajenos');
  // > MAX_SECTIONS (8) se recorta
  assert.ok(slimSections(sampleSections(20)).length <= 8);
});

test('feed cache: caduca por antigüedad (>24h) → null', () => {
  clearFeedCache();
  const old = { ts: Date.now() - 25 * 3600 * 1000, sections: slimSections(sampleSections(2)) };
  localStorage.setItem('velocity.feedCache', JSON.stringify(old));
  assert.equal(loadFeedCache(), null);
});

test('feed cache: datos corruptos → null (no lanza)', () => {
  localStorage.setItem('velocity.feedCache', '{no json');
  assert.equal(loadFeedCache(), null);
});

test('feed cache: secciones vacías no se guardan', () => {
  clearFeedCache();
  saveFeedCache([]);
  assert.equal(loadFeedCache(), null);
});
