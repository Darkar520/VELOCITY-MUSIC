/**
 * radio-quality.test.js — Regresión defecto B (calidad de radio).
 *
 * Cubre:
 *  - radioCohesion: preferencia de versión de estudio en scoreCandidate.
 *  - radioNext.mergeRadioTail (política de cola pre-extendida del frontend):
 *    0 duplicados (id + título), versión de estudio preferida, sin artista
 *    consecutivo, cap por artista, cohesión preservada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { scoreCandidate, isLiveOrRemixVersion, assembleRadio } =
  await import('../src/lib/radioCohesion.js');
const { mergeRadioTail, isLiveOrRemix } = await import('../frontend/src/radioNext.js');

// ── radioCohesion: preferencia de estudio ──────────────────────────
test('isLiveOrRemixVersion detecta directos/remixes', () => {
  assert.equal(isLiveOrRemixVersion('Toxicity (Live)'), true);
  assert.equal(isLiveOrRemixVersion('Song - Remix'), true);
  assert.equal(isLiveOrRemixVersion('Aerials'), false);
});

test('defecto B: scoreCandidate prefiere la versión de estudio sobre el directo', () => {
  const sp = { neighbors: [{ name: 'A', relevance: 1, isSeed: true }], artistNorm: 'a', hasGenre: false, mainstreamIds: new Set() };
  const studio = { title: 'Song', artist: 'A', graphDistance: 0 };
  const live = { title: 'Song (Live)', artist: 'A', graphDistance: 0 };
  assert.ok(scoreCandidate(sp, studio) > scoreCandidate(sp, live));
});

test('defecto B: assembleRadio coloca la versión de estudio antes que el directo', () => {
  const sp = { neighbors: [{ name: 'A', relevance: 1, isSeed: true }, { name: 'B', relevance: 0.9 }], artistNorm: 'a', hasGenre: false, mainstreamIds: new Set() };
  const raw = [
    { id: '1', title: 'Hit', artist: 'A', graphDistance: 0, mainstream: true },
    { id: '2', title: 'Hit (Live)', artist: 'A', graphDistance: 0, mainstream: true },
    { id: '3', title: 'Other', artist: 'B', graphDistance: 0, mainstream: true },
  ];
  const { tracks } = assembleRadio(sp, raw, 10);
  const studioIdx = tracks.findIndex((t) => t.id === '1');
  const liveIdx = tracks.findIndex((t) => t.id === '2');
  // dedupeByTitleNorm colapsa "Hit"/"Hit (Live)"? No: normalizeText conserva "live".
  // Si ambos sobreviven, el estudio debe ir antes.
  if (studioIdx !== -1 && liveIdx !== -1) assert.ok(studioIdx < liveIdx);
  else assert.ok(studioIdx !== -1, 'la versión de estudio debe estar presente');
});

// ── radioNext.mergeRadioTail ────────────────────────────────────────
test('isLiveOrRemix (frontend) detecta versiones no-estudio', () => {
  assert.equal(isLiveOrRemix('X (En Vivo)'), true);
  assert.equal(isLiveOrRemix('X'), false);
});

const existing = [{ id: 'seed', title: 'Chop Suey', artist: 'System of a Down' }];
const candidates = [
  { id: '1', title: 'Toxicity (Live)', artist: 'System of a Down' },
  { id: '2', title: 'Toxicity', artist: 'System of a Down' },   // estudio, mismo título que #1
  { id: '3', title: 'Aerials', artist: 'System of a Down' },
  { id: '4', title: 'Bring Me To Life', artist: 'Evanescence' },
  { id: '5', title: 'Chop Suey', artist: 'Cover Band' },        // dup de título del seed → fuera
  { id: '6', title: 'Duality', artist: 'Slipknot' },
  { id: '2', title: 'Toxicity', artist: 'System of a Down' },   // dup de id → fuera
  { id: '7', title: 'Wait and Bleed', artist: 'Slipknot' },
];

test('defecto B: mergeRadioTail no produce duplicados (id ni título)', () => {
  const out = mergeRadioTail(existing, candidates, { maxPerArtist: 5 });
  const ids = out.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  assert.ok(!ids.includes('5'), 'descarta el título ya presente en la cola (Chop Suey)');
  const titleBases = out.map((t) => t.title.toLowerCase().replace(/\s*[([].*$/, '').trim());
  assert.equal(new Set(titleBases).size, titleBases.length, 'títulos base únicos');
});

test('defecto B: mergeRadioTail prefiere la versión de estudio', () => {
  const out = mergeRadioTail(existing, candidates, { maxPerArtist: 5 });
  const ids = out.map((t) => t.id);
  assert.ok(ids.includes('2'), 'conserva la versión de estudio de Toxicity');
  assert.ok(!ids.includes('1'), 'descarta la versión en directo de Toxicity');
});

test('defecto B: mergeRadioTail no encadena el mismo artista consecutivo', () => {
  const out = mergeRadioTail(existing, candidates, { maxPerArtist: 5 });
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
  for (let i = 1; i < out.length; i++) {
    assert.notEqual(norm(out[i].artist), norm(out[i - 1].artist), `posición ${i} repite artista`);
  }
  // y tampoco repite el artista de la última pista de la cola existente (seed = SOAD)
  if (out.length) assert.notEqual(norm(out[0].artist), norm('System of a Down'));
});

test('defecto B: mergeRadioTail respeta el cap por artista', () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push({ id: `a${i}`, title: `T${i}`, artist: 'Solo' });
  for (let i = 0; i < 10; i++) many.push({ id: `b${i}`, title: `U${i}`, artist: `Other${i}` });
  const out = mergeRadioTail([], many, { maxPerArtist: 3 });
  const soloCount = out.filter((t) => t.artist === 'Solo').length;
  assert.ok(soloCount <= 3, `cap por artista: ${soloCount} > 3`);
});

// ── P0-1: la cola de radio debe poder CRECER ────────────────────────────────
// La continuidad es un requisito; la diversidad, una preferencia. Si
// mergeRadioTail devuelve (casi) nada, ensureRadioFull no extiende la cola y
// next() se queda sin destino: la reproducción no avanza de la primera pista.

test('P0-1: mergeRadioTail no colapsa títulos distintos que comparten prefijo antes de "-"', () => {
  // Estilo de subida muy habitual en YouTube Music: "Artista - Canción".
  const cands = [
    { id: 'a', title: 'Bad Bunny - Tití Me Preguntó', artist: 'Bad Bunny' },
    { id: 'b', title: 'Bad Bunny - Ojitos Lindos', artist: 'Bad Bunny' },
    { id: 'c', title: 'Bad Bunny - Moscow Mule', artist: 'Bad Bunny' },
    { id: 'd', title: 'Song - Part II', artist: 'Other' },
    { id: 'e', title: 'Song - Part III', artist: 'Other' },
    { id: 'f', title: 'A|B', artist: 'Third' },
    { id: 'g', title: 'A|C', artist: 'Third' },
  ];
  const out = mergeRadioTail([], cands, { maxPerArtist: 5 });
  assert.equal(out.length, cands.length, `se descartaron ${cands.length - out.length} pistas legítimas`);
});

test('P0-1: mergeRadioTail no descarta candidatas por el prefijo del título del seed', () => {
  const seedQueue = [{ id: 'seed', title: 'Bad Bunny - Callaíta', artist: 'Bad Bunny' }];
  const cands = [
    { id: 'a', title: 'Bad Bunny - Tití Me Preguntó', artist: 'Bad Bunny' },
    { id: 'b', title: 'Bad Bunny - Ojitos Lindos', artist: 'Bad Bunny' },
  ];
  const out = mergeRadioTail(seedQueue, cands, { maxPerArtist: 5 });
  assert.equal(out.length, 2, 'el título del seed no debe vaciar la cola de radio');
});

test('P0-1: radio mono-artista de 40 candidatas hace crecer la cola ≥ 20 pistas', () => {
  const seedQueue = [{ id: 'seed', title: 'Canción 0', artist: 'Solo Artist' }];
  const cands = [];
  for (let i = 1; i <= 40; i++) cands.push({ id: `t${i}`, title: `Canción ${i}`, artist: 'Solo Artist' });
  const out = mergeRadioTail(seedQueue, cands, { maxPerArtist: 5 });
  assert.ok(out.length >= 20, `la cola solo creció ${out.length} pistas (starvación por cap de artista)`);
  const ids = out.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'sin duplicados');
});

test('P0-1: mergeRadioTail nunca devuelve vacío si hay candidatas nuevas por id', () => {
  const seedQueue = [{ id: 'seed', title: 'X', artist: 'Solo' }];
  // Cola ya saturada de un único artista: el cap NO debe dejar la cola sin next.
  for (let i = 0; i < 9; i++) seedQueue.push({ id: `q${i}`, title: `Q${i}`, artist: 'Solo' });
  const out = mergeRadioTail(seedQueue, [{ id: 'new', title: 'Nueva', artist: 'Solo' }], { maxPerArtist: 5 });
  assert.equal(out.length, 1, 'la continuidad de la cola es requisito, no preferencia');
});
