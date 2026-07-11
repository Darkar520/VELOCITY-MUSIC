/**
 * Continuidad de audio (móvil / multi-navegador) — decisiones puras.
 *
 * Escenarios (todos los browsers: Chrome, Brave, Edge, Opera, Firefox, Safari iOS…):
 *
 * A) Usuario SALE de la app / apaga pantalla
 *    → la música DEBE seguir. Chrome a menudo dispara pause al ocultar;
 *      hay que reintentar soft play() en background (keep-alive).
 *
 * B) Otro media (YouTube/FB) roba el audio
 *    → keep-alive falla o el OS re-pausa; entonces Media Session = paused
 *      y se guarda el segundo. Al volver / recuperar foco → reanudar ahí.
 *
 * C) Avance de cola en background
 *    → soft play + URL pre-firmada; NUNCA forceReacquire/load en hidden.
 */

/** ¿La página está en primer plano? */
export function isDocumentVisible(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return true;
  return doc.visibilityState === 'visible';
}

/**
 * Estrategia al sincronizar playSrc/playing con el <audio>.
 * @returns {'soft-play'|'pause'|'noop'}
 *
 * Siempre soft-play si el usuario quiere reproducir (también en background).
 * force-reacquire NUNCA desde aquí — solo tryResume en foreground.
 */
export function playSyncStrategy({ playing, hasSrc }) {
  if (!hasSrc) return 'noop';
  if (!playing) return 'pause';
  return 'soft-play';
}

/**
 * ¿Reanudar al volver a primer plano?
 */
export function shouldResumeOnForeground({
  userWantsPlay,
  audioEnded,
  audioPaused,
  volume,
  targetVolume,
  systemPaused,
  timeStuck,
}) {
  if (!userWantsPlay || audioEnded) return false;
  if (systemPaused) return true;
  if (audioPaused) return true;
  if (typeof volume === 'number' && typeof targetVolume === 'number' && targetVolume > 0 && volume < targetVolume * 0.5) {
    return true;
  }
  if (timeStuck) return true;
  return true;
}

/**
 * Media Session en la notificación.
 * - playing + no interrupción confirmada → 'playing' (sigue en bg / pantalla off)
 * - interrupción confirmada (vídeo robó audio) → 'paused'
 * - usuario pausó → 'paused'
 */
export function mediaSessionPlaybackState({ userWantsPlay, systemInterrupted }) {
  if (!userWantsPlay) return 'paused';
  if (systemInterrupted) return 'paused';
  return 'playing';
}

/**
 * Tras un pause externo: ¿marcar ya como “vídeo robó el audio” o seguir en keep-alive?
 * keepAliveAttempt: 0..N (intentos de soft play en background)
 * stillPaused: el audio sigue pausado después del intento
 * maxAttempts: tras esto → interrupción confirmada
 */
export function shouldConfirmMediaFocusLoss({ stillPaused, userWantsPlay, keepAliveAttempt, maxAttempts = 6 }) {
  if (!userWantsPlay || !stillPaused) return false;
  return keepAliveAttempt >= maxAttempts;
}

/** Delays (ms) para keep-alive multi-browser tras pause externo / hide. */
export function backgroundKeepAliveDelays() {
  // 0 inmediato (Chrome hide), luego reintentos escalonados; ~2.5s total.
  return [0, 40, 120, 300, 700, 1500, 2500];
}

export function shouldRestoreInterruptPosition(currentTime, savedPosition, thresholdSec = 1) {
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < 0) return false;
  if (!Number.isFinite(currentTime)) return true;
  return Math.abs(currentTime - savedPosition) > thresholdSec;
}

/** forceReacquire solo en foreground. */
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
