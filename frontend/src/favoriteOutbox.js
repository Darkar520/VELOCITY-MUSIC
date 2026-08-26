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

/**
 * Identidades que podían haber sido usadas por la outbox antes de migrar a
 * `u:<sub>`. La clave canónica se añade por separado por pendingFavsKeys().
 */
export function legacyCacheIdentities(email = '', token = '') {
  const identities = [];
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized) identities.push(normalized);
  if (token) identities.push(`guest-${String(token).slice(-12)}`);
  return [...new Set(identities)];
}

export function pendingFavsKeys(identity = '', legacyIdentities = []) {
  const identities = [identity, ...(Array.isArray(legacyIdentities) ? legacyIdentities : [])];
  return [...new Set(identities.map((value) => pendingFavsKey(value)))];
}

function parsePendingFavs(raw) {
  const result = new Map();
  try {
    const saved = JSON.parse(raw || '[]');
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

/**
 * Lee la outbox canónica y las claves legacy, y migra las operaciones legacy
 * a la clave canónica de la cuenta. La clave canónica tiene prioridad si una
 * operación aparece en ambas, porque representa la escritura más reciente de
 * la versión migrada; las operaciones de pistas distintas se combinan.
 */
export function loadPendingFavs(storage = globalThis.localStorage, identity = '', legacyIdentities = []) {
  const result = new Map();
  const keys = pendingFavsKeys(identity, legacyIdentities);
  let hasLegacy = false;
  for (const [index, key] of keys.entries()) {
    let raw = null;
    try { raw = storage?.getItem(key); } catch { /* storage indisponible */ }
    if (!raw) continue;
    const parsed = parsePendingFavs(raw);
    if (index > 0 && parsed.size) hasLegacy = true;
    for (const [id, op] of parsed) {
      // Canonical first: don't let a legacy value override it on collision.
      if (!result.has(id)) result.set(id, op);
    }
  }

  if (hasLegacy && identity && result.size) {
    try {
      const canonicalKey = keys[0];
      storage?.setItem(canonicalKey, JSON.stringify([...result.entries()]));
      for (const key of keys.slice(1)) storage?.removeItem?.(key);
    } catch { /* conservar la legacy si la migración no puede escribirse */ }
  }
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

/**
 * Extrae el claim `sub` de un JWT sin dependencias ni red.
 *
 * La identidad canónica se deriva de él porque cumple las dos propiedades que
 * el fallback anterior (`guest-<últimos 12 del token>`) no cumplía:
 *   - Es la MISMA online y offline: el token vive en localStorage y decodificarlo
 *     no requiere red, mientras que el email puede no estar disponible al abrir
 *     la app sin conexión (api.me() falla), produciendo una clave distinta de
 *     la que escribió la sesión online.
 *   - Es estable ante rotación del token: el `sub` identifica a la cuenta; los
 *     últimos bytes del propio token cambian con cada emisión y dejaban la
 *     caché anterior inalcanzable.
 */
function jwtSub(token = '') {
  try {
    const part = String(token || '').split('.')[1] || '';
    if (!part) return '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    } else if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
      return '';
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const sub = payload?.sub;
    return sub == null ? '' : String(sub);
  } catch { return ''; }
}

export function cacheIdentity(email, token = '') {
  // 1) Canónica: sub del JWT. Preferida incluso con email conocido: así la
  //    resolución es simétrica (mismo resultado con o sin red) y sobrevive a
  //    cambios/rotaciones de token y de email.
  const sub = jwtSub(token);
  if (sub) return `u:${sub}`;
  // 2) Legacy: email normalizado (cachés antiguas, entornos de prueba sin JWT).
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized) return normalized;
  // 3) Legacy: invitados con token no-JWT (comportamiento previo intacto).
  return token ? `guest-${String(token).slice(-12)}` : 'guest';
}
