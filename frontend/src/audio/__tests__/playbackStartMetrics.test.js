import { describe, expect, it } from 'vitest';
import { createPlaybackStartRecorder } from '../playbackStartMetrics.js';

describe('playback start measurements', () => {
  it('measures the interval from request to native playback', () => {
    let now = 10;
    const recorder = createPlaybackStartRecorder(() => now);
    recorder.begin();
    now = 42;
    expect(recorder.finish()).toEqual({ startedAt: 10, endedAt: 42, durationMs: 32 });
    expect(recorder.snapshot()).toEqual([32]);
    expect(recorder.finish()).toBeNull();
  });

  it('preserves an existing automatic transition timestamp and cancels paused attempts', () => {
    let now = 100;
    const recorder = createPlaybackStartRecorder(() => now);
    recorder.begin();
    now = 120;
    recorder.begin({ onlyIfMissing: true });
    now = 150;
    expect(recorder.finish()?.durationMs).toBe(50);
    recorder.begin();
    now = 180;
    recorder.cancel();
    expect(recorder.finish()).toBeNull();
  });

  it('bounds retained samples', () => {
    let now = 0;
    const recorder = createPlaybackStartRecorder(() => now);
    for (let i = 0; i < 105; i += 1) {
      recorder.begin();
      now += 1;
      recorder.finish();
    }
    expect(recorder.snapshot()).toHaveLength(100);
    expect(recorder.snapshot()[0]).toBe(1);
  });
});
