// ═══════════════════════════════════════════════════════════════
// Hooks reutilizables.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react';

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
    img.crossOrigin = 'anonymous';
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
        const useVibrant = bestSat > 0.35;
        const r = useVibrant ? bestR : Math.round(rSum / count);
        const g = useVibrant ? bestG : Math.round(gSum / count);
        const b = useVibrant ? bestB : Math.round(bSum / count);
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
