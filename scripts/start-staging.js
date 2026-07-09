// ════════════════════════════════════════════════════════════════
//  start-staging.js — Instancia de SANDBOX/STAGING del backend.
//
//  Arranca el backend en un puerto y almacén de datos SEPARADOS de
//  producción, para probar cambios sin tocar la instancia en vivo
//  (puerto 3000 + data/). Uso:
//
//     npm run start:staging
//
//  Por defecto: puerto 3001, datos en data-staging/ (JSON aislado).
//  El frontend de desarrollo (vite) hace proxy de /api a localhost:3000;
//  para apuntar a staging, arranca vite con VITE_API=http://localhost:3001
//  o prueba directamente contra http://localhost:3001.
// ════════════════════════════════════════════════════════════════
process.env.PORT = process.env.PORT || '3001';
// Almacén JSON aislado (no comparte velocity-db.json con producción).
process.env.VELOCITY_DATA_DIR = process.env.VELOCITY_DATA_DIR || 'data-staging';
// Nunca usar el cluster/PG de producción en staging por accidente.
delete process.env.CLUSTER;
if (!process.env.STAGING_USE_POSTGRES) delete process.env.USE_POSTGRES;
// Secreto de pruebas (no el de producción).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'staging-only-secret-not-for-prod';

console.log('=======================================================');
console.log('🧪 VELOCITY MUSIC — STAGING');
console.log(`   Puerto:   ${process.env.PORT}`);
console.log(`   Datos:    ${process.env.VELOCITY_DATA_DIR} (aislado de producción)`);
console.log('   Este NO es el entorno de producción.');
console.log('=======================================================');

await import('../server.js').then((m) => m.bootstrap());
