/**
 * useSSESession — suscripción a Server-Sent Events para sync cross-device.
 *
 * Responsabilidades:
 *   1. Conectar al endpoint /api/events cuando el user esté authed.
 *   2. Despachar eventos recibidos a callbacks del consumidor.
 *   3. Reconnect con backoff exponencial (hasta 30s).
 *   4. Cleanup completo en unmount o logout.
 *
 * NO contiene lógica de "qué hacer cuando llega un evento" — eso lo decide
 * el consumidor via los callbacks que pasa.
 *
 * Uso:
 *   useSSESession({
 *     enabled: authed,
 *     onRemotePlay: (data) => { ... },
 *     onRemotePause: () => { ... },
 *     onSyncLibrary: () => { ... },
 *   });
 */
import { useEffect, useRef } from 'react';
import { isAuthed } from '../api.js';

export function useSSESession({ enabled, onRemotePlay, onRemotePause, onSyncLibrary } = {}) {
  const esRef = useRef(null);
  const reconnectRef = useRef(null);
  const backoffRef = useRef(1000);
  const callbacksRef = useRef({ onRemotePlay, onRemotePause, onSyncLibrary });

  // Mantener callbacksRef actualizado sin re-crear el effect.
  useEffect(() => {
    callbacksRef.current = { onRemotePlay, onRemotePause, onSyncLibrary };
  });

  useEffect(() => {
    if (!enabled || !isAuthed()) return;

    let cancelled = false;
    const MAX_BACKOFF = 30_000;

    const connect = () => {
      if (cancelled) return;
      try {
        const es = new EventSource('/api/events', { withCredentials: true });
        esRef.current = es;

        es.onopen = () => {
          backoffRef.current = 1000; // reset backoff on success
        };

        es.addEventListener('remote-play', (e) => {
          try {
            const data = JSON.parse(e.data || '{}');
            callbacksRef.current.onRemotePlay?.(data);
          } catch { /* payload inválido */ }
        });

        es.addEventListener('remote-pause', () => {
          callbacksRef.current.onRemotePause?.();
        });

        es.addEventListener('sync-library', () => {
          callbacksRef.current.onSyncLibrary?.();
        });

        es.onerror = () => {
          es.close();
          esRef.current = null;
          if (cancelled) return;
          // Backoff exponencial con jitter
          const delay = Math.min(backoffRef.current * (1 + Math.random() * 0.3), MAX_BACKOFF);
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
          reconnectRef.current = setTimeout(connect, delay);
        };
      } catch {
        // EventSource no disponible o URL inválida — no reconectar.
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, [enabled]);

  // Exponer estado de conexión para diagnósticos (no reactivo)
  return {
    isConnected: () => esRef.current?.readyState === 1,
  };
}

export default useSSESession;
