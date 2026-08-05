/**
 * useDownloads — descargas offline (IndexedDB).
 *
 * Responsabilidades:
 *   - download(track): descarga una pista con reintentos.
 *   - downloadMany(ids): descarga concurrente (4 workers).
 *   - removeDownload(id), clearDownloads(), getDownloads().
 *
 * Lee downloaded/downloading del playerStore.
 * Usa offline.js para IndexedDB.
 *
 * Uso:
 *   const { download, downloadMany, removeDownload, clearDownloads, getDownloads } =
 *     useDownloads({ quality, showToast, pendingRef, savePending });
 */
import { useCallback } from 'react';
import { api } from '../api.js';
import * as offline from '../offline.js';
import { cacheTrack, saveMeta, trackById } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import { usePlayerStore } from '../store/playerStore.js';
import { scheduleLibraryOfflineSync } from '../offlineLibrary.js';

const QUALITY_MAP = { high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' };

// Medido en producción (auditoría): la transferencia está limitada POR RECURSO
// (~33 KB/s por pista), no por un tope global, así que descargar pistas
// DISTINTAS en paralelo escala de verdad:
//   1 pista → 33 KB/s · 4 → 129 KB/s · 8 → 232 KB/s (resolve ya caliente).
// Rangos paralelos del MISMO archivo no aportan nada (6 rangos → 33 KB/s), por
// eso se paraleliza por pista y no por trozos.
const TRANSFER_CONCURRENCY = 8;
// El resolve (yt-dlp) es CPU en el backend: más de 4 en paralelo lo castiga sin
// mejorar nada, y compite con la reproducción de otros usuarios.
const RESOLVE_CONCURRENCY = 4;
// Reintentos del cuerpo de la descarga (la red del túnel corta a veces).
const MAX_ATTEMPTS = 3;

/** Ejecuta `fn` sobre `items` con un límite de tareas concurrentes. */
async function mapLimit(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

export function useDownloads({ quality, showToast, pendingRef, savePending } = {}) {
  const downloaded = usePlayerStore((s) => s.downloaded);
  const downloading = usePlayerStore((s) => s.downloading);
  const setDownloaded = usePlayerStore((s) => s.setDownloaded);
  const setDownloading = usePlayerStore((s) => s.setDownloading);
  const addDownloaded = usePlayerStore((s) => s.addDownloaded);
  const addDownloading = usePlayerStore((s) => s.addDownloading);
  const removeDownloading = usePlayerStore((s) => s.removeDownloading);

  const streamUrlQ = useCallback(async (t) => {
    return api.ensureStreamUrl({
      artist: t.artist, title: t.title, id: t.id,
      quality: QUALITY_MAP[quality] || 'high',
    });
  }, [quality]);

  // 90s era insuficiente: medido en producción, una descarga de ~4.5MB puede
  // tardar >130s cuando el CDN de origen (YouTube) limita el bandwidth de la
  // conexión — el fetch entero completaba con status 200 y content-length
  // correcto, pero el AbortController lo cortaba a mitad de la descarga del
  // body (net::ERR_ABORTED), dejando la descarga "colgada" indefinidamente en
  // la UI (el catch silencioso hacía un único retry, que también expiraba).
  // 4 minutos da margen holgado incluso a conexiones lentas sin bloquear la
  // UI para siempre: si de verdad no hay red, expira igual y el catch avisa.
  const fetchBlobWithTimeout = useCallback(async (url, ms = 240000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.blob();
    } finally { clearTimeout(t); }
  }, []);

  // 3 intentos con backoff (antes 1 solo reintento): a 33 KB/s una pista tarda
  // minutos y un corte puntual del túnel tiraba la descarga entera.
  const fetchTrackBlob = useCallback(async (tk) => {
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, 1200 * (attempt - 1)));
          api._streamSignCache?.clear?.();
        }
        let url = await streamUrlQ(tk);
        // Romper la caché HTTP solo en reintentos: en el primer intento una
        // respuesta cacheada es justamente lo que queremos aprovechar.
        if (attempt > 1) url += (url.includes('?') ? '&' : '?') + '_r=' + Date.now();
        const blob = await fetchBlobWithTimeout(url, 240000);
        if (!blob || !blob.size) throw new Error('blob vacío');
        return blob;
      } catch (err) { lastErr = err; }
    }
    throw lastErr || new Error('descarga fallida');
  }, [streamUrlQ, fetchBlobWithTimeout]);

  /**
   * Pre-calienta la resolución en el backend SIN descargar audio.
   *
   * Medido: TTFB en frío 5,9 s (yt-dlp) vs 0,35 s ya resuelto. Al calentar
   * primero, la transferencia no paga esa espera pista a pista.
   */
  const warmResolves = useCallback(async (ids) => {
    const qParam = QUALITY_MAP[quality] || 'high';
    await mapLimit(ids, RESOLVE_CONCURRENCY, async (id) => {
      const t = trackById(id);
      if (!t) return;
      try { await api.prefetchStream({ artist: t.artist, title: t.title, id: t.id, quality: qParam }); } catch { /* best-effort */ }
    });
  }, [quality]);

  const download = useCallback(async (tk) => {
    if (!tk || downloaded.has(tk.id) || downloading.has(tk.id)) return;
    // Reintentar aquí la persistencia: al arrancar el navegador puede denegarla
    // por falta de engagement, pero tras una acción explícita del usuario
    // (descargar) suele concederla. Sin persistencia el navegador puede
    // desalojar IndexedDB y las descargas desaparecen entre sesiones.
    offline.ensurePersistentStorage();
    addDownloading(tk.id);
    cacheTrack(tk); saveMeta();
    pendingRef?.current?.add(tk.id); savePending?.();
    api.saveTracks([slimTrack(tk)]).catch(() => {});
    try {
      const blob = await fetchTrackBlob(tk);
      await offline.saveTrack(tk, blob);
      addDownloaded(tk.id);
      // Una pista descargada debe poder verse/cantarse sin conexión: la letra
      // va en el mismo paquete offline que el audio.
      scheduleLibraryOfflineSync([tk.id]);
      showToast?.('Descargada · disponible sin conexión');
    } catch (err) {
      if (err instanceof offline.QuotaError) showToast?.('Almacenamiento lleno. Libera espacio para descargar.');
      else showToast?.(`No se pudo descargar: ${tk.title}`);
    }
    finally {
      removeDownloading(tk.id);
      pendingRef?.current?.delete(tk.id); savePending?.();
    }
  }, [downloaded, downloading, addDownloading, addDownloaded, removeDownloading, fetchTrackBlob, showToast, pendingRef, savePending]);

  const clearDownloads = useCallback(async () => {
    try { await offline.deleteAll(); } catch {}
    setDownloaded(new Set());
    showToast?.('Todas las descargas eliminadas');
  }, [setDownloaded, showToast]);

  const getDownloads = useCallback(() => offline.downloadsInfo(), []);

  const removeDownload = useCallback(async (id) => {
    try { await offline.deleteTrack(id); } catch {}
    setDownloaded(d => { const n = new Set(d); n.delete(id); return n; });
    showToast?.('Descarga eliminada');
  }, [setDownloaded, showToast]);

  const downloadMany = useCallback(async (ids) => {
    const candidates = ids.filter(id => !downloaded.has(id) && !downloading.has(id) && trackById(id));
    if (!candidates.length) { showToast?.('Ya está todo descargado'); return; }
    // IndexedDB es la fuente de verdad: el estado de React puede ir por detrás
    // (hidratación asíncrona al arrancar). Sin esta comprobación se volvían a
    // descargar pistas que ya estaban en disco, mostrándolas como "descargando"
    // y gastando red y batería para nada.
    let onDisk = new Set();
    try { onDisk = new Set(await offline.listIds()); } catch { /* sin IDB: seguir con lo que sabemos */ }
    const already = candidates.filter(id => onDisk.has(id));
    if (already.length) {
      // Reconciliar: marcarlas como descargadas y sacarlas de la cola pendiente.
      already.forEach(id => addDownloaded(id));
      already.forEach(id => pendingRef?.current?.delete(id));
      savePending?.();
    }
    const todo = candidates.filter(id => !onDisk.has(id));
    if (!todo.length) { showToast?.('Ya está todo descargado'); return; }
    todo.forEach(id => addDownloading(id));
    todo.forEach(id => pendingRef?.current?.add(id)); savePending?.(); saveMeta();
    offline.ensurePersistentStorage();
    api.saveTracks(todo.map(trackById).map(slimTrack).filter(Boolean)).catch(() => {});
    // Calentar los resolves EN PARALELO a las transferencias: las primeras
    // pistas empiezan ya, y para cuando les toca el turno a las siguientes su
    // resolve está listo (0,35 s en vez de 5,9 s).
    warmResolves(todo);
    let ok = 0, done = 0, quotaHit = false;
    let lastToast = 0;
    const worker = async (id) => {
      if (quotaHit) { removeDownloading(id); return; }
      const tk = trackById(id);
      try {
        const blob = await fetchTrackBlob(tk);
        await offline.saveTrack(tk, blob);
        addDownloaded(id);
        // Solo se saca de pendientes cuando de verdad está en disco: si el lote
        // se interrumpe, al volver se reanuda exactamente lo que falta.
        pendingRef?.current?.delete(id); savePending?.();
        ok++;
      } catch (err) {
        if (err instanceof offline.QuotaError) quotaHit = true;
      }
      finally {
        removeDownloading(id);
        done++;
        // Un aviso por pista era ruido; se limita a uno cada 1,5 s.
        const now = Date.now();
        if (now - lastToast > 1500 || done === todo.length) {
          lastToast = now;
          showToast?.(`Descargando ${done}/${todo.length}…`);
        }
      }
    };
    await mapLimit(todo, TRANSFER_CONCURRENCY, worker);
    if (quotaHit) {
      showToast?.('Almacenamiento lleno. Libera espacio para seguir descargando.');
      return;
    }
    // Letras del lote completo (solo las que sí descargaron audio); el propio
    // scheduler limita a 2 workers concurrentes, así que no compite por red/CPU
    // con las descargas de audio que ya terminaron.
    scheduleLibraryOfflineSync(todo);
    showToast?.(`${ok}/${todo.length} descargadas`);
  }, [downloaded, downloading, addDownloading, addDownloaded, removeDownloading, fetchTrackBlob, warmResolves, showToast, pendingRef, savePending]);

  return { download, downloadMany, removeDownload, clearDownloads, getDownloads };
}

export default useDownloads;
