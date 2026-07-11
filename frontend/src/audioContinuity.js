/**
 * Continuidad de audio — política Chrome-first.
 *
 * ═══════════════════════════════════════════════════════════════
 * A7 SUPERPOSICIÓN: no llamar play() en background SOLO si ya
 * cedimos el foco (yieldedFocus). Si el usuario pide next/prev
 * desde el lock (intención play, no yielded), SÍ hay que play().
 *
 * A10 ANCLA: restoreInterruptPosition SOLO tras yield real.
 * Nunca clavar posición en seek ni en pistas nuevas.
 * ═══════════════════════════════════════════════════════════════
 */

export function isDocumentVisible(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return true;
  return doc.visibilityState === 'visible';
}

/**
 * Qué debe hacer el efecto de sincronización del <audio>.
 *
 * - pause si el usuario no quiere play
 * - noop si cedimos el altavoz y seguimos ocultos (no pelear a IG/FB)
 * - soft-play en cualquier otro caso con intención play
 *   (incluye next desde lock screen con document.hidden)
 */
export function playSyncStrategy({ playing, hasSrc, yieldedFocus, visible }) {
  if (!hasSrc) return 'noop';
  if (!playing) return 'pause';
  // Solo bloquear play oculto cuando YA cedimos a otra app.
  if (yieldedFocus && visible !== true) return 'noop';
  return 'soft-play';
}

/**
 * ¿Ceder el foco ante un pause externo?
 * Solo en background. En foreground puede ser ducking → softKick.
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

/**
 * ¿Restaurar posición guardada tras interrupción?
 * active=true SOLO cuando hay yield real (systemPaused / mediaInterrupted).
 * Sin active → nunca (evita clavar el seek y pistas nuevas en el min 2).
 */
export function shouldRestoreInterruptPosition(
  currentTime,
  savedPosition,
  thresholdSecOrOpts = 1.25,
) {
  // Compat: (ct, saved, threshold) o (ct, saved, { active, thresholdSec })
  let active = true;
  let thresholdSec = 1.25;
  if (typeof thresholdSecOrOpts === 'object' && thresholdSecOrOpts != null) {
    active = thresholdSecOrOpts.active !== false;
    if (typeof thresholdSecOrOpts.thresholdSec === 'number') {
      thresholdSec = thresholdSecOrOpts.thresholdSec;
    }
  } else if (typeof thresholdSecOrOpts === 'number') {
    thresholdSec = thresholdSecOrOpts;
  }
  // API nueva: si se pasa { active: false }, no restaurar.
  // App.jsx debe pasar active: systemPaused || mediaInterrupted.
  if (typeof thresholdSecOrOpts === 'object' && thresholdSecOrOpts != null && 'active' in thresholdSecOrOpts) {
    if (!thresholdSecOrOpts.active) return false;
  }
  void active;
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < 0) return false;
  if (!Number.isFinite(currentTime)) return true;
  return currentTime < savedPosition - thresholdSec;
}

/** Helper explícito preferido por App.jsx y tests. */
export function canRestoreInterruptPosition({
  yieldedFocus,
  currentTime,
  savedPosition,
  thresholdSec = 1.25,
}) {
  if (!yieldedFocus) return false;
  return shouldRestoreInterruptPosition(currentTime, savedPosition, thresholdSec);
}

/**
 * Reanudación de sesión (cerrar app y volver): ¿seek al segundo guardado?
 *
 * Distinto del ancla de yield (A10): esto es "dejé Aerials al 0:50, cierro,
 * abro, play → debe seguir en 0:50", no pelear con IG.
 *
 * Reglas:
 * - misma pista
 * - posición guardada > ~1.5 s
 * - el <audio> está al inicio o muy por detrás del guardado
 * - no rebobinar si ya avanzó más allá del guardado
 */
export function parseSessionResume(playerState) {
  if (!playerState || !playerState.track || !playerState.track.id) return null;
  const position = Number(playerState.t);
  if (!Number.isFinite(position) || position < 1.5) return null;
  return { trackId: String(playerState.track.id), position };
}

export function shouldApplySessionResume({
  trackId,
  resumeTrackId,
  resumePosition,
  currentTime,
  minPosition = 1.5,
  nearStartSec = 1.5,
  alreadyThereSec = 1.25,
}) {
  if (!trackId || !resumeTrackId || String(trackId) !== String(resumeTrackId)) return false;
  if (resumePosition == null || !Number.isFinite(resumePosition) || resumePosition < minPosition) return false;
  const ct = Number.isFinite(currentTime) ? currentTime : 0;
  if (Math.abs(ct - resumePosition) < alreadyThereSec) return false;
  // Ya escuchando más adelante que el guardado → no rebobinar.
  if (ct > resumePosition + alreadyThereSec) return false;
  // Elemento al inicio (o muy atrás) con un guardado a mitad → seek.
  return ct < nearStartSec || ct < resumePosition - alreadyThereSec;
}

/**
 * ¿La URL de stream guardada sigue siendo usable?
 * blob: ok. Firmada (exp=): solo si quedan > minRemainingSec.
 * Sin firma / basura → no (evita error→play auto al reabrir app).
 */
export function isStreamUrlFresh(url, nowSec = Math.floor(Date.now() / 1000), minRemainingSec = 45) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  try {
    const u = new URL(url, 'https://local.invalid');
    const exp = Number(u.searchParams.get('exp'));
    if (!Number.isFinite(exp) || exp <= 0) return false;
    return exp - nowSec >= minRemainingSec;
  } catch {
    return false;
  }
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

// --- Legacy exports seguros ---
export function hideRecoverDelays() {
  return [];
}
export function shouldYieldAudioFocus() {
  return true;
}
export function shouldYieldOnRePause() {
  return true;
}
