import { describe, it, expect } from 'vitest';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';

describe('fmt', () => {
  it('formatea segundos a m:ss', () => {
    expect(fmt(65)).toBe('1:05');
    expect(fmt(0)).toBe('0:00');
    expect(fmt(3599)).toBe('59:59');
  });
  it('devuelve 0:00 para valores inválidos', () => {
    expect(fmt(null)).toBe('0:00');
    expect(fmt(undefined)).toBe('0:00');
    expect(fmt(NaN)).toBe('0:00');
    expect(fmt('abc')).toBe('0:00');
  });
  it('maneja decimales truncando al entero', () => {
    expect(fmt(65.9)).toBe('1:05');
    expect(fmt(60.5)).toBe('1:00');
  });
  it('devuelve 0:00 para valores negativos (bug fixeado)', () => {
    expect(fmt(-5)).toBe('0:00');
    expect(fmt(-100)).toBe('0:00');
  });
});

describe('hex2rgba', () => {
  it('convierte hex a rgba con alpha', () => {
    expect(hex2rgba('#ff0000', 1)).toBe('rgba(255,0,0,1)');
    expect(hex2rgba('#10d9a0', 0.5)).toBe('rgba(16,217,160,0.5)');
  });
  it('maneja hex uppercase', () => {
    expect(hex2rgba('#FF0000', 1)).toBe('rgba(255,0,0,1)');
  });
  it('maneja alpha 0', () => {
    expect(hex2rgba('#000000', 0)).toBe('rgba(0,0,0,0)');
  });
});

describe('grad', () => {
  it('genera linear-gradient con ángulo default 135', () => {
    const T = { accent: '#10d9a0', accent2: '#06b6d4' };
    expect(grad(T)).toBe('linear-gradient(135deg, #10d9a0, #06b6d4)');
  });
  it('acepta ángulo custom', () => {
    const T = { accent: '#a78bfa', accent2: '#ec4899' };
    expect(grad(T, 90)).toBe('linear-gradient(90deg, #a78bfa, #ec4899)');
  });
});

describe('hiResCover', () => {
  it('reemplaza =wXXX-hXXX con el tamaño pedido', () => {
    const url = 'https://lh3.googleusercontent.com/abc=w1200-h1200';
    expect(hiResCover(url, 512)).toBe('https://lh3.googleusercontent.com/abc=w512-h512');
  });
  it('reemplaza =sXXX', () => {
    const url = 'https://lh3.googleusercontent.com/abc=s1200';
    expect(hiResCover(url, 300)).toBe('https://lh3.googleusercontent.com/abc=s300');
  });
  it('reemplaza patrón iTunes XXXxXXXbb.jpg', () => {
    const url = 'https://island-abc.mzstatic.com/image/1200x1200bb.jpg';
    const result = hiResCover(url, 256);
    expect(result).toContain('256x256bb.jpg');
  });
  it('clampa tamaño entre 64 y 1200', () => {
    const url = 'https://lh3.googleusercontent.com/abc=w1200-h1200';
    expect(hiResCover(url, 10)).toContain('w64-h64');
    expect(hiResCover(url, 9999)).toContain('w1200-h1200');
  });
  it('no modifica URLs sin patrón conocido', () => {
    const url = 'https://example.com/cover.jpg';
    expect(hiResCover(url, 512)).toBe(url);
  });
  it('devuelve el input para null/vacío', () => {
    expect(hiResCover(null, 512)).toBeNull();
    expect(hiResCover('', 512)).toBe('');
    expect(hiResCover(undefined, 512)).toBeUndefined();
  });
  it('no aplica a data: URLs', () => {
    const data = 'data:image/png;base64,abc123';
    expect(hiResCover(data, 512)).toBe(data);
  });
  it('usa 512 como tamaño default', () => {
    const url = 'https://lh3.googleusercontent.com/abc=w1200-h1200';
    expect(hiResCover(url)).toContain('w512-h512');
  });
});

describe('dedupeByTitle', () => {
  it('elimina duplicados exactos (case insensitive)', () => {
    const tracks = [
      { artist: 'Bad Bunny', title: 'Tití Me Preguntó' },
      { artist: 'bad bunny', title: 'tití me preguntó' },
      { artist: 'Joji', title: 'Glimpse of Us' },
    ];
    expect(dedupeByTitle(tracks)).toHaveLength(2);
  });
  it('ignora sufijos entre paréntesis', () => {
    const tracks = [
      { artist: 'Linkin Park', title: 'In The End' },
      { artist: 'Linkin Park', title: 'In The End (Official Video)' },
    ];
    expect(dedupeByTitle(tracks)).toHaveLength(1);
  });
  it('preserva el primer elemento', () => {
    const tracks = [
      { artist: 'A', title: 'X', id: '1' },
      { artist: 'A', title: 'X', id: '2' },
    ];
    const result = dedupeByTitle(tracks);
    expect(result[0].id).toBe('1');
  });
  it('devuelve vacío para array vacío', () => {
    expect(dedupeByTitle([])).toEqual([]);
  });
});

describe('capPerArtist', () => {
  it('limita por artista', () => {
    const tracks = [
      { artist: 'Bad Bunny', title: 'A' },
      { artist: 'Bad Bunny', title: 'B' },
      { artist: 'Bad Bunny', title: 'C' },
      { artist: 'Bad Bunny', title: 'D' },
      { artist: 'Joji', title: 'E' },
    ];
    expect(capPerArtist(tracks, 2)).toHaveLength(3);
  });
  it('case insensitive', () => {
    const tracks = [
      { artist: 'BAD BUNNY', title: 'A' },
      { artist: 'bad bunny', title: 'B' },
      { artist: 'Bad Bunny', title: 'C' },
    ];
    expect(capPerArtist(tracks, 1)).toHaveLength(1);
  });
  it('conserva orden original', () => {
    const tracks = [
      { artist: 'A', title: '1' },
      { artist: 'B', title: '2' },
      { artist: 'A', title: '3' },
      { artist: 'B', title: '4' },
    ];
    const r = capPerArtist(tracks, 1);
    expect(r[0].title).toBe('1');
    expect(r[1].title).toBe('2');
  });
});

describe('slimTrack', () => {
  it('extrae campos esenciales', () => {
    const t = { id: 'x', title: 'T', artist: 'A', cover: 'https://img.com/a.jpg', durationSeconds: 200, url: 'https://stream.com/a' };
    const s = slimTrack(t);
    expect(s.id).toBe('x');
    expect(s.title).toBe('T');
    expect(s.cover).toBe('https://img.com/a.jpg');
    expect(s.url).toBeUndefined();
  });
  it('excluye data: covers', () => {
    const s = slimTrack({ id: 'x', cover: 'data:image/png;base64,abc' });
    expect(s.cover).toBe('');
  });
  it('excluye blob: covers', () => {
    const s = slimTrack({ id: 'x', cover: 'blob:https://example.com/abc' });
    expect(s.cover).toBe('');
  });
  it('fallback duration→durationSeconds', () => {
    const s = slimTrack({ id: 'x', duration: 180 });
    expect(s.durationSeconds).toBe(180);
  });
  it('devuelve null sin id', () => {
    expect(slimTrack(null)).toBeNull();
    expect(slimTrack({ title: 'x' })).toBeNull();
  });
});

describe('parseLRC', () => {
  it('parsea timestamps LRC', () => {
    const lrc = '[00:17.09] She\'d take the world\n[00:25.67] She\'d turn the rain';
    const r = parseLRC(lrc);
    expect(r).toHaveLength(2);
    expect(r[0].t).toBeCloseTo(17.09);
    expect(r[0].text).toContain("She'd take");
    expect(r[1].t).toBeCloseTo(25.67);
  });
  it('ordena por tiempo', () => {
    const lrc = '[00:25.00] B\n[00:17.00] A';
    const r = parseLRC(lrc);
    expect(r[0].text).toBe('A');
  });
  it('múltiples stamps por línea', () => {
    const lrc = '[00:01.00][00:10.00] Repeated line';
    const r = parseLRC(lrc);
    expect(r).toHaveLength(2);
    expect(r[0].t).toBe(1);
    expect(r[1].t).toBe(10);
  });
  it('input vacío devuelve []', () => {
    expect(parseLRC('')).toEqual([]);
    expect(parseLRC(null)).toEqual([]);
  });
  it('filtra líneas sin timestamp', () => {
    const lrc = 'Plain line\n[00:01.00] Synced line';
    const r = parseLRC(lrc);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('Synced line');
  });
});

describe('lyricsOverlapRatio', () => {
  it('textos idénticos → 1', () => {
    const t = 'hello world this is a test song lyrics';
    expect(lyricsOverlapRatio(t, t)).toBe(1);
  });
  it('textos completamente diferentes → < 0.3', () => {
    const a = 'hello world this is a test song lyrics here';
    const b = 'purple monkey dishwasher completely unrelated content words';
    expect(lyricsOverlapRatio(a, b)).toBeLessThan(0.3);
  });
  it('normaliza acentos', () => {
    const a = 'canción con música y corazón';
    const b = 'cancion con musica y corazon';
    expect(lyricsOverlapRatio(a, b)).toBe(1);
  });
  it('textos cortos (< 4 tokens) → 1', () => {
    expect(lyricsOverlapRatio('hi', 'bye')).toBe(1);
  });
});

describe('plainFromSyncedLines', () => {
  it('extrae texto de líneas LRC', () => {
    const lines = [{ t: 1, text: 'Hello' }, { t: 2, text: 'World' }];
    expect(plainFromSyncedLines(lines)).toBe('Hello\nWorld');
  });
  it('filtra vacíos', () => {
    const lines = [{ t: 1, text: 'A' }, { t: 2, text: '' }, { t: 3, text: 'B' }];
    expect(plainFromSyncedLines(lines)).toBe('A\nB');
  });
  it('input inválido devuelve ""', () => {
    expect(plainFromSyncedLines(null)).toBe('');
    expect(plainFromSyncedLines('not array')).toBe('');
  });
});

describe('tintedVars', () => {
  it('genera variables para hex válido', () => {
    const vars = tintedVars('#10d9a0');
    expect(vars['--bg-0']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--surf-2']).toBeDefined();
  });
  it('devuelve {} para hex inválido', () => {
    expect(tintedVars('not-a-hex')).toEqual({});
    expect(tintedVars(null)).toEqual({});
    expect(tintedVars('#abc')).toEqual({});
  });
});
