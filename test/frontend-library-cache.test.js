/**
 * frontend-library-cache.test.js — Regresión: identidad canónica de la caché
 * de biblioteca (cacheIdentity).
 *
 * La pérdida masiva offline ("286 favoritos → 1") se originó porque la clave
 * 'velocity.lib.<identidad>' no era la misma online que offline: con email
 * disponible escribía '<email>', y sin él (api.me() falla sin red) leía
 * 'guest-<últimos 12 del token>', que además cambiaba al rotar el token.
 * Ahora la identidad canónica deriva del claim `sub` del JWT: idéntica
 * online/offline y estable entre rotaciones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { cacheIdentity } = await import('../frontend/src/favoriteOutbox.js');

const b64url = (obj) => Buffer.from(JSON.stringify(obj))
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

function jwtWithSub(sub, sig = 'firma') {
  return [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub }), sig].join('.');
}

test('sin token ni email cae a guest; email suelto se normaliza (legacy)', () => {
  assert.equal(cacheIdentity(''), 'guest');
  assert.equal(cacheIdentity('User@Example.COM '), 'user@example.com');
});

test('con JWT la identidad es u:<sub>, haya email o no (simétrica online/offline)', () => {
  const token = jwtWithSub('acc-1');
  assert.equal(cacheIdentity('', token), 'u:acc-1');
  assert.equal(cacheIdentity('acc-1@example.com', token), 'u:acc-1');
  assert.equal(cacheIdentity('', token), cacheIdentity('acc-1@example.com', token));
});

test('la rotación del token (misma cuenta) no cambia la identidad', () => {
  const viejo = cacheIdentity('', jwtWithSub('acc-1', 'firma-vieja'));
  const nuevo = cacheIdentity('', jwtWithSub('acc-1', 'firma-nueva-distinta'));
  assert.equal(viejo, nuevo);
});

test('cuentas distintas producen identidades distintas', () => {
  assert.notEqual(
    cacheIdentity('', jwtWithSub('acc-1')),
    cacheIdentity('', jwtWithSub('acc-2')),
  );
});

test('tokens malformados o no-JWT no lanzan y degradan al fallback legacy', () => {
  assert.equal(cacheIdentity('', 'no-es-un-jwt'), `guest-${'no-es-un-jwt'.slice(-12)}`);
  assert.equal(cacheIdentity('', 'a.b.cuerpo-invalido'), `guest-${'a.b.cuerpo-invalido'.slice(-12)}`);
  assert.equal(cacheIdentity('x@y.z', 'a.b.cuerpo-invalido'), 'x@y.z');
});
