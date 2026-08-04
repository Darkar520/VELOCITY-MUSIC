/**
 * QueuePanel — tests de comportamiento del panel de cola.
 * Fija: cerrado no renderiza, cola vacía muestra el estado vacío, lista las
 * pistas del store, reordena y quita por ÍNDICE (contrato del store), y la
 * pista actual no ofrece el botón de quitar.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueuePanel } from '../QueuePanel.jsx';
import { usePlayerStore } from '../../store/playerStore.js';
import { T, makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

function seedQueue() {
  const a = makeTrack({ id: 'a', title: 'Aerials' });
  const b = makeTrack({ id: 'b', title: 'Chop Suey' });
  const c = makeTrack({ id: 'c', title: 'Spiders' });
  seedCatalog([a, b, c]);
  usePlayerStore.setState({ track: a, queue: ['a', 'b', 'c'], playing: true });
  return { a, b, c };
}

describe('QueuePanel', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('cerrado no renderiza nada', () => {
    seedQueue();
    const { container } = render(<QueuePanel open={false} onClose={() => {}} play={() => {}} T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('cola vacía muestra el estado vacío sin crashear', () => {
    render(<QueuePanel open={true} onClose={() => {}} play={() => {}} T={T} />);
    expect(screen.getByText(/La cola está vacía/i)).toBeTruthy();
  });

  it('lista las pistas de la cola del store', () => {
    seedQueue();
    render(<QueuePanel open={true} onClose={() => {}} play={() => {}} T={T} />);
    expect(screen.getByText(/Aerials/)).toBeTruthy();
    expect(screen.getByText('Chop Suey')).toBeTruthy();
    expect(screen.getByText('Spiders')).toBeTruthy();
  });

  it('marca la pista actual con el indicador ▶', () => {
    seedQueue();
    render(<QueuePanel open={true} onClose={() => {}} play={() => {}} T={T} />);
    expect(screen.getByText(/Aerials · ▶/)).toBeTruthy();
  });

  it('al pulsar una pista llama play con la pista y los ids de la cola', () => {
    const { b } = seedQueue();
    const play = vi.fn();
    render(<QueuePanel open={true} onClose={() => {}} play={play} T={T} />);
    fireEvent.click(screen.getByText('Chop Suey'));
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ id: b.id }),
      ['a', 'b', 'c'],
    );
  });

  it('quitar de la cola elimina por índice (contrato del store)', () => {
    seedQueue();
    render(<QueuePanel open={true} onClose={() => {}} play={() => {}} T={T} />);
    // La pista actual (índice 0) no ofrece "Quitar": el primer botón es el de 'b'.
    const removeButtons = screen.getAllByLabelText('Quitar');
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(usePlayerStore.getState().queue).toEqual(['a', 'c']);
  });

  it('la pista en reproducción no se puede quitar de la cola', () => {
    seedQueue();
    render(<QueuePanel open={true} onClose={() => {}} play={() => {}} T={T} />);
    // 3 pistas, sólo 2 botones de quitar → la actual está protegida.
    expect(screen.getAllByLabelText('Quitar')).toHaveLength(2);
  });

  it('las flechas reordenan la cola en el store', () => {
    seedQueue();
    render(<QueuePanel open={true} onClose={() => {}} play={() => {}} T={T} />);
    // "Subir" de la segunda pista (índice 1) la mueve al índice 0.
    fireEvent.click(screen.getAllByLabelText('Subir')[1]);
    expect(usePlayerStore.getState().queue).toEqual(['b', 'a', 'c']);
  });

  it('el botón Cerrar llama onClose', () => {
    seedQueue();
    const onClose = vi.fn();
    render(<QueuePanel open={true} onClose={onClose} play={() => {}} T={T} />);
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
