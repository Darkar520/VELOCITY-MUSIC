import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractorStatus,
  installExtractor,
  installCommandFor,
} from '../src/services/extractorSetup.js';

test('extractorStatus reporta disponibilidad y comandos por plataforma', async () => {
  const available = await extractorStatus(async () => true, 'win32');
  assert.equal(available.available, true);
  assert.match(available.installCommand, /winget/);

  const unavailable = await extractorStatus(async () => false, 'darwin');
  assert.equal(unavailable.available, false);
  assert.match(unavailable.installCommand, /brew/);
});

test('installCommandFor cubre las plataformas principales', () => {
  assert.match(installCommandFor('win32').display, /winget/);
  assert.match(installCommandFor('darwin').display, /brew/);
  assert.match(installCommandFor('linux').display, /pip/);
});

test('installExtractor no reinstala si ya está disponible', async () => {
  let ran = false;
  const result = await installExtractor({
    probe: async () => true,
    runCommand: async () => {
      ran = true;
      return { code: 0, output: '' };
    },
  });
  assert.equal(result.installed, true);
  assert.equal(ran, false);
});

test('installExtractor intenta instalar y verifica con la sonda', async () => {
  let probeCalls = 0;
  const result = await installExtractor({
    platform: 'linux',
    probe: async () => {
      probeCalls += 1;
      return probeCalls > 1; // no disponible al inicio, disponible tras instalar
    },
    runCommand: async () => ({ code: 0, output: 'instalado ok' }),
  });
  assert.equal(result.installed, true);
  assert.match(result.output, /instalado ok/);
});

test('installExtractor informa fallo si el comando no instala', async () => {
  const result = await installExtractor({
    platform: 'linux',
    probe: async () => false,
    runCommand: async () => ({ code: 1, output: 'error de red' }),
  });
  assert.equal(result.installed, false);
});

import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadYtDlp, installYtDlpByDownload, ytDlpAssetFor } from '../src/services/extractorSetup.js';

test('ytDlpAssetFor devuelve el asset correcto por plataforma', () => {
  assert.equal(ytDlpAssetFor('win32'), 'yt-dlp.exe');
  assert.equal(ytDlpAssetFor('darwin'), 'yt-dlp_macos');
  assert.equal(ytDlpAssetFor('linux'), 'yt-dlp_linux');
});

test('downloadYtDlp escribe el binario descargado en binDir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ytdlp-'));
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('#!/bin/sh\necho 2099.01.01').buffer,
    });
    const dest = await downloadYtDlp({ binDir: dir, platform: 'linux', fetchImpl });
    const content = await readFile(dest, 'utf8');
    assert.match(content, /2099\.01\.01/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installYtDlpByDownload reporta instalado cuando la sonda confirma', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ytdlp-'));
  try {
    let probes = 0;
    const result = await installYtDlpByDownload({
      binDir: dir,
      platform: 'linux',
      probe: async () => {
        probes += 1;
        return probes > 1; // no disponible al inicio; disponible tras descargar
      },
      fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    });
    assert.equal(result.installed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installYtDlpByDownload informa fallo si la descarga falla', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ytdlp-'));
  try {
    const result = await installYtDlpByDownload({
      binDir: dir,
      platform: 'linux',
      probe: async () => false,
      fetchImpl: async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    assert.equal(result.installed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
