import { randomUUID } from 'node:crypto';

/**
 * Repositorios en memoria. Sirven para pruebas (PBT) y como respaldo de
 * desarrollo cuando no hay PostgreSQL disponible. Implementan la misma interfaz
 * asíncrona que los repositorios PostgreSQL para que los servicios sean
 * agnósticos del almacén.
 */

export function createMemoryUserRepo() {
  const byId = new Map();
  const byEmail = new Map();
  return {
    async findByEmail(email) {
      return byEmail.get(email) ?? null;
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async insert({ email, passwordHash }) {
      const user = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
      byId.set(user.id, user);
      byEmail.set(email, user);
      return user;
    },
  };
}

export function createMemoryTrackRepo(initialIds = []) {
  const tracks = new Set(initialIds);
  return {
    async exists(trackId) {
      return tracks.has(trackId);
    },
    add(trackId) {
      tracks.add(trackId);
    },
  };
}

export function createMemoryPlaylistRepo() {
  const playlists = new Map(); // id -> { id, userId, name, tracks: [trackId...] }
  let seq = 0;
  return {
    async create(userId, name) {
      const id = `pl_${++seq}`;
      playlists.set(id, { id, userId, name, tracks: [] });
      return { id, userId, name };
    },
    async get(playlistId) {
      return playlists.get(playlistId) ?? null;
    },
    async listByUser(userId) {
      return [...playlists.values()]
        .filter((p) => p.userId === userId)
        .map((p) => ({ id: p.id, userId: p.userId, name: p.name }));
    },
    async addTrack(playlistId, trackId) {
      playlists.get(playlistId).tracks.push(trackId);
    },
    async trackCount(playlistId) {
      return playlists.get(playlistId).tracks.length;
    },
    async getTracks(playlistId) {
      return [...playlists.get(playlistId).tracks];
    },
    async removeTrackOccurrence(playlistId, trackId) {
      const list = playlists.get(playlistId).tracks;
      const idx = list.indexOf(trackId);
      if (idx !== -1) list.splice(idx, 1);
    },
    async delete(playlistId) {
      playlists.delete(playlistId);
    },
  };
}

export function createMemoryFavoritesRepo() {
  const byUser = new Map(); // userId -> Map(trackId -> favoritedAt)
  const ensure = (u) => {
    if (!byUser.has(u)) byUser.set(u, new Map());
    return byUser.get(u);
  };
  return {
    async has(userId, trackId) {
      return ensure(userId).has(trackId);
    },
    async add(userId, trackId, at = Date.now()) {
      ensure(userId).set(trackId, at);
    },
    async remove(userId, trackId) {
      ensure(userId).delete(trackId);
    },
    async list(userId) {
      return [...ensure(userId).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([trackId]) => trackId);
    },
  };
}

export function createMemoryHistoryRepo() {
  const entries = []; // { userId, trackId, playedAt }
  return {
    async record(userId, trackId, playedAt = Date.now()) {
      entries.push({ userId, trackId, playedAt });
    },
    async list(userId, limit = 100) {
      return entries
        .filter((e) => e.userId === userId)
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, limit)
        .map((e) => ({ trackId: e.trackId, userId: e.userId, playedAt: e.playedAt }));
    },
  };
}
