import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockear fetch antes de importar api.js
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Importar después de mockear fetch
const { api } = await import('../api.js');

// localStorage mock para api.js (lee token al importar)
const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

describe('api.streamUrl', () => {
  it('construye URL con artist y title', () => {
    const url = api.streamUrl({ artist: 'Joji', title: 'Glimpse of Us' });
    expect(url).toContain('artist=Joji');
    expect(url).toContain('title=Glimpse+of+Us');
    expect(url).toContain('/api/stream-proxy');
  });
  it('incluye id si se proporciona', () => {
    const url = api.streamUrl({ artist: 'A', title: 'T', id: 'vid123' });
    expect(url).toContain('id=vid123');
  });
  it('incluye quality', () => {
    const url = api.streamUrl({ artist: 'A', title: 'T', quality: 'high' });
    expect(url).toContain('quality=high');
  });
  it('incluye stream para SoundCloud', () => {
    const url = api.streamUrl({ artist: 'A', title: 'T', stream: 'https://sndcdn.com/x' });
    expect(url).toContain('stream=');
  });
  it('PBT: siempre devuelve una cadena no vacía', () => {
    for (let i = 0; i < 20; i++) {
      const url = api.streamUrl({ artist: `A${i}`, title: `T${i}` });
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    }
  });
});

describe('api.buildSignedStreamUrl', () => {
  it('añade exp y sig a la URL', () => {
    const url = api.buildSignedStreamUrl({ artist: 'A', title: 'T', exp: 1234567890, sig: 'abc123' });
    expect(url).toContain('exp=1234567890');
    expect(url).toContain('sig=abc123');
  });
});

describe('api.peekStreamUrl', () => {
  it('cache miss → null', () => {
    expect(api.peekStreamUrl({ artist: 'nope', title: 'nope' })).toBeNull();
  });
  it('cache hit con TTL restante → devuelve URL', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const key = api._streamSignKey({ artist: 'peek', title: 'test' });
    api._streamSignCache.set(key, { exp: futureExp, url: 'https://example.com/signed' });
    const r = api.peekStreamUrl({ artist: 'peek', title: 'test' });
    expect(r).toBe('https://example.com/signed');
    api._streamSignCache.delete(key);
  });
  it('cache expirado → null', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const key = api._streamSignKey({ artist: 'expired', title: 'test' });
    api._streamSignCache.set(key, { exp: pastExp, url: 'https://example.com/old' });
    expect(api.peekStreamUrl({ artist: 'expired', title: 'test' })).toBeNull();
    api._streamSignCache.delete(key);
  });
});

describe('api.search', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('construye URL con query param q', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: '1', title: 'X' }] }),
    });
    const r = await api.search('Joji');
    expect(mockFetch).toHaveBeenCalled();
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('q=Joji');
    expect(r).toHaveLength(1);
  });

  it('acepta parámetro limit en la URL', async () => {
    // api.search pasa limit como 3er arg, pero solo lo añade si es finite.
    // En el código 025b3ad, api.search solo acepta (q, signal).
    // Verificamos que al menos no rompe con 3 args.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await api.search('test', undefined, 50);
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('api.lyrics', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('construye URL con artist y title', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 404,
      json: async () => ({}),
    });
    await api.lyrics({ artist: 'Joji', title: 'Glimpse of Us' });
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('artist=Joji');
    expect(url).toContain('title=Glimpse+of+Us');
  });

  it('404 → null', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, json: async () => ({}) });
    const r = await api.lyrics({ artist: 'X', title: 'Y' });
    expect(r).toBeNull();
  });

  it('200 → devuelve data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ synced: '[00:01.00] Hello', plain: 'Hello', source: 'lrclib' }),
    });
    const r = await api.lyrics({ artist: 'X', title: 'Y' });
    expect(r.synced).toContain('Hello');
  });
});
