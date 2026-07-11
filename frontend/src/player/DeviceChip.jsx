import React, { useState } from 'react';
import { hex2rgba } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { Spinner } from '../components.jsx';
import { usePlayerStore } from '../store/playerStore.js';

export function DeviceChip({ T }) {
  // Selectores del store
  const outputs = usePlayerStore((s) => s.outputs);
  const sinkId = usePlayerStore((s) => s.sinkId);
  const setOutput = usePlayerStore((s) => s.setSinkId);

  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const list = (outputs || []).filter(o => o.deviceId);
  const current = list.find(o => o.deviceId === sinkId);
  const defaultDev = list.find(o => o.deviceId === 'default');
  const label = current?.label || defaultDev?.label || (list.length === 1 ? list[0]?.label : '') || 'Este dispositivo';
  const isBT = /blue|airpod|buds|head|auric|airpod|pods|earbuds|wireless|bt-/i.test(label);
  const Ico = isBT ? Icon.Headph : Icon.Speaker;
  const hasRealLabels = list.some(o => o.label && !o.label.startsWith('Altavoz del dispositivo') && !o.label.startsWith('Salida de audio'));
  const canPick = list.length > 1;

  const handleClick = async () => {
    // Si no tenemos labels reales, solicitar permiso de audio primero.
    if (!hasRealLabels && navigator.mediaDevices?.getUserMedia && !requesting) {
      setRequesting(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        // Re-enumerar con permiso concedido — los labels ahora estarán disponibles.
        // El devicechange event o el useEffect se encargará de actualizar outputs.
        if (navigator.mediaDevices?.enumerateDevices) {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const outs = devs.filter(d => d.kind === 'audiooutput').map(d => ({
            deviceId: d.deviceId,
            label: d.label || 'Dispositivo de audio',
          }));
          // Actualizar outputs directamente via callback si está disponible.
          if (outs.length) {
            // Disparar evento para que el useEffect re-enumerate.
            navigator.mediaDevices.dispatchEvent?.(new Event('devicechange'));
          }
        }
      } catch { /* usuario rechazó — seguir con labels genéricos */ }
      setRequesting(false);
    }
    if (canPick || !hasRealLabels) setOpen(o => !o);
  };

  return (
    <div style={{ position:'relative' }}>
      <button onClick={handleClick} className="press" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'8px 14px', cursor:'pointer', color:'var(--txt-1)', fontSize:11.5, fontWeight:700, maxWidth:200 }} disabled={requesting}>
        {requesting ? <Spinner c={T.accent} sz={14} /> : <Ico c={T.accent} sz={15} />}
        <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label.replace(/\s*\(.*?\)$/g,'').replace(/-.*$/,'') || 'Salida de audio'}</span>
      </button>
      {open && (
        <div className="glass fade-up" style={{ position:'absolute', bottom:'calc(100% + 8px)', left:0, minWidth:220, background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:14, padding:6, zIndex:95, boxShadow:'0 20px 50px #000c' }}>
          {list.length <= 1 && !hasRealLabels && (
            <div style={{ padding:'10px 12px', fontSize:11, color:'var(--txt-2)', lineHeight:1.4 }}>
              Conecta audífonos o altavoces Bluetooth para ver más opciones.
            </div>
          )}
          {list.map(o => {
            const oBT = /blue|airpod|buds|head|auric|airpod|pods|earbuds|wireless|bt-/i.test(o.label);
            return (
              <button key={o.deviceId} onClick={() => { setOutput(o.deviceId); setOpen(false); }} className="press" style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px', borderRadius:10, background: o.deviceId===sinkId ? hex2rgba(T.accent,.12) : 'none', border:'none', cursor:'pointer', textAlign:'left' }}>
                {oBT ? <Icon.Headph c="var(--txt-1)" sz={15} /> : <Icon.Speaker c="var(--txt-1)" sz={15} />}
                <span style={{ fontSize:12, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{o.label || 'Dispositivo'}</span>
                {o.deviceId===sinkId && <Icon.Check c={T.accent} sz={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

