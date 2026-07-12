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

// Clientes de YouTube en orden de preferencia para máxima resiliencia.
// Cada cliente tiene distintos límites, fingerprints y tokens:
//   android : evita PO tokens, menos throttling que web. Cliente primario.
//   ios     : fingerprint distinto, segunda línea ante rate-limit de android.
//   tv      : cliente de Smart TV, sin PO tokens, alta disponibilidad.
//   web     : cliente web estándar, amplio soporte pero requiere PO tokens.
//   mweb    : cliente web móvil, último recurso con límites relajados.
const EXTRACTOR_ARGS = ['--extractor-args', 'youtube:player_client=android'];
const YT_CLIENTS = [
  ['--extractor-args', 'youtube:player_client=android'],
  ['--extractor-args', 'youtube:player_client=ios'],
  ['--extractor-args', 'youtube:player_client=tv'],
  ['--extractor-args', 'youtube:player_client=web'],
  ['--extractor-args', 'youtube:player_client=mweb'],
];

// User-Agents reales por cliente para rotar fingerprint y evitar bloqueos.
// yt-dlp usa el UA interno de cada cliente por defecto, pero añadimos
// --user-agent como override para los clientes web/mweb donde el UA importa.
const CLIENT_UA = {
  android: 'com.google.android.youtube/19.09.37 (Linux; U; Android 14; SM-S918B)',
  ios: 'com.google.ios.youtube/19.09.3 (iPhone15,3; U; CPU iOS 17_5_1 like Mac OS X)',
  tv: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.0) AppleWebKit/605.1.15',
  web: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  mweb: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
};

// Backoff exponencial entre clientes: 0ms, 500ms, 1000ms, 2000ms, 4000ms.
// El primer intento es inmediato; cada cliente siguiente espera más para
// dar tiempo a que el rate-limit del anterior se recupere.
const BACKOFF_BASE_MS = 500;
function backoffMs(index) {
  return index === 0 ? 0 : BACKOFF_BASE_MS * Math.pow(2, index - 1);
}

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
 * Resuelve una URL directa de stream con cascada de clientes + backoff:
 *   1. YouTube android   — primario, evita PO tokens
 *   2. YouTube ios       — fingerprint distinto (backoff 500ms)
 *   3. YouTube tv        — cliente Smart TV (backoff 1s)
 *   4. YouTube web       — cliente web estándar (backoff 2s)
 *   5. YouTube mweb      — cliente móvil (backoff 4s)
 *   6. SoundCloud        — último recurso si todos los YT fallaron
 *
 * Entre cada cliente se aplica backoff exponencial para dar tiempo a que
 * el rate-limit del cliente anterior se recupere. Cada cliente usa su
 * User-Agent correspondiente para rotar el fingerprint.
 *
 * @returns {Promise<string|null>} URL directa, o null si todo falla.
 */
export function createYtDlpExtractor({ scFallback } = {}) {
  // sourcePool controla que pool de videos usa yt-dlp para la busqueda:
  //   'ytm' (default): sesga hacia music results via "(Official Audio)".
  //     Intenta capturar videos "oficiales" subidos a canales - Topic de YT.
  //   'yt': sin sesgo "(Official Audio)". Cubre covers, lives, lyric videos,
  //     uploads de fans, canales no-music. Encuentra videos que YTM no indexa.
  // query (opcional): texto de busqueda canonicamente limpio (artist - title).
  //   Si se pasa, sustituye a "${artist} - ${title}". Usado por el fallback
  //   chain de audioResolver cuando MB aporta titulo/album limpios.
  return async function extractorImpl({ artist, title, videoId, quality, sourcePool = 'ytm', query = null } = {}) {
    const searchBase = query || `${artist} - ${title}`;
    let ytTarget;
    if (videoId) {
      ytTarget = `https://www.youtube.com/watch?v=${videoId}`;
    } else if (sourcePool === 'yt') {
      // Sin "(Official Audio)": pool mas amplio (covers, lives, uploads).
      ytTarget = `ytsearch1:${searchBase}`;
    } else {
      // 'ytm' default: sesgo hacia music results (comportamiento historico).
      ytTarget = `ytsearch1:${searchBase} (Official Audio)`;
    }
    const baseArgs = ['-f', audioFormatSelector(quality), '-g', '--no-playlist',
      '--extractor-retries', '2', '--socket-timeout', '15'];

    for (let i = 0; i < YT_CLIENTS.length; i++) {
      const clientArgs = YT_CLIENTS[i];
      const clientName = clientArgs[1].split('=')[1];

      // Backoff exponencial antes de cada cliente (excepto el primero).
      if (i > 0) await sleep(backoffMs(i));

      // Añadir User-Agent correspondiente al cliente.
      const ua = CLIENT_UA[clientName];
      const uaArgs = ua ? ['--user-agent', ua] : [];

      const url = await runForUrl([...baseArgs, ...clientArgs, ...uaArgs, ytTarget]);
      if (url) return url;
    }

    // Último recurso: SoundCloud para la misma búsqueda.
    if (typeof scFallback === 'function' && !videoId) {
      try {
        const scUrl = await scFallback({ artist, title, quality });
        if (scUrl) return scUrl;
      } catch {}
    }

    return null;
  };
}

/** Sleep helper para backoff entre clientes. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  // 15s por cliente: con 5 clientes + backoff, el total máximo es
  // ~75s de ejecución + ~7s de backoff = ~82s. El audioResolver
  // tiene resolveTimeoutMs=95s para cubrir todo el encadenamiento.
  return runYtDlp(args, { mode: 'url', timeoutMs: 15000 });
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

/**
 * Catálogo de SoundCloud vía yt-dlp (`scsearchN:`).
 * SoundCloud tiene una biblioteca fuerte de música indie, underground,
 * remixes, DJs, artistas emergentes y géneros de nicho que no siempre
 * están en YouTube Music. Se usa como FUENTE ADICIONAL en la búsqueda,
 * no como fallback del extractor de YouTube.
 */
export function createSoundCloudCatalog() {
  return async function soundCloudCatalog(query, limit = 10) {
    const args = [
      `scsearch${limit}:${query}`,
      '--dump-json', '--flat-playlist', '--no-warnings',
    ];
    const lines = await runForLines(args);
    return lines
      .map((line) => safeParse(line))
      .filter(Boolean)
      .map((j) => {
        const id = j.id ?? null;
        const url = j.url ?? j.webpage_url ?? null;
        let title = j.title ?? null;
        let artist = j.uploader ?? j.artist ?? j.creator ?? null;
        if (!artist && title && title.includes(' - ')) {
          const [a, ...rest] = title.split(' - ');
          artist = a.trim();
          title = rest.join(' - ').trim();
        }
        title = cleanTitle(title, artist);
        const artworkUrl =
          pickThumb(j.thumbnails) ??
          j.thumbnail ??
          (j.artwork_url || null);
        return {
          id,
          title,
          artist,
          album: null,
          durationSeconds: j.duration ?? null,
          artworkUrl,
          // URL directa de SoundCloud para el stream proxy (no videoId de YT).
          // El extractor primario la resolverá como URL explícita si llega en `stream`.
          streamUrl: url,
          source: 'soundcloud',
        };
      })
      .filter((t) => t.id && t.title);
  };
}

/**
 * Resuelve la URL de audio de una pista de SoundCloud dado su ID o URL.
 * Se usa cuando el usuario reproduce una pista encontrada desde SoundCloud.
 */
export function createSoundCloudExtractor() {
  return async function scExtractor({ stream, quality }) {
    if (!stream) return null;
    const baseArgs = ['-f', audioFormatSelector(quality), '-g', '--no-playlist',
      '--extractor-retries', '1', '--socket-timeout', '20'];
    return runForUrl([...baseArgs, stream]);
  };
}
