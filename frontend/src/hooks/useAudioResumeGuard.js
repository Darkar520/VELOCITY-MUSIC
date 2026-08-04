/**
 * useAudioResumeGuard — reanudación tras interrupción por vídeo y detección de
 * "zombie silencioso" (pipeline de audio muerto).
 *
 * Extraído de App.jsx sin cambio de comportamiento. Reglas de la matriz
 * A7–A14 que se conservan LITERALMENTE:
 *
 *  - Foreground: reacquire suave (PIPELINE_DEAD con hidden:false) cuando el
 *    reloj se queda clavado; la máquina/runner vuelve a afirmar la
 *    reproducción — App nunca invoca audio.play() directamente.
 *  - Background: SOLO diagnóstico. Si ya se cedió el foco (yield) la
 *    recuperación es trabajo exclusivo de DOC_VISIBLE; nunca hay play() oculto
 *    (A7). Un zombie confirmado se resuelve pausando y anclando la posición
 *    (PIPELINE_DEAD con hidden:true), diciendo la verdad al OS (A14).
 *  - forceReacquire no escribe ancla de yield (A10: no clavar posición).
 *  - Al cambiar de visibilidad se invalida la época de precarga, de modo que
 *    una precarga a medias no se dé por completada al volver (preloadEpoch).
 */
import { useEffect } from 'react';
import {
  isDocumentVisible,
  shouldResumeOnForeground,
  canForceReacquire,
  shouldSuspendPreloads,
  isAudioPipelineDead,
} from '../audioContinuity.js';

export function useAudioResumeGuard({
  audioRef, preloadAudioRef, preloadAudio2Ref,
  playingRef, selfPauseRef, systemPausedRef,
  reacquireInFlight, lastTimeRef, stuckCheckRef,
  bgLastCtRef, bgLastProgressRef,
  preloadEpochRef, setPreloadEpoch,
  vol, getMachine, dispatchAudio,
}) {
  const forceReacquire = () => {
    if (!canForceReacquire(isDocumentVisible())) return;
    if (reacquireInFlight.current) return;
    const a = audioRef.current;
    if (!a || !playingRef.current || a.ended) return;
    reacquireInFlight.current = true;
    if (a.volume < vol * 0.5) a.volume = vol;
    // La máquina/runner vuelve a afirmar la reproducción en foreground;
    // App no invoca directamente el elemento multimedia.
    dispatchAudio({ type: 'PIPELINE_DEAD', hidden: false, position: a.currentTime || 0 });
    reacquireInFlight.current = false;
  };

  useEffect(() => {
    const tryResume = () => {
      const a = audioRef.current;
      if (!a) return;
      const timeStuck = lastTimeRef.current > 0
        && Math.abs((a.currentTime || 0) - lastTimeRef.current) < 0.05
        && (a.currentTime || 0) > 0.5
        && !a.paused;
      if (!shouldResumeOnForeground({
        userWantsPlay: getMachine().intent === 'play',
        audioEnded: a.ended,
        audioPaused: a.paused,
        volume: a.volume,
        targetVolume: vol,
        systemPaused: getMachine().focus === 'yielded',
        timeStuck,
      })) return;

      dispatchAudio({
        type: 'DOC_VISIBLE',
        currentTime: a.currentTime || 0,
      });
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        preloadEpochRef.current += 1;
        setPreloadEpoch((value) => value + 1);
        setTimeout(tryResume, 40);
        setTimeout(tryResume, 350);
        setTimeout(tryResume, 1000);
      } else {
        preloadEpochRef.current += 1;
        setPreloadEpoch((value) => value + 1);
        const a = audioRef.current;
        dispatchAudio({
          type: 'DOC_HIDDEN',
          position: a && Number.isFinite(a.currentTime) ? a.currentTime : undefined,
        });
        if (shouldSuspendPreloads(false)) {
          for (const r of [preloadAudioRef, preloadAudio2Ref]) {
            const el = r.current;
            if (!el) continue;
            try { el.removeAttribute('src'); el.load(); } catch {}
          }
        }
      }
    };
    const onFocus = () => {
      if (isDocumentVisible()) setTimeout(tryResume, 60);
    };
    const onPageShow = (e) => {
      if (e.persisted || isDocumentVisible()) setTimeout(tryResume, 60);
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);

    // Foreground: zombie / pause residual (reacquire suave).
    // Background: SOLO detección de pipeline muerto (A14) — nunca play()
    // oculto tras yield (A7). La reanudación real ocurre vía DOC_VISIBLE.
    stuckCheckRef.current = setInterval(() => {
      const a = audioRef.current;
      if (!a || !playingRef.current || a.ended) { lastTimeRef.current = 0; bgLastCtRef.current = 0; return; }
      const ct = a.currentTime || 0;

      if (!isDocumentVisible()) {
        // Si ya cedimos (yield), la recuperación es trabajo de DOC_VISIBLE.
        if (systemPausedRef.current) { bgLastCtRef.current = ct; return; }
        if (ct > (bgLastCtRef.current || 0) + 0.05) {
          // Reloj avanzando: pipeline sano (Media Session sigue honesta).
          bgLastProgressRef.current = Date.now();
        } else if (isAudioPipelineDead({
          userWantsPlay: true,
          yieldedFocus: false,
          selfPause: selfPauseRef.current,
          ended: a.ended,
          paused: a.paused,
          currentTime: ct,
          readyState: a.readyState || 0,
          stallMs: Date.now() - bgLastProgressRef.current,
        })) {
          // Zombie confirmado: pausar, anclar y decir la verdad al OS.
          dispatchAudio({ type: 'PIPELINE_DEAD', hidden: true, position: ct });
        }
        bgLastCtRef.current = ct;
        lastTimeRef.current = ct;
        return;
      }

      if (a.paused || systemPausedRef.current) {
        tryResume();
      } else if (lastTimeRef.current > 0 && Math.abs(ct - lastTimeRef.current) < 0.05 && ct > 0.5) {
        if (a.volume < vol * 0.5) a.volume = vol;
        forceReacquire();
      }
      lastTimeRef.current = ct;
    }, 1500);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      if (stuckCheckRef.current) { clearInterval(stuckCheckRef.current); stuckCheckRef.current = null; }
    };
  }, [vol]); // eslint-disable-line react-hooks/exhaustive-deps

  return { forceReacquire };
}

export default useAudioResumeGuard;
