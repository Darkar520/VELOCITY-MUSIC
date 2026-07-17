import { describe, it, expect } from 'vitest';
import {
  playSyncStrategy,
  shouldYieldOnExternalPause,
  shouldRestoreInterruptPosition,
  canRestoreInterruptPosition,
  parseSessionResume,
  shouldApplySessionResume,
  isStreamUrlFresh,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  shouldFadeIn,
  shouldSuspendPreloads,
  shouldPreExtendQueue,
  mediaSessionPlaybackState,
} from '../audioContinuity.js';

describe('playSyncStrategy', () => {
  it('playing + hasSrc + visible → play', () => {
    expect(playSyncStrategy({ playing: true, hasSrc: true, yieldedFocus: false, visible: true })).toBe('soft-play');
  });
  it('playing + yielded + hidden → noop', () => {
    expect(playSyncStrategy({ playing: true, hasSrc: true, yieldedFocus: true, visible: false })).toBe('noop');
  });
  it('playing + !yielded + hidden → soft-play (next desde lock)', () => {
    expect(playSyncStrategy({ playing: true, hasSrc: true, yieldedFocus: false, visible: false })).toBe('soft-play');
  });
  it('!playing → pause', () => {
    expect(playSyncStrategy({ playing: false, hasSrc: true, yieldedFocus: false, visible: true })).toBe('pause');
  });
  it('!hasSrc → noop', () => {
    expect(playSyncStrategy({ playing: true, hasSrc: false, yieldedFocus: false, visible: true })).toBe('noop');
  });
});

describe('shouldYieldOnExternalPause', () => {
  it('hidden + userWantsPlay → true', () => {
    expect(shouldYieldOnExternalPause({ hidden: true, userWantsPlay: true, selfPause: false, pendingFade: false, audioEnded: false, alreadyYielded: false })).toBe(true);
  });
  it('foreground → false', () => {
    expect(shouldYieldOnExternalPause({ hidden: false, userWantsPlay: true, selfPause: false, pendingFade: false, audioEnded: false, alreadyYielded: false })).toBe(false);
  });
  it('selfPause → false', () => {
    expect(shouldYieldOnExternalPause({ hidden: true, userWantsPlay: true, selfPause: true, pendingFade: false, audioEnded: false, alreadyYielded: false })).toBe(false);
  });
  it('alreadyYielded → false', () => {
    expect(shouldYieldOnExternalPause({ hidden: true, userWantsPlay: true, selfPause: false, pendingFade: false, audioEnded: false, alreadyYielded: true })).toBe(false);
  });
  it('!userWantsPlay → false', () => {
    expect(shouldYieldOnExternalPause({ hidden: true, userWantsPlay: false, selfPause: false, pendingFade: false, audioEnded: false, alreadyYielded: false })).toBe(false);
  });
});

describe('canRestoreInterruptPosition', () => {
  it('yielded + currentTime < saved → true', () => {
    expect(canRestoreInterruptPosition({ yieldedFocus: true, currentTime: 10, savedPosition: 50 })).toBe(true);
  });
  it('currentTime ≈ saved → false', () => {
    expect(canRestoreInterruptPosition({ yieldedFocus: true, currentTime: 50, savedPosition: 50 })).toBe(false);
  });
  it('!yielded → false', () => {
    expect(canRestoreInterruptPosition({ yieldedFocus: false, currentTime: 10, savedPosition: 50 })).toBe(false);
  });
});

describe('shouldApplySessionResume', () => {
  it('mismo track + position >= 1.5 + currentTime < session → true', () => {
    expect(shouldApplySessionResume({ trackId: 't1', resumeTrackId: 't1', resumePosition: 30, currentTime: 0 })).toBe(true);
  });
  it('trackId diferente → false', () => {
    expect(shouldApplySessionResume({ trackId: 't1', resumeTrackId: 't2', resumePosition: 30, currentTime: 0 })).toBe(false);
  });
  it('position < 1.5 → false', () => {
    expect(shouldApplySessionResume({ trackId: 't1', resumeTrackId: 't1', resumePosition: 1, currentTime: 0 })).toBe(false);
  });
  it('ya avanzó más allá → false', () => {
    expect(shouldApplySessionResume({ trackId: 't1', resumeTrackId: 't1', resumePosition: 30, currentTime: 35 })).toBe(false);
  });
});

describe('isStreamUrlFresh', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const pastExp = Math.floor(Date.now() / 1000) - 100;

  it('URL con exp futuro → true', () => {
    expect(isStreamUrlFresh(`https://example.com/audio?exp=${futureExp}&sig=abc`)).toBe(true);
  });
  it('URL con exp pasado → false', () => {
    expect(isStreamUrlFresh(`https://example.com/audio?exp=${pastExp}&sig=abc`)).toBe(false);
  });
  it('URL sin exp → false', () => {
    expect(isStreamUrlFresh('https://example.com/audio')).toBe(false);
  });
  it('blob: URL → true', () => {
    expect(isStreamUrlFresh('blob:https://example.com/abc-123')).toBe(true);
  });
  it('data: URL → true', () => {
    expect(isStreamUrlFresh('data:audio/mp4;base64,abc')).toBe(true);
  });
  it('null/vacío → false', () => {
    expect(isStreamUrlFresh(null)).toBe(false);
    expect(isStreamUrlFresh('')).toBe(false);
  });
});

describe('isExternalPause', () => {
  it('selfPause=false + userWantsPlay → true', () => {
    expect(isExternalPause({ selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false })).toBe(true);
  });
  it('selfPause=true → false', () => {
    expect(isExternalPause({ selfPause: true, pendingFade: false, userWantsPlay: true, audioEnded: false })).toBe(false);
  });
  it('pendingFade → false', () => {
    expect(isExternalPause({ selfPause: false, pendingFade: true, userWantsPlay: true, audioEnded: false })).toBe(false);
  });
  it('audioEnded → false', () => {
    expect(isExternalPause({ selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: true })).toBe(false);
  });
});

describe('shouldFadeIn', () => {
  it('visible → true', () => expect(shouldFadeIn(true)).toBe(true));
  it('hidden → false', () => expect(shouldFadeIn(false)).toBe(false));
});

describe('shouldSuspendPreloads', () => {
  it('hidden → true', () => expect(shouldSuspendPreloads(false)).toBe(true));
  it('visible → false', () => expect(shouldSuspendPreloads(true)).toBe(false));
});

describe('shouldPreExtendQueue', () => {
  it('penúltima posición → true', () => {
    expect(shouldPreExtendQueue(3, 5)).toBe(true);
  });
  it('primera posición → false', () => {
    expect(shouldPreExtendQueue(0, 5)).toBe(false);
  });
  it('última posición → true', () => {
    expect(shouldPreExtendQueue(4, 5)).toBe(true);
  });
  it('queue vacío → false', () => {
    expect(shouldPreExtendQueue(0, 0)).toBe(false);
  });
});

describe('parseSessionResume', () => {
  it('extrae trackId y position', () => {
    const r = parseSessionResume({ track: { id: 't1' }, t: 45 });
    expect(r.trackId).toBe('t1');
    expect(r.position).toBe(45);
  });
  it('position < 1.5 → null', () => {
    expect(parseSessionResume({ track: { id: 't1' }, t: 1 })).toBeNull();
  });
  it('sin track → null', () => {
    expect(parseSessionResume(null)).toBeNull();
  });
});

describe('mediaSessionPlaybackState', () => {
  it('!userWantsPlay → paused', () => {
    expect(mediaSessionPlaybackState({ userWantsPlay: false, yieldedFocus: false })).toBe('paused');
  });
  it('yielded → still playing (never tell OS we paused)', () => {
    expect(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: true })).toBe('playing');
  });
  it('playing → playing', () => {
    expect(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: false })).toBe('playing');
  });
});

describe('canForceReacquire', () => {
  it('visible → true', () => expect(canForceReacquire(true)).toBe(true));
  it('hidden → false', () => expect(canForceReacquire(false)).toBe(false));
});

describe('shouldResumeOnForeground', () => {
  it('userWantsPlay + systemPaused → true', () => {
    expect(shouldResumeOnForeground({ userWantsPlay: true, audioEnded: false, audioPaused: false, systemPaused: true, timeStuck: false, volume: 0.85, targetVolume: 0.85 })).toBe(true);
  });
  it('!userWantsPlay → false', () => {
    expect(shouldResumeOnForeground({ userWantsPlay: false, audioEnded: false, audioPaused: false, systemPaused: false, timeStuck: false, volume: 0.85, targetVolume: 0.85 })).toBe(false);
  });
  it('audioEnded → false', () => {
    expect(shouldResumeOnForeground({ userWantsPlay: true, audioEnded: true, audioPaused: false, systemPaused: false, timeStuck: false, volume: 0.85, targetVolume: 0.85 })).toBe(false);
  });
  it('volume < target * 0.5 → true', () => {
    expect(shouldResumeOnForeground({ userWantsPlay: true, audioEnded: false, audioPaused: false, systemPaused: false, timeStuck: false, volume: 0.1, targetVolume: 0.85 })).toBe(true);
  });
});
