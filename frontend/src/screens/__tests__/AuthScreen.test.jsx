/**
 * AuthScreen — tests de COMPORTAMIENTO del camino crítico de entrada.
 *
 * Cubre: login, registro (que además inicia sesión), modo invitado, propagación
 * del error del backend al usuario, y el acceso offline cuando el backend no
 * responde pero ya hay sesión previa.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  authConfig: vi.fn(async () => ({ googleClientId: '' })),
  pingBackend: vi.fn(async () => true),
  login: vi.fn(async () => ({ displayName: 'Tester' })),
  register: vi.fn(async () => ({ displayName: 'Nuevo' })),
  guestLogin: vi.fn(async () => ({ email: 'invitado@velocity.guest', displayName: 'Invitado' })),
}));

const authedMock = vi.hoisted(() => ({ value: false }));

vi.mock('../../api.js', () => ({
  api: apiMock,
  isAuthed: () => authedMock.value,
  setOnUnauthorized: () => {},
}));

import { AuthScreen } from '../AuthScreen.jsx';
import { T } from '../../__tests__/uiFixtures.js';

const fill = (placeholder, value) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

function setup() {
  const onAuthed = vi.fn();
  const utils = render(<AuthScreen onAuthed={onAuthed} T={T} />);
  return { onAuthed, ...utils };
}

describe('AuthScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authedMock.value = false;
    apiMock.authConfig.mockResolvedValue({ googleClientId: '' });
    apiMock.pingBackend.mockResolvedValue(true);
    apiMock.login.mockResolvedValue({ displayName: 'Tester' });
    apiMock.register.mockResolvedValue({ displayName: 'Nuevo' });
    localStorage.clear();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renderiza el formulario de inicio de sesión sin crashear', () => {
    setup();
    expect(screen.getByPlaceholderText('Correo electrónico')).toBeTruthy();
    expect(screen.getByPlaceholderText('Contraseña')).toBeTruthy();
  });

  it('inicia sesión y avisa al padre con email y nombre', async () => {
    const { onAuthed } = setup();
    fill('Correo electrónico', 'a@b.c');
    fill('Contraseña', 'Secreta-123456');
    fireEvent.click(screen.getByText('Entrar'));
    await waitFor(() => expect(apiMock.login).toHaveBeenCalledWith('a@b.c', 'Secreta-123456'));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith('a@b.c', 'Tester'));
  });

  it('muestra al usuario el error que devuelve el backend', async () => {
    apiMock.login.mockRejectedValue(new Error('Credenciales inválidas.'));
    const { onAuthed } = setup();
    fill('Correo electrónico', 'a@b.c');
    fill('Contraseña', 'mala');
    fireEvent.click(screen.getByText('Entrar'));
    await waitFor(() => expect(screen.getByText('Credenciales inválidas.')).toBeTruthy());
    expect(onAuthed).not.toHaveBeenCalled();
  });

  it('en registro pide el nombre y tras registrar inicia sesión', async () => {
    const { onAuthed } = setup();
    fireEvent.click(screen.getByText('Regístrate'));
    fill('¿Cómo te llamas?', 'Ana');
    fill('Correo electrónico', 'ana@b.c');
    fill('Contraseña', 'Secreta-123456');
    fireEvent.click(screen.getByText('Registrarme'));
    await waitFor(() => expect(apiMock.register).toHaveBeenCalled());
    // Registrarse no debe dejar al usuario fuera: se inicia sesión acto seguido.
    await waitFor(() => expect(apiMock.login).toHaveBeenCalled());
    await waitFor(() => expect(onAuthed).toHaveBeenCalled());
  });

  it('el modo invitado entra sin credenciales', async () => {
    const { onAuthed } = setup();
    fireEvent.click(screen.getByText(/Entrar como invitado/i));
    await waitFor(() => expect(apiMock.guestLogin).toHaveBeenCalled());
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith('invitado@velocity.guest', 'Invitado'));
  });

  it('si el modo invitado falla lo dice y no entra', async () => {
    apiMock.guestLogin.mockRejectedValue(new Error('No se pudo entrar como invitado.'));
    const { onAuthed } = setup();
    fireEvent.click(screen.getByText(/Entrar como invitado/i));
    await waitFor(() => expect(screen.getByText('No se pudo entrar como invitado.')).toBeTruthy());
    expect(onAuthed).not.toHaveBeenCalled();
  });

  it('con backend caído y sesión previa ofrece entrar a la biblioteca offline', async () => {
    apiMock.pingBackend.mockResolvedValue(false);
    authedMock.value = true;
    localStorage.setItem('velocity.email', 'a@b.c');
    localStorage.setItem('velocity.name', 'Tester');
    const { onAuthed } = setup();
    const btn = await screen.findByText('Entrar a mi biblioteca');
    fireEvent.click(btn);
    expect(onAuthed).toHaveBeenCalledWith('a@b.c', 'Tester');
  });

  it('con backend caído y sin sesión previa no ofrece acceso offline', async () => {
    apiMock.pingBackend.mockResolvedValue(false);
    authedMock.value = false;
    setup();
    await waitFor(() => expect(apiMock.pingBackend).toHaveBeenCalled());
    expect(screen.queryByText('Entrar a mi biblioteca')).toBeNull();
  });

  it('no crashea si authConfig falla (sin botón de Google)', async () => {
    apiMock.authConfig.mockRejectedValue(new Error('boom'));
    setup();
    await waitFor(() => expect(apiMock.authConfig).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Correo electrónico')).toBeTruthy();
  });
});
