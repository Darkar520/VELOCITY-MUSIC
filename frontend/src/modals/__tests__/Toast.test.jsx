/**
 * Toast — tests de comportamiento del aviso flotante.
 * Fija: sin mensaje no renderiza (no ocupa espacio ni intercepta clics).
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Toast } from '../Toast.jsx';
import { T } from '../../__tests__/uiFixtures.js';

describe('Toast', () => {
  afterEach(cleanup);

  it('sin mensaje no renderiza nada', () => {
    const { container } = render(<Toast msg="" T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('con msg null tampoco renderiza (no crashea)', () => {
    const { container } = render(<Toast msg={null} T={T} />);
    expect(container.firstChild).toBeNull();
  });

  it('muestra el mensaje recibido', () => {
    render(<Toast msg="Se reproducirá a continuación" T={T} />);
    expect(screen.getByText(/Se reproducirá a continuación/)).toBeTruthy();
  });
});
