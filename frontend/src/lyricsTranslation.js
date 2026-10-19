import { parseLRC } from './helpers.js';

export function lyricLines(record) {
  const synced = parseLRC(record?.synced);
  return synced.length ? synced.map(line => line.text) : String(record?.plain || '').split(/\r?\n/).filter((line, i, all) => line || (i > 0 && i < all.length - 1));
}

export function matchingTranslation(record) {
  const translation = record?.translation;
  const lines = lyricLines(record);
  return translation?.sourceText === JSON.stringify(lines) && translation?.lines?.length === lines.length ? translation : null;
}

export async function translateRecord(record, api, signal) {
  const cached = matchingTranslation(record);
  if (cached) return cached;
  const lines = lyricLines(record);
  const result = await api.translateLyrics(lines, signal);
  if (result?.status !== 'ready' && result?.status !== 'unsupported') throw new Error('translation_unavailable');
  if (result.status === 'ready' && (result.lines?.length !== lines.length || result.lines.some(line => typeof line !== 'string'))) throw new Error('translation_alignment');
  return { ...result, sourceText: JSON.stringify(lines), lines: result.status === 'unsupported' ? lines.map(() => '') : result.lines };
}
