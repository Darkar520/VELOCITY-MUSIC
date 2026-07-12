/**
 * playerStore — single source of truth para el dominio PLAYER.
 *
 * Arquitectura:
 *   - Capa 1 (React-facing): track, playing, time, dur, queue, etc. — lo que los componentes leen.
 *   - Capa 2 (audioMachine): intent, focus, livePosition, sessionPosition, etc. — policy pura.
 *   - Adapter: dispatch(event) corre audioMachine.reduce() y aplica los effects al store.
 *
 * El audioMachine NO se modifica (regla MUST del refactor). Se lo invoca y se traducen sus effects.
 * El adapter useAudioElementSync es el único que puede aplicar effects al DOM (<audio>).
 * Componentes solo leen estado, no dispatchan directo al machine.
 *
 * Estado que NO vive acá:
 *   - DOM refs (audioRef, fadeRafRef) → hooks
 *   - Auth (authed, email) → App.jsx
 *   - Library (favs, playlists) → App.jsx (futuro libraryStore)
 *   - UI navigation (tab, view) → App.jsx
 */
import { create } from 'zustand';
import { reduce as audioReduce, initialState as initialMachineState } from '../audio/audioMachine.js';
import { runAudioEffects } from '../audio/runAudioEffects.js';

// ─── Selectores finos (evitan re-renders innecesarios) ──────────────
export const useTrack = () => (s) => s.track;
export const usePlaying = () => (s) => s.playing;
export const useTime = () => (s) => s.time;
export const useDuration = () => (s) => s.duration;
export const useQueue = () => (s) => s.queue;
export const useVolume = () => (s) => s.volume;
export const useShuffle = () => (s) => s.shuffle;
export const useRepeat = () => (s) => s.repeat;
export const useExpanded = () => (s) => s.expanded;
export const useLoadingAudio = () => (s) => s.loadingAudio;
export const usePlaySrc = () => (s) => s.playSrc;
export const useMediaInterrupted = () => (s) => s.mediaInterrupted;

/**
 * Store principal.
 * El adapter de effects se inyecta vía setEffectHandler / setPolicyEffectCtx.
 * dispatchPolicy es el ÚNICO camino de política de audio en runtime (App + hooks).
 */
export const usePlayerStore = create((set, get) => {
  // Estado interno de la máquina — no se expone a componentes directamente.
  let machineState = initialMachineState();

  // Handler de effects — lo setea useAudioElementSync al montar.
  // Mientras no haya handler, los effects se encolan (caso tests).
  let effectHandler = null;
  const pendingEffects = [];
  // Contexto completo de App (runAudioEffects): play/pause/seek/ensureStream/toast.
  // Cuando está presente, es la vía preferida (unifica machine + DOM).
  let policyEffectCtx = null;

  function applySyncReact(effects) {
    for (const eff of effects || []) {
      if (eff.type === 'syncReact' && eff.patch) set(eff.patch);
    }
  }

  function applyEffects(effects) {
    if (!effects || effects.length === 0) return;
    for (const eff of effects) {
      // syncReact es el único effect que muta store directamente.
      // Siempre se aplica, sin importar si hay effectHandler o no.
      if (eff.type === 'syncReact' && eff.patch) {
        set(eff.patch);
      } else if (effectHandler) {
        effectHandler(eff);
      } else {
        // Sin handler DOM todavía (ej: hydrate antes del montaje del <audio>).
        pendingEffects.push(eff);
      }
    }
  }

  function dispatch(event) {
    const { state: nextMachine, effects } = audioReduce(machineState, event);
    machineState = nextMachine;
    applyEffects(effects);
    return effects;
  }

  /**
   * Camino unificado de política: reduce en el store + runAudioEffects con ctx de App.
   * Si no hay policyEffectCtx, cae a dispatch() (effectHandler / pending).
   */
  function dispatchPolicy(event) {
    const { state: nextMachine, effects } = audioReduce(machineState, event);
    machineState = nextMachine;
    applySyncReact(effects);
    if (policyEffectCtx) {
      runAudioEffects(effects, policyEffectCtx);
    } else {
      // Sin ctx: solo non-syncReact vía effectHandler (tests / audio sync parcial)
      for (const eff of effects || []) {
        if (eff.type === 'syncReact') continue;
        if (effectHandler) effectHandler(eff);
        else pendingEffects.push(eff);
      }
    }
    return { state: machineState, effects };
  }

  return {
    // ─── Estado React-facing ─────────────────────────────────
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

    // ─── Acciones directas (no pasan por el machine) ────────
    // Para estado que la máquina no modela (volume, expanded, queue mutation simple).

    setVolume: (v) => set({ volume: v }),
    setExpanded: (b) => set({ expanded: b }),
    setShuffle: (b) => set({ shuffle: b }),
    setRepeat: (b) => set({ repeat: b }),
    setOutputs: (arr) => set({ outputs: arr || [] }),
    setSinkId: (id) => set({ sinkId: id }),
    setRemotePlaying: (rp) => set({ remotePlaying: rp }),
    setDuration: (d) => set({ duration: d }),
    setTime: (t) => set({ time: t }),
    setLoadingAudio: (b) => set({ loadingAudio: b }),
    setPlaySrc: (s) => set({ playSrc: s }),
    setMediaInterrupted: (b) => set({ mediaInterrupted: b }),

    // ─── Acciones del machine (dispatch → reduce → effects) ──
    // Estas son las acciones "semánticas" del player.

    /** Reproduce una pista nueva. track debe tener {id, title, artist, cover, ...}. */
    playTrack: (track, { intent = 'play' } = {}) => {
      set({ track });
      dispatch({ type: 'TRACK_SET', trackId: track?.id || null, intent });
    },

    /** Reanuda play de la pista actual. */
    play: () => dispatch({ type: 'USER_PLAY' }),

    /** Pausa. */
    pause: () => dispatch({ type: 'USER_PAUSE' }),

    /** Toggle play/pause basado en estado playing. */
    togglePlay: () => {
      if (get().playing) dispatch({ type: 'USER_PAUSE' });
      else dispatch({ type: 'USER_PLAY' });
    },

    /** Seek a posición (segundos). */
    seek: (position) => dispatch({ type: 'USER_SEEK', position }),

    /** Marcar que el stream está listo (URL fresca). */
    streamReady: ({ trackId, url }) =>
      dispatch({ type: 'STREAM_READY', trackId, url }),

    /** Marcar stream stale (caducó). */
    streamStale: () => dispatch({ type: 'STREAM_STALE' }),

    /** Pausa externa (otra app tomó el audio). */
    externalPause: ({ hidden, selfPause, position }) =>
      dispatch({ type: 'EXTERNAL_PAUSE', hidden, selfPause, position }),

    /** Documento visible de nuevo. */
    docVisible: ({ currentTime }) =>
      dispatch({ type: 'DOC_VISIBLE', currentTime }),

    /** Documento hidden. */
    docHidden: ({ position }) => dispatch({ type: 'DOC_HIDDEN', position }),

    /** Reportar que el audio está sonando efectivamente. */
    reportPlaying: ({ position, trackId } = {}) =>
      dispatch({ type: 'PLAYING', position, trackId }),

    /** Reportar fallo de play. */
    reportPlayFailed: () => dispatch({ type: 'PLAY_FAILED' }),

    /** Terminó la pista actual. */
    reportEnded: () => dispatch({ type: 'ENDED' }),

    /** Hidratar estado desde persistencia (localStorage/DB). */
    hydrate: ({ trackId, position, urlFresh }) =>
      dispatch({ type: 'HYDRATE', trackId, position, urlFresh }),

    // ─── Cola (queue) ────────────────────────────────────────
    // La cola vive en el store porque el machine no la modela (comentario
    // explícito en audioMachine.js:362 "next track lo decide App (cola)").

    setQueue: (q) => set({ queue: Array.isArray(q) ? q : [] }),

    pushToQueue: (trackIds) =>
      set((s) => ({
        queue: [...s.queue, ...(Array.isArray(trackIds) ? trackIds : [trackIds])],
      })),

    removeFromQueue: (idx) =>
      set((s) => {
        const q = [...s.queue];
        q.splice(idx, 1);
        return { queue: q };
      }),

    reorderQueue: (from, to) =>
      set((s) => {
        const q = [...s.queue];
        const [moved] = q.splice(from, 1);
        q.splice(to, 0, moved);
        return { queue: q };
      }),

    clearQueue: () => set({ queue: [] }),

    // ─── Descargas (relacionadas al player pero no al machine) ──
    setDownloaded: (set_) => set({ downloaded: set_ }),
    setDownloading: (set_) => set({ downloading: set_ }),
    addDownloaded: (id) =>
      set((s) => {
        const next = new Set(s.downloaded);
        next.add(id);
        return { downloaded: next };
      }),
    addDownloading: (id) =>
      set((s) => {
        const next = new Set(s.downloading);
        next.add(id);
        return { downloading: next };
      }),
    removeDownloading: (id) =>
      set((s) => {
        const next = new Set(s.downloading);
        next.delete(id);
        return { downloading: next };
      }),

    // ─── Adapter injection ───────────────────────────────────
    /** Lo llama useAudioElementSync al montar. Recibe effects no-syncReact.
     *  Pasar null para detach (caso tests). */
    setEffectHandler: (handler) => {
      effectHandler = handler;
      // Flushear pendientes (caso: hydrate antes de montar el <audio>).
      if (handler && pendingEffects.length) {
        const pending = pendingEffects.splice(0);
        applyEffects(pending);
      }
    },

    /**
     * Contexto de runAudioEffects (audioRef, setters, ensureStream).
     * Lo registra usePlaybackController cada render.
     */
    setPolicyEffectCtx: (ctx) => {
      policyEffectCtx = ctx || null;
    },

    /** Único dispatch de política en runtime de la app. */
    dispatchPolicy,

    /** Lectura / parche del machine (espejos srcStatus, clear yield, etc.). */
    getMachineState: () => machineState,
    patchMachine: (patch) => {
      machineState = { ...machineState, ...(typeof patch === 'function' ? patch(machineState) : patch) };
      return machineState;
    },

    /** Test-only aliases (compat tests existentes). */
    _getMachineState: () => machineState,
    _dispatch: dispatch,
  };
});

export default usePlayerStore;
