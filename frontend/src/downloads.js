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

function message(worker, data, timeout = 2500) {
  return new Promise((resolve) => {
    if (!worker || typeof MessageChannel === 'undefined') return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, timeout);
    channel.port1.onmessage = (event) => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage(data, [channel.port2]);
  });
}

export async function backgroundRegistration() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (!registration?.backgroundFetch || !registration.active) return null;
    const capabilities = await message(registration.active, { type: 'vm-download-capabilities' });
    return capabilities?.version === 1 && capabilities.background ? registration : null;
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
    await downloadJobs.putMany(jobs.map((job) => ({ ...job, status: 'background', batchId, attempts: (job.attempts || 0) + 1 })));
    try {
      // Chrome 149+ blocks new fetch registrations from a service worker.
      // Hand off EVERY request from the page; the browser bounds concurrency
      // and continues the whole playlist without requiring a live JS queue.
      await registration.backgroundFetch.fetch(batchId, jobs.map((job) => job.url), {
        title: `Velocity · ${jobs.length} canciones`,
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      });
    } catch {
      await downloadJobs.putMany(jobs.map((job) => ({ ...job, status: 'failed', error: 'background_unavailable' })));
      return false;
    }
    return true;
  };
  return navigator.locks?.request ? navigator.locks.request('velocity-download-enqueue', enqueue) : enqueue();
}

export async function cancelBackgroundDownloads() {
  const cancel = async () => {
    const registration = await backgroundRegistration();
    if (registration) await message(registration.active, { type: 'vm-download-cancel-all' }, 10000);
    else await downloadJobs.clear().catch(() => {});
  };
  return navigator.locks?.request ? navigator.locks.request('velocity-download-enqueue', cancel) : cancel();
}
