/**
 * Errores de arranque del listener HTTP.
 *
 * Un proceso que recibe EADDRINUSE no tiene un servidor funcional aunque el
 * resto de sus tareas asíncronas siga vivo. La política correcta es terminar
 * ese proceso y dejar que el supervisor decida si debe reintentarlo.
 */
export function listenFailureDetails(error, { port } = {}) {
  const code = String(error?.code || 'SERVER_LISTEN_ERROR');
  const portLabel = port === undefined || port === null ? 'configurado' : String(port);
  if (code === 'EADDRINUSE') {
    return {
      code,
      fatal: true,
      message: `El puerto ${portLabel} ya está en uso por otra instancia.`,
    };
  }
  if (code === 'EACCES') {
    return {
      code,
      fatal: true,
      message: `El proceso no tiene permisos para abrir el puerto ${portLabel}.`,
    };
  }
  return {
    code,
    fatal: true,
    message: `El backend no pudo abrir el listener HTTP en el puerto ${portLabel}.`,
  };
}

/**
 * Instala un listener de arranque que no deja un proceso zombie sin puerto.
 * `onFatal` se inyecta en tests; en producción termina el proceso con código 1.
 */
export function attachFatalListenHandler(
  server,
  { port, logger = console, onFatal = () => process.exit(1) } = {},
) {
  if (!server || typeof server.once !== 'function') {
    throw new TypeError('Se requiere un servidor con soporte para eventos.');
  }
  server.once('error', (error) => {
    const details = listenFailureDetails(error, { port });
    try {
      logger.error?.(`❌ ${details.message} (${details.code}).`, error?.message || error);
    } catch { /* el logger no debe impedir la terminación del proceso */ }
    onFatal(details);
  });
  return server;
}
