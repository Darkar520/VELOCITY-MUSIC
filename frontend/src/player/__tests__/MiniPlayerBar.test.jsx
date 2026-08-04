/**
 * MiniPlayerBar — tests de comportamiento (barra móvil).
 * Fija: sin pista no renderiza nada, play/pause detiene la propagación (no abre
 * el expandido), el botón de menú apunta a la pista y la carátula nunca queda
 * invisible en reposo (regresión de opacidad del swipe).
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MiniPlayerBar } from '../MiniPlayerBar.jsx';
import { T, makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

describe('MiniPlayerBar', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('sin pista no renderiza nada (no crashea)', () => {
    const { container } = render(<MiniPlayerBar T={T} setExpanded={() => {}} setMenuTarget={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza título y artista de la pista', () => {
    const track = makeTrack();
    seedCatalog([track]);
    render(<MiniPlayerBar T={T} track={track} pct={20} setExpanded={() => {}} setMenuTarget={() => {}} />);
    expect(screen.getByText('Toxicity')).toBeTruthy();
    expect(screen.getByText('System of a Down')).toBeTruthy();
  });

  it('al pulsar la barra se abre el reproductor expandido', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const setExpanded = vi.fn();
    render(<MiniPlayerBar T={T} track={track} pct={0} setExpanded={setExpanded} setMenuTarget={() => {}} />);
    fireEvent.click(screen.getByText('Toxicity'));
    expect(setExpanded).toHaveBeenCalledWith(true);
  });

  it('play/pause llama togglePlay y NO abre el expandido (stopPropagation)', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const setExpanded = vi.fn(); const togglePlay = vi.fn();
    render(<MiniPlayerBar T={T} track={track} playing={false} togglePlay={togglePlay} pct={0} setExpanded={setExpanded} setMenuTarget={() => {}} />);
    fireEvent.click(screen.getByLabelText('Reproducir'));
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(setExpanded).not.toHaveBeenCalled();
  });

  it('el botón Más fija el menú en la pista y no abre el expandido', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const setExpanded = vi.fn(); const setMenuTarget = vi.fn();
    render(<MiniPlayerBar T={T} track={track} pct={0} setExpanded={setExpanded} setMenuTarget={setMenuTarget} />);
    fireEvent.click(screen.getByLabelText('Más'));
    expect(setMenuTarget).toHaveBeenCalledWith('t1');
    expect(setExpanded).not.toHaveBeenCalled();
  });

  it('regresión visual: en reposo la carátula tiene opacidad 1 (no invisible)', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const { container } = render(
      <MiniPlayerBar T={T} track={track} pct={0} setExpanded={() => {}} setMenuTarget={() => {}} />,
    );
    const img = container.querySelector('img');
    const wrapper = img.closest('div[style*="opacity"]');
    expect(wrapper.style.opacity).toBe('1');
  });

  it('sin título usa el guion como placeholder (estado degradado sin crash)', () => {
    const track = makeTrack({ title: '', artist: '' });
    seedCatalog([track]);
    render(<MiniPlayerBar T={T} track={track} pct={0} setExpanded={() => {}} setMenuTarget={() => {}} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});
