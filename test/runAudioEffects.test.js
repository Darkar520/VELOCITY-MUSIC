/**
 * Runner de effects: sin política, solo side-effects mockeados.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runAudioEffects,
  hardStopAudio,
  bumpAudioEpoch,
} from '../frontend/src/audio/runAudioEffects.js';

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
  let paused = false;
  let loaded = false;
  const audioRef = {
    current: {
      pause() { paused = true; },
      load() { loaded = true; },
      removeAttribute() {},
      currentTime: 55,
      readyState: 4,
    },
  };
  runAudioEffects(
    [
      { type: 'clearSrc' },
      { type: 'ensureStream', trackId: 't1' },
    ],
    {
      audioRef,
      selfPauseRef: { current: false },
      setPlaySrc: (u) => { src = u; },
      setTime: () => {},
      ensureStream: (id) => { ensured = id; },
    },
  );
  assert.equal(src, null);
  assert.equal(ensured, 't1');
  assert.equal(paused, true, 'clearSrc debe pausar el elemento');
  assert.equal(loaded, true, 'clearSrc debe load() tras vaciar src');
});

test('hardStopAudio + epoch invalida schedulePlay de la pista anterior', async () => {
  let playCalls = 0;
  let src = 'https://cdn.example/a.mp3';
  const audioRef = {
    current: {
      src,
      currentSrc: src,
      pause() {},
      load() { this.src = ''; this.currentSrc = ''; },
      removeAttribute() { this.src = ''; this.currentSrc = ''; },
      play() { playCalls += 1; return Promise.resolve(); },
      volume: 1,
      readyState: 4,
      currentTime: 80,
    },
  };
  const ctx = {
    audioRef,
    selfPauseRef: { current: false },
    playingRef: { current: true },
    getIntent: () => 'play',
    setPlaySrc: (u) => { src = u; },
    setTime: () => {},
    vol: 1,
  };

  // Simula play de pista A programando reintentos
  runAudioEffects([{ type: 'play' }], ctx);
  // Cambio de pista: hard stop + epoch
  hardStopAudio(ctx);
  assert.equal(src, null);
  assert.ok((ctx._audioEpoch || 0) >= 1);

  await new Promise((r) => setTimeout(r, 500));
  assert.equal(playCalls, 0, 'schedulePlay de la pista anterior no debe llamar play()');
});

test('bumpAudioEpoch limpia pendingSeek', () => {
  const ctx = { _pendingSeek: 77, _audioEpoch: 0 };
  bumpAudioEpoch(ctx);
  assert.equal(ctx._pendingSeek, null);
  assert.equal(ctx._audioEpoch, 1);
});
