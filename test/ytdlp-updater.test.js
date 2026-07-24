import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startYtDlpAutoUpdate } from '../src/services/ytdlpUpdater.js';

// El updater no debe lanzar ni bloquear; devuelve un handle con stop().
test('startYtDlpAutoUpdate: deshabilitado con YTDLP_AUTO_UPDATE=0', () => {
  const prev = process.env.YTDLP_AUTO_UPDATE;
  process.env.YTDLP_AUTO_UPDATE = '0';
  const logs = [];
  const handle = startYtDlpAutoUpdate({ resolveBin: () => 'yt-dlp', log: (m) => logs.push(m) });
  assert.equal(typeof handle.stop, 'function');
  assert.ok(logs.some((l) => l.includes('deshabilitado')));
  handle.stop();
  process.env.YTDLP_AUTO_UPDATE = prev;
});

test('startYtDlpAutoUpdate: activo devuelve handle con stop() y no lanza', () => {
  const prev = process.env.YTDLP_AUTO_UPDATE;
  process.env.YTDLP_AUTO_UPDATE = '1';
  const logs = [];
  // resolveBin devuelve un binario inexistente: el runOnce en background debe
  // fallar de forma no fatal (no romper el proceso ni el test).
  const handle = startYtDlpAutoUpdate({
    resolveBin: () => 'definitely-not-a-real-binary-xyz',
    intervalHours: 12,
    log: (m) => logs.push(m),
  });
  assert.equal(typeof handle.stop, 'function');
  assert.ok(logs.some((l) => l.includes('activo')));
  handle.stop(); // cancelar antes de que corra el kickoff (5 s)
  process.env.YTDLP_AUTO_UPDATE = prev;
});
