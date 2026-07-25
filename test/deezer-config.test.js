import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ENABLED, loadDeezerConfig } from '../src/extractors/deezerConfig.js';

test('Deezer permanece desactivado por defecto', () => {
  assert.equal(DEFAULT_ENABLED, false);
  assert.equal(loadDeezerConfig({}).enabled, false);
});

test('Deezer solo se habilita con valores explícitos permitidos', () => {
  for (const value of ['1', 'true', 'on', 'yes']) {
    assert.equal(loadDeezerConfig({ DEEZER_ENABLED: value }).enabled, true, value);
  }
});

test('valores no explícitos no habilitan Deezer', () => {
  for (const value of ['', '0', 'false', 'off', 'maybe']) {
    assert.equal(loadDeezerConfig({ DEEZER_ENABLED: value }).enabled, false, value);
  }
});
