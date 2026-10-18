// Shared by the page and the classic service worker. No tokens are stored here.
// Audio stays in velocity-offline v3, so existing downloads remain readable.
(function (root) {
  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const complete = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('storage aborted'));
  });
  function createStore(idb = root.indexedDB) {
    const open = async (name, version, stores) => {
      const req = idb.open(name, version);
      req.onupgradeneeded = () => {
        stores.forEach((store) => {
          if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store, { keyPath: 'id' });
        });
      };
      return request(req);
    };
    const queue = async (mode, action) => {
      const db = await open('velocity-downloads', 1, ['jobs']);
      try {
        const tx = db.transaction('jobs', mode);
        const done = complete(tx);
        let result;
        try { result = await action(tx.objectStore('jobs')); }
        catch (error) { await done.catch(() => {}); throw error; }
        await done;
        return result;
      } finally { db.close(); }
    };
    return {
      list: () => queue('readonly', (store) => request(store.getAll())),
      get: (id) => queue('readonly', (store) => request(store.get(id))),
      put: (job) => queue('readwrite', (store) => { store.put(job); }),
      putMany: (jobs) => queue('readwrite', (store) => { jobs.forEach((job) => store.put(job)); }),
      remove: (id) => queue('readwrite', (store) => { store.delete(id); }),
      clear: () => queue('readwrite', (store) => { store.clear(); }),
      async savedIds() {
        const db = await open('velocity-offline', 3, ['tracks', 'meta', 'lyrics']);
        try { return await request(db.transaction('tracks').objectStore('tracks').getAllKeys()); }
        finally { db.close(); }
      },
      async getSavedMeta(id) {
        const db = await open('velocity-offline', 3, ['tracks', 'meta', 'lyrics']);
        try { return (await request(db.transaction('meta').objectStore('meta').get(id)))?.meta || null; }
        finally { db.close(); }
      },
      async saveAudio(meta, blob) {
        if (!meta?.id || !blob?.size) throw new Error('empty audio');
        const db = await open('velocity-offline', 3, ['tracks', 'meta', 'lyrics']);
        try {
          const tx = db.transaction(['tracks', 'meta'], 'readwrite');
          const done = complete(tx);
          const record = { id: meta.id, meta, at: Date.now(), size: blob.size, type: blob.type || '' };
          tx.objectStore('tracks').put({ ...record, blob });
          tx.objectStore('meta').put(record);
          await done;
        } finally { db.close(); }
      },
    };
  }
  root.VelocityDownloadDB = { createStore };
})(globalThis);
