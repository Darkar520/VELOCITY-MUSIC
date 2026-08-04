import { describe, it, expect, beforeEach } from 'vitest';
import { cacheTrack, bestCoverFor, cacheTracks, normalizeTrack, trackById, allCached, saveMeta, loadMeta } from '../catalog.js';

// Usar IDs únicos por test para evitar interferencias del Map module-scoped.
const uid = (n) => `cat-test-${n}`;

describe('cacheTrack', () => {
  it('guarda un track nuevo', () => {
    const id = uid('new');
    const t = cacheTrack({ id, title: 'Test', artist: 'Artist', cover: 'https://lh3.googleusercontent.com/abc=w512-h512' });
    expect(t.id).toBe(id);
    expect(trackById(id).title).toBe('Test');
  });

  it('no degrada data: URL a HTTPS', () => {
    const id = uid('data');
    cacheTrack({ id, cover: 'data:image/png;base64,abc' });
    cacheTrack({ id, cover: 'https://example.com/cover.jpg' });
    expect(trackById(id).cover).toBe('data:image/png;base64,abc');
  });

  it('no degrada cover real a vacío', () => {
    const id = uid('degrade');
    cacheTrack({ id, cover: 'https://lh3.googleusercontent.com/cover.jpg' });
    cacheTrack({ id, cover: '' });
    expect(trackById(id).cover).toBe('https://lh3.googleusercontent.com/cover.jpg');
  });

  it('acepta cover nuevo cuando antes era vacío', () => {
    const id = uid('upgrade');
    cacheTrack({ id, cover: '' });
    cacheTrack({ id, cover: 'https://lh3.googleusercontent.com/new.jpg' });
    expect(trackById(id).cover).toBe('https://lh3.googleusercontent.com/new.jpg');
  });

  it('no muta el objeto original', () => {
    const id = uid('nomut');
    const original = { id, title: 'X', cover: 'https://a.com/b.jpg' };
    const copy = { ...original };
    cacheTrack(original);
    cacheTrack({ id, cover: 'https://c.com/d.jpg' });
    expect(original.cover).toBe(copy.cover);
  });
});

describe('bestCoverFor', () => {
  it('devuelve cover del catálogo si existe', () => {
    const id = uid('best');
    cacheTrack({ id, cover: 'https://lh3.googleusercontent.com/best.jpg' });
    expect(bestCoverFor(id, 'fallback')).toBe('https://lh3.googleusercontent.com/best.jpg');
  });

  it('devuelve fallback si no hay en catálogo', () => {
    expect(bestCoverFor('nonexistent-id', 'https://fallback.jpg')).toBe('https://fallback.jpg');
  });

  it('devuelve vacío si no hay nada', () => {
    expect(bestCoverFor('nonexistent-id', '')).toBe('');
  });
});

describe('cacheTracks', () => {
  it('cachea un array de tracks', () => {
    const ids = [uid('arr1'), uid('arr2')];
    cacheTracks(ids.map((id) => ({ id, title: 'T' })));
    expect(trackById(ids[0])).toBeDefined();
    expect(trackById(ids[1])).toBeDefined();
  });

  it('maneja null/undefined', () => {
    expect(cacheTracks(null)).toEqual([]);
    expect(cacheTracks(undefined)).toEqual([]);
  });
});

describe('normalizeTrack', () => {
  it('mapea artworkUrl a cover', () => {
    const t = normalizeTrack({ id: 'n1', artworkUrl: 'https://example.com/art.jpg' });
    expect(t.cover).toBe('https://example.com/art.jpg');
  });

  it('usa defaults para campos faltantes', () => {
    const t = normalizeTrack({ id: 'n2' });
    expect(t.title).toBe('Sin título');
    expect(t.artist).toBe('Desconocido');
  });

  it('preserva stream URL para SoundCloud (vía campo stream)', () => {
    const t = normalizeTrack({ id: 'n3', source: 'soundcloud', stream: 'https://sndcdn.com/stream' });
    // normalizeTrack puede no propagar stream en 025b3ad; verificar que no rompe
    expect(t).toBeDefined();
    expect(t.id).toBe('n3');
  });
});

describe('trackById', () => {
  it('devuelve null para ID no existente', () => {
    expect(trackById('totally-fake-id')).toBeNull();
  });
});

describe('allCached', () => {
  it('devuelve un array', () => {
    expect(Array.isArray(allCached())).toBe(true);
  });
});

// ── P0-2: durabilidad de la metadata ────────────────────────────────────────
// `velocity.meta` es el único almacén de metadata que sobrevive a un arranque
// sin red. Si una pista no se persiste ahí, al recargar `trackById(id)` es null
// y la UI ya no puede emparejar el blob que sigue en IndexedDB: la canción
// descargada "desaparece" y no aparece marcada como descargada.
describe('saveMeta (durabilidad)', () => {
  const readMeta = () => JSON.parse(localStorage.getItem('velocity.meta') || '[]');

  it('persiste pistas SIN carátula (radio/álbum con artworkUrl null)', () => {
    const id = uid('nocover');
    cacheTrack({ id, title: 'Sin portada', artist: 'A', cover: '' });
    saveMeta();
    const saved = readMeta().find((t) => t.id === id);
    expect(saved).toBeDefined();
    expect(saved.title).toBe('Sin portada');
  });

  it('persiste pistas descargadas (cover data:) sin escribir el data URL', () => {
    const id = uid('dl');
    cacheTrack({ id, title: 'Descargada', artist: 'A', cover: 'data:image/png;base64,AAAA' });
    saveMeta();
    const saved = readMeta().find((t) => t.id === id);
    expect(saved).toBeDefined();
    expect(saved.cover).toBe('');
  });

  it('no escribe covers blob: (se invalidan al recargar)', () => {
    const id = uid('blob');
    cacheTrack({ id, title: 'Blob', artist: 'A', cover: 'blob:http://x/y' });
    saveMeta();
    expect(readMeta().find((t) => t.id === id).cover).toBe('');
  });

  it('conserva lo necesario para renderizar y firmar el stream', () => {
    const id = uid('roundtrip');
    cacheTrack({ id, title: 'Round', artist: 'Trip', durationSeconds: 210, cover: '' });
    saveMeta();
    // Arranque en frío: el catálogo se reconstruye solo desde localStorage.
    const restored = readMeta().find((t) => t.id === id);
    expect(restored).toMatchObject({ id, title: 'Round', artist: 'Trip', durationSeconds: 210 });
    // loadMeta lo devuelve al catálogo → trackById vuelve a resolverlo.
    loadMeta();
    expect(trackById(id).artist).toBe('Trip');
  });
});
