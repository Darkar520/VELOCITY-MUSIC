import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  shouldYieldOnExternalPause,
  mediaSessionPlaybackState,
  shouldRestoreInterruptPosition,
  canRestoreInterruptPosition,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  hideRecoverDelays,
  parseSessionResume,
  shouldApplySessionResume,
  isStreamUrlFresh,
  isAudioPipelineDead,
} from '../frontend/src/audioContinuity.js';

test('playSyncStrategy: A7 — no play oculto SOLO si yielded; next en lock SÍ play', () => {
  // Cedimos a Instagram y seguimos ocultos → no pelear
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: true, visible: false,
  }), 'noop');
  // Música normal con pantalla bloqueada (next/autoplay) → soft-play
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: false,
  }), 'soft-play', 'next desde lock DEBE poder play()');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: true,
  }), 'soft-play');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: true, visible: true,
  }), 'soft-play', 'visible + cedimos → reanudar');
  assert.equal(playSyncStrategy({
    playing: false, hasSrc: true, yieldedFocus: false, visible: true,
  }), 'pause');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: false, yieldedFocus: false, visible: false,
  }), 'noop');
});

test('shouldYieldOnExternalPause: ceder YA en background', () => {
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), true);
  assert.equal(shouldYieldOnExternalPause({
    hidden: false, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false);
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: true, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false);
});

test('hideRecoverDelays vacío', () => {
  assert.deepEqual(hideRecoverDelays(), []);
});

test('mediaSessionPlaybackState', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: true }), 'paused');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: false }), 'playing');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: false, yieldedFocus: false }), 'paused');
});

test('A14: isAudioPipelineDead — detección, no esperanza', () => {
  // Zombie: !paused, buffer lleno y reloj congelado → pipeline cortado.
  assert.equal(isAudioPipelineDead({
    userWantsPlay: true, yieldedFocus: false, paused: false,
    currentTime: 90, readyState: 4, stallMs: 5000,
  }), true);
  // Pause externo (evento perdido o no): también es muerte del pipeline.
  assert.equal(isAudioPipelineDead({
    userWantsPlay: true, yieldedFocus: false, paused: true,
    currentTime: 90, readyState: 4, stallMs: 0,
  }), true);
  // Sano: reloj avanzó hace poco.
  assert.equal(isAudioPipelineDead({
    userWantsPlay: true, yieldedFocus: false, paused: false,
    currentTime: 90, readyState: 4, stallMs: 1000,
  }), false);
  // Red lenta (sin buffer) NO es pipeline muerto.
  assert.equal(isAudioPipelineDead({
    userWantsPlay: true, yieldedFocus: false, paused: false,
    currentTime: 90, readyState: 2, stallMs: 60000,
  }), false);
  // Pista arrancando (currentTime≈0) no es zombie.
  assert.equal(isAudioPipelineDead({
    userWantsPlay: true, yieldedFocus: false, paused: false,
    currentTime: 0.2, readyState: 4, stallMs: 60000,
  }), false);
  // Estados honestos: usuario pausó / ya cedimos / terminó / selfPause.
  for (const patch of [
    { userWantsPlay: false }, { yieldedFocus: true }, { ended: true }, { selfPause: true },
  ]) {
    assert.equal(isAudioPipelineDead({
      userWantsPlay: true, yieldedFocus: false, paused: true,
      currentTime: 90, readyState: 4, stallMs: 60000, ...patch,
    }), false, JSON.stringify(patch));
  }
});

test('A10: canRestoreInterruptPosition solo con yield activo', () => {
  // Sin yield: NUNCA restaurar (seek a 0 y pistas nuevas no se clavan al min 2)
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: false, currentTime: 0, savedPosition: 154,
  }), false);
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: false, currentTime: 5, savedPosition: 154,
  }), false);
  // Con yield y rebobinado real: sí
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: true, currentTime: 1, savedPosition: 154,
  }), true);
  // Con yield pero ya en posición: no
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: true, currentTime: 154, savedPosition: 154,
  }), false);
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: true, currentTime: 39.5, savedPosition: 40,
  }), false);
});

test('shouldRestoreInterruptPosition legacy (sin active flag) sigue midiendo rebobinado', () => {
  assert.equal(shouldRestoreInterruptPosition(5, 5), false);
  assert.equal(shouldRestoreInterruptPosition(1, 40), true);
  assert.equal(shouldRestoreInterruptPosition(0, 154, { active: false }), false);
  assert.equal(shouldRestoreInterruptPosition(0, 154, { active: true }), true);
});

test('shouldResumeOnForeground / canForceReacquire / isExternalPause', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    systemPaused: true, timeStuck: false, volume: 1, targetVolume: 1,
  }), true);
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: false,
    systemPaused: false, timeStuck: false, volume: 1, targetVolume: 1,
  }), false);
  assert.equal(canForceReacquire(false), false);
  assert.equal(canForceReacquire(true), true);
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
});

test('A12: session resume — parse y apply (cerrar app y volver al segundo N)', () => {
  assert.equal(parseSessionResume(null), null);
  assert.equal(parseSessionResume({ track: { id: 'x' }, t: 0 }), null);
  assert.equal(parseSessionResume({ track: { id: 'x' }, t: 1 }), null);
  assert.deepEqual(parseSessionResume({ track: { id: 'aerials' }, t: 50 }), {
    trackId: 'aerials', position: 50,
  });

  // Misma pista, audio en 0, guardado en 50 → seek
  assert.equal(shouldApplySessionResume({
    trackId: 'aerials', resumeTrackId: 'aerials', resumePosition: 50, currentTime: 0,
  }), true);
  // Ya en ~50 → no tocar
  assert.equal(shouldApplySessionResume({
    trackId: 'aerials', resumeTrackId: 'aerials', resumePosition: 50, currentTime: 50.2,
  }), false);
  // Ya más adelante → no rebobinar
  assert.equal(shouldApplySessionResume({
    trackId: 'aerials', resumeTrackId: 'aerials', resumePosition: 50, currentTime: 80,
  }), false);
  // Otra pista → no
  assert.equal(shouldApplySessionResume({
    trackId: 'lonely', resumeTrackId: 'aerials', resumePosition: 50, currentTime: 0,
  }), false);
});

test('A13: isStreamUrlFresh — no restaurar URL firmada caducada', () => {
  const now = 1_700_000_000;
  assert.equal(isStreamUrlFresh(null), false);
  assert.equal(isStreamUrlFresh('blob:http://x/1'), true);
  assert.equal(isStreamUrlFresh('/api/stream-proxy?artist=a&title=b'), false, 'sin exp');
  assert.equal(isStreamUrlFresh(`/api/stream-proxy?exp=${now + 10}&sig=x`, now, 45), false, 'expira pronto');
  assert.equal(isStreamUrlFresh(`/api/stream-proxy?exp=${now + 120}&sig=x`, now, 45), true);
});
