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

  const fetchBlobWithTimeout = useCallback(async (url, ms = 90000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.blob();
    } finally { clearTimeout(t); }
  }, []);

  const fetchTrackBlob = useCallback(async (tk) => {
    try {
      const url = await streamUrlQ(tk);
      return await fetchBlobWithTimeout(url, 90000);
    } catch {
      await new Promise(r => setTimeout(r, 1500));
      api._streamSignCache?.clear?.();
      const url = await streamUrlQ(tk);
      return await fetchBlobWithTimeout(url + (url.includes('?') ? '&' : '?') + '_r=' + Date.now(), 90000);
    }
  }, [streamUrlQ, fetchBlobWithTimeout]);

  const download = useCallback(async (tk) => {
    if (!tk || downloaded.has(tk.id) || downloading.has(tk.id)) return;
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
    } catch { showToast?.(`No se pudo descargar: ${tk.title}`); }
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
    const todo = ids.filter(id => !downloaded.has(id) && !downloading.has(id) && trackById(id));
    if (!todo.length) { showToast?.('Ya está todo descargado'); return; }
    todo.forEach(id => addDownloading(id));
    todo.forEach(id => pendingRef?.current?.add(id)); savePending?.(); saveMeta();
    api.saveTracks(todo.map(trackById).map(slimTrack).filter(Boolean)).catch(() => {});
    let ok = 0, done = 0;
    const worker = async (id) => {
      const tk = trackById(id);
      try {
        const blob = await fetchTrackBlob(tk);
        await offline.saveTrack(tk, blob);
        addDownloaded(id);
        ok++;
      } catch {}
      finally {
        removeDownloading(id);
        pendingRef?.current?.delete(id); savePending?.();
        done++; showToast?.(`Descargando ${done}/${todo.length}…`);
      }
    };
    const queue = [...todo];
    const CONC = Math.min(4, queue.length);
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { await worker(queue.shift()); } }));
    // Letras del lote completo (solo las que sí descargaron audio); el propio
    // scheduler limita a 2 workers concurrentes, así que no compite por red/CPU
    // con las descargas de audio que ya terminaron.
    scheduleLibraryOfflineSync(todo);
    showToast?.(`${ok}/${todo.length} descargadas`);
  }, [downloaded, downloading, addDownloading, addDownloaded, removeDownloading, fetchTrackBlob, showToast, pendingRef, savePending]);

  return { download, downloadMany, removeDownload, clearDownloads, getDownloads };
}

export default useDownloads;
