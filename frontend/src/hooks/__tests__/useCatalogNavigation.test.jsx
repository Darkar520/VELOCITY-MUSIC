import { describe, expect, it } from 'vitest';

import {
  buildTrackShareUrl,
  filterVerifiedAlbumTracks,
  findVerifiedAlbumCandidate,
} from '../useCatalogNavigation.js';

describe('buildTrackShareUrl', () => {
  it('usa el origen de la aplicación y codifica el ID de la pista', () => {
    expect(buildTrackShareUrl('jSNvyzsNEaQ', 'https://velocitymusic.uk'))
      .toBe('https://velocitymusic.uk/track/jSNvyzsNEaQ');
    expect(buildTrackShareUrl('id/con-caracteres', 'https://preview.pages.dev'))
      .toBe('https://preview.pages.dev/track/id%2Fcon-caracteres');
  });

  it('rechaza IDs vacíos sin construir un enlace inválido', () => {
    expect(buildTrackShareUrl('', 'https://velocitymusic.uk')).toBe('');
    expect(buildTrackShareUrl(null, 'https://velocitymusic.uk')).toBe('');
  });
});

describe('fallback seguro de álbum', () => {
  const requestedAlbumId = 'MPREb_hzj9o94JcqN';
  const mixedSearch = [
    { id: 'zeet', title: 'ZEET NOISE', artist: 'Skrillex, Boys Noize, & Dylan Brady', album: 'F*CK U SKRILLEX', albumId: requestedAlbumId },
    { id: 'bangarang', title: 'Bangarang', artist: 'Skrillex', album: 'Bangarang EP', albumId: 'album-bangarang' },
    { id: 'kyoto', title: 'Kyoto', artist: 'Skrillex', album: 'Bangarang EP', albumId: 'album-bangarang' },
  ];

  it('con albumId solo acepta membresía exacta, nunca éxitos del mismo artista', () => {
    expect(filterVerifiedAlbumTracks(mixedSearch, {
      albumId: requestedAlbumId,
      name: 'F*CK U SKRILLEX',
      artist: 'Skrillex',
    })).toEqual([mixedSearch[0]]);
  });

  it('sin albumId exige nombre de álbum exacto y artista contribuyente', () => {
    expect(filterVerifiedAlbumTracks(mixedSearch, {
      name: 'F CK U SKRILLEX',
      artist: 'Skrillex',
    })).toEqual([mixedSearch[0]]);
    expect(filterVerifiedAlbumTracks(mixedSearch, {
      name: 'Bangarang EP',
      artist: 'Air',
    })).toEqual([]);
  });

  it('no elige el primer álbum aproximado si no coincide nombre+artista', () => {
    const albums = [
      { albumId: 'wrong', name: 'Recess', artist: 'Skrillex' },
      { albumId: requestedAlbumId, name: 'F*CK U SKRILLEX', artist: 'Skrillex' },
    ];
    expect(findVerifiedAlbumCandidate(albums, {
      name: 'F CK U SKRILLEX',
      artist: 'Skrillex',
    })?.albumId).toBe(requestedAlbumId);
  });
});
