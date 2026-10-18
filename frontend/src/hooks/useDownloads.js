/** Browser-owned background transfers where supported; one bounded foreground
 * queue shared by songs and playlists everywhere else. */
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api.js';
import * as offline from '../offline.js';
import { cacheTrack, saveMeta, trackById, bestCoverFor, hasCover } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import { usePlayerStore } from '../store/playerStore.js';
import { scheduleLibraryOfflineSync } from '../offlineLibrary.js';
import { activeDownloads, transferSlot, prepareSlot, enqueueBackground, downloadJobs, cancelBackgroundDownloads, downloadSession, recoverStalledBackground } from '../downloads.js';

const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };
const quotaError = (error) => /quota/i.test(error?.name || '');

async function fetchAudio(url, job) {
  const controller = new AbortController();
  job.controller = controller;
  const timeout = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error(`http_${response.status}`), { retryable: ![400, 401, 403, 404].includes(response.status) });
    const blob = await response.blob();
    const expected = Number(response.headers?.get('content-length'));
    if (!blob?.size || (expected > 0 && blob.size !== expected)) throw new Error('incomplete_audio');
    if (blob.type && !/^(audio\/|video\/webm)/i.test(blob.type)) throw Object.assign(new Error('invalid_audio'), { retryable: false });
    return blob;
  } finally { clearTimeout(timeout); job.controller = null; }
}

function backfillExtras(ids) {
  if (!ids.length) return;
  scheduleLibraryOfflineSync(ids);
  // Optional extras never delay committing a complete audio file.
  offline.backfillCovers?.({ coverFor: bestCoverFor }).then((metas) => { metas.forEach(promoteCover); saveMeta(); }).catch(() => {});
}

function promoteCover(meta) {
  // A repair changes artwork only; retain newer text already in the catalog.
  cacheTrack({ ...(trackById(meta.id) || meta), cover: meta.cover });
}

export function useDownloads({ quality, showToast, pendingRef, savePending, authed = false, downloadsHydratedRef } = {}) {
  const selected = usePlayerStore(s => s.track);
  const selectedDownloaded = usePlayerStore(s => !!s.track?.id && s.downloaded.has(s.track.id));
  useEffect(() => {
    if (!selectedDownloaded || !selected?.id) return;
    const cover = bestCoverFor(selected.id, selected.cover);
    if (!hasCover(cover)) return;
    // One metadata lookup, no library scan or audio resolution. Also persist
    // images discovered after the original download or while the song plays.
    offline.saveCover(selected.id, cover).then(meta => { if (meta) promoteCover(meta); }).catch(() => {});
  }, [selectedDownloaded, selected?.id, selected?.cover]);
  const options = useRef({ showToast, pendingRef, savePending });
  options.current = { showToast, pendingRef, savePending };
  const runLatest = useRef(null);

  useEffect(() => {
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [ids, jobs] = await Promise.all([offline.listIds(), downloadJobs.list().catch(() => [])]);
        if (stopped) return;
        const saved = new Set(ids);
        const state = usePlayerStore.getState();
        const newlySaved = ids.filter((id) => !state.downloaded.has(id));
        if (newlySaved.length) {
          const metas = await offline.listMetas();
          if (stopped) return;
          metas.forEach(cacheTrack);
        }
        const running = jobs.filter((job) => ['queued', 'background'].includes(job.status));
        state.setDownloaded(saved);
        state.setDownloading(new Set([...downloadSession.preparing, ...activeDownloads.keys(), ...running.map((job) => job.id)]));
        jobs.forEach((job) => { if (job.meta) cacheTrack(job.meta); });
        const current = options.current;
        for (const id of current.pendingRef?.current || []) {
          if (saved.has(id) || jobs.some((job) => job.id === id && job.status === 'paused')) current.pendingRef.current.delete(id);
        }
        current.savePending?.();
        if (!running.length) backfillExtras(newlySaved);
        if (!running.length && !newlySaved.length) {
          offline.backfillCovers?.({ coverFor: bestCoverFor }).then(metas => metas.forEach(promoteCover)).catch(() => {});
        }
      } catch { /* preserve last-known state on storage failure */ }
      finally { refreshing = false; }
    };
    const onMessage = (event) => { if (event.data?.type === 'vm-downloads-changed') refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    navigator.serviceWorker?.addEventListener?.('message', onMessage);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      navigator.serviceWorker?.removeEventListener?.('message', onMessage);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const downloadMany = useCallback(async (input, { resume = false } = {}) => {
    const generation = downloadSession.generation;
    const state = usePlayerStore.getState();
    const ids = [...new Set(input)].filter((id) => trackById(id) && !state.downloaded.has(id) && !state.downloading.has(id));
    if (!ids.length) { showToast?.('Ya está todo descargado o en la cola'); return; }
    // Claim before the first await, including two clicks in one React render.
    state.setDownloading((current) => new Set([...current, ...ids]));
    ids.forEach((id) => downloadSession.preparing.add(id));
    const release = () => ids.forEach((id) => downloadSession.preparing.delete(id));
    ids.forEach((id) => pendingRef?.current?.add(id));
    savePending?.(); saveMeta();
    offline.ensurePersistentStorage();
    let onDisk;
    try { onDisk = new Set(await offline.listIds()); }
    catch {
      ids.forEach((id) => state.removeDownloading(id));
      release();
      showToast?.('No se pudo abrir el almacenamiento. La cola sigue pendiente.');
      return;
    }
    if (generation !== downloadSession.generation) { release(); return; }
    const already = ids.filter((id) => onDisk.has(id));
    already.forEach((id) => { state.addDownloaded(id); state.removeDownloading(id); pendingRef?.current?.delete(id); });
    savePending?.();
    const todo = ids.filter((id) => !onDisk.has(id));
    if (!todo.length) { release(); showToast?.('Ya está todo descargado'); return; }
    const tracks = todo.map(trackById);
    api.saveTracks(tracks.map(slimTrack)).catch(() => {});
    showToast?.(`Preparando ${todo.length} descarga${todo.length === 1 ? '' : 's'}…`);
    try {
      if (await enqueueBackground(tracks, QUALITY_MAP[quality] || 'high', { resume })) {
        release();
        if (generation !== downloadSession.generation) return;
        const jobs = await downloadJobs.list();
        const waiting = new Set(jobs.filter((job) => ['queued', 'background'].includes(job.status)).map((job) => job.id));
        todo.filter((id) => !waiting.has(id)).forEach((id) => state.removeDownloading(id));
        const saved = new Set(await offline.listIds());
        todo.filter((id) => saved.has(id)).forEach((id) => { state.addDownloaded(id); pendingRef?.current?.delete(id); });
        savePending?.();
        showToast?.(waiting.size ? 'Cola entregada al gestor de descargas del navegador.' : todo.every((id) => saved.has(id)) ? 'Descargas completas · disponibles sin conexión' : 'No se pudieron iniciar todas las descargas. Las pendientes se conservan.');
        return;
      }
    } catch { /* denied/unavailable background fetch uses the foreground queue */ }
    if (generation !== downloadSession.generation) { release(); return; }
    const browserOwned = new Set((await downloadJobs.list().catch(() => [])).filter((job) => job.status === 'background').map((job) => job.id));
    await downloadJobs.putMany(tracks.filter((track) => !browserOwned.has(track.id)).map((meta) => ({
      id: meta.id, meta, quality: QUALITY_MAP[quality] || 'high', status: 'foreground', attempts: 0,
    }))).catch(() => {});
    if (generation !== downloadSession.generation) { release(); return; }
    showToast?.('Descargando. Si el dispositivo suspende la app, continuaremos al volver.');
    let quotaHit = false;
    const succeeded = [];
    let finished = 0;
    let lastToast = 0;
    const work = todo.filter((id) => !browserOwned.has(id)).map((id) => {
      const job = { cancelled: false, controller: null };
      const promise = transferSlot(async () => {
        if (quotaHit || job.cancelled) return;
        const track = trackById(id);
        try {
          let blob;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (job.cancelled) return;
            try {
              const url = await prepareSlot(() => api.ensureStreamUrl({
                artist: track.artist, title: track.title, id,
                quality: QUALITY_MAP[quality] || 'high',
              }, { forceRefresh: attempt > 0 }));
              if (job.cancelled) return;
              blob = await fetchAudio(url, job);
              break;
            } catch (error) {
              if (job.cancelled) return;
              if (attempt === 2 || error.retryable === false) throw error;
              await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
            }
          }
          if (job.cancelled) return;
          const savedMeta = await offline.saveTrack(track, blob);
          if (savedMeta) cacheTrack(savedMeta);
          if (job.cancelled) { await offline.deleteTrack(id); return; }
          state.addDownloaded(id);
          pendingRef?.current?.delete(id); savePending?.();
          await downloadJobs.remove(id).catch(() => {});
          succeeded.push(id);
        } catch (error) { if (quotaError(error)) quotaHit = true; }
      }).finally(() => {
        activeDownloads.delete(id);
        state.removeDownloading(id);
        finished++;
        if (Date.now() - lastToast > 1500) {
          lastToast = Date.now();
          showToast?.(`Descargando · ${succeeded.length}/${todo.length} guardadas · ${finished} procesadas`);
        }
      });
      job.promise = promise;
      activeDownloads.set(id, job);
      return promise;
    });
    release();
    await Promise.all(work);
    backfillExtras(succeeded);
    if (quotaHit) {
      const jobs = await downloadJobs.list().catch(() => []);
      await downloadJobs.putMany(jobs.filter((job) => todo.includes(job.id)).map((job) => ({ ...job, status: 'paused', error: 'storage_full' }))).catch(() => {});
      showToast?.('Almacenamiento lleno. Libera espacio para seguir descargando.');
    }
    else if (succeeded.length === todo.length) showToast?.(`${succeeded.length}/${todo.length} descargadas · disponibles sin conexión`);
    else showToast?.(`${succeeded.length}/${todo.length} descargadas. Las pendientes se conservan para reintentar.`);
  }, [quality, showToast, pendingRef, savePending]);
  runLatest.current = downloadMany;

  useEffect(() => {
    if (!authed) return;
    let stopped = false, resuming = false, requested = false;
    const resume = async () => {
      if (stopped || navigator.onLine === false) return;
      if (resuming) { requested = true; return; }
      resuming = true;
      try {
        for (let i = 0; i < 150 && downloadsHydratedRef && !downloadsHydratedRef.current && !stopped; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (stopped) return;
        const recovered = await recoverStalledBackground().catch(() => []);
        recovered.forEach((id) => usePlayerStore.getState().removeDownloading(id));
        const jobs = await downloadJobs.list().catch(() => []);
        const current = options.current;
        jobs.forEach((job) => {
          if (job.meta) cacheTrack(job.meta);
          if (job.status === 'paused') current.pendingRef?.current?.delete(job.id);
          else current.pendingRef?.current?.add(job.id);
        });
        current.savePending?.();
        const pending = [...(current.pendingRef?.current || [])];
        if (pending.length && !stopped) await runLatest.current(pending, { resume: true });
      } finally {
        resuming = false;
        if (requested && !stopped) { requested = false; queueMicrotask(resume); }
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') resume(); };
    resume();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', onVisible); };
  }, [authed, downloadsHydratedRef]);

  const download = useCallback((track) => {
    if (!track?.id) return;
    cacheTrack(track);
    return downloadMany([track.id]);
  }, [downloadMany]);

  const clearDownloads = useCallback(async () => {
    downloadSession.generation++;
    downloadSession.preparing.clear();
    const running = [...activeDownloads.values()];
    running.forEach((job) => { job.cancelled = true; job.controller?.abort(); });
    await cancelBackgroundDownloads();
    await Promise.allSettled(running.map((job) => job.promise));
    await offline.deleteAll();
    usePlayerStore.getState().setDownloaded(new Set());
    usePlayerStore.getState().setDownloading(new Set());
    pendingRef?.current?.clear(); savePending?.();
    showToast?.('Todas las descargas eliminadas');
  }, [pendingRef, savePending, showToast]);

  const removeDownload = useCallback(async (id) => {
    const running = activeDownloads.get(id);
    if (running) { running.cancelled = true; running.controller?.abort(); await running.promise; }
    await downloadJobs.remove(id).catch(() => {});
    await offline.deleteTrack(id);
    usePlayerStore.getState().setDownloaded((current) => { const next = new Set(current); next.delete(id); return next; });
    pendingRef?.current?.delete(id); savePending?.();
    showToast?.('Descarga eliminada');
  }, [pendingRef, savePending, showToast]);

  const getDownloads = useCallback(() => offline.downloadsInfo(), []);
  return { download, downloadMany, removeDownload, clearDownloads, getDownloads };
}

export default useDownloads;
