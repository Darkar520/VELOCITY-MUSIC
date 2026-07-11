/**
 * Continuidad de audio — política Chrome-first (sin pelear el foco).
 *
 * ═══════════════════════════════════════════════════════════════
 * SUPERPOSICIÓN (A7) — causa raíz y fix definitivo:
 *
 * En Chrome, llamar play() mientras document.hidden (soft-recover
 * tras pause) RECLAMA el foco de audio. Resultado típico:
 *   1) un momento suenan música + vídeo Instagram/Facebook
 *   2) ~1–2 s después el vídeo se corta y queda solo Velocity
 *
 * Brave suele pausar/ceder mejor; Chrome no. Por eso NUNCA soft-play
 * en background.
 *
 * Política:
 *  1) Oculto + audio SIGUE (!paused) → no tocar (pantalla off / lock).
 *  2) Pause externo mientras oculto → CEDER YA (pause firme, MS paused).
 *  3) Visible + intención play → reanudar desde ancla (tryResume / soft-play).
 *  4) NUNCA play() / kick / recover con document.hidden.
 * ═══════════════════════════════════════════════════════════════
 */

export function isDocumentVisible(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return true;
  return doc.visibilityState === 'visible';
}

/**
 * Qué debe hacer el efecto de sincronización del <audio>.
 * visible debe ser boolean estricto: solo soft-play si visible === true.
 */
export function playSyncStrategy({ playing, hasSrc, yieldedFocus, visible }) {
  if (!hasSrc) return 'noop';
  if (!playing) return 'pause';
  // Nunca play() en background: roba Instagram/FB en Chrome.
  if (visible !== true) return 'noop';
  // yieldedFocus en visible: soft-play para reanudar al volver a la app.
  void yieldedFocus;
  return 'soft-play';
}

/**
 * ¿Ceder el foco ante un pause externo?
 * Solo en background. En foreground puede ser ducking momentáneo → softKick.
 */
export function shouldYieldOnExternalPause({
  hidden,
  userWantsPlay,
  selfPause,
  pendingFade,
  audioEnded,
  alreadyYielded,
}) {
  if (selfPause || pendingFade || audioEnded) return false;
  if (!userWantsPlay) return false;
  if (alreadyYielded) return false;
  return hidden === true;
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
  // Visible + intención play + ya sonando: no forzar play() extra.
  return false;
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

// --- Legacy exports: comportamiento seguro (no soft-play en hide) ---
/** @deprecated Siempre [] — no hay soft-recover en background. */
export function hideRecoverDelays() {
  return [];
}
/** @deprecated Prefer shouldYieldOnExternalPause. */
export function shouldYieldAudioFocus() {
  return true;
}
/** @deprecated Prefer shouldYieldOnExternalPause (ceder al primer pause oculto). */
export function shouldYieldOnRePause() {
  return true;
}
