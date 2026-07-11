/**
 * Continuidad de audio multi-navegador (prioriza Chrome Android).
 *
 * Reglas simples (sin pelear el foco de audio):
 *
 * 1) Usuario SALE de Velocity / apaga pantalla
 *    → 1–2 soft play inmediatos (Chrome a menudo pause-a al hide).
 *    → Si se recupera, Media Session = playing.
 *    → Si sigue pausado, CEDER (otro app puede tener vídeo). No reintentar en bucle.
 *
 * 2) Usuario en Facebook/YouTube (vídeo)
 *    → NUNCA reintentar play en background cada segundo (silencia el vídeo).
 *    → Notificación paused + posición guardada.
 *
 * 3) Usuario VUELVE a Velocity
 *    → reanudar desde el segundo guardado.
 *
 * 4) NUNCA load() en background. Soft kick (pause+play) solo en foreground o 1 vez al hide.
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

/** Soft play al ocultar: solo intentos tempranos (ms). */
export function hideRecoverDelays() {
  return [0, 180];
}

/**
 * Tras estos intentos, si sigue pausado → ceder foco (vídeo u otra app).
 * No seguir atacando play() en background.
 */
export function shouldYieldAudioFocus({ attemptIndex, maxAttempts, stillPaused, userWantsPlay }) {
  if (!userWantsPlay || !stillPaused) return false;
  return attemptIndex >= maxAttempts;
}

export function mediaSessionPlaybackState({ userWantsPlay, yieldedFocus }) {
  if (!userWantsPlay) return 'paused';
  if (yieldedFocus) return 'paused';
  return 'playing';
}

/** Solo restaurar si rebobinó por detrás del ancla. */
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
