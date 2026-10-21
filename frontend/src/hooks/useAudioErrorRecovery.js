/**
 * useAudioErrorRecovery — recuperación resiliente ante errores de reproducción.
 *
 * Atiende el evento `error` del <audio> y la congelación sin MediaError.
 * Contrato que fijan los tests de appShell.test.jsx:
 *
 *  - Errores espurios se IGNORAN: al vaciar el src (cambio de pista) o cuando el
 *    elemento no tiene URL real. `_suppressAudioError` del effectCtx también corta.
 *  - Con intención de play: un único reintento forzando una resolución nueva.
 *    Si falla, se detiene y comunica el motivo en vez de dejar el spinner activo.
 *  - Sin intención de play (A13): PLAY_FAILED 'stale' y se resetea el contador,
 *    nunca se auto-reproduce.
 *  - Blob: renovar una URL local una vez, conservando bytes y disponibilidad.
 *    Si vuelve a fallar, detener sin saltar pistas ni invalidar descargas.
 *  - Agotado el reintento: anti-cascada. Al 3er fallo consecutivo de pistas
 *    distintas se detiene con aviso; si no, se salta a la siguiente de la cola.
 *
 * NO toca src/audio/*: sólo despacha eventos por el mismo camino que App.
 */
import { api } from '../api.js';

const MAX_PLAY_RETRIES = 1;
const RETRY_DELAYS = [450];
const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };

export function useAudioErrorRecovery({
  audioRef, effectCtxRef, selfPauseRef, playingRef, trackRef,
  playErrorRef, consecutiveFailsRef,
  track, queue, quality,
  getMachine, dispatchAudio, setTrack, setLoadingAudio, setPlaying,
  showToast, next, retrySource,
}) {
  const handleAudioError = (failure) => {
    // Ignorar errores al vaciar src o sin URL real (cambio de pista).
    if (effectCtxRef.current?._suppressAudioError) return;
    const a = audioRef.current;
    const rawSrc = (a?.getAttribute ? a.getAttribute('src') || '' : a?.currentSrc || a?.src || '').trim();
    if (!a || !rawSrc || rawSrc === (typeof location !== 'undefined' ? location.href : '')) return;
    // Queued events from a cleared/replaced resource do not establish a
    // failure of the new song. A fresh load resets the native MediaError.
    if (failure?.kind !== 'stall' && !a.error) return;
    if (a.currentSrc && a.currentSrc !== new URL(rawSrc, location.href).href) return;
    // El elemento <audio> no expone el body 401/502; se vuelve a preparar una vez.
    const directSource = api.isDirectPlaybackUrl(rawSrc);

    selfPauseRef.current = false;
    const cur = track?.id;
    if (getMachine().trackId && getMachine().trackId !== cur) return;
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
    if (directSource) api.recordDirectPlaybackFailure(rawSrc);
    const st = playErrorRef.current;
    const n = (st.id === cur) ? st.n : 0;
    const stalled = failure?.kind === 'stall' || (st.id === cur && st.kind === 'stall');
    const interruptedAt = Number.isFinite(failure?.position)
      ? failure.position : Number(a.currentTime);
    const duration = Number(a.duration);
    const isBlob = rawSrc.startsWith('blob:');
    if (isBlob && retrySource) {
      if (st.id === cur && st.localUrl === rawSrc) return;
      const localAttempts = st.id === cur ? (st.localAttempts || 0) : 0;
      // Recover transient URL/decoder startup using the same saved bytes.
      if (localAttempts < 1) {
        playErrorRef.current = { id: cur, n: 0, localAttempts: 1, localUrl: rawSrc };
        setLoadingAudio(true);
        retrySource(cur);
        return;
      }
      dispatchAudio({ type: 'USER_PAUSE' });
      setLoadingAudio(false);
      setPlaying(false);
      showToast('No se pudo iniciar el audio local. La descarga se conserva; no se han saltado canciones.');
      api.reportPlaybackError({ trackId: cur, errorCode: 'AUDIO_LOCAL_START_FAILED',
        errorMessage: `MediaError ${a.error?.code || 0}; local URL reopened once; saved bytes retained.` }).catch(() => {});
      return;
    }
    // Reintentos solo con intención de play y con límite corto.
    if (n < MAX_PLAY_RETRIES && !isBlob) {
      const attempt = n + 1;
      playErrorRef.current = { id: cur, n: attempt, kind: stalled ? 'stall' : 'media_error' };
      setLoadingAudio(true);
      // Única re-resolución rápida para descartar una URL upstream ya vencida.
      const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
      setTimeout(async () => {
        if (!audioRef.current || trackRef.current?.id !== cur) return;
        if (!playingRef.current || getMachine().focus === 'yielded') { setLoadingAudio(false); return; }
        try {
          const q = QUALITY_MAP[quality] || 'high';
          const tk = trackRef.current || track;
          const sp = {
            artist: tk.artist, title: tk.title, id: tk.id, quality: q,
            stream: (tk.source === 'soundcloud' && tk.stream) ? tk.stream : undefined,
          };
          // Pide una URL upstream fresca; sin forceRefresh solo se volvería a
          // firmar la misma entrada vencida de StreamCache.
          const base = await api.ensureStreamUrl(sp, { forceRefresh: true, playbackMode: 'proxy' });
          if (trackRef.current?.id !== cur) return;
          if (!playingRef.current || getMachine().intent !== 'play' || getMachine().focus === 'yielded') { setLoadingAudio(false); return; }
          const url = base + (base.includes('?') ? '&' : '?') + '_r=' + Date.now();
          // Reanudar donde se interrumpió si el elemento conoce la duración.
          // La fuente nueva se monta primero; USER_SEEK aplica el seek al nuevo src.
          const canResume = Number.isFinite(interruptedAt) && interruptedAt >= 1.5
            && Number.isFinite(duration) && interruptedAt < duration - 2;
          setTrack((prev) => (prev && prev.id === cur ? { ...prev, url } : prev));
          // STREAM_READY delega setSrc/load/play al pipeline unificado y
          // conserva el gate de playingRef para A13.
          dispatchAudio({ type: 'STREAM_READY', trackId: cur, url });
          if (canResume) dispatchAudio({ type: 'USER_SEEK', position: interruptedAt });
          if (directSource) {
            api.reportPlaybackError({
              trackId: cur,
              errorCode: 'DIRECT_FALLBACK_PROXY_MOUNTED',
              errorMessage: `Direct source failed (MediaError ${a.error?.code || 0}); switched once to the signed proxy.`,
            }).catch(() => {});
          }
        } catch (err) {
          if (trackRef.current?.id !== cur || getMachine().intent !== 'play') return;
          setLoadingAudio(false);
          dispatchAudio({ type: 'USER_PAUSE' });
          setPlaying(false);
          const detail = typeof err?.message === 'string' && err.message.trim()
            ? err.message
            : 'Falló la re-resolución de la fuente de audio.';
          showToast(detail);
          api.reportPlaybackError({
            trackId: cur,
            errorCode: err?.code || `http_${err?.status || 'network'}`,
            errorMessage: detail,
          }).catch(() => {});
        }
      }, delay);
      return;
    }
    // Agotado el único reintento: detener o saltar con protección anti-cascada.
    playErrorRef.current = { id: cur, n: 0 };
    consecutiveFailsRef.current += 1;
    const message = stalled
      ? 'La reproducción no avanzó durante 10 segundos, incluso después de renovar la fuente. El navegador no informa la causa exacta de la interrupción.'
      : 'El navegador no recibió audio del stream incluso después de una nueva resolución. Puede ser un bloqueo upstream o un fallo de red.';
    api.reportPlaybackError({
      trackId: cur,
      errorCode: stalled ? 'AUDIO_STALL_TIMEOUT' : 'AUDIO_STREAM_TRANSPORT_ERROR',
      errorMessage: message,
    }).catch(() => {});
    if (stalled) {
      dispatchAudio({ type: 'USER_PAUSE' });
      setLoadingAudio(false);
      setPlaying(false);
      showToast(message);
      return;
    }
    if (consecutiveFailsRef.current > 2) {
      consecutiveFailsRef.current = 0;
      dispatchAudio({ type: 'USER_PAUSE' });
      setLoadingAudio(false); setPlaying(false);
      showToast('Varias pistas no disponibles. Verifica tu conexión.');
      return;
    }
    setLoadingAudio(false);
    const ids = queue && queue.length ? queue : [];
    const i = ids.indexOf(cur);
    if (ids.length > 1 && i !== -1) {
      showToast('Pista no disponible · siguiente…');
      dispatchAudio({ type: 'USER_PAUSE' });
      setTimeout(() => {
        if (trackRef.current?.id === cur) next();
      }, 500);
    } else {
      dispatchAudio({ type: 'USER_PAUSE' });
      setPlaying(false);
      showToast(message);
    }
  };

  return { handleAudioError, MAX_PLAY_RETRIES, RETRY_DELAYS };
}

export default useAudioErrorRecovery;
