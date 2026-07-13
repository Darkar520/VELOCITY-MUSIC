/**
 * Tests del playerStore — cobertura mínima exigida por el prompt:
 *   play, pause, next, prev, queue push
 *
 * Nota: next/prev no existen como acciones del store porque la política
 * de "cuál es la siguiente pista" vive en App.jsx (la cola). El store
 * expone playTrack(track) y la cola. Estos tests cubren el equivalente:
 * cambiar la pista actual (simula next/prev) y verificar transiciones.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '../playerStore.js';

function reset() {
  usePlayerStore.setState({
    track: null,
    playing: false,
    time: 0,
    duration: 0,
    volume: 0.85,
    expanded: false,
    shuffle: false,
    repeat: false,
    queue: [],
    loadingAudio: false,
    playSrc: null,
    outputs: [],
    sinkId: '',
    remotePlaying: null,
    mediaInterrupted: false,
    downloaded: new Set(),
    downloading: new Set(),
  });
  // Resetear estado interno de la máquina vía hydrate con null.
  usePlayerStore.getState().hydrate({ trackId: null, position: 0, urlFresh: false });
  // Limpiar effectHandler para tests que dependen de pending effects.
  usePlayerStore.getState().setEffectHandler(null);
}

const T1 = { id: 't1', title: 'Song A', artist: 'X' };
const T2 = { id: 't2', title: 'Song B', artist: 'Y' };

describe('playerStore', () => {
  beforeEach(reset);

  it('playTrack setea la pista y marca playing=true con intent play', () => {
    const store = usePlayerStore.getState();
    store.playTrack(T1, { intent: 'play' });
    const s = usePlayerStore.getState();
    expect(s.track).toEqual(T1);
    expect(s.playing).toBe(true);
    expect(s.loadingAudio).toBe(true);
    // machine: srcStatus 'none' porque no hay stream aún
    expect(s._getMachineState().trackId).toBe('t1');
    expect(s._getMachineState().intent).toBe('play');
  });

  it('pause setea playing=false y limpia loadingAudio', () => {
    const store = usePlayerStore.getState();
    store.playTrack(T1, { intent: 'play' });
    store.pause();
    const s = usePlayerStore.getState();
    expect(s.playing).toBe(false);
    expect(s.loadingAudio).toBe(false);
    expect(s._getMachineState().intent).toBe('pause');
  });

  it('togglePlay alterna entre play y pause', () => {
    const store = usePlayerStore.getState();
    store.playTrack(T1, { intent: 'play' });
    expect(usePlayerStore.getState().playing).toBe(true);
    store.togglePlay();
    expect(usePlayerStore.getState().playing).toBe(false);
    store.togglePlay();
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it('dispatchPolicy is the unified machine path (syncReact + machine state)', () => {
    const store = usePlayerStore.getState();
    expect(typeof store.dispatchPolicy).toBe('function');
    expect(typeof store.getMachineState).toBe('function');
    expect(typeof store.patchMachine).toBe('function');
    const { state, effects } = store.dispatchPolicy({ type: 'TRACK_SET', trackId: 't1', intent: 'play' });
    expect(state.trackId).toBe('t1');
    expect(state.intent).toBe('play');
    expect(Array.isArray(effects)).toBe(true);
    expect(store.getMachineState().trackId).toBe('t1');
    // patchMachine is the only mutation path for mirrors (no App machineRef)
    store.patchMachine({ srcStatus: 'ready' });
    expect(store.getMachineState().srcStatus).toBe('ready');
  });

  it('cambiar de pista (next/prev simulado via playTrack) resetea time y sessionPosition', () => {
    const store = usePlayerStore.getState();
    store.playTrack(T1, { intent: 'play' });
    // PLAYING solo cuenta con src listo (evita race de la pista anterior)
    store.streamReady({ trackId: 't1', url: 'https://cdn.example/t1.mp3' });
    store.setTime(45);
    store.reportPlaying({ position: 45, trackId: 't1' });
    expect(usePlayerStore.getState().time).toBe(45);
    expect(usePlayerStore.getState()._getMachineState().livePosition).toBe(45);

    // "next" — playTrack con otra pista
    store.playTrack(T2, { intent: 'play' });
    const s = usePlayerStore.getState();
    expect(s.track).toEqual(T2);
    expect(s.time).toBe(0); // reseteado por syncReact patch del TRACK_SET
    expect(s._getMachineState().trackId).toBe('t2');
    expect(s._getMachineState().sessionPosition).toBeNull();
    expect(s._getMachineState().livePosition).toBe(0);
    expect(s._getMachineState().srcStatus).toBe('none');
  });

  it('pushToQueue agrega ids al final y respeta el orden', () => {
    const store = usePlayerStore.getState();
    store.setQueue(['a', 'b']);
    store.pushToQueue('c');
    store.pushToQueue(['d', 'e']);
    expect(usePlayerStore.getState().queue).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('streamReady transiciona srcStatus a ready y dispara effect setSrc', () => {
    const store = usePlayerStore.getState();
    const seenEffects = [];
    usePlayerStore.getState().setEffectHandler((eff) => seenEffects.push(eff));

    store.playTrack(T1, { intent: 'play' });
    store.streamReady({ trackId: 't1', url: 'https://example.com/a.mp3' });

    const s = usePlayerStore.getState();
    expect(s._getMachineState().srcStatus).toBe('ready');
    expect(s.playing).toBe(true);
    expect(s.loadingAudio).toBe(true); // STREAM_READY ya no oculta el spinner

    // effects aplicados: ensureStream, seek, play, mediaSession, setSrc
    const types = seenEffects.map((e) => e.type);
    expect(types).toContain('setSrc');
    expect(types).toContain('play');
    expect(types).toContain('seek');
    expect(types.some((t) => t === 'mediaSession')).toBe(true);
  });

  it('hydrate restaura posición y limpia anclas', () => {
    const store = usePlayerStore.getState();
    store.playTrack(T1, { intent: 'play' });
    store.hydrate({ trackId: 't1', position: 30, urlFresh: false });
    const s = usePlayerStore.getState();
    expect(s.playing).toBe(false);
    expect(s.loadingAudio).toBe(false);
    expect(s.time).toBe(30);
    expect(s._getMachineState().sessionPosition).toBe(30);
    expect(s._getMachineState().yieldPosition).toBeNull();
  });

  it('removeFromQueue y reorderQueue mutan la cola correctamente', () => {
    const store = usePlayerStore.getState();
    store.setQueue(['a', 'b', 'c', 'd']);
    store.removeFromQueue(1);
    expect(usePlayerStore.getState().queue).toEqual(['a', 'c', 'd']);
    store.reorderQueue(0, 2);
    expect(usePlayerStore.getState().queue).toEqual(['c', 'd', 'a']);
  });

  it('setEffectHandler flushed pending effects registrados antes del montaje', () => {
    reset();
    const store = usePlayerStore.getState();
    // dispatch sin handler → effects encolados
    store.playTrack(T1, { intent: 'play' });
    const seen = [];
    usePlayerStore.getState().setEffectHandler((eff) => seen.push(eff));
    // después del mount, los effects pendientes se flushean
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((e) => e.type)).toContain('ensureStream');
  });
});
