/**
 * Token_Revocation_Service — gestiona la revocación individual y global de JWTs.
 *
 * Dos mecanismos complementarios:
 *
 * 1. **Revocación individual por `jti`**: el usuario hace logout y ese token
 *    concreto ya no sirve, pero los demás siguen activos. El repositorio
 *    almacenado (PostgreSQL / JSON / memoria) decide la persistencia.
 *
 * 2. **Invalidación global por usuario** (`tokens_invalid_before`): establece
 *    un timestamp en el usuario; cualquier token con `iat < tokens_invalid_before`
 *    se rechaza. Útil para "logout all devices" o cambio de contraseña.
 *
 * El middleware `requireAuth` invoca `isRevoked(jti, userId, iat)` en cada
 * petición protegida. La implementación debe ser O(1) o tener índice.
 */
export class TokenRevocationService {
  /**
   * @param {object} revokedTokensRepo Repo con `revoke(jti, expiresAt)` e `isRevoked(jti)`.
   * @param {object} userRepo Repo con `getTokensInvalidBefore(userId)` y `setTokensInvalidBefore(userId, ts)`.
   */
  constructor({ revokedTokensRepo, userRepo }) {
    this.revokedTokensRepo = revokedTokensRepo;
    this.userRepo = userRepo;
  }

  /**
   * Revoca un token individual por su `jti`.
   * @param {string} jti
   * @param {number} exp Tiempo de expiración del token (segundos Unix).
   *                     La entrada se purga automáticamente tras ese timestamp.
   */
  async revokeToken(jti, exp) {
    if (!jti || !this.revokedTokensRepo) return false;
    const expiresAt = Number(exp) || Math.floor(Date.now() / 1000) + 86400;
    await this.revokedTokensRepo.revoke(jti, expiresAt);
    return true;
  }

  /**
   * Invalida TODOS los tokens emitidos antes de ahora para un usuario.
   * Establece `tokens_invalid_before = now()` en el user record.
   * Los tokens actuales (incluido el que hace la petición) dejan de ser válidos.
   */
  async revokeAllTokens(userId) {
    if (!userId || !this.userRepo) return false;
    if (typeof this.userRepo.setTokensInvalidBefore !== 'function') return false;
    const now = Math.floor(Date.now() / 1000);
    await this.userRepo.setTokensInvalidBefore(userId, now);
    return true;
  }

  /**
   * Comprueba si un token está revocado.
   * Llamado por `requireAuth` en cada petición protegida.
   *
   * @param {{ jti?: string|null, userId: string, iat?: number|null }} token
   * @returns {Promise<boolean>}
   */
  async isRevoked({ jti, userId, iat }) {
    // 1) Invalidación global: si el usuario tiene `tokens_invalid_before`,
    //    cualquier token emitido antes es inválido.
    if (userId && this.userRepo && typeof this.userRepo.getTokensInvalidBefore === 'function') {
      try {
        const cutoff = await this.userRepo.getTokensInvalidBefore(userId);
        if (cutoff && iat && iat < cutoff) return true;
      } catch {}
    }
    // 2) Revocación individual por jti.
    if (jti && this.revokedTokensRepo) {
      try {
        return await this.revokedTokensRepo.isRevoked(jti);
      } catch {
        // Fail-closed: si no podemos verificar, asumimos revocado.
        return true;
      }
    }
    return false;
  }
}

/**
 * Crea el servicio si los repositorios necesarios están disponibles.
 * Devuelve `null` si no hay soporte de revocación (compat con JSON sin
 * tabla nueva o con memoria en tests que no lo configuran).
 */
export function createTokenRevocationService({ revokedTokensRepo, userRepo } = {}) {
  if (!revokedTokensRepo && !userRepo) return null;
  return new TokenRevocationService({ revokedTokensRepo, userRepo });
}
