import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('phrase grouping and attention alignment preserve lyric rows and word boundaries', () => {
  const local = fileURLToPath(new URL('../tools/lyrics-translation/Scripts/python.exe', import.meta.url));
  const script = fileURLToPath(new URL('./lyrics_context_test.py', import.meta.url));
  const localPython = process.platform === 'win32' && existsSync(local);
  const candidates = localPython
    ? [[local, []]]
    : process.platform === 'win32'
      ? [['python3', []], ['python', []], ['py', ['-3']]]
      : [['python3', []]];
  let result;
  for (const [python, args] of candidates) {
    const probe = localPython ? { status: 0 } : spawnSync(python, [...args, '--version'], { windowsHide:true });
    if (probe.status === 0) {
      result = spawnSync(python, [...args, script], { encoding:'utf8', windowsHide:true });
      break;
    }
  }
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
