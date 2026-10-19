import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.LYRICS_TRANSLATION_PYTHON || path.join(root, 'tools/lyrics-translation', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const cache = new Map(), pending = new Map();
let active = 0;

export function validateTranslationLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 300 || lines.some(line => typeof line !== 'string' || line.length > 1000) || lines.join('\n').length > 24000) {
    throw Object.assign(new Error('Letra demasiado larga o inválida.'), { status: 400 });
  }
  if (lines.join('').trim().length < 20) throw Object.assign(new Error('No hay texto suficiente para detectar el idioma.'), { status: 422 });
}

export async function translateLyrics(lines) {
  validateTranslationLines(lines);
  const key = createHash('sha256').update(JSON.stringify(lines)).digest('hex');
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  if (active >= 2) throw Object.assign(new Error('Traductor ocupado. Inténtalo de nuevo.'), { status: 503 });
  active++;
  const task = new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, 'scripts/translate-lyrics.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) reject(Object.assign(new Error('Traducción temporalmente no disponible.'), { status: 503 }));
      else resolve(result);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('timeout')); }, 45000);
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 150000) { child.kill(); finish(new Error('output')); } });
    child.on('close', code => {
      try {
        if (code !== 0) throw new Error('exit');
        const result = JSON.parse(output);
        if (result.status === 'ready' && (!Array.isArray(result.lines) || result.lines.length !== lines.length || result.lines.some(line => typeof line !== 'string'))) throw new Error('alignment');
        finish(null, { ...result, sourceHash: key });
      } catch (error) { finish(error); }
    });
    child.stdin.end(JSON.stringify({ lines }));
  }).then(result => {
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, result); return result;
  }).finally(() => { active--; pending.delete(key); });
  pending.set(key, task);
  return task;
}
