import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import {
  createAuthService,
  validatePassword,
  AuthError,
  TOKEN_TTL_SECONDS,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from '../src/services/authService.js';
import { createMemoryUserRepo } from '../src/repositories/memory.js';

const RUNS = { numRuns: 100 };
const SECRET = 'test-secret';

// Generador de contraseñas válidas: ≥12, ≤128, con las 4 clases.
const validPassword = fc
  .tuple(
    fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e'), { minLength: 3, maxLength: 30 }),
    fc.stringOf(fc.constantFrom('A', 'B', 'C', 'D', 'E'), { minLength: 3, maxLength: 30 }),
    fc.stringOf(fc.constantFrom('0', '1', '2', '3'), { minLength: 2, maxLength: 20 }),
    fc.stringOf(fc.constantFrom('!', '@', '#', '$', '%'), { minLength: 2, maxLength: 20 }),
  )
  .map(([a, b, c, d]) => `${a}${b}${c}${d}`)
  .filter((p) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX);

const emailArb = fc
  .tuple(fc.stringOf(fc.constantFrom(...'abcdefghijk'), { minLength: 3, maxLength: 10 }), fc.constantFrom('example.com', 'mail.org'))
  .map(([u, d], i) => `${u}@${d}`);

// Feature: velocity-music-streaming, Property 23: El registro válido crea un
// usuario con hash salado único. 201, hash con sal ≥16 bytes única por usuario,
// nunca texto plano; sales distintas aun con contraseñas idénticas.
// Validates: Requirements 6.1, 6.8
test('Property 23: registro válido crea usuario con hash salado único', async () => {
  await fc.assert(
    fc.asyncProperty(validPassword, async (password) => {
      const userRepo = createMemoryUserRepo();
      const auth = createAuthService({ userRepo, jwtSecret: SECRET });

      const u1 = await auth.register({ email: 'a@example.com', password });
      const u2 = await auth.register({ email: 'b@example.com', password });
      assert.ok(u1.id && u2.id);

      const r1 = await userRepo.findByEmail('a@example.com');
      const r2 = await userRepo.findByEmail('b@example.com');

      // Nunca texto plano.
      assert.ok(!r1.passwordHash.includes(password));
      // Formato scrypt$salt$hash con sal ≥ 16 bytes (32 hex chars).
      const [, salt1] = r1.passwordHash.split('$');
      const [, salt2] = r2.passwordHash.split('$');
      assert.ok(salt1.length >= 32);
      // Sales distintas aun con contraseña idéntica.
      assert.notEqual(salt1, salt2);
    }),
    { numRuns: 30 },
  );
});

// Feature: velocity-music-streaming, Property 24: La validación de complejidad de
// contraseña rechaza entradas inválidas (400, sin crear usuario).
// Validates: Requirements 6.2
test('Property 24: complejidad de contraseña rechaza inválidas', async () => {
  const invalidPassword = fc.oneof(
    fc.string({ maxLength: PASSWORD_MIN - 1 }), // demasiado corta
    fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 12, maxLength: 20 }), // sin mayúscula/dígito/símbolo
    fc.stringOf(fc.constantFrom('A', 'B'), { minLength: 12, maxLength: 20 }), // sin minúscula/dígito/símbolo
  );
  await fc.assert(
    fc.asyncProperty(invalidPassword, async (password) => {
      // Pre-condición: realmente inválida.
      if (validatePassword(password).ok) return;
      const userRepo = createMemoryUserRepo();
      const auth = createAuthService({ userRepo, jwtSecret: SECRET });
      await assert.rejects(
        () => auth.register({ email: 'x@example.com', password }),
        (err) => err instanceof AuthError && err.status === 400,
      );
      assert.equal(await userRepo.findByEmail('x@example.com'), null);
    }),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 25: Los emails duplicados se
// rechazan con 409 y no crean un nuevo usuario.
// Validates: Requirements 6.3
test('Property 25: emails duplicados → 409', async () => {
  await fc.assert(
    fc.asyncProperty(validPassword, async (password) => {
      const userRepo = createMemoryUserRepo();
      const auth = createAuthService({ userRepo, jwtSecret: SECRET });
      await auth.register({ email: 'dup@example.com', password });
      await assert.rejects(
        () => auth.register({ email: 'dup@example.com', password }),
        (err) => err instanceof AuthError && err.status === 409,
      );
    }),
    { numRuns: 20 },
  );
});

// Feature: velocity-music-streaming, Property 26: El JWT emitido caduca a los 3600
// segundos.
// Validates: Requirements 6.4
test('Property 26: JWT caduca a 3600 s', async () => {
  await fc.assert(
    fc.asyncProperty(validPassword, async (password) => {
      const userRepo = createMemoryUserRepo();
      const auth = createAuthService({ userRepo, jwtSecret: SECRET });
      await auth.register({ email: 'jwt@example.com', password });
      const { token } = await auth.login({ email: 'jwt@example.com', password });
      const decoded = jwt.verify(token, SECRET);
      assert.equal(decoded.exp - decoded.iat, TOKEN_TTL_SECONDS);
    }),
    { numRuns: 20 },
  );
});

// Feature: velocity-music-streaming, Property 27: El inicio de sesión inválido
// devuelve un 401 genérico (mismo mensaje para email inexistente o password
// incorrecta).
// Validates: Requirements 6.5
test('Property 27: login inválido → 401 genérico', async () => {
  await fc.assert(
    fc.asyncProperty(validPassword, async (password) => {
      const userRepo = createMemoryUserRepo();
      const auth = createAuthService({ userRepo, jwtSecret: SECRET });
      await auth.register({ email: 'real@example.com', password });

      let msgNoEmail;
      let msgBadPw;
      try {
        await auth.login({ email: 'ghost@example.com', password });
      } catch (e) {
        msgNoEmail = e.message;
        assert.equal(e.status, 401);
      }
      try {
        await auth.login({ email: 'real@example.com', password: password + 'X' });
      } catch (e) {
        msgBadPw = e.message;
        assert.equal(e.status, 401);
      }
      // Mensaje idéntico en ambos casos.
      assert.equal(msgNoEmail, msgBadPw);
    }),
    { numRuns: 20 },
  );
});

// Feature: velocity-music-streaming, Property 28: La autorización JWT procesa los
// tokens válidos y rechaza los inválidos.
// Validates: Requirements 6.6, 6.7
test('Property 28: autorización JWT acepta válidos y rechaza inválidos', async () => {
  const userRepo = createMemoryUserRepo();
  const auth = createAuthService({ userRepo, jwtSecret: SECRET });

  await fc.assert(
    fc.asyncProperty(fc.string(), async (userId) => {
      // Token válido para un userId arbitrario.
      const valid = jwt.sign({ sub: userId }, SECRET, { expiresIn: TOKEN_TTL_SECONDS });
      const verified = auth.verifyToken(valid);
      assert.equal(verified.userId, userId);
      assert.ok(typeof verified.exp === 'number');

      // Firma inválida (otro secreto).
      const badSig = jwt.sign({ sub: userId }, 'otro-secreto', { expiresIn: TOKEN_TTL_SECONDS });
      assert.equal(auth.verifyToken(badSig), null);

      // Caducado.
      const expired = jwt.sign({ sub: userId }, SECRET, { expiresIn: -10 });
      assert.equal(auth.verifyToken(expired), null);

      // Ausente / basura.
      assert.equal(auth.verifyToken(undefined), null);
      assert.equal(auth.verifyToken('no-es-un-jwt'), null);
    }),
    { numRuns: 30 },
  );
});

// Property 28b: los tokens emitidos por el authService incluyen `jti` único,
// para permitir la revocación individual.
test('Property 28b: tokens emitidos incluyen jti único', async () => {
  const userRepo = createMemoryUserRepo();
  const auth = createAuthService({ userRepo, jwtSecret: SECRET });
  await auth.register({ email: 'jti@example.com', password: 'ValidPass123!' });
  const { token: t1 } = await auth.login({ email: 'jti@example.com', password: 'ValidPass123!' });
  const { token: t2 } = await auth.login({ email: 'jti@example.com', password: 'ValidPass123!' });
  const d1 = jwt.verify(t1, SECRET);
  const d2 = jwt.verify(t2, SECRET);
  assert.ok(d1.jti && d1.jti.length >= 32);
  assert.ok(d2.jti && d2.jti.length >= 32);
  assert.notEqual(d1.jti, d2.jti, 'Cada login debe producir un jti distinto');
});
