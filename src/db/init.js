import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Aplica el esquema de forma idempotente (CREATE TABLE IF NOT EXISTS ...).
 */
export async function initSchema() {
  const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await getPool().query(sql);
}

// Ejecución directa: `npm run db:init`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  initSchema()
    .then(() => {
      console.log('✅ Esquema de Velocity Music aplicado correctamente.');
      return closePool();
    })
    .catch((err) => {
      console.error('❌ Error aplicando el esquema:', err.message);
      process.exitCode = 1;
      return closePool();
    });
}
