import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ records: new Map() }));
vi.mock('../api.js', () => ({ api: { lyrics: vi.fn(), translateLyrics: vi.fn() } }));
vi.mock('../catalog.js', () => ({ trackById: id => ({ id, title: 'Original title', artist: 'Test artist' }) }));
vi.mock('../offline.js', () => ({
  getLyrics: vi.fn(async id => state.records.get(id)),
  saveLyrics: vi.fn(async (id, value) => { state.records.set(id, { ...state.records.get(id), ...value }); return true; }),
}));
import { api } from '../api.js';
import { scheduleLibraryOfflineSync, ensureLyricsOffline } from '../offlineLibrary.js';
beforeEach(() => { localStorage.clear(); state.records.clear(); vi.resetAllMocks(); });

it('a failed lyric request is not marked complete merely because its result is an object', async () => {
  api.lyrics.mockResolvedValue(null);
  expect(await scheduleLibraryOfflineSync(['failed'], { scope: 'negative-control' })).toEqual([]);
  const saved = JSON.parse(localStorage.getItem('velocity.lyricsBackfill.v4.negative-control'));
  expect(saved.completed).toEqual([]);
  expect(saved.failed.failed.attempts).toBe(1);
});

it('existing synchronized lyrics gain an aligned offline translation without refetching lyrics', async () => {
  state.records.set('saved', { synced: '[00:01.00]A first original sentence\n[00:02.00]A second original sentence' });
  api.translateLyrics.mockResolvedValue({ status: 'ready', engineVersion:'argos-context-v2', sourceLanguage: 'en', targetLanguage: 'es', lines: ['Primera frase', 'Segunda frase'] });
  expect(await scheduleLibraryOfflineSync(['saved'], { scope: 'migration' })).toEqual(['saved']);
  expect(api.lyrics).not.toHaveBeenCalled();
  expect(state.records.get('saved').translation.lines).toEqual(['Primera frase', 'Segunda frase']);
});

it('an unavailable translator preserves lyrics and leaves migration pending', async () => {
  const plain = 'A first original sentence\nA second original sentence';
  state.records.set('plain', { plain });
  api.lyrics.mockRejectedValue(new Error('offline'));
  api.translateLyrics.mockRejectedValue(new Error('unavailable'));
  const result = await ensureLyricsOffline({ id: 'plain' });
  expect(result.status).toBe('plain');
  expect(result.translationPending).toBe(true);
  expect(state.records.get('plain').plain).toBe(plain);
});

it('an unavailable context upgrade preserves an older aligned offline translation', async () => {
  const plain = 'A first original sentence\nA second original sentence';
  const old = { status:'ready', sourceText:JSON.stringify(plain.split('\n')), lines:['Old one','Old two'] };
  state.records.set('cached', { plain, translation:old });
  api.lyrics.mockRejectedValue(new Error('offline'));
  api.translateLyrics.mockRejectedValue(new Error('unavailable'));
  const result = await ensureLyricsOffline({ id:'cached' });
  expect(result.translationPending).toBe(true);
  expect(state.records.get('cached').translation).toEqual(old);
});
