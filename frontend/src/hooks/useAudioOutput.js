/**
 * useAudioOutput — volumen, Wake Lock y dispositivos de salida de audio.
 *
 * Extraído de App.jsx sin cambio de comportamiento. Notas que se conservan:
 *
 *  - Wake Lock: en algunos Android agresivos el navegador suspende el JS en
 *    background incluso con Media Session activa. El lock mantiene la CPU
 *    despierta mientras hay música y se re-adquiere al volver a primer plano
 *    (el sistema lo libera al apagar la pantalla).
 *  - "Normalizar volumen" NO usa Web Audio: createMediaElementSource secuestra
 *    el <audio> de forma permanente y, al suspenderse el AudioContext en
 *    background, la música se detiene. Se dejó como ajuste simple de volumen
 *    (las pistas ya vienen normalizadas del backend).
 *  - enumerateDevices() sin permiso de micrófono devuelve deviceIds con labels
 *    vacíos: se rellenan nombres genéricos por posición y DeviceChip pide el
 *    permiso on-click.
 */
import { useEffect, useRef } from 'react';

export function useAudioOutput({ audioRef, playing, vol, settings, sinkId, setOutputs, trackId }) {
  // ── Wake Lock API: previene que la CPU/screen se suspenda mientras reproduce ──
  const wakeLockRef = useRef(null);
  useEffect(() => {
    const requestLock = async () => {
      if (!navigator.wakeLock) return;
      try {
        if (playing) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } else if (wakeLockRef.current) {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        }
      } catch {}
    };
    requestLock();
    // Re-adquirir el lock al volver a primer plano (se libera automáticamente
    // cuando la pantalla se apaga).
    const onVis = () => { if (document.visibilityState === 'visible' && playing) requestLock(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    };
  }, [playing]);

  // ── Normalizar volumen (ajuste simple, sin Web Audio) ──
  useEffect(() => {
    if (settings.normalize && audioRef.current) {
      audioRef.current.volume = Math.max(audioRef.current.volume, vol);
    }
  }, [settings.normalize, vol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol;
  }, [vol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enumerar dispositivos de salida de audio ──
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const update = () => navigator.mediaDevices.enumerateDevices().then(devs => {
      const outs = devs.filter(d => d.kind === 'audiooutput').map(d => ({
        deviceId: d.deviceId,
        label: d.label || '',
      }));
      // Si los labels siguen vacíos, asignar nombres genéricos por posición.
      if (outs.length && !outs.some(o => o.label)) {
        outs.forEach((o, i) => { o.label = i === 0 ? 'Altavoz del dispositivo' : `Salida de audio ${i + 1}`; });
      }
      setOutputs(outs);
    }).catch(() => {});
    update();
    // Re-enumerar cuando cambian los dispositivos (ej: conectar/desconectar Bluetooth).
    navigator.mediaDevices.addEventListener?.('devicechange', update);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', update);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Aplicar sinkId al elemento audio ──
  useEffect(() => {
    if (audioRef.current && audioRef.current.setSinkId && sinkId) {
      audioRef.current.setSinkId(sinkId).catch(() => {});
    }
  }, [sinkId, trackId]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default useAudioOutput;
