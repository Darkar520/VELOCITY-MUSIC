/**
 * Continuidad de audio multi-navegador (móvil).
 *
 * A) Salir de la app / apagar pantalla → debe SEGUIR (Chrome a menudo pausa o deja zombie).
 * B) Zombie = playing pero currentTime no avanza → soft kick (pause+play, sin load).
 * C) Vídeo roba audio → tras fallos reales → Media Session paused + posición guardada.
 * D) NUNCA load()/forceReacquire pesado en background.
 * E) Solo restaurar posición si el browser REBOBINÓ (no si estamos en el mismo segundo).
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
  if (systemPaused || audioPaused || timeStuck) return true;
  if (typeof volume === 'number' && typeof targetVolume === 'number' && targetVolume > 0 && volume < targetVolume * 0.5) {
    return true;
  }
  return true;
}

export function mediaSessionPlaybackState({ userWantsPlay, systemInterrupted }) {
  if (!userWantsPlay) return 'paused';
  if (systemInterrupted) return 'paused';
  return 'playing';
}

/**
 * Solo restaurar si rebobinó por detrás del ancla.
 * Si currentTime ≈ saved o va por delante → NO tocar (evita “pegado en el segundo 5”).
 */
export function shouldRestoreInterruptPosition(currentTime, savedPosition, thresholdSec = 1.25) {
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < 0) return false;
  if (!Number.isFinite(currentTime)) return true;
  return currentTime < savedPosition - thresholdSec;
}

/**
 * Zombie: el usuario quiere play, el elemento NO está paused, pero el tiempo no avanza.
 * (Chrome al salir de la app: notificación “playing”, progreso congelado.)
 */
export function isPlaybackZombie({ userWantsPlay, paused, ended, prevTime, currTime, stuckTicks, needTicks = 2 }) {
  if (!userWantsPlay || ended) return false;
  if (paused) return false; // eso es pause real, no zombie
  if (!Number.isFinite(prevTime) || !Number.isFinite(currTime)) return false;
  if (currTime - prevTime > 0.12) return false; // avanza
  return stuckTicks >= needTicks;
}

export function shouldConfirmMediaFocusLoss({ stillPaused, userWantsPlay, keepAliveAttempt, maxAttempts = 5 }) {
  if (!userWantsPlay || !stillPaused) return false;
  return keepAliveAttempt >= maxAttempts;
}

/** Intervalo del watchdog en background (ms). */
export function backgroundWatchIntervalMs() {
  return 1000;
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
