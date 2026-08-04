/**
 * useAudioElement — handlers del elemento <audio> físico.
 *
 * Extraído de App.jsx SIN cambio de comportamiento: devuelve exactamente los
 * mismos callbacks que estaban inline en el JSX, con el mismo cuerpo. El árbol
 * de render no cambia (mismo <audio>, mismas props).
 *
 * Camino de adaptación al DOM: el ÚNICO adapter sigue siendo runAudioEffects,
 * registrado por usePlaybackController vía setPolicyEffectCtx (effectCtxRef).
 * Este hook NO usa la API legacy setEffectHandler del store, sólo despacha
 * eventos a la machine igual que hacía el shell.
 *
 * Comportamientos delicados que se conservan literalmente:
 *  - onTimeUpdate: congela el reloj si la interrupción por vídeo está CONFIRMADA
 *    y re-firma la URL HMAC de forma proactiva cuando expira en < 3 min
 *    (sólo con > 30 s reproducidos y con `_resignInFlight` como cerrojo).
 *  - onPlay / onPlaying: si la intención ya no es play, se auto-pausa marcando
 *    selfPause (A13) en lugar de dejar sonar audio "fantasma".
 *  - onPause: fix de race iOS/Android de 300 ms — si el documento todavía está
 *    visible, el EXTERNAL_PAUSE se difiere para que llegue visibilitychange y
 *    se re-evalúe `hidden`; sin esto el yield no se ancla y al volver falla
 *    play() en iOS (NotAllowedError en background).
 */
import { api } from '../api.js';
import { isDocumentVisible, isExternalPause } from '../audioContinuity.js';
import { flushPendingSeek } from '../audio/runAudioEffects.js';

const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };

export function useAudioElement({
  audioRef, effectCtxRef,
  systemPausedRef, selfPauseRef, playingRef, pendingFadeRef, trackRef,
  playErrorRef, consecutiveFailsRef, sustainedPlayRef, bgLastProgressRef,
  mediaInterrupted, loadingAudio, playing, vol, quality,
  setTime, setDur, setTrack, setLoadingAudio, setPlaying,
  getMachine, dispatchAudio, applySessionResume, restoreInterruptPosition,
  fadeInAudio, setMediaSessionState,
  onTrackEnded,
}) {
  const onTimeUpdate = () => {
    const a = audioRef.current; if (!a) return;
    // Solo congelar reloj si la interrupción por vídeo está CONFIRMADA y sigue pausado.
    if ((systemPausedRef.current || mediaInterrupted) && a.paused) return;
    const ct = a.currentTime || 0; setTime(ct);
    if (ct > 0 && loadingAudio) setLoadingAudio(false);

    // ── RE-FIRMA PROACTIVA: si la URL firmada expira en < 3 min, obtener
    // una URL fresca y asignarla sin interrumpir la reproducción. ──
    // Solo actuar si la pista está sonando y hay más de 30s reproducidos
    // (evitar race con el arranque inicial).
    const currentSrc = a.currentSrc || a.getAttribute('src') || '';
    if (currentSrc && currentSrc.includes('exp=') && a.currentTime > 30 && playingRef.current) {
      try {
        const urlObj = new URL(currentSrc, location.href);
        const expSec = Number(urlObj.searchParams.get('exp'));
        const nowSec = Math.floor(Date.now() / 1000);
        // Si quedan menos de 3 minutos (180s), re-firmar en background.
        if (Number.isFinite(expSec) && expSec - nowSec < 180 && expSec > nowSec) {
          if (!a._resignInFlight) {
            a._resignInFlight = true;
            const tk = trackRef.current;
            const q = QUALITY_MAP[quality] || 'high';
            api.ensureStreamUrl({
              artist: tk?.artist, title: tk?.title, id: tk?.id, quality: q,
              stream: (tk?.source === 'soundcloud' && tk?.stream) ? tk.stream : undefined,
            }).then(freshUrl => {
              // Solo actualizar si la pista no cambió durante la re-firma.
              if (!a || trackRef.current?.id !== tk?.id || !playingRef.current) return;
              if (freshUrl && freshUrl !== currentSrc) {
                setTrack((prev) => (prev && prev.id === tk?.id ? { ...prev, url: freshUrl } : prev));
                dispatchAudio({ type: 'STREAM_READY', trackId: tk?.id, url: freshUrl });
              }
            }).catch(() => {}).finally(() => { if (a) a._resignInFlight = false; });
          }
        }
      } catch { /* ignorar — no interrumpir reproducción por error de parsing */ }
    }
  };

  const onLoadedMetadata = () => {
    setDur(audioRef.current?.duration || 0);
    flushPendingSeek(effectCtxRef.current);
    applySessionResume(audioRef.current);
  };

  const onCanPlay = () => {
    // canplay solo indica que hay datos suficientes; play() todavía puede
    // estar pendiente o ser rechazado. El spinner se apaga en onPlay/
    // onPlaying o cuando el reloj empieza a avanzar.
    flushPendingSeek(effectCtxRef.current);
    applySessionResume(audioRef.current);
  };

  const onPlay = () => {
    selfPauseRef.current = false;
    const el = audioRef.current;
    if (getMachine().intent !== 'play') {
      selfPauseRef.current = true;
      try { el?.pause(); } catch {}
      selfPauseRef.current = false;
      setLoadingAudio(false);
      return;
    }
    flushPendingSeek(effectCtxRef.current);
    applySessionResume(el);
    restoreInterruptPosition(el);
    if (el && el.volume < vol * 0.5) el.volume = vol;
    setMediaSessionState('playing', el?.currentTime);
    setLoadingAudio(false);
    if (!playing) setPlaying(true);
  };

  const onPlaying = () => {
    selfPauseRef.current = false;
    bgLastProgressRef.current = Date.now();
    const el = audioRef.current;
    if (getMachine().intent !== 'play') {
      selfPauseRef.current = true;
      try { el?.pause(); } catch {}
      selfPauseRef.current = false;
      setLoadingAudio(false);
      return;
    }
    flushPendingSeek(effectCtxRef.current);
    applySessionResume(el);
    if (el && el.volume < vol * 0.5) el.volume = vol;
    dispatchAudio({
      type: 'PLAYING',
      position: el?.currentTime || 0,
      trackId: getMachine().trackId || trackRef.current?.id || undefined,
    });
    playErrorRef.current = { id: null, n: 0 };
    sustainedPlayRef.current = false;
    setTimeout(() => {
      if (audioRef.current && !audioRef.current.paused && audioRef.current.currentTime > 3) {
        consecutiveFailsRef.current = 0;
        sustainedPlayRef.current = true;
      }
    }, 5000);
    if (pendingFadeRef.current) {
      pendingFadeRef.current = false;
      if (isDocumentVisible()) fadeInAudio();
      else if (audioRef.current) audioRef.current.volume = vol;
    }
  };

  const onStalled = () => { if (playingRef.current) setLoadingAudio(true); };
  const onWaiting = () => { if (playingRef.current) setLoadingAudio(true); };

  const onPause = () => {
    const a = audioRef.current;
    if (!a) return;
    if (getMachine().intent !== 'play') {
      setLoadingAudio(false);
      return;
    }
    if (!isExternalPause({
      selfPause: selfPauseRef.current,
      pendingFade: pendingFadeRef.current,
      userWantsPlay: getMachine().intent === 'play',
      audioEnded: a.ended,
    })) return;

    // Pause externo: la machine decide (yield honesto en background,
    // soft-kick en foreground). Nada de re-play oculto aquí (A7/A14).
    //
    // Race condition iOS/Android: en algunos dispositivos el evento 'pause'
    // del <audio> llega ANTES de que visibilitychange ponga hidden=true
    // (ventana de hasta ~300ms). Si despachamos EXTERNAL_PAUSE con hidden=false,
    // shouldYieldOnExternalPause devuelve false y no se ancla → al volver
    // visible tryResume dispara DOC_VISIBLE sin yield → play() falla en iOS
    // (NotAllowedError background). Fix: si el doc aún es visible, diferir
    // 300ms para que visibilitychange llegue y re-evaluar hidden.
    const dispatchExternalPause = (hidden) => {
      // Re-verificar que el pause sigue siendo externo y el intent sigue activo.
      if (getMachine().intent !== 'play') return;
      if (!isExternalPause({
        selfPause: selfPauseRef.current,
        pendingFade: pendingFadeRef.current,
        userWantsPlay: true,
        audioEnded: audioRef.current?.ended ?? false,
      })) return;
      dispatchAudio({
        type: 'EXTERNAL_PAUSE',
        hidden,
        selfPause: selfPauseRef.current,
        position: audioRef.current?.currentTime || 0,
      });
    };

    if (!isDocumentVisible()) {
      // Doc ya oculto: path normal, yield inmediato.
      dispatchExternalPause(true);
    } else {
      // Doc aún visible: posible race condition iOS. Diferir 300ms y
      // re-evaluar hidden. Si para entonces el audio reanudó (ej. ducking
      // resuelto), el chequeo isExternalPause lo descarta automáticamente.
      setTimeout(() => {
        dispatchExternalPause(!isDocumentVisible());
      }, 300);
    }
  };

  const onEnded = () => {
    dispatchAudio({ type: 'ENDED' });
    onTrackEnded();
  };

  return {
    onTimeUpdate, onLoadedMetadata, onCanPlay, onPlay, onPlaying,
    onStalled, onWaiting, onPause, onEnded,
  };
}

export default useAudioElement;
