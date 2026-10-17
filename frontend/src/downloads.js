import '../public/downloads-db.js';
import { api } from './api.js';

export const downloadJobs = globalThis.VelocityDownloadDB.createStore();

export function limitConcurrency(limit) {
  let active = 0;
  const waiting = [];
  const drain = () => {
    while (active < limit && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; drain(); });
    }
  };
  return (task) => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); drain(); });
}

// Shared across single songs, overlapping lists and hook re-renders.
export const transferSlot = limitConcurrency(8);
export const prepareSlot = limitConcurrency(4);
export const activeDownloads = new Map();
export const downloadSession = { generation: 0, preparing: new Set() };
const UNSUPPORTED_UNTIL = 'velocity.backgroundUnavailableUntil';
function deferBackground() { try { localStorage.setItem(UNSUPPORTED_UNTIL, String(Date.now() + 3600000)); } catch {} }

export function waitForBackgroundStart(registration, timeoutMs = 45000) {
  if (!registration?.addEventListener) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const finish = (value) => { clearTimeout(timer); registration.removeEventListener('progress', check); resolve(value); };
    const check = () => { if (registration.downloaded > 0 || registration.result) finish(true); };
    timer = setTimeout(() => finish(false), timeoutMs);
    registration.addEventListener('progress', check);
    check();
  });
}

function message(worker, data, timeout = 2500) {
  return new Promise((resolve) => {
    if (!worker || typeof MessageChannel === 'undefined') return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, timeout);
    channel.port1.onmessage = (event) => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage(data, [channel.port2]);
  });
}

export async function backgroundRegistration({ ignoreDefer = false } = {}) {
  try {
    if (!ignoreDefer && Number(localStorage.getItem(UNSUPPORTED_UNTIL)) > Date.now()) return null;
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (!registration?.backgroundFetch || !registration.active) return null;
    const capabilities = await message(registration.active, { type: 'vm-download-capabilities' });
    return capabilities?.version === 2 && capabilities.background ? registration : null;
  } catch { return null; }
}

export async function enqueueBackground(tracks, quality, { resume = false } = {}) {
  const registration = await backgroundRegistration();
  if (!registration) return false;
  const enqueue = async () => {
    const previous = new Map((await downloadJobs.list()).map((job) => [job.id, job]));
    const activeBatches = new Set(await registration.backgroundFetch.getIds());
    const completed = new Set(await downloadJobs.savedIds());
    const sign = limitConcurrency(4);
    // Persist every track's metadata before any network work. A page closed
    // during signing can restore the whole playlist, even before catalog sync.
    const pending = tracks.filter((track) => !completed.has(track.id));
    await downloadJobs.putMany(pending.filter((track) => !previous.has(track.id)).map((meta) => ({ id: meta.id, meta, quality, status: 'queued', attempts: 0 })));
    await Promise.all(pending.map((meta) => sign(async () => {
      const old = previous.get(meta.id);
      if ((old?.status === 'background' && activeBatches.has(old.batchId)) || (resume && old?.status === 'paused')) return;
      const jobQuality = resume && old?.quality ? old.quality : quality;
      try {
        const url = await api.signDownloadUrl({ artist: meta.artist, title: meta.title, id: meta.id, quality: jobQuality });
        await downloadJobs.put({ id: meta.id, meta, quality: jobQuality, url, status: 'queued', attempts: 0 });
      } catch {
        await downloadJobs.put({ id: meta.id, meta, quality, status: 'failed', error: 'sign_failed', attempts: 0 });
      }
    })));
    const jobs = (await downloadJobs.list()).filter((job) => pending.some((track) => track.id === job.id)
      && job.status === 'queued' && job.url);
    if (!jobs.length) return pending.some((track) => previous.get(track.id)?.status === 'background');
    const batchId = 'velocity-download-' + (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await downloadJobs.putMany(jobs.map((job) => ({ ...job, status: 'background', batchId, startedAt: Date.now(), attempts: (job.attempts || 0) + 1 })));
    try {
      // Chrome 149+ blocks new fetch registrations from a service worker.
      // Hand off EVERY request from the page; the browser bounds concurrency
      // and continues the whole playlist without requiring a live JS queue.
      const transfer = await registration.backgroundFetch.fetch(batchId, jobs.map((job) => job.url), {
        title: `Velocity · ${jobs.length} canciones`,
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      });
      if (!await waitForBackgroundStart(transfer) && navigator.onLine !== false && document.visibilityState === 'visible') {
        const result = await message(registration.active, { type: 'vm-download-abandon', batchId }, 10000);
        if (result?.ok) { deferBackground(); return false; }
      }
    } catch {
      await downloadJobs.putMany(jobs.map((job) => ({ ...job, status: 'failed', error: 'background_unavailable' })));
      return false;
    }
    return true;
  };
  return navigator.locks?.request ? navigator.locks.request('velocity-download-enqueue', enqueue) : enqueue();
}

export async function recoverStalledBackground() {
  const registration = await backgroundRegistration({ ignoreDefer: true });
  if (!registration || navigator.onLine === false || document.visibilityState !== 'visible') return [];
  const jobs = await downloadJobs.list();
  const stale = jobs.filter((job) => job.status === 'background' && Date.now() - (Number(job.startedAt) || 0) > 60000);
  const recovered = [];
  for (const batchId of new Set(stale.map((job) => job.batchId))) {
    const transfer = await registration.backgroundFetch.get(batchId);
    if (!transfer || transfer.result || transfer.downloaded > 0) continue;
    const result = await message(registration.active, { type: 'vm-download-abandon', batchId }, 10000);
    if (result?.ok) { recovered.push(...stale.filter((job) => job.batchId === batchId).map((job) => job.id)); deferBackground(); }
  }
  return recovered;
}

export async function cancelBackgroundDownloads() {
  const cancel = async () => {
    // Cancellation must work even while background downloading is deferred.
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration?.active) await message(registration.active, { type: 'vm-download-cancel-all' }, 10000);
    else await downloadJobs.clear().catch(() => {});
  };
  return navigator.locks?.request ? navigator.locks.request('velocity-download-enqueue', cancel) : cancel();
}
