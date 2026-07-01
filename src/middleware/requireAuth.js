/**
 * Middleware de autorización JWT (6.6, 6.7).
 *
 * JWT ausente/inválido/caducado → 401 sin procesar la petición; válido →
 * adjunta `req.userId` y continúa.
 *
 * Además verifica que el userId del token corresponda a una cuenta existente.
 * Esto previene que tokens obsoletos (de cuentas eliminadas o re-registros)
 * escriban datos bajo userIds huérfanos que nunca aparecen en la cuenta real.
 */
export function createRequireAuth(authService, userRepo) {
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

    req.userId = result.userId;
    return next();
  };
}
