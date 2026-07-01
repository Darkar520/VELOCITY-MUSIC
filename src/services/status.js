/**
 * Status — construye la respuesta de /api/status con esquema y degradación
 * parcial.
 *
 * Requisitos: 5.1, 5.3, 5.4, 14.4
 */

export const MAX_CACHE_ENTRIES_REPORTED = 1000000;

/**
 * @param {object} input
 * @param {'full'|'degraded'|null|undefined} input.resolutionMode
 * @param {number|null|undefined} input.cacheSize
 * @param {number|null|undefined} input.uptime  segundos
 * @returns {object} respuesta de estado
 */
export function buildStatus({ resolutionMode, cacheSize, uptime } = {}) {
  const degradedFields = [];

  // resolutionMode debe ser 'full' | 'degraded'.
  let mode = resolutionMode;
  if (mode !== 'full' && mode !== 'degraded') {
    degradedFields.push('resolutionMode');
    mode = null;
  }

  // uptime no negativo, resolución de 1 s.
  let uptimeSeconds = uptime;
  if (typeof uptimeSeconds !== 'number' || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
    degradedFields.push('uptimeSeconds');
    uptimeSeconds = null;
  } else {
    uptimeSeconds = Math.floor(uptimeSeconds);
  }

  // cacheEntries: entero en [0, 1000000].
  let cacheEntries = cacheSize;
  if (typeof cacheEntries !== 'number' || !Number.isFinite(cacheEntries) || cacheEntries < 0) {
    cacheEntries = 0;
  } else {
    cacheEntries = Math.min(MAX_CACHE_ENTRIES_REPORTED, Math.floor(cacheEntries));
  }

  const status = degradedFields.length > 0 ? 'degraded' : 'operational';

  const response = {
    status,
    resolutionMode: mode,
    cacheEntries,
    uptimeSeconds,
  };
  if (degradedFields.length > 0) {
    response.degradedFields = degradedFields;
  }
  return response;
}
