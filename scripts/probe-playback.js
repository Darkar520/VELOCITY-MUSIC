// Verificación real de transporte. No afirma audibilidad ni sustituye la
// prueba sostenida del reproductor. Las firmas y el JWT nunca se imprimen.
// Ejemplo (staging aislado):
// node scripts/probe-playback.js --guest --artist Skrillex --title Bangarang --id YJVmu6yttiw
// Otros entornos requieren VELOCITY_PROBE_TOKEN en el entorno del proceso.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  base: { type: 'string', default: 'http://127.0.0.1:3001' },
  artist: { type: 'string' }, title: { type: 'string' }, id: { type: 'string' },
  quality: { type: 'string', default: 'high' },
  guest: { type: 'boolean', default: false },
  refresh: { type: 'boolean', default: false },
} });
const startedAt = Date.now();
const report = {
  base: values.base,
  track: { artist: values.artist, title: values.title, id: values.id, quality: values.quality },
  checks: [],
};
function record(check, details) {
  const result = { check, ...details };
  report.checks.push(result);
  console.log(JSON.stringify(result));
}
const request = (url, init = {}, timeoutMs = 25000) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');

try {
  assert.ok(values.artist && values.title && values.id, 'Indica --artist, --title y --id');
  const base = new URL(values.base);
  assert.ok(['http:', 'https:'].includes(base.protocol), 'El origen debe ser HTTP(S)');
  let token = process.env.VELOCITY_PROBE_TOKEN;
  if (values.guest) {
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && base.port === '3001',
      '--guest solo se permite contra staging local en el puerto 3001');
    const login = await request(new URL('/api/auth/guest', base), { method: 'POST' });
    assert.equal(login.status, 200, 'No se pudo abrir la sesión invitada de staging');
    token = (await login.json()).token;
  }
  assert.ok(token, 'Configura VELOCITY_PROBE_TOKEN o usa --guest en staging');
  const params = new URLSearchParams({ ...report.track });
  if (values.refresh) params.set('refresh', '1');
  const prepareStart = Date.now();
  const prepared = await request(new URL('/api/playback/prepare?' + params, base), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const preparedData = await prepared.json();
  record('prepare', { status: prepared.status, elapsedMs: Date.now() - prepareStart,
    code: preparedData.code || null });
  assert.equal(prepared.status, 200, preparedData.error || 'La preparación falló');
  params.delete('refresh');
  params.set('exp', preparedData.exp);
  params.set('sig', preparedData.sig);
  params.set('transport', '2');
  const streamUrl = new URL('/api/stream-proxy?' + params, base);

  const readRange = async (range) => {
    const response = await request(streamUrl, { headers: { Range: range } });
    assert.equal(response.status, 206, 'El rango no entregó audio parcial');
    assert.match(response.headers.get('content-type') || '', /^(audio|video)\//);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    assert.ok(match, 'Content-Range inválido');
    const [start, end, total] = match.slice(1).map(Number);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, end - start + 1, 'El cuerpo parcial está truncado');
    assert.equal(Number(response.headers.get('content-length')), body.length);
    return { start, end, total, body };
  };
  const first = await readRange('bytes=0-');
  assert.equal(first.start, 0);
  record('open_range', { start: first.start, end: first.end, totalBytes: first.total });

  const fullStart = Date.now();
  // El plazo de preparar audio y el de transferir un archivo completo son
  // distintos. Un túnel lento puede seguir entregando datos después de 25 s.
  const full = await request(streamUrl, {}, 120000);
  assert.equal(full.status, 200, 'La transferencia completa no devolvió 200');
  assert.equal(Number(full.headers.get('content-length')), first.total);
  const fullHash = createHash('sha256');
  let fullBytes = 0;
  for await (const chunk of full.body) { fullBytes += chunk.length; fullHash.update(chunk); }
  assert.equal(fullBytes, first.total, 'La transferencia completa está truncada');
  const fullDigest = fullHash.digest('hex');
  record('complete_body', { bytes: fullBytes, elapsedMs: Date.now() - fullStart, sha256: fullDigest });

  const rangeHash = createHash('sha256').update(first.body);
  let cursor = first.end + 1;
  let rangeCount = 1;
  while (cursor < first.total) {
    const end = Math.min(cursor + 512 * 1024 - 1, first.total - 1);
    const part = await readRange(`bytes=${cursor}-${end}`);
    assert.equal(part.start, cursor, 'Hueco o solapamiento entre rangos');
    assert.equal(part.total, first.total, 'El tamaño total cambió entre rangos');
    rangeHash.update(part.body);
    cursor = part.end + 1;
    rangeCount++;
  }
  assert.equal(rangeHash.digest('hex'), fullDigest, 'Los rangos no reconstruyen el mismo audio completo');
  record('range_continuity', { ranges: rangeCount, bytes: cursor, sameSha256: true });

  const tailStart = Math.max(0, first.total - 4096);
  const tail = await readRange(`bytes=${tailStart}-`);
  assert.equal(tail.start, tailStart);
  assert.equal(tail.end, first.total - 1);
  record('seek_to_end', { start: tail.start, end: tail.end, sha256: digest(tail.body) });

  for (const kind of ['invalid_signature', 'expired_signature']) {
    const invalid = new URL(streamUrl);
    invalid.searchParams.set(kind === 'invalid_signature' ? 'sig' : 'exp', kind === 'invalid_signature' ? 'invalid' : '1');
    const response = await request(invalid, { headers: { Range: 'bytes=0-4095' } });
    await response.body?.cancel();
    assert.equal(response.status, 401, 'Una firma inválida/caducada fue aceptada');
    record(kind, { status: response.status });
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error.message).replace(/https?:\/\/\S+/g, '[URL]');
  process.exitCode = 1;
}
report.elapsedMs = Date.now() - startedAt;
console.log(JSON.stringify(report, null, 2));
