/**
 * Audio_Format_Preference — selección de formato para yt-dlp.
 *
 * Preferencia: Opus (webm) ~160 kbps primario → AAC (m4a) ~256 kbps respaldo →
 * mejor audio disponible. Nunca formatos sin pérdida (flac/alac/wav) y sin
 * recodificar (yt-dlp con `-g`, sin `--extract-audio`).
 *
 * Requisitos: 2.5, 2.6, 2.7
 */

export const TARGET_OPUS_KBPS = 160;
export const TARGET_AAC_KBPS = 256;

const LOSSLESS_CODECS = new Set(['flac', 'alac', 'wav', 'pcm', 'tta', 'ape']);

/**
 * Cadena de selección de formato para `yt-dlp -f <selector> -g`.
 * Prioriza Opus/webm, luego AAC/m4a, luego mejor audio disponible.
 */
export function audioFormatSelector(quality = 'high') {
  if (quality === 'low') {
    // Menor consumo de datos.
    return ['bestaudio[ext=m4a][abr<=96]', 'worstaudio[ext=m4a]', 'bestaudio', 'best'].join('/');
  }
  if (quality === 'medium') {
    // AAC ~128 kbps, buena compatibilidad y peso moderado.
    return ['bestaudio[ext=m4a][abr<=140]', 'bestaudio[ext=m4a]', 'bestaudio', 'best'].join('/');
  }
  // 'high' (por defecto): Opus ~160 kbps → AAC m4a → mejor disponible.
  return ['bestaudio[acodec=opus]', 'bestaudio[ext=m4a]', 'bestaudio', 'best'].join('/');
}

function isLossless(acodec) {
  if (!acodec) return false;
  const codec = String(acodec).toLowerCase();
  return [...LOSSLESS_CODECS].some((c) => codec.includes(c));
}

function abrOf(fmt) {
  const n = Number(fmt.abr ?? fmt.tbr ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Selecciona el mejor formato solo-audio según la preferencia, excluyendo
 * lossless y sin recodificar.
 *
 * Entrada: lista de formatos al estilo yt-dlp `{ ext, acodec, abr, vcodec }`.
 * Devuelve `{ ext, acodec, abr }` o `null` si no hay audio utilizable.
 */
export function selectAudioFormat(formats) {
  if (!Array.isArray(formats)) return null;

  // Solo audio (sin pista de vídeo) y no lossless.
  const audioOnly = formats.filter((f) => {
    const noVideo = !f.vcodec || f.vcodec === 'none';
    return noVideo && !isLossless(f.acodec);
  });
  if (audioOnly.length === 0) return null;

  const pickClosest = (candidates, target) =>
    candidates.slice().sort(
      (a, b) => Math.abs(abrOf(a) - target) - Math.abs(abrOf(b) - target),
    )[0];

  // 1) Opus/webm cercano a 160 kbps.
  const opus = audioOnly.filter(
    (f) => f.ext === 'webm' || String(f.acodec).toLowerCase().includes('opus'),
  );
  if (opus.length) return toSelected(pickClosest(opus, TARGET_OPUS_KBPS));

  // 2) AAC/m4a cercano a 256 kbps.
  const aac = audioOnly.filter(
    (f) => f.ext === 'm4a' || String(f.acodec).toLowerCase().includes('aac'),
  );
  if (aac.length) return toSelected(pickClosest(aac, TARGET_AAC_KBPS));

  // 3) Mejor abr disponible no lossless.
  return toSelected(audioOnly.slice().sort((a, b) => abrOf(b) - abrOf(a))[0]);
}

function toSelected(fmt) {
  if (!fmt) return null;
  return { ext: fmt.ext ?? null, acodec: fmt.acodec ?? null, abr: abrOf(fmt) };
}
