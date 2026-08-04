// Almacenamiento offline de canciones con IndexedDB.
// Guarda el audio (blob) + metadatos dentro del propio navegador/app,
// sin diálogo de "guardar como". Persiste entre sesiones.

const DB_NAME = 'velocity-offline';
const STORE = 'tracks';
const LYRICS_STORE = 'lyrics';
let _db = null;

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
    // v2: store de letras sincronizadas para offline (solo biblioteca).
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LYRICS_STORE)) db.createObjectStore(LYRICS_STORE, { keyPath: 'id' });
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

export async function saveTrack(meta, blob) {
  const db = await openDB();
  // Cachear la carátula como data URL (vía proxy mismo-origen) para verla sin
  // conexión. Best-effort: si falla, se guarda la meta con su URL original.
  let m = meta;
  try {
    const dataUrl = await coverToDataUrl(meta && meta.cover);
    if (dataUrl && dataUrl.startsWith('data:')) m = { ...meta, cover: dataUrl };
  } catch {}
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: m.id, meta: m, blob, at: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
  return m;
}

// Descarga la carátula (a través del proxy /img del mismo origen, que evita
// problemas de CORS) y la convierte a data URL a resolución media.
async function coverToDataUrl(coverUrl) {
  if (!coverUrl || typeof coverUrl !== 'string' || coverUrl.startsWith('data:')) return coverUrl || null;
  try {
    const medium = coverUrl
      .replace(/=w\d+-h\d+/, '=w544-h544')
      .replace(/=s\d+/, '=s544')
      .replace(/(\d+)x(\d+)bb\.(jpg|png)/i, '544x544bb.$3');
    const r = await fetch('/img?u=' + encodeURIComponent(medium));
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

// Rellena las carátulas (data URL) de descargas antiguas que aún tengan URL
// remota. Se ejecuta una vez al iniciar con conexión. Devuelve las metas
// actualizadas para refrescar la interfaz. Secuencial para no saturar la red.
export async function backfillCovers() {
  const db = await openDB();
  // Primero recolectar SOLO los ids/covers que faltan (cursor: sin cargar los
  // blobs de toda la biblioteca en memoria). El registro completo se lee
  // individualmente y solo para los pocos que hay que reescribir.
  const pend = [];
  await eachRecord(db, (r) => {
    const cover = r && r.meta && r.meta.cover;
    if (r && r.id && typeof cover === 'string' && cover && !cover.startsWith('data:')) {
      pend.push({ id: r.id, cover });
    }
  });
  const updated = [];
  for (const { id, cover } of pend) {
    const dataUrl = await coverToDataUrl(cover);
    if (!dataUrl || !dataUrl.startsWith('data:')) continue;
    const rec = await getRecord(id);
    if (!rec || !rec.meta) continue;
    rec.meta = { ...rec.meta, cover: dataUrl };
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    updated.push(rec.meta);
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

export async function getBlob(id) {
  const r = await getRecord(id);
  return r ? r.blob : null;
}

export async function deleteTrack(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
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

export async function listMetas() {
  try {
    const db = await openDB();
    const out = [];
    await eachRecord(db, (r) => { if (r && r.meta) out.push(r.meta); });
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
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
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
    if (r && r.id && (!r.blob || !r.blob.size)) bad.push(r.id);
  });
  for (const id of bad) await deleteTrack(id);
  return bad;
}
