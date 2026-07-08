/**
 * Helper de autorización admin — acepta AMBOS métodos de autenticación:
 *
 *   1. Header `X-Admin-Key: <key>`         (preferido, no aparece en logs)
 *   2. Query param `?key=<key>`            (deprecado, aparece en access logs
 *                                              y Referer — se conserva para
 *                                              no romper el panel admin actual
 *                                              mientras se migra)
 *
 * Cuando se usa el query param, se loguea un warning en stderr para que el
 * operador tenga visibilidad y migre. En el futuro se puede eliminar la
 * rama de query param una vez que todos los bookmarks/links usen el header.
 *
 * Uso típico:
 *   const result = checkAdminKey(req);
 *   if (!result.ok) return res.status(result.status).json({ error: result.error });
 *   // ... continuar con el handler
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * Comprueba la clave admin de la petición.
 * @param {import('express').Request} req
 * @param {string} adminKey La clave admin configurada (debe tener >=8 chars).
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function checkAdminKey(req, adminKey) {
  const headerKey = req.get('X-Admin-Key');
  const queryKey = req.query.key;

  let provided;
  let source;
  if (headerKey && typeof headerKey === 'string') {
    provided = headerKey;
    source = 'header';
  } else if (queryKey && typeof queryKey === 'string') {
    provided = queryKey;
    source = 'query';
  }

  if (!provided) {
    return { ok: false, status: 401, error: 'Falta la clave de administrador (usa el header X-Admin-Key).' };
  }

  // Comparación en tiempo constante para evitar timing attacks.
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(adminKey));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'Clave de administrador inválida.' };
  }

  if (source === 'query') {
    console.warn(
      `[security] ADMIN_KEY usada via query param (deprecado). ` +
      `Migrar al header X-Admin-Key para evitar exposición en logs/Referer. ` +
      `Ruta: ${req.method} ${req.path}`,
    );
  }

  return { ok: true };
}

