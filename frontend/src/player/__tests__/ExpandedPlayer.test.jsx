/**
 * ExpandedPlayer — tests de comportamiento del reproductor a pantalla completa.
 *
 * Notas de comportamiento REAL que estos tests fijan (no se cambian):
 *  - Cerrado NO desmonta: el panel queda montado con opacity 0 y
 *    pointerEvents:'none' (la transición CSS necesita el nodo en el árbol).
 *  - Los controles de la barra superior (Minimizar / Cola) son del layout
 *    DESKTOP; en móvil el botón equivalente es "Cerrar".
 *
 * api/offline mockeados: el render base no debe tocar la red.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    lyrics: vi.fn(async () => ({ synced: null, plain: '' })),
    translateLyrics: vi.fn(),
    streamUrl: () => 'mock://stream',
  },
}));
vi.mock('../../offline.js', () => ({
  getLyrics: vi.fn(async () => null),
  saveLyrics: vi.fn(async () => {}),
  getBlob: vi.fn(async () => null),
}));

import { ExpandedPlayer } from '../ExpandedPlayer.jsx';
import { api } from '../../api.js';
import * as offline from '../../offline.js';
import { T, makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

function setup(over = {}) {
  const track = over.track === undefined ? makeTrack() : over.track;
  if (track) seedCatalog([track]);
  const props = {
    open: true, onClose: vi.fn(), track, playing: false,
    togglePlay: vi.fn(), next: vi.fn(), prev: vi.fn(),
    time: 30, dur: 200, seek: vi.fn(),
    vol: 1, setVol: vi.fn(), shuffle: false, setShuffle: vi.fn(),
    repeat: false, setRepeat: vi.fn(), faved: false, toggleFav: vi.fn(),
    T, quality: 'high', glow: 70, compact: false, desktop: true,
    onAdd: vi.fn(), onMenu: vi.fn(), loadingAudio: false, onQueue: vi.fn(),
    outputs: [], sinkId: '', setOutput: vi.fn(),
    lyricOffset: 0, setLyricOffset: vi.fn(),
    audioRef: { current: null },
    ...over,
  };
  const r = render(<ExpandedPlayer {...props} />);
  return { ...r, props };
}

describe('ExpandedPlayer', () => {
  beforeEach(() => { resetStores(); localStorage.removeItem('velocity.lyricsTranslation'); Element.prototype.scrollTo = vi.fn(); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it.each([false, true])('active original is white, translation keeps its accent and sync is outside scrolling lyrics (desktop=%s)', async desktop => {
    const original = ['Original first sentence', 'Original second sentence', 'Original third sentence', 'Original fourth sentence'];
    api.lyrics.mockResolvedValueOnce({ synced: original.map((line,i)=>`[00:0${i+1}.00]${line}`).join('\n') });
    api.translateLyrics.mockResolvedValueOnce({ status:'ready', engineVersion:'argos-context-v5', targetLanguage:'es', lines:original.map((_,i)=>`Traducción ${i+1}`) });
    const { container, props } = setup({ desktop, time:.5, lyricOffset:1 });
    if (!desktop) fireEvent.click(screen.getByRole('button', { name:'Letra', exact:true }));
    fireEvent.click(screen.getByRole('button', { name:'Traducción desactivada' }));
    const translated = await screen.findByText('Traducción 1');
    const active = container.querySelector('[data-li="0"]');
    expect(active.style.color).toBe('rgb(255, 255, 255)');
    expect(translated.style.color).not.toBe(active.style.color);
    const group = screen.getByRole('group', { name:'Sincronía de la letra' });
    const scrollingLyrics = active.parentElement;
    expect(scrollingLyrics.contains(group)).toBe(false);
    expect(group.compareDocumentPosition(scrollingLyrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name:'Adelantar letra' }));
    expect(props.setLyricOffset.mock.calls.at(-1)[0](1)).toBe(1.5);
    fireEvent.click(screen.getByRole('button', { name:'Restablecer sincronía' }));
    expect(props.setLyricOffset).toHaveBeenLastCalledWith(0);
  });

  it('translation mode renders each translation under its synchronized original and saves it', async () => {
    api.lyrics.mockResolvedValueOnce({ synced: '[00:01.00]A first original sentence\n[00:02.00]A second original sentence', source: 'test' });
    api.translateLyrics.mockResolvedValueOnce({ status: 'ready', engineVersion:'argos-context-v5', targetLanguage: 'es', lines: ['Primera frase traducida', 'Segunda frase traducida'] });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Traducción desactivada' }));
    const translated = await screen.findByText('Primera frase traducida');
    expect(translated.parentElement.textContent).toContain('A first original sentence');
    expect(translated.getAttribute('lang')).toBe('es');
    expect(offline.saveLyrics).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ translation: expect.objectContaining({ status: 'ready' }) }));
  });

  it('a stored aligned translation renders without a translation network request', async () => {
    const lines = ['First original', 'Second original', 'Third original', 'Fourth original'];
    const record = { synced: lines.map((line,i) => `[00:0${i+1}.00]${line}`).join('\n'), translation: { status: 'ready', engineVersion:'argos-context-v5', sourceText: JSON.stringify(lines), targetLanguage: 'es', lines: ['Primera', 'Segunda', 'Tercera', 'Cuarta'] } };
    offline.getLyrics.mockResolvedValue(record);
    try {
      setup();
      const toggle = screen.getByRole('button', { name: /Traducción/ });
      if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
      expect(await screen.findByText('Primera')).toBeTruthy();
      expect(api.translateLyrics).not.toHaveBeenCalled();
    } finally { offline.getLyrics.mockResolvedValue(null); }
  });

  it('paused mobile glow responds to both zero and maximum intensity', () => {
    const { container, rerender, props } = setup({ desktop: false, glow: 0, playing: false });
    expect(container.querySelector('.breathe').style.opacity).toBe('0');
    rerender(<ExpandedPlayer {...props} glow={100} />);
    expect(Number(container.querySelector('.breathe').style.opacity)).toBeGreaterThan(.7);
  });

  it('sin pista no renderiza nada (no crashea)', () => {
    const { container } = setup({ track: null });
    expect(container.firstChild).toBeNull();
  });

  it('cerrado queda montado pero inerte (opacity 0, sin captura de clics)', () => {
    const { container } = setup({ open: false });
    const root = container.firstChild;
    expect(root.style.opacity).toBe('0');
    expect(root.style.pointerEvents).toBe('none');
  });

  it('abierto es interactivo (opacity 1)', () => {
    const { container } = setup({ open: true });
    const root = container.firstChild;
    expect(root.style.opacity).toBe('1');
    expect(root.style.pointerEvents).toBe('auto');
  });

  it('desktop: halo ambiental perceptible incluso en pausa (regresión fondo plano)', () => {
    // Regresión f8dfdcc: el raíz desktop quedó en background plano
    // (var(--bg-0)) y el halo div bajó a alpha .18 con opacity .3 en pausa →
    // alpha efectiva ≈ .054, imperceptible. El wash radial vuelve al raíz y el
    // halo mantiene opacidad efectiva sobre el umbral de percepción en pausa,
    // sin capturar clics y fuera del grid (sin bordes de columna).
    const { container } = setup({ desktop: true, playing: false });
    const root = container.firstChild;
    const style = root.getAttribute('style') || '';
    expect(style).toContain('radial-gradient');
    const alphaMatch = style.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*(0?\.\d+)\)/);
    expect(alphaMatch).toBeTruthy();
    expect(parseFloat(alphaMatch[1])).toBeGreaterThanOrEqual(0.3);

    const halo = root.children[0];
    expect(halo.getAttribute('aria-hidden')).toBe('true');
    expect(parseFloat(halo.style.opacity)).toBeGreaterThanOrEqual(0.5);
    expect(halo.style.pointerEvents).toBe('none');
  });

  it('muestra el título y el artista de la pista', async () => {
    setup();
    // "Toxicity" es a la vez título y álbum → hay más de una coincidencia.
    await waitFor(() => expect(screen.getAllByText('Toxicity').length).toBeGreaterThan(0));
    expect(screen.getAllByText('System of a Down').length).toBeGreaterThan(0);
  });

  it('el botón principal llama togglePlay', () => {
    const { props } = setup({ playing: false });
    fireEvent.click(screen.getByLabelText('Reproducir'));
    expect(props.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('con playing=true el botón principal ofrece Pausar', () => {
    setup({ playing: true });
    expect(screen.getByLabelText('Pausar')).toBeTruthy();
  });

  it('next / prev invocan sus callbacks', () => {
    const { props } = setup();
    fireEvent.click(screen.getByLabelText('Siguiente'));
    fireEvent.click(screen.getByLabelText('Anterior'));
    expect(props.next).toHaveBeenCalledTimes(1);
    expect(props.prev).toHaveBeenCalledTimes(1);
  });

  it('el slider de progreso llama seek', () => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText('Progreso'), { target: { value: '99' } });
    expect(props.seek).toHaveBeenCalledWith(99);
  });

  it('Minimizar cierra el player (layout desktop)', () => {
    const { props } = setup({ desktop: true });
    fireEvent.click(screen.getByLabelText('Minimizar'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('en móvil el botón Cerrar cierra el player', () => {
    const { props } = setup({ desktop: false, compact: true });
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Me gusta delega en toggleFav con el id de la pista', () => {
    const { props } = setup();
    fireEvent.click(screen.getByLabelText('Me gusta'));
    expect(props.toggleFav).toHaveBeenCalledWith('t1');
  });

  it('la cola de reproducción se abre con onQueue', () => {
    const { props } = setup();
    fireEvent.click(screen.getAllByLabelText('Cola de reproducción')[0]);
    expect(props.onQueue).toHaveBeenCalledTimes(1);
  });

  it('Añadir y Más delegan con el id de la pista', () => {
    const { props } = setup();
    fireEvent.click(screen.getByLabelText('Añadir'));
    fireEvent.click(screen.getByLabelText('Más'));
    expect(props.onAdd).toHaveBeenCalledWith('t1');
    expect(props.onMenu).toHaveBeenCalledWith('t1');
  });

  it('sin letra disponible el componente sigue en pie (estado none)', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Toxicity').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('Reproducir')).toBeTruthy();
  });
});
