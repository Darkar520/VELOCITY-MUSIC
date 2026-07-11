/**
 * Continuidad de audio (móvil / multi-navegador) — decisiones puras.
 *
 * Invariantes (docs/GUARDRAILS.md §3 + anti-regresión):
 * 1. Un solo <audio> principal reproduce. Preloads NO deben tocar Media Session.
 * 2. En background (document hidden): SOLO soft play(). NUNCA pause+load+play
 *    ni forceReacquire (Chrome mata la sesión de media).
 * 3. Tras vídeo/otra app: el OS puede pausar o dejar zombie silencioso.
 *    playingRef se mantiene true; al volver a visible → restaurar volumen + play.
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
 */
export function playSyncStrategy({ playing, visible, audioPaused, hasSrc }) {
  if (!hasSrc) return 'noop';
  if (!playing) return 'pause';
  // Siempre soft-play al arrancar/cambiar src. force-reacquire SOLO se usa
  // desde tryResume en foreground tras fallo de soft-play o zombie.
  if (visible) return 'soft-play';
  // Background: soft-play únicamente (Chrome/Brave/Edge/Opera).
  return 'soft-play';
}

/**
 * ¿Debemos intentar reanudar al volver a primer plano?
 * Cubré: pause del OS, zombie silencioso (playing pero tiempo quieto), volume 0.
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
  // Nudge suave al volver (puede estar "playing" sin audio real tras un vídeo).
  return true;
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
