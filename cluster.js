// ═══════════════════════════════════════════════════════════════
// Lanzador en CLUSTER — usa todos los cores de CPU para escalar a 100+.
//
// Uso:  USE_POSTGRES=1 CLUSTER=1 node cluster.js
//   (opcional) WEB_CONCURRENCY=N  para fijar el número de workers.
//
// IMPORTANTE: el cluster SOLO es seguro con PostgreSQL (almacén compartido).
// Con el almacén JSON, varios procesos escribiendo el mismo archivo lo
// corromperían, así que en ese caso se arranca en proceso único.
//
// El presupuesto total de procesos yt-dlp (RESOLVE_CONCURRENCY, por defecto 4)
// se reparte entre los workers para no multiplicar la carga por N.
// ═══════════════════════════════════════════════════════════════
import cluster from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/lib/loadEnv.js';

// Cargar .env antes de decidir cluster/PG (no pisa vars ya definidas).
loadEnv(path.dirname(fileURLToPath(import.meta.url)));

const wantCluster = process.env.CLUSTER === '1' || Number(process.env.WEB_CONCURRENCY) > 1;
const usePg = process.env.USE_POSTGRES === '1';

async function runSingle() {
  const { bootstrap } = await import('./server.js');
  await bootstrap();
}

if (!wantCluster) {
  await runSingle();
} else if (!usePg) {
  console.warn('[cluster] Ignorado: el cluster requiere USE_POSTGRES=1 (el almacén JSON no es seguro entre procesos). Arrancando en proceso único.');
  await runSingle();
} else if (cluster.isPrimary) {
  const cores = os.cpus().length || 1;
  // En PC de escritorio (Photoshop + navegador) no spawnear 1 worker por core:
  // 8 workers × Node ≈ OOM y Windows mata el backend. Default seguro: 2.
  // Override: WEB_CONCURRENCY=N en .env
  const raw = Number(process.env.WEB_CONCURRENCY);
  const workers = Number.isFinite(raw) && raw >= 1
    ? Math.min(cores, Math.floor(raw))
    : Math.min(2, cores);
  const totalResolve = Number(process.env.RESOLVE_CONCURRENCY) || 4;
  const perWorker = Math.max(1, Math.floor(totalResolve / workers));

  console.log('=======================================================');
  console.log(`🧩 Velocity Music en CLUSTER: ${workers} workers (de ${cores} cores)`);
  console.log(`🔧 yt-dlp por worker: ${perWorker} (total ~${perWorker * workers})`);
  console.log('=======================================================');

  for (let i = 0; i < workers; i++) {
    cluster.fork({ WORKER_RESOLVE_CONCURRENCY: String(perWorker), WORKER_ID: String(i) });
  }
  // Reponer workers caídos para mantener el servicio siempre arriba.
  // Evitar storm: si un worker muere muy rápido, esperar un poco.
  let lastFork = 0;
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[cluster] worker ${worker.process.pid} salió (${signal || code}). Reponiendo…`);
    const wait = Date.now() - lastFork < 3000 ? 2000 : 200;
    setTimeout(() => {
      lastFork = Date.now();
      cluster.fork({ WORKER_RESOLVE_CONCURRENCY: String(perWorker) });
    }, wait);
  });
} else {
  await runSingle();
}
