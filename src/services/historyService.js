/**
 * History_Service — registro y listado del historial de escucha.
 * Requisitos: 9.1–9.6
 */
export const MAX_HISTORY_ENTRIES = 100;

export class HistoryError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HistoryError';
    this.status = status;
  }
}

export function createHistoryService({ historyRepo, trackRepo }) {
  return {
    async record(userId, trackId, at = Date.now(), userAgent = '') {
      if (trackId === undefined || trackId === null || trackId === '') {
        throw new HistoryError(400, 'Identidad de pista inválida.');
      }
      if (trackRepo && !(await trackRepo.exists(trackId))) {
        throw new HistoryError(400, 'Identidad de pista inválida.');
      }
      await historyRepo.record(userId, trackId, at, userAgent);
      return { trackId, userId, playedAt: at };
    },

    async list(userId) {
      return historyRepo.list(userId, MAX_HISTORY_ENTRIES);
    },
  };
}
