/**
 * Ejecuta effects emitidos por audioMachine.reduce.
 * Sin política: solo side-effects (DOM / React / red).
 *
 * @param {object[]} effects
 * @param {object} ctx
 */

export function runAudioEffects(effects, ctx) {
  if (!effects || !effects.length) return;

  let pendingSeek = null;
  let wantPlay = false;

  for (const e of effects) {
    switch (e.type) {
      case 'pause': {
        const a = ctx.audioRef?.current;
        if (ctx.selfPauseRef) ctx.selfPauseRef.current = true;
        try { a?.pause(); } catch {}
        if (ctx.selfPauseRef) ctx.selfPauseRef.current = false;
        break;
      }
      case 'seek': {
        pendingSeek = typeof e.position === 'number' ? e.position : null;
        applySeek(ctx, pendingSeek);
        break;
      }
      case 'setSrc': {
        if (typeof ctx.setPlaySrc === 'function' && e.url) ctx.setPlaySrc(e.url);
        break;
      }
      case 'clearSrc': {
        if (typeof ctx.setPlaySrc === 'function') ctx.setPlaySrc(null);
        break;
      }
      case 'play': {
        wantPlay = true;
        break;
      }
      case 'mediaSession': {
        if (typeof ctx.setMediaSessionState === 'function') {
          ctx.setMediaSessionState(e.state || 'none', e.position);
        }
        break;
      }
      case 'syncReact': {
        const p = e.patch || {};
        if (p.playing === true && typeof ctx.setPlaying === 'function') ctx.setPlaying(true);
        if (p.playing === false && typeof ctx.setPlaying === 'function') ctx.setPlaying(false);
        if (p.loadingAudio === true && typeof ctx.setLoadingAudio === 'function') ctx.setLoadingAudio(true);
        if (p.loadingAudio === false && typeof ctx.setLoadingAudio === 'function') ctx.setLoadingAudio(false);
        if (typeof p.time === 'number' && typeof ctx.setTime === 'function') ctx.setTime(p.time);
        if (p.mediaInterrupted === true && typeof ctx.setMediaInterrupted === 'function') ctx.setMediaInterrupted(true);
        if (p.mediaInterrupted === false && typeof ctx.setMediaInterrupted === 'function') ctx.setMediaInterrupted(false);
        if (ctx.playingRef && typeof p.playing === 'boolean') ctx.playingRef.current = p.playing;
        break;
      }
      case 'ensureStream': {
        if (typeof ctx.ensureStream === 'function' && e.trackId) {
          ctx.ensureStream(e.trackId);
        }
        break;
      }
      case 'toast': {
        if (typeof ctx.showToast === 'function' && e.message) ctx.showToast(e.message);
        break;
      }
      default:
        break;
    }
  }

  if (wantPlay) {
    schedulePlay(ctx, pendingSeek);
  }
}

function applySeek(ctx, position) {
  if (position == null || !Number.isFinite(position)) return;
  const a = ctx.audioRef?.current;
  if (!a) return;
  try {
    if (a.readyState >= 1) {
      a.currentTime = position;
      if (typeof ctx.setTime === 'function') ctx.setTime(position);
    } else {
      ctx._pendingSeek = position;
    }
  } catch {
    ctx._pendingSeek = position;
  }
}

function schedulePlay(ctx, seekHint) {
  if (seekHint != null) ctx._pendingSeek = seekHint;

  const attempt = () => {
    if (ctx.playingRef && !ctx.playingRef.current) return;
    if (ctx.getIntent && ctx.getIntent() !== 'play') return;
    const a = ctx.audioRef?.current;
    if (!a) return;

    const seekTo = ctx._pendingSeek;
    if (seekTo != null && Number.isFinite(seekTo) && a.readyState >= 1) {
      try {
        a.currentTime = seekTo;
        if (typeof ctx.setTime === 'function') ctx.setTime(seekTo);
      } catch {}
      ctx._pendingSeek = null;
    }

    if (typeof ctx.vol === 'number' && a.volume < ctx.vol * 0.5) {
      a.volume = ctx.vol;
    }

    const p = a.play();
    if (p && p.then) {
      p.then(() => {
        if (ctx._pendingSeek != null && a.readyState >= 1) {
          try { a.currentTime = ctx._pendingSeek; } catch {}
          ctx._pendingSeek = null;
        }
        if (typeof ctx.setLoadingAudio === 'function') ctx.setLoadingAudio(false);
        if (typeof ctx.setMediaSessionState === 'function') {
          ctx.setMediaSessionState('playing', a.currentTime);
        }
        if (typeof ctx.onPlayOk === 'function') ctx.onPlayOk(a);
      }).catch((err) => {
        if (err?.name === 'AbortError') return;
        if (typeof ctx.onPlayFail === 'function') ctx.onPlayFail(err);
      });
    }
  };

  // setSrc de React es async: reintentos cortos
  setTimeout(attempt, 40);
  setTimeout(attempt, 180);
  setTimeout(attempt, 450);
}

/** Aplicar seek pendiente cuando llega metadata (onLoadedMetadata / onCanPlay). */
export function flushPendingSeek(ctx) {
  const a = ctx.audioRef?.current;
  const seekTo = ctx._pendingSeek;
  if (!a || seekTo == null || !Number.isFinite(seekTo)) return false;
  if (a.readyState < 1) return false;
  try {
    a.currentTime = seekTo;
    if (typeof ctx.setTime === 'function') ctx.setTime(seekTo);
    ctx._pendingSeek = null;
    return true;
  } catch {
    return false;
  }
}
