/**
 * usePlaybackController — orquestación de play / toggle / next / prev / seek.
 *
 * Política de audio: playerStore.dispatchPolicy (única machine en runtime).
 * App solo provee refs DOM, quality, toasts y callbacks de UI (playingFrom).
 */
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api.js';
import * as offline from '../offline.js';
import { slimTrack } from '../helpers.js';
import { mergeRadioTail } from '../radioNext.js';
import { cacheTrack, trackById, saveMeta, bestCoverFor, normalizeTrack } from '../catalog.js';
import { isDocumentVisible, shouldFadeIn, isStreamUrlFresh } from '../audioContinuity.js';
import { runAudioEffects, bumpAudioEpoch } from '../audio/runAudioEffects.js';
import { usePlayerStore } from '../store/playerStore.js';
import { enrichCoverIfNeeded } from '../coverEnrich.js';

const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };

/**
 * Ejecuta trabajo NO crítico (persistencia en localStorage, telemetría) fuera
 * del camino crítico de arranque de audio. Sin esto, serializar el catálogo y
 * el estado del player de forma síncrona al pulsar play bloquea el hilo
 * principal justo cuando aparece el spinner y retrasa el play() real.
 */
function runWhenIdle(fn) {
  try {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => { try { fn(); } catch { /* ignore */ } }, { timeout: 800 });
    } else {
      setTimeout(() => { try { fn(); } catch { /* ignore */ } }, 0);
    }
  } catch {
    try { fn(); } catch { /* ignore */ }
  }
}

/**
 * @param {object} deps
 */
export function usePlaybackController(deps) {
  const {
    audioRef,
    selfPauseRef,
    playingRef,
    fadeRafRef,
    fadeSafetyRef,
    pendingFadeRef,
    objUrlRef,
    queueRef,
    trackRef,
    radioRef,
    radioSeedRef,
    mixSessionRef,
    nextTrackActionRef,
    prevTrackActionRef,
    sessionResumeRef,
    systemPausedRef,
    interruptPositionRef,
    interruptTrackIdRef,
    quality,
    backendDown,
    downloaded,
    track,
    playing,
    time,
    vol,
    queue,
    shuffle,
    setTrack,
    setPlaying,
    setTime,
    setPlaySrc,
    setLoadingAudio,
    setMediaInterrupted,
    setQueue,
    setRecent,
    setPlayingFrom,
    showToast,
    recordPlayStat,
    setMediaSessionState,
    // Refs de error que deben resetearse en cada play() explícito:
    // sin esto, fallos consecutivos de pistas distintas de la misma lista
    // llegan al límite anti-cascada y detienen la reproducción (bug stuck-0:00).
    playErrorRef: playErrorRefDep,
    consecutiveFailsRef: consecutiveFailsRefDep,
  } = deps;

  const effectCtxRef = useRef({});
  const ensureStreamFnRef = useRef(async () => {});
  const playGenRef = useRef(0);
  const prefetchedRef = useRef(new Set());
  /** Fallos de firma por trackId — evita bucle PLAY_FAILED↔ensureStream y toasts falsos. */
  const signFailRef = useRef({ id: null, n: 0 });
  /** Snapshot de la pista pedida en play() (por si trackById aún no la tiene). */
  const playSnapRef = useRef(null);
  /** Evita fan-out duplicado al iniciar/reponer una misma radio. */
  const radioRequestRef = useRef(null);
  /** Prebuffer completo a Blob de la pista actual (anti-tartamudeo en multitarea). */
  const prebufferRef = useRef({ id: null, controller: null, timer: null });
  const prebufferFnRef = useRef(() => {});
  const cancelPrebufferRef = useRef(() => {});

  const getMachine = useCallback(() => usePlayerStore.getState().getMachineState(), []);
  const patchMachine = useCallback((p) => usePlayerStore.getState().patchMachine(p), []);

  const syncMirrorsFromMachine = useCallback((s) => {
    playingRef.current = s.intent === 'play';
    systemPausedRef.current = s.focus === 'yielded';
    interruptPositionRef.current = s.yieldPosition;
    interruptTrackIdRef.current = s.yieldTrackId;
    sessionResumeRef.current =
      s.sessionPosition != null && s.trackId
        ? { trackId: s.trackId, position: s.sessionPosition }
        : null;
  }, [playingRef, systemPausedRef, interruptPositionRef, interruptTrackIdRef, sessionResumeRef]);

  const dispatchAudio = useCallback((event) => {
    const { state } = usePlayerStore.getState().dispatchPolicy(event);
    syncMirrorsFromMachine(state);
    return state;
  }, [syncMirrorsFromMachine]);

  // Registrar effect ctx en el store cada render (refs mutables).
  effectCtxRef.current = {
    audioRef,
    selfPauseRef,
    playingRef,
    setPlaySrc,
    setPlaying,
    setTime,
    setLoadingAudio,
    setMediaInterrupted,
    setMediaSessionState,
    vol,
    showToast,
    getIntent: () => getMachine().intent,
    ensureStream: (trackId) => { ensureStreamFnRef.current(trackId); },
    onPlayOk: (a) => {
      const tid = getMachine().trackId;
      dispatchAudio({
        type: 'PLAYING',
        position: a?.currentTime || 0,
        trackId: tid || undefined,
      });
    },
    onPlayFail: (err) => {
      if (err?.name === 'NotAllowedError') {
        dispatchAudio({ type: 'USER_PAUSE' });
        showToast?.('Toca de nuevo para reproducir');
        return;
      }
      dispatchAudio({ type: 'PLAY_FAILED', reason: err?.name || 'play' });
    },
  };
  usePlayerStore.getState().setPolicyEffectCtx(effectCtxRef.current);

  useEffect(() => () => {
    usePlayerStore.getState().setPolicyEffectCtx(null);
    try { cancelPrebufferRef.current(); } catch { /* ignore */ }
  }, []);

  const clearYieldedFocus = useCallback(() => {
    const m = getMachine();
    if (m.focus === 'yielded') {
      const next = patchMachine({
        focus: 'own',
        yieldPosition: null,
        yieldTrackId: null,
      });
      syncMirrorsFromMachine(next);
    }
    systemPausedRef.current = false;
    setMediaInterrupted(false);
  }, [getMachine, patchMachine, syncMirrorsFromMachine, systemPausedRef, setMediaInterrupted]);

  const restoreInterruptPosition = useCallback((a) => {
    if (!a || getMachine().focus !== 'yielded') return;
    const saved = getMachine().yieldPosition;
    if (saved == null) return;
    if ((a.currentTime || 0) >= saved - 1.25) return;
    try { a.currentTime = saved; setTime(saved); } catch { /* ignore */ }
  }, [getMachine, setTime]);

  const applySessionResume = useCallback((a) => {
    if (!a || a.readyState < 1) return false;
    const s = getMachine();
    // Tras TRACK_SET no hay src: no aplicar sesión (evita clavar min X de la pista vieja).
    if (s.srcStatus === 'none' || s.sessionPosition == null || !s.trackId) return false;
    if ((a.currentTime || 0) >= 1.5 && Math.abs((a.currentTime || 0) - s.sessionPosition) < 1.25) return false;
    if ((a.currentTime || 0) > s.sessionPosition + 1.25) return false;
    try {
      a.currentTime = s.sessionPosition;
      setTime(s.sessionPosition);
      return true;
    } catch { return false; }
  }, [getMachine, setTime]);

  const streamParamsFor = useCallback((nt, qParam) => ({
    artist: nt.artist,
    title: nt.title,
    id: nt.id,
    quality: qParam,
    stream: (nt.source === 'soundcloud' && nt.stream) ? nt.stream : undefined,
  }), []);

  const fadeInAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(fadeRafRef.current);
    clearTimeout(fadeSafetyRef.current);
    const target = vol;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      a.volume = target;
      return;
    }
    a.volume = 0;
    const start = performance.now();
    const durMs = 130;
    const step = (now) => {
      const p = Math.min(1, (now - start) / durMs);
      a.volume = target * (p * (2 - p));
      if (p < 1) fadeRafRef.current = requestAnimationFrame(step);
      else a.volume = target;
    };
    fadeRafRef.current = requestAnimationFrame(step);
    fadeSafetyRef.current = setTimeout(() => {
      cancelAnimationFrame(fadeRafRef.current);
      if (audioRef.current) audioRef.current.volume = target;
    }, durMs + 350);
  }, [audioRef, fadeRafRef, fadeSafetyRef, vol]);

  // ── Prebuffer completo a Blob de la pista actual (anti-tartamudeo en multitarea) ──
  // Descarga la pista completa en segundo plano y cambia el <audio> a un blob:
  // local. Con la pista en memoria, la reproducción es inmune a los bajones de
  // ancho de banda cuando otra app (p. ej. Instagram) satura la red del móvil.
  // La posición se preserva vía la máquina: STREAM_READY con srcStatus 'ready'
  // hace seek a livePosition (que fijamos al currentTime real antes del swap).
  // No aplica a pistas descargadas (ya son blob) ni a fuentes ya locales.
  cancelPrebufferRef.current = () => {
    const p = prebufferRef.current;
    if (p.timer) { try { clearTimeout(p.timer); } catch { /* ignore */ } }
    if (p.controller) { try { p.controller.abort(); } catch { /* ignore */ } }
    prebufferRef.current = { id: null, controller: null, timer: null };
  };

  prebufferFnRef.current = (trackId, url) => {
    if (!trackId || typeof url !== 'string') return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return; // ya local
    if (downloaded.has(trackId)) return;                             // ya offline
    if (prebufferRef.current.id === trackId) return;                 // ya en curso/hecho
    cancelPrebufferRef.current();
    const controller = new AbortController();
    // Retraso corto: dar ventaja al arranque del <audio> antes de competir por
    // ancho de banda con la descarga completa.
    const timer = setTimeout(async () => {
      let blob = null;
      try {
        // priority:'low' evita que la descarga completa robe ancho de banda al
        // buffering inicial del elemento. El proxy solo exige firma HMAC (no Bearer).
        const res = await fetch(url, { signal: controller.signal, priority: 'low' });
        if (!res.ok) return;
        blob = await res.blob();
      } catch { return; } // abort / red: la reproducción sigue en streaming normal
      if (controller.signal.aborted) return;
      // La pista debe seguir siendo la actual y sonando.
      if (prebufferRef.current.id !== trackId) return;
      if (getMachine().trackId !== trackId || getMachine().intent !== 'play') return;
      if (!blob || blob.size < 4096) return;
      const a = audioRef.current;
      const curSrc = (a && (a.currentSrc || a.getAttribute('src'))) || '';
      if (curSrc.startsWith('blob:')) return; // ya reproduce un blob
      const objUrl = URL.createObjectURL(blob);
      if (objUrlRef.current) { try { URL.revokeObjectURL(objUrlRef.current); } catch { /* ignore */ } }
      objUrlRef.current = objUrl;
      // Preservar la posición real: el reducer de STREAM_READY hace seek a
      // livePosition cuando srcStatus==='ready' (swap mid-play).
      const pos = a && Number.isFinite(a.currentTime) ? a.currentTime : (getMachine().livePosition || 0);
      patchMachine({ livePosition: pos > 1.5 ? pos : 0 });
      // El cambio de src dispara un evento 'pause' del <audio>; marcarlo como
      // self-pause para que onPause no lo interprete como pausa externa (yield).
      if (selfPauseRef) selfPauseRef.current = true;
      dispatchAudio({ type: 'STREAM_READY', trackId, url: objUrl });
      setTimeout(() => { if (selfPauseRef) selfPauseRef.current = false; }, 1500);
    }, 3000);
    prebufferRef.current = { id: trackId, controller, timer };
  };

  ensureStreamFnRef.current = async (trackId) => {
    const t = trackById(trackId)
      || (trackRef.current?.id === trackId ? trackRef.current : null)
      || (playSnapRef.current?.id === trackId ? playSnapRef.current : null);
    if (!t || !t.title) {
      // Reintento corto: a veces el catálogo aún no tiene la meta.
      const n = signFailRef.current.id === trackId ? signFailRef.current.n + 1 : 1;
      signFailRef.current = { id: trackId, n };
      if (n <= 2) {
        await new Promise((r) => setTimeout(r, 120));
        if (getMachine().trackId === trackId) return ensureStreamFnRef.current(trackId);
      }
      setLoadingAudio?.(false);
      return;
    }
    if (!t.artist) {
      // Firma exige artist+title; sin artista no hay stream-sign.
      setLoadingAudio?.(false);
      showToast?.('Falta el artista de esta pista. Prueba buscarla de nuevo.');
      return;
    }
    const qParam = QUALITY_MAP[quality] || 'high';
    const sp = streamParamsFor(t, qParam);
    try {
      if (downloaded.has(trackId)) {
        const b = await offline.getBlob(trackId);
        if (b && getMachine().trackId === trackId) {
          if (objUrlRef.current) { try { URL.revokeObjectURL(objUrlRef.current); } catch { /* ignore */ } }
          const u = URL.createObjectURL(b);
          objUrlRef.current = u;
          signFailRef.current = { id: null, n: 0 };
          dispatchAudio({ type: 'STREAM_READY', trackId, url: u });
          return;
        }
      }
      // Warm resolve en paralelo (no bloquear firma). No repetirlo si la
      // siguiente pista ya fue precalentada por prefetchNext: duplicar esta
      // petición durante el arranque hace que el spinner parpadee y compite
      // por CPU/red con la resolución que sí necesita la pista actual.
      const warmKey = `${trackId}:${qParam}`;
      if (!prefetchedRef.current.has(warmKey)) {
        prefetchedRef.current.add(warmKey);
        api.prefetchStream(sp);
        if (prefetchedRef.current.size > 40) {
          prefetchedRef.current = new Set([...prefetchedRef.current].slice(-20));
        }
      }
      let url = api.peekStreamUrl(sp, 30);
      if (!url) url = await api.ensureStreamUrl(sp);
      if (getMachine().trackId !== trackId || getMachine().intent !== 'play') return;
      setTrack((prev) => (prev && prev.id === trackId ? { ...prev, url } : { ...t, url }));
      signFailRef.current = { id: null, n: 0 };
      dispatchAudio({ type: 'STREAM_READY', trackId, url });
      prebufferFnRef.current(trackId, url);
    } catch (err) {
      if (getMachine().trackId !== trackId || getMachine().intent !== 'play') return;
      const n = signFailRef.current.id === trackId ? signFailRef.current.n + 1 : 1;
      signFailRef.current = { id: trackId, n };
      if (n <= 2) {
        api._streamSignCache?.delete?.(api._streamSignKey?.(sp));
        await new Promise((r) => setTimeout(r, 350 * n));
        if (getMachine().trackId === trackId && getMachine().intent === 'play') {
          return ensureStreamFnRef.current(trackId);
        }
        return;
      }
      if (err?.status === 401) {
        showToast?.('Sesión caducada. Vuelve a iniciar sesión.');
        dispatchAudio({ type: 'USER_PAUSE' });
      } else {
        // Retries agotados y sin src en el elemento: handleAudioError no
        // disparará porque currentSrc está vacío (TRACK_SET hizo clearSrc).
        // Despachar USER_PAUSE para sacar la máquina del estado
        // { intent:'play', srcStatus:'none' } que deja la UI bloqueada en
        // "playing" sin audio y sin posibilidad de recuperarse (stuck 0:00).
        showToast?.('No se pudo obtener el audio. Toca play para reintentar.');
        dispatchAudio({ type: 'USER_PAUSE' });
        setLoadingAudio?.(false);
      }
    }
  };

  const prefetchNext = useCallback((currentId, ids, qParam) => {
    if (!ids || ids.length < 2) return;
    const i = ids.indexOf(currentId);
    if (i === -1) return;
    // Solo la siguiente (antes 4 pistas en paralelo → lag de red/CPU).
    const nextId = ids[(i + 1) % ids.length];
    if (!nextId || nextId === currentId || downloaded.has(nextId)) return;
    const nt = trackById(nextId);
    if (!nt) return;
    const key = nextId + ':' + qParam;
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);
    const sp = streamParamsFor(nt, qParam);
    api.warmStreamUrl(sp);
    api.prefetchStream({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam });
    if (prefetchedRef.current.size > 40) {
      prefetchedRef.current = new Set([...prefetchedRef.current].slice(-20));
    }
  }, [downloaded, streamParamsFor]);

  const ensureRadioFull = useCallback(async (seed, existingIds = []) => {
    if (!seed?.id) return;
    radioSeedRef.current = seed.id;
    if (radioRequestRef.current === seed.id) return;
    radioRequestRef.current = seed.id;
    const existing = new Set(existingIds);
    try {
      const raw = await api.radio(seed.id, 40);
      if (radioSeedRef.current !== seed.id) return;
      const rawTracks = raw.map(normalizeTrack).filter((t) => t.id && t.id !== seed.id);
      // Fusión con calidad contra la cola COMPLETA: dedup por id/título, versión de
      // estudio preferida, sin artista consecutivo y cap por artista (Req 5, 6).
      const existingTracks = [...existing].map(trackById).filter(Boolean);
      const more = mergeRadioTail(existingTracks, rawTracks, { maxPerArtist: 5 })
        .filter((t) => !existing.has(t.id));
      if (!more.length) return;
      // Cachear las pistas para que trackById las resuelva al reproducirlas.
      more.forEach(cacheTrack);
      // Objetivo de cola coherente (TARGET_QUEUE_LENGTH). Req 6.1, 6.5.
      const addIds = more.slice(0, 40).map((t) => t.id);
      setQueue((q) => {
        const base = q && q.length ? q : [seed.id];
        const merged = [...base];
        addIds.forEach((id) => { if (!merged.includes(id)) merged.push(id); });
        return merged;
      });
    } catch { /* ignore */ }
    finally {
      if (radioRequestRef.current === seed.id) radioRequestRef.current = null;
    }
  }, [radioSeedRef, radioRequestRef, setQueue]);

  const applyOnlineSrc = useCallback((t, sp, gen, fallbackTrack) => {
    const peeked = api.peekStreamUrl(sp, 90);
    if (peeked) {
      setTrack({ ...t, url: peeked });
      dispatchAudio({ type: 'STREAM_READY', trackId: t.id, url: peeked });
      return;
    }
    api.ensureStreamUrl(sp).then((signedUrl) => {
      if (playGenRef.current !== gen || getMachine().trackId !== t.id) return;
      setTrack({ ...t, url: signedUrl });
      dispatchAudio({ type: 'STREAM_READY', trackId: t.id, url: signedUrl });
    }).catch(() => {
      if (playGenRef.current !== gen) return;
      if (fallbackTrack?.url && isStreamUrlFresh(fallbackTrack.url)) {
        dispatchAudio({ type: 'STREAM_READY', trackId: t.id, url: fallbackTrack.url });
      } else {
        dispatchAudio({ type: 'PLAY_FAILED', reason: 'sign' });
      }
    });
  }, [dispatchAudio, getMachine, setTrack]);

  const afterPlaySideEffects = useCallback((t, trackWithQuality, initialQueue, qParam, opts) => {
    setRecent((r) => [t.id, ...r.filter((x) => x !== t.id)].slice(0, 30));
    recordPlayStat?.(t);
    api.recordHistory(t.id).catch(() => {});
    api.updateNowPlaying({
      trackId: t.id, title: t.title, artist: t.artist, cover: t.cover, position: 0,
      duration: t.durationSeconds || 0, playing: true,
      deviceName: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Web', quality: qParam,
    });
    // Persistencia pesada (serializa catálogo + estado) fuera del camino
    // crítico: no debe bloquear el arranque del audio ni el spinner.
    runWhenIdle(() => {
      api.saveTracks([slimTrack(t)]);
      try {
        localStorage.setItem('velocity.player', JSON.stringify({ track: trackWithQuality, queue: initialQueue, t: 0 }));
      } catch { /* ignore */ }
    });
    prefetchNext(t.id, initialQueue, qParam);
    if (opts.radio) {
      radioRef.current = true;
      ensureRadioFull(t, initialQueue);
    } else if (!opts.keepMix) {
      radioRef.current = false;
      radioSeedRef.current = null;
    } else if (radioRef.current && radioSeedRef.current) {
      // Sesión de radio en curso (avance por next/keepMix): reponer la cola
      // coherente cuando quedan < 5 pistas pendientes. Req 6.4, 6.5.
      const q = (queueRef.current && queueRef.current.length) ? queueRef.current : initialQueue;
      const idx = Array.isArray(q) ? q.indexOf(t.id) : -1;
      const pending = idx >= 0 ? q.length - idx - 1 : 0;
      if (pending < 5) {
        const seedTrack = trackById(radioSeedRef.current) || t;
        ensureRadioFull(seedTrack, q);
      }
    }
    if (opts.mixLabel) mixSessionRef.current = { label: opts.mixLabel, used: new Set([opts.mixLabel]) };
    else if (!opts.keepMix) mixSessionRef.current = { label: null, used: new Set() };
  }, [setRecent, recordPlayStat, prefetchNext, radioRef, radioSeedRef, mixSessionRef, ensureRadioFull]);

  const play = useCallback((t, list, opts = {}) => {
    if (!t) return;
    if (opts.from !== undefined) setPlayingFrom?.(opts.from);
    const best = bestCoverFor(t.id, t.cover || t.artworkUrl || '');
    if (best && best !== t.cover) t = { ...t, cover: best };
    else if (!t.cover && t.artworkUrl) t = { ...t, cover: t.artworkUrl };
    cacheTrack(t); runWhenIdle(saveMeta);
    playSnapRef.current = t;

    // Enriquecimiento de carátula: si es un thumbnail de YouTube, buscar en
    // iTunes en background (no bloquea la reproducción).
    enrichCoverIfNeeded(t, (id, coverUrl) => {
      // Actualizar catálogo preservando todos los campos existentes de la pista.
      const existing = trackById(id);
      if (existing) {
        cacheTrack({ ...existing, cover: coverUrl });
        saveMeta();
      }
      setTrack((prev) => {
        if (!prev || prev.id !== id) return prev;
        if (prev.cover === coverUrl) return prev;
        return { ...prev, cover: coverUrl };
      });
    });

    // 1) Invalidar plays/seeks de la pista anterior (timeouts schedulePlay).
    const gen = ++playGenRef.current;
    signFailRef.current = { id: null, n: 0 };
    // Resetear contadores de error: una acción explícita del usuario (nuevo track)
    // debe empezar limpia. Sin esto, fallos de pistas anteriores acumulan en
    // consecutiveFailsRef y disparan el corte anti-cascada antes de tiempo.
    if (playErrorRefDep) playErrorRefDep.current = { id: null, n: 0 };
    if (consecutiveFailsRefDep) consecutiveFailsRefDep.current = 0;
    try {
      cancelAnimationFrame(fadeRafRef.current);
      clearTimeout(fadeSafetyRef.current);
    } catch { /* ignore */ }

    // 2) Pause suave + epoch. El clearSrc real lo hace TRACK_SET una sola vez
    //    (doble hardStop + bump extra mataba el schedulePlay de STREAM_READY).
    const a = audioRef.current;
    if (a) {
      try {
        if (selfPauseRef) selfPauseRef.current = true;
        a.pause();
        if (selfPauseRef) selfPauseRef.current = false;
      } catch { /* ignore */ }
    }
    bumpAudioEpoch(effectCtxRef.current);

    const visible = isDocumentVisible();
    if (a && shouldFadeIn(visible)) { a.volume = 0; pendingFadeRef.current = true; }
    else { if (a) a.volume = vol; pendingFadeRef.current = false; }
    const initialQueue = list && list.length ? list : [t.id];
    setQueue(initialQueue);
    const qParam = QUALITY_MAP[quality] || 'high';
    const sp = streamParamsFor(t, qParam);

    cancelPrebufferRef.current();
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }

    // TRACK_SET: live/session=0, clearSrc (hardStop), ensureStream. Seek 0.
    // No volver a bumpAudioEpoch aquí: STREAM_READY del peek/sign debe
    // schedulePlay con el epoch del clearSrc.
    dispatchAudio({ type: 'TRACK_SET', trackId: t.id, intent: 'play' });
    setTime(0);

    if (downloaded.has(t.id)) {
      const trackWithQuality = { ...t, url: api.streamUrl(sp) };
      setTrack(trackWithQuality);
      offline.getBlob(t.id).then((b) => {
        if (playGenRef.current !== gen || getMachine().trackId !== t.id) return;
        if (b) {
          const u = URL.createObjectURL(b);
          objUrlRef.current = u;
          dispatchAudio({ type: 'STREAM_READY', trackId: t.id, url: u });
        } else applyOnlineSrc(t, sp, gen, trackWithQuality);
      }).catch(() => {
        if (playGenRef.current === gen) applyOnlineSrc(t, sp, gen, { ...t, url: api.streamUrl(sp) });
      });
      afterPlaySideEffects(t, { ...t, url: api.streamUrl(sp) }, initialQueue, qParam, opts);
      return;
    }

    if (backendDown) {
      setTrack({ ...t, url: '' });
      dispatchAudio({ type: 'USER_PAUSE' });
      setPlaySrc(null);
      showToast?.('Sin conexión: esta canción no está descargada');
      return;
    }

    const trackWithQuality = { ...t, url: api.streamUrl(sp) };
    setTrack(trackWithQuality);
    afterPlaySideEffects(t, trackWithQuality, initialQueue, qParam, opts);

    // UN solo camino de firma: TRACK_SET → ensureStream (arriba).
    // El warm resolve también vive en ensureStream, para no lanzar una
    // segunda resolución en paralelo cada vez que se pulsa play.
    const peeked = api.peekStreamUrl(sp, 45);
    if (peeked) {
      dispatchAudio({ type: 'STREAM_READY', trackId: t.id, url: peeked });
      prebufferFnRef.current(t.id, peeked);
    }
    // Si no hay peek: ensureStream del TRACK_SET firma y hace STREAM_READY.
    // No llamar ensureStreamUrl aquí (duplicaba firma → un catch tocaba toast
    // aunque el otro camino arrancara el audio).
  }, [
    setPlayingFrom, audioRef, fadeRafRef, fadeSafetyRef, selfPauseRef, pendingFadeRef,
    vol, setQueue, quality, streamParamsFor, objUrlRef, dispatchAudio, setTime, downloaded,
    setTrack, getMachine, applyOnlineSrc, afterPlaySideEffects, backendDown, setPlaySrc, showToast,
    playErrorRefDep, consecutiveFailsRefDep,
  ]);

  const togglePlay = useCallback(() => {
    if (!track) return;
    if (getMachine().intent === 'play' || playingRef.current || playing) {
      dispatchAudio({ type: 'USER_PAUSE' });
      api.updateNowPlaying({
        trackId: track.id, title: track.title, artist: track.artist, cover: track.cover,
        position: audioRef.current?.currentTime || time || 0, duration: track.durationSeconds || 0,
        playing: false, deviceName: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Web', quality: '',
      });
      return;
    }
    if (getMachine().trackId !== track.id) {
      dispatchAudio({ type: 'TRACK_SET', trackId: track.id, intent: 'play' });
    } else {
      dispatchAudio({ type: 'USER_PLAY' });
    }
    const pos = getMachine().sessionPosition ?? getMachine().livePosition ?? time ?? 0;
    api.updateNowPlaying({
      trackId: track.id, title: track.title, artist: track.artist, cover: track.cover,
      position: pos, duration: track.durationSeconds || 0,
      playing: true, deviceName: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Web', quality: '',
    });
  }, [track, getMachine, playingRef, playing, dispatchAudio, audioRef, time]);

  const orderIds = queue.length ? queue : (track ? [track.id] : []);

  const next = useCallback(() => {
    const cur = trackRef.current || track;
    const ids = (queueRef.current && queueRef.current.length)
      ? queueRef.current
      : (orderIds.length ? orderIds : (cur ? [cur.id] : []));
    if (!cur || !ids.length) return;
    if (shuffle && ids.length > 1) {
      let id;
      do { id = ids[Math.floor(Math.random() * ids.length)]; } while (id === cur.id && ids.length > 1);
      const t = trackById(id); if (t) play(t, ids, { keepMix: true }); return;
    }
    const i = ids.indexOf(cur.id);
    if (i === -1) return;
    const t = trackById(ids[(i + 1) % ids.length]);
    if (t) play(t, ids, { keepMix: true });
  }, [track, orderIds, shuffle, trackRef, queueRef, play]);

  const prev = useCallback(() => {
    const cur = trackRef.current || track;
    const ids = (queueRef.current && queueRef.current.length)
      ? queueRef.current
      : (orderIds.length ? orderIds : (cur ? [cur.id] : []));
    if (!cur || !ids.length) return;
    const a = audioRef.current;
    if (a && (a.currentTime || 0) > 3) {
      dispatchAudio({ type: 'USER_SEEK', position: 0 });
      if (getMachine().intent === 'play') runAudioEffects([{ type: 'play' }], effectCtxRef.current);
      return;
    }
    const i = ids.indexOf(cur.id);
    if (i === -1) return;
    const t = trackById(ids[(i - 1 + ids.length) % ids.length]);
    if (t) play(t, ids, { keepMix: true });
  }, [track, orderIds, trackRef, queueRef, audioRef, dispatchAudio, getMachine, play]);

  const seek = useCallback((v) => {
    const pos = Math.max(0, Number(v) || 0);
    dispatchAudio({ type: 'USER_SEEK', position: pos });
    if (audioRef.current && audioRef.current.volume < vol && !pendingFadeRef.current) {
      audioRef.current.volume = vol;
    }
  }, [dispatchAudio, audioRef, vol, pendingFadeRef]);

  if (nextTrackActionRef) nextTrackActionRef.current = next;
  if (prevTrackActionRef) prevTrackActionRef.current = prev;

  const _curIdx = orderIds.indexOf(track?.id);
  const nextCover = orderIds.length > 1 ? (trackById(orderIds[(_curIdx + 1) % orderIds.length]) || {}).cover : null;
  const prevCover = orderIds.length > 1 ? (trackById(orderIds[(_curIdx - 1 + orderIds.length) % orderIds.length]) || {}).cover : null;

  const addToQueue = useCallback((id) => {
    const t = trackById(id); if (!t) return;
    setQueue((q) => {
      const base = q.length ? [...q] : (track ? [track.id] : []);
      const without = base.filter((x) => x !== id);
      const ci = track ? without.indexOf(track.id) : -1;
      if (ci === -1) return [...without, id];
      without.splice(ci + 1, 0, id);
      return without;
    });
    if (!track) play(t);
    showToast?.('Se reproducirá a continuación');
  }, [setQueue, track, play, showToast]);

  const reorderQueue = useCallback((from, to) => {
    setQueue((q) => { const a = [...q]; const [m] = a.splice(from, 1); a.splice(to, 0, m); return a; });
  }, [setQueue]);

  const removeFromQueue = useCallback((id) => {
    setQueue((q) => q.filter((x) => x !== id || x === track?.id));
  }, [setQueue, track?.id]);

  const removeFromQueueToast = useCallback((id) => {
    const inQueue = queue.includes(id) && id !== track?.id;
    removeFromQueue(id);
    showToast?.(inQueue ? 'Eliminada de la cola' : 'No estaba en la cola');
  }, [queue, track?.id, removeFromQueue, showToast]);

  return {
    play,
    togglePlay,
    next,
    prev,
    seek,
    dispatchAudio,
    getMachine,
    patchMachine,
    syncMirrorsFromMachine,
    clearYieldedFocus,
    restoreInterruptPosition,
    applySessionResume,
    fadeInAudio,
    effectCtxRef,
    ensureStreamFnRef,
    playGenRef,
    orderIds,
    nextCover,
    prevCover,
    addToQueue,
    reorderQueue,
    removeFromQueue,
    removeFromQueueToast,
    prefetchNext,
  };
}

export default usePlaybackController;
