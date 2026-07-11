/**
 * Continuidad de audio (móvil / multi-navegador) — decisiones puras.
 *
 * Invariantes (docs/GUARDRAILS.md §3 + anti-regresión):
 * 1. Un solo <audio> principal reproduce. Preloads NO deben tocar Media Session.
 * 2. En background (document hidden): SOLO soft play(). NUNCA pause+load+play
 *    ni forceReacquire (Chrome mata la sesión de media).
 * 3. Interrupción por vídeo (YT/FB): intención de play se mantiene, pero
 *    Media Session muestra PAUSED y se congela la posición. Al recuperar el
 *    foco (visible / play del OS) se reanuda desde el segundo guardado.
 * 4. No poner volume=0 (fade) si la página no está visible (rAF se congela → silencio).
 * 5. Avance de cola en background debe ser síncrono si hay URL pre-firmada (peek).
 */

/** ¿La página está en primer plano (seguro para re-adquirir sesión)? */
export function isDocumentVisible(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return true;
  return doc.visibilityState === 'visible';
}

/**
 * Estrategia al sincronizar playSrc/playing con el <audio>.
 * @returns {'soft-play'|'force-reacquire'|'pause'|'noop'}
 *
 * Si estamos en interrupción por vídeo y la app sigue oculta, NO pelear con
 * el OS (noop). Al volver a visible, tryResume reanuda desde la posición guardada.
 */
export function playSyncStrategy({ playing, visible, audioPaused, hasSrc, systemInterrupted }) {
  if (!hasSrc) return 'noop';
  if (!playing) return 'pause';
  // Interrumpidos por vídeo/otra app y aún en background: no forzar play.
  if (systemInterrupted && !visible) return 'noop';
  // Soft-play al arrancar/cambiar src. force-reacquire solo en tryResume visible.
  return 'soft-play';
}

/**
 * ¿Debemos reanudar al recuperar el foco (visible / OS devolvió audio)?
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
  // Nudge suave al volver (zombie silencioso tras vídeo).
  return true;
}

/**
 * Estado de la barra de notificación (Media Session).
 * Durante interrupción por vídeo debe ser 'paused' aunque la intención sea play,
 * para que no “cuenten” los segundos mientras el audio está detenido.
 */
export function mediaSessionPlaybackState({ userWantsPlay, systemInterrupted }) {
  if (!userWantsPlay) return 'paused';
  if (systemInterrupted) return 'paused';
  return 'playing';
}

/**
 * Si el navegador rebobinó/desvió currentTime tras la interrupción,
 * hay que restaurar la posición guardada (umbral en segundos).
 */
export function shouldRestoreInterruptPosition(currentTime, savedPosition, thresholdSec = 1) {
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < 0) return false;
  if (!Number.isFinite(currentTime)) return true;
  return Math.abs(currentTime - savedPosition) > thresholdSec;
}

/** ¿Es seguro llamar forceReacquire (pause+play)? Solo foreground. */
export function canForceReacquire(visible) {
  return visible === true;
}

/**
 * ¿El pause del <audio> viene del sistema/otra media (no de nosotros)?
 * En ese caso NO debemos setPlaying(false): el usuario no pausó.
 */
export function isExternalPause({ selfPause, pendingFade, userWantsPlay, audioEnded }) {
  if (selfPause || pendingFade) return false;
  if (audioEnded) return false;
  return userWantsPlay === true;
}

/** ¿Iniciar pista con fundido (volume 0 → vol)? Solo en visible. */
export function shouldFadeIn(visible) {
  return visible === true;
}

/**
 * ¿Pausar/limpiar pre-buffers al ir a background?
 * Evita que Chrome confunda Media Session con 3 elementos <audio>.
 */
export function shouldSuspendPreloads(visible) {
  return visible === false;
}

/**
 * ¿Extender la cola ya (antes de acabar la pista)?
 * true si estamos en la última o penúltima canción.
 */
export function shouldPreExtendQueue(currentIndex, queueLength) {
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) return false;
  return currentIndex >= queueLength - 2;
}
