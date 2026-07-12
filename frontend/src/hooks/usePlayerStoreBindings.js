/**
 * usePlayerStoreBindings — App lee/escribe el playerStore como fuente de verdad.
 *
 * Antes: useState local + useEffect mirror → doble estado y carátulas/UI desfasadas.
 * Ahora: selectores Zustand + setters con soporte de updater function (como useState).
 *
 * La política de audio (audioMachine) vive en playerStore.dispatchPolicy;
 * usePlaybackController orquesta play/toggle/next/seek. Aquí solo el estado
 * React-facing (track, playing, time, queue, …).
 */
import { useCallback, useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore.js';
import { loadPlayerState, trackById, bestCoverFor } from '../catalog.js';
import { isStreamUrlFresh } from '../audioContinuity.js';

function makeSetter(key) {
  return (value) => {
    usePlayerStore.setState((s) => ({
      [key]: typeof value === 'function' ? value(s[key]) : value,
    }));
  };
}

/** Hidrata el store una sola vez desde localStorage (al cargar la app). */
export function hydratePlayerStoreOnce() {
  if (typeof window === 'undefined') return;
  if (window.__velocityPlayerHydrated) return;
  window.__velocityPlayerHydrated = true;

  const s = loadPlayerState();
  if (!s?.track) return;
  const cached = trackById(s.track.id);
  let track = s.track;
  if (cached?.cover && !track.cover) track = { ...track, cover: cached.cover };
  else {
    const best = bestCoverFor(track.id, track.cover || '');
    if (best) track = { ...track, cover: best };
  }
  const u = track.url || null;
  const playSrc = isStreamUrlFresh(u) ? u : null;
  const queue = Array.isArray(s.queue) && s.queue.length ? s.queue : (track.id ? [track.id] : []);

  usePlayerStore.setState({
    track,
    playing: false,
    time: s.t || 0,
    duration: 0,
    queue,
    playSrc,
    loadingAudio: false,
  });
}

/**
 * Hook principal: estado del player + setters compatibles con el código de App.
 */
export function usePlayerStoreBindings() {
  // Hidratar antes del primer paint de suscriptores (idempotente).
  const hydrated = useRef(false);
  if (!hydrated.current) {
    hydratePlayerStoreOnce();
    hydrated.current = true;
  }

  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const time = usePlayerStore((s) => s.time);
  const dur = usePlayerStore((s) => s.duration);
  const vol = usePlayerStore((s) => s.volume);
  const expanded = usePlayerStore((s) => s.expanded);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const queue = usePlayerStore((s) => s.queue);
  const loadingAudio = usePlayerStore((s) => s.loadingAudio);
  const playSrc = usePlayerStore((s) => s.playSrc);
  const mediaInterrupted = usePlayerStore((s) => s.mediaInterrupted);
  const outputs = usePlayerStore((s) => s.outputs);
  const sinkId = usePlayerStore((s) => s.sinkId);
  const remotePlaying = usePlayerStore((s) => s.remotePlaying);
  const downloaded = usePlayerStore((s) => s.downloaded);
  const downloading = usePlayerStore((s) => s.downloading);

  const setTrack = useCallback(makeSetter('track'), []);
  const setPlaying = useCallback(makeSetter('playing'), []);
  const setTime = useCallback(makeSetter('time'), []);
  const setDur = useCallback((v) => {
    usePlayerStore.setState((s) => ({
      duration: typeof v === 'function' ? v(s.duration) : v,
    }));
  }, []);
  const setVol = useCallback((v) => {
    usePlayerStore.setState((s) => ({
      volume: typeof v === 'function' ? v(s.volume) : v,
    }));
  }, []);
  const setExpanded = useCallback(makeSetter('expanded'), []);
  const setShuffle = useCallback(makeSetter('shuffle'), []);
  const setRepeat = useCallback(makeSetter('repeat'), []);
  const setQueue = useCallback(makeSetter('queue'), []);
  const setLoadingAudio = useCallback(makeSetter('loadingAudio'), []);
  const setPlaySrc = useCallback(makeSetter('playSrc'), []);
  const setMediaInterrupted = useCallback(makeSetter('mediaInterrupted'), []);
  const setOutputs = useCallback(makeSetter('outputs'), []);
  const setSinkId = useCallback(makeSetter('sinkId'), []);
  const setRemotePlaying = useCallback(makeSetter('remotePlaying'), []);
  const setDownloaded = useCallback(makeSetter('downloaded'), []);
  const setDownloading = useCallback(makeSetter('downloading'), []);

  // Mantener carátula enriquecida cuando el catálogo gana cover offline.
  useEffect(() => {
    if (!track?.id) return;
    const best = bestCoverFor(track.id, track.cover || track.artworkUrl || '');
    if (best && best !== track.cover) {
      setTrack((prev) => (prev && prev.id === track.id ? { ...prev, cover: best } : prev));
    }
  }, [track?.id, track?.cover, setTrack]);

  return {
    track, setTrack,
    playing, setPlaying,
    time, setTime,
    dur, setDur,
    vol, setVol,
    expanded, setExpanded,
    shuffle, setShuffle,
    repeat, setRepeat,
    queue, setQueue,
    loadingAudio, setLoadingAudio,
    playSrc, setPlaySrc,
    mediaInterrupted, setMediaInterrupted,
    outputs, setOutputs,
    sinkId, setSinkId,
    remotePlaying, setRemotePlaying,
    downloaded, setDownloaded,
    downloading, setDownloading,
  };
}

export default usePlayerStoreBindings;
