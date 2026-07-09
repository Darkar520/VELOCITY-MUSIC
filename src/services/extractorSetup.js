/**
 * Asistente de configuración del extractor (yt-dlp).
 *
 * Permite al front-end detectar si yt-dlp está disponible y, opcionalmente,
 * instalarlo. La vía principal y más fiable para uso personal es DESCARGAR el
 * binario oficial de yt-dlp (sin admin, sin winget, sin Python) a una carpeta
 * local. Como respaldo se ofrecen comandos de gestor de paquetes.
 */

import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

/** Comando de instalación sugerido según la plataforma. */
export function installCommandFor(platform = process.platform) {
  if (platform === 'win32') {
    return { cmd: 'winget', args: ['install', '--id', 'yt-dlp.yt-dlp', '-e'], display: 'winget install yt-dlp.yt-dlp' };
  }
  if (platform === 'darwin') {
    return { cmd: 'brew', args: ['install', 'yt-dlp'], display: 'brew install yt-dlp' };
  }
  // Linux y otros: pip como opción más portable.
  return { cmd: 'python3', args: ['-m', 'pip', 'install', '-U', 'yt-dlp'], display: 'python3 -m pip install -U yt-dlp' };
}

/** Comando de respaldo universal vía pip (Python). */
export function pipInstallCommand() {
  return { cmd: 'python', args: ['-m', 'pip', 'install', '-U', 'yt-dlp'], display: 'python -m pip install -U yt-dlp' };
}

/**
 * Construye el estado del extractor para el front-end.
 * @param {() => Promise<boolean>} probe  sonda de disponibilidad
 */
export async function extractorStatus(probe, platform = process.platform) {
  const available = typeof probe === 'function' ? await safeProbe(probe) : false;
  const primary = installCommandFor(platform);
  const fallback = pipInstallCommand();
  return {
    available,
    platform,
    installCommand: primary.display,
    fallbackCommand: fallback.display,
  };
}

async function safeProbe(probe) {
  try {
    return await probe();
  } catch {
    return false;
  }
}

/** Nombre del asset oficial de yt-dlp según la plataforma. */
export function ytDlpAssetFor(platform = process.platform) {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp_linux';
}

/** Nombre del binario local destino. */
export function ytDlpBinName(platform = process.platform) {
  return platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/**
 * Descarga el binario oficial de yt-dlp desde la última release de GitHub a
 * `binDir`. En sistemas tipo Unix marca el binario como ejecutable.
 *
 * @returns {Promise<string>} ruta del binario descargado.
 */
export async function downloadYtDlp({ binDir, platform = process.platform, fetchImpl = fetch } = {}) {
  const asset = ytDlpAssetFor(platform);
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`La descarga de yt-dlp falló (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(binDir, { recursive: true });
  const dest = path.join(binDir, ytDlpBinName(platform));
  await writeFile(dest, buf);
  if (platform !== 'win32') await chmod(dest, 0o755);
  return dest;
}

/**
 * Instala yt-dlp descargando el binario oficial y verificando con la sonda.
 * Si la descarga falla, devuelve un resultado no instalado con el detalle.
 *
 * @returns {Promise<{ installed: boolean, output: string, command: string|null }>}
 */
export async function installYtDlpByDownload({ binDir, probe, platform = process.platform, fetchImpl = fetch }) {
  if (await safeProbe(probe)) {
    return { installed: true, output: 'yt-dlp ya está disponible.', command: null };
  }
  try {
    const dest = await downloadYtDlp({ binDir, platform, fetchImpl });
    const ok = await safeProbe(probe);
    return {
      installed: ok,
      output: ok ? `yt-dlp descargado en ${dest}.` : 'Se descargó el binario pero no respondió a la sonda.',
      command: 'descarga directa del binario oficial',
    };
  } catch (err) {
    return { installed: false, output: String(err && err.message ? err.message : err), command: null };
  }
}

/**
 * Intenta instalar yt-dlp ejecutando un comando FIJO (sin entrada del usuario).
 *
 * @param {object} deps
 * @param {(cmd:string,args:string[])=>Promise<{code:number,output:string}>} deps.runCommand
 * @param {() => Promise<boolean>} deps.probe
 * @returns {Promise<{ installed: boolean, output: string, command: string }>}
 */
export async function installExtractor({ runCommand, probe, platform = process.platform }) {
  // Si ya está disponible, no reinstalar.
  if (await safeProbe(probe)) {
    return { installed: true, output: 'yt-dlp ya está disponible.', command: null };
  }

  const attempts = [installCommandFor(platform), pipInstallCommand()];
  let lastOutput = '';
  for (const attempt of attempts) {
    try {
      const { code, output } = await runCommand(attempt.cmd, attempt.args);
      lastOutput = output;
      if (code === 0 && (await safeProbe(probe))) {
        return { installed: true, output, command: attempt.display };
      }
    } catch (err) {
      lastOutput = String(err && err.message ? err.message : err);
    }
  }
  return { installed: false, output: lastOutput, command: attempts[0].display };
}
