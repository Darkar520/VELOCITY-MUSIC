const KEY = 'velocity.feedMixCycles';
export const FEED_MIX_CYCLE_MS = 3 * 24 * 60 * 60 * 1000;

/** Keep a user's mix variant stable for three days, including across reloads. */
export function readFeedMixCycle(profile, now = Date.now(), storage = globalThis.localStorage) {
  let cycles = {};
  try { cycles = JSON.parse(storage?.getItem(KEY) || '{}'); } catch { cycles = {}; }
  if (!cycles || typeof cycles !== 'object' || Array.isArray(cycles)) cycles = {};
  let entry = cycles[profile];
  if (!entry || !Number.isFinite(entry.startedAt) || now < entry.startedAt) {
    entry = { startedAt: now };
  }
  const cycle = Math.floor((now - entry.startedAt) / FEED_MIX_CYCLE_MS);
  cycles[profile] = entry;
  const entries = Object.entries(cycles).filter(([, value])=>Number.isFinite(value?.startedAt)).sort((a, b) => b[1].startedAt - a[1].startedAt).slice(0, 24);
  try { storage?.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* Rotation still works in memory for this visit. */ }
  return { cycle, nextAt: entry.startedAt + (cycle + 1) * FEED_MIX_CYCLE_MS };
}
