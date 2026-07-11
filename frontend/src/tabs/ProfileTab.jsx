import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api, isAuthed, setOnUnauthorized } from '../api.js';
import * as offline from '../offline.js';
import { CSS, THEMES, SEED_ROWS, LATIN_ROWS, DISCOVERY, GENRES, ONBOARDING_GENRES, MOODS, ERAS, FALLBACK_COVER, BASE_VARS } from '../constants.js';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack } from '../catalog.js';
import { usePersisted, useViewport, useDominantColor, useHSwipe } from '../hooks.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';
import { Avatar, PixelAvatar, AVATARS } from '../avatars.jsx';
import { SearchBar } from './SearchBar.jsx';
import { useListSearch } from './useListSearch.js';

export function ProfileTab({ ctx }) {
  const { T, themeKey, setThemeKey, quality, setQuality, glow, setGlow, eq, setEq,
          settings, setSettings, favs, setOpenPlaylist, setTab, email, onLogout,
          installApp, canInstall, isIOS, isStandalone, goWrapped,
          customPalettes, activeCustomId, setActiveCustomId, activePalette, addPalette, updatePalette, deletePalette,
          displayName, saveProfileName, deleteAccount, avatar, saveAvatar,
          removeDownload, clearDownloads, getDownloads } = ctx;
  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const [avatarPicker, setAvatarPicker] = useState(false);
  // ── Administrador de descargas ──
  const [dlOpen, setDlOpen] = useState(false);
  const [dlInfo, setDlInfo] = useState(null);
  const fmtBytes = (b) => b >= 1073741824 ? (b/1073741824).toFixed(2)+' GB' : b >= 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.max(1, Math.round(b/1024))+' KB';
  const refreshDownloads = () => getDownloads().then(setDlInfo).catch(() => setDlInfo({ count:0, bytes:0, items:[] }));
  const openDownloads = () => { setDlInfo(null); setDlOpen(true); refreshDownloads(); };
  const delOne = async (id) => { await removeDownload(id); refreshDownloads(); };
  const delAll = async () => { await clearDownloads(); refreshDownloads(); };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const doDelete = async () => { setDeleting(true); try { await deleteAccount(); } finally { setDeleting(false); } };
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const shownName = displayName || (email ? email.split('@')[0] : 'Usuario');
  const startEditName = () => { setNameDraft(displayName || ''); setEditingName(true); };
  const commitName = async () => {
    const v = nameDraft.trim();
    if (!v) { setEditingName(false); return; }
    setSavingName(true);
    try { await saveProfileName(v); setEditingName(false); } catch {} finally { setSavingName(false); }
  };

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginBottom:20, paddingTop:4 }}>Perfil</div>

      <div style={{ position:'relative', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.18)}, ${hex2rgba(T.accent2,.05)}), var(--surf-0)`, border:`1px solid ${hex2rgba(T.accent,.24)}`, borderRadius:22, padding:19, marginBottom:14, display:'flex', alignItems:'center', gap:15, overflow:'hidden', boxShadow:`0 12px 30px ${hex2rgba(T.accent,.14)}` }}>
        <div style={{ position:'absolute', top:-30, right:-10, width:110, height:110, borderRadius:'50%', background:grad(T), filter:'blur(40px)', opacity:.3 }} />
        <button onClick={() => setAvatarPicker(true)} className="btn-tap" aria-label="Cambiar foto de perfil" style={{ position:'relative', background:'none', border:'none', padding:0, cursor:'pointer', flexShrink:0 }}>
          <Avatar avatar={avatar} name={shownName} email={email} T={T} size={54} />
          <div style={{ position:'absolute', bottom:-2, right:-2, width:20, height:20, borderRadius:'50%', background:grad(T), border:'2px solid var(--surf-0)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon.Edit c="#04060a" sz={10} /></div>
        </button>
        <div style={{ position:'relative', minWidth:0, flex:1 }}>
          {editingName ? (
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input autoFocus value={nameDraft} onChange={e=>setNameDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') commitName(); if(e.key==='Escape') setEditingName(false); }} maxLength={40} placeholder="Tu nombre" style={{ flex:1, minWidth:0, background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:10, padding:'7px 11px', fontSize:14, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
              <button onClick={commitName} disabled={savingName} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:10, width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>{savingName ? <Spinner c="#04060a" sz={16} /> : <Icon.Check c="#04060a" sz={17} />}</button>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ fontWeight:900, fontSize:16, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:150 }}>{shownName}</div>
              <button aria-label="Editar nombre" onClick={startEditName} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:2, flexShrink:0 }}><Icon.Edit c="var(--txt-2)" sz={15} /></button>
            </div>
          )}
          {!editingName && <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:180 }}>{email}</div>}
          <span style={{ display:'inline-block', marginTop:8, fontSize:8.5, fontWeight:900, color:'#04060a', background:grad(T), borderRadius:20, padding:'3px 11px', letterSpacing:1.5, textTransform:'uppercase' }}>PRO MEMBER</span>
        </div>
      </div>

      {avatarPicker && createPortal(
        <>
          <div onClick={() => setAvatarPicker(false)} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:130 }} />
          <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'82dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 20px)', zIndex:131, boxShadow:'0 -30px 80px #000d' }}>
            <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Elige tu avatar</div>
              <button aria-label="Cerrar" onClick={() => setAvatarPicker(false)} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(72px, 1fr))', gap:12 }}>
              <button onClick={() => { saveAvatar(''); }} className="btn-tap" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer' }}>
                <div style={{ position:'relative', borderRadius:'50%', padding:3, background: !avatar ? grad(T) : 'transparent' }}>
                  <Avatar avatar="" name={shownName} email={email} T={T} size={58} />
                </div>
                <span style={{ fontSize:9.5, fontWeight:700, color: !avatar ? T.accent : 'var(--txt-2)' }}>Inicial</span>
              </button>
              {AVATARS.map(av => (
                <button key={av.id} onClick={() => { saveAvatar(av.id); }} className="btn-tap" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer' }}>
                  <div style={{ position:'relative', borderRadius:'50%', padding:3, background: avatar===av.id ? grad(T) : 'transparent' }}>
                    <PixelAvatar av={av} size={58} />
                  </div>
                  <span style={{ fontSize:9.5, fontWeight:700, color: avatar===av.id ? T.accent : 'var(--txt-2)' }}>{av.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}

      <button onClick={() => goWrapped?.()} className="btn-tap" style={{ width:'100%', position:'relative', overflow:'hidden', textAlign:'left', cursor:'pointer', borderRadius:20, padding:'16px 18px', marginBottom:14, background:`linear-gradient(135deg, ${T.accent}, ${T.accent2})`, color:'#04060a', border:'none', boxShadow:`0 12px 30px ${hex2rgba(T.accent,.4)}` }}>
        <div style={{ position:'absolute', top:-30, right:-20, width:110, height:110, borderRadius:'50%', background:'#ffffff55', filter:'blur(38px)', pointerEvents:'none' }} />
        <div style={{ position:'relative' }}><div style={{ fontSize:9, fontWeight:900, letterSpacing:2, textTransform:'uppercase', opacity:.8 }}>Velocity</div><div style={{ fontSize:19, fontWeight:900, letterSpacing:-.4, marginTop:2 }}>Wrapped</div><div style={{ fontSize:11, fontWeight:700, opacity:.85, marginTop:3 }}>Tus artistas, canciones y minutos</div></div>
      </button>

      <SettingCard title="Color de Acento">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:9 }}>
          {Object.entries(THEMES).map(([key, th]) => (
            <button key={key} aria-label={th.name} onClick={() => setThemeKey(key)} className="btn-tap" style={{ height:44, borderRadius:14, background: key===themeKey ? hex2rgba(th.accent,.16) : 'var(--surf-1)', border:`2px solid ${key===themeKey ? th.accent : 'var(--line-soft)'}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <div style={{ width:18, height:18, borderRadius:'50%', background:`linear-gradient(135deg, ${th.accent}, ${th.accent2})`, boxShadow: key===themeKey ? `0 0 12px ${th.accent}` : 'none' }} />
            </button>
          ))}
        </div>
        <div style={{ fontSize:11, color:T.accent, fontWeight:800, textAlign:'center', marginTop:11 }}>{(THEMES[themeKey] || { name: activePalette.name || 'Personalizado' }).name}</div>
      </SettingCard>

      <SettingCard title="Paleta personalizada">
        <div style={{ display:'flex', gap:9, overflowX:'auto', paddingBottom:4, marginBottom: themeKey==='custom' ? 14 : 0 }}>
          {customPalettes.map(p => {
            const act = themeKey==='custom' && p.id===activeCustomId;
            return (
              <button key={p.id} onClick={() => { setActiveCustomId(p.id); setThemeKey('custom'); }} className="btn-tap" style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:7, width:64, padding:'10px 6px', borderRadius:15, background: act ? hex2rgba(p.accent,.16) : 'var(--surf-1)', border:`2px solid ${act ? p.accent : 'var(--line-soft)'}`, cursor:'pointer' }}>
                <div style={{ width:30, height:30, borderRadius:'50%', background:`linear-gradient(135deg, ${p.accent}, ${p.accent2})`, boxShadow: act ? `0 0 12px ${p.accent}` : 'none' }} />
                <span style={{ fontSize:9, fontWeight:700, color: act ? p.accent : 'var(--txt-2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:56 }}>{p.name}</span>
              </button>
            );
          })}
          <button onClick={addPalette} aria-label="Nueva paleta" className="btn-tap" style={{ flexShrink:0, width:64, borderRadius:15, background:'var(--surf-1)', border:'2px dashed var(--line)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--txt-2)' }}><Icon.Plus c="var(--txt-1)" sz={22} /></button>
        </div>

        {themeKey==='custom' && (
          <div className="fade-up" style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <div style={{ fontSize:10.5, fontWeight:800, color:'var(--txt-2)', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Nombre</div>
              <input type="text" value={activePalette.name || ''} onChange={e => updatePalette({ name: e.target.value })} placeholder="Mi paleta" style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'10px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
            </div>
            <ColorField label="Acento" value={activePalette.accent || '#8b5cf6'} onChange={v => updatePalette({ accent: v })} />
            <ColorField label="Acento 2" value={activePalette.accent2 || '#ec4899'} onChange={v => updatePalette({ accent2: v })} />
            <ColorField label="Fondo (tono)" value={activePalette.bg || '#04060a'} onChange={v => updatePalette({ bg: v })} hint="Tiñe las superficies oscuras del reproductor." />
            <div style={{ display:'flex', gap:9, alignItems:'center', marginTop:2 }}>
              <div style={{ flex:1, height:56, borderRadius:14, background:`linear-gradient(135deg, ${activePalette.accent||'#8b5cf6'}, ${activePalette.accent2||'#ec4899'})`, boxShadow:`0 6px 20px ${hex2rgba(activePalette.accent||'#8b5cf6',.4)}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:900, color:'#04060a', letterSpacing:1 }}>VISTA PREVIA</div>
              {activePalette.bg && <button onClick={() => updatePalette({ bg: undefined })} className="btn-tap" title="Quitar tono de fondo" style={{ height:56, padding:'0 14px', borderRadius:14, background:'var(--surf-1)', border:'1px solid var(--line)', cursor:'pointer', color:'var(--txt-1)', fontSize:11, fontWeight:700 }}>Fondo neutro</button>}
              <button onClick={deletePalette} aria-label="Eliminar paleta" className="btn-tap" style={{ height:56, width:56, borderRadius:14, background:hex2rgba('#fb7185',.12), border:`1px solid ${hex2rgba('#fb7185',.3)}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.Trash c="#fb7185" sz={19} /></button>
            </div>
          </div>
        )}
      </SettingCard>

      <SettingCard title="Descargas (offline)">
        <div style={{ fontSize:11.5, color:'var(--txt-2)', lineHeight:1.5, marginBottom:12 }}>Tus descargas se guardan en este dispositivo y no se pierden al actualizar la app ni al cerrar sesión.</div>
        <button onClick={openDownloads} className="btn-tap" style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:9, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:14, padding:'12px 0', cursor:'pointer', color:'var(--txt-0)', fontSize:13, fontWeight:800 }}>
          <Icon.Down c={T.accent} sz={17} /> Administrar descargas
        </button>
      </SettingCard>

      {dlOpen && createPortal(
        <>
          <div onClick={() => setDlOpen(false)} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:130 }} />
          <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'82dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 16px calc(env(safe-area-inset-bottom, 16px) + 20px)', zIndex:131, boxShadow:'0 -30px 80px #000d' }}>
            <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 12px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Descargas</div>
              <button aria-label="Cerrar" onClick={() => setDlOpen(false)} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
            </div>
            {!dlInfo ? (
              <div style={{ display:'flex', justifyContent:'center', padding:'30px 0' }}><Spinner c={T.accent} sz={22} /></div>
            ) : dlInfo.count === 0 ? (
              <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:12.5, padding:'24px 0' }}>No tienes canciones descargadas.</div>
            ) : (<>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div style={{ fontSize:11.5, color:'var(--txt-2)', fontWeight:700 }}>{dlInfo.count} {dlInfo.count===1?'canción':'canciones'} · {fmtBytes(dlInfo.bytes)}</div>
                <button onClick={delAll} className="press" style={{ background:hex2rgba('#fb7185',.12), border:`1px solid ${hex2rgba('#fb7185',.3)}`, borderRadius:99, padding:'6px 13px', cursor:'pointer', color:'#fb7185', fontSize:11, fontWeight:800 }}>Borrar todas</button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {dlInfo.items.map(it => (
                  <div key={it.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 6px' }}>
                    <CoverImg src={it.meta.cover} alt="" radius={10} size={96} style={{ width:44, height:44, flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.meta.title || 'Sin título'}</div>
                      <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.meta.artist || ''} · {fmtBytes(it.size)}</div>
                    </div>
                    <button aria-label="Eliminar descarga" onClick={() => delOne(it.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:6, flexShrink:0 }}><Icon.Trash c="#fb7185" sz={17} /></button>
                  </div>
                ))}
              </div>
            </>)}
          </div>
        </>,
        document.body
      )}

      <SettingCard title="Calidad de Audio">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
          {[['high','Alta','Opus ~160k'],['medium','Media','AAC ~128k'],['low','Baja','~96k · ahorro']].map(([val,label,desc]) => (
            <button key={val} onClick={() => setQuality(val)} className="btn-tap" style={{ padding:'9px 0', borderRadius:13, fontSize:11.5, fontWeight:800, background: val===quality ? grad(T) : 'var(--surf-1)', color: val===quality ? '#04060a' : 'var(--txt-2)', border: `1px solid ${val===quality ? 'transparent' : 'var(--line-soft)'}`, cursor:'pointer', boxShadow: val===quality ? `0 4px 14px ${hex2rgba(T.accent,.4)}` : 'none', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
              {label}<span style={{ fontSize:8.5, fontWeight:700, opacity:.8 }}>{desc}</span>
            </button>
          ))}
        </div>
      </SettingCard>

      <SettingCard title="Intensidad del brillo" badge={`${glow}%`} accent={T.accent}>
        <RangeSlider value={glow} min={10} max={100} onChange={setGlow} accent={T.accent} ariaLabel="Brillo" />
        <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:9, lineHeight:1.5 }}>Controla el resplandor de color detrás de la portada en el reproductor a pantalla completa y en el mini-reproductor. Súbelo para un ambiente más intenso.</div>
      </SettingCard>

      <SettingCard title="Reproducción">
        <ToggleRow label="Reproducción automática" desc="Continúa al terminar la pista" on={settings.autoplay} onToggle={() => set('autoplay', !settings.autoplay)} T={T} />
        <ToggleRow label="Normalizar volumen" desc="Mismo nivel en todas las pistas" on={settings.normalize} onToggle={() => set('normalize', !settings.normalize)} T={T} />
      </SettingCard>

      {!isStandalone && (
        <SettingCard title="Aplicación">
          {canInstall ? (
            <button onClick={installApp} className="btn-tap" style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:grad(T), border:'none', borderRadius:14, padding:'13px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.4)}` }}>
              <Icon.Down c="#04060a" sz={18} /> Instalar en pantalla de inicio
            </button>
          ) : isIOS ? (
            <div style={{ fontSize:12, color:'var(--txt-1)', lineHeight:1.6 }}>
              Para instalar en tu iPhone: toca el botón <b>Compartir</b> de Safari y luego <b>“Agregar a inicio”</b>. La app aparecerá con su ícono en la pantalla de inicio.
            </div>
          ) : (
            <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.6 }}>
              Abre esta página en Chrome y usa el menú <b>⋮ → “Instalar app”</b> (o “Agregar a pantalla de inicio”) para instalarla como aplicación.
            </div>
          )}
        </SettingCard>
      )}

      <button onClick={onLogout} className="btn-tap" style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:16, padding:'14px 0', cursor:'pointer', color:'#fb7185', fontSize:13, fontWeight:800, marginTop:6 }}>
        <Icon.Out c="#fb7185" sz={17} /> Cerrar sesión
      </button>

      {!confirmDelete ? (
        <button onClick={() => setConfirmDelete(true)} className="press" style={{ width:'100%', background:'none', border:'none', cursor:'pointer', color:'var(--txt-3)', fontSize:11.5, fontWeight:700, marginTop:14, padding:'8px 0' }}>Eliminar mi cuenta</button>
      ) : (
        <div style={{ marginTop:14, background:hex2rgba('#fb7185',.08), border:`1px solid ${hex2rgba('#fb7185',.3)}`, borderRadius:16, padding:16 }}>
          <div style={{ fontSize:12.5, fontWeight:800, color:'#fb7185', marginBottom:6 }}>¿Eliminar tu cuenta?</div>
          <div style={{ fontSize:11, color:'var(--txt-2)', lineHeight:1.5, marginBottom:12 }}>Se borrarán tu perfil, playlists, favoritos e historial de forma permanente. Esta acción no se puede deshacer.</div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="btn-tap" style={{ flex:1, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 0', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:800 }}>Cancelar</button>
            <button onClick={doDelete} disabled={deleting} className="btn-tap" style={{ flex:1, background:'#fb7185', border:'none', borderRadius:12, padding:'11px 0', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>{deleting && <Spinner c="#04060a" sz={15} />}Eliminar</button>
          </div>
        </div>
      )}

      <div style={{ textAlign:'center', fontSize:9.5, color:'var(--txt-3)', marginTop:16 }}>VELOCITY MUSIC · v1.0</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADD TO PLAYLIST MODAL

