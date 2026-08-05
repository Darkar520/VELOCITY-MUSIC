/**
 * WrappedView — tests de COMPORTAMIENTO (no de estructura ni estilos).
 *
 * Cubre lo que el usuario percibe: los agregados que muestra (reproducciones,
 * canciones, minutos), el ranking de artistas y pistas, la navegación de vuelta
 * y el estado vacío.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WrappedView } from '../WrappedView.jsx';
import { useLibraryStore } from '../../store/libraryStore.js';
import { T } from '../../__tests__/uiFixtures.js';

// playStats: mapa id -> { count, title, artist, cover, durationSeconds }
const STATS = {
  s1: { count: 10, title: 'Toxicity', artist: 'SOAD', cover: '', durationSeconds: 180 },
  s2: { count: 4, title: 'Aerials', artist: 'SOAD', cover: '', durationSeconds: 240 },
  s3: { count: 7, title: 'Duality', artist: 'Slipknot', cover: '', durationSeconds: 300 },
};

function setup(props = {}) {
  const play = vi.fn();
  const setView = vi.fn();
  const utils = render(
    <WrappedView T={T} setView={setView} play={play} playStats={STATS} {...props} />,
  );
  return { play, setView, ...utils };
}

describe('WrappedView', () => {
  beforeEach(() => { useLibraryStore.getState().reset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renderiza sin crashear y muestra la portada del Wrapped', () => {
    setup();
    expect(screen.getByText('Wrapped')).toBeTruthy();
  });

  // El valor de cada métrica se lee junto a SU etiqueta: buscar el número
  // suelto es ambiguo (coincide con los puestos del ranking).
  const metrica = (etiqueta) => screen.getByText(etiqueta).previousElementSibling?.textContent;

  it('suma el total de reproducciones de todas las pistas', () => {
    setup();
    expect(metrica('Reproducciones')).toBe('21'); // 10 + 4 + 7
  });

  it('cuenta cuántas canciones distintas se han escuchado', () => {
    setup();
    expect(metrica('Canciones')).toBe('3');
  });

  it('calcula los minutos escuchados a partir de duración por reproducciones', () => {
    setup();
    // (180*10 + 240*4 + 300*7) / 60 = 81
    expect(metrica('Minutos')).toBe('81');
  });

  it('sin minutos computables muestra un guion en vez de 0', () => {
    setup({ playStats: { z1: { count: 2, title: 'X', artist: 'Y', durationSeconds: 0 } } });
    expect(metrica('Minutos')).toBe('—');
  });

  it('ordena los artistas top por número de reproducciones', () => {
    setup();
    // SOAD = 14 reproducciones, Slipknot = 7 → SOAD primero.
    expect(screen.getByText('14 reproducciones')).toBeTruthy();
    expect(screen.getByText('7 reproducciones')).toBeTruthy();
  });

  it('muestra las canciones top con su número de reproducciones', () => {
    setup();
    expect(screen.getByText('Toxicity')).toBeTruthy();
    expect(screen.getByText('10x')).toBeTruthy();
  });

  it('al pulsar una canción top llama a play con esa pista', () => {
    const { play } = setup();
    fireEvent.click(screen.getByText('Toxicity'));
    expect(play).toHaveBeenCalled();
    expect(play.mock.calls[0][0].title).toBe('Toxicity');
  });

  it('el botón Atras vuelve a la vista anterior', () => {
    const { setView } = setup();
    fireEvent.click(screen.getByText(/Atras/i));
    expect(setView).toHaveBeenCalledWith(null);
  });

  it('sin estadísticas muestra el estado vacío y no lista pistas', () => {
    setup({ playStats: {} });
    expect(screen.getByText(/aqui veras tu Wrapped/i)).toBeTruthy();
    expect(screen.queryByText('Toxicity')).toBeNull();
  });

  it('tolera playStats ausente sin lanzar', () => {
    expect(() => setup({ playStats: undefined })).not.toThrow();
  });
});
