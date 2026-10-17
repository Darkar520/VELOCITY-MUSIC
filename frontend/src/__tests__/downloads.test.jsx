import { MessageChannel } from 'node:worker_threads';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ signDownloadUrl: vi.fn(), ensureStreamUrl: vi.fn() }));
vi.mock('../api.js', () => ({ api: apiMock }));
import { enqueueBackground, downloadJobs, cancelBackgroundDownloads, waitForBackgroundStart, recoverStalledBackground } from '../downloads.js';

describe('browser handoff of complete download playlists', () => {
  let jobs, saved, registration;
  const track = (id) => ({ id, title: id, artist: 'Artist' });
  beforeEach(() => {
    jobs = new Map(); saved = [];
    vi.clearAllMocks();
    localStorage.removeItem('velocity.backgroundUnavailableUntil');
    vi.stubGlobal('MessageChannel', MessageChannel);
    registration = {
      active: { postMessage: (data, ports) => {
        if (data.type === 'vm-download-capabilities') ports[0].postMessage({ version: 2, background: true });
        else if (data.type === 'vm-download-cancel-all') { jobs.clear(); ports[0].postMessage({ ok: true }); }
        else if (data.type === 'vm-download-abandon') {
          for (const [id, job] of jobs) if (job.batchId === data.batchId) jobs.set(id, { ...job, batchId: null, status: 'failed', error: 'no_progress' });
          ports[0].postMessage({ ok: true });
        }
        else throw new Error('a worker must never be asked to start the next batch');
        ports[0].close();
      } },
      backgroundFetch: { getIds: vi.fn(async () => []), fetch: vi.fn(async () => ({})) },
    };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
    vi.spyOn(downloadJobs, 'list').mockImplementation(async () => [...jobs.values()]);
    vi.spyOn(downloadJobs, 'savedIds').mockImplementation(async () => saved);
    vi.spyOn(downloadJobs, 'put').mockImplementation(async (job) => { jobs.set(job.id, job); });
    vi.spyOn(downloadJobs, 'putMany').mockImplementation(async (values) => { values.forEach((job) => jobs.set(job.id, job)); });
    vi.spyOn(downloadJobs, 'clear').mockImplementation(async () => { jobs.clear(); });
    apiMock.signDownloadUrl.mockImplementation(async ({ id }) => `/api/stream-proxy?id=${id}&exp=9999999999&sig=x`);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('hands all 350 requests to the browser from the page, signing at most 4 at once', async () => {
    let active = 0, peak = 0;
    apiMock.signDownloadUrl.mockImplementation(async ({ id }) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      return `/api/stream-proxy?id=${id}&exp=9999999999&sig=x`;
    });
    expect(await enqueueBackground(Array.from({ length: 350 }, (_, i) => track(`song-${i}`)), 'high')).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
    expect(registration.backgroundFetch.fetch).toHaveBeenCalledTimes(1);
    expect(registration.backgroundFetch.fetch.mock.calls[0][1]).toHaveLength(350);
    expect([...jobs.values()].every((job) => job.status === 'background' && job.quality === 'high')).toBe(true);
    expect(apiMock.ensureStreamUrl).not.toHaveBeenCalled();
  });

  it('browser permission rejection leaves persistent metadata and allows a foreground fallback', async () => {
    registration.backgroundFetch.fetch.mockRejectedValue(new DOMException('not allowed', 'NotAllowedError'));
    expect(await enqueueBackground([track('a')], 'high')).toBe(false);
    expect(jobs.get('a').status).toBe('failed');
    expect(jobs.get('a').meta).toEqual(track('a'));
  });

  it('does not duplicate active browser jobs or songs already saved', async () => {
    saved = ['stored'];
    jobs.set('active', { id: 'active', meta: track('active'), quality: 'high', batchId: 'existing', status: 'background' });
    registration.backgroundFetch.getIds.mockResolvedValue(['existing']);
    expect(await enqueueBackground([track('stored'), track('active')], 'high')).toBe(true);
    expect(registration.backgroundFetch.fetch).not.toHaveBeenCalled();
    expect(apiMock.signDownloadUrl).not.toHaveBeenCalled();
  });

  it('recovers stale jobs after a browser restart and preserves their chosen quality', async () => {
    jobs.set('stale', { id: 'stale', meta: track('stale'), quality: 'high', batchId: 'gone', status: 'background' });
    expect(await enqueueBackground([track('stale')], 'low', { resume: true })).toBe(true);
    expect(apiMock.signDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ quality: 'high' }));
    expect(registration.backgroundFetch.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not treat a service worker without the download protocol as supported', async () => {
    registration.active.postMessage = (_data, ports) => { ports[0].postMessage({ version: 0, background: true }); ports[0].close(); };
    expect(await enqueueBackground([track('a')], 'high')).toBe(false);
    expect(registration.backgroundFetch.fetch).not.toHaveBeenCalled();
  });

  it('clearing cancels the browser queue before returning to the caller', async () => {
    await enqueueBackground([track('a')], 'high');
    await cancelBackgroundDownloads();
    expect(jobs.size).toBe(0);
  });

  it('distinguishes a real native transfer from an accepted registration with no progress', async () => {
    const transfer = new EventTarget();
    transfer.downloaded = 0; transfer.result = '';
    expect(await waitForBackgroundStart(transfer, 10)).toBe(false);
    const started = waitForBackgroundStart(transfer, 100);
    transfer.downloaded = 1024;
    transfer.dispatchEvent(new Event('progress'));
    expect(await started).toBe(true);
  });

  it('recovers a stalled browser transfer after reopening and selects foreground for the retry', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    jobs.set('stuck', { id: 'stuck', meta: track('stuck'), status: 'background', batchId: 'stuck-batch', startedAt: Date.now() - 61000 });
    registration.backgroundFetch.get = async () => ({ downloaded: 0, result: '' });
    expect(await recoverStalledBackground()).toEqual(['stuck']);
    expect(jobs.get('stuck').error).toBe('no_progress');
    expect(await enqueueBackground([track('stuck')], 'high')).toBe(false);
    expect(registration.backgroundFetch.fetch).not.toHaveBeenCalled();
  });
});
