/**
 * frontend-search-ranking.test.js — Regresión defecto #1 (relevancia de búsqueda).
 *
 * Bug: la lista de resultados usaba dedupeByTitle, que conserva el PRIMER
 * duplicado (orden de YouTube). Cuando YouTube devuelve el video musical antes
 * que la versión de álbum, gana el video (miniatura de video, sin albumId).
 *
 * Fix: dedupeByRelevance conserva el MEJOR duplicado (versión de álbum/audio
 * oficial) y ordena por relevancia, dejando el match exacto de título arriba.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { dedupeByRelevance, scoreTrack } = await import('../frontend/src/searchRanking.js');
const { dedupeByTitle } = await import('../frontend/src/helpers.js');

// Dos subidas de la MISMA canción: video musical (i.ytimg, sin álbum) primero,
// versión de álbum (portada lh3 + albumId) después — tal como las ordena YouTube.
const videoVersion = {
  id: 'vid', title: 'Toxicity', artist: 'System of a Down',
  album: 'Sencillo', albumId: null,
  cover: 'https://i.ytimg.com/vi/iywaBOMvYLI/hqdefault.jpg',
};
const albumVersion = {
  id: 'alb', title: 'Toxicity', artist: 'System of a Down',
  album: 'Toxicity', albumId: 'MPREb_xyz',
  cover: 'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj',
};

test('defecto #1: dedupeByTitle conserva el video (documenta el bug previo)', () => {
  const out = dedupeByTitle([videoVersion, albumVersion]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'vid', 'dedupeByTitle conserva el primero = el video');
});

test('defecto #1: dedupeByRelevance conserva la versión de álbum', () => {
  const out = dedupeByRelevance('toxicity', [videoVersion, albumVersion]);
  assert.equal(out.length, 1, 'colapsa los duplicados del mismo título+artista');
  assert.equal(out[0].id, 'alb', 'conserva la versión de álbum, no el video');
});

test('defecto #1: el match exacto de título queda en el top-3', () => {
  const list = [
    { id: 'a', title: 'Toxicity (Cover)', artist: 'Some Cover Band', album: 'Sencillo', albumId: null, cover: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
    { id: 'b', title: 'Chop Suey!', artist: 'System of a Down', album: 'Toxicity', albumId: 'MPRE1', cover: 'https://lh3.googleusercontent.com/1=w544-h544' },
    { id: 'c', title: 'Aerials', artist: 'System of a Down', album: 'Toxicity', albumId: 'MPRE1', cover: 'https://lh3.googleusercontent.com/2=w544-h544' },
    albumVersion,
  ];
  const out = dedupeByRelevance('toxicity', list);
  const top3 = out.slice(0, 3).map((t) => t.id);
  assert.ok(top3.includes('alb'), `Toxicity de SOAD debe estar en top-3, got ${top3}`);
  assert.equal(out[0].id, 'alb', 'el match exacto de título va primero');
});

test('defecto #1: puntúa versión de álbum por encima del video', () => {
  assert.ok(scoreTrack('toxicity', albumVersion) > scoreTrack('toxicity', videoVersion));
});
