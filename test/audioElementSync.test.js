import test from 'node:test';
import assert from 'node:assert/strict';
import { syncAudioElement } from '../frontend/src/audio/syncAudioElement.js';
import { initialState, reduce } from '../frontend/src/audio/audioMachine.js';

function fixture() {
  let state = { ...initialState(), trackId: 'a', srcStatus: 'ready', intent: 'play' };
  let src = 'blob:a', plays = 0;
  const audio = { paused: true, volume: 1, readyState: 4, currentTime: 145,
    getAttribute: () => src, setAttribute: (_, value) => { src = value; },
    pause() { this.paused = true; }, load() {}, play() { plays++; this.paused = false; } };
  const player = { track: { id: 'b' }, playSrc: null, playing: true };
  const ctx = { audioRef: { current: audio }, effectCtxRef: { current: {} },
    getMachine: () => state, patchMachine: patch => { state = { ...state, ...patch }; },
    getPlayerState: () => player, playSrc: 'blob:a', playing: true, vol: 1,
    selfPauseRef: { current: false }, playingRef: { current: true },
    setLoadingAudio() {}, applySessionResume() {}, restoreInterruptPosition() {} };
  ctx.effectCtxRef.current = { audioRef: ctx.audioRef, playingRef: ctx.playingRef,
    getIntent: () => state.intent, canPlay: () => state.focus !== 'yielded' };
  return { ctx, player, audio, get src() { return src; }, get plays() { return plays; },
    get state() { return state; }, dispatch(event) { state = reduce(state, event).state; } };
}

test('a delayed render cannot remount the previous source or mark a resolving next track ready', () => {
  const f = fixture();
  f.dispatch({ type: 'TRACK_SET', trackId: 'b', intent: 'play' });
  f.audio.setAttribute('src', '');
  syncAudioElement(f.ctx);
  assert.equal(f.src, '');
  assert.equal(f.state.srcStatus, 'none');
  assert.equal(f.plays, 0);
});

test('a delayed playing render cannot resurrect a user/OS pause', () => {
  const f = fixture();
  f.player.track.id = 'a'; f.player.playSrc = 'blob:a'; f.player.playing = false;
  f.dispatch({ type: 'USER_PAUSE' });
  syncAudioElement(f.ctx);
  assert.equal(f.state.intent, 'pause');
  assert.equal(f.plays, 0);
});

test('a delayed empty-source render cannot invalidate an already prepared next track', () => {
  const f = fixture();
  f.ctx.playSrc = null;
  f.dispatch({ type: 'TRACK_SET', trackId: 'b', intent: 'play' });
  f.dispatch({ type: 'STREAM_READY', trackId: 'b', url: 'blob:b' });
  f.player.playSrc = 'blob:b'; f.audio.setAttribute('src', 'blob:b');
  f.audio.paused = false;
  syncAudioElement(f.ctx);
  assert.equal(f.state.srcStatus, 'ready');
  assert.equal(f.src, 'blob:b');
  assert.equal(f.plays, 0);
});

test('synchronization still starts the selected paused source when policy allows it', () => {
  const f = fixture();
  f.player.track.id = 'a'; f.player.playSrc = 'blob:a';
  syncAudioElement(f.ctx);
  assert.equal(f.plays, 1);
  assert.equal(f.audio.paused, false);
});

test('synchronization does not repeat play on healthy audio or reclaim yielded focus', () => {
  const f = fixture();
  f.player.track.id = 'a'; f.player.playSrc = 'blob:a';
  f.audio.paused = false;
  syncAudioElement(f.ctx);
  assert.equal(f.plays, 0);
  f.audio.paused = true;
  f.dispatch({ type: 'EXTERNAL_PAUSE', hidden: true, position: 145 });
  globalThis.document = { visibilityState: 'hidden' };
  try { syncAudioElement(f.ctx); } finally { delete globalThis.document; }
  assert.equal(f.plays, 0);
  assert.equal(f.state.focus, 'yielded');
});
