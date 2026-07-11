/**
 * Emparejado de letras y filtro de artista — evita letras ajenas y ruido en catálogo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreLyricsCandidate,
  pickBestLyricsCandidate,
  lyricsOverlapRatio,
  plainFromSynced,
  artistNameMatches,
  cleanLyricQuery,
} from '../src/lib/lyricsMatch.js';
import { rankSearchSongs } from '../src/extractors/ytmusic.js';

test('cleanLyricQuery quita (Official Video) y feat.', () => {
  assert.equal(cleanLyricQuery('Toxicity (Official Video)'), 'Toxicity');
  assert.ok(!cleanLyricQuery('Chop Suey! (feat. Someone)').includes('feat'));
});

test('scoreLyricsCandidate: match exacto artist+title gana alto', () => {
  const sc = scoreLyricsCandidate(
    { artist: 'System of a Down', title: 'Toxicity', duration: 218 },
    { artistName: 'System of a Down', trackName: 'Toxicity', duration: 218, syncedLyrics: '[00:01.00]yes' }
  );
  assert.ok(sc >= 90, `score=${sc}`);
});

test('scoreLyricsCandidate: canción distinta del mismo artista se rechaza o queda baja', () => {
  const sc = scoreLyricsCandidate(
    { artist: 'System of a Down', title: 'Toxicity', duration: 218 },
    { artistName: 'System of a Down', trackName: 'Chop Suey!', duration: 210, syncedLyrics: '[00:01.00]wake up' }
  );
  assert.ok(sc < 55, `score=${sc} no debe pasar el umbral`);
});

test('scoreLyricsCandidate: artista totalmente distinto → 0 o muy bajo', () => {
  const sc = scoreLyricsCandidate(
    { artist: 'System of a Down', title: 'Toxicity', duration: 218 },
    { artistName: 'Don Omar', trackName: 'Dale Don Dale', duration: 200, syncedLyrics: '[00:01.00]dale' }
  );
  assert.ok(sc < 40, `score=${sc}`);
});

test('pickBestLyricsCandidate elige el correcto entre ruido', () => {
  const picked = pickBestLyricsCandidate(
    { artist: 'Nirvana', title: 'Smells Like Teen Spirit', duration: 301 },
    [
      { artistName: 'Someone', trackName: 'Teen Spirit Karaoke', duration: 300, plainLyrics: 'x' },
      { artistName: 'Nirvana', trackName: 'Smells Like Teen Spirit', duration: 301, syncedLyrics: '[00:01.00]load up' },
      { artistName: 'Don Omar', trackName: 'Dale Don Dale', duration: 200, syncedLyrics: '[00:01.00]dale' },
    ],
    55
  );
  assert.ok(picked);
  assert.equal(picked.candidate.artistName, 'Nirvana');
});

test('pickBestLyricsCandidate devuelve null si nada cuadra', () => {
  const picked = pickBestLyricsCandidate(
    { artist: 'System of a Down', title: 'Aerials', duration: 240 },
    [
      { artistName: 'Charyl', trackName: 'Random', duration: 100, plainLyrics: 'nope' },
      { artistName: 'Midnight String Quartet', trackName: 'Something Else', duration: 200, plainLyrics: 'x' },
    ],
    55
  );
  assert.equal(picked, null);
});

test('lyricsOverlapRatio detecta textos distintos', () => {
  const a = 'wake up grab a brush and put a little makeup hide the scars to fade away the shakeup';
  const b = 'dale don dale dale don dale mami dame un chance que te quiero gozar';
  assert.ok(lyricsOverlapRatio(a, b) < 0.3);
  assert.ok(lyricsOverlapRatio(a, a) > 0.9);
});

test('plainFromSynced quita timestamps LRC', () => {
  const p = plainFromSynced('[00:12.00]Hello world\n[00:15.50]Second line');
  assert.equal(p, 'Hello world\nSecond line');
});

test('artistNameMatches: System of a Down vs variantes', () => {
  assert.equal(artistNameMatches('System of a Down', 'System of a Down'), true);
  assert.equal(artistNameMatches('System Of A Down', 'System of a Down'), true);
  assert.equal(artistNameMatches('System of a Down, Serj Tankian', 'System of a Down'), true);
  assert.equal(artistNameMatches('Don Omar', 'System of a Down'), false);
  assert.equal(artistNameMatches('Midnight String Quartet', 'System of a Down'), false);
});

test('rankSearchSongs: búsqueda de artista prioriza canciones del artista', () => {
  const songs = [
    { id: '1', title: 'Dale Don Dale', artist: 'Don Omar' },
    { id: '2', title: 'Toxicity', artist: 'System of a Down' },
    { id: '3', title: 'Aerials', artist: 'Midnight String Quartet' },
    { id: '4', title: 'Chop Suey!', artist: 'System of a Down' },
    { id: '5', title: 'Twinkle Twinkle', artist: 'Someone' },
  ];
  const artists = [{ artistId: 'a1', name: 'System of a Down' }];
  const ranked = rankSearchSongs('System of a Down', songs, artists);
  assert.equal(ranked[0].artist, 'System of a Down');
  assert.equal(ranked[1].artist, 'System of a Down');
  // Covers/ajenos al final
  const idxCover = ranked.findIndex((s) => s.id === '3');
  const idxOwn = ranked.findIndex((s) => s.id === '2');
  assert.ok(idxOwn < idxCover);
});

test('rankSearchSongs: título exacto Toxicity sale primero', () => {
  const songs = [
    { id: '1', title: 'Chop Suey!', artist: 'System of a Down' },
    { id: '2', title: 'Toxicity', artist: 'System of a Down' },
    { id: '3', title: 'Toxicity', artist: 'Some Cover Band' },
  ];
  const ranked = rankSearchSongs('Toxicity', songs, []);
  assert.equal(ranked[0].title, 'Toxicity');
});
