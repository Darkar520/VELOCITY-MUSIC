import nodemailer from 'nodemailer';

/**
 * Servicio de correo — OPCIONAL.
 *
 * Solo se activa si están definidas las variables de entorno SMTP_HOST,
 * SMTP_USER y SMTP_PASS. Si no, todas las funciones son no-ops silenciosos
 * (la app funciona igual, simplemente no envía correos).
 *
 * Config de ejemplo (Gmail con "App Password"):
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=tucorreo@gmail.com
 *   SMTP_PASS=xxxx xxxx xxxx xxxx   (App Password, NO tu contraseña normal)
 *   SMTP_FROM=Velocity Music <tucorreo@gmail.com>
 */

let transporter = null;
let inited = false;

function ensureInit() {
  if (inited) return;
  inited = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return;
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  } catch { transporter = null; }
}

export function mailerEnabled() { ensureInit(); return !!transporter; }

function welcomeHtml(name) {
  const safe = String(name || 'melómano').replace(/[<>&]/g, '');
  return `<!doctype html><html><body style="margin:0;background:#04060a;font-family:'Segoe UI',Arial,sans-serif;color:#f4f7fb">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px">
      <div style="font-size:13px;font-weight:900;letter-spacing:6px;color:#10d9a0">VELOCITY</div>
      <div style="font-size:30px;font-weight:900;letter-spacing:-1px;margin-top:2px">MUSIC</div>
      <div style="height:1px;background:#ffffff18;margin:24px 0"></div>
      <h1 style="font-size:22px;margin:0 0 12px">¡Hola, ${safe}! 🎵</h1>
      <p style="font-size:15px;line-height:1.6;color:#aab4c2;margin:0 0 16px">
        Tu cuenta está lista. Ya puedes escuchar música en alta calidad, guardar tu biblioteca,
        descargar canciones para escuchar sin conexión y descubrir mezclas hechas para ti.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#aab4c2;margin:0 0 24px">
        Dale play y deja que Velocity aprenda lo que te gusta.
      </p>
      <div style="font-size:12px;color:#5b6675;margin-top:32px">Velocity Music · Gracias por unirte.</div>
    </div>
  </body></html>`;
}

/** Envía el correo de bienvenida (best-effort, no bloquea). */
export async function sendWelcomeEmail(to, displayName) {
  ensureInit();
  if (!transporter || !to || !String(to).includes('@') || String(to).endsWith('@velocity.guest')) return false;
  const from = process.env.SMTP_FROM || `Velocity Music <${process.env.SMTP_USER}>`;
  try {
    await transporter.sendMail({
      from, to,
      subject: '¡Bienvenido a Velocity Music! 🎵',
      html: welcomeHtml(displayName),
    });
    return true;
  } catch (e) {
    console.error('[mailer] no se pudo enviar el correo de bienvenida:', e.message);
    return false;
  }
}
