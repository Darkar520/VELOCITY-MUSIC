import test from 'node:test';
import assert from 'node:assert/strict';
import { audioFormatSelector } from '../src/services/audioFormat.js';

test('yt-dlp selectors only accept direct HTTPS audio, never HLS/DASH manifests', () => {
  for (const quality of ['high', 'medium', 'low']) {
    const selectors = audioFormatSelector(quality).split('/');
    assert.ok(selectors.length >= 4);
    assert.ok(selectors.every((selector) => selector.endsWith('[protocol=https]')));
    assert.ok(selectors.every((selector) => !/m3u8|dash_segments/i.test(selector)));
  }
});

test('unknown quality keeps the high-quality direct-audio preference', () => {
  assert.equal(audioFormatSelector('unknown'), audioFormatSelector('high'));
});
