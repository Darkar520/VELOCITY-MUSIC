/**
 * CoverImg — regresión de carátulas (bug histórico documentado en AGENTS.md).
 *
 * Contrato: al cambiar `src`, CoverImg debe RESETEAR su estado interno (step).
 * Sin ese reset, un fallo previo deja el fallback pegado y todas las pistas
 * siguientes muestran el placeholder aunque tengan portada válida.
 */
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CoverImg } from '../components.jsx';
import { FALLBACK_COVER } from '../constants.js';

describe('CoverImg', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

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

  it('retries the same cover after connectivity returns instead of keeping a permanent fallback',()=>{
    const src='https://cdn.test/temporary.jpg';
    const {container}=render(<CoverImg src={src}/>);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img').getAttribute('src')).toBe(FALLBACK_COVER);
    fireEvent(window,new Event('online'));
    expect(container.querySelector('img').getAttribute('src')).toBe(src);
  });

  it('automatically retries with backoff and cancels pending recovery on unmount', () => {
    vi.useFakeTimers();
    const src = 'https://cdn.test/temporary.jpg';
    const { container, unmount } = render(<CoverImg src={src} />);
    const img = () => container.querySelector('img');
    fireEvent.error(img());
    act(() => vi.advanceTimersByTime(1500));
    expect(img().getAttribute('src')).toBe(src);
    fireEvent.error(img());
    act(() => vi.advanceTimersByTime(6000));
    expect(img().getAttribute('src')).toBe(src);
    fireEvent.error(img());
    act(() => vi.advanceTimersByTime(23999));
    expect(img().getAttribute('src')).toBe(FALLBACK_COVER);
    act(() => vi.advanceTimersByTime(1));
    expect(img().getAttribute('src')).toBe(src);
    fireEvent.error(img());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('suspends recovery while hidden and retries when returning to the app', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { container } = render(<CoverImg src="https://cdn.test/resume.jpg" />);
    fireEvent.error(container.querySelector('img'));
    expect(vi.getTimerCount()).toBe(0);
    fireEvent(window, new Event('online'));
    expect(container.querySelector('img').getAttribute('src')).toBe(FALLBACK_COVER);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(container.querySelector('img').getAttribute('src')).toContain('resume.jpg');
  });
});
