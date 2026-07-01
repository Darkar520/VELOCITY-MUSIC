import { spawn } from 'node:child_process';

/**
 * Ejecuta un comando fijo capturando su salida combinada. No acepta entrada del
 * usuario en `cmd`/`args` desde la red: los llamadores usan comandos conocidos.
 *
 * @returns {Promise<{ code: number, output: string }>}
 */
export function runCommand(cmd, args = [], { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (code) => {
      if (!settled) {
        settled = true;
        resolve({ code, output });
      }
    };
    try {
      const proc = spawn(cmd, args, { shell: false });
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* noop */
        }
        done(-1);
      }, timeoutMs);
      proc.stdout?.on('data', (d) => {
        output += d.toString();
      });
      proc.stderr?.on('data', (d) => {
        output += d.toString();
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        done(code ?? -1);
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        output += String(err.message || err);
        done(-1);
      });
    } catch (err) {
      output += String(err.message || err);
      done(-1);
    }
  });
}
