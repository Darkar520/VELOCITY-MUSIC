/**
 * useAppUpdate — detección de versión desactualizada + instalación de la PWA.
 *
 * Extraído de App.jsx sin cambio de comportamiento. Estrategia doble para no
 * depender sólo del Service Worker:
 *   1) SW: si instala una versión nueva y toma el control → hay actualización.
 *   2) Sondeo de versión: compara el hash del bundle en ejecución contra el que
 *      sirve el servidor (index.html, no-cache). Detecta deploys aunque el SW
 *      no cambie. Se revisa al enfocar la app y periódicamente.
 *
 * El aviso (UpdateBanner) SIEMPRE se muestra cuando hay versión nueva; la
 * auto-aplicación sólo ocurre si la música está pausada y el usuario lleva más
 * de 30 s en la app (evita recargar justo después del login/primera carga).
 *
 * No toca sw.js: sólo consume su señal (controllerchange / mensaje vm-updated).
 */
import { useState, useEffect, useRef } from 'react';

export function useAppUpdate({ playing }) {
  const [updateReady, setUpdateReady] = useState(false);
  const runningBundleRef = useRef(null);
  const mountedAtRef = useRef(Date.now());

  // Aplicar la actualización: activa el SW en espera (si lo hay) y recarga.
  const applyUpdate = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg && reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    } catch {}
    window.location.reload();
  };

  useEffect(() => {
    // (1) Señal del Service Worker.
    let cleanupSW;
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let fired = false;
      const trigger = () => { if (fired || !hadController) return; fired = true; setUpdateReady(true); };
      const onMsg = (e) => { if (e.data && e.data.type === 'vm-updated') trigger(); };
      navigator.serviceWorker.addEventListener('controllerchange', trigger);
      navigator.serviceWorker.addEventListener('message', onMsg);
      cleanupSW = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', trigger);
        navigator.serviceWorker.removeEventListener('message', onMsg);
      };
    }
    // (2) Sondeo de versión por hash del bundle.
    try {
      const s = document.querySelector('script[src*="/assets/index-"]');
      runningBundleRef.current = s ? (s.getAttribute('src').match(/index-[A-Za-z0-9_-]+\.js/) || [null])[0] : null;
    } catch {}
    let stop = false;
    const checkVersion = async () => {
      if (stop || !runningBundleRef.current) return;
      try {
        const html = await fetch('/?_v=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.text() : '');
        const m = html.match(/index-[A-Za-z0-9_-]+\.js/);
        if (m && m[0] !== runningBundleRef.current) setUpdateReady(true);
      } catch {}
    };
    const iv = setInterval(checkVersion, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') checkVersion(); };
    const onFocus = () => checkVersion();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    checkVersion();
    return () => {
      stop = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      if (typeof cleanupSW === 'function') cleanupSW();
    };
  }, []);

  useEffect(() => {
    if (!updateReady || playing) return;
    const elapsed = Date.now() - mountedAtRef.current;
    const delay = Math.max(0, 30000 - elapsed); // espera mínimo 30s desde el montaje
    const t = setTimeout(() => applyUpdate(), delay + 2000);
    return () => clearTimeout(t);
  }, [updateReady, playing]);

  // ── Instalación de la PWA (pantalla de inicio) ──
  const [installEvt, setInstallEvt] = useState(null);
  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const isIOS = typeof navigator !== 'undefined'
    && /iphone|ipad|ipod/i.test(navigator.userAgent)
    && !/crios|fxios/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined'
    && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true);

  const installApp = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch {}
    setInstallEvt(null);
  };

  return {
    updateReady, setUpdateReady, applyUpdate,
    installEvt, installApp, isIOS, isStandalone,
  };
}

export default useAppUpdate;
