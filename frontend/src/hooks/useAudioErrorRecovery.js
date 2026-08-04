/**
 * useAudioErrorRecovery — recuperación resiliente ante errores de reproducción.
 *
 * Extraído de App.jsx sin cambio de comportamiento (handler `onError` del
 * <audio>). Contrato que fijan los tests de appShell.test.jsx:
 *
 *  - Errores espurios se IGNORAN: al vaciar el src (cambio de pista) o cuando el
 *    elemento no tiene URL real. `_suppressAudioError` del effectCtx también corta.
 *  - Con intención de play: hasta 6 reintentos con espera creciente
 *    [400, 900, 1800, 3500, 7000, 12000] ms, cada uno con FIRMA FRESCA
 *    (se limpia el caché de firma; desde el 2º intento además prefetchStream y
 *    cache-buster `_r`).
 *  - Sin intención de play (A13): PLAY_FAILED 'stale' y se resetea el contador,
 *    nunca se auto-reproduce.
 *  - Las fuentes blob: (descargas offline) no se reintentan.
 *  - Agotados los 6 intentos: anti-cascada. Al 3er fallo consecutivo de pistas
 *    distintas se detiene con aviso; si no, se salta a la siguiente de la cola.
 *
 * NO toca src/audio/*: sólo despacha eventos por el mismo camino que App.
 */
import { api } from '../api.js';

const MAX_PLAY_RETRIES = 6;
const RETRY_DELAYS = [400, 900, 1800, 3500, 7000, 12000];
const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };

export function useAudioErrorRecovery({
  audioRef, effectCtxRef, selfPauseRef, playingRef, trackRef,
  playErrorRef, consecutiveFailsRef,
  track, queue, quality,
  getMachine, dispatchAudio, setTrack, setLoadingAudio, setPlaying,
  showToast, next,
}) {
  const handleAudioError = () => {
    // Ignorar errores al vaciar src o sin URL real (cambio de pista).
    if (effectCtxRef.current?._suppressAudioError) return;
    const a = audioRef.current;
    const rawSrc = (a?.currentSrc || a?.getAttribute?.('src') || a?.src || '').trim();
    if (!a || !rawSrc || rawSrc === (typeof location !== 'undefined' ? location.href : '')) return;
    // 401 del proxy llega como error de media; reintentar con firma fresca (abajo).

    selfPauseRef.current = false;
    const cur = track?.id;
    if (!cur) {
      dispatchAudio({ type: 'PLAY_FAILED', reason: 'no-el' });
      return;
    }
    // A13: sin intención de play → machine limpia, no auto-play.
    if (getMachine().intent !== 'play') {
      dispatchAudio({ type: 'PLAY_FAILED', reason: 'stale' });
      playErrorRef.current = { id: null, n: 0 };
      return;
    }
    const st = playErrorRef.current;
    const n = (st.id === cur) ? st.n : 0;
    const isBlob = typeof a.currentSrc === 'string' && a.currentSrc.startsWith('blob:');
    // Reintentos solo con intención de play. 6 intentos con espera creciente.
    if (n < MAX_PLAY_RETRIES && !isBlob) {
      const attempt = n + 1;
      playErrorRef.current = { id: cur, n: attempt };
      setLoadingAudio(true);
      // Primeros reintentos rápidos (resolve yt-dlp a veces falla a la 1ª).
      const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
      setTimeout(async () => {
        if (!audioRef.current || trackRef.current?.id !== cur) return;
        if (!playingRef.current) { setLoadingAudio(false); return; }
        try {
          const q = QUALITY_MAP[quality] || 'high';
          const tk = trackRef.current || track;
          if (attempt >= 1) api._streamSignCache?.clear?.();
          const sp = {
            artist: tk.artist, title: tk.title, id: tk.id, quality: q,
            stream: (tk.source === 'soundcloud' && tk.stream) ? tk.stream : undefined,
          };
          // forceRefresh vía resolve al 2º+ intento (prefetch limpia caché mala).
          if (attempt >= 2) await api.prefetchStream(sp);
          const base = await api.ensureStreamUrl(sp);
          if (!playingRef.current || trackRef.current?.id !== cur) { setLoadingAudio(false); return; }
          const url = attempt >= 2 ? (base + (base.includes('?') ? '&' : '?') + '_r=' + Date.now()) : base;
          setTrack((prev) => (prev && prev.id === cur ? { ...prev, url } : prev));
          // STREAM_READY delega setSrc/load/play al pipeline unificado y
          // conserva el gate de playingRef para A13.
          dispatchAudio({ type: 'STREAM_READY', trackId: cur, url });
        } catch {
          if (!playingRef.current) setLoadingAudio(false);
        }
      }, delay);
      return;
    }
    // Agotados 6 reintentos (~45s de intentos): saltar con protección anti-cascada.
    playErrorRef.current = { id: cur, n: 0 };
    consecutiveFailsRef.current += 1;
    if (consecutiveFailsRef.current > 2) {
      consecutiveFailsRef.current = 0;
      setLoadingAudio(false); setPlaying(false);
      showToast('Varias pistas no disponibles. Verifica tu conexión.');
      return;
    }
    setLoadingAudio(false);
    const ids = queue && queue.length ? queue : [];
    const i = ids.indexOf(cur);
    if (ids.length > 1 && i !== -1) {
      showToast('Pista no disponible · siguiente…');
      setTimeout(() => next(), 1000);
    } else {
      setPlaying(false);
      showToast('No se pudo reproducir esta pista');
      api.reportPlaybackError({ trackId: cur, errorCode: 'max_retries', errorMessage: 'Agotados 6 reintentos de reproducción' });
    }
  };

  return { handleAudioError, MAX_PLAY_RETRIES, RETRY_DELAYS };
}

export default useAudioErrorRecovery;
