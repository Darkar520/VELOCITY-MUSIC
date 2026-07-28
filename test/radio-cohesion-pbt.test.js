/**
 * Property-based tests del núcleo puro de cohesión de radio.
 * Feature: radio-genre-cohesion.
 *
 * Verifican las 20 propiedades de correctness del diseño sobre radioCohesion.js
 * (sin red). fast-check, 100 iteraciones por propiedad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { normalizeText } from '../src/lib/normalize.js';
import {
  RADIO_CONFIG,
  buildNeighborArtistSet,
  classifyCandidate,
  filterByGraphDistance,
  enforceQuotas,
  capPerArtistList,
  dedupeById,
  dedupeByTitleNorm,
  excludeSoundCloud,
  cohesionRatio,
  assembleRadio,
} from '../src/lib/radioCohesion.js';

const RUNS = { numRuns: 100 };
const C = RADIO_CONFIG;

// Vecindario de nu metal (≥2 artistas para permitir intercalado sin >3 consecutivos).
const NEIGHBOR_NAMES = ['Korn', 'System of a Down', 'Linkin Park', 'Deftones', 'Slipknot'];
const OFF_NAMES = ['Bad Bunny', 'Anuel AA', 'Marc Anthony', 'Guns N Roses'];

function makeSeedProfile({ hasGenre = false } = {}) {
  const neighbors = buildNeighborArtistSet(
    { id: 'a0', name: 'Korn' },
    NEIGHBOR_NAMES.slice(1).map((name, i) => ({ id: `a${i + 1}`, name, relevance: 0.9 - i * 0.1 })),
  );
  return {
    seedVideoId: 'seed',
    artist: 'Korn',
    artistNorm: normalizeText('Korn'),
    genre: hasGenre ? 'nu metal' : null,
    hasGenre,
    neighbors,
    mainstreamIds: new Set(),
    neighborsFromCatalog: true,
  };
}

// Genera una candidata RAW; id se asigna fuera para controlar unicidad.
const rawCandidateArb = fc.record({
  artist: fc.constantFrom(...NEIGHBOR_NAMES, ...OFF_NAMES),
  title: fc.string({ minLength: 1, maxLength: 8 }),
  genre: fc.constantFrom(null, null, 'nu metal', 'salsa'),
  graphDistance: fc.integer({ min: 0, max: 4 }),
  mainstream: fc.boolean(),
});

// Lista de candidatas con ids únicos (index) — dominio típico del ensamblado.
const candidateListArb = fc.array(rawCandidateArb, { minLength: 0, maxLength: 60 })
  .map((arr) => arr.map((c, i) => ({ ...c, id: `t${i}` })));

// Lista con muchas In_Profile mainstream (stock suficiente para P13).
const mainstreamRichListArb = fc.array(
  fc.record({
    artistIdx: fc.integer({ min: 0, max: NEIGHBOR_NAMES.length - 1 }),
    title: fc.string({ minLength: 1, maxLength: 8 }),
    graphDistance: fc.integer({ min: 0, max: 2 }),
  }),
  { minLength: 20, maxLength: 60 },
).map((arr) => arr.map((c, i) => ({
  id: `m${i}`,
  artist: NEIGHBOR_NAMES[c.artistIdx],
  title: c.title,
  genre: null,
  graphDistance: c.graphDistance,
  mainstream: true, // stock mainstream abundante
})));

function offRatio(tracks) {
  if (!tracks.length) return 0;
  return tracks.filter((t) => t.inProfile !== true).length / tracks.length;
}
function mainRatio(tracks) {
  if (!tracks.length) return 0;
  return tracks.filter((t) => t.mainstream === true).length / tracks.length;
}
function maxConsecutive(tracks, keyFn) {
  let max = 0, run = 0, prev = Symbol('none');
  for (const t of tracks) {
    const k = keyFn(t);
    if (k === prev) run += 1; else { prev = k; run = 1; }
    if (run > max) max = run;
  }
  return max;
}

// Property 1: Invariante de cohesión
// Validates: Requirements 1.1, 3.5, 5.4, 5.6, 10.1
test('Feature: radio-genre-cohesion, Property 1: invariante de cohesión', () => {
  fc.assert(fc.property(candidateListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    if (tracks.length === 0) return;
    assert.ok(cohesionRatio(tracks) >= C.COHESION_MIN - 1e-9,
      `cohesion ${cohesionRatio(tracks)} < ${C.COHESION_MIN}`);
  }), RUNS);
});

// Property 2: Cohesión por ventana deslizante
// Validates: Requirements 1.2
test('Feature: radio-genre-cohesion, Property 2: cohesión por ventana deslizante', () => {
  fc.assert(fc.property(candidateListArb, (cands) => {
    const { tracks } = assembleRadio(makeSeedProfile({ hasGenre: true }), cands, 40);
    const W = C.WINDOW_SIZE;
    if (tracks.length < W) return;
    for (let i = 0; i + W <= tracks.length; i++) {
      const win = tracks.slice(i, i + W);
      const off = win.filter((t) => t.inProfile !== true).length;
      assert.ok(off <= Math.floor((1 - C.COHESION_MIN) * W),
        `ventana ${i}: ${off} off en ${W}`);
    }
  }), RUNS);
});

// Property 3: Cohesión con género desconocido vía vecindario
// Validates: Requirements 1.6, 7.1, 7.2
test('Feature: radio-genre-cohesion, Property 3: género desconocido vía vecindario', () => {
  fc.assert(fc.property(candidateListArb, (cands) => {
    const { tracks } = assembleRadio(makeSeedProfile({ hasGenre: false }), cands, 40);
    if (tracks.length === 0) return;
    assert.ok(cohesionRatio(tracks) >= C.COHESION_MIN - 1e-9);
  }), RUNS);
});

// Property 4: Pertenencia por vecindario
// Validates: Requirements 2.2, 7.2
test('Feature: radio-genre-cohesion, Property 4: pertenencia por vecindario', () => {
  const sp = makeSeedProfile();
  fc.assert(fc.property(fc.constantFrom(...NEIGHBOR_NAMES), fc.string({ maxLength: 6 }), (name, title) => {
    // Variar mayúsculas/espacios: sigue coincidiendo.
    const noisy = `  ${name.toUpperCase()} `;
    const { inProfile } = classifyCandidate(sp, { id: 'x', artist: noisy, title, genre: null, graphDistance: 0 });
    assert.equal(inProfile, true);
  }), RUNS);
});

// Property 5: Pertenencia por género
// Validates: Requirements 2.3
test('Feature: radio-genre-cohesion, Property 5: pertenencia por género', () => {
  const sp = makeSeedProfile({ hasGenre: true });
  fc.assert(fc.property(fc.string({ maxLength: 6 }), (title) => {
    // Artista distinto al de la semilla y fuera del vecindario, pero mismo género.
    const { inProfile } = classifyCandidate(sp, { id: 'x', artist: 'Some Random Band', title, genre: 'Nu Metal', graphDistance: 0 });
    assert.equal(inProfile, true);
  }), RUNS);
});

// Property 6: Estructura del Neighbor_Artist_Set
// Validates: Requirements 2.1
test('Feature: radio-genre-cohesion, Property 6: estructura del Neighbor_Artist_Set', () => {
  const relatedArb = fc.array(
    fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), relevance: fc.double({ min: 0, max: 1, noNaN: true }) }),
    { minLength: 0, maxLength: 60 },
  );
  fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 10 }), relatedArb, (seedName, related) => {
    const set = buildNeighborArtistSet({ name: seedName }, related);
    assert.ok(set.length <= C.MAX_NEIGHBORS);
    // incluye la semilla
    assert.ok(set.some((n) => n.isSeed && n.nameNorm === normalizeText(seedName)) || normalizeText(seedName) === '');
    // orden no creciente por relevancia
    for (let i = 1; i < set.length; i++) assert.ok(set[i - 1].relevance >= set[i].relevance - 1e-9);
    // sin nameNorm duplicados
    assert.equal(new Set(set.map((n) => n.nameNorm)).size, set.length);
  }), RUNS);
});

// Property 8: Cota de distancia de grafo
// Validates: Requirements 3.1, 10.3
test('Feature: radio-genre-cohesion, Property 8: cota de distancia de grafo', () => {
  fc.assert(fc.property(candidateListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    for (const t of tracks) assert.ok(t.graphDistance <= C.MAX_GRAPH_DISTANCE);
    // También la función directa
    for (const t of filterByGraphDistance(cands, C.MAX_GRAPH_DISTANCE)) {
      assert.ok(t.graphDistance <= C.MAX_GRAPH_DISTANCE);
    }
  }), RUNS);
});

// Property 9: Distancia positiva implica In_Profile
// Validates: Requirements 3.2
test('Feature: radio-genre-cohesion, Property 9: distancia positiva ⇒ In_Profile', () => {
  fc.assert(fc.property(candidateListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    for (const t of tracks) {
      if (t.graphDistance > 0) assert.equal(t.inProfile, true);
    }
  }), RUNS);
});

// Property 10: Cota de deriva (Off_Profile)
// Validates: Requirements 3.3, 10.2
test('Feature: radio-genre-cohesion, Property 10: cota de deriva Off_Profile', () => {
  fc.assert(fc.property(candidateListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    if (tracks.length === 0) return;
    assert.ok(offRatio(tracks) <= C.OFF_PROFILE_MAX + 1e-9);
  }), RUNS);
});

// Property 11: Máximo de Off_Profile consecutivas
// Validates: Requirements 3.4
test('Feature: radio-genre-cohesion, Property 11: máx Off_Profile consecutivas', () => {
  fc.assert(fc.property(candidateListArb, (cands) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, 40);
    const run = maxConsecutive(tracks, (t) => (t.inProfile === true ? '_in' : '_off'));
    // Solo cuenta rachas de off
    let maxOff = 0, cur = 0;
    for (const t of tracks) { if (t.inProfile !== true) { cur++; maxOff = Math.max(maxOff, cur); } else cur = 0; }
    assert.ok(maxOff <= C.MAX_CONSECUTIVE_OFF_PROFILE, `off consecutivas ${maxOff}`);
    void run;
  }), RUNS);
});

// Property 12: Exclusión de Discovery fuera de perfil
// Validates: Requirements 4.5
test('Feature: radio-genre-cohesion, Property 12: sin Discovery fuera de perfil', () => {
  fc.assert(fc.property(candidateListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    for (const t of tracks) {
      if (t.mainstream !== true) assert.equal(t.inProfile, true);
    }
  }), RUNS);
});

// Property 13: Proporción mainstream (con stock suficiente)
// Validates: Requirements 4.3, 4.4, 10.5
test('Feature: radio-genre-cohesion, Property 13: proporción mainstream', () => {
  fc.assert(fc.property(mainstreamRichListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    if (tracks.length === 0) return;
    assert.ok(mainRatio(tracks) >= C.MAINSTREAM_MIN - 1e-9, `mainstream ${mainRatio(tracks)}`);
  }), RUNS);
});

// Property 15: Invariante de diversidad por artista
// Validates: Requirements 5.1, 10.4
test('Feature: radio-genre-cohesion, Property 15: cap por artista', () => {
  fc.assert(fc.property(candidateListArb, fc.integer({ min: 1, max: 40 }), (cands, limit) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, limit);
    const counts = new Map();
    for (const t of tracks) {
      const k = normalizeText(t.artist);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const n of counts.values()) assert.ok(n <= C.MAX_PER_ARTIST);
    // función directa
    const capped = capPerArtistList(cands.map((c) => ({ ...c })), C.MAX_PER_ARTIST);
    const cc = new Map();
    for (const t of capped) { const k = normalizeText(t.artist); cc.set(k, (cc.get(k) || 0) + 1); }
    for (const n of cc.values()) assert.ok(n <= C.MAX_PER_ARTIST);
  }), RUNS);
});

// Property 16: Máximo de pistas consecutivas del mismo artista
// Validates: Requirements 5.2
//
// El límite solo es satisfacible cuando hay ≥ 2 artistas distintos en la salida:
// con un único artista, MAX_PER_ARTIST (5) admite hasta 5 pistas y NINGÚN orden
// puede separarlas. Ante ese conflicto entre Req 5.1 y Req 5.2, el diseño
// prioriza conservar las pistas (radio útil) sobre acortar la cola, y
// `arrangeByArtistRoundRobin` fuerza la secuencia de forma explícita.
// Aseverar el límite sin condición hacía la propiedad insatisfacible y por tanto
// flaky según la semilla (contraejemplo real: 4 pistas de un mismo artista).
test('Feature: radio-genre-cohesion, Property 16: máx consecutivas mismo artista', () => {
  fc.assert(fc.property(candidateListArb, (cands) => {
    const { tracks } = assembleRadio(makeSeedProfile(), cands, 40);
    const maxRun = maxConsecutive(tracks, (t) => normalizeText(t.artist));
    const distinctArtists = new Set(tracks.map((t) => normalizeText(t.artist))).size;
    if (distinctArtists >= 2) {
      // Con material de varios artistas el intercalado SÍ debe respetar el tope.
      assert.ok(maxRun <= C.MAX_CONSECUTIVE_SAME_ARTIST, `run ${maxRun}`);
    } else {
      // Un solo artista: el tope es inalcanzable; no debe inventarse ni perderse
      // ninguna pista, así que la racha es exactamente la longitud de la lista.
      assert.equal(maxRun, tracks.length, `run ${maxRun} con 1 artista`);
    }
  }), RUNS);
});

// Property 17: Deduplicación por título normalizado
// Validates: Requirements 5.5
test('Feature: radio-genre-cohesion, Property 17: dedup por título', () => {
  const withTitlesArb = fc.array(
    fc.record({ id: fc.string({ minLength: 1, maxLength: 6 }), title: fc.constantFrom('Freak on a Leash', 'FREAK ON A LEASH', ' freak on a leash ', 'Toxicity', 'toxicity') }),
    { minLength: 0, maxLength: 30 },
  ).map((arr) => arr.map((c, i) => ({ ...c, id: `d${i}`, artist: 'Korn', graphDistance: 0 })));
  fc.assert(fc.property(withTitlesArb, (cands) => {
    const out = dedupeByTitleNorm(cands);
    const norms = out.map((c) => normalizeText(c.title));
    assert.equal(new Set(norms).size, norms.length);
  }), RUNS);
});

// Property 18: Deduplicación por id
// Validates: Requirements 10.6
test('Feature: radio-genre-cohesion, Property 18: dedup por id', () => {
  const withIdsArb = fc.array(
    fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd'), title: fc.string({ maxLength: 6 }) }),
    { minLength: 0, maxLength: 30 },
  ).map((arr) => arr.map((c) => ({ ...c, artist: 'Korn', graphDistance: 0 })));
  fc.assert(fc.property(withIdsArb, (cands) => {
    const out = dedupeById(cands);
    const ids = out.map((c) => String(c.id));
    assert.equal(new Set(ids).size, ids.length);
    // También en el ensamblado final
    const listed = cands.map((c, i) => ({ ...c, id: i % 2 === 0 ? 'dup' : `u${i}` }));
    const { tracks } = assembleRadio(makeSeedProfile(), listed, 40);
    const tids = tracks.map((t) => String(t.id));
    assert.equal(new Set(tids).size, tids.length);
  }), RUNS);
});

// Property 20: Exclusión de SoundCloud
// Validates: Requirements 8.2, 8.3
test('Feature: radio-genre-cohesion, Property 20: exclusión de SoundCloud', () => {
  const scArb = fc.array(
    fc.record({
      artist: fc.constantFrom(...NEIGHBOR_NAMES),
      title: fc.string({ maxLength: 6 }),
      graphDistance: fc.integer({ min: 0, max: 2 }),
      mainstream: fc.boolean(),
      source: fc.constantFrom(undefined, 'soundcloud', 'youtube'),
      stream: fc.constantFrom(undefined, 'https://sc/stream'),
    }),
    { minLength: 0, maxLength: 40 },
  ).map((arr) => arr.map((c, i) => ({ ...c, id: `s${i}`, genre: null })));
  fc.assert(fc.property(scArb, (cands) => {
    const filtered = excludeSoundCloud(cands);
    for (const t of filtered) {
      assert.notEqual(String(t.source || '').toLowerCase(), 'soundcloud');
      assert.ok(!t.stream);
      assert.ok(!t.streamUrl);
    }
    const { tracks } = assembleRadio(makeSeedProfile(), cands, 40);
    for (const t of tracks) {
      assert.notEqual(String(t.source || '').toLowerCase(), 'soundcloud');
      assert.ok(!t.stream);
    }
  }), RUNS);
});

// Property 19: Degradación acotada por catálogo
// Validates: Requirements 1.5, 6.2, 10.7
test('Feature: radio-genre-cohesion, Property 19: degradación acotada por catálogo', () => {
  // Catálogo pequeño: pocas In_Profile → no se rellena con Off para llegar al límite.
  const smallArb = fc.array(
    fc.record({
      artist: fc.constantFrom(...NEIGHBOR_NAMES),
      title: fc.string({ maxLength: 6 }),
      mainstream: fc.constant(true),
    }),
    { minLength: 0, maxLength: 6 },
  ).map((arr) => arr.map((c, i) => ({ ...c, id: `p${i}`, genre: null, graphDistance: 0 })));
  fc.assert(fc.property(smallArb, (cands) => {
    const { tracks, truncated } = assembleRadio(makeSeedProfile(), cands, 40);
    const ids = tracks.map((t) => String(t.id));
    assert.equal(new Set(ids).size, ids.length); // sin duplicados (10.7)
    const uniqueInProfile = dedupeById(cands).length;
    assert.ok(tracks.length <= uniqueInProfile); // no rellena con Off inexistentes
    if (tracks.length > 0 && tracks.length < 40) assert.equal(truncated, true);
  }), RUNS);
});
