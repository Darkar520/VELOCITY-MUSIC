/**
 * Máquina de estados de audio — reduce puro (sin DOM / React / fetch).
 * App ejecuta effects; la política vive aquí + audioContinuity.js.
 */
import {
  playSyncStrategy,
  shouldYieldOnExternalPause,
  canRestoreInterruptPosition,
  shouldApplySessionResume,
} from '../audioContinuity.js';

export function initialState() {
  return {
    intent: 'pause',
    focus: 'own',
    trackId: null,
    livePosition: 0,
    sessionPosition: null,
    yieldPosition: null,
    yieldTrackId: null,
    srcStatus: 'none', // 'none' | 'ready' | 'stale'
  };
}

/**
 * ¿El efecto de sync debe play/pause/noop?
 * visible: boolean del document.
 */
export function selectPlaySync(state, { visible } = {}) {
  return playSyncStrategy({
    playing: state.intent === 'play',
    hasSrc: state.srcStatus === 'ready',
    yieldedFocus: state.focus === 'yielded',
    visible: visible === true,
  });
}

function push(effects, effect) {
  effects.push(effect);
}

/**
 * @param {ReturnType<typeof initialState>} state
 * @param {{ type: string, [k: string]: unknown }} event
 * @returns {{ state: ReturnType<typeof initialState>, effects: object[] }}
 */
export function reduce(state, event) {
  const effects = [];
  let next = state;

  switch (event.type) {
    case 'HYDRATE': {
      const position = Number(event.position) || 0;
      const trackId = event.trackId ? String(event.trackId) : null;
      const urlFresh = event.urlFresh === true;
      next = {
        ...state,
        intent: 'pause',
        focus: 'own',
        trackId,
        livePosition: position > 0 ? position : 0,
        sessionPosition: position >= 1.5 ? position : null,
        yieldPosition: null,
        yieldTrackId: null,
        srcStatus: urlFresh ? 'ready' : (trackId ? 'stale' : 'none'),
      };
      if (!urlFresh) {
        push(effects, { type: 'clearSrc' });
      }
      push(effects, {
        type: 'syncReact',
        patch: {
          playing: false,
          loadingAudio: false,
          time: next.livePosition,
          mediaInterrupted: false,
        },
      });
      break;
    }

    case 'TRACK_SET': {
      const trackId = event.trackId ? String(event.trackId) : null;
      const intent = event.intent === 'play' ? 'play' : 'pause';
      next = {
        ...state,
        trackId,
        intent,
        focus: 'own',
        sessionPosition: null,
        yieldPosition: null,
        yieldTrackId: null,
        livePosition: 0,
        srcStatus: 'none',
      };
      if (intent === 'play' && trackId) {
        push(effects, { type: 'ensureStream', trackId });
        push(effects, {
          type: 'syncReact',
          patch: { playing: true, loadingAudio: true, time: 0, mediaInterrupted: false },
        });
      }
      break;
    }

    case 'USER_PLAY': {
      if (!state.trackId) break;
      next = {
        ...state,
        intent: 'play',
        focus: 'own',
      };
      push(effects, {
        type: 'syncReact',
        patch: { playing: true, loadingAudio: true, mediaInterrupted: false },
      });
      if (state.srcStatus === 'ready') {
        const seekTo = resolveSeekOnPlay(state);
        if (seekTo != null) {
          push(effects, { type: 'seek', position: seekTo });
          next = { ...next, livePosition: seekTo };
        }
        push(effects, { type: 'play' });
        push(effects, { type: 'mediaSession', state: 'playing', position: seekTo ?? state.livePosition });
      } else {
        push(effects, { type: 'ensureStream', trackId: state.trackId });
      }
      break;
    }

    case 'USER_PAUSE': {
      next = {
        ...state,
        intent: 'pause',
        focus: 'own',
        yieldPosition: null,
        yieldTrackId: null,
      };
      push(effects, { type: 'pause', self: true });
      push(effects, { type: 'mediaSession', state: 'paused' });
      push(effects, {
        type: 'syncReact',
        patch: { playing: false, loadingAudio: false, mediaInterrupted: false },
      });
      break;
    }

    case 'USER_SEEK': {
      const position = Math.max(0, Number(event.position) || 0);
      next = {
        ...state,
        sessionPosition: null,
        yieldPosition: null,
        yieldTrackId: null,
        livePosition: position,
      };
      push(effects, { type: 'seek', position });
      push(effects, { type: 'syncReact', patch: { time: position } });
      break;
    }

    case 'STREAM_READY': {
      const trackId = event.trackId ? String(event.trackId) : null;
      if (trackId && state.trackId && trackId !== state.trackId) break;
      const url = event.url;
      next = {
        ...state,
        srcStatus: 'ready',
        trackId: trackId || state.trackId,
      };
      if (url) push(effects, { type: 'setSrc', url });

      if (state.intent === 'play') {
        // Nuevo src siempre arranca en 0 en el elemento: hay que seek explícito.
        // Prioridad: sesión (A12) → ancla yield (A10) → live si ya avanzó → 0.
        let seekTo = null;
        if (state.sessionPosition != null && state.sessionPosition >= 1.5) {
          seekTo = state.sessionPosition;
        } else if (
          state.focus === 'yielded' &&
          state.yieldPosition != null &&
          state.yieldPosition >= 0
        ) {
          seekTo = state.yieldPosition;
        } else if ((state.livePosition || 0) > 1.5) {
          seekTo = state.livePosition;
        } else {
          seekTo = 0;
        }
        push(effects, { type: 'seek', position: seekTo });
        next = { ...next, livePosition: seekTo };
        push(effects, { type: 'play' });
        push(effects, {
          type: 'mediaSession',
          state: 'playing',
          position: seekTo,
        });
        push(effects, {
          type: 'syncReact',
          patch: { playing: true, loadingAudio: false },
        });
      }
      break;
    }

    case 'STREAM_STALE': {
      next = { ...state, srcStatus: 'stale' };
      push(effects, { type: 'clearSrc' });
      break;
    }

    case 'EXTERNAL_PAUSE': {
      const hidden = event.hidden === true;
      const selfPause = event.selfPause === true;
      const position = Number.isFinite(event.position) ? event.position : state.livePosition;

      if (
        shouldYieldOnExternalPause({
          hidden,
          userWantsPlay: state.intent === 'play',
          selfPause,
          pendingFade: false,
          audioEnded: false,
          alreadyYielded: state.focus === 'yielded',
        })
      ) {
        next = {
          ...state,
          focus: 'yielded',
          yieldPosition: position,
          yieldTrackId: state.trackId,
          livePosition: position,
        };
        push(effects, { type: 'pause', self: true });
        push(effects, {
          type: 'mediaSession',
          state: 'paused',
          position,
        });
        push(effects, {
          type: 'syncReact',
          patch: { mediaInterrupted: true, time: position },
        });
        break;
      }

      // self pause o ya yielded: nada
      if (selfPause || state.focus === 'yielded' || state.intent !== 'play') break;

      // foreground ducking → soft play
      if (!hidden && state.intent === 'play' && state.srcStatus === 'ready') {
        push(effects, { type: 'play' });
      }
      break;
    }

    case 'DOC_VISIBLE': {
      if (state.intent !== 'play') break;
      const currentTime = Number.isFinite(event.currentTime) ? event.currentTime : state.livePosition;

      if (state.focus === 'yielded') {
        const saved = state.yieldPosition;
        const shouldSeek = canRestoreInterruptPosition({
          yieldedFocus: true,
          currentTime,
          savedPosition: saved,
        });
        next = {
          ...state,
          focus: 'own',
          yieldPosition: null,
          yieldTrackId: null,
        };
        if (shouldSeek && saved != null) {
          push(effects, { type: 'seek', position: saved });
          next = { ...next, livePosition: saved };
        }
        if (state.srcStatus === 'ready') {
          push(effects, { type: 'play' });
        } else if (state.trackId) {
          push(effects, { type: 'ensureStream', trackId: state.trackId });
        }
        push(effects, {
          type: 'syncReact',
          patch: { mediaInterrupted: false, playing: true },
        });
      } else if (state.srcStatus === 'ready') {
        // re-assert play if needed
        push(effects, { type: 'play' });
      }
      break;
    }

    case 'DOC_HIDDEN': {
      // no soft-recover; only update live position if provided
      if (Number.isFinite(event.position)) {
        next = { ...state, livePosition: event.position };
      }
      break;
    }

    case 'PLAYING': {
      const position = Number.isFinite(event.position) ? event.position : state.livePosition;
      next = {
        ...state,
        focus: state.focus === 'yielded' ? 'own' : state.focus,
        livePosition: position,
        // consumir session una vez estamos tocando cerca de ella
        sessionPosition:
          state.sessionPosition != null &&
          Math.abs(position - state.sessionPosition) < 2
            ? null
            : state.sessionPosition,
      };
      push(effects, {
        type: 'syncReact',
        patch: { playing: true, loadingAudio: false, time: position, mediaInterrupted: false },
      });
      push(effects, { type: 'mediaSession', state: 'playing', position });
      break;
    }

    case 'PLAY_FAILED': {
      if (state.intent !== 'play') {
        // A13: sin intención de play — limpiar src stale, no reintentar
        next = {
          ...state,
          srcStatus: state.srcStatus === 'stale' || state.srcStatus === 'ready' ? 'none' : state.srcStatus,
        };
        if (state.srcStatus === 'stale' || state.srcStatus === 'ready') {
          push(effects, { type: 'clearSrc' });
        }
        push(effects, {
          type: 'syncReact',
          patch: { playing: false, loadingAudio: false },
        });
        break;
      }
      // con intent play: re-ensure una vez (adapter cuenta reintentos)
      if (state.trackId) {
        push(effects, { type: 'ensureStream', trackId: state.trackId });
        push(effects, { type: 'syncReact', patch: { loadingAudio: true } });
      } else {
        next = { ...state, intent: 'pause' };
        push(effects, { type: 'syncReact', patch: { playing: false, loadingAudio: false } });
      }
      break;
    }

    case 'ENDED': {
      next = {
        ...state,
        livePosition: 0,
        sessionPosition: null,
        yieldPosition: null,
        yieldTrackId: null,
      };
      // next track lo decide App (cola); machine solo limpia anclas
      break;
    }

    default:
      break;
  }

  return { state: next, effects };
}

/** Seek al reanudar play: session (A12) o yield (A10) o null. */
function resolveSeekOnPlay(state) {
  if (
    state.sessionPosition != null &&
    shouldApplySessionResume({
      trackId: state.trackId,
      resumeTrackId: state.trackId,
      resumePosition: state.sessionPosition,
      currentTime: state.livePosition || 0,
    })
  ) {
    return state.sessionPosition;
  }
  if (
    state.focus === 'yielded' &&
    canRestoreInterruptPosition({
      yieldedFocus: true,
      currentTime: state.livePosition || 0,
      savedPosition: state.yieldPosition,
    })
  ) {
    return state.yieldPosition;
  }
  return null;
}
