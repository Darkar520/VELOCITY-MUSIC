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
