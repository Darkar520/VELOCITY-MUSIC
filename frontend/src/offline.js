// Almacenamiento offline de canciones con IndexedDB.
// Guarda el audio (blob) + metadatos dentro del propio navegador/app,
// sin diálogo de "guardar como". Persiste entre sesiones.

const DB_NAME = 'velocity-offline';
const STORE = 'tracks';
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
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
  const records = await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => resolve([]);
  });
  const updated = [];
  for (const rec of records) {
    if (!rec || !rec.meta) continue;
    const cover = rec.meta.cover;
    if (cover && typeof cover === 'string' && !cover.startsWith('data:')) {
      const dataUrl = await coverToDataUrl(cover);
      if (dataUrl && dataUrl.startsWith('data:')) {
        rec.meta = { ...rec.meta, cover: dataUrl };
        await new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(rec);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
        updated.push(rec.meta);
      }
    }
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

export async function listMetas() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).getAll();
    rq.onsuccess = () => resolve((rq.result || []).map((r) => r.meta).filter(Boolean));
    rq.onerror = () => resolve([]);
  });
}

function getAllRecords(db) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => resolve([]);
  });
}

// Resumen de descargas: total, bytes ocupados y lista (meta + tamaño), más
// recientes primero. Para el administrador de almacenamiento.
export async function downloadsInfo() {
  const db = await openDB();
  const records = await getAllRecords(db);
  let bytes = 0;
  const items = records
    .map((r) => { const size = (r && r.blob && r.blob.size) || 0; bytes += size; return { id: r.id, meta: r.meta || { id: r.id }, size, at: r.at || 0 }; })
    .sort((a, b) => b.at - a.at);
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
  const records = await getAllRecords(db);
  const bad = records.filter((r) => !r || !r.blob || !r.blob.size).map((r) => r && r.id).filter(Boolean);
  for (const id of bad) await deleteTrack(id);
  return bad;
}
