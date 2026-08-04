/**
 * SearchBar — tests de comportamiento del input de filtrado reutilizable.
 * Fija: propagación del valor, botón de limpiar sólo con texto, placeholder.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SearchBar } from '../SearchBar.jsx';
import { T } from '../../__tests__/uiFixtures.js';

describe('SearchBar', () => {
  afterEach(cleanup);

  it('renderiza el placeholder por defecto', () => {
    render(<SearchBar value="" onChange={() => {}} T={T} />);
    expect(screen.getByPlaceholderText('Buscar…')).toBeTruthy();
  });

  it('acepta un placeholder propio', () => {
    render(<SearchBar value="" onChange={() => {}} placeholder="Buscar en este álbum…" T={T} />);
    expect(screen.getByPlaceholderText('Buscar en este álbum…')).toBeTruthy();
  });

  it('escribir propaga el valor por onChange', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} T={T} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar…'), { target: { value: 'toxi' } });
    expect(onChange).toHaveBeenCalledWith('toxi');
  });

  it('sin texto no hay botón de limpiar', () => {
    const { container } = render(<SearchBar value="" onChange={() => {}} T={T} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('con texto aparece el botón de limpiar y vacía el valor', () => {
    const onChange = vi.fn();
    const { container } = render(<SearchBar value="toxi" onChange={onChange} T={T} />);
    const btn = container.querySelector('button');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('el input refleja el valor controlado', () => {
    render(<SearchBar value="aerials" onChange={() => {}} T={T} />);
    expect(screen.getByPlaceholderText('Buscar…').value).toBe('aerials');
  });
});
