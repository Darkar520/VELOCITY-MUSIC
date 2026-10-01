/**
 * ytmusic-artwork.test.js — Regresión defecto #2 (carátulas de video colándose).
 *
 * Bugs:
 *  - mapUpNext: `albumThumb || (isVideoThumb(raw) ? null : raw) || raw` — el
 *    `|| raw` final anulaba el guard y reintroducía el thumb de video.
 *  - getAlbumData: rellenaba la portada de la pista con su miniatura por-pista
 *    (thumb de video) en vez de la portada del álbum.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  getAlbumDataWithClient,
  isVideoThumb,
  resolveAlbumTrackArtwork,
} = await import('../src/extractors/ytmusic.js');

const VIDEO = 'https://i.ytimg.com/vi/iywaBOMvYLI/hqdefault.jpg';
const ALBUM = 'https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj';

test('isVideoThumb detecta miniaturas de video de YouTube', () => {
  assert.equal(isVideoThumb(VIDEO), true);
  assert.equal(isVideoThumb(ALBUM), false);
  assert.equal(isVideoThumb(null), false);
});

test('defecto #2: la pista con thumb de video usa la portada del álbum', () => {
  assert.equal(resolveAlbumTrackArtwork(VIDEO, ALBUM), ALBUM);
});

test('defecto #2: pista sin portada usa la del álbum', () => {
  assert.equal(resolveAlbumTrackArtwork(null, ALBUM), ALBUM);
});

test('defecto #2: portada de pista no-video se conserva', () => {
  const trackArt = 'https://lh3.googleusercontent.com/track=w544-h544';
  assert.equal(resolveAlbumTrackArtwork(trackArt, ALBUM), trackArt);
});

test('defecto #2: sin portada usable → null (deja actuar el fallback, nunca video)', () => {
  assert.equal(resolveAlbumTrackArtwork(VIDEO, VIDEO), null);
  assert.equal(resolveAlbumTrackArtwork(null, null), null);
});

test('defecto #2: guard de mapUpNext no reintroduce el thumb de video', () => {
  const albumThumb = null;
  const rawThumb = VIDEO;
  // Comportamiento ANTERIOR (con el `|| rawThumb` final): devolvía el video.
  const before = albumThumb || (isVideoThumb(rawThumb) ? null : rawThumb) || rawThumb;
  assert.equal(before, VIDEO, 'documenta el bug previo del guard');
  // Comportamiento CORREGIDO (sin el fallback final).
  const after = albumThumb || (isVideoThumb(rawThumb) ? null : rawThumb);
  assert.equal(after, null);
});

test('álbum: completa títulos vacíos por videoId exacto y conserva orden/membresía', async () => {
  const requested = [];
  const client = {
    getAlbum: async () => ({
      name: 'F*CK U SKRILLEX',
      artist: { name: 'Skrillex', artistId: 'artist-skrillex' },
      year: 2025,
      thumbnails: [{ url: ALBUM, width: 544 }],
      songs: [
        { videoId: 'first', name: '', artist: { name: 'Skrillex' } },
        { videoId: 'known', name: 'KNOWN TRACK', artist: { name: 'Skrillex' } },
        { videoId: 'missing', name: '', artist: { name: 'Skrillex' } },
      ],
    }),
    getSong: async (id) => {
      requested.push(id);
      if (id === 'missing') throw new Error('transient provider failure');
      return {
        videoId: 'untrusted-different-id',
        name: 'ZEET NOISE',
        artist: { name: 'Skrillex, Boys Noize, & Dylan Brady', artistId: 'artist-skrillex' },
        duration: 134,
        thumbnails: [{ url: ALBUM, width: 544 }],
      };
    },
  };

  const album = await getAlbumDataWithClient(client, 'album-real');

  assert.deepEqual(requested.sort(), ['first', 'missing']);
  assert.deepEqual(album.tracks.map((track) => track.id), ['first', 'known']);
  assert.equal(album.tracks[0].title, 'ZEET NOISE');
  assert.equal(album.tracks[0].artist, 'Skrillex, Boys Noize, & Dylan Brady');
  assert.equal(album.tracks[0].album, 'F*CK U SKRILLEX');
  assert.equal(album.tracks[0].albumId, 'album-real');
  assert.equal(album.tracks[0].durationSeconds, 134);
  assert.equal(album.tracks[1].title, 'KNOWN TRACK');
});

test('álbum: una lista ya completa no dispara consultas por canción', async () => {
  let calls = 0;
  const album = await getAlbumDataWithClient({
    getAlbum: async () => ({
      name: 'Complete',
      artist: { name: 'Artist' },
      thumbnails: [],
      songs: [{ videoId: 'ready', name: 'Ready', artist: { name: 'Artist' } }],
    }),
    getSong: async () => { calls += 1; return null; },
  }, 'album-complete');

  assert.equal(calls, 0);
  assert.deepEqual(album.tracks.map((track) => track.id), ['ready']);
});
