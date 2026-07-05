import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioFormatSelector } from '../services/audioFormat.js';

/**
 * Adaptador de yt-dlp como External_Extractor primario contra YouTube Music.
 *
 * Decisión de diseño: para uso personal y para evitar una dependencia adicional
 * de Python (ytmusicapi), unificamos búsqueda y resolución de audio sobre
 * `yt-dlp`, que es la dependencia central del modo `full`. El catálogo y el
 * extractor se exponen como funciones inyectables que el resto del backend
 * consume de forma agnóstica.
 *
 * Requisitos: 2.3, 2.5–2.7, 14.2
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const YT_DLP_BIN_DIR = path.join(__dirname, '..', '..', 'bin');

// Cliente de YouTube a usar: el cliente `android` evita los PO tokens y reduce
// Clientes de YouTube en orden de preferencia para el extractor.
// android: evita PO tokens, menos throttling que web.
// ios: fingerprint distinto, segunda línea ante rate-limit de android.
const EXTRACTOR_ARGS = ['--extractor-args', 'youtube:player_client=android'];
const YT_CLIENTS = [
  ['--extractor-args', 'youtube:player_client=android'],
  ['--extractor-args', 'youtube:player_client=ios'],
];

/**
 * Resuelve la ruta del binario yt-dlp:
 *  1. variable de entorno YT_DLP_BIN, si está definida;
 *  2. binario local descargado en `bin/`, si existe;
 *  3. `yt-dlp` en el PATH del sistema.
 * Se evalúa en cada llamada para detectar el binario tras una instalación.
 */
export function resolveYtDlpBin() {
  if (process.env.YT_DLP_BIN) return process.env.YT_DLP_BIN;
  const localName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const local = path.join(YT_DLP_BIN_DIR, localName);
  if (existsSync(local)) return local;
  return 'yt-dlp';
}

/** Sonda de disponibilidad: `yt-dlp --version`. Resuelve true/false. */
export function probeYtDlp() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const proc = spawn(resolveYtDlpBin(), ['--version']);
      proc.on('close', (code) => done(code === 0));
      proc.on('error', () => done(false));
    } catch {
      done(false);
    }
  });
}

/**
 * Resuelve una URL directa de stream con fallbacks en cascada:
 *   1. YouTube (cliente android) — primario, evita PO tokens
 *   2. YouTube (cliente ios)     — fingerprint distinto, resiste rate-limit
 *   3. SoundCloud               — indie/underground; IPs raramente bloqueadas
 *
 * Devuelve la primera URL válida o null si todos los extractores fallan.
 * Con videoId (YT específico) solo intenta los clientes de YouTube.
 *
 * @returns {Promise<string|null>} URL directa, o null si falla.
 */
export function createYtDlpExtractor() {
  return async function extractorImpl({ artist, title, videoId, quality }) {
    const ytTarget = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : `ytsearch1:${artist} - ${title} (Official Audio)`;
    const baseArgs = ['-f', audioFormatSelector(quality), '-g', '--no-playlist',
      '--extractor-retries', '1', '--socket-timeout', '20'];

    // 1+2) Intentar con cada cliente de YouTube en orden (android → ios).
    for (const clientArgs of YT_CLIENTS) {
      const url = await runForUrl([...baseArgs, ...clientArgs, ytTarget]);
      if (url) return url;
    }

    // 3) Fallback a SoundCloud — solo si no tenemos videoId específico de YT.
    if (!videoId) {
      const url = await runForUrl([...baseArgs, `scsearch1:${artist} - ${title}`]);
      if (url) return url;
    }

    return null;
  };
}

// ───────────────────────────────────────────────────────────────
// Control de concurrencia de procesos yt-dlp.
// Cada reproducción/búsqueda lanza un proceso yt-dlp. Sin límite, muchos
// usuarios simultáneos saturarían CPU/memoria y tumbarían el backend.
// Semáforo: como máximo MAX_CONCURRENT procesos a la vez; el resto hace cola.
// Además, cada proceso se MATA al expirar para no dejar procesos zombie.
// ───────────────────────────────────────────────────────────────
const MAX_CONCURRENT = Number(process.env.YTDLP_MAX_CONCURRENT || 4);
let _active = 0;
const _waiters = [];

function acquireSlot() {
  if (_active < MAX_CONCURRENT) { _active++; return Promise.resolve(); }
  return new Promise((res) => _waiters.push(res));
}
function releaseSlot() {
  const next = _waiters.shift();
  if (next) next();       // el slot pasa directo al siguiente en cola
  else _active--;
}

/**
 * Ejecuta yt-dlp con límite de concurrencia y timeout que MATA el proceso.
 * @param {string[]} args
 * @param {{ mode?: 'url'|'lines', timeoutMs?: number }} opts
 */
function runYtDlp(args, { mode = 'url', timeoutMs = 30000 } = {}) {
  const empty = mode === 'lines' ? [] : null;
  return new Promise((resolve) => {
    acquireSlot().then(() => {
      let out = '';
      let settled = false;
      let proc = null;
      let timer = null;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch {}
        releaseSlot();
        resolve(v);
      };
      try {
        proc = spawn(resolveYtDlpBin(), args);
        timer = setTimeout(() => finish(empty), timeoutMs);   // mata el proceso colgado
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.on('close', (code) => {
          if (mode === 'lines') finish(out.trim() ? out.trim().split('\n') : []);
          else finish(code === 0 && out.trim() ? out.trim().split('\n')[0] : null);
        });
        proc.on('error', () => finish(empty));
      } catch { finish(empty); }
    });
  });
}

function runForUrl(args) {
  // 25s por extractor: android → ios → SoundCloud pueden encadenarse. El
  // audioResolver tiene su propio timeout (35s) para limitar el total.
  return runYtDlp(args, { mode: 'url', timeoutMs: 25000 });
}

/**
 * Catálogo de metadatos vía yt-dlp (`ytsearchN:` con `--dump-json`).
 * Devuelve resultados crudos que `mapYouTubeMusicTrack` sabe normalizar.
 */
export function createYtDlpCatalog() {
  return async function catalogImpl(query, limit) {
    const args = [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      ...EXTRACTOR_ARGS,
    ];
    const lines = await runForLines(args);
    return lines
      .map((line) => safeParse(line))
      .filter(Boolean)
      .map((j) => {
        const id = j.id ?? null;
        let title = j.title ?? null;
        let artist = j.artist ?? j.uploader ?? j.channel ?? null;
        // En modo flat el artista no viene; muchos títulos son "Artista - Canción".
        if (!artist && title && title.includes(' - ')) {
          const [a, ...rest] = title.split(' - ');
          artist = a.trim();
          if (rest.length) title = rest.join(' - ').trim();
        }
        title = cleanTitle(title, artist);
        artist = cleanArtist(artist);
        const artworkUrl =
          pickThumb(j.thumbnails) ??
          j.thumbnail ??
          (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null);
        return {
          id,
          title,
          artist,
          album: j.album ?? null,
          durationSeconds: j.duration ?? null,
          artworkUrl,
          releaseDate: j.release_date ?? j.upload_date ?? null,
          genre: j.genre ?? null,
        };
      });
  };
}

/** Limpia el título: quita "Artista - " inicial y sufijos promocionales. */
function cleanTitle(title, artist) {
  if (!title) return title;
  let t = title;
  if (artist && t.toLowerCase().startsWith(`${artist.toLowerCase()} - `)) {
    t = t.slice(artist.length + 3);
  }
  t = t
    .replace(/\s*[([](?:official\s*)?(?:music\s*)?(?:video|audio|lyric[s]?|visualizer|hd|4k|mv)[)\]].*$/gi, '')
    .replace(/\s*[([]\s*(?:official|lyric[s]?|audio|video)\s*[)\]]/gi, '')
    .trim();
  return t || title;
}

/** Quita el sufijo " - Topic" que YouTube añade a canales de música. */
function cleanArtist(artist) {
  if (!artist) return artist;
  return artist.replace(/\s*-\s*topic$/i, '').trim();
}

function runForLines(args) {
  return runYtDlp(args, { mode: 'lines', timeoutMs: 15000 });
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function pickThumb(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  return thumbnails[thumbnails.length - 1].url ?? null;
}
