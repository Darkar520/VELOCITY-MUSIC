import assert from 'node:assert/strict';
import { translateLyrics } from '../src/services/lyricsTranslation.js';

// Own prose, not copyrighted lyrics. Exercise installed models rather than
// substituting the translation service with an API mock.
for (const [source, target, lines, expected] of [
  ['en', 'es', ['The morning light comes through my window.', '', 'I remember the road that led me home.', 'The morning light comes through my window.'], /luz|mañana/i],
  ['es', 'en', ['La luz de la mañana entra por mi ventana.', '', 'Recuerdo el camino que me llevó a casa.', 'La luz de la mañana entra por mi ventana.'], /morning|light|window/i],
]) {
  const started = Date.now();
  const result = await translateLyrics(lines);
  assert.equal(result.status, 'ready');
  assert.equal(result.sourceLanguage, source);
  assert.equal(result.targetLanguage, target);
  assert.equal(result.lines.length, lines.length);
  assert.equal(result.lines[1], '');
  assert.equal(result.lines[0], result.lines[3]);
  assert.match(result.lines[0], expected);
  assert.ok(result.lines.every(line => !/(.{4,24})\1{6,}/.test(line)));
  assert.deepEqual(await translateLyrics(lines), result);
  console.log(JSON.stringify({ source, target, model: result.model, rows: result.lines.length, elapsedMs: Date.now() - started, status: 'passed' }));
}
const unsupported = await translateLyrics(['Bonjour, le soleil entre par la fenêtre.', 'Je me souviens du chemin de la maison.']);
assert.equal(unsupported.status, 'unsupported');
console.log(JSON.stringify({ negativeControl: 'fr', status: 'passed' }));
