import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('phrase grouping and attention alignment preserve lyric rows and word boundaries', () => {
  const local = fileURLToPath(new URL('../tools/lyrics-translation/Scripts/python.exe', import.meta.url));
  const python = process.platform === 'win32' && existsSync(local) ? local : 'python3';
  const result = spawnSync(python, [fileURLToPath(new URL('./lyrics_context_test.py', import.meta.url))], { encoding:'utf8', windowsHide:true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
