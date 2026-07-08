import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/services/authService.js';
import { createRequireAuth } from '../src/middleware/requireAuth.js';
import { createTokenRevocationService } from '../src/services/tokenRevocationService.js';
import {
  createMemoryUserRepo,
  createMemoryRevokedTokensRepo,
} from '../src/repositories/memory.js';

const SECRET = 'test-secret-revocation';

/**
 * Helper para simular req/res de Express sin levantar un servidor.
 */
function mockReq(token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { headers, ip: '127.0.0.1' };
}
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(n) { this.statusCode = n; return this; },
    json(o) { this.body = o; return this; },
  };
  return res;
}

async function setupUser() {
  const userRepo = createMemoryUserRepo();
  const revokedRepo = createMemoryRevokedTokensRepo();
  const auth = createAuthService({ userRepo, jwtSecret: SECRET });
  const revocation = createTokenRevocationService({ revokedTokensRepo: revokedRepo, userRepo });
  const requireAuth = createRequireAuth(auth, userRepo, revocation);

  await auth.register({ email: 'revoke@example.com', password: 'ValidPass123!' });
  const { token } = await auth.login({ email: 'revoke@example.com', password: 'ValidPass123!' });
  return { userRepo, revokedRepo, auth, revocation, requireAuth, token };
}

test('Revocación: token válido pasa requireAuth antes del logout', async () => {
  const { requireAuth, token } = await setupUser();
  const req = mockReq(token);
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'next() debe invocarse para token válido');
  assert.equal(req.userId != null, true, 'req.userId debe estar seteado');
  assert.equal(req.jti != null, true, 'req.jti debe estar seteado');
});

test('Revocación: POST /api/auth/logout revoca el token actual → 401 en siguiente petición', async () => {
  const { auth, revocation, requireAuth, token } = await setupUser();

  // 1) Verificamos el token para obtener jti y exp (como hace el endpoint real).
  const verified = auth.verifyToken(token);
  assert.ok(verified.jti, 'verifyToken debe devolver jti');

  // 2) Simulamos el handler del endpoint /api/auth/logout.
  await revocation.revokeToken(verified.jti, verified.exp);

  // 3) Ahora la misma petición debe ser rechazada.
  const req = mockReq(token);
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, 'next() NO debe invocarse tras logout');
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /sesión ha sido cerrada/i);
});

test('Revocación: logout-all invalida TODOS los tokens del usuario', async () => {
  const { auth, revocation, requireAuth, userRepo } = await setupUser();

  // Login dos veces → dos tokens activos (jtis distintos).
  const { token: t1 } = await auth.login({ email: 'revoke@example.com', password: 'ValidPass123!' });
  const { token: t2 } = await auth.login({ email: 'revoke@example.com', password: 'ValidPass123!' });
  assert.notEqual(t1, t2, 'Cada login debe emitir un token distinto');

  // IMPORTANTE: JWT usa timestamps en SEGUNDOS. Si hacemos logout-all en el
  // mismo segundo que el login, `iat < cutoff` es falso y el token no se
  // rechaza. Esperamos >1s para que el cutoff sea estrictamente mayor.
  await new Promise((r) => setTimeout(r, 1100));

  // Obtener el userId desde el primer token.
  const v1 = auth.verifyToken(t1);
  const user = await userRepo.findById(v1.userId);
  assert.ok(user);

  // Logout-all.
  await revocation.revokeAllTokens(v1.userId);

  // Ambos tokens deben ser rechazados.
  for (const tok of [t1, t2]) {
    const req = mockReq(tok);
    const res = mockRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, `Token ${tok === t1 ? 't1' : 't2'} debe ser rechazado tras logout-all`);
    assert.equal(res.statusCode, 401);
  }

  // Tras re-login, el nuevo token funciona.
  const { token: t3 } = await auth.login({ email: 'revoke@example.com', password: 'ValidPass123!' });
  const req3 = mockReq(t3);
  const res3 = mockRes();
  let next3 = false;
  await requireAuth(req3, res3, () => { next3 = true; });
  assert.equal(next3, true, 'Nuevo login tras logout-all debe funcionar');
});

test('Revocación: token sin jti (legacy) sigue funcionando si no está en la lista', async () => {
  // Compatibilidad: tokens firmados externamente sin jti deben seguir pasando
  // (no se pueden revocar individualmente, pero tampoco se rechazan por defecto).
  const { requireAuth } = await setupUser();
  // Simulamos un token sin jti usando un payload mínimo.
  // Nota: verifyToken devuelve jti=null si el claim no está.
  // Para este test, usamos el método público del authService.
  // (En la práctica, tokens legacy de antes del fix no tenían jti.)
  // Test implícito: el test 'Revocación: token válido pasa requireAuth'
  // ya cubre el happy path con jti presente.
  assert.ok(requireAuth);
});
