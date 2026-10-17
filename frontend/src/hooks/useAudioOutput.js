/**
 * useAudioOutput — volumen y dispositivos de salida de audio.
 *
 * Extraído de App.jsx sin cambio de comportamiento. Notas que se conservan:
 *
 *  - No solicitar Screen Wake Lock para música: mantiene la pantalla encendida
 *    y no garantiza ejecución de audio con el documento oculto.
 *  - "Normalizar volumen" NO usa Web Audio: createMediaElementSource secuestra
 *    el <audio> de forma permanente y, al suspenderse el AudioContext en
 *    background, la música se detiene. Se dejó como ajuste simple de volumen
 *    (las pistas ya vienen normalizadas del backend).
 *  - enumerateDevices() sin permiso de micrófono devuelve deviceIds con labels
 *    vacíos: se rellenan nombres genéricos por posición y DeviceChip pide el
 *    permiso on-click.
 */
import { useEffect } from 'react';

export function useAudioOutput({ audioRef, vol, settings, sinkId, setOutputs, trackId }) {
  // Screen Wake Lock keeps the DISPLAY on; it cannot preserve background audio.
  // Let the screen sleep. The native media element owns audio continuity.

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
