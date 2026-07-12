/**
 * Ejecuta effects emitidos por audioMachine.reduce.
 * Sin política: solo side-effects (DOM / React / red).
 *
 * Epoch (_audioEpoch): invalida schedulePlay / seeks pendientes al cambiar
 * de pista. Sin esto, timeouts 40/180/450 ms de la canción anterior reanudan
 * el src viejo encima de la nueva.
 *
 * @param {object[]} effects
 * @param {object} ctx
 */

/** Invalida plays/seeks programados. Llamar en cada cambio de pista. */
export function bumpAudioEpoch(ctx) {
  if (!ctx) return 0;
  ctx._audioEpoch = (ctx._audioEpoch || 0) + 1;
  ctx._pendingSeek = null;
  return ctx._audioEpoch;
}

/**
 * ¿El elemento tiene un src de media real (no vacío / no la URL de la página)?
 */
export function hasRealMediaSrc(a) {
  if (!a) return false;
  const src = (a.currentSrc || a.getAttribute('src') || a.src || '').trim();
  if (!src) return false;
  if (typeof location !== 'undefined' && src === location.href) return false;
  // data: / blob: / http(s) / relative API paths
  return /^(blob:|data:|https?:|\/)/i.test(src) || src.includes('/api/') || src.includes('stream');
}

/**
 * Corta el audio actual de forma síncrona (pause + quitar src).
 * IMPORTANTE: no llamar a.load() sin src — en Chrome/Safari dispara
 * onError (MEDIA_ERR_SRC_NOT_SUPPORTED) y el App lo interpreta como
 * “no se pudo reproducir”.
 */
export function hardStopAudio(ctx) {
  if (!ctx) return;
  bumpAudioEpoch(ctx);
  ctx._suppressAudioError = true;
  if (ctx.selfPauseRef) ctx.selfPauseRef.current = true;
  const a = ctx.audioRef?.current;
  try {
    if (a) {
      try { a.pause(); } catch { /* ignore */ }
      try {
        // Quitar src sin load(): evita error event en elemento vacío.
        a.removeAttribute('src');
        // Algunos browsers dejan a.src = location.href; forzar vacío lógico.
        try { a.src = ''; } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  if (ctx.selfPauseRef) ctx.selfPauseRef.current = false;
  if (typeof ctx.setPlaySrc === 'function') ctx.setPlaySrc(null);
  if (typeof ctx.setTime === 'function') ctx.setTime(0);
  // Liberar el flag en el siguiente tick (tras el error sintético si lo hubo).
  setTimeout(() => {
    if (ctx) ctx._suppressAudioError = false;
  }, 0);
}

/** Asigna src al DOM de inmediato (React setPlaySrc es async en el siguiente paint). */
export function applyMediaSrc(ctx, url) {
  if (!ctx || !url) return;
  if (typeof ctx.setPlaySrc === 'function') ctx.setPlaySrc(url);
  const a = ctx.audioRef?.current;
  if (!a) return;
  try {
    const cur = a.getAttribute('src') || '';
    if (cur === url || a.src === url) return;
    a.src = url;
  } catch { /* ignore */ }
}

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
        if (e.url) applyMediaSrc(ctx, e.url);
        break;
      }
      case 'clearSrc': {
        hardStopAudio(ctx);
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
  // Capturar epoch: si hay TRACK_SET/clearSrc después, estos timeouts mueren.
  const epoch = ctx._audioEpoch || 0;
  if (seekHint != null) ctx._pendingSeek = seekHint;

  const attempt = () => {
    if ((ctx._audioEpoch || 0) !== epoch) return;
    if (ctx.playingRef && !ctx.playingRef.current) return;
    if (ctx.getIntent && ctx.getIntent() !== 'play') return;
    const a = ctx.audioRef?.current;
    if (!a) return;
    // Sin src real no reintentar play (evita reanimar elemento vacío post-clearSrc).
    if (!hasRealMediaSrc(a)) return;

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

    let p;
    try {
      p = a.play();
    } catch (err) {
      if ((ctx._audioEpoch || 0) !== epoch) return;
      if (typeof ctx.onPlayFail === 'function') ctx.onPlayFail(err);
      return;
    }
    if (p && p.then) {
      p.then(() => {
        if ((ctx._audioEpoch || 0) !== epoch) {
          try { a.pause(); } catch {}
          return;
        }
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
        if ((ctx._audioEpoch || 0) !== epoch) return;
        if (err?.name === 'AbortError') return;
        if (typeof ctx.onPlayFail === 'function') ctx.onPlayFail(err);
      });
    }
  };

  // setSrc de React es async: reintentos cortos (epoch los invalida al cambiar pista)
  setTimeout(attempt, 0);
  setTimeout(attempt, 50);
  setTimeout(attempt, 150);
  setTimeout(attempt, 400);
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
