const MAX_SAMPLES = 100;

/** Bounded, in-memory timings from a play request to the native playing result. */
export function createPlaybackStartRecorder(now = () => globalThis.performance?.now?.() ?? Date.now()) {
  let startedAt = null;
  const samples = [];

  return {
    begin({ onlyIfMissing = false } = {}) {
      if (!onlyIfMissing || startedAt === null) startedAt = now();
    },
    cancel() { startedAt = null; },
    finish() {
      if (startedAt === null) return null;
      const endedAt = now();
      const sample = { startedAt, endedAt, durationMs: Math.max(0, endedAt - startedAt) };
      startedAt = null;
      samples.push(sample.durationMs);
      if (samples.length > MAX_SAMPLES) samples.shift();
      return sample;
    },
    snapshot() { return [...samples]; },
  };
}

const recorder = createPlaybackStartRecorder();

export function beginPlaybackStartMeasurement(options) {
  recorder.begin(options);
}

export function cancelPlaybackStartMeasurement() {
  recorder.cancel();
}

export function finishPlaybackStartMeasurement() {
  const sample = recorder.finish();
  if (!sample || !globalThis.performance?.measure) return sample?.durationMs ?? null;
  try {
    globalThis.performance.clearMeasures('velocity.playback-start');
    globalThis.performance.measure('velocity.playback-start', {
      start: sample.startedAt,
      end: sample.endedAt,
    });
  } catch { /* measurement must never affect playback */ }
  return sample.durationMs;
}

export function getPlaybackStartSamples() {
  return recorder.snapshot();
}
