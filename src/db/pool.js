import pg from 'pg';

/**
 * Pool de conexiones PostgreSQL configurable por entorno.
 *
 * Variables de entorno soportadas:
 *  - DATABASE_URL (cadena de conexión completa), o
 *  - PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *
 * El pool se crea de forma perezosa para que importar este módulo no abra
 * conexiones en entornos de prueba que no usan PostgreSQL.
 */
let pool = null;

export function getPool() {
  if (pool) return pool;

  const { Pool } = pg;
  pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'velocity_music',
      });

  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
