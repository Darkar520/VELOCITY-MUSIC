// Almacenamiento offline de canciones con IndexedDB.
// Guarda el audio (blob) + metadatos dentro del propio navegador/app,
// sin diálogo de "guardar como". Persiste entre sesiones.

import '../public/offline-artwork.js';
import { FALLBACK_COVER } from './constants.js';
const DB_NAME = 'velocity-offline';
const STORE = 'tracks';
const LYRICS_STORE = 'lyrics';
// v3: store de metadatos SEPARADO del audio. Leer metadatos ya no obliga a
// deserializar los blobs: `tracks` pesa cientos de MB, `meta` unos pocos KB.
const META_STORE = 'meta';
let _db = null;

/** Error de cuota agotada: el lote debe pararse, no seguir fallando pista a pista. */
export class QuotaError extends Error {
  constructor(message = 'Almacenamiento lleno') { super(message); this.name = 'QuotaError'; }
}

function isQuotaError(err) {
  const n = err && (err.name || '');
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || n === 'QuotaError';
}

/**
 * Marca el almacenamiento como PERSISTENTE.
 *
 * Sin esto el origen es "best-effort" y el navegador puede DESALOJAR IndexedDB
 * entera cuando hay presión de disco (Chrome) o tras unos días sin abrir la app
 * (Safari/iOS). Con cientos de MB de audio descargado eso significa que las
 * descargas "desaparecen" solas entre sesiones — el motivo real por el que una
 * biblioteca ya descargada volvía a aparecer como no descargada.
 *
 * Chrome lo concede sin prompt si hay engagement/PWA instalada; si se deniega,
 * se degrada silenciosamente (no rompe nada, solo sigue siendo desalojable).
 */
export async function ensurePersistentStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    // v2: letras sincronizadas. v3: store `meta` (metadatos sin blobs).
    // La migración es ADITIVA: nunca se toca ni se borra nada de `tracks`, así
    // que una biblioteca ya descargada no corre riesgo al actualizar.
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LYRICS_STORE)) db.createObjectStore(LYRICS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function lyricsStatus(data) {
  if (data?.synced) return 'synced';
  if (data?.plain) return 'plain';
  return ['pending', 'failed'].includes(data?.status) ? data.status : 'pending';
}

function lyricsRecord(id, data = {}, previous = null) {
  const synced = data.synced || previous?.synced || null;
  const plain = data.plain || previous?.plain || null;
  return {
    ...(previous || {}),
    id,
    synced,
    plain,
    translation: data.translation || ((synced === previous?.synced && plain === previous?.plain) ? previous?.translation : null) || null,
    source: data.source || previous?.source || null,
    status: lyricsStatus({ ...data, synced, plain }),
    error: data.error || null,
    attempts: Number.isFinite(data.attempts) ? data.attempts : Number(previous?.attempts || 0),
    lastAttemptAt: data.lastAttemptAt || previous?.lastAttemptAt || null,
    at: Date.now(),
  };
}

async function putLyricsRecord(id, data) {
  if (!id || !data) return false;
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE, 'readwrite');
      tx.objectStore(LYRICS_STORE).put(data);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}

/** Guarda letra (LRC y/o plain) para reproducción offline. */
export async function saveLyrics(id, data) {
  if (!id || !data) return false;
  const previous = await getLyrics(id);
  return putLyricsRecord(id, lyricsRecord(id, data, previous));
}

/** Persiste el estado de resolución aunque aún no haya letra disponible. */
export async function saveLyricsStatus(id, status, details = {}) {
  if (!id || !['pending', 'synced', 'plain', 'failed'].includes(status)) return false;
  const previous = await getLyrics(id);
  const record = lyricsRecord(id, {
    ...details,
    status,
    synced: status === 'synced' ? details.synced : previous?.synced,
    plain: status === 'plain' ? details.plain : previous?.plain,
  }, previous);
  record.status = record.synced ? 'synced' : record.plain ? 'plain' : status;
  return putLyricsRecord(id, record);
}

/** Lee letra cacheada (offline), incluyendo el estado persistido. */
export async function getLyrics(id) {
  if (!id) return null;
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(LYRICS_STORE, 'readonly');
      const rq = tx.objectStore(LYRICS_STORE).get(id);
      rq.onsuccess = () => {
        const value = rq.result || null;
        resolve(value ? { ...value, status: lyricsStatus(value) } : null);
      };
      rq.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/** Lista estados de letras para construir un reporte de cobertura real. */
export async function listLyrics() {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return [];
    return await new Promise((resolve) => {
      const tx = db.transaction(LYRICS_STORE, 'readonly');
      const rq = tx.objectStore(LYRICS_STORE).getAll();
      rq.onsuccess = () => resolve((rq.result || []).map((value) => ({ ...value, status: lyricsStatus(value) })));
      rq.onerror = () => resolve([]);
    });
  } catch { return []; }
}

export async function deleteLyrics(id) {
  if (!id) return false;
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(LYRICS_STORE)) return false;
    await new Promise((resolve) => {
      const tx = db.transaction(LYRICS_STORE, 'readwrite');
      tx.objectStore(LYRICS_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
    return true;
  } catch { return false; }
}

export async function saveTrack(meta, blob, { cacheCover = true } = {}) {
  const db = await openDB();
  if (!blob || !blob.size) throw new Error('blob vacío');
  // Cachear la carátula como data URL (vía proxy mismo-origen) para verla sin
  // conexión. Best-effort: si falla, se guarda la meta con su URL original.
  const previous = await getMeta(meta?.id);
  const m = cacheCover ? await globalThis.VelocityOfflineArtwork.prepare(meta, previous) : { ...previous, ...meta };
  const at = Date.now();
  // `size`/`type` quedan registrados para poder VERIFICAR la integridad después:
  // sin ellos una descarga truncada (blob a medias) es indistinguible de una
  // completa y se reproduce cortada.
  const size = blob.size;
  const type = blob.type || '';
  const stores = db.objectStoreNames.contains(META_STORE) ? [STORE, META_STORE] : [STORE];
  try {
    await new Promise((resolve, reject) => {
      // Una sola transacción para audio + metadatos: o entran los dos, o
      // ninguno. Así `meta` nunca anuncia una descarga que no existe.
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(STORE).put({ id: m.id, meta: m, blob, at, size, type });
      if (stores.length > 1) tx.objectStore(META_STORE).put({ id: m.id, meta: m, at, size, type });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    if (isQuotaError(err)) throw new QuotaError();
    throw err;
  }
  return m;
}

// El helper compartido conserva proxies existentes y sus parámetros de fallback.
async function coverToDataUrl(coverUrl, id) {
  return globalThis.VelocityOfflineArtwork.toDataUrl(coverUrl, id);
}
const isSavedCover = cover => typeof cover === 'string' && /^data:image\//i.test(cover) && cover !== FALLBACK_COVER;

/** Persist a discovered image without fetching or replacing downloaded audio. */
export async function saveCover(id, cover) {
  if (!id || !cover || cover === FALLBACK_COVER) return null;
  const meta = await getMeta(id);
  if (!meta) return null;
  if (isSavedCover(meta.cover)) return meta;
  const dataUrl = await coverToDataUrl(cover, id);
  if (!dataUrl) return null;
  const db = await openDB();
  const stores = db.objectStoreNames.contains(META_STORE) ? [STORE, META_STORE] : [STORE];
  return new Promise((resolve) => {
    let updated = null;
    const tx = db.transaction(stores, 'readwrite');
    // Read and write under the same lock. A deletion or newer metadata while
    // the image was downloading must never be resurrected or overwritten.
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => {
      const rec = request.result;
      if (!rec?.meta) return;
      if (isSavedCover(rec.meta.cover)) { updated = rec.meta; return; }
      updated = { ...rec.meta, cover: dataUrl, artworkStatus: 'ready' };
      tx.objectStore(STORE).put({ ...rec, meta: updated });
      if (stores.length > 1) tx.objectStore(META_STORE).put({
        id, meta: updated, at: rec.at || 0,
        size: rec.size ?? rec.blob?.size ?? 0, type: rec.type ?? rec.blob?.type ?? '',
      });
    };
    tx.oncomplete = () => resolve(updated);
    tx.onerror = tx.onabort = () => resolve(null);
  });
}

// Rellena las carátulas (data URL) de descargas antiguas que aún tengan URL
// remota. También recupera variantes del caché sin red. Devuelve las metas
// actualizadas para refrescar la interfaz. Secuencial para no saturar la red.
let _backfill = null;
export function backfillCovers({ coverFor } = {}) {
  if (!_backfill) _backfill = fillCovers(coverFor).finally(() => { _backfill = null; });
  return _backfill;
}
async function fillCovers(coverFor) {
  // Primero recolectar SOLO metadatos (sin cargar los blobs de la biblioteca).
  // El registro completo se lee
  // individualmente y solo para los pocos que hay que reescribir.
  const pend = (await listMetas()).filter(m => m?.id && !isSavedCover(m.cover));
  const updated = [];
  for (const { id, cover } of pend) {
    const saved = await saveCover(id, coverFor?.(id, cover) || cover);
    if (saved) updated.push(saved);
  }
  return updated;
}

export async function getRecord(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => resolve(null);
  });
}

/** Read metadata without deserializing the audio blob. */
export async function getMeta(id) {
  if (!id) return null;
  const db = await openDB();
  if (!db.objectStoreNames.contains(META_STORE)) return (await getRecord(id))?.meta || null;
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(id);
    request.onsuccess = () => resolve(request.result?.meta || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Blob del audio, VERIFICADO.
 *
 * Si el tamaño real no coincide con el registrado, la descarga está truncada
 * (corte de red a media escritura): se devuelve null para que la app la trate
 * como no descargada y la vuelva a bajar, en vez de reproducir audio cortado.
 */
export async function getBlob(id) {
  const r = await getRecord(id);
  if (!r || !r.blob || !r.blob.size) return null;
  if (Number.isFinite(r.size) && r.size > 0 && r.blob.size !== r.size) return null;
  return r.blob;
}

export async function deleteTrack(id) {
  const db = await openDB();
  const stores = db.objectStoreNames.contains(META_STORE) ? [STORE, META_STORE] : [STORE];
  return new Promise((resolve) => {
    // Borrar de los dos stores a la vez: si `meta` sobreviviera, la app creería
    // que la pista sigue descargada y no volvería a ofrecerla.
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(STORE).delete(id);
    if (stores.length > 1) tx.objectStore(META_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function listIds() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).getAllKeys();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => resolve([]);
  });
}

/**
 * Recorre los registros de uno en uno con un cursor.
 *
 * IMPORTANTE: no usar getAll() aquí. getAll() materializa TODOS los registros
 * —blobs de audio incluidos— en memoria a la vez: con una biblioteca de cientos
 * de canciones son cientos de MB de golpe, lo que congela el arranque y en móvil
 * puede hacer que el navegador mate la pestaña. Con cursor el pico de memoria es
 * un solo registro.
 *
 * `fn(record)` puede devolver un valor para acumular; devolver `false` corta.
 */
function eachRecord(db, fn) {
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, 'readonly'); } catch { resolve(); return; }
    const rq = tx.objectStore(STORE).openCursor();
    rq.onsuccess = () => {
      const cur = rq.result;
      if (!cur) { resolve(); return; }
      let cont = true;
      try { cont = fn(cur.value) !== false; } catch { /* ignore */ }
      if (cont) cur.continue(); else resolve();
    };
    rq.onerror = () => resolve();
  });
}

/** Lee todos los registros del store ligero `meta` (sin tocar los blobs). */
function readMetaStore(db) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(META_STORE)) { resolve(null); return; }
    try {
      const tx = db.transaction(META_STORE, 'readonly');
      const rq = tx.objectStore(META_STORE).getAll();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/**
 * Metadatos de todas las descargas.
 *
 * Camino rápido: el store `meta` (unos KB). Si está vacío pero hay audio
 * guardado —biblioteca creada antes de v3—, se recorre `tracks` una única vez y
 * se rellena `meta` en segundo plano; a partir del siguiente arranque el camino
 * rápido ya sirve. Nunca se borra nada de `tracks`.
 */
export async function listMetas() {
  try {
    const db = await openDB();
    const fromMeta = await readMetaStore(db);
    if (fromMeta && fromMeta.length) return fromMeta.map((r) => r.meta).filter(Boolean);
    const out = [];
    const toMigrate = [];
    await eachRecord(db, (r) => {
      if (r && r.meta) {
        out.push(r.meta);
        toMigrate.push({ id: r.id, meta: r.meta, at: r.at || 0, size: r.size ?? (r.blob && r.blob.size) ?? 0, type: r.type ?? (r.blob && r.blob.type) ?? '' });
      }
    });
    if (toMigrate.length && db.objectStoreNames.contains(META_STORE)) {
      try {
        const tx = db.transaction(META_STORE, 'readwrite');
        const os = tx.objectStore(META_STORE);
        toMigrate.forEach((rec) => os.put(rec));
      } catch { /* la migración es oportunista: si falla, se reintenta luego */ }
    }
    return out;
  } catch { return []; }
}

// Resumen de descargas: total, bytes ocupados y lista (meta + tamaño), más
// recientes primero. Para el administrador de almacenamiento.
export async function downloadsInfo() {
  const db = await openDB();
  let bytes = 0;
  const items = [];
  // Cursor: solo se retiene el tamaño y la meta, nunca todos los blobs a la vez.
  await eachRecord(db, (r) => {
    if (!r) return;
    const size = (r.blob && r.blob.size) || 0;
    bytes += size;
    items.push({ id: r.id, meta: r.meta || { id: r.id }, size, at: r.at || 0 });
  });
  items.sort((a, b) => b.at - a.at);
  return { count: items.length, bytes, items };
}

// Borra TODAS las descargas de una vez.
export async function deleteAll() {
  const db = await openDB();
  const stores = db.objectStoreNames.contains(META_STORE) ? [STORE, META_STORE] : [STORE];
  return new Promise((resolve) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(STORE).clear();
    if (stores.length > 1) tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// Elimina registros corruptos (sin blob o de tamaño 0) para que no queden
// descargas "rotas" ni ocupando espacio. Devuelve los ids eliminados.
export async function pruneInvalid() {
  const db = await openDB();
  const bad = [];
  await eachRecord(db, (r) => {
    if (!r || !r.id) return;
    // Sin blob / vacío → corrupto. Tamaño distinto al registrado → truncado.
    const empty = !r.blob || !r.blob.size;
    const truncated = Number.isFinite(r.size) && r.size > 0 && r.blob && r.blob.size !== r.size;
    if (empty || truncated) bad.push(r.id);
  });
  for (const id of bad) await deleteTrack(id);
  return bad;
}
