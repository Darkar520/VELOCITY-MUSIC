// Shared by the page and service worker; images live with downloaded metadata,
// independently of the disposable HTTP cache. No audio is read or converted.
(function (root) {
  const MAX_BYTES = 1024 * 1024;
  const pending = new Map();
  let active = 0;
  const waiting = [];
  const run = async (fn) => {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await fn(); }
    finally { active--; waiting.shift()?.(); }
  };
  function source(cover, id) {
    if (typeof cover !== 'string' || !cover) return null;
    if (/^(data:image\/|blob:)/i.test(cover)) return cover;
    const base = root.location?.origin || 'https://velocity.invalid';
    try {
      const url = new URL(cover, base);
      // Preserve existing proxy parameters, notably the video id fallback.
      if (url.origin === base && url.pathname === '/img') return url.pathname + url.search;
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      if (url.origin === base) return url.pathname + url.search;
      const query = new URLSearchParams({ u: url.href });
      if (id) query.set('id', id);
      return '/img?' + query;
    } catch { return null; }
  }
  async function toDataUrl(cover, id) {
    const url = source(cover, id);
    if (!url) return null;
    if (/^data:image\//i.test(url)) return url.length <= MAX_BYTES * 1.4 ? url : null;
    if (pending.has(url)) return pending.get(url);
    const task = run(async () => {
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const response = await root.fetch(url, { signal: controller.signal });
            if (!response.ok || Number(response.headers?.get('content-length')) > MAX_BYTES) return null;
            const blob = await response.blob();
            if (!blob.size || blob.size > MAX_BYTES || !/^image\//i.test(blob.type)) return null;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            return `data:${blob.type};base64,${root.btoa(binary)}`;
          })(),
          new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 8000); }),
        ]);
      } catch { return null; }
      finally { clearTimeout(timer); controller.abort(); }
    });
    pending.set(url, task);
    try { return await task; } finally { pending.delete(url); }
  }
  async function prepare(meta, previous = null) {
    const merged = { ...previous, ...meta };
    for (const key of ['title', 'artist', 'album', 'artistId', 'albumId', 'genre', 'durationSeconds']) {
      if (!meta?.[key] && previous?.[key]) merged[key] = previous[key];
    }
    const cover = /^data:image\//i.test(previous?.cover || '') ? previous.cover
      : await toDataUrl(merged.cover || merged.artworkUrl, merged.id);
    return { ...merged, ...(cover ? { cover } : {}), artworkStatus: cover ? 'ready' : 'pending' };
  }
  // A stable same-origin URL lets the OS load artwork after page/blob lifetimes.
  // Only the lightweight metadata store is read; the route never needs a server.
  async function respond(id, store) {
    const meta = await store.getSavedMeta(id);
    if (!/^data:image\//i.test(meta?.cover || '')) return new Response(null, { status: 404 });
    try {
      const image = await root.fetch(meta.cover);
      if (!image.ok) return new Response(null, { status: 404 });
      return new Response(await image.blob(), { headers: { 'Content-Type': image.headers.get('content-type'), 'Cache-Control': 'no-store' } });
    } catch { return new Response(null, { status: 404 }); }
  }
  root.VelocityOfflineArtwork = { source, toDataUrl, prepare, respond };
})(globalThis);
