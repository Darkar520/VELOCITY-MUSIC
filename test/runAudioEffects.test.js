/**
 * Runner de effects: sin política, solo side-effects mockeados.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAudioEffects } from '../frontend/src/audio/runAudioEffects.js';

test('runAudioEffects: pause + syncReact + mediaSession', () => {
  let paused = false;
  let playing = true;
  let loading = true;
  let ms = null;
  const selfPauseRef = { current: false };
  const audioRef = {
    current: {
      pause() { paused = true; },
      play() { return Promise.resolve(); },
      volume: 1,
      readyState: 4,
      currentTime: 0,
    },
  };
  runAudioEffects(
    [
      { type: 'pause', self: true },
      { type: 'mediaSession', state: 'paused', position: 12 },
      { type: 'syncReact', patch: { playing: false, loadingAudio: false, time: 12 } },
    ],
    {
      audioRef,
      selfPauseRef,
      setPlaying: (v) => { playing = v; },
      setLoadingAudio: (v) => { loading = v; },
      setTime: () => {},
      setMediaSessionState: (s, p) => { ms = { s, p }; },
      playingRef: { current: true },
    },
  );
  assert.equal(paused, true);
  assert.equal(playing, false);
  assert.equal(loading, false);
  assert.deepEqual(ms, { s: 'paused', p: 12 });
  assert.equal(selfPauseRef.current, false, 'selfPause liberado tras pause');
});

test('runAudioEffects: clearSrc y ensureStream delegan', () => {
  let src = 'old';
  let ensured = null;
  runAudioEffects(
    [
      { type: 'clearSrc' },
      { type: 'ensureStream', trackId: 't1' },
    ],
    {
      setPlaySrc: (u) => { src = u; },
      ensureStream: (id) => { ensured = id; },
    },
  );
  assert.equal(src, null);
  assert.equal(ensured, 't1');
});
