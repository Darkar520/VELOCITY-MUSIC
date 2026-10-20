import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTranslationLines } from '../src/services/lyricsTranslation.js';
import { lyricLines, matchingTranslation, translateRecord } from '../frontend/src/lyricsTranslation.js';

test('an old aligned translation is upgraded online and retained when upgrade is unavailable', async () => {
  const record = { plain:'First original sentence\nSecond original sentence' };
  record.translation = { status:'ready', engineVersion:'argos-context-v2', sourceText:JSON.stringify(lyricLines(record)), lines:['Old first','Old second'] };
  const upgraded = await translateRecord(record, { translateLyrics: async () => ({ status:'ready', engineVersion:'argos-context-v3', lines:['New first','New second'] }) });
  assert.deepEqual(upgraded.lines, ['New first','New second']);
  const fallback = await translateRecord(record, { translateLyrics: async () => { throw new Error('offline'); } });
  assert.deepEqual(fallback.lines, record.translation.lines);
  assert.equal(fallback.upgradePending, true);
});

test('translation input bounds reject malformed and oversized work before spawning', () => {
  for (const lines of [null, [], ['short'], [42], ['x'.repeat(1001)], Array(301).fill('hello')]) assert.throws(() => validateTranslationLines(lines));
  assert.doesNotThrow(() => validateTranslationLines(['An original sentence for our test.', '', 'Another original sentence.']));
});

test('translation uses synchronized lines, preserves empty/repeated rows and persists alignment', async () => {
  const record = { synced: '[00:01.00]First test sentence\n[00:02.00]\n[00:03.00]First test sentence', plain: 'A different plain layout' };
  let requests = 0;
  const api = { translateLyrics: async lines => { requests++; assert.deepEqual(lines, lyricLines(record)); return { status: 'ready', engineVersion:'argos-context-v3', lines: ['Primera frase', '', 'Primera frase'], targetLanguage: 'es' }; } };
  const translation = await translateRecord(record, api);
  assert.equal(translation.lines.length, 3);
  assert.deepEqual(await translateRecord({ ...record, translation }, { translateLyrics: () => { throw new Error('offline'); } }), translation);
  assert.equal(requests, 1);
  assert.equal(matchingTranslation({ ...record, synced: '[00:01.00]Changed text', translation }), null);
});

test('misaligned translator output never becomes an offline translation', async () => {
  await assert.rejects(translateRecord({ plain: 'First original sentence\nSecond original sentence' }, { translateLyrics: async () => ({ status: 'ready', lines: ['only one'] }) }), /alignment/);
});
