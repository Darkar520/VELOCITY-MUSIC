import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioFormatSelector } from '../services/audioFormat.js';
import { normalizeText } from '../lib/normalize.js';

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
const NODE_RUNTIME_MIN_MAJOR = 22;
export const YTDLP_PROBE_TIMEOUT_MS = 10000;
const NODE_RUNTIME_SUPPORTED = Number.parseInt(process.versions.node, 10) >= NODE_RUNTIME_MIN_MAJOR;
const JS_RUNTIME_ARGS = process.execPath && NODE_RUNTIME_SUPPORTED
  ? ['--js-runtimes', `node:${process.execPath}`]
  : [];

// Clientes de YouTube en orden de preferencia.
//   default    : conjunto de clientes mantenido por yt-dlp; se intenta primero.
//   android_vr : cliente de Meta Quest, resistente a SABR (sirve itag 140 AAC).
//   web_safari : puede ofrecer HLS; el selector HTTPS directo lo descarta.
//   tv         : Smart TV; sigue funcionando para parte del catálogo.
//   ios        : último recurso (puede requerir PO token en algunas sesiones).
// Un array de args vacío ([]) significa "no forzar cliente" → yt-dlp usa su set
// por defecto, en vez de depender de perfiles alternativos frágiles.
const YT_CLIENTS = [
  { name: 'default', args: [] },
  { name: 'android_vr', args: ['--extractor-args', 'youtube:player_client=android_vr'] },
  { name: 'web_safari', args: ['--extractor-args', 'youtube:player_client=web_safari'] },
  { name: 'tv', args: ['--extractor-args', 'youtube:player_client=tv'] },
  { name: 'ios', args: ['--extractor-args', 'youtube:player_client=ios'] },
];

// Backoff exponencial entre clientes: 0ms, 500ms, 1000ms, 2000ms, 4000ms.
// El primer intento es inmediato; cada cliente siguiente espera más para
// dar tiempo a que el rate-limit del anterior se recupere.
const BACKOFF_BASE_MS = 500;
const ALTERNATE_SEARCH_LIMIT = 8;
const ALTERNATE_SEARCH_TIMEOUT_MS = 5000;
const ALTERNATE_FAILURE_CODES = new Set([
  'YT_PREMIUM_REQUIRED',
  'YT_AUTH_REQUIRED',
  'YT_VIDEO_UNAVAILABLE',
]);
const ARTIST_STOP_WORDS = new Set(['and', 'the', 'feat', 'featuring', 'ft', 'with']);

function backoffMs(index) {
  return index === 0 ? 0 : BACKOFF_BASE_MS * Math.pow(2, index - 1);
}

function comparableText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function artistGroups(value) {
  return String(value || '')
    .split(/\s*(?:,|&|\/|\bx\b|feat\.?|ft\.?|featuring|with)\s*/i)
    .map((part) => comparableText(part).split(' ').filter((token) => token && !ARTIST_STOP_WORDS.has(token)))
    .filter((group) => group.length);
}

function candidateShape(raw) {
  const id = String(raw?.id ?? raw?.videoId ?? '').trim();
  const rawTitle = String(raw?.title ?? raw?.name ?? '').trim();
  let title = rawTitle;
  let artist = String(raw?.artist ?? '').trim();
  if (!artist) artist = String(raw?.uploader ?? raw?.channel ?? '').trim();

  // `--flat-playlist` often puts the real artist in the title while `uploader`
  // is only the channel name. Split that presentation before matching.
  const separator = rawTitle.indexOf(' - ');
  if (separator > 0) {
    const parsedArtist = rawTitle.slice(0, separator).trim();
    const parsedTitle = rawTitle.slice(separator + 3).trim();
    if (parsedArtist && parsedTitle) {
      artist = parsedArtist;
      title = parsedTitle;
    }
  }

  return { id, title: cleanTitle(title, artist), artist };
}

/**
 * Filtra candidatos alternativos sin aceptar un remix, mashup o canción de
 * otro artista por el mero hecho de compartir una palabra del título.
 *
 * La comparación es deliberadamente conservadora: el título limpio debe ser
 * exacto y, si hay varios artistas, al menos dos créditos del artista buscado
 * deben aparecer completos en la metadata del resultado.
 */
export function selectAlternateVideoCandidates({ artist, title, videoId, candidates = [] } = {}) {
  const wantedTitle = comparableText(cleanTitle(title, artist));
  const wantedGroups = artistGroups(artist);
  if (!wantedTitle || !Array.isArray(candidates)) return [];
  const minimumGroups = wantedGroups.length > 1 ? Math.min(2, wantedGroups.length) : wantedGroups.length;

  return candidates
    .map((raw, index) => ({ ...candidateShape(raw), index, raw }))
    .filter((candidate) => {
      if (!candidate.id || candidate.id === String(videoId || '')) return false;
      if (comparableText(candidate.title) !== wantedTitle) return false;
      if (!wantedGroups.length) return true;
      const candidateText = comparableText(`${candidate.artist} ${candidate.raw?.title || ''} ${candidate.raw?.uploader || ''} ${candidate.raw?.channel || ''}`);
      const candidateTokens = new Set(candidateText.split(' ').filter(Boolean));
      const matchedGroups = wantedGroups.filter((group) => group.every((token) => candidateTokens.has(token))).length;
      return matchedGroups >= minimumGroups;
    })
    .sort((a, b) => {
      const score = (candidate) => {
        const text = comparableText(`${candidate.artist} ${candidate.raw?.title || ''}`);
        const tokens = new Set(text.split(' ').filter(Boolean));
        return wantedGroups.filter((group) => group.every((token) => tokens.has(token))).length;
      };
      return score(b) - score(a) || a.index - b.index;
    })
    .map(({ id, title: candidateTitle, artist: candidateArtist }) => ({
      id,
      title: candidateTitle,
      artist: candidateArtist,
    }));
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

/**
 * Sonda de disponibilidad: `yt-dlp --version`. Resuelve true/false.
 *
 * En modo cluster, varios workers pueden pedirla simultáneamente: comparten la
 * sonda en cada proceso, hacen como máximo dos intentos y nunca exceden el
 * timeout por intento.
 *
 * @param {{ retries?: number, delayMs?: number, timeoutMs?: number,
 *           probeOnce?: (timeoutMs:number)=>Promise<object> }} opts
 */
let probeInFlight = null;
let lastProbeResult = null;

export function probeYtDlp({ retries = 1, delayMs = 500, timeoutMs = YTDLP_PROBE_TIMEOUT_MS, probeOnce = _probeOnce } = {}) {
  if (probeInFlight) return probeInFlight;
  const attemptCount = Math.min(2, Math.max(1, Math.trunc(Number(retries) || 0) + 1));
  const boundedTimeoutMs = Math.min(12000, Math.max(1, Number(timeoutMs) || YTDLP_PROBE_TIMEOUT_MS));
  const boundedDelayMs = Math.min(1000, Math.max(0, Number(delayMs) || 0));
  const task = (async () => {
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, boundedDelayMs * attempt));
      }
      const result = await probeOnce(boundedTimeoutMs);
      lastProbeResult = { ...result, checkedAtMs: Date.now() };
      if (result.ok) return true;
    }
    return false;
  })();
  probeInFlight = task.finally(() => { probeInFlight = null; });
  return probeInFlight;
}

/** Ejecuta `yt-dlp --version` una vez. Resuelve true si el proceso sale con 0. */
async function _probeOnce(timeoutMs = YTDLP_PROBE_TIMEOUT_MS) {
  return runYtDlpProbe([...JS_RUNTIME_ARGS, '--version'], timeoutMs);
}

/**
 * Diagnóstico seguro del runtime que se usará en esta misma instancia.
 * `runtimeConfigured` significa que yt-dlp acepta el flag y el Node del
 * proceso está disponible; no equivale a una prueba real de una pista.
 */
export async function getYtDlpDiagnostics({ timeoutMs = YTDLP_PROBE_TIMEOUT_MS, refresh = false } = {}) {
  const nodeAvailable = Boolean(process.execPath && existsSync(process.execPath));
  let runtime = !refresh && lastProbeResult && Date.now() - lastProbeResult.checkedAtMs < 30000
    ? lastProbeResult
    : null;
  if (!runtime) {
    const args = nodeAvailable && NODE_RUNTIME_SUPPORTED ? [...JS_RUNTIME_ARGS, '--version'] : ['--version'];
    runtime = await runYtDlpProbe(args, timeoutMs);
    lastProbeResult = { ...runtime, checkedAtMs: Date.now() };
  }
  const probeStatus = runtime.timedOut ? 'timeout' : runtime.ok ? 'ok' : 'unavailable';
  const configured = runtime.timedOut
    ? null
    : nodeAvailable && NODE_RUNTIME_SUPPORTED && runtime.ok;
  return {
    available: runtime.timedOut ? null : runtime.ok,
    version: runtime.version,
    javascriptRuntime: {
      name: 'node',
      version: nodeAvailable ? process.versions.node : null,
      available: nodeAvailable,
      minimumSupportedMajor: NODE_RUNTIME_MIN_MAJOR,
      supported: nodeAvailable && NODE_RUNTIME_SUPPORTED,
      configured,
    },
    ready: runtime.timedOut ? null : runtime.ok && nodeAvailable && NODE_RUNTIME_SUPPORTED,
    probeStatus,
    processLimits: {
      maxConcurrent: maxConcurrentProcesses(),
      maxQueued: maxConcurrentProcesses() * 8,
    },
    playbackProbe: 'not_run',
    checkedAt: new Date().toISOString(),
  };
}

/** Snapshot liviano de presión del semáforo; no ejecuta procesos externos. */
export function getYtDlpLoad() {
  const maxConcurrent = maxConcurrentProcesses();
  return {
    activeProcesses: _active,
    queuedRequests: _waiters.length,
    maxConcurrent,
    maxQueued: maxConcurrent * 8,
  };
}

function runYtDlpProbe(args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
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
      proc = spawn(resolveYtDlpBin(), args, { windowsHide: true });
      timer = setTimeout(() => done({ ok: false, version: null, timedOut: true }), timeoutMs);
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.on('close', (code) => done({
        ok: code === 0,
        version: code === 0 ? stdout.trim().split(/\s+/)[0] || null : null,
      }));
      proc.on('error', () => done({ ok: false, version: null }));
    } catch {
      done({ ok: false, version: null });
    }
  });
}

export class YtDlpError extends Error {
  constructor(details, extra = {}) {
    super(details.message);
    this.name = 'YtDlpError';
    this.code = details.code;
    this.retryable = details.retryable;
    this.client = extra.client || null;
    this.exitCode = Number.isInteger(extra.exitCode) ? extra.exitCode : null;
  }
}

/** Convierte la salida no confiable del extractor en una causa estable y segura. */
export function classifyYtDlpFailure({ output = '', timedOut = false, cancelled = false, stage = 'extract', spawnError } = {}) {
  const text = `${output}\n${spawnError?.message || ''}`.toLowerCase();
  if (cancelled) {
    return failure('YT_RESOLUTION_CANCELLED', 'La solicitud de reproducción se canceló.', true);
  }
  if (timedOut) return failure('YT_EXTRACTOR_TIMEOUT', 'La búsqueda de audio superó el límite de espera.', true);
  if (/only available to youtube music premium members|unlock this song by getting music premium|music premium members/.test(text)) {
    return failure('YT_PREMIUM_REQUIRED', 'YouTube indica que esta pista está limitada a miembros de Music Premium.', false);
  }
  if (/members.only|sign in to confirm|login required|log in to|confirm your age|age.restricted|authentication required/.test(text)) {
    return failure('YT_AUTH_REQUIRED', 'YouTube requiere iniciar sesión o verificar el acceso a esta pista.', false);
  }
  if (/not available in your country|geo.?restrict|country.?restrict|region.?restrict/.test(text)) {
    return failure('YT_GEO_RESTRICTED', 'YouTube no ofrece esta pista en la región del servidor.', false);
  }
  if (/video unavailable|private video|has been removed|video has been removed|no longer available/.test(text)) {
    return failure('YT_VIDEO_UNAVAILABLE', 'YouTube indica que el video está eliminado, privado o no disponible.', false);
  }
  if (/http error 429|too many requests|rate.?limit|temporarily blocked/.test(text)) {
    return failure('YT_RATE_LIMITED', 'YouTube limitó temporalmente las solicitudes; vuelve a intentarlo más tarde.', true);
  }
  if (/no supported javascript runtime|javascript runtime.*(not found|missing|not available)|yt-dlp-ejs|remote component.*(failed|unavailable)|(?:no such option|unknown option|unrecognized argument).*js-runtimes/.test(text)) {
    return failure('YT_RUNTIME_UNAVAILABLE', 'El runtime JavaScript requerido por yt-dlp no está disponible o no pudo iniciarse.', false);
  }
  if (/requested format is not available|no video formats found|no formats found|sabr|po token|nsig|signature extraction|challenge solving/.test(text)) {
    return failure('YT_FORMAT_UNAVAILABLE', 'YouTube no entregó un formato de audio directo compatible.', true);
  }
  if (/enotfound|eai_again|econnreset|econnrefused|network is unreachable|connection timed out|timed out|socket timeout/.test(text)) {
    return failure('YT_NETWORK_ERROR', 'El servidor no pudo completar la conexión con YouTube.', true);
  }
  if (/http error 403|forbidden/.test(text)) {
    return failure('YT_UPSTREAM_FORBIDDEN', 'YouTube rechazó la solicitud (403); el motivo específico no se pudo determinar.', true);
  }
  if (/enoent|not recognized as an internal|spawn .* failed/.test(text)) {
    return failure('YT_DLP_UNAVAILABLE', 'El servidor no pudo ejecutar el binario yt-dlp.', false);
  }
  return stage === 'queue'
    ? failure('YT_EXTRACTOR_BUSY', 'El extractor está ocupado y no liberó capacidad antes del límite.', true)
    : failure('YT_EXTRACTOR_UNKNOWN', 'YouTube no devolvió audio y el extractor no indicó una causa reconocible.', true);
}

function failure(code, message, retryable) {
  return { code, message, retryable };
}

/**
 * Resuelve una URL directa dentro de un presupuesto total compartido por todos
 * los clientes, la cola de procesos y el fallback. Los rechazos de acceso no
 * se reintentan con otros clientes.
 */
export function createYtDlpExtractor({
  scFallback,
  logger = console,
  // Inyección para pruebas deterministas. En producción se usan los runners
  // acotados que matan el proceso hijo al vencer el presupuesto.
  runUrl = runForUrl,
  runLines = runForLines,
} = {}) {
  return async function extractorImpl({ artist, title, videoId, quality }, { timeoutMs = 12000, signal } = {}) {
    const startedAt = Date.now();
    // Una pista Premium puede requerir una búsqueda alternativa (≈5 s) y una
    // extracción adicional (≈5 s) después del intento directo. Mantener un
    // presupuesto acotado de 18 s permite ese fallback sin spinners infinitos.
    const budgetMs = Math.max(1, Math.min(18000, Number(timeoutMs) || 12000));
    const deadline = startedAt + budgetMs;
    const ytTarget = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : `ytsearch1:${artist} - ${title} (Official Audio)`;
    const baseArgs = [
      '-f', audioFormatSelector(quality), '-g', '--no-playlist',
      '--force-ipv4', '--extractor-retries', '2', '--socket-timeout', '5',
    ];
    let lastError = null;
    let attempts = 0;

    for (let i = 0; i < YT_CLIENTS.length; i++) {
      if (signal?.aborted) {
        lastError = new YtDlpError(classifyYtDlpFailure({ cancelled: true }));
        break;
      }
      const delay = backoffMs(i);
      if (i > 0 && deadline - Date.now() <= delay) break;
      if (delay > 0) await sleep(delay, signal);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      const { name: clientName, args: clientArgs } = YT_CLIENTS[i];
      attempts += 1;
      try {
        const url = await runUrl(
          [...JS_RUNTIME_ARGS, ...baseArgs, ...clientArgs, ytTarget],
          Math.min(remainingMs, 5500),
          { signal, client: clientName },
        );
        if (url) return url;
      } catch (err) {
        lastError = err instanceof YtDlpError
          ? err
          : new YtDlpError(classifyYtDlpFailure({ output: err?.message || '' }), { client: clientName });
        if (!lastError.retryable || lastError.code === 'YT_EXTRACTOR_BUSY') break;
      }
    }

    // Un video concreto puede estar restringido a Music Premium aunque existan
    // otras subidas públicas de la misma canción. En ese caso se consulta un
    // conjunto pequeño de resultados de YouTube y solo se prueban candidatos
    // cuyo título y créditos coinciden; nunca se sustituye silenciosamente por
    // un remix o un mashup que solo comparte una palabra.
    if (
      videoId && lastError && ALTERNATE_FAILURE_CODES.has(lastError.code) &&
      !signal?.aborted && deadline - Date.now() > 0
    ) {
      const alternateBudget = Math.min(ALTERNATE_SEARCH_TIMEOUT_MS, deadline - Date.now());
      let alternateCandidates = [];
      // Una consulta de búsqueda puede devolver cero líneas aunque YouTube
      // tenga subidas públicas válidas (fallo transitorio del endpoint de
      // búsqueda, no ausencia de la pista). Repetimos una sola vez con el
      // orden de términos invertido, dentro del mismo presupuesto global.
      const alternateQueries = [
        `${artist} ${title}`,
        `${title} ${artist}`,
      ];
      for (const alternateQuery of alternateQueries) {
        const searchRemaining = deadline - Date.now();
        if (alternateCandidates.length || searchRemaining <= 0) break;
        try {
          const lines = await runLines([
            `ytsearch${ALTERNATE_SEARCH_LIMIT}:${alternateQuery}`,
            '--dump-json', '--flat-playlist', '--no-warnings',
            ...JS_RUNTIME_ARGS,
          ], { timeoutMs: Math.min(alternateBudget, searchRemaining), signal });
          alternateCandidates = selectAlternateVideoCandidates({
            artist,
            title,
            videoId,
            candidates: lines.map(safeParse).filter(Boolean),
          });
        } catch { /* probar la consulta invertida si aún queda presupuesto */ }
      }

      for (const candidate of alternateCandidates) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0 || signal?.aborted) break;
        try {
          const alternateUrl = await runUrl(
            [...JS_RUNTIME_ARGS, ...baseArgs, `https://www.youtube.com/watch?v=${candidate.id}`],
            Math.min(remainingMs, 5500),
            { signal, client: 'alternate' },
          );
          if (alternateUrl) return alternateUrl;
        } catch { /* probar el siguiente candidato verificado */ }
      }
    }

    // El proveedor secundario solo se intenta ante un error técnico temporal,
    // nunca para eludir una restricción de acceso explícita del video.
    const remainingMs = deadline - Date.now();
    if (
      remainingMs > 0 && lastError?.retryable && typeof scFallback === 'function' &&
      artist && title && !signal?.aborted
    ) {
      try {
        const scUrl = await withTimeout(
          scFallback({ artist, title, quality }, { timeoutMs: remainingMs, signal }),
          remainingMs,
        );
        if (scUrl) return scUrl;
      } catch { /* se conserva la causa original de YouTube */ }
    }

    const finalError = lastError || new YtDlpError(classifyYtDlpFailure({ timedOut: Date.now() >= deadline }));
    if (finalError.code !== 'YT_RESOLUTION_CANCELLED') {
      try {
        logger?.warn?.('[yt-dlp] resolución fallida', JSON.stringify({
          code: finalError.code,
          client: finalError.client,
          attempts,
          elapsedMs: Date.now() - startedAt,
        }));
      } catch { /* la telemetría no debe bloquear la reproducción */ }
    }
    throw finalError;
  };
}

/** Sleep cancelable: abortar el request no deja la cascada esperando backoff. */
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

// ───────────────────────────────────────────────────────────────
// Control de concurrencia de procesos yt-dlp.
// Cada reproducción/búsqueda lanza un proceso yt-dlp. Sin límite, muchos
// usuarios simultáneos saturarían CPU/memoria y tumbarían el backend.
// Semáforo: como máximo MAX_CONCURRENT procesos a la vez; el resto hace cola.
// Además, cada proceso se MATA al expirar para no dejar procesos zombie.
// ───────────────────────────────────────────────────────────────
function maxConcurrentProcesses() {
  const configured = Number(
    process.env.YTDLP_MAX_CONCURRENT || process.env.WORKER_RESOLVE_CONCURRENCY || process.env.RESOLVE_CONCURRENCY || 4,
  );
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 16) : 4;
}
let _active = 0;
const _waiters = [];

function acquireSlot(timeoutMs, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  if (_active < maxConcurrentProcesses()) { _active++; return Promise.resolve(true); }
  if (_waiters.length >= maxConcurrentProcesses() * 8) return Promise.resolve(false);
  return new Promise((resolve) => {
    const waiter = { settled: false, timer: null, abortListener: null };
    const settle = (granted) => {
      if (waiter.settled) return false;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      if (waiter.abortListener) signal?.removeEventListener('abort', waiter.abortListener);
      resolve(granted);
      return true;
    };
    waiter.grant = () => settle(true);
    const cancel = () => {
      const index = _waiters.indexOf(waiter);
      if (index >= 0) _waiters.splice(index, 1);
      settle(false);
    };
    waiter.timer = setTimeout(cancel, Math.max(1, timeoutMs));
    if (signal) {
      waiter.abortListener = cancel;
      signal.addEventListener('abort', cancel, { once: true });
    }
    _waiters.push(waiter);
  });
}
function releaseSlot() {
  while (_waiters.length) {
    const next = _waiters.shift();
    if (next.grant()) return; // el slot se transfiere al siguiente request
  }
  _active = Math.max(0, _active - 1);
}

/**
 * Ejecuta yt-dlp con límite de concurrencia y timeout que MATA el proceso.
 * @param {string[]} args
 * @param {{ mode?: 'url'|'lines', timeoutMs?: number }} opts
 */
function runYtDlp(args, { mode = 'url', timeoutMs = 30000, signal, client = null } = {}) {
  const empty = mode === 'lines' ? [] : null;
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 30000);
  return new Promise((resolve, reject) => {
    let settled = false;
    let hasSlot = false;
    let processClosed = false;
    let releaseAfterClose = false;
    let proc = null;
    let timer = null;
    let out = '';
    let stderr = '';
    const releaseSlotOnce = () => {
      if (!hasSlot) return;
      hasSlot = false;
      releaseSlot();
    };
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
      if (hasSlot && error && proc && proc.pid !== undefined && !processClosed) {
        releaseAfterClose = true;
      } else if (hasSlot) {
        releaseSlotOnce();
      }
      if (error && mode === 'url') reject(error);
      else resolve(value);
    };
    const onAbort = () => finish(empty, new YtDlpError(classifyYtDlpFailure({ cancelled: true }), { client }));
    if (signal?.aborted) {
      finish(empty, new YtDlpError(classifyYtDlpFailure({ cancelled: true }), { client }));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    acquireSlot(Math.max(1, deadline - Date.now()), signal).then((acquired) => {
      if (settled) {
        if (acquired) releaseSlot();
        return;
      }
      if (!acquired) {
        const details = signal?.aborted
          ? classifyYtDlpFailure({ cancelled: true })
          : classifyYtDlpFailure({ stage: 'queue' });
        finish(empty, new YtDlpError(details, { client }));
        return;
      }
      hasSlot = true;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        finish(empty, new YtDlpError(classifyYtDlpFailure({ timedOut: true }), { client }));
        return;
      }

      try {
        proc = spawn(resolveYtDlpBin(), args, { windowsHide: true });
        timer = setTimeout(
          () => finish(empty, new YtDlpError(classifyYtDlpFailure({ timedOut: true }), { client })),
          remainingMs,
        );
        proc.stdout.on('data', (data) => { out = appendLimited(out, data, 1_000_000); });
        proc.stderr.on('data', (data) => { stderr = appendLimited(stderr, data, 8_000); });
        proc.on('close', (code) => {
          processClosed = true;
          if (releaseAfterClose) {
            releaseSlotOnce();
            return;
          }
          if (mode === 'lines') {
            finish(out.trim() ? out.trim().split('\n') : []);
            return;
          }
          const lines = out.trim() ? out.trim().split('\n') : [];
          const url = lines.find((line) => line.startsWith('http://') || line.startsWith('https://'));
          if (url) {
            finish(url);
            return;
          }
          const details = classifyYtDlpFailure({ output: `${stderr}\n${out}` });
          finish(empty, new YtDlpError(details, { client, exitCode: code }));
        });
        proc.on('error', (error) => {
          if (proc.pid === undefined) processClosed = true;
          const details = classifyYtDlpFailure({ spawnError: error });
          finish(empty, new YtDlpError(details, { client }));
        });
      } catch (error) {
        const details = classifyYtDlpFailure({ spawnError: error });
        finish(empty, new YtDlpError(details, { client }));
      }
    }).catch((error) => {
      const details = classifyYtDlpFailure({ spawnError: error });
      finish(empty, new YtDlpError(details, { client }));
    });
  });
}

function appendLimited(current, chunk, maxLength) {
  if (current.length >= maxLength) return current;
  return current + chunk.toString().slice(0, maxLength - current.length);
}

function runForUrl(args, timeoutMs = 15000, options = {}) {
  return runYtDlp(args, { mode: 'url', timeoutMs, ...options });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('extractor timeout')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
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
      ...JS_RUNTIME_ARGS,
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

function runForLines(args, { timeoutMs = 15000, signal } = {}) {
  return runYtDlp(args, { mode: 'lines', timeoutMs, signal });
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
  return async function soundCloudCatalog(query, limit = 10, options = {}) {
    const args = [
      `scsearch${limit}:${query}`,
      '--dump-json', '--flat-playlist', '--no-warnings',
    ];
    const lines = await runForLines(args, options);
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
  return async function scExtractor({ stream, quality }, { timeoutMs = 12000, signal } = {}) {
    if (!stream) return null;
    const baseArgs = ['-f', audioFormatSelector(quality), '-g', '--no-playlist',
      '--extractor-retries', '1', '--socket-timeout', '5'];
    return runForUrl([...JS_RUNTIME_ARGS, ...baseArgs, stream], timeoutMs, { signal });
  };
}
