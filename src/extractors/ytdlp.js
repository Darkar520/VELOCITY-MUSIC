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
// los errores HTTP 429 (rate limit) frente al cliente web por defecto.
const EXTRACTOR_ARGS = ['--extractor-args', 'youtube:player_client=android'];

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
 * Resuelve una URL directa de stream de pista completa para (artist, title).
 * Aplica la Audio_Format_Preference (Opus/webm → AAC/m4a → mejor audio) y NO
 * recodifica (`-g`).
 *
 * @returns {Promise<string|null>} URL directa, o null si falla.
 */
export function createYtDlpExtractor() {
  return async function extractorImpl({ artist, title, videoId, quality }) {
    // Si tenemos el ID exacto del vídeo, resolvemos esa pista directamente
    // (coincidencia exacta). Si no, buscamos la mejor coincidencia.
    const target = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : `ytsearch1:${artist} - ${title} (Official Audio)`;
    const args = ['-f', audioFormatSelector(quality), '-g', '--no-playlist', ...EXTRACTOR_ARGS, target];
    return runForUrl(args);
  };
}

function runForUrl(args) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const proc = spawn(resolveYtDlpBin(), args);
      proc.stdout.on('data', (d) => {
        out += d.toString();
      });
      proc.on('close', (code) => {
        if (code === 0 && out.trim()) {
          done(out.trim().split('\n')[0]); // primera URL directa
        } else {
          done(null);
        }
      });
      proc.on('error', () => done(null));
    } catch {
      done(null);
    }
  });
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
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const proc = spawn(resolveYtDlpBin(), args);
      proc.stdout.on('data', (d) => {
        out += d.toString();
      });
      proc.on('close', () => done(out.trim() ? out.trim().split('\n') : []));
      proc.on('error', () => done([]));
    } catch {
      done([]);
    }
  });
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
