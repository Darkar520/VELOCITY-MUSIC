/**
 * Runner de effects: sin política, solo side-effects mockeados.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runAudioEffects,
  hardStopAudio,
  bumpAudioEpoch,
  hasRealMediaSrc,
  applyMediaSrc,
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

test('runAudioEffects: clearSrc y ensureStream delegan (sin load vacío)', () => {
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
      src: 'https://cdn.example/a.mp3',
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
  assert.equal(loaded, false, 'clearSrc NO debe load() sin src (dispara onError)');
});

test('hasRealMediaSrc rechaza vacío y location.href', () => {
  assert.equal(hasRealMediaSrc(null), false);
  assert.equal(hasRealMediaSrc({ src: '', currentSrc: '', getAttribute: () => null }), false);
  assert.equal(hasRealMediaSrc({
    src: 'https://cdn.example/x.mp3',
    currentSrc: 'https://cdn.example/x.mp3',
    getAttribute: () => 'https://cdn.example/x.mp3',
  }), true);
  assert.equal(hasRealMediaSrc({
    src: '/api/stream-proxy?x=1',
    currentSrc: '',
    getAttribute: () => '/api/stream-proxy?x=1',
  }), true);
});

test('applyMediaSrc escribe src en el DOM de inmediato', () => {
  let reactSrc = null;
  const el = { src: '', getAttribute: () => '' };
  applyMediaSrc(
    { setPlaySrc: (u) => { reactSrc = u; }, audioRef: { current: el } },
    'https://cdn.example/b.mp3',
  );
  assert.equal(reactSrc, 'https://cdn.example/b.mp3');
  assert.equal(el.src, 'https://cdn.example/b.mp3');
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
      getAttribute() { return this.src; },
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
  assert.equal(ctx._suppressAudioError, true, 'suprimir onError tras clearSrc');

  await new Promise((r) => setTimeout(r, 500));
  assert.equal(playCalls, 0, 'schedulePlay de la pista anterior no debe llamar play()');
});

test('bumpAudioEpoch limpia pendingSeek', () => {
  const ctx = { _pendingSeek: 77, _audioEpoch: 0 };
  bumpAudioEpoch(ctx);
  assert.equal(ctx._pendingSeek, null);
  assert.equal(ctx._audioEpoch, 1);
});
