// Regresión P0 — bypass del rate limiting vía cabeceras.
//
// Antes: clientIpKey leía `CF-Connecting-IP` (y si no, `X-Forwarded-For`) de
// CUALQUIER cliente. Rotando su valor en cada petición, cada una caía en un
// bucket distinto y ningún limitador contaba — incluido el de /api/auth, que
// dejaba el login sin protección contra fuerza bruta.
// Ahora: esas cabeceras solo se leen si el socket viene de un proxy de confianza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIpKey, isTrustedProxy, normalizeIp } from '../src/lib/clientIp.js';

/** Request mínimo: lo único que lee clientIpKey. */
function req({ remoteAddress, headers = {}, ip } = {}) {
  return { socket: remoteAddress ? { remoteAddress } : undefined, headers, ip };
}

const ATTACKER = '203.0.113.9'; // TEST-NET-3, conexión directa desde Internet

// ── El bypass ─────────────────────────────────────────────────

test('bypass: CF-Connecting-IP falsificada desde Internet se ignora', () => {
  const key = clientIpKey(req({
    remoteAddress: ATTACKER,
    headers: { 'cf-connecting-ip': '1.2.3.4' },
  }));
  assert.equal(key, ATTACKER);
});

test('bypass: rotar la cabecera en cada petición ya NO cambia el bucket', () => {
  const keys = new Set();
  for (let i = 0; i < 50; i += 1) {
    keys.add(clientIpKey(req({
      remoteAddress: ATTACKER,
      headers: { 'cf-connecting-ip': `10.9.${Math.floor(i / 256)}.${i % 256}` },
    })));
  }
  assert.deepEqual([...keys], [ATTACKER], 'todas las peticiones deben compartir bucket');
});

test('bypass: X-Forwarded-For falsificada desde Internet se ignora', () => {
  const key = clientIpKey(req({
    remoteAddress: ATTACKER,
    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
  }));
  assert.equal(key, ATTACKER);
});

test('bypass: req.ip contaminada no gana al socket no confiable', () => {
  // Con `trust proxy=1` Express deriva req.ip de X-Forwarded-For; si el socket
  // no es un proxy nuestro, ese valor no es creíble.
  const key = clientIpKey(req({
    remoteAddress: ATTACKER,
    headers: { 'x-forwarded-for': '1.2.3.4' },
    ip: '1.2.3.4',
  }));
  assert.equal(key, ATTACKER);
});

// ── Sin regresión: la separación real de usuarios detrás del túnel ──

test('túnel: CF-Connecting-IP desde loopback sí identifica al usuario final', () => {
  const a = clientIpKey(req({ remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': '81.40.1.1' } }));
  const b = clientIpKey(req({ remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': '81.40.2.2' } }));
  assert.equal(a, '81.40.1.1');
  assert.equal(b, '81.40.2.2');
  assert.notEqual(a, b, 'dos usuarios distintos no deben compartir bucket');
});

test('túnel: socket loopback IPv4-mapeada en IPv6 también es de confianza', () => {
  const key = clientIpKey(req({
    remoteAddress: '::ffff:127.0.0.1',
    headers: { 'cf-connecting-ip': '81.40.1.1' },
  }));
  assert.equal(key, '81.40.1.1');
});

test('proxy: sin CF-Connecting-IP se usa req.ip (que Express deriva con trust proxy)', () => {
  const key = clientIpKey(req({ remoteAddress: '172.18.0.1', headers: {}, ip: '81.40.3.3' }));
  assert.equal(key, '81.40.3.3');
});

test('proxy: sin cabeceras ni req.ip se cae al socket', () => {
  assert.equal(clientIpKey(req({ remoteAddress: '127.0.0.1' })), '127.0.0.1');
});

test('sin socket ni req.ip → clave centinela (el limitador hace skip)', () => {
  assert.equal(clientIpKey(req()), 'unknown');
});

// ── Piezas ────────────────────────────────────────────────────

test('isTrustedProxy: loopback y rangos privados sí; público no', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '::ffff:127.0.0.1', '::1', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', 'fd00::1']) {
    assert.equal(isTrustedProxy(ip), true, ip);
  }
  for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2001:4860::1', '', null, undefined, 'no-una-ip']) {
    assert.equal(isTrustedProxy(ip), false, String(ip));
  }
});

test('normalizeIp: recorta y desenvuelve IPv4 mapeadas en IPv6', () => {
  assert.equal(normalizeIp('  81.40.1.1 '), '81.40.1.1');
  assert.equal(normalizeIp('::ffff:10.0.0.1'), '10.0.0.1');
  assert.equal(normalizeIp('::1'), '::1');
  assert.equal(normalizeIp(undefined), '');
});
