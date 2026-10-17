// La distribución oficial descomprimida evita extraer Python a TEMP en cada
// reproducción. Se publica solo después de verificar SHA-256 y --version.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const ASSET = 'yt-dlp_win.zip';
const FOLDER = /^runtime-[a-f0-9-]{36}$/;

function activeRuntime(binDir) {
  try {
    const root = path.resolve(binDir, 'yt-dlp-win');
    const manifest = JSON.parse(readFileSync(path.join(root, 'active.json'), 'utf8'));
    if (!FOLDER.test(manifest.folder) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return null;
    const folder = path.join(root, manifest.folder);
    const bin = path.join(folder, 'yt-dlp.exe');
    if (!existsSync(bin) || !existsSync(path.join(folder, '_internal'))) return null;
    return { ...manifest, bin, root };
  } catch { return null; }
}

export function resolveWindowsRuntime(binDir) {
  return activeRuntime(binDir)?.bin || null;
}

export function isManagedWindowsRuntime(bin) {
  return typeof bin === 'string' && path.basename(bin) === 'yt-dlp.exe'
    && FOLDER.test(path.basename(path.dirname(bin)))
    && path.basename(path.dirname(path.dirname(bin))) === 'yt-dlp-win';
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Plazo del runtime agotado.')); }, timeoutMs);
    let output = '';
    proc.stdout.on('data', (chunk) => { output += chunk; });
    proc.stderr.on('data', () => {});
    proc.once('error', (error) => { clearTimeout(timer); reject(error); });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`El runtime terminó con código ${code}.`));
      else resolve(output.trim());
    });
  });
}

async function unpack(archive, destination) {
  const literal = (value) => `'${value.replace(/'/g, "''")}'`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(destination)}`,
  ], 45000);
}

async function probe(bin) {
  try { return /^\d{4}\.\d{2}\.\d{2}/.test(await run(bin, ['--version'], 8000)); }
  catch { return false; }
}

/** Instala/actualiza el paquete oficial; nunca sustituye un runtime sin validar. */
export async function installWindowsRuntime({ binDir, fetchImpl = fetch, unpackImpl = unpack, probeImpl = probe } = {}) {
  const root = path.resolve(binDir, 'yt-dlp-win');
  const previous = activeRuntime(binDir);
  const get = async (name) => {
    const response = await fetchImpl(RELEASE + name, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Descarga oficial fallida: HTTP ${response.status}.`);
    return response;
  };
  const sums = await (await get('SHA2-256SUMS')).text();
  const expected = sums.split(/\r?\n/).map((line) => line.match(/^([a-f0-9]{64})\s+\*?yt-dlp_win\.zip$/i)).find(Boolean)?.[1]?.toLowerCase();
  if (!expected) throw new Error('La release no incluye el checksum del runtime Windows.');
  if (previous?.sha256 === expected && await probeImpl(previous.bin)) {
    return { updated: false, alreadyLatest: true, bin: previous.bin, output: 'Runtime oficial vigente.' };
  }
  const archive = Buffer.from(await (await get(ASSET)).arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    throw new Error('SHA-256 del runtime Windows incorrecto; se conserva el anterior.');
  }
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(path.join(root, '.install-'));
  const folder = `runtime-${randomUUID()}`;
  const destination = path.join(root, folder);
  let promoted = false;
  let activated = false;
  const manifestTemp = path.join(root, `.active-${randomUUID()}.json`);
  try {
    const zip = path.join(staging, ASSET);
    const unpacked = path.join(staging, 'runtime');
    await writeFile(zip, archive, { flag: 'wx' });
    await unpackImpl(zip, unpacked);
    const candidate = path.join(unpacked, 'yt-dlp.exe');
    if (!existsSync(path.join(unpacked, '_internal')) || !await probeImpl(candidate)) {
      throw new Error('El runtime descargado no supera la sonda; se conserva el anterior.');
    }
    await rename(unpacked, destination);
    promoted = true;
    await writeFile(manifestTemp, JSON.stringify({ folder, sha256: expected }), { flag: 'wx' });
    await rename(manifestTemp, path.join(root, 'active.json'));
    activated = true;
    // Conservar la generación anterior permite rollback y protege procesos en
    // vuelo. Borrar solo directorios administrados resueltos dentro de root.
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const anotherInstall = entries.some(entry => entry.name.startsWith('.install-') && entry.name !== path.basename(staging));
    for (const entry of anotherInstall ? [] : entries) {
      if (!entry.isDirectory() || !FOLDER.test(entry.name) || [folder, previous?.folder].includes(entry.name)) continue;
      if (entry.name === activeRuntime(binDir)?.folder) continue;
      const obsolete = path.resolve(root, entry.name);
      if (path.dirname(obsolete) === root) await rm(obsolete, { recursive: true, force: true }).catch(() => {});
    }
    return { updated: true, alreadyLatest: false, bin: path.join(destination, 'yt-dlp.exe'), output: 'Runtime oficial verificado y activado.' };
  } finally {
    if (path.dirname(staging) === root) await rm(staging, { recursive: true, force: true }).catch(() => {});
    await rm(manifestTemp, { force: true }).catch(() => {});
    if (promoted && !activated && path.dirname(destination) === root) {
      await rm(destination, { recursive: true, force: true }).catch(() => {});
    }
  }
}
