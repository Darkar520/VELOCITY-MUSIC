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
import { existsSync } from 'node:fs';
import { copyFile, rename, unlink } from 'node:fs/promises';

/**
 * Ejecuta `<bin> -U` una vez. No lanza: resuelve con un resumen del resultado.
 * @param {object} opts
 * @param {string} opts.bin  Ruta al binario de yt-dlp.
 * @param {number} [opts.timeoutMs=120000]  Tope antes de matar el proceso.
 * @param {() => Promise<boolean>} [opts.probe]  Sonda posterior al update.
 * @returns {Promise<{ updated: boolean, alreadyLatest: boolean, output: string }>}
 */
export function updateYtDlpOnce({ bin, timeoutMs = 120000, probe } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    let finalizing = false;
    let proc = null;
    let timer = null;
    let backupPath = null;

    const removeBackup = async () => {
      if (!backupPath) return;
      await unlink(backupPath).catch(() => {});
      backupPath = null;
    };

    const restoreBackup = async () => {
      if (!backupPath) return;
      const failedPath = `${bin}.failed-${process.pid}-${Date.now()}`;
      try {
        await rename(bin, failedPath).catch(() => {});
        await rename(backupPath, bin);
        backupPath = null;
        await unlink(failedPath).catch(() => {});
      } catch {
        // Mantener la copia si Windows/antivirus bloquea el reemplazo: el
        // siguiente ciclo podrá volver a intentar la reparación.
      }
    };

    const done = async (result, { restore = false } = {}) => {
      if (settled || finalizing) return;
      finalizing = true;
      clearTimeout(timer);
      try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* ignore */ }
      if (restore) await restoreBackup();
      else await removeBackup();
      settled = true;
      resolve(result);
    };

    const finishUpdate = async (result) => {
      if (result.updated && typeof probe === 'function') {
        let healthy = false;
        try { healthy = await probe(); } catch { healthy = false; }
        if (!healthy) {
          await done({
            updated: false,
            alreadyLatest: false,
            output: 'El binario actualizado no superó la sonda; se restauró la copia anterior.',
          }, { restore: true });
          return;
        }
      }
      await done(result);
    };

    const run = async () => {
      try {
        // El backup evita que `-U` convierta un corte de disco o red en un
        // ejecutable truncado. Si no se puede copiar, no se intenta actualizar.
        if (typeof probe === 'function' && existsSync(bin)) {
          const candidateBackup = `${bin}.preupdate-${process.pid}-${Date.now()}`;
          await copyFile(bin, candidateBackup);
          backupPath = candidateBackup;
        }
        proc = spawn(bin, ['-U'], { windowsHide: true });
        timer = setTimeout(() => {
          void done({ updated: false, alreadyLatest: false, output: 'timeout' }, { restore: true });
        }, timeoutMs);
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.stderr.on('data', (d) => { out += d.toString(); });
        proc.on('close', () => {
          const text = out.trim();
          // yt-dlp imprime "is up to date" cuando ya está en la última versión,
          // y "Updated yt-dlp to <ver>" cuando efectivamente actualizó.
          const alreadyLatest = /up to date|is up to date/i.test(text);
          const updated = /Updated yt-dlp to|Updating to/i.test(text);
          void finishUpdate({ updated, alreadyLatest, output: text });
        });
        proc.on('error', (err) => {
          void done({ updated: false, alreadyLatest: false, output: String(err && err.message || err) }, { restore: true });
        });
      } catch (err) {
        await done({ updated: false, alreadyLatest: false, output: String(err && err.message || err) }, { restore: true });
      }
    };
    void run();
  });
}

/**
 * Arranca el ciclo de auto-actualización. Idempotente por proceso.
 *
 * @param {object} opts
 * @param {() => string} opts.resolveBin  Devuelve la ruta actual del binario.
 * @param {number} [opts.intervalHours]
 * @param {(bin:string) => Promise<boolean>} [opts.probe]
 * @param {(input:{bin:string}) => Promise<object>} [opts.repair]
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ stop: () => void }}
 */
export function startYtDlpAutoUpdate({ resolveBin, intervalHours, probe, repair, log = console.log } = {}) {
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
      if (typeof probe === 'function') {
        let healthy = false;
        try { healthy = await probe(bin); } catch { healthy = false; }
        if (!healthy) {
          if (typeof repair === 'function') {
            const repaired = await repair({ bin });
            if (repaired?.installed) {
              log(`[yt-dlp-update] ✅ Binario reparado mediante descarga oficial.`);
            } else {
              log(`[yt-dlp-update] Reparación pendiente (${String(repaired?.output || 'sonda no disponible').slice(0, 120)}).`);
            }
          } else {
            log('[yt-dlp-update] El binario no supera la sonda y no hay reparador configurado.');
          }
          return;
        }
      }
      const r = await updateYtDlpOnce({
        bin,
        probe: typeof probe === 'function' ? () => probe(bin) : undefined,
      });
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
