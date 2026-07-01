/**
 * Favorites_Service — favoritos idempotentes con propiedad y existencia.
 * Requisitos: 8.1–8.7
 */
export class FavoritesError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FavoritesError';
    this.status = status;
  }
}

export function createFavoritesService({ favoritesRepo, trackRepo }) {
  return {
    async add(userId, trackId, at = Date.now()) {
      if (trackRepo && !(await trackRepo.exists(trackId))) {
        throw new FavoritesError(404, 'La pista no se encontró.');
      }
      if (!(await favoritesRepo.has(userId, trackId))) {
        await favoritesRepo.add(userId, trackId, at); // idempotente
      }
      return { trackId, favorited: true };
    },

    async remove(userId, trackId) {
      if (trackRepo && !(await trackRepo.exists(trackId))) {
        throw new FavoritesError(404, 'La pista no se encontró.');
      }
      if (await favoritesRepo.has(userId, trackId)) {
        await favoritesRepo.remove(userId, trackId); // idempotente
      }
      return { trackId, favorited: false };
    },

    async list(userId) {
      return favoritesRepo.list(userId); // de más reciente a menos reciente
    },
  };
}
