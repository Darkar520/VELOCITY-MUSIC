/**
 * CoverImg — regresión de carátulas (bug histórico documentado en AGENTS.md).
 *
 * Contrato: al cambiar `src`, CoverImg debe RESETEAR su estado interno (step).
 * Sin ese reset, un fallo previo deja el fallback pegado y todas las pistas
 * siguientes muestran el placeholder aunque tengan portada válida.
 */
import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { CoverImg } from '../components.jsx';
import { FALLBACK_COVER } from '../constants.js';

describe('CoverImg', () => {
  afterEach(cleanup);

  it('sin src usa directamente el fallback', () => {
    const { container } = render(<CoverImg src="" alt="" />);
    expect(container.querySelector('img').getAttribute('src')).toBe(FALLBACK_COVER);
  });

  it('regresión: tras un fallo, cambiar de src reintenta (no queda pegado el fallback)', () => {
    const bad = 'https://cdn.test/roto=w544-h544';
    const good = 'https://cdn.test/bueno=w544-h544';
    const { container, rerender } = render(<CoverImg src={bad} alt="" size={128} />);
    const img = () => container.querySelector('img');

    // Degradar hasta el fallback: paso 0 → 1 (original) → 2 (fallback).
    fireEvent.error(img());
    fireEvent.error(img());
    expect(img().getAttribute('src')).toBe(FALLBACK_COVER);

    // Nueva pista con portada válida → debe volver a intentar la URL real.
    rerender(<CoverImg src={good} alt="" size={128} />);
    const after = img().getAttribute('src');
    expect(after).not.toBe(FALLBACK_COVER);
    expect(after).toContain('bueno');
  });

  it('el fallo del hiRes cae al src original antes del fallback', () => {
    // hiResCover rutea googleusercontent por el proxy /img → 1er src != original.
    const src = 'https://lh3.googleusercontent.com/x=w544-h544';
    const { container } = render(<CoverImg src={src} alt="" size={128} />);
    const img = () => container.querySelector('img');
    expect(img().getAttribute('src')).toContain('/img?u=');
    fireEvent.error(img());
    // Paso 1: la URL original, todavía no el fallback.
    expect(img().getAttribute('src')).toBe(src);
    fireEvent.error(img());
    expect(img().getAttribute('src')).toBe(FALLBACK_COVER);
  });

  it('onLoad marca la imagen como cargada (quita el skeleton)', () => {
    const { container } = render(<CoverImg src="https://cdn.test/a.jpg" alt="" />);
    const img = container.querySelector('img');
    expect(img.style.opacity).toBe('0');
    fireEvent.load(img);
    expect(img.style.opacity).toBe('1');
  });
});
