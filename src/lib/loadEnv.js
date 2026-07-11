import fs from 'node:fs';
import path from 'node:path';

/**
 * Carga variables desde un archivo `.env` en `rootDir`.
 * - No sobrescribe claves ya presentes en `process.env` (prioridad SO/guardian).
 * - No loguea valores.
 * - Si el archivo no existe, no hace nada (dev sin .env sigue funcionando).
 *
 * @param {string} rootDir Directorio del proyecto (donde vive `.env`)
 * @param {{ filename?: string }} [opts]
 * @returns {{ loaded: boolean, path: string, keys: number }}
 */
export function loadEnv(rootDir, opts = {}) {
  const filename = opts.filename || '.env';
  const envPath = path.join(rootDir, filename);
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath, keys: 0 };
  }

  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return { loaded: false, path: envPath, keys: 0 };
  }

  let keys = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // No pisar variables ya definidas (incl. string vacía intencional del SO).
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    keys += 1;
  }

  return { loaded: true, path: envPath, keys };
}
