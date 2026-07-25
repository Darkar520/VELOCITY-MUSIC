import { describe, expect, it } from 'vitest';
import {
  acknowledgeFavoriteIntent,
  cacheIdentity,
  favoriteIntentVersion,
  loadFavoriteIntents,
  loadPendingFavs,
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
