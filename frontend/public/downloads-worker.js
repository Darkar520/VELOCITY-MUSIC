// The PAGE registers the entire playlist with Background Fetch. Chrome 149+
// forbids starting new registrations in workers. This worker only commits the
// browser's completed responses, one file at a time, without fetching audio.
(function (root) {
  const PREFIX = 'velocity-download-';
  function createWorker({ store, manager, notify = async () => {}, origin }) {
    const writes = new Set();
    const owned = (id) => id.startsWith(PREFIX);
    async function finish(event) {
      const registration = event.registration;
      if (!owned(registration.id)) return;
      const jobs = (await store.list()).filter((job) => job.batchId === registration.id);
      let records = [];
      try { records = await registration.matchAll(); } catch { /* missing records remain pending */ }
      const byUrl = new Map(records.map((record) => [new URL(record.request.url, origin).href, record]));
      let saved = 0;
      let quotaHit = registration.failureReason === 'quota-exceeded';
      for (const job of jobs) {
        let response;
        try {
          if (quotaHit) throw Object.assign(new Error('storage full'), { name: 'QuotaExceededError' });
          response = await byUrl.get(new URL(job.url, origin).href)?.responseReady;
          if (!response?.ok || response.status !== 200) throw new Error('bad_status');
          const blob = await response.blob();
          const expected = Number(response.headers.get('content-length'));
          if (!blob.size || (expected > 0 && blob.size !== expected)) throw new Error('incomplete_audio');
          if (!/^(audio\/|video\/webm)/i.test(blob.type)) throw new Error('invalid_audio');
          const previous = await store.getSavedMeta?.(job.id);
          const meta = root.VelocityOfflineArtwork ? await root.VelocityOfflineArtwork.prepare(job.meta, previous) : job.meta;
          const current = await store.get(job.id);
          if (current?.batchId !== registration.id || current.status !== 'background') continue;
          const writing = store.saveAudio(meta, blob);
          writes.add(writing);
          try { await writing; } finally { writes.delete(writing); }
          await store.remove(job.id);
          saved++;
        } catch (error) {
          if (/quota/i.test(error.name)) quotaHit = true;
          const current = await store.get(job.id);
          if (!current || current.batchId !== registration.id) continue;
          await store.put({ ...current, batchId: null,
            status: quotaHit ? 'paused' : 'failed',
            error: quotaHit ? 'storage_full' : response && !response.ok ? `http_${response.status}` : error.message,
          });
        }
      }
      if (quotaHit) {
        await store.putMany((await store.list()).filter((job) => job.batchId === registration.id || jobs.some((item) => item.id === job.id))
          .map((job) => ({ ...job, status: 'paused', error: 'storage_full' })));
      }
      await notify({ saved, failed: jobs.length - saved, quotaHit });
      try { await event.updateUI?.({ title: `Velocity · ${saved}/${jobs.length} descargadas${quotaHit ? ' · almacenamiento lleno' : ''}` }); } catch {}
    }
    async function abort(event) {
      if (!owned(event.registration.id)) return;
      // Honour a cancellation in the browser's native download UI.
      await store.putMany((await store.list()).filter((job) => job.batchId === event.registration.id)
        .map((job) => ({ ...job, status: 'paused', error: 'cancelled' })));
      await notify();
    }
    async function cancelAll() {
      await store.clear();
      if (manager) {
        for (const id of (await manager.getIds()).filter(owned)) await (await manager.get(id))?.abort();
      }
      await Promise.allSettled([...writes]);
      await notify();
    }
    async function abandon(batchId) {
      if (!owned(batchId)) return;
      // Detach jobs BEFORE aborting: the native abort event must not turn an
      // automatic fallback into a user-requested pause.
      await store.putMany((await store.list()).filter((job) => job.batchId === batchId)
        .map((job) => ({ ...job, batchId: null, status: 'failed', error: 'no_progress' })));
      await (await manager?.get(batchId))?.abort();
      await notify();
    }
    return { finish, abort, cancelAll, abandon };
  }
  root.VelocityDownloadWorker = { createWorker };
  if (!root.registration || !root.VelocityDownloadDB) return;
  const worker = createWorker({
    store: root.VelocityDownloadDB.createStore(), manager: root.registration.backgroundFetch,
    origin: root.location.origin,
    notify: async (summary) => (await root.clients.matchAll({ type: 'window' })).forEach((client) => client.postMessage({ type: 'vm-downloads-changed', summary })),
  });
  root.addEventListener('message', (event) => {
    if (event.data?.type === 'vm-download-capabilities') {
      event.ports[0]?.postMessage({ version: 2, background: !!root.registration.backgroundFetch });
    } else if (event.data?.type === 'vm-download-abandon') {
      event.waitUntil(worker.abandon(String(event.data.batchId || '')).then(() => event.ports[0]?.postMessage({ ok: true }))
        .catch(() => event.ports[0]?.postMessage({ ok: false })));
    } else if (event.data?.type === 'vm-download-cancel-all') {
      event.waitUntil(worker.cancelAll().then(() => event.ports[0]?.postMessage({ ok: true }))
        .catch(() => event.ports[0]?.postMessage({ ok: false })));
    }
  });
  root.addEventListener('backgroundfetchsuccess', (event) => event.waitUntil(worker.finish(event)));
  root.addEventListener('backgroundfetchfailure', (event) => event.waitUntil(worker.finish(event)));
  root.addEventListener('backgroundfetchabort', (event) => event.waitUntil(worker.abort(event)));
  root.addEventListener('backgroundfetchclick', (event) => event.waitUntil(root.clients.openWindow('/')));
})(globalThis);
