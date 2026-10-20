import { parseLRC } from './helpers.js';
export const TRANSLATION_ENGINE_VERSION = 'argos-context-v6';

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
  if (cached && (cached.engineVersion === TRANSLATION_ENGINE_VERSION || globalThis.navigator?.onLine === false)) return cached;
  const lines = lyricLines(record);
  let result;
  try { result = await api.translateLyrics(lines, signal); }
  catch (error) {
    if (signal?.aborted) throw error;
    if (cached) return { ...cached, upgradePending:true };
    throw error;
  }
  if (result?.status !== 'ready' && result?.status !== 'unsupported') throw new Error('translation_unavailable');
  if (result.status === 'ready' && (result.lines?.length !== lines.length || result.lines.some(line => typeof line !== 'string'))) throw new Error('translation_alignment');
  return { ...result, sourceText: JSON.stringify(lines), lines: result.status === 'unsupported' ? lines.map(() => '') : result.lines };
}
