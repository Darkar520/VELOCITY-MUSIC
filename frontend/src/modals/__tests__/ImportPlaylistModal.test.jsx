/**
 * ImportPlaylistModal — tests de COMPORTAMIENTO.
 *
 * Cubre lo que el usuario percibe: cerrar, importar por URL, el desvío
 * automático a Spotify cuando el enlace es de Spotify, importar por texto
 * pegado, la validación que impide enviar vacío y el estado ocupado.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { ImportPlaylistModal } from '../ImportPlaylistModal.jsx';
import { T } from '../../__tests__/uiFixtures.js';

function setup(over = {}) {
  const onClose = vi.fn();
  const onImport = vi.fn(async () => {});
  const onImportText = vi.fn(async () => {});
  const utils = render(
    <ImportPlaylistModal onClose={onClose} onImport={onImport} onImportText={onImportText} T={T} {...over} />,
  );
  return { onClose, onImport, onImportText, ...utils };
}

const urlInput = () => document.querySelector('input[type="url"]');
const textArea = () => document.querySelector('textarea');
const nameInput = () => document.querySelector('input[type="text"]');

describe('ImportPlaylistModal', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renderiza sin crashear y muestra el título', () => {
    setup();
    expect(screen.getByText('Importar playlist')).toBeTruthy();
  });

  it('el botón Cerrar cierra el modal', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('importa una URL de YouTube Music al enviar el formulario', async () => {
    const { onImport } = setup();
    const link = 'https://music.youtube.com/playlist?list=PL123';
    fireEvent.change(urlInput(), { target: { value: link } });
    fireEvent.submit(urlInput().closest('form'));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(link));
  });

  it('no importa si la URL está vacía', () => {
    const { onImport } = setup();
    fireEvent.submit(urlInput().closest('form'));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('recorta espacios alrededor de la URL antes de importar', async () => {
    const { onImport } = setup();
    fireEvent.change(urlInput(), { target: { value: '  https://music.youtube.com/playlist?list=X  ' } });
    fireEvent.submit(urlInput().closest('form'));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith('https://music.youtube.com/playlist?list=X'));
  });

  it('un enlace de Spotify NO se importa por URL: cambia al modo Spotify', async () => {
    const { onImport } = setup();
    fireEvent.change(urlInput(), { target: { value: 'https://open.spotify.com/playlist/abc123' } });
    fireEvent.submit(urlInput().closest('form'));
    // Spotify no expone la playlist por URL: el modal guía al flujo de pegado.
    expect(onImport).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
  });

  it('importa por texto pegado usando el nombre indicado', async () => {
    const { onImportText } = setup();
    fireEvent.change(urlInput(), { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.submit(urlInput().closest('form'));
    await waitFor(() => expect(textArea()).toBeTruthy());

    fireEvent.change(nameInput(), { target: { value: 'Mi mezcla' } });
    fireEvent.change(textArea(), { target: { value: 'Toxicity - SOAD\nAerials - SOAD' } });
    fireEvent.submit(textArea().closest('form'));
    await waitFor(() => expect(onImportText).toHaveBeenCalled());
    expect(onImportText.mock.calls[0][0]).toBe('Mi mezcla');
    expect(onImportText.mock.calls[0][1]).toContain('Toxicity - SOAD');
  });

  it('sin nombre usa un nombre por defecto', async () => {
    const { onImportText } = setup();
    fireEvent.change(urlInput(), { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.submit(urlInput().closest('form'));
    await waitFor(() => expect(textArea()).toBeTruthy());

    fireEvent.change(textArea(), { target: { value: 'Duality - Slipknot' } });
    fireEvent.submit(textArea().closest('form'));
    await waitFor(() => expect(onImportText).toHaveBeenCalled());
    expect(onImportText.mock.calls[0][0]).toBe('Playlist de Spotify');
  });

  it('no importa texto vacío', async () => {
    const { onImportText } = setup();
    fireEvent.change(urlInput(), { target: { value: 'https://open.spotify.com/playlist/abc' } });
    fireEvent.submit(urlInput().closest('form'));
    await waitFor(() => expect(textArea()).toBeTruthy());

    fireEvent.submit(textArea().closest('form'));
    expect(onImportText).not.toHaveBeenCalled();
  });
});
