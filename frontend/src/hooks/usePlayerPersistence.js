/**
 * usePlayerPersistence — persistir estado del player a localStorage + backend.
 *
 * Responsabilidades:
 *   1. Hydratar el store desde localStorage al montar.
 *   2. Debounce-save del player state (track, time, queue) cada 5s o al unmount.
 *   3. Subir playStats al backend cuando hay cambios.
 *
 * NO contiene policy de "cuándo reanudar sesión" — eso vive en audioMachine
 * (case HYDRATE + shouldApplySessionResume).
 *
 * Uso:
 *   usePlayerPersistence({ authed });
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore.js';
import { loadPlayerState, saveMeta } from '../catalog.js';
import { api } from '../api.js';

const SAVE_KEY = 'velocity.player';
const SAVE_DEBOUNCE_MS = 5000;

export function usePlayerPersistence({ authed } = {}) {
  const persistRef = useRef({ lastSave: 0, timer: null, stats: {} });

  // ─── Hydrate al montar ────────────────────────────────────────────
  useEffect(() => {
    const saved = loadPlayerState();
    if (!saved || !saved.track) return;

    const store = usePlayerStore.getState();
    store.hydrate({
      trackId: saved.track.id,
      position: saved.t || 0,
      urlFresh: false, // siemmpre false al hydrate de localStorage — url caducó
    });

    // Restaurar cola
    if (Array.isArray(saved.queue) && saved.queue.length) {
      store.setQueue(saved.queue);
    }

    // Cargar playStats desde localStorage
    try {
      const stats = JSON.parse(localStorage.getItem('velocity.playStats') || '{}');
      persistRef.current.stats = stats;
    } catch { /* corrupto */ }
  }, []);

  // ─── Debounced save ───────────────────────────────────────────────
  const track = usePlayerStore((s) => s.track);
  const time = usePlayerStore((s) => s.time);
  const queue = usePlayerStore((s) => s.queue);

  useEffect(() => {
    if (!track) return;
    if (persistRef.current.timer) clearTimeout(persistRef.current.timer);

    persistRef.current.timer = setTimeout(() => {
      const payload = {
        track: { id: track.id, title: track.title, artist: track.artist, cover: track.cover },
        t: time,
        queue,
        ts: Date.now(),
      };
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
        saveMeta(); // catálogo local
      } catch { /* quota excedido */ }
      persistRef.current.lastSave = Date.now();
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (persistRef.current.timer) clearTimeout(persistRef.current.timer);
    };
  }, [track, time, queue]);

  // ─── Sync playStats al backend (cuando authed) ────────────────────
  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(() => {
      const stats = persistRef.current.stats;
      const ids = Object.keys(stats);
      if (!ids.length) return;
      // Subir top 50 plays recientes
      const recent = ids
        .map((id) => stats[id])
        .sort((a, b) => (b.last || 0) - (a.last || 0))
        .slice(0, 50);
      if (recent.length) {
        api.savePlayStats?.(recent).catch(() => {});
      }
    }, 60_000); // cada minuto
    return () => clearInterval(interval);
  }, [authed]);
}

export default usePlayerPersistence;
