import { describe, expect, it } from 'vitest';
import {
  acknowledgeFavoriteIntent,
  cacheIdentity,
  favoriteIntentVersion,
  loadFavoriteIntents,
  loadPendingFavs,
  legacyCacheIdentities,
  mergeFavoriteIds,
  noteFavoriteIntent,
  pendingFavsKey,
  pruneAcknowledgedFavoriteIntents,
  savePendingFavs,
} from '../favoriteOutbox.js';

describe('favorite outbox helpers', () => {
  it('round-trips only valid pending operations', () => {
    const values = new Map([['new', 'add'], ['old', 'remove']]);
    const data = new Map();
    const storage = {
      getItem: () => data.get('velocity.pendingFavs') || null,
      setItem: (key, value) => data.set(key, value),
    };
    savePendingFavs(values, storage);
    expect(loadPendingFavs(storage)).toEqual(values);
  });

  it('isolates pending operations by account identity', () => {
    const data = new Map();
    const storage = {
      getItem: (key) => data.get(key) || null,
      setItem: (key, value) => data.set(key, value),
    };
    const accountA = new Map([['a', 'add']]);
    const accountB = new Map([['b', 'remove']]);
    savePendingFavs(accountA, storage, 'a@example.com');
    savePendingFavs(accountB, storage, 'b@example.com');

    expect(loadPendingFavs(storage, 'a@example.com')).toEqual(accountA);
    expect(loadPendingFavs(storage, 'b@example.com')).toEqual(accountB);
    expect(storage.getItem(pendingFavsKey())).toBeNull();
  });

  it('migra y combina operaciones legacy bajo la identidad JWT canónica', () => {
    const data = new Map();
    const storage = {
      getItem: (key) => data.get(key) || null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    };
    const legacyScopes = legacyCacheIdentities('User@Example.COM', 'legacy-token-123456789');
    const canonical = 'u:account-42';

    savePendingFavs(new Map([
      ['shared', 'add'],
      ['email-only', 'remove'],
    ]), storage, legacyScopes[0]);
    savePendingFavs(new Map([['guest-only', 'add']]), storage, legacyScopes[1]);
    savePendingFavs(new Map([['shared', 'remove'], ['canonical-only', 'add']]), storage, canonical);

    expect(loadPendingFavs(storage, canonical, legacyScopes)).toEqual(new Map([
      ['shared', 'remove'],
      ['canonical-only', 'add'],
      ['email-only', 'remove'],
      ['guest-only', 'add'],
    ]));
    expect(data.has(pendingFavsKey(canonical))).toBe(true);
    expect(data.has(pendingFavsKey(legacyScopes[0]))).toBe(false);
    expect(data.has(pendingFavsKey(legacyScopes[1]))).toBe(false);
  });

  it('preserves pending add and applies pending remove over backend response', () => {
    const pending = new Map([['new', 'add'], ['old', 'remove']]);
    expect(mergeFavoriteIds(['old', 'server'], pending)).toEqual(['server', 'new']);
  });

  it('does not erase a pending add when the backend response is empty', () => {
    expect(mergeFavoriteIds([], new Map([['new', 'add']]))).toEqual(['new']);
  });

  it('deduplicates ids while retaining backend order', () => {
    expect(mergeFavoriteIds(['a', 'a', 'b'], new Map())).toEqual(['a', 'b']);
  });

  it('retains the latest acknowledged intent until a later sync boundary', () => {
    const scope = 'intent-test@example.com';
    const before = favoriteIntentVersion(scope);
    noteFavoriteIntent(scope, 'track', 'add');
    noteFavoriteIntent(scope, 'track', 'remove');
    expect(loadFavoriteIntents(scope, before)).toEqual(new Map([['track', 'remove']]));

    acknowledgeFavoriteIntent(scope, 'track', 'remove');
    pruneAcknowledgedFavoriteIntents(scope, before);
    expect(loadFavoriteIntents(scope, before)).toEqual(new Map([['track', 'remove']]));
    const boundary = favoriteIntentVersion(scope);
    pruneAcknowledgedFavoriteIntents(scope, boundary);
    expect(loadFavoriteIntents(scope, 0)).toEqual(new Map());
  });

  it('uses separate account identities and a non-account guest scope', () => {
    expect(cacheIdentity('User@Example.COM')).toBe('user@example.com');
    expect(cacheIdentity('', 'token-123456789')).toBe('guest-en-123456789');
    expect(cacheIdentity('')).toBe('guest');
  });
});

describe('cacheIdentity: identidad canónica por sub del JWT', () => {
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwtWithSub = (sub, sig) => [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub }), sig || 'sig'].join('.');

  it('deriva la identidad del sub aunque el email no esté disponible (offline)', () => {
    // Regresión: sin email, la identidad caía a guest-<últimos 12 del token>,
    // una clave DISTINTA de la que escribió la sesión online (que sí tenía
    // email). Offline la caché resultaba inalcanzable y la biblioteca vacía.
    expect(cacheIdentity('', jwtWithSub('acc-1'))).toBe('u:acc-1');
    expect(cacheIdentity('user@example.com', jwtWithSub('acc-1'))).toBe('u:acc-1');
  });

  it('sobrevive a la rotación del token (mismo sub, firma distinta)', () => {
    // Regresión: el fallback guest-<últimos 12 del token> cambiaba con cada
    // emisión, dejando la caché anterior inalcanzable.
    const before = cacheIdentity('', jwtWithSub('acc-1', 'firma-vieja'));
    const after = cacheIdentity('', jwtWithSub('acc-1', 'firma-nueva'));
    expect(before).toBe(after);
    expect(before).toBe('u:acc-1');
  });

  it('distingue cuentas distintas y tolera tokens malformados', () => {
    expect(cacheIdentity('', jwtWithSub('acc-1'))).not.toBe(cacheIdentity('', jwtWithSub('acc-2')));
    expect(cacheIdentity('', 'no-es-un-jwt')).toBe('guest-no-es-un-jwt');
    expect(cacheIdentity('', 'a.b.cuerpo-invalido')).toBe('guest-rpo-invalido');
    expect(cacheIdentity('', '')).toBe('guest');
  });
});
