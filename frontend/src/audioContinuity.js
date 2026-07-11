/**
 * Continuidad de audio — política estable (Chrome prioritario).
 *
 * ─────────────────────────────────────────────────────────────
 * REGLA DE ORO: NUNCA pelear el foco de audio en bucle en background.
 * Eso silencia Facebook/YouTube o superpone música + vídeo.
 * ─────────────────────────────────────────────────────────────
 *
 * A) App oculta y el audio SIGUE (pantalla off típica en Chrome)
 *    → no tocar. Media Session debe reportar playing + next/prev.
 *
 * B) App oculta y llega un pause (Chrome al salir / otra app)
 *    → un soft play puntual (recuperar hide de Chrome).
 *    → si nos vuelven a pausar en <1.5s → CEDER (vídeo FB/YT).
 *    → al ceder: pause firme, Media Session paused, posición guardada.
 *
 * C) Usuario vuelve a Velocity (visible)
 *    → reanudar desde posición guardada.
 *
 * D) Restaurar posición solo si el browser REBOBINÓ.
 */

export function isDocumentVisible(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return true;
  return doc.visibilityState === 'visible';
}

export function playSyncStrategy({ playing, hasSrc }) {
  if (!hasSrc) return 'noop';
  if (!playing) return 'pause';
  return 'soft-play';
}

/** Un solo reintento temprano al hide (no una lista larga). */
export function hideRecoverDelays() {
  return [0, 200];
}

/**
 * Tras un soft-play en background, si llega OTRO pause pronto → ceder foco.
 * Evita superposición música+vídeo y deja sonar Facebook/YouTube.
 */
export function shouldYieldOnRePause({
  hidden,
  userWantsPlay,
  alreadyYielded,
  msSinceLastBackgroundPlay,
  rePauseWindowMs = 1600,
}) {
  if (!hidden || !userWantsPlay || alreadyYielded) return false;
  if (msSinceLastBackgroundPlay == null || msSinceLastBackgroundPlay < 0) return false;
  return msSinceLastBackgroundPlay < rePauseWindowMs;
}

export function shouldYieldAudioFocus({ attemptIndex, maxAttempts, stillPaused, userWantsPlay }) {
  if (!userWantsPlay || !stillPaused) return false;
  return attemptIndex >= maxAttempts;
}

export function mediaSessionPlaybackState({ userWantsPlay, yieldedFocus }) {
  if (!userWantsPlay) return 'paused';
  if (yieldedFocus) return 'paused';
  return 'playing';
}

export function shouldRestoreInterruptPosition(currentTime, savedPosition, thresholdSec = 1.25) {
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < 0) return false;
  if (!Number.isFinite(currentTime)) return true;
  return currentTime < savedPosition - thresholdSec;
}

export function shouldResumeOnForeground({
  userWantsPlay,
  audioEnded,
  audioPaused,
  systemPaused,
  timeStuck,
  volume,
  targetVolume,
}) {
  if (!userWantsPlay || audioEnded) return false;
  if (systemPaused || audioPaused || timeStuck) return true;
  if (typeof volume === 'number' && typeof targetVolume === 'number' && targetVolume > 0 && volume < targetVolume * 0.5) {
    return true;
  }
  return true;
}

export function canForceReacquire(visible) {
  return visible === true;
}

export function isExternalPause({ selfPause, pendingFade, userWantsPlay, audioEnded }) {
  if (selfPause || pendingFade) return false;
  if (audioEnded) return false;
  return userWantsPlay === true;
}

export function shouldFadeIn(visible) {
  return visible === true;
}

export function shouldSuspendPreloads(visible) {
  return visible === false;
}

export function shouldPreExtendQueue(currentIndex, queueLength) {
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) return false;
  return currentIndex >= queueLength - 2;
}
