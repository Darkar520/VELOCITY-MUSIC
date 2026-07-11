/**
 * Regresión: script del callback Google con ruta absoluta.
 *
 * Con redirect_uri = /auth/google/callback (sin barra final), un src relativo
 * "callback.js" se resuelve a /auth/google/callback.js, que el SPA fallback
 * sirve como index.html → el JS no corre → "Conectando…" infinito.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'frontend/public/auth/google/callback/index.html');
const jsPath = join(root, 'frontend/public/auth/google/callback/callback.js');

test('callback HTML usa src ABSOLUTO a callback.js (no relativo)', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /src=["']\/auth\/google\/callback\/callback\.js["']/);
  // Prohibido src relativo que se rompe sin trailing slash
  assert.doesNotMatch(html, /src=["']callback\.js["']/);
  assert.match(html, /onerror=/);
});

test('callback.js lee id_token o credential del hash y tiene safety timeout', () => {
  const js = readFileSync(jsPath, 'utf8');
  assert.match(js, /id_token/);
  assert.match(js, /credential/);
  assert.match(js, /localStorage\.setItem\(['"]velocity\.token['"]/);
  assert.match(js, /90000|hardTimer/);
  assert.match(js, /\/api\/auth\/google/);
});

test('resolución URL: base sin slash + relativo ≠ ruta correcta del script', () => {
  // WHATWG: base without trailing slash treats last segment as file.
  const baseNoSlash = 'https://velocitymusic.uk/auth/google/callback';
  const baseSlash = 'https://velocitymusic.uk/auth/google/callback/';
  const resolvedWrong = new URL('callback.js', baseNoSlash);
  const resolvedRight = new URL('callback.js', baseSlash);
  assert.equal(resolvedWrong.pathname, '/auth/google/callback.js');
  assert.equal(resolvedRight.pathname, '/auth/google/callback/callback.js');
  assert.notEqual(resolvedWrong.pathname, resolvedRight.pathname);
});
