import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from '../Icons.jsx';

export function SearchBar({ value, onChange, placeholder = 'Buscar…', T }) {
  return (
    <div style={{ position:'relative', marginBottom:16 }}>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 38px 11px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }}
      />
      <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', display:'flex', alignItems:'center', pointerEvents:'none' }}>
        {value
          ? <button onClick={() => onChange('')} style={{ background:'none', border:'none', cursor:'pointer', padding:4, display:'flex', alignItems:'center', color:'var(--txt-2)', pointerEvents:'auto' }}><Icon.X c="var(--txt-2)" sz={16} /></button>
          : <Icon.Search c="var(--txt-3)" sz={16} />}
      </div>
    </div>
  );
}

// Hook reutilizable para el estado de búsqueda dentro de una vista.

