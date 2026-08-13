/**
 * Resolution_Mode y controles de cumplimiento (uso personal).
 *
 * - Sin configuración explícita → `full` (la plataforma es de uso personal).
 * - Full_Mode + yt-dlp detectado ≤ 10 s → `full`.
 * - Full_Mode + yt-dlp NO detectado ≤ 10 s → `degraded` + indicación de no
 *   activación.
 *
 * Requisitos: 14.1, 14.2, 14.3, 14.5, 14.6
 */

export const EXTRACTOR_PROBE_TIMEOUT_MS = 10000;

/**
 * Determina el modo activo a partir de la configuración y una sonda del
 * extractor.
 *
 * @param {{ requested?: 'full' | 'degraded' }} config
 * @param {() => Promise<boolean>} extractorProbe  resuelve true si yt-dlp existe
 * @returns {Promise<{ mode: 'full'|'degraded', notice: string|null }>}
 */
export async function resolveActiveMode(config = {}, extractorProbe, opts = {}) {
  const { timeoutMs = EXTRACTOR_PROBE_TIMEOUT_MS } = opts;
  const requested = config.requested ?? 'full'; // por defecto full (14.1)

  if (requested !== 'full') {
    return { mode: 'degraded', notice: null };
  }

  let available = false;
  if (typeof extractorProbe === 'function') {
    try {
      available = await withTimeout(extractorProbe(), timeoutMs);
    } catch {
      available = false;
    }
  }

  if (available) {
    return { mode: 'full', notice: null }; // 14.2
  }

  // 14.3: yt-dlp no detectado → degraded con indicación.
  return {
    mode: 'degraded',
    notice:
      'yt-dlp no se detectó en el arranque; la resolución de pista completa no pudo activarse.',
  };
}

/** true solo si el modo activo permite resolución de pista completa. */
export function isFullResolutionAllowed(activeMode) {
  return activeMode === 'full';
}

/**
 * Watchdog de auto-recuperación del modo degradado.
 *
 * La sonda de yt-dlp solo se ejecuta en el arranque; si falla una vez (update
 * en curso, Windows matando procesos de cluster, red caída), el backend quedaba
 * en `degraded` para siempre hasta reiniciarlo — y en ese modo ninguna canción
 * de streaming se reproduce. Este watchdog re-ejecuta la sonda mientras el modo
 * siga degradado y notifica en cuanto yt-dlp vuelve a estar disponible.
 *
 * @param {{ probe: () => Promise<boolean>, isDegraded: () => boolean,
 *           onRecover: () => void, intervalMs?: number }} opts
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createModeWatchdog({
  probe,
  isDegraded,
  onRecover,
  intervalMs = 60_000,
} = {}) {
  let timer = null;
  let probing = false;

  const tick = async () => {
    if (probing) return; // no solapar sondas si una sigue en vuelo
    if (typeof isDegraded === 'function' && !isDegraded()) {
      stop();
      return;
    }
    probing = true;
    let ok = false;
    try {
      ok = await probe();
    } catch {
      ok = false;
    } finally {
      probing = false;
    }
    if (!ok) return; // sigue degradado; se reintentará en el próximo tick
    if (typeof isDegraded === 'function' && !isDegraded()) return;
    if (typeof onRecover === 'function') onRecover();
    // Si onRecover no deja de estar degradado, el siguiente tick reintenta.
    if (!isDegraded || !isDegraded()) stop();
  };

  const start = () => {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { start, stop, tick };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
