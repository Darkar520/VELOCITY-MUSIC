import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../src/lib/loadEnv.js';

test('loadEnv: carga KEY=VALUE y no pisa process.env existente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-env-'));
  try {
    fs.writeFileSync(
      path.join(dir, '.env'),
      [
        '# comentario',
        '',
        'LOADENV_TEST_A=from-file',
        'LOADENV_TEST_B=keep-me',
        'LOADENV_TEST_QUOTED="quoted value"',
      ].join('\n'),
      'utf8',
    );

    process.env.LOADENV_TEST_B = 'already-set';
    delete process.env.LOADENV_TEST_A;
    delete process.env.LOADENV_TEST_QUOTED;

    const r = loadEnv(dir);
    assert.equal(r.loaded, true);
    assert.equal(r.keys, 2); // B no se cuenta (ya existía)
    assert.equal(process.env.LOADENV_TEST_A, 'from-file');
    assert.equal(process.env.LOADENV_TEST_B, 'already-set');
    assert.equal(process.env.LOADENV_TEST_QUOTED, 'quoted value');
  } finally {
    delete process.env.LOADENV_TEST_A;
    delete process.env.LOADENV_TEST_B;
    delete process.env.LOADENV_TEST_QUOTED;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnv: archivo ausente → loaded false sin lanzar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-env-missing-'));
  try {
    const r = loadEnv(dir);
    assert.equal(r.loaded, false);
    assert.equal(r.keys, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
