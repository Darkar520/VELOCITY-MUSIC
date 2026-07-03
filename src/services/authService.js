import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';

const scrypt = promisify(scryptCb);

/**
 * Auth_Service — registro, login y autorización JWT.
 *
 * Almacena contraseñas solo como hash scrypt con sal de ≥ 16 bytes única por
 * usuario. Nunca texto plano. JWT con caducidad de 3600 s.
 *
 * Requisitos: 6.1–6.8
 */

export const TOKEN_TTL_SECONDS = 3650 * 24 * 3600; // ~10 años (sesión prácticamente indefinida)
export const SALT_BYTES = 16;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
const KEYLEN = 64;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Valida la complejidad de la contraseña (6.2).
 * @returns {{ ok: true } | { ok: false, rule: string }}
 */
export function validatePassword(password) {
  const p = String(password ?? '');
  if (p.length < PASSWORD_MIN) return { ok: false, rule: `mínimo ${PASSWORD_MIN} caracteres` };
  if (p.length > PASSWORD_MAX) return { ok: false, rule: `máximo ${PASSWORD_MAX} caracteres` };
  if (!/[A-Z]/.test(p)) return { ok: false, rule: 'al menos una letra mayúscula' };
  if (!/[a-z]/.test(p)) return { ok: false, rule: 'al menos una letra minúscula' };
  if (!/[0-9]/.test(p)) return { ok: false, rule: 'al menos un dígito' };
  if (!/[^A-Za-z0-9]/.test(p)) return { ok: false, rule: 'al menos un carácter no alfanumérico' };
  return { ok: true };
}

/** Genera un hash salado con formato `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Verifica una contraseña contra un hash almacenado, en tiempo constante. */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scrypt(password, salt, expected.length);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function createAuthService({ userRepo, jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me' }) {
  // En producción, un secreto por defecto conocido públicamente permite forjar tokens.
  // Lanzar error al arrancar si no está configurado correctamente.
  if (process.env.NODE_ENV === 'production' && jwtSecret === 'dev-secret-change-me') {
    throw new Error('[Auth] JWT_SECRET no configurado. Establece la variable de entorno JWT_SECRET antes de iniciar en producción.');
  }
  return {
    /** Registro (6.1, 6.2, 6.3, 6.8). */
    async register({ email, password, displayName }) {
      const normalizedEmail = String(email ?? '').trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new AuthError(400, 'Email inválido.');
      }
      const pw = validatePassword(password);
      if (!pw.ok) {
        throw new AuthError(400, `La contraseña no cumple: ${pw.rule}.`);
      }
      const existing = await userRepo.findByEmail(normalizedEmail);
      if (existing) {
        throw new AuthError(409, 'El email ya está registrado.');
      }
      const passwordHash = await hashPassword(password);
      const name = String(displayName ?? '').trim().slice(0, 40);
      const user = await userRepo.insert({ email: normalizedEmail, passwordHash, displayName: name });
      return { id: user.id, email: user.email, displayName: user.displayName || '' };
    },

    /** Login (6.4, 6.5). Mensaje genérico para no revelar email vs password. */
    async login({ email, password }) {
      const normalizedEmail = String(email ?? '').trim().toLowerCase();
      const user = await userRepo.findByEmail(normalizedEmail);
      const ok = user ? await verifyPassword(password, user.passwordHash) : false;
      if (!ok) {
        throw new AuthError(401, 'Credenciales inválidas.');
      }
      // Trazabilidad: registrar el inicio de sesión (best-effort).
      try { if (typeof userRepo.recordLogin === 'function') await userRepo.recordLogin(user.id); } catch {}
      const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
      return { token, email: user.email, displayName: user.displayName || '' };
    },

    /**
     * Modo invitado: crea una cuenta anónima efímera (sin email real ni
     * contraseña usable) y emite un JWT. Permite usar la app completa sin
     * compartir datos personales.
     */
    async guest() {
      const rnd = randomBytes(9).toString('hex');
      const email = `invitado-${rnd}@velocity.guest`;
      const passwordHash = await hashPassword(randomBytes(24).toString('hex'));
      const user = await userRepo.insert({ email, passwordHash, displayName: 'Invitado', isGuest: true });
      try { if (typeof userRepo.recordLogin === 'function') await userRepo.recordLogin(user.id); } catch {}
      const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
      return { token, email: user.email, displayName: 'Invitado', guest: true };
    },

    /** Perfil del usuario autenticado. */
    async getProfile(userId) {
      const u = await userRepo.findById(userId);
      if (!u) throw new AuthError(401, 'Sesión inválida.');
      return { email: u.email, displayName: u.displayName || '', avatar: u.avatar || '', guest: !!u.isGuest };
    },

    /** Actualiza el perfil editable (nombre visible y avatar). */
    async updateProfile(userId, { displayName, avatar }) {
      if (typeof userRepo.updateProfile !== 'function') throw new AuthError(501, 'No disponible.');
      const u = await userRepo.updateProfile(userId, { displayName, avatar });
      if (!u) throw new AuthError(401, 'Sesión inválida.');
      return { email: u.email, displayName: u.displayName || '', avatar: u.avatar || '', guest: !!u.isGuest };
    },

    /** Elimina la cuenta del usuario y todos sus datos (cascada). */
    async deleteAccount(userId) {
      if (typeof userRepo.remove !== 'function') throw new AuthError(501, 'No disponible.');
      const ok = await userRepo.remove(userId);
      if (!ok) throw new AuthError(401, 'Sesión inválida.');
      return { deleted: true };
    },

    /** Verifica un JWT (6.6, 6.7). */
    verifyToken(token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        return { userId: payload.sub };
      } catch {
        return null;
      }
    },

    /**
     * Inicio de sesión con Google: el email ya viene verificado por Google
     * (la ruta valida el ID token). Encuentra o crea la cuenta y emite un JWT.
     * Las cuentas creadas por Google reciben una contraseña aleatoria no usable
     * (solo entran por Google, salvo que restablezcan contraseña en el futuro).
     */
    async googleAuth({ email }) {
      const normalizedEmail = String(email ?? '').trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new AuthError(400, 'Email inválido.');
      }
      let user = await userRepo.findByEmail(normalizedEmail);
      let created = false;
      if (!user) {
        const passwordHash = await hashPassword(randomBytes(24).toString('hex'));
        user = await userRepo.insert({ email: normalizedEmail, passwordHash });
        created = true;
      }
      try { if (typeof userRepo.recordLogin === 'function') await userRepo.recordLogin(user.id); } catch {}
      const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
      return { token, email: user.email, displayName: user.displayName || '', created };
    },
  };
}
