// ═══════════════════════════════════════════════════════════════
// Hooks reutilizables.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react';

// Swipe horizontal (siguiente/anterior). Devuelve handlers táctiles y dragX
// para animar la transición. Llama preventDefault en touchmove horizontal
// para evitar que el browser mueva la página.
export function useHSwipe({ onLeft, onRight, threshold = 55 } = {}) {
  const sx = useRef(0), sy = useRef(0), active = useRef(false);
  const locked = useRef(null); // 'h' | 'v' | null
  const [dragX, setDragX] = useState(0);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    sx.current = t.clientX; sy.current = t.clientY;
    active.current = true; locked.current = null;
    setDragX(0);
  };

  const onTouchMove = (e) => {
    if (!active.current) return;
    const t = e.touches[0];
    const dx = t.clientX - sx.current, dy = t.clientY - sy.current;
    if (!locked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8)
        locked.current = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
    }
    if (locked.current === 'h') {
      e.preventDefault();
      // Resistencia: limitar a ±120px con amortiguación
      const max = 120;
      const r = dx > 0 ? Math.min(dx, max) : Math.max(dx, -max);
      setDragX(r * 0.75);
    }
  };

  const onTouchEnd = (e) => {
    if (!active.current) return; active.current = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx.current, dy = t.clientY - sy.current;
    if (locked.current === 'h' && Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dx < 0 ? onLeft?.() : onRight?.();
    }
    setDragX(0);
    locked.current = null;
  };

  return { dragX, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}

// Estado persistido en localStorage.
export function usePersisted(key, def) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s != null ? JSON.parse(s) : def; } catch { return def; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV];
}

// Tamaño de la ventana (para responsive).
export function useViewport() {
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, []);
  return vp;
}

// Extrae el color dominante de una imagen (portada) vía Canvas API.
// Devuelve { r, g, b, hex, isDark } del color más vibrante, o null.
export function useDominantColor(src) {
  const [color, setColor] = useState(null);
  useEffect(() => {
    if (!src || src.startsWith('data:')) { setColor(null); return; }
    let cancelled = false;
    const img = new Image();
    // Servimos por nuestro proxy (mismo origen) → el canvas no queda "tainted"
    // y podemos leer los píxeles sin CORS. No necesita crossOrigin.
    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 64; // muestrear a resolución pequeña = rápido
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        let bestSat = -1, bestR = 0, bestG = 0, bestB = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const brightness = (r + g + b) / 3;
          if (brightness < 20 || brightness > 235) continue; // descartar negro/blanco puro
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat > bestSat) { bestSat = sat; bestR = r; bestG = g; bestB = b; }
          rSum += r; gSum += g; bSum += b; count++;
        }
        if (!count) { setColor(null); return; }
        const useVibrant = bestSat > 0.3;
        let r = useVibrant ? bestR : Math.round(rSum / count);
        let g = useVibrant ? bestG : Math.round(gSum / count);
        let b = useVibrant ? bestB : Math.round(bSum / count);
        const brightness0 = (r + g + b) / 3;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        // Carátula muy oscura y sin color (negra/gris) → sin color (usa el tema).
        if (brightness0 < 28 && sat < 0.22) { setColor(null); return; }
        // Carátula oscura pero con color → subir brillo para que el fondo se note.
        if (brightness0 < 110 && sat >= 0.22) {
          const boost = 110 / Math.max(1, brightness0);
          r = Math.min(255, Math.round(r * boost));
          g = Math.min(255, Math.round(g * boost));
          b = Math.min(255, Math.round(b * boost));
        }
        const brightness = (r + g + b) / 3;
        const isDark = brightness < 128;
        const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        setColor({ r, g, b, hex, isDark });
      } catch { setColor(null); }
    };
    img.onerror = () => { if (!cancelled) setColor(null); };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return color;
}
