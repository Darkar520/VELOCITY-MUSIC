/**
 * Playlist_Service — gestión de listas con propiedad y capacidad.
 * Todas las operaciones son del usuario solicitante. Requisitos: 7.1–7.9
 */
export const MAX_PLAYLIST_TRACKS = 10000;
export const MAX_NAME_LENGTH = 100;

export class PlaylistError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PlaylistError';
    this.status = status;
  }
}

export function createPlaylistService({ playlistRepo, trackRepo }) {
  /** Resuelve la lista verificando existencia (404) y propiedad (403). */
  async function getOwned(userId, playlistId) {
    const pl = await playlistRepo.get(playlistId);
    if (!pl) throw new PlaylistError(404, 'La lista no se encontró.');
    if (pl.userId !== userId) throw new PlaylistError(403, 'Acceso a la lista no autorizado.');
    return pl;
  }

  return {
    async create(userId, name) {
      const trimmed = String(name ?? '').trim();
      if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
        throw new PlaylistError(400, 'El nombre de la lista es inválido.');
      }
      const pl = await playlistRepo.create(userId, trimmed);
      return pl.id;
    },

    async addTrack(userId, playlistId, trackId) {
      await getOwned(userId, playlistId);
      if (trackRepo && !(await trackRepo.exists(trackId))) {
        throw new PlaylistError(404, 'La pista no se encontró.');
      }
      const count = await playlistRepo.trackCount(playlistId);
      if (count >= MAX_PLAYLIST_TRACKS) {
        throw new PlaylistError(409, 'Se alcanzó el límite de pistas de la lista.');
      }
      await playlistRepo.addTrack(playlistId, trackId); // añade al final (permite duplicados)
    },

    async removeTrack(userId, playlistId, trackId) {
      await getOwned(userId, playlistId);
      await playlistRepo.removeTrackOccurrence(playlistId, trackId); // conserva orden relativo
    },

    async list(userId) {
      return playlistRepo.listByUser(userId);
    },

    async getTracks(userId, playlistId) {
      await getOwned(userId, playlistId);
      return playlistRepo.getTracks(playlistId);
    },

    async delete(userId, playlistId) {
      await getOwned(userId, playlistId);
      await playlistRepo.delete(playlistId);
    },
  };
}
