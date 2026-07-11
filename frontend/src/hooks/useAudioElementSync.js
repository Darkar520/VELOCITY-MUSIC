/**
 * useAudioElementSync — adapter entre el <audio> físico y el playerStore.
 *
 * Responsabilidades:
 *   1. Registrar effectHandler en el store (recibe effects: play, pause, seek, setSrc, etc.)
 *   2. Aplicar esos effects al <audio> element.
 *   3. Escuchar eventos nativos del <audio> (timeupdate, ended, error, canplay) y
 *      dispatchar eventos al store para que la máquina actualice su estado.
 *
 * NO contiene policy de audio — eso vive en audioMachine.js + audioContinuity.js.
 * NO maneja fade routines ni sustained play check — esos quedan en App.jsx por ahora
 * (son ortogonales al store y viven en refs del componente).
 *
 * Uso:
 *   const audioRef = useRef(null);
 *   useAudioElementSync(audioRef);
 *   return <audio ref={audioRef} ... />;
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore.js';

export function useAudioElementSync(audioRef) {
  const persistRef = useRef({ lastReport: 0 });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const store = usePlayerStore.getState();

    // ─── Effect handler: aplica effects no-syncReact al <audio> ───────
    const handler = (eff) => {
      switch (eff.type) {
        case 'play':
          // play() returns a Promise — errores se manejan en el handler 'error'
          audio.play().catch(() => {
            usePlayerStore.getState().reportPlayFailed();
          });
          break;
        case 'pause':
          audio.pause();
          break;
        case 'seek': {
          const pos = Number(eff.position);
          if (Number.isFinite(pos) && pos >= 0) {
            try { audio.currentTime = pos; } catch { /* src no listo aún */ }
          }
          break;
        }
        case 'setSrc':
          // El store.actual.playSrc se setea por separado desde App.jsx
          // (porque involve revokeObjectURL del anterior). Este effect es signal.
          break;
        case 'clearSrc':
          // Idem — App.jsx managea el src attribute directamente.
          break;
        case 'ensureStream':
          // App.jsx escucha este effect via subscription? No, este effect
          // se emite pero el handler del store no sabe cómo resolver streams.
          // El componente App.jsx debe escuchar cambios en store._getMachineState
          // para disparar api.resolveTrack. Por ahora: noop acá.
          // TODO: exponer callback opcional en el hook para esto.
          break;
        case 'mediaSession':
          // Media Session API — opcional, lo maneja App.jsx por ahora.
          break;
        default:
          // Effects desconocidos: noop.
          break;
      }
    };

    usePlayerStore.getState().setEffectHandler(handler);

    // ─── Listeners nativos del <audio> → dispatch al store ───────────
    const onTimeUpdate = () => {
      const ct = audio.currentTime || 0;
      // Throttle: reportar máximo cada 250ms para no saturar el store.
      const now = Date.now();
      if (now - persistRef.current.lastReport < 250) return;
      persistRef.current.lastReport = now;
      usePlayerStore.getState().setTime(ct);
    };

    const onPlay = () => {
      usePlayerStore.getState().reportPlaying({ position: audio.currentTime || 0 });
    };

    const onPause = () => {
      // Solo pausa "externa" (no self-pause) →EXTERNAL_PAUSE.
      // App.jsx managea selfPauseRef para distinguir. Por ahora: noop acá,
      // el store.playing ya se seteó via syncReact del USER_PAUSE.
    };

    const onEnded = () => {
      usePlayerStore.getState().reportEnded();
      // Next track: lo decide App.jsx (la cola).
    };

    const onError = () => {
      usePlayerStore.getState().reportPlayFailed();
    };

    const onDurationChange = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        usePlayerStore.getState().setDuration(d);
      }
    };

    const onCanPlay = () => {
      usePlayerStore.getState().setLoadingAudio(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      usePlayerStore.getState().setEffectHandler(null);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [audioRef]);

  // Volumen: sync store.volume → audio.volume
  const volume = usePlayerStore((s) => s.volume);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, audioRef]);
}

export default useAudioElementSync;
