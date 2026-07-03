// ═══════════════════════════════════════════════════════════════
// Utilidades de concurrencia para escalar la resolución de audio.
//  - createLimiter(max): limita cuántas tareas costosas (yt-dlp) corren a la
//    vez; el resto espera en cola en lugar de saturar CPU/RAM.
//  - createInflight(): deduplica trabajo en vuelo por clave; si N peticiones
//    piden lo mismo simultáneamente, se ejecuta UNA sola vez y todas comparten
//    el resultado.
// ═══════════════════════════════════════════════════════════════

/**
 * Semáforo simple con cola FIFO.
 * @param {number} max Máximo de tareas en ejecución simultánea.
 * @returns {(fn: () => Promise<any>) => Promise<any>} run(fn)
 */
export function createLimiter(max = 4) {
  const limit = Math.max(1, Number(max) || 1);
  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(
        (v) => { active--; resolve(v); pump(); },
        (e) => { active--; reject(e); pump(); },
      );
  };

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

/**
 * Deduplicación de trabajo en vuelo por clave.
 * @returns {(key: string, fn: () => Promise<any>) => Promise<any>} dedupe(key, fn)
 */
export function createInflight() {
  /** @type {Map<string, Promise<any>>} */
  const map = new Map();
  return function dedupe(key, fn) {
    const existing = map.get(key);
    if (existing) return existing;
    const p = Promise.resolve()
      .then(fn)
      .finally(() => { map.delete(key); });
    map.set(key, p);
    return p;
  };
}
