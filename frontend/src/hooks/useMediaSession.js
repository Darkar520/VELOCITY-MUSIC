/**
 * useMediaSession — integración con la Media Session API del sistema operativo
 * (controles de pantalla de bloqueo / notificación).
 *
 * Extraído de App.jsx sin cambio de comportamiento. Agrupa los tres sitios que
 * antes estaban dispersos en el shell:
 *   1. setMediaSessionState(state, positionHint) — helper imperativo que también
 *      consume runAudioEffects a través del effectCtx del controlador.
 *   2. Metadatos + action handlers (play/pause/prev/next/seek/stop).
 *   3. playbackState y posición en la notificación.
 *
 * Detalle de comportamiento que se conserva: durante una interrupción por vídeo
 * la posición se CONGELA en interruptPosition (no debe "contar" segundos) y el
 * playbackState se reporta como paused aunque la intención siga siendo play.
 */
import { useEffect, useRef } from 'react';
import { trackById } from '../catalog.js';
import { mediaSessionPlaybackState } from '../audioContinuity.js';
import { usePlayerStore } from '../store/playerStore.js';

/**
 * @param {object} p
 * @param {{current:{getMachine?:Function,dispatchAudio?:Function,seek?:Function}}} p.ctlRef
 *   Ref al controlador de playback. Se lee EN EL MOMENTO de la acción (no al
 *   bindear) porque este hook se declara antes de usePlaybackController para
 *   poder entregarle setMediaSessionState — igual que hacía App.jsx.
 */
export function useMediaSession({
  track, playing, dur, vol,
  mediaInterrupted, interruptPositionRef,
  audioRef, ctlRef,
  nextTrackActionRef, prevTrackActionRef,
}) {
  const mediaArtBlobRef = useRef(null);

  /**
   * Helper imperativo: fija playbackState y (opcionalmente) la posición.
   * Se pasa al controlador de playback para que runAudioEffects lo invoque.
   */
  const setMediaSessionState = (state, positionHint) => {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = state; } catch {}
    if (positionHint != null && navigator.mediaSession.setPositionState) {
      try {
        const a = audioRef.current;
        const d = a && a.duration > 0 && isFinite(a.duration) ? a.duration : 0;
        if (d > 0) {
          navigator.mediaSession.setPositionState({
            duration: d,
            position: Math.min(Math.max(0, positionHint), d),
            playbackRate: 1,
          });
        }
      } catch {}
    }
  };

  // ── Metadatos + action handlers del OS ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    let cancelled = false;
    const appArt = [
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ];
    const applyMeta = (artwork) => {
      if (cancelled || !track) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          artwork: artwork && artwork.length ? artwork : appArt,
        });
      } catch {}
    };
    (async () => {
      if (!track) return;
      const cover = track.cover || (trackById(track.id) || {}).cover || '';
      // HTTPS: ok en la mayoría de SO. data:/blob: → blob same-origin (mejor que data: crudo).
      if (cover && /^https?:/i.test(cover)) {
        applyMeta([{
          src: cover.replace(/=w\d+-h\d+/, '=w512-h512').replace(/=s\d+/, '=s512'),
          sizes: '512x512', type: 'image/jpeg',
        }]);
        return;
      }
      if (cover && (cover.startsWith('data:') || cover.startsWith('blob:'))) {
        try {
          const res = await fetch(cover);
          const blob = await res.blob();
          if (cancelled) return;
          if (mediaArtBlobRef.current) {
            try { URL.revokeObjectURL(mediaArtBlobRef.current); } catch {}
          }
          const u = URL.createObjectURL(blob);
          mediaArtBlobRef.current = u;
          applyMeta([{ src: u, sizes: '512x512', type: blob.type || 'image/jpeg' }]);
          return;
        } catch { /* fall through to app icon */ }
      }
      applyMeta(appArt);
    })();
    const a = () => audioRef.current;
    const doPlay = () => {
      const el = a();
      if (!el) return;
      if (el.volume < vol * 0.5) el.volume = vol;
      const { getMachine, dispatchAudio } = ctlRef.current || {};
      if (!getMachine || !dispatchAudio) return;
      if (getMachine().trackId) {
        dispatchAudio({ type: 'USER_PLAY' });
      } else if (track?.id) {
        dispatchAudio({ type: 'TRACK_SET', trackId: track.id, intent: 'play' });
      }
    };
    const doPause = () => {
      ctlRef.current?.dispatchAudio?.({ type: 'USER_PAUSE' });
    };
    navigator.mediaSession.setActionHandler('play', doPlay);
    navigator.mediaSession.setActionHandler('pause', doPause);
    // Refs estables: next/prev siempre al día aunque el efecto no se re-bindee.
    navigator.mediaSession.setActionHandler('previoustrack', () => { try { prevTrackActionRef.current(); } catch {} });
    navigator.mediaSession.setActionHandler('nexttrack', () => { try { nextTrackActionRef.current(); } catch {} });
    try { navigator.mediaSession.setActionHandler('seekto', (e) => { if (e.seekTime != null) ctlRef.current?.seek?.(e.seekTime); }); } catch {}
    try { navigator.mediaSession.setActionHandler('seekforward', () => { try { nextTrackActionRef.current(); } catch {} }); } catch {}
    try { navigator.mediaSession.setActionHandler('seekbackward', () => { try { prevTrackActionRef.current(); } catch {} }); } catch {}
    try { navigator.mediaSession.setActionHandler('stop', () => doPause()); } catch {}
    return () => {
      cancelled = true;
      ['play','pause','previoustrack','nexttrack','seekto','seekforward','seekbackward','stop'].forEach(act => {
        try { navigator.mediaSession.setActionHandler(act, null); } catch {}
      });
    };
  }, [track, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── playbackState: en interrupción por vídeo = paused (aunque intent sea play) ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = mediaSessionPlaybackState({
        userWantsPlay: playing,
        yieldedFocus: mediaInterrupted,
      });
    } catch {}
  }, [playing, mediaInterrupted]);

  // ── Posición en la notificación ──
  // Durante interrupción por vídeo: congelar en interruptPosition (no “contar” segundos).
  // El reloj llega por suscripción IMPERATIVA al store (no por prop reactiva):
  // una suscripción con selector re-renderizaría el componente padre (App) ~4
  // veces/seg; aquí la posición se actualiza sin tocar el árbol de React.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const apply = () => {
      const s = usePlayerStore.getState();
      const d = s.duration;
      if (!(d > 0 && isFinite(d))) return;
      const pos = mediaInterrupted && interruptPositionRef.current != null
        ? interruptPositionRef.current
        : s.time;
      try {
        navigator.mediaSession.setPositionState({
          duration: d,
          position: Math.min(Math.max(0, pos), d),
          playbackRate: 1,
        });
      } catch {}
    };
    apply();
    let lastTime = usePlayerStore.getState().time;
    const unsub = usePlayerStore.subscribe((s) => {
      if (s.time === lastTime) return;
      lastTime = s.time;
      apply();
    });
    return unsub;
  }, [dur, mediaInterrupted]); // eslint-disable-line react-hooks/exhaustive-deps

  return { setMediaSessionState };
}

export default useMediaSession;
