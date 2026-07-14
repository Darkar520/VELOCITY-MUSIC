import { describe, it, expect } from 'vitest';
import {
  shuffle, pick, artistKey, tracksFromIds, mixesByArtist, mixesByChunks,
  ensureManyMixes, offlineMixes, favArtistMixes, recentSliceMixes, playlistMixes,
} from '../feed/mixBuilders.js';
import { cacheTrack } from '../catalog.js';

// Helper: crear tracks de prueba
const mkTracks = (n, prefix = 't') => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i}`, title: `Song ${i}`, artist: i % 3 === 0 ? 'Artist A' : i % 3 === 1 ? 'Artist B' : 'Artist C',
}));

describe('shuffle', () => {
  it('devuelve array del mismo tamaño', () => {
    const a = [1, 2, 3, 4, 5];
    expect(shuffle(a)).toHaveLength(5);
  });
  it('preserva elementos', () => {
    const a = [1, 2, 3];
    const s = shuffle(a);
    expect(s.sort()).toEqual([1, 2, 3]);
  });
  it('no muta original', () => {
    const a = [1, 2, 3];
    const copy = [...a];
    shuffle(a);
    expect(a).toEqual(copy);
  });
});

describe('pick', () => {
  it('devuelve N elementos', () => {
    expect(pick([1, 2, 3, 4, 5], 3)).toHaveLength(3);
  });
  it('N > array.length → devuelve todos', () => {
    expect(pick([1, 2], 5)).toHaveLength(2);
  });
});

describe('artistKey', () => {
  it('normaliza a lowercase sin espacios', () => {
    expect(artistKey({ artist: 'Bad Bunny' })).toBe('badbunny');
    expect(artistKey({ artist: 'LINKIN PARK' })).toBe('linkinpark');
  });
  it('artist vacío → string vacío', () => {
    expect(artistKey({ artist: '' })).toBe('');
  });
});

describe('tracksFromIds', () => {
  it('mapea IDs a tracks desde el catálogo', () => {
    cacheTrack({ id: 'tfi-1', title: 'A', artist: 'X' });
    cacheTrack({ id: 'tfi-2', title: 'B', artist: 'Y' });
    const r = tracksFromIds(['tfi-1', 'tfi-2', 'nonexistent']);
    expect(r).toHaveLength(2);
  });
  it('deduplica', () => {
    cacheTrack({ id: 'tfi-3', title: 'C', artist: 'Z' });
    const r = tracksFromIds(['tfi-3', 'tfi-3']);
    expect(r).toHaveLength(1);
  });
});

describe('mixesByArtist', () => {
  it('agrupa por artista', () => {
    const tracks = mkTracks(15, 'mba');
    tracks.forEach(cacheTrack);
    const mixes = mixesByArtist(tracks);
    expect(mixes.length).toBeGreaterThan(0);
    expect(mixes[0].tracks.length).toBeGreaterThan(0);
  });

  it('respeta maxMixes', () => {
    const tracks = mkTracks(12, 'mbm');
    tracks.forEach(cacheTrack);
    const mixes = mixesByArtist(tracks, { maxMixes: 2 });
    expect(mixes.length).toBeLessThanOrEqual(2);
  });
  it('respeta minTracks', () => {
    const tracks = [{ id: 'solo-1', title: 'X', artist: 'Solo' }];
    expect(mixesByArtist(tracks, { minTracks: 2 })).toHaveLength(0);
  });
});

describe('mixesByChunks', () => {
  it('parte en chunks de tamaño fijo', () => {
    const tracks = mkTracks(20, 'mbc');
    const mixes = mixesByChunks(tracks, { size: 5, maxMixes: 4 });
    expect(mixes).toHaveLength(4);
    expect(mixes[0].tracks).toHaveLength(5);
  });
  it('respeta maxMixes', () => {
    const tracks = mkTracks(50, 'mbcm');
    const mixes = mixesByChunks(tracks, { size: 5, maxMixes: 3 });
    expect(mixes.length).toBeLessThanOrEqual(3);
  });
  it('array vacío → []', () => {
    expect(mixesByChunks([])).toEqual([]);
  });
});

describe('ensureManyMixes', () => {
  it('ya hay ≥ min → devuelve tal cual', () => {
    const mixes = [
      { label: 'A', tracks: mkTracks(5, 'em1') },
      { label: 'B', tracks: mkTracks(5, 'em2') },
      { label: 'C', tracks: mkTracks(5, 'em3') },
    ];
    expect(ensureManyMixes(mixes, { min: 3 })).toHaveLength(3);
  });

  it('1 mix con muchas tracks → expande por artista', () => {
    const tracks = mkTracks(20, 'em4');
    const one = [{ label: 'Big', tracks }];
    const r = ensureManyMixes(one, { min: 2 });
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it('filtra mixes con < 4 tracks', () => {
    const mixes = [
      { label: 'A', tracks: mkTracks(2, 'em5') },
      { label: 'B', tracks: mkTracks(5, 'em6') },
    ];
    const r = ensureManyMixes(mixes, { min: 1 });
    expect(r.every((m) => m.tracks.length >= 4)).toBe(true);
  });
});

describe('offlineMixes', () => {
  it('devuelve mixes para tracks descargados', () => {
    const tracks = mkTracks(15, 'off');
    tracks.forEach(cacheTrack);
    const ids = tracks.map((t) => t.id);
    const mixes = offlineMixes(ids);
    expect(mixes.length).toBeGreaterThan(0);
  });
  it('< 4 tracks → []', () => {
    expect(offlineMixes(['a', 'b'])).toEqual([]);
  });
});

describe('favArtistMixes', () => {
  it('agrupa favoritos por artista', () => {
    const tracks = mkTracks(10, 'fav');
    tracks.forEach(cacheTrack);
    const ids = tracks.map((t) => t.id);
    const mixes = favArtistMixes(ids);
    expect(mixes.length).toBeGreaterThan(0);
  });
});

describe('recentSliceMixes', () => {
  it('crea slices temporales', () => {
    const tracks = mkTracks(30, 'rec');
    tracks.forEach(cacheTrack);
    const ids = tracks.map((t) => t.id);
    const mixes = recentSliceMixes(ids);
    expect(mixes.length).toBeGreaterThan(0);
  });
  it('< 4 tracks → []', () => {
    expect(recentSliceMixes(['r1', 'r2'])).toEqual([]);
  });
});

describe('playlistMixes', () => {
  it('un mix por playlist', () => {
    const tracks = mkTracks(10, 'pl');
    tracks.forEach(cacheTrack);
    const pls = [{ name: 'My Playlist', trackIds: tracks.map((t) => t.id) }];
    const mixes = playlistMixes(pls);
    expect(mixes).toHaveLength(1);
    expect(mixes[0].label).toBe('My Playlist');
  });
  it('filtra playlists vacías', () => {
    const pls = [{ name: 'Empty', trackIds: [] }];
    expect(playlistMixes(pls)).toHaveLength(0);
  });
});
