import pg from 'pg';

/**
 * Pool de conexiones PostgreSQL — configuración robusta para producción.
 *
 * Soporta:
 *  - DATABASE_URL (cadena completa, p.ej. Supabase/Neon/Render), o
 *  - PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE por separado.
 *
 * Ajustes clave para evitar "Connection terminated unexpectedly":
 *  - SSL obligatorio para proveedores en la nube (Supabase, Neon, Render…)
 *  - idleTimeoutMillis: cierra conexiones inactivas ANTES de que lo haga el
 *    servidor remoto (Supabase cierra a los ~60 s de inactividad).
 *  - connectionTimeoutMillis: no bloquea indefinidamente si el host no responde.
 *  - keepAlive: TCP keepalive para detectar y cerrar conexiones muertas rápido.
 *  - max: límite de conexiones. Supabase Free = 20 conexiones por proyecto;
 *    en cluster de 8 workers, 2 conexiones por worker = 16 total (margen seguro).
 *    Ajustar con PG_MAX_POOL_SIZE si el plan lo permite.
 *
 * El pool se crea de forma perezosa (primer uso) para no abrir conexiones
 * en entornos de prueba que no usan PostgreSQL.
 */

const { Pool } = pg;
let _pool = null;

function buildPoolConfig() {
  const maxConn = Number(process.env.PG_MAX_POOL_SIZE) || 2;

  const tlsOptions = {
    // Supabase, Neon y Render requieren SSL. Deshabilitar solo en localhost.
    ssl: process.env.PGSSL === '0' || process.env.PGHOST === 'localhost'
      ? false
      : { rejectUnauthorized: false },
    // Supabase cierra idle connections en ~60 s → nosotros cerramos a los 45 s.
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 45_000,
    // Si no hay conexión disponible en 10 s, lanzar error (no bloquear el worker).
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS) || 10_000,
    // TCP keepalive para detectar conexiones muertas sin esperar al timeout OS.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: maxConn,
  };

  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ...tlsOptions };
  }

  return {
    host:     process.env.PGHOST     || 'localhost',
    port:     Number(process.env.PGPORT || 5432),
    user:     process.env.PGUSER     || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'velocity_music',
    ...tlsOptions,
  };
}

export function getPool() {
  if (_pool) return _pool;

  const config = buildPoolConfig();
  _pool = new Pool(config);

  // Log de errores del pool (conexiones caídas, etc.) sin crashear el proceso.
  _pool.on('error', (err) => {
    console.error('[pg-pool] Error inesperado en cliente idle:', err.message);
    // No reasignamos _pool a null aquí: el Pool de node-postgres gestiona
    // internamente la reconexión de clientes idle. Sí lo hacemos en casos
    // graves (p.ej. ECONNREFUSED continuado) para forzar reinicio del pool.
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error('[pg-pool] Host de base de datos inalcanzable. Reiniciando pool…');
      _pool = null;
    }
  });

  _pool.on('connect', () => {
    if (process.env.NODE_ENV !== 'test') {
      // Solo loguear la primera conexión para no saturar los logs.
    }
  });

  return _pool;
}

/**
 * Ejecuta una query con reintentos automáticos ante errores transitorios.
 *
 * node-postgres ya reintenta internamente al adquirir un cliente, pero ciertos
 * errores llegan después de que la conexión parecía válida (p.ej. Supabase
 * "Connection terminated unexpectedly" justo al enviar la query). Envolver
 * las queries en este wrapper da una segunda oportunidad con backoff mínimo.
 */
export async function query(text, params, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getPool().query(text, params);
    } catch (err) {
      lastErr = err;
      const isTransient = isTransientError(err);
      if (!isTransient || attempt === retries) throw err;
      // Backoff corto antes del reintento: 100 ms, 300 ms.
      await sleep(100 * Math.pow(3, attempt));
      // Si el pool fue marcado como inválido, dejarlo reconstituirse.
      if (!_pool) await sleep(200);
    }
  }
  throw lastErr;
}

/** Devuelve true para errores de red/conexión que merecen un reintento. */
function isTransientError(err) {
  if (!err) return false;
  const transientCodes = new Set([
    '57P01', // admin_shutdown
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    '08006', // connection_failure
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08004', // sqlserver_rejected_establishment_of_sqlconnection
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
  ]);
  return transientCodes.has(err.code) ||
    (err.message || '').includes('Connection terminated') ||
    (err.message || '').includes('connection timeout') ||
    (err.message || '').includes('SSL connection');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Verifica que la conexión a la base de datos funciona.
 * Útil al arrancar el servidor para detectar problemas de configuración temprano.
 */
export async function checkConnection() {
  try {
    const { rows } = await getPool().query('SELECT NOW() AS now, current_database() AS db');
    console.log(`[pg-pool] ✅ Conectado a PostgreSQL — BD: ${rows[0].db} — Hora servidor: ${rows[0].now}`);
    return true;
  } catch (err) {
    console.error('[pg-pool] ❌ No se pudo conectar a PostgreSQL:', err.message);
    return false;
  }
}

export async function closePool() {
  if (_pool) {
    await _pool.end().catch(() => {});
    _pool = null;
  }
}
