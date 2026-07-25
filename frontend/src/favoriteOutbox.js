export const PENDING_FAVS_KEY = 'velocity.pendingFavs';

// Intenciones confirmadas localmente que aún pueden cruzarse con una
// respuesta remota iniciada antes del toggle. Se segrega por cuenta y se
// conserva solo durante la sesión; la outbox sigue siendo la garantía durable.
let intentClock = 0;
const favoriteIntents = new Map();

function intentScope(identity = '') {
  const key = String(identity || '');
  let scope = favoriteIntents.get(key);
  if (!scope) {
    scope = new Map();
    favoriteIntents.set(key, scope);
  }
  return scope;
}

export function noteFavoriteIntent(identity, id, op) {
  if (!id || (op !== 'add' && op !== 'remove')) return 0;
  const seq = ++intentClock;
  intentScope(identity).set(String(id), { op, seq, acknowledged: false });
  return seq;
}

export function acknowledgeFavoriteIntent(identity, id, op) {
  const entry = intentScope(identity).get(String(id));
  if (entry && entry.op === op) entry.acknowledged = true;
}

export function favoriteIntentVersion(identity = '') {
  let version = 0;
  for (const entry of intentScope(identity).values()) version = Math.max(version, entry.seq);
  return version;
}

export function loadFavoriteIntents(identity = '', afterVersion = 0) {
  const result = new Map();
  for (const [id, entry] of intentScope(identity)) {
    if (entry.seq > afterVersion) result.set(id, entry.op);
  }
  return result;
}

export function pruneAcknowledgedFavoriteIntents(identity = '', throughVersion = 0) {
  const scope = intentScope(identity);
  for (const [id, entry] of scope) {
    if (entry.acknowledged && entry.seq <= throughVersion) scope.delete(id);
  }
}

export function pendingFavsKey(identity = '') {
  return identity ? `${PENDING_FAVS_KEY}.${encodeURIComponent(String(identity))}` : PENDING_FAVS_KEY;
}

export function loadPendingFavs(storage = globalThis.localStorage, identity = '') {
  const result = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(pendingFavsKey(identity)) || '[]');
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (Array.isArray(entry) && entry[0] && (entry[1] === 'add' || entry[1] === 'remove')) {
          result.set(String(entry[0]), entry[1]);
        }
      }
    }
  } catch {}
  return result;
}

export function savePendingFavs(pending, storage = globalThis.localStorage, identity = '') {
  try {
    storage?.setItem(pendingFavsKey(identity), JSON.stringify([...pending.entries()]));
  } catch {}
}

export function mergeFavoriteIds(remoteIds, pending) {
  const result = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  (Array.isArray(remoteIds) ? remoteIds : []).forEach(add);
  for (const [id, op] of pending instanceof Map ? pending : []) {
    if (op === 'add') add(id);
    else if (op === 'remove') {
      seen.delete(id);
      const index = result.indexOf(id);
      if (index !== -1) result.splice(index, 1);
    }
  }
  return result;
}

export function cacheIdentity(email, token = '') {
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized) return normalized;
  return token ? `guest-${String(token).slice(-12)}` : 'guest';
}
