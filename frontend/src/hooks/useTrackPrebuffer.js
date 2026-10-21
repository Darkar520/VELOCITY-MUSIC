/**
 * useTrackPrebuffer — precarga de audio configurable para la cola inmediata.
 *
 * `current` conserva el comportamiento existente, `one-track` precarga solo la
 * siguiente y `url-only` deja únicamente la preparación de URL de prefetchNext.
 * Los elementos ocultos piden metadatos; eso no garantiza una descarga completa.
 *
 * Invariantes que se conservan:
 *  - Las URLs son firmadas (HMAC): el proxy rechaza sin exp/sig. Se prefiere la
 *    firma ya en caché (síncrona) y se re-firma si quedan < 5 min (umbral 300 s),
 *    para que la siguiente pista no arranque con una URL a punto de expirar.
 *  - `preloadEpoch` invalida una precarga a medias cuando cambia la visibilidad:
 *    sin eso, una descarga iniciada en background se daría por válida al volver.
 *  - volume = 0 en los pre-buffer (NO muted: muted provoca throttling agresivo
 *    en móvil).
 *  - El efecto NO depende de `downloaded`: hacerlo provocaba re-renders que
 *    limpiaban el buffer.
 */
import { useEffect, useRef } from 'react';
import { api } from '../api.js';
import { isDocumentVisible } from '../audioContinuity.js';
import { trackById } from '../catalog.js';

const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };
let preloadRequestSequence = 0;

function clearPreloadAudio(el) {
  if (!el) return;
  try { el.pause?.(); } catch {}
  try {
    if (el.getAttribute?.('src')) {
      el.removeAttribute('src');
      el.load?.();
    }
    if (el.dataset) {
      delete el.dataset.prebufferTrackId;
      delete el.dataset.prebufferPending;
      delete el.dataset.prebufferPlaybackMode;
    }
  } catch {}
}

export function useTrackPrebuffer({
  preloadAudioRef, preloadAudio2Ref, preloadEpochRef, preloadEpoch,
  track, queue, quality, downloaded, mode = 'current', playbackMode = 'auto', prefetchNext,
}) {
  const prefetchNextRef = useRef(prefetchNext);
  prefetchNextRef.current = prefetchNext;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const effectEpoch = preloadEpoch;
    const elements = [preloadAudioRef.current, preloadAudio2Ref.current];
    const selectedMode = ['current', 'one-track', 'url-only'].includes(mode) ? mode : 'current';
    const offsets = selectedMode === 'current' ? [1, 2] : selectedMode === 'one-track' ? [1] : [];
    const isPreloadCurrent = () => (
      !cancelled
      && preloadEpochRef.current === effectEpoch
      && isDocumentVisible()
    );
    const ids = queue.length ? queue : (track ? [track.id] : []);
    const i = track ? ids.indexOf(track.id) : -1;
    const qParam = QUALITY_MAP[quality] || 'high';
    const desiredTracks = isDocumentVisible() && track && i >= 0 && ids.length > 1
      ? offsets
        .map((offset) => ({ id: ids[(i + offset) % ids.length], offset }))
        .filter((entry, index, all) => entry.id && entry.id !== track.id && !downloaded.has(entry.id) && all.findIndex((candidate) => candidate.id === entry.id) === index)
        .map((entry) => ({ ...entry, track: trackById(entry.id) }))
        .filter((entry) => entry.track)
      : [];
    const desiredIds = new Set(desiredTracks.map((entry) => entry.id));
    elements.forEach((el) => {
      const assignedId = el?.dataset?.prebufferTrackId;
      if (!assignedId || !desiredIds.has(assignedId) || !el.getAttribute?.('src')
        || el.dataset?.prebufferPlaybackMode !== playbackMode) clearPreloadAudio(el);
    });

    const pendingElements = new Map();
    const preload = async ({ id: nextId, offset, track: nt }) => {
      if (!isPreloadCurrent() || !nt) return;
      if (elements.some((el) => el?.dataset?.prebufferTrackId === nextId && el.getAttribute?.('src'))) return;
      const el = elements.find((candidate) => (
        candidate && !candidate.getAttribute?.('src') && !candidate.dataset?.prebufferPending
      ));
      if (!el) return;
      const requestId = String(++preloadRequestSequence);
      if (el.dataset) {
        el.dataset.prebufferTrackId = nextId;
        el.dataset.prebufferPending = requestId;
        el.dataset.prebufferPlaybackMode = playbackMode;
      }
      pendingElements.set(el, requestId);
      try {
        // Preferir firma ya en caché (síncrona); si no, ensure + warm.
        // 300s de umbral: re-firma si quedan < 5 min en la URL cacheada.
        // Evita que la siguiente pista arranque con una URL a punto de expirar.
        let url = api.peekPlaybackUrl({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam }, 300, playbackMode);
        if (!url) {
          const useNextPrefetch = offset === 1 && typeof prefetchNextRef.current === 'function';
          url = useNextPrefetch
            ? await prefetchNextRef.current(track.id, ids, qParam)
            : await api.ensureStreamUrl(
              { artist: nt.artist, title: nt.title, id: nt.id, quality: qParam },
              { signal: controller.signal, playbackMode },
            );
        }
        if (!url) return;
        if (!isPreloadCurrent() || el.dataset?.prebufferPending !== requestId) return;
        if (el.getAttribute('src') !== url) {
          el.src = url;
          try { el.load(); } catch {}
        }
      } catch {
        if (isPreloadCurrent() && el.dataset?.prebufferPending === requestId) clearPreloadAudio(el);
      } finally {
        pendingElements.delete(el);
        if (el.dataset?.prebufferPending === requestId) delete el.dataset.prebufferPending;
      }
    };
    elements.forEach((el) => { if (el) el.volume = 0; });
    desiredTracks.forEach((entry) => { preload(entry); });
    // volume=0 en los pre-buffer (no muted: muted causa throttle en mobile).
    return () => {
      cancelled = true;
      controller.abort();
      for (const [el, requestId] of pendingElements) {
        if (el.dataset?.prebufferPending === requestId) clearPreloadAudio(el);
      }
    };
    // NO depender de downloaded: causa re-renders que limpian el buffer.
  }, [track?.id, queue, quality, preloadEpoch, mode, playbackMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const elements = [preloadAudioRef.current, preloadAudio2Ref.current];
    return () => elements.forEach(clearPreloadAudio);
  }, [preloadAudioRef, preloadAudio2Ref]);
}

export default useTrackPrebuffer;
