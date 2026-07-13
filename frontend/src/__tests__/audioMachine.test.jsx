import { describe, it, expect } from 'vitest';
import { reduce, initialState, selectPlaySync } from '../audio/audioMachine.js';

describe('audioMachine reduce', () => {
  it('initialState: pausado, sin yield, sin src', () => {
    const s = initialState();
    expect(s.intent).toBe('pause');
    expect(s.focus).toBe('own');
    expect(s.srcStatus).toBe('none');
    expect(s.trackId).toBeNull();
  });

  describe('TRACK_SET', () => {
    it('clearSrc effect + intent=play → ensureStream + syncReact', () => {
      const { state, effects } = reduce(initialState(), { type: 'TRACK_SET', trackId: 't1', intent: 'play' });
      expect(state.trackId).toBe('t1');
      expect(state.intent).toBe('play');
      expect(state.srcStatus).toBe('none');
      const types = effects.map((e) => e.type);
      expect(types).toContain('clearSrc');
      expect(types).toContain('ensureStream');
      expect(types).toContain('syncReact');
    });

    it('intent=pause → no ensureStream', () => {
      const { effects } = reduce(initialState(), { type: 'TRACK_SET', trackId: 't1', intent: 'pause' });
      const types = effects.map((e) => e.type);
      expect(types).toContain('clearSrc');
      expect(types).not.toContain('ensureStream');
    });
  });

  describe('STREAM_READY', () => {
    it('setSrc + seek + play cuando intent=play', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'none' };
      const { state, effects } = reduce(s0, { type: 'STREAM_READY', trackId: 't1', url: 'https://example.com/a.mp3' });
      expect(state.srcStatus).toBe('ready');
      const types = effects.map((e) => e.type);
      expect(types).toContain('setSrc');
      expect(types).toContain('play');
      expect(types).toContain('seek');
    });

    it('solo setSrc cuando intent=pause', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'pause', srcStatus: 'none' };
      const { effects } = reduce(s0, { type: 'STREAM_READY', trackId: 't1', url: 'https://example.com/a.mp3' });
      const types = effects.map((e) => e.type);
      expect(types).toContain('setSrc');
      expect(types).not.toContain('play');
    });

    it('ignora trackId diferente', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'none' };
      const { state, effects } = reduce(s0, { type: 'STREAM_READY', trackId: 't2', url: 'https://example.com/b.mp3' });
      expect(state.srcStatus).toBe('none');
      expect(effects).toHaveLength(0);
    });

    it('no setea loadingAudio:false en syncReact (bug fix cc2f2cb)', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'none' };
      const { effects } = reduce(s0, { type: 'STREAM_READY', trackId: 't1', url: 'https://example.com/a.mp3' });
      const syncReact = effects.find((e) => e.type === 'syncReact');
      expect(syncReact.patch.loadingAudio).toBeUndefined();
    });
  });

  describe('USER_PLAY', () => {
    it('srcStatus=ready → play + seek', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'pause', srcStatus: 'ready' };
      const { state, effects } = reduce(s0, { type: 'USER_PLAY' });
      expect(state.intent).toBe('play');
      const types = effects.map((e) => e.type);
      expect(types).toContain('play');
    });

    it('srcStatus=none → ensureStream', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'pause', srcStatus: 'none' };
      const { effects } = reduce(s0, { type: 'USER_PLAY' });
      const types = effects.map((e) => e.type);
      expect(types).toContain('ensureStream');
    });

    it('sin trackId → no-op', () => {
      const { effects } = reduce(initialState(), { type: 'USER_PLAY' });
      expect(effects).toHaveLength(0);
    });
  });

  describe('USER_PAUSE', () => {
    it('pause + mediaSession + syncReact', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'ready' };
      const { state, effects } = reduce(s0, { type: 'USER_PAUSE' });
      expect(state.intent).toBe('pause');
      const types = effects.map((e) => e.type);
      expect(types).toContain('pause');
      expect(types).toContain('mediaSession');
    });
  });

  describe('USER_SEEK', () => {
    it('seek + syncReact + limpia anclas', () => {
      const s0 = { ...initialState(), trackId: 't1', yieldPosition: 30, sessionPosition: 20 };
      const { state, effects } = reduce(s0, { type: 'USER_SEEK', position: 45 });
      expect(state.livePosition).toBe(45);
      expect(state.yieldPosition).toBeNull();
      expect(state.sessionPosition).toBeNull();
      const types = effects.map((e) => e.type);
      expect(types).toContain('seek');
    });
  });

  describe('EXTERNAL_PAUSE', () => {
    it('hidden + userWantsPlay → yield', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'ready' };
      const { state, effects } = reduce(s0, { type: 'EXTERNAL_PAUSE', hidden: true, selfPause: false, position: 30 });
      expect(state.focus).toBe('yielded');
      expect(state.yieldPosition).toBe(30);
      const types = effects.map((e) => e.type);
      expect(types).toContain('pause');
    });

    it('foreground → no yield (ducking)', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'ready' };
      const { state } = reduce(s0, { type: 'EXTERNAL_PAUSE', hidden: false, selfPause: false, position: 30 });
      expect(state.focus).toBe('own');
    });
  });

  describe('DOC_VISIBLE', () => {
    it('yielded + intent=play → seek + play', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', focus: 'yielded', yieldPosition: 25, srcStatus: 'ready' };
      const { state, effects } = reduce(s0, { type: 'DOC_VISIBLE', currentTime: 0 });
      expect(state.focus).toBe('own');
      expect(state.yieldPosition).toBeNull();
      const types = effects.map((e) => e.type);
      expect(types).toContain('play');
    });

    it('!yielded + src=ready → re-assert play', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', focus: 'own', srcStatus: 'ready' };
      const { effects } = reduce(s0, { type: 'DOC_VISIBLE', currentTime: 10 });
      const types = effects.map((e) => e.type);
      expect(types).toContain('play');
    });
  });

  describe('PLAYING', () => {
    it('actualiza livePosition', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'ready' };
      const { state } = reduce(s0, { type: 'PLAYING', position: 15.5 });
      expect(state.livePosition).toBe(15.5);
    });

    it('ignora trackId diferente', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'ready' };
      const { state } = reduce(s0, { type: 'PLAYING', position: 15, trackId: 't2' });
      expect(state.livePosition).toBe(0);
    });

    it('srcStatus=none → ignora (TRACK_SET sin src)', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'none' };
      const { state } = reduce(s0, { type: 'PLAYING', position: 15 });
      expect(state.livePosition).toBe(0);
    });
  });

  describe('PLAY_FAILED', () => {
    it('intent=play → ensureStream (retry)', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', srcStatus: 'ready' };
      const { effects } = reduce(s0, { type: 'PLAY_FAILED', reason: 'test' });
      const types = effects.map((e) => e.type);
      expect(types).toContain('ensureStream');
    });

    it('intent=pause → clearSrc, no retry', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'pause', srcStatus: 'stale' };
      const { state, effects } = reduce(s0, { type: 'PLAY_FAILED', reason: 'stale' });
      expect(state.intent).toBe('pause');
      const types = effects.map((e) => e.type);
      expect(types).toContain('clearSrc');
      expect(types).not.toContain('ensureStream');
    });
  });

  describe('ENDED', () => {
    it('limpia anclas', () => {
      const s0 = { ...initialState(), trackId: 't1', intent: 'play', yieldPosition: 30, sessionPosition: 20 };
      const { state } = reduce(s0, { type: 'ENDED' });
      expect(state.livePosition).toBe(0);
      expect(state.yieldPosition).toBeNull();
      expect(state.sessionPosition).toBeNull();
    });
  });

  describe('HYDRATE', () => {
    it('restaura posición y clearSrc si urlFresh=false', () => {
      const { state, effects } = reduce(initialState(), { type: 'HYDRATE', trackId: 't1', position: 45, urlFresh: false });
      expect(state.trackId).toBe('t1');
      expect(state.livePosition).toBe(45);
      expect(state.sessionPosition).toBe(45);
      const types = effects.map((e) => e.type);
      expect(types).toContain('clearSrc');
    });

    it('urlFresh=true → no clearSrc', () => {
      const { effects } = reduce(initialState(), { type: 'HYDRATE', trackId: 't1', position: 45, urlFresh: true });
      const types = effects.map((e) => e.type);
      expect(types).not.toContain('clearSrc');
    });
  });
});

describe('selectPlaySync', () => {
  it('playing + hasSrc + visible → soft-play', () => {
    const s = { ...initialState(), intent: 'play', srcStatus: 'ready' };
    expect(selectPlaySync(s, { visible: true })).toBe('soft-play');
  });
  it('yielded + hidden → noop', () => {
    const s = { ...initialState(), intent: 'play', srcStatus: 'ready', focus: 'yielded' };
    expect(selectPlaySync(s, { visible: false })).toBe('noop');
  });
});
