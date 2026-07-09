/**
 * Middleware de autorización JWT (6.6, 6.7).
 *
 * JWT ausente/inválido/caducado → 401 sin procesar la petición; válido →
 * adjunta `req.userId`, `req.jti` y `req.tokenIat` y continúa.
 *
 * Verifica tres cosas:
 *   1. Firma y expiración del JWT (authService.verifyToken).
 *   2. Que el userId del token siga existiendo en el repositorio (evita
 *      que tokens de cuentas eliminadas operen bajo IDs huérfanos).
 *   3. Que el token no haya sido revocado individualmente (por `jti`) ni
 *      invalidado globalmente para el usuario (por `tokens_invalid_before`).
 *
 * El parámetro `revocationService` es opcional: si no se pasa, la
 * verificación de revocación se omite (comportamiento anterior, para
 * no romper tests que no lo configuran).
 */
export function createRequireAuth(authService, userRepo, revocationService = null) {
  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match ? match[1] : null;

    const result = token ? authService.verifyToken(token) : null;
    if (!result) {
      return res.status(401).json({ error: 'Se requiere autenticación.' });
    }

    // Verificar que la cuenta siga existiendo en el repositorio.
    // Si el token es válido pero el userId ya no existe (cuenta eliminada,
    // re-registro con nuevo id, etc.) se devuelve 401 para forzar un nuevo
    // inicio de sesión en lugar de silenciosamente operar bajo un id huérfano.
    if (userRepo) {
      try {
        const user = await userRepo.findById(result.userId);
        if (!user) {
          return res.status(401).json({ error: 'Sesión expirada. Por favor inicia sesión de nuevo.' });
        }
      } catch {
        // Si la verificación de existencia falla (error inesperado del repo),
        // rechazamos la petición de forma conservadora.
        return res.status(401).json({ error: 'No se pudo verificar la sesión.' });
      }
    }

    // Verificar revocación (individual por jti o global por tokens_invalid_before).
    if (revocationService) {
      try {
        const revoked = await revocationService.isRevoked({
          jti: result.jti,
          userId: result.userId,
          iat: result.iat,
        });
        if (revoked) {
          return res.status(401).json({ error: 'La sesión ha sido cerrada. Por favor inicia sesión de nuevo.' });
        }
      } catch {
        // Fail-closed: si el servicio de revocación falla, no sabemos si el
        // token está revocado. Rechazamos la petición por seguridad.
        return res.status(401).json({ error: 'No se pudo verificar el estado de la sesión.' });
      }
    }

    req.userId = result.userId;
    req.jti = result.jti;
    req.tokenIat = result.iat;
    req.tokenExp = result.exp;
    return next();
  };
}
