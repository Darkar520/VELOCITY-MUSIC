import { useEffect, useRef } from 'react';
import { api } from '../api.js';
import { normalizeTrack, trackById } from '../catalog.js';

/**
 * Reconoce únicamente las rutas públicas de contenido que la aplicación
 * puede resolver. El resto de URLs conserva el comportamiento normal del
 * home.
 */
export function parseSharedRoute(pathname = (typeof window !== 'undefined' ? window.location.pathname : '')) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts.length !== 2 || !['track', 'album'].includes(parts[0])) return null;
  try {
    const id = decodeURIComponent(parts[1]).trim();
    return id ? { type: parts[0], id } : null;
  } catch {
    return null;
  }
}

/**
 * Hidrata una URL compartida después de autenticación y la convierte en una
 * vista real. La resolución de la pista usa primero el catálogo local y luego
 * el endpoint de metadatos, que también tiene fallback al catálogo de YTM.
 */
export function useSharedRoute({ authed, goAlbum, setExpanded, setView, setDetailData, setDetailLoading }) {
  const handledRef = useRef('');
  const goAlbumRef = useRef(goAlbum);
  goAlbumRef.current = goAlbum;

  useEffect(() => {
    if (!authed) return undefined;
    const route = parseSharedRoute();
    if (!route) return undefined;

    const key = `${route.type}:${route.id}`;
    if (handledRef.current === key) return undefined;
    // Marcar antes de cualquier await: StrictMode no debe abrir dos veces la
    // misma vista ni duplicar la petición de metadatos.
    handledRef.current = key;

    if (route.type === 'album') {
      goAlbumRef.current(route.id);
      return undefined;
    }

    let cancelled = false;
    setExpanded(false);
    setView({ type: 'track', trackId: route.id });
    setDetailData(null);
    setDetailLoading(true);

    (async () => {
      let track = trackById(route.id);
      if (!track) {
        const rows = await api.getTracks([route.id]);
        const raw = rows.find((item) => String(item?.id) === route.id);
        if (raw) track = normalizeTrack(raw);
      }
      if (cancelled) return;
      setDetailData(track
        ? { type: 'track', track }
        : { type: 'track', none: true });
      setDetailLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setDetailData({ type: 'track', none: true });
      setDetailLoading(false);
    });

    return () => { cancelled = true; };
  }, [authed, setExpanded, setView, setDetailData, setDetailLoading]);
}

export default useSharedRoute;
