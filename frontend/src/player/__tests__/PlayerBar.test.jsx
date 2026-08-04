/**
 * PlayerBar — tests de comportamiento (primera capa de tests de UI).
 * Fija: estado vacío sin crash, render con pista, interacción play/next/prev/seek,
 * y la regresión de carátula (la key del CoverImg cambia con la portada → no
 * queda pegado el fallback al cambiar de pista).
 *
 * Se usa fireEvent (no user-event: no está instalado y no se añaden deps).
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayerBar } from '../PlayerBar.jsx';
import { T, makeTrack, resetStores, seedPlaying, seedCatalog } from '../../__tests__/uiFixtures.js';

describe('PlayerBar', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('sin pista muestra el estado vacío y no crashea', () => {
    render(<PlayerBar T={T} />);
    expect(screen.getByText(/Selecciona una canción para empezar/i)).toBeTruthy();
  });

  it('renderiza título y artista de la pista actual del store', () => {
    seedPlaying();
    render(<PlayerBar T={T} />);
    expect(screen.getByText('Toxicity')).toBeTruthy();
    expect(screen.getByText('System of a Down')).toBeTruthy();
  });

  it('el botón principal llama togglePlay y refleja el estado playing', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const togglePlay = vi.fn();
    render(<PlayerBar T={T} track={track} playing={true} togglePlay={togglePlay} />);
    fireEvent.click(screen.getByLabelText('Pausar'));
    expect(togglePlay).toHaveBeenCalledTimes(1);
  });

  it('con playing=false el botón principal ofrece Reproducir', () => {
    const track = makeTrack();
    seedCatalog([track]);
    render(<PlayerBar T={T} track={track} playing={false} />);
    expect(screen.getByLabelText('Reproducir')).toBeTruthy();
  });

  it('next / prev invocan sus callbacks', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const next = vi.fn(); const prev = vi.fn();
    render(<PlayerBar T={T} track={track} playing={false} next={next} prev={prev} />);
    fireEvent.click(screen.getByLabelText('Siguiente'));
    fireEvent.click(screen.getByLabelText('Anterior'));
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it('el slider de progreso llama seek con la posición pedida', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const seek = vi.fn();
    render(<PlayerBar T={T} track={track} time={10} dur={200} seek={seek} />);
    fireEvent.change(screen.getByLabelText('Progreso'), { target: { value: '50' } });
    expect(seek).toHaveBeenCalledWith(50);
  });

  it('toggleFav y onMenu reciben el id de la pista', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const toggleFav = vi.fn(); const onMenu = vi.fn();
    render(<PlayerBar T={T} track={track} toggleFav={toggleFav} onMenu={onMenu} />);
    fireEvent.click(screen.getByLabelText('Me gusta'));
    fireEvent.click(screen.getByLabelText('Más'));
    expect(toggleFav).toHaveBeenCalledWith('t1');
    expect(onMenu).toHaveBeenCalledWith('t1');
  });

  it('shuffle / repeat alternan el valor actual', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const setShuffle = vi.fn(); const setRepeat = vi.fn();
    render(<PlayerBar T={T} track={track} shuffle={false} repeat={false} setShuffle={setShuffle} setRepeat={setRepeat} />);
    fireEvent.click(screen.getByLabelText('Aleatorio'));
    fireEvent.click(screen.getByLabelText('Repetir'));
    expect(setShuffle).toHaveBeenCalledWith(true);
    expect(setRepeat).toHaveBeenCalledWith(true);
  });

  it('regresión carátula: el <img> cambia de src al cambiar de pista', () => {
    // Bug histórico: si CoverImg no resetea su estado al cambiar src, un fallo
    // previo deja el fallback pegado en las pistas siguientes. PlayerBar fuerza
    // el remount con key = `${id}-${cover.slice(0,40)}`.
    const a = makeTrack({ id: 'a', cover: 'https://cdn.test/aaa=w544-h544' });
    const b = makeTrack({ id: 'b', cover: 'https://cdn.test/bbb=w544-h544' });
    seedCatalog([a, b]);
    const { container, rerender } = render(<PlayerBar T={T} track={a} />);
    const src1 = container.querySelector('img').getAttribute('src');
    rerender(<PlayerBar T={T} track={b} />);
    const src2 = container.querySelector('img').getAttribute('src');
    expect(src1).not.toEqual(src2);
    expect(src2).toContain('bbb');
  });

  it('el botón de cola llama onQueue', () => {
    const track = makeTrack();
    seedCatalog([track]);
    const onQueue = vi.fn();
    render(<PlayerBar T={T} track={track} onQueue={onQueue} />);
    fireEvent.click(screen.getByLabelText('Cola'));
    expect(onQueue).toHaveBeenCalledTimes(1);
  });
});
