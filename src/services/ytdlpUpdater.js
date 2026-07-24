/**
 * yt-dlp Auto-Updater
 *
 * Mantiene el binario de yt-dlp siempre actualizado. YouTube cambia sus
 * defensas (SABR, PO tokens, cambios de firma) casi cada semana y yt-dlp
 * publica correcciones al mismo ritmo; un binario viejo es la causa #1 de
 * "no se pudo reproducir" en pistas aleatorias.
 *
 * Estrategia:
 *   - Al arrancar (worker 0), se dispara UNA actualización en background,
 *     sin bloquear el arranque del servidor.
 *   - Luego se re-verifica cada `intervalHours` (default 12 h).
 *   - Usa `yt-dlp -U` (self-update de la release oficial de GitHub), que es
 *     seguro: reemplaza el .exe en disco; los procesos ya en vuelo siguen con
 *     la versión anterior y los nuevos spawns usan la nueva. Procesos cortos.
 *
 * Configuración (.env):
 *   YTDLP_AUTO_UPDATE=1            → activar (default: activado)
 *   YTDLP_UPDATE_INTERVAL_HOURS=12 → periodicidad de la re-verificación
 */

import { spawn } from 'node:child_process';

/**
 * Ejecuta `<bin> -U` una vez. No lanza: resuelve con un resumen del resultado.
 * @param {object} opts
 * @param {string} opts.bin  Ruta al binario de yt-dlp.
 * @param {number} [opts.timeoutMs=120000]  Tope antes de matar el proceso.
 * @returns {Promise<{ updated: boolean, alreadyLatest: boolean, output: string }>}
 */
export function updateYtDlpOnce({ bin, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    let proc = null;
    let timer = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(result);
    };
    try {
      proc = spawn(bin, ['-U'], { windowsHide: true });
      timer = setTimeout(() => done({ updated: false, alreadyLatest: false, output: 'timeout' }), timeoutMs);
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { out += d.toString(); });
      proc.on('close', () => {
        const text = out.trim();
        // yt-dlp imprime "is up to date" cuando ya está en la última versión,
        // y "Updated yt-dlp to <ver>" cuando efectivamente actualizó.
        const alreadyLatest = /up to date|is up to date/i.test(text);
        const updated = /Updated yt-dlp to|Updating to/i.test(text);
        done({ updated, alreadyLatest, output: text });
      });
      proc.on('error', (err) => done({ updated: false, alreadyLatest: false, output: String(err && err.message || err) }));
    } catch (err) {
      done({ updated: false, alreadyLatest: false, output: String(err && err.message || err) });
    }
  });
}

/**
 * Arranca el ciclo de auto-actualización. Idempotente por proceso.
 *
 * @param {object} opts
 * @param {() => string} opts.resolveBin  Devuelve la ruta actual del binario.
 * @param {number} [opts.intervalHours]
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ stop: () => void }}
 */
export function startYtDlpAutoUpdate({ resolveBin, intervalHours, log = console.log } = {}) {
  const enabled = process.env.YTDLP_AUTO_UPDATE !== '0' && process.env.YTDLP_AUTO_UPDATE !== 'false';
  if (!enabled) {
    log('[yt-dlp-update] Auto-update deshabilitado (YTDLP_AUTO_UPDATE=0).');
    return { stop: () => {} };
  }
  const hours = Number(intervalHours || process.env.YTDLP_UPDATE_INTERVAL_HOURS || 12);
  const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;

  const runOnce = async () => {
    try {
      const bin = typeof resolveBin === 'function' ? resolveBin() : resolveBin;
      if (!bin) return;
      const r = await updateYtDlpOnce({ bin });
      if (r.updated) log(`[yt-dlp-update] ✅ Actualizado a la última versión.`);
      else if (r.alreadyLatest) log('[yt-dlp-update] Ya está en la última versión.');
      else log(`[yt-dlp-update] Sin cambios (${(r.output || '').slice(0, 80)}).`);
    } catch (err) {
      log(`[yt-dlp-update] Error no fatal: ${err && err.message || err}`);
    }
  };

  // Primera actualización en background, 5 s tras el arranque (no bloquea el boot
  // ni compite con la inicialización de YTMusic/PostgreSQL).
  const kickoff = setTimeout(runOnce, 5000);
  const interval = setInterval(runOnce, intervalMs);
  // No mantener el proceso vivo solo por estos timers.
  if (typeof kickoff.unref === 'function') kickoff.unref();
  if (typeof interval.unref === 'function') interval.unref();

  log(`[yt-dlp-update] Auto-update activo (cada ${hours} h).`);
  return { stop: () => { clearTimeout(kickoff); clearInterval(interval); } };
}
