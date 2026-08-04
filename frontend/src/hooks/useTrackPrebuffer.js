/**
 * useTrackPrebuffer — pre-buffer del audio de las 2 pistas siguientes.
 *
 * Extraído de App.jsx sin cambio de comportamiento. Dos <audio> ocultos
 * descargan por adelantado los streams de las próximas pistas; al cambiar, el
 * navegador sirve desde caché → arranque instantáneo.
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
import { useEffect } from 'react';
import { api } from '../api.js';
import { isDocumentVisible } from '../audioContinuity.js';
import { trackById } from '../catalog.js';

const QUALITY_MAP = { high: 'high', medium: 'medium', low: 'low', HQ: 'high', Standard: 'medium', FLAC: 'low' };

export function useTrackPrebuffer({
  preloadAudioRef, preloadAudio2Ref, preloadEpochRef, preloadEpoch,
  track, queue, quality, downloaded,
}) {
  useEffect(() => {
    let cancelled = false;
    const effectEpoch = preloadEpoch;
    const isPreloadCurrent = () => (
      !cancelled
      && preloadEpochRef.current === effectEpoch
      && isDocumentVisible()
    );
    const ids = queue.length ? queue : (track ? [track.id] : []);
    const i = track ? ids.indexOf(track.id) : -1;
    const qParam = QUALITY_MAP[quality] || 'high';
    const preload = async (el, offset) => {
      if (!isDocumentVisible()) { if (el) el.removeAttribute('src'); return; }
      if (!el || !track || i === -1 || ids.length < 2) { if (el) el.removeAttribute('src'); return; }
      const nextId = ids[(i + offset) % ids.length];
      if (!nextId || nextId === track.id || downloaded.has(nextId)) { el.removeAttribute('src'); return; }
      const nt = trackById(nextId);
      if (!nt) { el.removeAttribute('src'); return; }
      try {
        // Preferir firma ya en caché (síncrona); si no, ensure + warm.
        // 300s de umbral: re-firma si quedan < 5 min en la URL cacheada.
        // Evita que la siguiente pista arranque con una URL a punto de expirar.
        let url = api.peekStreamUrl({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam }, 300);
        if (!url) url = await api.ensureStreamUrl({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam });
        if (!isPreloadCurrent() || !el) return;
        if (el.getAttribute('src') !== url) { el.src = url; try { el.load(); } catch {} }
      } catch {
        if (isPreloadCurrent() && el) el.removeAttribute('src');
      }
    };
    preload(preloadAudioRef.current, 1);
    preload(preloadAudio2Ref.current, 2);
    // volume=0 en los pre-buffer (no muted: muted causa throttle en mobile).
    if (preloadAudioRef.current) preloadAudioRef.current.volume = 0;
    if (preloadAudio2Ref.current) preloadAudio2Ref.current.volume = 0;
    return () => { cancelled = true; };
    // NO depender de downloaded: causa re-renders que limpian el buffer.
  }, [track?.id, queue, quality, preloadEpoch]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default useTrackPrebuffer;
