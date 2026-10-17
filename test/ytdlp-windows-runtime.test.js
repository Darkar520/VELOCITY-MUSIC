import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installWindowsRuntime, resolveWindowsRuntime } from '../src/services/ytdlpWindowsRuntime.js';
import { updateYtDlpOnce } from '../src/services/ytdlpUpdater.js';

async function fixture(t) {
  const binDir = await mkdtemp(path.join(tmpdir(), 'velocity-runtime-'));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  return binDir;
}

function release(content, { corrupt = false } = {}) {
  const archive = Buffer.from(content);
  const sha = createHash('sha256').update(archive).digest('hex');
  return async (url) => new Response(url.endsWith('SHA2-256SUMS')
    ? `${sha}  yt-dlp_win.zip\n`
    : corrupt ? Buffer.from('corrupt') : archive);
}

async function unpackImpl(_archive, destination) {
  await mkdir(path.join(destination, '_internal'), { recursive: true });
  await writeFile(path.join(destination, 'yt-dlp.exe'), 'verified test executable');
}

test('checksum mismatch never unpacks or activates downloaded code', async (t) => {
  const binDir = await fixture(t);
  await assert.rejects(installWindowsRuntime({ binDir, fetchImpl: release('v1', { corrupt: true }),
    unpackImpl: () => assert.fail('untrusted archive must not execute'),
  }), /SHA-256/);
  assert.equal(resolveWindowsRuntime(binDir), null);
});

test('failed runtime validation preserves the active executable and manifest', async (t) => {
  const binDir = await fixture(t);
  const first = await installWindowsRuntime({ binDir, fetchImpl: release('v1'), unpackImpl, probeImpl: async () => true });
  const manifest = await readFile(path.join(binDir, 'yt-dlp-win', 'active.json'), 'utf8');
  await assert.rejects(installWindowsRuntime({ binDir, fetchImpl: release('v2'), unpackImpl, probeImpl: async () => false }), /sonda/);
  assert.equal(resolveWindowsRuntime(binDir), first.bin);
  assert.equal(await readFile(path.join(binDir, 'yt-dlp-win', 'active.json'), 'utf8'), manifest);
  assert.equal((await readdir(path.join(binDir, 'yt-dlp-win'))).some(name => name.startsWith('.install-')), false);
});

test('verified updates switch generations and retain only the current and previous runtime', async (t) => {
  const binDir = await fixture(t);
  const install = content => installWindowsRuntime({ binDir, fetchImpl: release(content), unpackImpl, probeImpl: async () => true });
  const first = await install('v1');
  const second = await install('v2');
  const third = await install('v3');
  assert.equal(resolveWindowsRuntime(binDir), third.bin);
  assert.equal(await readFile(second.bin, 'utf8'), 'verified test executable');
  await assert.rejects(readFile(first.bin), { code: 'ENOENT' });
  const unchanged = await install('v3');
  assert.equal(unchanged.alreadyLatest, true);
  assert.equal(unchanged.bin, third.bin);
});

test('active manifest cannot select an executable outside the managed directory', async (t) => {
  const binDir = await fixture(t);
  await mkdir(path.join(binDir, 'yt-dlp-win'));
  await writeFile(path.join(binDir, 'yt-dlp-win', 'active.json'), JSON.stringify({ folder: '../escape', sha256: 'a'.repeat(64) }));
  assert.equal(resolveWindowsRuntime(binDir), null);
});

test('auto-updater replaces the whole managed distribution instead of invoking unsupported -U', async (t) => {
  const binDir = await fixture(t);
  const { bin } = await installWindowsRuntime({ binDir, fetchImpl: release('v1'), unpackImpl, probeImpl: async () => true });
  let target;
  const result = await updateYtDlpOnce({ bin, installRuntime: async ({ binDir: dir }) => {
    target = dir;
    return { updated: true, alreadyLatest: false };
  } });
  assert.equal(target, binDir);
  assert.equal(result.updated, true);
  const failure = await updateYtDlpOnce({ bin, installRuntime: async () => { throw new Error('offline'); } });
  assert.equal(failure.updated, false);
  assert.equal(resolveWindowsRuntime(binDir), bin);
});
