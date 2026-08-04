/**
 * radioNext.js — política PURA de calidad para la cola de radio pre-extendida
 * en el frontend (usePlaybackController.ensureRadioFull).
 *
 * El backend (radioCohesion.assembleRadio) ya entrega una cola cohesionada y
 * deduplicada. Al re-extender la cola en el cliente con nuevas llamadas de radio
 * hay que mantener esa calidad frente a la COLA COMPLETA ya presente:
 *   (a) sin el mismo artista consecutivo salvo que no haya alternativa,
 *   (b) preferir la versión de estudio sobre live/remix,
 *   (c) dedup estricto por id Y por título normalizado contra la cola completa,
 *   (d) cap de pistas por artista en la ventana de radio.
 *
 * Funciones puras y deterministas → testeables sin red ni DOM.
 */

// Título no-estudio (directo/remix/acústico/etc.).
const LIVE_REMIX_RE = /\b(live|en\s+vivo|en\s+directo|remix|remaster(?:ed)?|acoustic|ac[uú]stico|unplugged|session|sped[\s-]?up|slowed|karaoke|instrumental|demo)\b/i;

export function isLiveOrRemix(title) {
  return typeof title === 'string' && LIVE_REMIX_RE.test(title);
}

// Título base: minúsculas, sin el sufijo entre paréntesis/corchetes. MISMA
// semántica que helpers.dedupeByTitle: recortar además desde "-", "–" o "|"
// colapsaba títulos legítimamente distintos ("Artista - Canción A" y
// "Artista - Canción B" → misma clave), vaciaba la cola de radio y dejaba la
// reproducción sin siguiente pista (regresión P0-1).
function normTitleBase(s) {
  return (s || '').toLowerCase().replace(/\s*[([].*$/, '').trim();
}
function normArtist(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Fusiona candidatas nuevas de radio en la cola de reproducción conservando la
 * calidad. Devuelve SOLO las pistas nuevas a añadir (en orden), ya filtradas y
 * ordenadas. No muta las entradas.
 *
 * @param {Array<object>} existing pistas ya en la cola (objetos normalizados)
 * @param {Array<object>} candidates pistas nuevas de la radio (normalizadas)
 * @param {{ maxPerArtist?: number }} [opts]
 * @returns {Array<object>}
 */
// Pistas que la cola necesita como mínimo para poder avanzar sin cortes.
const MIN_TAIL = 20;

export function mergeRadioTail(existing, candidates, { maxPerArtist = 5 } = {}) {
  const exist = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const cands = Array.isArray(candidates) ? candidates.filter((t) => t && t.id) : [];

  const seenIds = new Set(exist.map((t) => t.id).filter(Boolean));
  const seenTitles = new Set(exist.map((t) => normTitleBase(t.title)).filter(Boolean));

  // (b)+(c) Agrupar por título base y quedarse con la mejor versión (estudio),
  //         descartando duplicados por id/título contra la cola existente.
  const byTitle = new Map();
  for (const t of cands) {
    if (seenIds.has(t.id)) continue;
    const tk = normTitleBase(t.title);
    if (tk && seenTitles.has(tk)) continue;
    const key = tk || t.id;
    const cur = byTitle.get(key);
    if (!cur) byTitle.set(key, t);
    else if (isLiveOrRemix(cur.title) && !isLiveOrRemix(t.title)) byTitle.set(key, t);
  }
  const pool = [...byTitle.values()];

  // (d) El cap se mide sobre la VENTANA NUEVA (igual que el capPerArtist que
  //     esta función sustituyó), no sobre la cola completa: contar la cola ya
  //     existente hacía que una radio mono-artista quedase bloqueada para
  //     siempre en cuanto acumulaba `maxPerArtist` pistas de ese artista.
  //     Además el cap es una PREFERENCIA de diversidad: si el pool no tiene
  //     artistas suficientes para llenar la ventana, se eleva a la cuota justa.
  //     La diversidad es preferencia; la continuidad de la cola es requisito.
  const distinctArtists = new Set(pool.map((t) => normArtist(t.artist))).size || 1;
  const target = Math.min(pool.length, MIN_TAIL);
  const cap = Math.max(maxPerArtist, Math.ceil(target / distinctArtists));

  // (a) Construir la cola evitando artista consecutivo y respetando el cap.
  const artistCount = new Map();
  const out = [];
  let lastArtist = normArtist(exist.length ? exist[exist.length - 1].artist : '');
  const underCap = (t) => (artistCount.get(normArtist(t.artist)) || 0) < cap;

  while (pool.length) {
    let idx = pool.findIndex((t) => normArtist(t.artist) !== lastArtist && underCap(t));
    // Sin alternativa de otro artista bajo el cap: permitir el mismo artista.
    if (idx === -1) idx = pool.findIndex((t) => underCap(t));
    if (idx === -1) break; // todo lo restante supera el cap
    const [t] = pool.splice(idx, 1);
    const a = normArtist(t.artist);
    out.push(t);
    artistCount.set(a, (artistCount.get(a) || 0) + 1);
    lastArtist = a;
  }
  return out;
}
