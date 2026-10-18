/** OS controls and artwork have their own lifecycle, independent of audio URLs. */
import { useEffect, useRef } from 'react';
import { bestCoverFor } from '../catalog.js';
import { hiResCover } from '../helpers.js';
import { mediaSessionPlaybackState } from '../audioContinuity.js';
import { usePlayerStore } from '../store/playerStore.js';

export function useMediaSession({
  track, playing, dur, vol, mediaInterrupted, interruptPositionRef,
  audioRef, ctlRef, nextTrackActionRef, prevTrackActionRef,
}) {
  const latest = useRef(null);
  latest.current = { track, vol, audioRef, ctlRef, nextTrackActionRef, prevTrackActionRef };
  const cover = bestCoverFor(track?.id, track?.cover);

  const setMediaSessionState = (state, positionHint) => {
    const session = navigator.mediaSession;
    if (!session) return;
    try { session.playbackState = state; } catch {}
    const duration = audioRef.current?.duration;
    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(positionHint)) {
      try { session.setPositionState?.({ duration, position: Math.min(Math.max(0, positionHint), duration), playbackRate: 1 }); } catch {}
    }
  };

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    if (!track) { try { session.metadata = null; } catch {} return; }
    let cancelled = false, objectUrl = null, image = null, timer = null;
    const controller = new AbortController();
    const appArt = [
      { src: new URL('/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' },
      { src: new URL('/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
    ];
    const apply = artwork => {
      if (cancelled) return;
      try { session.metadata = new MediaMetadata({ title: track.title || '', artist: track.artist || '', album: track.album || '', artwork }); } catch {}
    };
    if (cover && /^(data:|blob:)/i.test(cover)) {
      apply(appArt);
      timer = setTimeout(() => controller.abort(), 8000);
      (async () => {
        try {
          // Prefer an IDB-backed URL that the OS can request independently of
          // this document. Validate the route: old/uncontrolled workers fall
          // back to the local blob, with no dependency on the network.
          const localArt = new URL('/offline-artwork/' + encodeURIComponent(track.id), location.href).href;
          if (navigator.serviceWorker?.controller && track.id) {
            try {
              const local = await fetch(localArt, { signal: controller.signal, cache: 'no-store' });
              if (local.ok && /^image\//i.test(local.headers?.get('content-type') || '')) {
                apply([{ src: localArt, type: local.headers.get('content-type') }]);
                return;
              }
            } catch { /* data/blob cover remains available */ }
          }
          if (cancelled) return;
          const response = await fetch(cover, { signal: controller.signal.aborted ? undefined : controller.signal });
          if (!response.ok) return;
          const blob = await response.blob();
          if (cancelled || !blob.size || !blob.type.startsWith('image/')) return;
          objectUrl = URL.createObjectURL(blob);
          apply([{ src: objectUrl, type: blob.type }]);
        } catch { /* fallback remains visible */ }
        finally { clearTimeout(timer); }
      })();
    } else if (cover) {
      try {
        // Covers normalized by catalog are commonly /img?u=...&id=... .
        // Use the same resilient proxy as the app and an absolute URL for OS.
        const src = new URL(hiResCover(cover, 512), location.href);
        if (!['http:', 'https:'].includes(src.protocol)) throw new Error('invalid artwork');
        apply([{ src: src.href }]); // no invented JPEG MIME or dimensions
        image = new Image();
        image.onload = () => { clearTimeout(timer); };
        image.onerror = () => { clearTimeout(timer); apply(appArt); };
        timer = setTimeout(() => { image.onload = null; image.onerror = null; }, 8000);
        image.src = src.href;
      } catch { apply(appArt); }
    } else apply(appArt);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      if (image) { image.onload = null; image.onerror = null; }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [track?.id, track?.title, track?.artist, track?.album, cover]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session?.setActionHandler) return;
    const actions = {
      play: () => {
        const p = latest.current;
        const el = p.audioRef.current;
        const ctl = p.ctlRef.current;
        if (!el || !ctl?.getMachine || !ctl.dispatchAudio) return;
        if (el.volume < p.vol * 0.5) el.volume = p.vol;
        if (ctl.getMachine().trackId) ctl.dispatchAudio({ type: 'USER_PLAY' });
        else if (p.track?.id) ctl.dispatchAudio({ type: 'TRACK_SET', trackId: p.track.id, intent: 'play' });
      },
      pause: () => latest.current.ctlRef.current?.dispatchAudio?.({ type: 'USER_PAUSE' }),
      stop: () => latest.current.ctlRef.current?.dispatchAudio?.({ type: 'USER_PAUSE' }),
      previoustrack: () => latest.current.prevTrackActionRef.current?.(),
      nexttrack: () => latest.current.nextTrackActionRef.current?.(),
      seekto: event => { if (Number.isFinite(event.seekTime)) latest.current.ctlRef.current?.seek?.(event.seekTime); },
      seekforward: event => relativeSeek(1, event),
      seekbackward: event => relativeSeek(-1, event),
    };
    const relativeSeek = (direction, event) => {
      const p = latest.current, el = p.audioRef.current;
      if (!el) return;
      const offset = Number.isFinite(event?.seekOffset) && event.seekOffset > 0 ? event.seekOffset : 10;
      const duration = Number.isFinite(el.duration) ? el.duration : Infinity;
      p.ctlRef.current?.seek?.(Math.max(0, Math.min(duration, (el.currentTime || 0) + direction * offset)));
    };
    for (const [action, handler] of Object.entries(actions)) {
      try { session.setActionHandler(action, handler); } catch { /* unsupported action must not crash the player */ }
    }
    return () => {
      for (const action of Object.keys(actions)) { try { session.setActionHandler(action, null); } catch {} }
    };
  }, []);

  useEffect(() => {
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = mediaSessionPlaybackState({ userWantsPlay: playing, yieldedFocus: mediaInterrupted }); } catch {}
  }, [playing, mediaInterrupted]);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session?.setPositionState) return;
    let last = { at: -Infinity, position: 0 };
    const apply = () => {
      const state = usePlayerStore.getState();
      const duration = state.duration;
      if (!(duration > 0 && Number.isFinite(duration))) return;
      const position = Math.min(Math.max(0, mediaInterrupted && interruptPositionRef.current != null ? interruptPositionRef.current : state.time), duration);
      const now = Date.now();
      if (now - last.at < 1000 && Math.abs(position - last.position) < 1.5) return;
      try {
        session.setPositionState({ duration, position, playbackRate: 1 });
        last = { at: now, position };
      } catch {}
    };
    apply();
    let lastTime = usePlayerStore.getState().time;
    return usePlayerStore.subscribe(state => { if (state.time !== lastTime) { lastTime = state.time; apply(); } });
  }, [dur, playing, mediaInterrupted, track?.id, interruptPositionRef]);

  return { setMediaSessionState };
}

export default useMediaSession;
