/**
 * TDD: máquina de estados de audio — reduce puro.
 * App.jsx no se toca en estos tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  reduce,
  selectPlaySync,
} from '../frontend/src/audio/audioMachine.js';

function effectsOfType(effects, type) {
  return (effects || []).filter((e) => e.type === type);
}

function hasEffect(effects, type) {
  return effectsOfType(effects, type).length > 0;
}

function reduceAll(state, events) {
  let s = state;
  let all = [];
  for (const ev of events) {
    const out = reduce(s, ev);
    s = out.state;
    all = all.concat(out.effects || []);
  }
  return { state: s, effects: all };
}

// ── initial ──

test('initialState: pausado, sin yield, sin src', () => {
  const s = initialState();
  assert.equal(s.intent, 'pause');
  assert.equal(s.focus, 'own');
  assert.equal(s.trackId, null);
  assert.equal(s.sessionPosition, null);
  assert.equal(s.yieldPosition, null);
  assert.equal(s.srcStatus, 'none');
});

// ── A7 EXTERNAL_PAUSE ──

test('A7: EXTERNAL_PAUSE hidden + intent play → yield + pause (no MS paused)', () => {
  const base = {
    ...initialState(),
    intent: 'play',
    focus: 'own',
    trackId: 'ig-track',
    livePosition: 42,
    srcStatus: 'ready',
  };
  const { state, effects } = reduce(base, {
    type: 'EXTERNAL_PAUSE',
    hidden: true,
    selfPause: false,
    position: 42,
  });
  assert.equal(state.focus, 'yielded');
  assert.equal(state.intent, 'play', 'intención de usuario se mantiene');
  assert.equal(state.yieldPosition, 42);
  assert.equal(state.yieldTrackId, 'ig-track');
  assert.ok(hasEffect(effects, 'pause'));
  // mediaSession ya NO emite 'paused': mantener playing al OS
  // para evitar que Chrome suspenda la pestaña.
  const msEffects = effectsOfType(effects, 'mediaSession');
  assert.equal(msEffects.length, 0, 'no debe emitir mediaSession paused');
  assert.equal(selectPlaySync(state, { visible: false }), 'noop');
});

test('A7: EXTERNAL_PAUSE visible → no yield (ducking)', () => {
  const base = {
    ...initialState(),
    intent: 'play',
    focus: 'own',
    trackId: 't1',
    livePosition: 10,
    srcStatus: 'ready',
  };
  const { state, effects } = reduce(base, {
    type: 'EXTERNAL_PAUSE',
    hidden: false,
    selfPause: false,
    position: 10,
  });
  assert.equal(state.focus, 'own');
  assert.equal(state.yieldPosition, null);
  // soft kick en foreground: un play
  assert.ok(hasEffect(effects, 'play'), 'foreground ducking → soft play');
});

test('A7: EXTERNAL_PAUSE selfPause → no-op de yield', () => {
  const base = {
    ...initialState(),
    intent: 'play',
    focus: 'own',
    trackId: 't1',
    livePosition: 5,
    srcStatus: 'ready',
  };
  const { state, effects } = reduce(base, {
    type: 'EXTERNAL_PAUSE',
    hidden: true,
    selfPause: true,
    position: 5,
  });
  assert.equal(state.focus, 'own');
  assert.ok(!hasEffect(effects, 'pause') || effects.length === 0);
});

// ── A11 next / TRACK_SET / STREAM_READY ──

test('A11: TRACK_SET limpia anclas; STREAM_READY + intent play emite play aunque (lógica) hidden', () => {
  const { state, effects } = reduceAll(initialState(), [
    {
      type: 'TRACK_SET',
      trackId: 'next-song',
      intent: 'play',
    },
    {
      type: 'STREAM_READY',
      trackId: 'next-song',
      url: '/api/stream-proxy?exp=9999999999&sig=abc',
    },
  ]);
  assert.equal(state.trackId, 'next-song');
  assert.equal(state.intent, 'play');
  assert.equal(state.focus, 'own');
  assert.equal(state.sessionPosition, null);
  assert.equal(state.yieldPosition, null);
  assert.equal(state.srcStatus, 'ready');
  assert.ok(hasEffect(effects, 'setSrc'));
  assert.ok(hasEffect(effects, 'seek'));
  assert.equal(effectsOfType(effects, 'seek')[0].position, 0);
  assert.ok(hasEffect(effects, 'play'));
  assert.equal(selectPlaySync(state, { visible: false }), 'soft-play');
});

// ── Anti-race: no clavar mitad de canción / pista anterior ──

test('TRACK_SET emite clearSrc y STREAM_READY tras TRACK_SET busca 0 aunque live esté contaminado', () => {
  // Simula: canción A en 120s → click en B → PLAYING residual no debe clavar B a 120.
  let { state, effects } = reduce(
    {
      ...initialState(),
      intent: 'play',
      trackId: 'song-a',
      livePosition: 120,
      sessionPosition: 120,
      srcStatus: 'ready',
    },
    { type: 'TRACK_SET', trackId: 'song-b', intent: 'play' },
  );
  assert.ok(hasEffect(effects, 'clearSrc'), 'debe cortar src de la pista anterior');
  assert.equal(state.livePosition, 0);
  assert.equal(state.sessionPosition, null);
  assert.equal(state.srcStatus, 'none');

  // Contaminación residual (bug histórico): PLAYING del <audio> viejo
  const polluted = reduce(state, { type: 'PLAYING', position: 120, trackId: 'song-a' });
  assert.equal(polluted.state.livePosition, 0, 'PLAYING de otra pista se ignora');
  assert.equal(polluted.state.srcStatus, 'none');

  const polluted2 = reduce(state, { type: 'PLAYING', position: 99 });
  assert.equal(polluted2.state.livePosition, 0, 'PLAYING con src none se ignora');

  // Forzar livePosition sucio (como si un race lo hubiera escrito) + src none
  const dirty = { ...state, livePosition: 120, sessionPosition: null };
  const ready = reduce(dirty, {
    type: 'STREAM_READY',
    trackId: 'song-b',
    url: '/api/stream-proxy?exp=999&sig=x',
  });
  // srcStatus none → seek 0 aunque live sea 120
  const seeks = effectsOfType(ready.effects, 'seek');
  assert.ok(seeks.some((s) => s.position === 0), 'nueva pista arranca en 0');
  assert.ok(!seeks.some((s) => s.position === 120), 'no clavar minuto 2 de la anterior');
  assert.ok(hasEffect(ready.effects, 'play'));
});

test('STREAM_READY mid-play (src stale) conserva livePosition para re-sign', () => {
  const { effects } = reduce(
    {
      ...initialState(),
      intent: 'play',
      trackId: 'same',
      livePosition: 42,
      srcStatus: 'stale',
    },
    {
      type: 'STREAM_READY',
      trackId: 'same',
      url: '/api/stream-proxy?exp=999&sig=y',
    },
  );
  const seeks = effectsOfType(effects, 'seek');
  assert.ok(seeks.some((s) => s.position === 42), 're-sign mantiene posición');
});

// ── A10 seek ──

test('A10: USER_SEEK limpia yield y session; emite seek', () => {
  const base = {
    ...initialState(),
    intent: 'play',
    trackId: 't1',
    sessionPosition: 50,
    yieldPosition: 40,
    yieldTrackId: 't1',
    livePosition: 40,
    srcStatus: 'ready',
  };
  const { state, effects } = reduce(base, { type: 'USER_SEEK', position: 0 });
  assert.equal(state.sessionPosition, null);
  assert.equal(state.yieldPosition, null);
  assert.equal(state.yieldTrackId, null);
  assert.equal(state.livePosition, 0);
  assert.ok(hasEffect(effects, 'seek'));
  assert.equal(effectsOfType(effects, 'seek')[0].position, 0);
});

// ── A12 hydrate + USER_PLAY ──

test('A12: HYDRATE con posición y URL stale → pause, session, clearSrc, no play', () => {
  const { state, effects } = reduce(initialState(), {
    type: 'HYDRATE',
    trackId: 'rob-zombie',
    position: 50,
    urlFresh: false,
  });
  assert.equal(state.intent, 'pause');
  assert.equal(state.trackId, 'rob-zombie');
  assert.equal(state.sessionPosition, 50);
  assert.equal(state.srcStatus, 'stale');
  assert.ok(hasEffect(effects, 'clearSrc'));
  assert.ok(!hasEffect(effects, 'play'));
  assert.ok(!hasEffect(effects, 'ensureStream'));
});

test('A12: USER_PLAY tras hydrate → ensureStream; STREAM_READY seek session + play', () => {
  let { state } = reduce(initialState(), {
    type: 'HYDRATE',
    trackId: 'rob-zombie',
    position: 50,
    urlFresh: false,
  });
  let out = reduce(state, { type: 'USER_PLAY' });
  state = out.state;
  assert.equal(state.intent, 'play');
  assert.ok(hasEffect(out.effects, 'ensureStream'));
  assert.ok(!hasEffect(out.effects, 'play'), 'aún no play sin stream');

  out = reduce(state, {
    type: 'STREAM_READY',
    trackId: 'rob-zombie',
    url: '/api/stream-proxy?exp=9999999999&sig=x',
  });
  assert.equal(out.state.srcStatus, 'ready');
  assert.ok(hasEffect(out.effects, 'setSrc'));
  const seeks = effectsOfType(out.effects, 'seek');
  assert.ok(seeks.some((s) => s.position === 50), 'seek a session 50');
  assert.ok(hasEffect(out.effects, 'play'));
});

// ── A13 PLAY_FAILED sin intent ──

test('A13: PLAY_FAILED con intent pause → clearSrc si stale, no play', () => {
  const base = {
    ...initialState(),
    intent: 'pause',
    trackId: 't1',
    srcStatus: 'stale',
  };
  const { state, effects } = reduce(base, { type: 'PLAY_FAILED', reason: 'error' });
  assert.equal(state.intent, 'pause');
  assert.ok(hasEffect(effects, 'clearSrc') || state.srcStatus === 'none' || hasEffect(effects, 'syncReact'));
  assert.ok(!hasEffect(effects, 'play'));
  assert.ok(!hasEffect(effects, 'ensureStream'));
});

// ── DOC_VISIBLE resume after yield ──

test('A4/A7: DOC_VISIBLE con yield + intent play → clear yield, seek ancla, play', () => {
  const base = {
    ...initialState(),
    intent: 'play',
    focus: 'yielded',
    trackId: 't1',
    yieldPosition: 33,
    yieldTrackId: 't1',
    livePosition: 1,
    srcStatus: 'ready',
  };
  const { state, effects } = reduce(base, {
    type: 'DOC_VISIBLE',
    currentTime: 1,
  });
  assert.equal(state.focus, 'own');
  assert.ok(hasEffect(effects, 'seek') || hasEffect(effects, 'play'));
  assert.ok(hasEffect(effects, 'play'));
  const seek = effectsOfType(effects, 'seek')[0];
  if (seek) assert.equal(seek.position, 33);
});

// ── USER_PAUSE ──

test('USER_PAUSE: intent pause, focus own, pause effect, no yield anchors', () => {
  const base = {
    ...initialState(),
    intent: 'play',
    focus: 'yielded',
    trackId: 't1',
    yieldPosition: 20,
    yieldTrackId: 't1',
    srcStatus: 'ready',
  };
  const { state, effects } = reduce(base, { type: 'USER_PAUSE' });
  assert.equal(state.intent, 'pause');
  assert.equal(state.focus, 'own');
  assert.equal(state.yieldPosition, null);
  assert.ok(hasEffect(effects, 'pause'));
  assert.ok(!hasEffect(effects, 'play'));
});

// ── selectPlaySync integration ──

test('selectPlaySync: yielded+hidden=noop; own+hidden+play+ready=soft-play', () => {
  assert.equal(
    selectPlaySync(
      { intent: 'play', focus: 'yielded', srcStatus: 'ready' },
      { visible: false },
    ),
    'noop',
  );
  assert.equal(
    selectPlaySync(
      { intent: 'play', focus: 'own', srcStatus: 'ready' },
      { visible: false },
    ),
    'soft-play',
  );
  assert.equal(
    selectPlaySync(
      { intent: 'play', focus: 'own', srcStatus: 'none' },
      { visible: true },
    ),
    'noop',
  );
  assert.equal(
    selectPlaySync(
      { intent: 'pause', focus: 'own', srcStatus: 'ready' },
      { visible: true },
    ),
    'pause',
  );
});
