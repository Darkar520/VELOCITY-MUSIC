import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api, isAuthed, setOnUnauthorized } from './api.js';
import * as offline from './offline.js';
import { CSS, THEMES, SEED_ROWS, LATIN_ROWS, DISCOVERY, GENRES, ONBOARDING_GENRES, MOODS, ERAS, FALLBACK_COVER, BASE_VARS } from './constants.js';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, tintedVars } from './helpers.js';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack } from './catalog.js';
import { usePersisted, useViewport, useDominantColor, useHSwipe } from './hooks.js';
import { Icon } from './Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from './components.jsx';
import { Avatar, PixelAvatar, AVATARS } from './avatars.jsx';

// ── Error Boundary global: evita que un crash de React quede en pantalla negra.
// Si el componente lanza un error no capturado, muestra un botón de recarga
// en lugar de un div vacío negro. Imprescindible para el login de Google y
// cambios de estado bruscos (logout, etc.).
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e) { console.error('[Velocity] Error capturado:', e); }
  render() {
    if (!this.state.error) return this.props.children;
    // Solo mostrar fallback si hay un crash real — recarga automática en 3s.
    setTimeout(() => window.location.reload(), 3000);
    return (
      <div style={{ minHeight:'100dvh', background:'#04060a', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Inter,sans-serif' }}>
        <div style={{ width:32, height:32, border:'3px solid #10d9a0', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
}
export { AppErrorBoundary };


// ═══════════════════════════════════════════════════════════════
// AUTH SCREEN — login / registro
// ═══════════════════════════════════════════════════════════════
function AuthScreen({ onAuthed, T }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [backendDown, setBackendDown] = useState(false);
  useEffect(() => {
    api.authConfig().then(cfg => setGoogleClientId((cfg && cfg.googleClientId) || '')).catch(() => {});
    // Detectar si el backend está caído.
    api.pingBackend().then(ok => setBackendDown(!ok));
  }, []);
  const googleLogin = () => {
    if (!googleClientId) return;
    setBusy(true); setErr('');
    // Flujo de redirect completo (no popup). La ventana principal navega a
    // Google, que redirige a /auth/google/callback/ con el credential en el
    // hash. Esa página llama al backend, guarda el JWT en localStorage y
    // redirige de vuelta a /.
    //
    // Este flujo es robusto en TODOS los navegadores (incluido Brave, que
    // bloquea window.opener en popups cross-origin) y en móviles.
    const redirect = window.location.origin + '/auth/google/callback';
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(googleClientId) + '&redirect_uri=' + encodeURIComponent(redirect) + '&response_type=id_token&scope=openid%20email%20profile&nonce=' + Date.now();
    window.location.assign(url);
  };

  // ── Detección de resultado de Google OAuth tras redirect ──
  // Después del redirect de vuelta a /, el hash puede contener:
  //   #google_auth_error=<mensaje>  → mostrar error en el form de login
  //   (nada)                         → flujo normal, no hacer nada
  useEffect(() => {
    const h = window.location.hash;
    if (h.startsWith('#google_auth_error=')) {
      const msg = decodeURIComponent(h.slice('#google_auth_error='.length));
      setErr(msg === 'no_token' ? 'Google no devolvió un token. Intenta de nuevo.' : msg);
      // Limpiar el hash para que no se quede pegado si el usuario recarga.
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const guestLogin = async () => {
    setErr(''); setBusy(true);
    try { const data = await api.guestLogin(); onAuthed(data.email || '', data.displayName || 'Invitado'); }
    catch (e2) { setErr(e2.message || 'No se pudo entrar como invitado.'); setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setOkMsg(''); setBusy(true);
    try {
      let displayName = '';
      if (mode === 'register') {
        const reg = await api.register(email, password, name.trim());
        displayName = (reg && reg.displayName) || name.trim();
        await api.login(email, password);
      } else {
        const data = await api.login(email, password);
        displayName = (data && data.displayName) || '';
      }
      onAuthed(email, displayName);
    } catch (e2) {
      setErr(e2.message || 'No se pudo completar la operación.');
    } finally { setBusy(false); }
  };

  const input = { width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:14, padding:'13px 15px', fontSize:14, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif', marginBottom:12 };

  return (
    <div style={{ minHeight:'100dvh', background:`radial-gradient(circle at 30% 0%, #0d1320, #04060a 60%)`, display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:'Inter,sans-serif' }}>
      <div className="fade-up" style={{ width:'min(420px, 100%)', background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:28, padding:'34px 28px', boxShadow:`0 30px 90px #000c, 0 0 40px ${hex2rgba(T.accent,.1)}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:26 }}>
          <div style={{ width:46, height:46, borderRadius:14, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 6px 20px ${hex2rgba(T.accent,.5)}` }}><Icon.Play c="#04060a" sz={22} /></div>
          <div>
            <div style={{ fontSize:20, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.4, lineHeight:1 }}>VELOCITY</div>
            <div style={{ fontSize:12, fontWeight:800, letterSpacing:5, color:T.accent }}>MUSIC</div>
          </div>
        </div>

        <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', marginBottom:4 }}>{mode==='login'?'Inicia sesión':'Crea tu cuenta'}</div>
        <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:22 }}>{mode==='login'?'Entra para acceder a tu música.':'Regístrate para guardar tu biblioteca.'}</div>

        <form onSubmit={submit}>
          {mode==='register' && <input style={input} type="text" placeholder="¿Cómo te llamas?" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={40} required />}
          <input style={input} type="email" placeholder="Correo electrónico" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required />
          <input style={input} type="password" placeholder="Contraseña" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='login'?'current-password':'new-password'} required />
          {mode==='register' && <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:-4, marginBottom:12, lineHeight:1.5 }}>Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.</div>}
          {err && <div style={{ fontSize:12, color:'#fb7185', marginBottom:12, fontWeight:600 }}>{err}</div>}
          {okMsg && <div style={{ fontSize:12, color:T.accent, marginBottom:12, fontWeight:600 }}>{okMsg}</div>}
          <button type="submit" disabled={busy} className="btn-tap" style={{ width:'100%', background:grad(T), border:'none', borderRadius:14, padding:'14px 0', cursor:'pointer', color:'#04060a', fontSize:14, fontWeight:800, boxShadow:`0 8px 24px ${hex2rgba(T.accent,.4)}`, display:'flex', alignItems:'center', justifyContent:'center', gap:10, opacity: busy?.7:1 }}>
            {busy && <Spinner c="#04060a" sz={18} />}{mode==='login'?'Entrar':'Registrarme'}
          </button>
        </form>

        {googleClientId && (<>
          <div style={{ display:'flex', alignItems:'center', gap:10, margin:'18px 0 16px' }}><div style={{ flex:1, height:1, background:'var(--line)' }} /><span style={{ fontSize:11, color:'var(--txt-2)', fontWeight:700 }}>o</span><div style={{ flex:1, height:1, background:'var(--line)' }} /></div>
          <button onClick={googleLogin} disabled={busy} className="btn-tap" style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:14, padding:'12px 0', cursor:'pointer', opacity: busy?.7:1 }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0012 23z" fill="#34A853"/><path d="M5.84 14.09a6.6 6.6 0 010-4.18V7.07H2.18a10.99 10.99 0 000 9.86l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.98 10.98 0 0012 1 10.99 10.99 0 002.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)' }}>Continuar con Google</span>
          </button>
        </>)}

        <button onClick={guestLogin} disabled={busy} className="btn-tap" style={{ width:'100%', marginTop:10, display:'flex', alignItems:'center', justifyContent:'center', gap:9, background:'transparent', border:'1px dashed var(--line)', borderRadius:14, padding:'12px 0', cursor:'pointer', color:'var(--txt-1)', fontSize:13, fontWeight:700, opacity: busy?.7:1 }}>
          <Icon.User c="var(--txt-1)" sz={17} /> Entrar como invitado
        </button>
        <div style={{ fontSize:10, color:'var(--txt-3)', textAlign:'center', marginTop:8, lineHeight:1.5 }}>Modo invitado: explora sin compartir tus datos. Tu biblioteca se guarda solo en esta sesión.</div>

        {backendDown && (
          <div style={{ marginTop:16, padding:'14px 16px', background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.3)}`, borderRadius:14, textAlign:'center' }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.accent, marginBottom:6 }}>Servidor sin conexión</div>
            <div style={{ fontSize:11, color:'var(--txt-2)', marginBottom:12, lineHeight:1.5 }}>El backend no está respondiendo. Si ya tienes una sesión previa, puedes entrar a tu biblioteca offline.</div>
            {isAuthed() ? (
              <button onClick={() => onAuthed(localStorage.getItem('velocity.email') || '', localStorage.getItem('velocity.name') || 'Usuario')} className="btn-tap" style={{ width:'100%', background:grad(T), border:'none', borderRadius:12, padding:'12px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800 }}>Entrar a mi biblioteca</button>
            ) : (
              <div style={{ fontSize:11, color:'var(--txt-3)' }}>Inicia sesión cuando el servidor vuelva para acceder a tu biblioteca.</div>
            )}
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:20, fontSize:12.5, color:'var(--txt-2)' }}>
          {mode==='login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button onClick={() => { setMode(mode==='login'?'register':'login'); setErr(''); }} style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontWeight:800, fontSize:12.5 }}>
            {mode==='login' ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WRAPPED VIEW
// ═══════════════════════════════════════════════════════════════
function WrappedView({ ctx }) {
  const { T, favs, setView, play, playStats } = ctx;
  const stats = playStats || {};
  const favSet = new Set(favs || []);
  const entries = Object.entries(stats).map(([id, v]) => ({ id, ...v }));
  const totalPlays = entries.reduce((s, e) => s + (e.count || 0), 0);
  const topTracks = entries.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 5);
  const artistAgg = {};
  entries.forEach(e => { const a = e.artist || '?'; if (!artistAgg[a]) artistAgg[a] = { plays: 0, tracks: 0, cover: e.cover }; artistAgg[a].plays += e.count || 0; artistAgg[a].tracks += 1; if (!artistAgg[a].cover) artistAgg[a].cover = e.cover; });
  const topArtists = Object.entries(artistAgg).sort((a, b) => b[1].plays - a[1].plays).slice(0, 5);
  const totalMin = Math.round(entries.reduce((s, e) => s + ((e.durationSeconds || 0) * (e.count || 0)), 0) / 60);
  const stat = (n, l) => (<div style={{ flex:1, background:'var(--surf-0)', border:'1px solid var(--line-soft)', borderRadius:18, padding:'16px 10px', textAlign:'center' }}><div style={{ fontSize:26, fontWeight:900, background:grad(T), WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', lineHeight:1 }}>{n}</div><div style={{ fontSize:9.5, color:'var(--txt-2)', fontWeight:800, letterSpacing:.8, textTransform:'uppercase', marginTop:6 }}>{l}</div></div>);
  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <button onClick={() => setView(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:16, paddingTop:4, fontSize:13, fontWeight:700 }}><Icon.ChevL c="var(--txt-1)" sz={18} /> Atras</button>
      <div style={{ position:'relative', overflow:'hidden', borderRadius:26, padding:'28px 22px', marginBottom:18, background:`linear-gradient(135deg, ${T.accent}, ${T.accent2})`, color:'#04060a', boxShadow:`0 20px 48px ${hex2rgba(T.accent,.45)}` }}>
        <div style={{ position:'absolute', top:-40, right:-30, width:150, height:150, borderRadius:'50%', background:'#ffffff55', filter:'blur(44px)', pointerEvents:'none' }} />
        <div style={{ position:'relative' }}><div style={{ fontSize:10.5, fontWeight:900, letterSpacing:2.5, textTransform:'uppercase', opacity:.8 }}>Velocity</div><div style={{ fontSize:30, fontWeight:900, letterSpacing:-.8, marginTop:3, lineHeight:1 }}>Wrapped</div><div style={{ fontSize:12, fontWeight:700, opacity:.85, marginTop:9 }}>Todo lo que has escuchado.</div></div>
      </div>
      <div style={{ display:'flex', gap:10, marginBottom:22 }}>{stat(totalPlays, 'Reproducciones')}{stat(entries.length, 'Canciones')}{stat(totalMin > 0 ? totalMin : '—', 'Minutos')}</div>
      {topArtists.length > 0 && (<><SectionHeader label="Tus Artistas Top" accent={T.accent} /><div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:22 }}>{topArtists.map(([a, info], i) => (<div key={a} style={{ display:'flex', alignItems:'center', gap:14, padding:'9px 12px', borderRadius:16, background:'var(--surf-0)', border:'1px solid var(--line-soft)' }}><div style={{ fontSize:17, fontWeight:900, color:T.accent, width:20, textAlign:'center' }}>{i+1}</div>{info.cover ? <CoverImg src={info.cover} alt="" radius={99} style={{ width:44, height:44, flexShrink:0 }} /> : <div style={{ width:44, height:44, borderRadius:'50%', background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, color:'#04060a', flexShrink:0 }}>{(a[0]||'?').toUpperCase()}</div>}<div style={{ minWidth:0, flex:1 }}><div style={{ fontSize:14, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a}</div><div style={{ fontSize:10, color:'var(--txt-2)', fontWeight:700, marginTop:2 }}>{info.plays} reproducciones</div></div></div>))}</div></>)}
      {topTracks.length > 0 && (<><SectionHeader label="Tus Canciones Top" accent={T.accent} /><div style={{ display:'flex', flexDirection:'column', gap:6 }}>{topTracks.map((t, i) => (<div key={t.id} onClick={() => play(t, topTracks.map(x => x.id))} className="card-hover" style={{ display:'flex', alignItems:'center', gap:14, padding:'8px 12px', borderRadius:16, cursor:'pointer', background:'var(--surf-0)', border:'1px solid var(--line-soft)' }}><div style={{ fontSize:17, fontWeight:900, color:T.accent, width:20, textAlign:'center' }}>{i+1}</div><CoverImg src={t.cover} alt="" radius={11} style={{ width:44, height:44, flexShrink:0 }} /><div style={{ minWidth:0, flex:1 }}><div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.title}</div><div style={{ fontSize:11, color:'var(--txt-2)', marginTop:2 }}>{t.artist}</div></div><span style={{ fontSize:9.5, fontWeight:800, color:T.accent, flexShrink:0 }}>{t.count}x</span></div>))}</div></>)}
      {entries.length === 0 && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>Reproduce musica y aqui veras tu Wrapped.</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME TAB
// ═══════════════════════════════════════════════════════════════
function HomeTab({ ctx }) {
  const { track, playing, play, T, favs, toggleFav, recent, playlists, downloaded, onMenu, goMix, homeRows, homeLoading, displayName, avatar, email, setTab, startAiDj, onboardPrefs, setOnboardPrefs, backendDown, GENRES: GENRES_LIST } = ctx;
  const [djBusy, setDjBusy] = useState(false);
  const [onboardSel, setOnboardSel] = useState([]);
  const recentTracks = dedupeByTitle(recent.map(trackById).filter(Boolean));
  const recentIds = recentTracks.map(t => t.id);
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      {onboardPrefs === null && !recent.length && !favs.length && (
        <div style={{ padding:'20px 0 30px', textAlign:'center' }}>
          <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', marginBottom:6 }}>¿Qué te gusta escuchar?</div>
          <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:20 }}>Elige al menos 3 para personalizar tu feed</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, justifyContent:'center', marginBottom:22 }}>
            {(GENRES_LIST || GENRES).map(g => {
              const active = onboardSel.some(s => s.q === g.q);
              return (
                <button key={g.q} onClick={() => setOnboardSel(prev => active ? prev.filter(s => s.q !== g.q) : [...prev, { label: g.label, q: g.q }])} className="btn-tap" style={{ padding:'8px 16px', borderRadius:99, border: active ? `2px solid ${T.accent}` : '1.5px solid var(--line)', background: active ? hex2rgba(T.accent, .18) : 'var(--surf-1)', color: active ? T.accent : 'var(--txt-1)', fontSize:13, fontWeight:700, cursor:'pointer', transition:'all .15s ease' }}>
                  {g.label}
                </button>
              );
            })}
          </div>
          <button disabled={onboardSel.length < 3} onClick={() => setOnboardPrefs(onboardSel)} className="btn-tap" style={{ padding:'12px 36px', borderRadius:99, border:'none', background: onboardSel.length >= 3 ? T.accent : 'var(--surf-2)', color: onboardSel.length >= 3 ? '#000' : 'var(--txt-3)', fontSize:14, fontWeight:800, cursor: onboardSel.length >= 3 ? 'pointer' : 'not-allowed', opacity: onboardSel.length >= 3 ? 1 : .5, transition:'all .2s ease' }}>
            Continuar
          </button>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22, paddingTop:4 }}>
        <div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>{greet}</div>
          <div style={{ fontSize:12.5, color:'var(--txt-2)', marginTop:4 }}>¿Qué quieres escuchar hoy?</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:9, flexShrink:0 }}>
          <button aria-label="AI DJ" onClick={async () => { if (djBusy) return; setDjBusy(true); try { await startAiDj?.(); } finally { setDjBusy(false); } }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.35)}`, borderRadius:99, padding:'7px 13px', cursor:'pointer', color:T.accent, fontSize:11, fontWeight:800 }}>{djBusy ? <Spinner c={T.accent} sz={13} /> : <Icon.Play c={T.accent} sz={13} />} AI DJ</button>
          <button onClick={() => ctx.setTab('profile')} className="press" aria-label="Perfil" style={{ background:'none', border:'none', padding:0, cursor:'pointer' }}><Avatar avatar={ctx.avatar} name={ctx.displayName} email={ctx.email} T={T} size={40} /></button>
        </div>
      </div>

      {track && (
        <div onClick={() => play(track)} style={{ position:'relative', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.22)}, ${hex2rgba(T.accent2,.06)}), var(--surf-0)`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:22, padding:'15px 17px', marginBottom:24, display:'flex', alignItems:'center', gap:14, overflow:'hidden', boxShadow:`0 12px 34px ${hex2rgba(T.accent,.14)}`, cursor:'pointer' }}>
          <div style={{ position:'absolute', top:-30, right:-20, width:120, height:120, borderRadius:'50%', background:grad(T), filter:'blur(40px)', opacity:.35, pointerEvents:'none' }} />
          <img src={track.cover ? hiResCover(track.cover, 128) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }} style={{ width:56, height:56, borderRadius:14, objectFit:'cover', boxShadow:`0 0 22px ${hex2rgba(T.accent,.5)}`, position:'relative' }} />
          <div style={{ flex:1, minWidth:0, position:'relative' }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2, color:T.accent, textTransform:'uppercase', marginBottom:5 }}>{playing ? '◉ Reproduciendo' : 'Última pista'}</div>
            <div style={{ fontSize:15.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
            <div style={{ fontSize:11, color:'var(--txt-1)', marginTop:2 }}>{track.artist}</div>
          </div>
          {playing && <EQViz color={T.accent} color2={T.accent2} playing={playing} bars={6} h={28} />}
        </div>
      )}

      {recentTracks.length > 0 && (
        <>
          <SectionHeader label="Escuchado Recientemente" accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
            {recentTracks.map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, recentIds)} onPlay={() => play(t, recentIds)} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
          </div>
        </>
      )}

      {homeLoading && homeRows.length === 0 && !backendDown && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:'40px 0', color:'var(--txt-2)' }}>
          <Spinner c={T.accent} sz={26} /><span style={{ fontSize:12.5 }}>Cargando música…</span>
        </div>
      )}

      {/* Modo sin conexión: mostrar biblioteca cacheada en vez del feed */}
      {backendDown && homeRows.length === 0 && (
        <>
          {recentTracks.length > 0 && (
            <>
              <SectionHeader label="Escuchado Recientemente" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {recentTracks.map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, recentIds)} onPlay={() => play(t, recentIds)} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {favs.length > 0 && (
            <>
              <SectionHeader label="Me Gusta" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {favs.slice(0, 20).map(id => trackById(id)).filter(Boolean).map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, favs)} onPlay={() => play(t, favs)} onFav={() => toggleFav(t.id)} faved={true} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {downloaded.size > 0 && (
            <>
              <SectionHeader label="Descargadas" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {[...downloaded].slice(0, 20).map(id => trackById(id)).filter(Boolean).map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, [...downloaded])} onPlay={() => play(t, [...downloaded])} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {recentTracks.length === 0 && favs.length === 0 && downloaded.size === 0 && (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--txt-2)' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--txt-1)', marginBottom:6 }}>Sin conexión al servidor</div>
              <div style={{ fontSize:12, lineHeight:1.5 }}>Tu biblioteca aparecerá aquí cuando vuelva la conexión. Las canciones descargadas siguen disponibles.</div>
            </div>
          )}
        </>
      )}

      {homeRows.map(sec => (
        <div key={sec.section}>
          <SectionHeader label={sec.section} accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:20 }}>
            {(sec.mixes || []).map(mix => (
              <MixCard key={mix.label} mix={mix} T={T}
                onOpen={() => goMix(mix)}
                onPlay={() => { const ids = mix.tracks.map(t => t.id); play(mix.tracks[0], ids, { mixLabel: mix.label }); }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEARCH TAB
// ═══════════════════════════════════════════════════════════════
function SearchTab({ ctx }) {
  const { track, playing, play, T, favs, toggleFav, addToTarget, onMenu, recentSearches, addSearch, removeSearch, downloaded, downloading, goArtist, goAlbum, goMix, selecting, selection, toggleSelect, startSelection, addToQueue, removeFromQueue, backendDown } = ctx;
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ songs: [], albums: [], artists: [] });
  const [relatedMixes, setRelatedMixes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes({ songs: [], albums: [], artists: [] }); setErr(''); setLoading(false); return; }
    setLoading(true); setErr('');
    const ctrl = new AbortController();
    let alive = true;                                  // solo la búsqueda vigente actualiza la UI
    const aborted = (e) => e && (e.name === 'AbortError' || ctrl.signal.aborted);
    const id = setTimeout(async () => {
      // Intenta searchAll; si falla por algo transitorio, cae a search; y reintenta 1 vez.
      const attempt = async () => {
        try {
          const d = await api.searchAll(term, ctrl.signal);
          return { songs: dedupeByTitle((d.songs || []).map(normalizeTrack)), albums: d.albums || [], artists: d.artists || [] };
        } catch (e) {
          if (aborted(e)) throw e;                      // cancelada: no es error real
          const raw = await api.search(term, ctrl.signal); // respaldo
          return { songs: dedupeByTitle(raw.map(normalizeTrack)), albums: [], artists: [] };
        }
      };
      try {
        let data;
        try { data = await attempt(); }
        catch (e) {
          if (aborted(e)) return;                        // superada por otra búsqueda
          await new Promise(r => setTimeout(r, 700));    // breve pausa y un reintento
          if (!alive || ctrl.signal.aborted) return;
          data = await attempt();
        }
        if (!alive || ctrl.signal.aborted) return;
        setRes(data); setErr('');
      } catch (e) {
        if (!aborted(e) && alive) setErr('No se pudo buscar. Revisa tu conexión e inténtalo de nuevo.');
      } finally {
        if (alive && !ctrl.signal.aborted) setLoading(false);
      }
    }, 380);
    return () => { alive = false; clearTimeout(id); ctrl.abort(); };
  }, [q]);

  const runGenre = (g) => { setQ(g.q); addSearch(g.label); };
  const empty = !res.songs.length && !res.albums.length && !res.artists.length;

  // Generar mixes relacionados en background cuando hay resultados de canciones.
  // Toma la canción top + artistas del resultado → radio de cada uno → mixes únicos.
  useEffect(() => {
    setRelatedMixes([]);
    const songs = res.songs;
    if (!songs.length) return;
    let cancelled = false;
    (async () => {
      const mixes = [];
      const usedArtists = new Set();
      // Hasta 4 mixes: la pista top + los 3 artistas más representados.
      const candidates = [];
      // Pista top del resultado
      if (songs[0]) candidates.push(songs[0]);
      // Artistas distintos del resultado (top 3)
      for (const t of songs) {
        const ak = (t.artist || '').toLowerCase().replace(/\s+/g, '');
        if (!ak || usedArtists.has(ak)) continue;
        if (!candidates.find(c => (c.artist||'').toLowerCase().replace(/\s+/g,'') === ak)) candidates.push(t);
        if (candidates.length >= 4) break;
      }
      for (const base of candidates) {
        if (cancelled) break;
        const ak = (base.artist || '').toLowerCase().replace(/\s+/g, '');
        if (usedArtists.has(ak)) continue;
        usedArtists.add(ak);
        try {
          const rel = await api.radio(base.id, 50);
          if (cancelled) break;
          const tracks = capPerArtist(dedupeByTitle([base, ...rel.map(normalizeTrack)]), 6).filter(t => t.id).slice(0, 50);
          if (tracks.length >= 6) {
            mixes.push({ label: base.artist || base.title || 'Mix', tracks });
            if (!cancelled) setRelatedMixes([...mixes]);
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [res.songs]);

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginBottom:18, paddingTop:4 }}>Explorar</div>

      {backendDown && (
        <div style={{ textAlign:'center', padding:'24px 20px', background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:18, marginBottom:22 }}>
          <Icon.WifiOff c={T.accent} sz={28} />
          <div style={{ fontSize:15, fontWeight:800, color:'var(--txt-0)', marginTop:10, marginBottom:4 }}>Búsqueda no disponible</div>
          <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.5 }}>El servidor está sin conexión. Explora tu biblioteca y reproduce canciones descargadas mientras tanto.</div>
          <button onClick={() => ctx.setTab('library')} className="btn-tap" style={{ marginTop:14, background:grad(T), border:'none', borderRadius:99, padding:'9px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Ir a mi biblioteca</button>
        </div>
      )}

      <div style={{ position:'relative', marginBottom:22 }}>
        <div style={{ position:'absolute', left:15, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
          {loading ? <Spinner c={T.accent} sz={17} /> : <Icon.Search c={q ? T.accent : 'var(--txt-2)'} sz={17} />}
        </div>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onBlur={() => q.trim() && addSearch(q.trim())}
          placeholder="Artistas, canciones, álbumes…"
          style={{ width:'100%', background:'var(--surf-0)', border:`1px solid ${q ? hex2rgba(T.accent,.45) : 'var(--line-soft)'}`, borderRadius:16, padding:'13px 40px 13px 44px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif', transition:'border .2s, box-shadow .2s', boxShadow: q ? `0 0 0 4px ${hex2rgba(T.accent,.1)}` : 'none' }} />
        {q && <button aria-label="Limpiar" onClick={() => setQ('')} className="press" style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-2)" sz={16} /></button>}
      </div>

      {q ? (
        <>
          {err && <div style={{ textAlign:'center', color:'#fb7185', fontSize:12.5, paddingTop:20 }}>{err}</div>}
          {!loading && !err && empty && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:36 }}>Sin resultados para "{q}"</div>}

          {res.artists.length > 0 && (<>
            <SectionHeader label="Artistas" accent={T.accent} />
            <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
              {res.artists.map(a => (
                <div key={a.artistId} onClick={() => { goArtist(a.artistId, a.name); addSearch(a.name); }} className="card-hover" style={{ flexShrink:0, width:104, cursor:'pointer', textAlign:'center' }}>
                  <CoverImg src={a.thumbnail} alt={a.name} radius={999} style={{ width:104, height:104, borderRadius:'50%', boxShadow:'0 8px 22px #0007' }} />
                  <div style={{ fontSize:11.5, fontWeight:700, color:'var(--txt-0)', marginTop:8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.name}</div>
                  <div style={{ fontSize:9.5, color:'var(--txt-2)' }}>Artista</div>
                </div>
              ))}
            </div>
          </>)}

          {res.albums.length > 0 && (<>
            <SectionHeader label="Álbumes" accent={T.accent} />
            <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
              {res.albums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={`${a.artist || 'Álbum'}${a.year ? ' · ' + a.year : ''}`} T={T} onClick={() => goAlbum(a.albumId, a.name, a.artist, null, a.cover)} />)}
            </div>
          </>)}

          {res.songs.length > 0 && (<>
            <SectionHeader label="Canciones" accent={T.accent} action={!selecting && <button onClick={() => startSelection()} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Seleccionar</button>} />
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {res.songs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => { play(t, [t.id], { radio: true }); addSearch(q.trim()); }} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
            </div>
          </>)}

          {/* Mixes relacionados: radio de la canción top + artistas top del resultado */}
          {relatedMixes.length > 0 && (<>
            <SectionHeader label="Mixes relacionados" accent={T.accent} />
            <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
              {relatedMixes.map(m => <MixCard key={m.label} mix={m} T={T} onPlay={() => { play(m.tracks[0], m.tracks.map(t=>t.id)); addSearch(q.trim()); }} onOpen={() => { goMix(m); addSearch(q.trim()); }} />)}
            </div>
          </>)}
        </>
      ) : (
        <>
          {recentSearches.length > 0 && (
            <>
              <SectionHeader label="Búsquedas Recientes" accent={T.accent} />
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:22 }}>
                {recentSearches.map(s => (
                  <div key={s} onClick={() => setQ(s)} className="press" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'7px 12px', cursor:'pointer' }}>
                    <Icon.Clock c="var(--txt-2)" sz={13} />
                    <span style={{ fontSize:12, fontWeight:600, color:'var(--txt-0)' }}>{s}</span>
                    <button aria-label="Quitar" onClick={e => { e.stopPropagation(); removeSearch(s); }} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex' }}><Icon.X c="var(--txt-3)" sz={13} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
          <SectionHeader label="Explorar Géneros" accent={T.accent} />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:11 }}>
            {GENRES.map((g,i) => (
              <div key={g.label} onClick={() => runGenre(g)} className="card-hover fade-up" style={{ height:76, borderRadius:18, cursor:'pointer', overflow:'hidden', position:'relative', background:`linear-gradient(135deg, ${g.color}40, ${g.color}0a)`, border:`1px solid ${g.color}30`, animationDelay:`${i*.04}s`, display:'flex', alignItems:'flex-end', padding:'12px 14px', boxShadow:`0 6px 18px ${g.color}1f` }}>
                <div style={{ position:'absolute', top:-14, right:-14, width:60, height:60, background:g.color, borderRadius:'50%', opacity:.3, filter:'blur(8px)' }} />
                <span style={{ fontSize:12.5, fontWeight:800, color:'#fff', position:'relative' }}>{g.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEARCH BAR — input reutilizable para filtrar dentro de cualquier lista
// de canciones (playlist, mix, álbum, artista). Solo se muestra si la lista
// tiene 8+ canciones para no ocupar espacio en listas chicas.
// ═══════════════════════════════════════════════════════════════
function SearchBar({ value, onChange, placeholder = 'Buscar…', T }) {
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
// Devuelve [search, setSearch, filtered] donde filtered es la lista filtrada.
function useListSearch(list) {
  const [search, setSearch] = useState('');
  const showSearch = list.length >= 8;
  const norm = (s) => String(s || '').toLowerCase();
  const filtered = search.trim()
    ? list.filter(t => norm(t.title).includes(norm(search)) || norm(t.artist).includes(norm(search)))
    : list;
  return [search, setSearch, filtered, showSearch];
}

// ═══════════════════════════════════════════════════════════════
// LIBRARY TAB
// ═══════════════════════════════════════════════════════════════
function LibraryTab({ ctx }) {
  const { track, playing, play, T, favs, toggleFav, playlists, createPlaylist,
          removeFromPlaylist, deletePlaylist, openPlaylist, setOpenPlaylist, addToTarget, onMenu, downloaded, downloading, downloadMany, savedAlbums, goAlbum, goMix, savedPlaylists, savePlaylist, unsavePlaylist, isPlaylistSaved, selecting, selection, toggleSelect, startSelection, hydrateTracks, addToQueue, removeFromQueue, setShowImport } = ctx;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // Búsqueda dentro de la playlist abierta. Hook al nivel superior (no dentro
  // del if openPlaylist) para cumplir con las Rules of Hooks de React.
  const [plSearch, setPlSearch] = useState('');

  // Al abrir una playlist / Me gusta, recuperar metadatos faltantes del backend.
  useEffect(() => {
    if (!openPlaylist || !hydrateTracks) return;
    const ids = openPlaylist === 'liked' ? favs
      : openPlaylist.startsWith('saved:') ? (savedPlaylists.find(p => p.playlistId === openPlaylist.slice(6))?.trackIds || [])
      : (playlists.find(p => p.id === openPlaylist)?.trackIds || []);
    hydrateTracks(ids);
  }, [openPlaylist]);

  // Limpiar la búsqueda al cambiar de playlist (no heredar filtro entre vistas).
  useEffect(() => { setPlSearch(''); }, [openPlaylist]);

  // Mapea el openPlaylist string al formato de objeto que usa playingFrom.
  // Se pasa como opts.from en las llamadas a play() dentro de esta vista.
  const fromForOpenPlaylist = (op) => {
    if (!op) return undefined;
    if (op === 'liked') return { kind: 'liked' };
    if (op.startsWith('saved:')) return { kind: 'saved-playlist', id: op.slice(6) };
    return { kind: 'user-playlist', id: op };
  };

  if (openPlaylist) {
    const isLiked = openPlaylist === 'liked';
    const isSaved = openPlaylist.startsWith('saved:');
    const savedPl = isSaved ? savedPlaylists.find(p => p.playlistId === openPlaylist.slice(6)) : null;
    if (isSaved && !savedPl) { setOpenPlaylist(null); return null; }
    const pl = isLiked ? { name:'Me gusta', trackIds:favs } : isSaved ? { name: savedPl.name, trackIds: savedPl.trackIds || [] } : playlists.find(p => p.id === openPlaylist);
    if (!pl) { setOpenPlaylist(null); return null; }
    const list = pl.trackIds.map(trackById).filter(Boolean);
    // ── Búsqueda dentro de la playlist ──
    const showSearch = list.length >= 8;
    const norm = (s) => String(s || '').toLowerCase();
    const filtered = plSearch.trim()
      ? list.filter(t => norm(t.title).includes(norm(plSearch)) || norm(t.artist).includes(norm(plSearch)))
      : list;
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <button onClick={() => setOpenPlaylist(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:16, paddingTop:4, fontSize:13, fontWeight:700 }}>
          <Icon.ChevL c="var(--txt-1)" sz={18} /> Biblioteca
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
          <div style={{ width:96, height:96, borderRadius:18, background: isLiked ? grad(T) : 'var(--surf-1)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 12px 30px ${hex2rgba(T.accent,.3)}`, overflow:'hidden', flexShrink:0 }}>
            {isLiked ? <Icon.Heart c="#04060a" filled sz={40} /> : <Icon.List c={T.accent} sz={38} />}
          </div>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{pl.name}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:4 }}>{list.length} {list.length===1?'canción':'canciones'}{plSearch.trim() && filtered.length !== list.length ? ` · ${filtered.length} resultados` : ''}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
          {list.length > 0 && <button onClick={() => play(list[0], pl.trackIds, { from: fromForOpenPlaylist(openPlaylist) })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'9px 20px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>}
          {pl.trackIds.length > 0 && <DownloadAllButton ids={pl.trackIds} downloaded={downloaded} downloading={downloading} onClick={() => downloadMany(pl.trackIds)} T={T} />}
          {!isLiked && !isSaved && <button onClick={() => { deletePlaylist(pl.id); setOpenPlaylist(null); }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'9px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Trash c="var(--txt-1)" sz={15} /> Eliminar</button>}
          {isSaved && <button onClick={() => { unsavePlaylist(savedPl.playlistId); setOpenPlaylist(null); }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'9px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Trash c="var(--txt-1)" sz={15} /> Eliminar</button>}
        </div>
        {/* Barra de búsqueda — solo si hay 8+ canciones */}
        {showSearch && <SearchBar value={plSearch} onChange={setPlSearch} placeholder="Buscar en esta playlist…" T={T} />}
        {pl.trackIds.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>Esta playlist está vacía. Añade canciones con el botón +.</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{plSearch}”.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {filtered.map(t => (
              <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T}
                onClick={() => play(t, pl.trackIds, { from: fromForOpenPlaylist(openPlaylist) })}
                onFav={toggleFav} faved={favs.includes(t.id)} onMenu={onMenu}
                downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)}
                selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect}
                onRemove={isLiked || isSaved ? undefined : (id => removeFromPlaylist(pl.id, id))} onSwipeQueue={addToQueue} onSwipeRemove={removeFromQueue} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:4 }}>
        <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>Tu Biblioteca</div>
        <div style={{ display:'flex', gap:10 }}>
          <button aria-label="Me gusta" onClick={() => setOpenPlaylist('liked')} className="press" style={{ width:36, height:36, borderRadius:'50%', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.18)}, ${hex2rgba(T.accent2,.06)})`, border:`1px solid ${hex2rgba(T.accent,.3)}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Heart c={T.accent} filled sz={18} /></button>
          <button aria-label="Crear playlist" onClick={() => setCreating(c=>!c)} className="press" style={{ width:36, height:36, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Plus c={T.accent} sz={20} /></button>
          <button aria-label="Importar playlist" onClick={() => setShowImport(true)} className="press" style={{ width:36, height:36, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Down c={T.accent} sz={18} /></button>
        </div>
      </div>
      <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:18, marginTop:4 }}>{playlists.length + 1 + (savedPlaylists?.length || 0)} playlists</div>

      {creating && (
        <form onSubmit={e => { e.preventDefault(); if (name.trim()) { createPlaylist(name.trim()); setName(''); setCreating(false); } }} style={{ display:'flex', gap:8, marginBottom:16 }}>
          <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la playlist" style={{ flex:1, background:'var(--surf-0)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:12, padding:'10px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
          <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:12, padding:'0 16px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Crear</button>
        </form>
      )}

      <div onClick={() => setOpenPlaylist('liked')} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.14)}, ${hex2rgba(T.accent2,.04)})`, border:`1px solid ${hex2rgba(T.accent,.25)}`, marginBottom:6 }}>
        <div style={{ width:46, height:46, borderRadius:12, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 4px 14px ${hex2rgba(T.accent,.4)}` }}><Icon.Heart c="#04060a" filled sz={22} /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)' }}>Me gusta</div>
          <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist · {favs.length} canciones</div>
        </div>
        <Icon.ChevL c="var(--txt-3)" sz={18} />
      </div>

      {playlists.map(p => (
        <div key={p.id} onClick={() => setOpenPlaylist(p.id)} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', border:'1px solid transparent', marginBottom:2 }}>
          <div style={{ width:46, height:46, borderRadius:12, background:'var(--surf-1)', border:'1px solid var(--line-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={20} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist · {p.trackIds.length} canciones</div>
          </div>
          <Icon.ChevL c="var(--txt-3)" sz={18} />
        </div>
      ))}

      {savedAlbums && savedAlbums.length > 0 && (
        <>
          <SectionHeader label="Álbumes Guardados" accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6 }}>
            {savedAlbums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={a.artist || 'Álbum'} T={T} onClick={() => goAlbum(a.albumId, a.name, a.artist, null, a.cover)} />)}
          </div>
        </>
      )}

      {savedPlaylists && savedPlaylists.length > 0 && (
        <>
          <SectionHeader label="Playlists Guardadas" accent={T.accent} />
          {savedPlaylists.map(p => (
            <div key={p.playlistId} onClick={() => setOpenPlaylist('saved:' + p.playlistId)} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', border:'1px solid transparent', marginBottom:2 }}>
              <div style={{ width:46, height:46, borderRadius:12, background:hex2rgba(T.accent,.12), border:`1px solid ${hex2rgba(T.accent,.3)}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.Heart c={T.accent} filled sz={20} /></div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
                <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist guardada · {p.trackIds?.length || 0} canciones</div>
              </div>
              <Icon.ChevL c="var(--txt-3)" sz={18} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE / YO TAB
// ═══════════════════════════════════════════════════════════════
function ProfileTab({ ctx }) {
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
// ═══════════════════════════════════════════════════════════════
function AddToPlaylistModal({ trackId, onClose, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, T }) {
  const [name, setName] = useState('');
  if (trackId == null) return null;
  const ids = Array.isArray(trackId) ? trackId : [trackId];
  if (!ids.length) return null;
  const multi = ids.length > 1;
  const tk = trackById(ids[0]);
  const addAll = (pid) => ids.forEach(id => addToPlaylist(pid, id));
  const removeAll = (pid) => ids.forEach(id => removeFromPlaylist(pid, id));
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:120 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:121, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Añadir a playlist</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
        </div>
        <div style={{ fontSize:11.5, color:'var(--txt-2)', marginBottom:16 }}>{multi ? `${ids.length} canciones seleccionadas` : `${tk?.title} · ${tk?.artist}`}</div>
        <form onSubmit={async e => { e.preventDefault(); if (name.trim()) { const id = await createPlaylist(name.trim()); if (id) addAll(id); setName(''); onClose(); } }} style={{ display:'flex', gap:8, marginBottom:16 }}>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nueva playlist…" style={{ flex:1, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'10px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
          <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:12, padding:'0 14px', cursor:'pointer', color:'#04060a', display:'flex', alignItems:'center' }}><Icon.Plus c="#04060a" sz={18} /></button>
        </form>
        {playlists.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:12.5, padding:'18px 0' }}>Aún no tienes playlists. Crea una arriba.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {playlists.map(p => {
              const has = multi ? ids.every(id => p.trackIds.includes(id)) : p.trackIds.includes(ids[0]);
              return (
                <button key={p.id} onClick={() => { has ? removeAll(p.id) : addAll(p.id); if (multi) onClose(); }} className="press" style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 12px', borderRadius:14, background: has ? hex2rgba(T.accent,.1) : 'var(--surf-1)', border:`1px solid ${has ? hex2rgba(T.accent,.35) : 'var(--line-soft)'}`, cursor:'pointer', textAlign:'left' }}>
                  <div style={{ width:38, height:38, borderRadius:10, background:'var(--surf-2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={17} /></div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)' }}>{p.name}</div>
                    <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2 }}>{p.trackIds.length} canciones</div>
                  </div>
                  {has && <Icon.Check c={T.accent} sz={20} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT PLAYLIST MODAL
// ═══════════════════════════════════════════════════════════════
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

function parseTextPlaylist(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const tracks = [];
  let isCSV = false;
  let titleCol = -1;
  let artistCol = -1;
  if (lines.length > 0) {
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('track name') || firstLine.includes('artist name') || firstLine.includes('track list') || firstLine.includes('title')) {
      isCSV = true;
      const headers = parseCSVLine(lines[0]);
      titleCol = headers.findIndex(h => h.includes('track name') || h.includes('title') || h.includes('nombre'));
      artistCol = headers.findIndex(h => h.includes('artist') || h.includes('artista'));
    }
  }
  const startIndex = isCSV ? 1 : 0;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (isCSV && titleCol !== -1 && artistCol !== -1) {
      const cols = parseCSVLine(line);
      const title = cols[titleCol];
      const artist = cols[artistCol];
      if (title) {
        tracks.push({ title, artist: artist || 'Desconocido' });
      }
    } else {
      let title = '';
      let artist = '';
      if (line.includes(' - ')) {
        const parts = line.split(' - ');
        title = parts[0].trim();
        artist = parts.slice(1).join(' - ').trim();
      } else if (line.includes(' by ')) {
        const parts = line.split(' by ');
        title = parts[0].trim();
        artist = parts.slice(1).join(' by ').trim();
      } else {
        title = line;
        artist = '';
      }
      if (title) {
        tracks.push({ title, artist: artist || '' });
      }
    }
  }
  return tracks;
}

function ImportPlaylistModal({ onClose, onImport, onImportText, T }) {
  const [tab, setTab] = useState('yt');
  const [url, setUrl] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [trackList, setTrackList] = useState('');
  
  // Spotify Direct states
  const [spotifyToken, setSpotifyToken] = useState(() => localStorage.getItem('velocity.spotify_token') || '');
  const [spotifyClientId, setSpotifyClientId] = useState(() => localStorage.getItem('velocity.spotify_client_id') || '');
  const [playlists, setPlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [importingId, setImportingId] = useState(null);

  useEffect(() => {
    if (tab === 'spotify' && spotifyToken) {
      setLoadingPlaylists(true);
      fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
        headers: { 'Authorization': `Bearer ${spotifyToken}` }
      })
      .then(res => {
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem('velocity.spotify_token');
            setSpotifyToken('');
          }
          throw new Error('Error al conectar con Spotify');
        }
        return res.json();
      })
      .then(data => {
        setPlaylists(data.items || []);
        setLoadingPlaylists(false);
      })
      .catch(err => {
        console.error(err);
        setLoadingPlaylists(false);
      });
    }
  }, [tab, spotifyToken]);

  const connectSpotify = () => {
    const cid = spotifyClientId.trim();
    if (!cid) return;
    localStorage.setItem('velocity.spotify_client_id', cid);
    const scopes = 'playlist-read-private playlist-read-collaborative user-library-read';
    const redirectUri = window.location.origin + '/';
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${cid}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
    window.location.href = authUrl;
  };

  const handleImportSpotifyPlaylist = async (id, name) => {
    setImportingId(id);
    try {
      let tracks = [];
      let url = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`;
      while (url) {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${spotifyToken}` } });
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem('velocity.spotify_token');
            setSpotifyToken('');
            throw new Error('Sesión de Spotify expirada. Por favor, conéctate de nuevo.');
          }
          throw new Error('Error al obtener canciones de la playlist.');
        }
        const data = await res.json();
        tracks = tracks.concat(data.items.map(item => {
          if (!item.track) return null;
          return `${item.track.name} - ${item.track.artists.map(a => a.name).join(', ')}`;
        }).filter(Boolean));
        url = data.next;
      }
      onImportText(name, tracks.join('\n'));
    } catch (e) {
      alert(e.message);
    } finally {
      setImportingId(null);
    }
  };

  const bookmarkletCode = `javascript:(function(){const rows=document.querySelectorAll('[data-testid="trackrow"]');const tracks=[];rows.forEach(row=>{const titleEl=row.querySelector('[data-testid="tracklist-row-title"] div, a[href^="/track/"]');const artistEls=row.querySelectorAll('a[href^="/artist/"]');if(titleEl){const title=titleEl.textContent.trim();const artists=Array.from(artistEls).map(a=>a.textContent.trim()).join(", ");tracks.push(title+" - "+artists)}});if(tracks.length===0){alert("No se encontraron canciones. Asegúrate de estar en una playlist de Spotify en el navegador.")}else{const txt=tracks.join("\\n");const el=document.createElement("textarea");el.value=txt;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);alert("¡Copiadas "+tracks.length+" canciones al portapapeles! Ahora pégalas en Velocity Music.")}})();`;

  const copyBookmarklet = () => {
    navigator.clipboard.writeText(bookmarkletCode);
    alert('Bookmarklet copiado. Arrástralo a la barra de marcadores o guárdalo como marcador.');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setTrackList(evt.target.result);
      if (!playlistName) {
        setPlaylistName(file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:120 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:121, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
        
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Importar playlist</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
        </div>

        <div style={{ display:'flex', gap:6, background:'var(--surf-2)', padding:3, borderRadius:12, marginBottom:16 }}>
          <button onClick={() => setTab('yt')} style={{ flex:1, padding:'7px 0', border:'none', borderRadius:10, background: tab === 'yt' ? 'var(--surf-0)' : 'none', color: tab === 'yt' ? 'var(--txt-0)' : 'var(--txt-2)', fontSize:11, fontWeight:800, cursor:'pointer' }}>YouTube URL</button>
          <button onClick={() => setTab('text')} style={{ flex:1, padding:'7px 0', border:'none', borderRadius:10, background: tab === 'text' ? 'var(--surf-0)' : 'none', color: tab === 'text' ? 'var(--txt-0)' : 'var(--txt-2)', fontSize:11, fontWeight:800, cursor:'pointer' }}>Texto / CSV</button>
          <button onClick={() => setTab('spotify')} style={{ flex:1, padding:'7px 0', border:'none', borderRadius:10, background: tab === 'spotify' ? 'var(--surf-0)' : 'none', color: tab === 'spotify' ? 'var(--txt-0)' : 'var(--txt-2)', fontSize:11, fontWeight:800, cursor:'pointer' }}>Spotify Directo</button>
        </div>

        {tab === 'yt' && (
          <>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginBottom:16 }}>Introduce una URL de playlist pública de YouTube o YouTube Music para importarla a tu biblioteca de Velocity.</div>
            <form onSubmit={e => { e.preventDefault(); if (url.trim()) { onImport(url.trim()); } }} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <input autoFocus type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://music.youtube.com/playlist?list=..." style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'12px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
              <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:14, padding:'13px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800, textAlign:'center', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                <Icon.Down c="#04060a" sz={18} /> Empezar importación
              </button>
            </form>
          </>
        )}

        {tab === 'text' && (
          <>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginBottom:14, lineHeight:1.5 }}>
              Puedes usar <b>Exportify</b> (exportify.net) para bajar un CSV de Spotify, arrastrar el archivo o usar el bookmarklet para copiar los temas.
            </div>
            
            <div style={{ display:'flex', gap:8, marginBottom:16 }}>
              <button onClick={copyBookmarklet} className="press" style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:10, padding:'8px 0', cursor:'pointer', color:T.accent, fontSize:11, fontWeight:700 }}>
                <Icon.List c={T.accent} sz={14} /> Bookmarklet Spotify
              </button>
              <label className="press" style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:10, padding:'8px 0', cursor:'pointer', color:'var(--txt-1)', fontSize:11, fontWeight:700 }}>
                <Icon.Down c="var(--txt-1)" sz={14} /> Cargar .csv
                <input type="file" accept=".csv" onChange={handleFileChange} style={{ display:'none' }} />
              </label>
            </div>

            <form onSubmit={e => { e.preventDefault(); if (playlistName.trim() && trackList.trim()) { onImportText(playlistName.trim(), trackList.trim()); } }} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <input type="text" value={playlistName} onChange={e => setPlaylistName(e.target.value)} placeholder="Nombre de la nueva playlist" style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} required />
              <textarea value={trackList} onChange={e => setTrackList(e.target.value)} placeholder="Pega el CSV de Exportify o una lista de canciones en formato:&#10;Canción 1 - Artista&#10;Canción 2 - Artista" style={{ width:'100%', height:120, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 14px', fontSize:12, color:'var(--txt-0)', outline:'none', resize:'none', fontFamily:'monospace' }} required />
              <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:14, padding:'13px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800, textAlign:'center', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                <Icon.Down c="#04060a" sz={18} /> Reconstruir e importar
              </button>
            </form>
          </>
        )}

        {tab === 'spotify' && (
          !spotifyToken ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ fontSize:11.5, color:'var(--txt-2)', lineHeight:1.5 }}>
                Para listar tus playlists, crea una app gratis de desarrollador en Spotify (toma 1 minuto):
              </div>
              <div style={{ background:'var(--surf-2)', borderRadius:12, padding:'10px 14px', fontSize:11, color:'var(--txt-1)', lineHeight:1.5 }}>
                1. Ve al <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color:T.accent, fontWeight:700, textDecoration:'underline' }}>Spotify Developer Dashboard</a>.<br/>
                2. Crea una App (ej. "Velocity Music").<br/>
                3. En la configuración de la app, añade en <b>Redirect URIs</b>:<br/>
                <code style={{ background:'var(--surf-0)', padding:'2px 6px', borderRadius:4, fontSize:10.5, wordBreak:'break-all', display:'inline-block', marginTop:4 }}>{window.location.origin + '/'}</code><br/>
                4. Guarda, copia el <b>Client ID</b> y pégalo abajo:
              </div>
              
              <input type="text" value={spotifyClientId} onChange={e => setSpotifyClientId(e.target.value)} placeholder="Pega aquí tu Spotify Client ID" style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
              
              <button onClick={connectSpotify} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:14, padding:'13px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800, textAlign:'center', display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity: spotifyClientId.trim()?1:.6 }} disabled={!spotifyClientId.trim()}>
                <Icon.Check c="#04060a" sz={18} /> Guardar y Conectar
              </button>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:11.5, color:'var(--txt-2)' }}>Selecciona una playlist para importarla:</div>
                <button onClick={() => { localStorage.removeItem('velocity.spotify_token'); setSpotifyToken(''); }} style={{ background:'none', border:'none', color:'#fb7185', fontSize:10.5, fontWeight:700, cursor:'pointer', textDecoration:'underline' }}>Desconectar</button>
              </div>
              
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filtrar playlists..." style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'10px 14px', fontSize:12.5, color:'var(--txt-0)', outline:'none' }} />
              
              {loadingPlaylists ? (
                <div style={{ display:'flex', justifyContent:'center', padding:'30px 0' }}><Spinner c={T.accent} sz={24} /></div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:240, overflowY:'auto', paddingRight:4 }}>
                  {playlists.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => {
                    const isImporting = importingId === p.id;
                    return (
                      <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12 }}>
                        <img src={(p.images && p.images[0]) ? p.images[0].url : FALLBACK_COVER} alt="" style={{ width:40, height:40, borderRadius:8, objectFit:'cover', flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
                          <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2 }}>{p.tracks.total} canciones · {p.public ? 'Pública' : 'Privada'}</div>
                        </div>
                        <button disabled={isImporting} onClick={() => handleImportSpotifyPlaylist(p.id, p.name)} className="btn-tap" style={{ background: isImporting ? 'var(--surf-2)' : grad(T), border:'none', borderRadius:8, padding:'6px 12px', cursor:'pointer', color: isImporting ? 'var(--txt-2)' : '#04060a', fontSize:11, fontWeight:800 }}>
                          {isImporting ? 'Cargando...' : 'Importar'}
                        </button>
                      </div>
                    );
                  })}
                  {playlists.length === 0 && (
                    <div style={{ fontSize:11.5, color:'var(--txt-2)', textAlign:'center', padding:'20px 0' }}>No se encontraron playlists en tu cuenta.</div>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT PROGRESS BANNER
// ═══════════════════════════════════════════════════════════════
function ImportBanner({ job, T }) {
  if (!job || !job.busy) return null;
  return (
    <div className="fade-up glass" style={{ position:'fixed', bottom: 90, left: 16, right: 16, margin: '0 auto', maxWidth: 428, zIndex: 125, display:'flex', alignItems:'center', gap:12, background:`linear-gradient(135deg, ${hex2rgba(T.accent,.15)}, var(--surf-0))`, border:`1px solid ${hex2rgba(T.accent,.3)}`, borderRadius:18, padding:'12px 16px', boxShadow:'0 10px 30px #0008' }}>
      <Spinner c={T.accent} sz={18} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>Importando: {job.name}</div>
        <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2 }}>{job.total > 0 ? `Procesando ${job.current} de ${job.total} canciones (${job.progress}%)` : 'Conectando con YouTube...'}</div>
        <div style={{ width: '100%', height: 3, background: 'var(--surf-2)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
          <div style={{ width: `${job.progress}%`, height: '100%', background: grad(T), borderRadius: 99, transition: 'width .2s ease' }} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT RESULT MODAL
// ═══════════════════════════════════════════════════════════════
function ImportResultModal({ job, onClose, onGoToPlaylist, T }) {
  if (!job) return null;
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:120 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:121, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Importación finalizada</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
        </div>
        {job.error ? (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:hex2rgba('#fb7185',.15), display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}><Icon.X c="#fb7185" sz={24} /></div>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--txt-0)', marginBottom:6 }}>Hubo un problema</div>
            <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.5 }}>{job.error}</div>
            <button onClick={onClose} className="btn-tap" style={{ background:'var(--surf-2)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 24px', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:800, marginTop:16 }}>Cerrar</button>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:hex2rgba(T.accent,.15), display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}><Icon.Check c={T.accent} sz={24} /></div>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--txt-0)', marginBottom:6 }}>¡Éxito al importar!</div>
            <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.5, marginBottom:16 }}>Se importó la playlist <b>{job.name}</b> con {job.total} canciones.</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={onClose} className="btn-tap" style={{ flex:1, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'12px 0', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:800 }}>Cerrar</button>
              <button onClick={onGoToPlaylist} className="btn-tap" style={{ flex:1, background:grad(T), border:'none', borderRadius:12, padding:'12px 0', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Ver playlist</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Mini reproductor con swipe para cambiar canción ──
function MiniPlayerBar({ track, playing, togglePlay, loadingAudio, T, pct, setExpanded, setMenuTarget, next, prev }) {
  const { dragX, handlers } = useHSwipe({ onLeft: next, onRight: prev, threshold: 60 });
  const isSliding = Math.abs(dragX) > 0;
  return (
    <div
      {...handlers}
      onClick={() => !isSliding && setExpanded(true)}
      className="glass"
      style={{ background:`linear-gradient(135deg, ${hex2rgba(T.accent,.1)}, var(--surf-0))`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:20, padding:'10px 12px', display:'flex', alignItems:'center', gap:12, cursor:'pointer', boxShadow:`0 8px 28px ${hex2rgba(T.accent,.16)}, 0 2px 8px #0006`, position:'relative', overflow:'hidden', touchAction:'pan-y', userSelect:'none' }}
    >
      <div style={{ position:'absolute', bottom:0, left:0, height:2.5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${T.accent}`, transition:'width .15s linear' }} />
      <img
        src={track.cover ? hiResCover(track.cover, 96) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }}
        style={{ width:42, height:42, borderRadius:11, objectFit:'cover', flexShrink:0, boxShadow:'0 4px 12px #0007',
          transform: `translateX(${dragX * 0.6}px)`,
          transition: isSliding ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)',
          opacity: 1 - Math.abs(dragX) / 200,
        }}
      />
      <div style={{ flex:1, minWidth:0,
        transform: `translateX(${dragX * 0.25}px)`,
        transition: isSliding ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)',
      }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
        <div style={{ fontSize:10, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
      </div>
      <button aria-label={playing?'Pausar':'Reproducir'} onClick={e=>{ e.stopPropagation(); togglePlay(); }} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:'50%', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, boxShadow:`0 0 14px ${hex2rgba(T.accent,.55)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
      <button aria-label="Más" onClick={e=>{ e.stopPropagation(); setMenuTarget(track.id); }} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Dots c="var(--txt-1)" sz={19} /></button>
    </div>
  );
}

// ── Portada con swipe para cambiar canción ──
function CoverSwipe({ next, prev, playing, glowF, ambientRgba, art, track, loadingAudio, nextCover, prevCover }) {
  const [dragX, setDragX] = useState(0);
  const [slideTo, setSlideTo] = useState(null); // null | 'next' | 'prev' | 'back'
  const sx = useRef(0), sy = useRef(0), lock = useRef(null), wRef = useRef(0);
  const boxRef = useRef(null);

  // Al cambiar de pista, recentrar al instante (sin animación).
  useEffect(() => { setSlideTo(null); setDragX(0); lock.current = null; }, [track?.id]);

  const clamp = (v, w) => Math.max(-w, Math.min(w, v));
  const onTouchStart = (e) => { const t = e.touches[0]; sx.current = t.clientX; sy.current = t.clientY; lock.current = null; setSlideTo(null); if (boxRef.current) wRef.current = boxRef.current.clientWidth; };
  const onTouchMove = (e) => {
    const t = e.touches[0]; const dx = t.clientX - sx.current, dy = t.clientY - sy.current;
    if (!lock.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) lock.current = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
    if (lock.current === 'h') { e.preventDefault(); setDragX(clamp(dx, wRef.current || 320)); }
  };
  const onTouchEnd = (e) => {
    if (lock.current !== 'h') { lock.current = null; return; }
    lock.current = null;
    const dx = e.changedTouches[0].clientX - sx.current;
    const w = wRef.current || 320;
    const th = Math.min(80, w * 0.22);
    if (dx < -th && nextCover) setSlideTo('next');
    else if (dx > th && prevCover) setSlideTo('prev');
    else setSlideTo('back');
  };
  const onTransitionEnd = () => {
    if (slideTo === 'next') next();
    else if (slideTo === 'prev') prev();
    else if (slideTo === 'back') { setSlideTo(null); setDragX(0); }
  };

  const w = wRef.current || 0;
  const transition = slideTo ? 'transform .34s cubic-bezier(.22,1,.36,1)' : 'none';
  const groupTx = slideTo === 'next' ? -w : slideTo === 'prev' ? w : (slideTo === 'back' ? 0 : dragX);

  const coverFace = (src, alt, size = 512) => (
    <div style={{ position:'relative', width:'100%', height:'100%', borderRadius:28, overflow:'hidden', boxShadow:`0 24px 70px ${ambientRgba(.30)}` }}>
      <CoverImg src={src} alt={alt || ''} radius={28} size={size} style={{ width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', inset:0, borderRadius:28, boxShadow:'inset 0 1px 0 #ffffff22, inset 0 0 0 1px #ffffff10', pointerEvents:'none' }} />
    </div>
  );

  return (
    <div style={{ position:'relative', display:'flex', justifyContent:'center', alignItems:'center', marginBottom:22, flexShrink:0, touchAction:'pan-y' }}>
      {/* Fondo difuminado suave (edge-to-edge, radial, sin bordes) */}
      <div aria-hidden className="breathe" style={{ position:'absolute', width:`calc(${art} * 1.9)`, height:`calc(${art} * 1.9)`, top:'50%', left:'50%', borderRadius:'50%', background:`radial-gradient(circle, ${ambientRgba(.8)}, ${ambientRgba(.34)} 46%, transparent 72%)`, filter:'blur(90px)', opacity: playing ? .55 + glowF*.45 : .3, transition:'opacity .6s ease, background 1.4s ease', pointerEvents:'none', zIndex:0 }} />
      {/* Carrusel: portada actual + vecinas para el peek al deslizar */}
      <div
        ref={boxRef}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ position:'relative', width:art, height:art, borderRadius:28, overflow:'hidden', zIndex:1, flexShrink:0, touchAction:'pan-y', transform:`scale(${playing ? 1 : .97})`, transition:'transform .5s cubic-bezier(.22,1,.36,1)' }}
      >
        <div onTransitionEnd={onTransitionEnd} style={{ position:'absolute', inset:0, transform:`translateX(${groupTx}px)`, transition, willChange:'transform' }}>
          {prevCover && <div style={{ position:'absolute', top:0, left:'-104%', width:'100%', height:'100%' }}>{coverFace(prevCover)}</div>}
          <div style={{ position:'absolute', inset:0 }}>
            {coverFace(track.cover, track.title, 900)}
            {loadingAudio && <div style={{ position:'absolute', inset:0, borderRadius:28, display:'flex', alignItems:'center', justifyContent:'center', background:'#0006' }}><Spinner c="#fff" sz={32} /></div>}
          </div>
          {nextCover && <div style={{ position:'absolute', top:0, left:'104%', width:'100%', height:'100%' }}>{coverFace(nextCover)}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPANDED PLAYER
// ═══════════════════════════════════════════════════════════════
function ExpandedPlayer({ open, onClose, track, playing, togglePlay, next, prev, time, dur, seek,
  vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved, toggleFav, T, quality, glow, compact, desktop, onAdd, onMenu, loadingAudio, onQueue, outputs, sinkId, setOutput, lyricOffset = 0, setLyricOffset, audioRef, nextCover, prevCover }) {
  const [showLyrics, setShowLyrics] = useState(false);
  // iOS no permite controlar el volumen por software (solo botones físicos).
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  // Deslizar hacia abajo para minimizar (solo móvil, si el panel está arriba del todo).
  const swipeStartY = useRef(null);
  const swipeScrollTop = useRef(0);
  const onPanelTouchStart = (e) => { swipeStartY.current = e.touches[0].clientY; swipeScrollTop.current = e.currentTarget.scrollTop || 0; };
  const onPanelTouchEnd = (e) => {
    if (swipeStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    const startedAtTop = swipeScrollTop.current <= 4;
    swipeStartY.current = null;
    if (!desktop && startedAtTop && dy > 90) onClose();
  };
  const [lyricState, setLyricState] = useState({ status:'idle', synced:[], plain:[] });
  const lyricBoxRef = useRef(null);
  // Tiempo de alta frecuencia para la sincronía de la letra.
  // El evento timeUpdate del <audio> solo dispara ~4 veces/seg, lo que hace que
  // el resaltado vaya a saltos. Aquí leemos currentTime a ~15 Hz mientras la
  // letra está abierta y reproduciendo, para un seguimiento fluido y preciso.
  const [lyricTime, setLyricTime] = useState(0);
  useEffect(() => {
    if (!showLyrics && !desktop) return;
    const read = () => { const a = audioRef?.current; if (a) setLyricTime(a.currentTime || 0); };
    read();
    const id = setInterval(read, 66);
    return () => clearInterval(id);
  }, [showLyrics, desktop, audioRef, playing, track?.id]);
  // Tiempo efectivo: el de alta frecuencia si la letra está abierta, si no el prop.
  const effTime = showLyrics ? lyricTime : time;
  // Color dominante extraído de la portada actual
  const dominantColor = useDominantColor(track?.cover);
  const ambientHex = dominantColor?.hex || T.accent;
  const ambientR = dominantColor?.r ?? parseInt(T.accent.slice(1,3),16);
  const ambientG = dominantColor?.g ?? parseInt(T.accent.slice(3,5),16);
  const ambientB = dominantColor?.b ?? parseInt(T.accent.slice(5,7),16);
  const ambientRgba = (a) => `rgba(${ambientR},${ambientG},${ambientB},${a})`;

  useEffect(() => { if (!open) setShowLyrics(false); }, [open]);
  useEffect(() => {
    if ((!showLyrics && !desktop) || !track) return;
    let cancel = false;
    setLyricState({ status:'loading', synced:[], plain:[] });
    const base = { artist: track.artist, title: track.title, album: track.album, duration: track.durationSeconds, id: track.id };
    api.lyrics(base)
      .then(d => {
        if (cancel) return;
        if (!d) { setLyricState(s => s.status === 'ok' ? s : { status:'none', synced:[], plain:[] }); return; }
        const synced = parseLRC(d.synced);
        const plain = (d.plain || '').split(/\r?\n/);
        setLyricState(s => (s.status === 'ok' && s.synced.length && !synced.length) ? s : { status:'ok', synced, plain, source: d.source });
      })
      .catch(() => { if (!cancel) setLyricState(s => s.status === 'ok' ? s : { status:'none', synced:[], plain:[] }); });
    api.lyrics({ ...base, sync: true })
      .then(d => {
        if (cancel || !d || !d.synced) return;
        const synced = parseLRC(d.synced);
        if (synced.length) setLyricState(prev => ({ status:'ok', synced, plain: (prev.plain && prev.plain.length) ? prev.plain : (d.plain || '').split(/\r?\n/), source: 'lrclib' }));
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [showLyrics, desktop, track?.id]);

  const activeLyric = useMemo(() => {
    if (!lyricState.synced || !lyricState.synced.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyricState.synced.length; i++) { if (lyricState.synced[i].t <= effTime + lyricOffset) idx = i; else break; }
    return idx;
  }, [lyricState, effTime, lyricOffset]);

  useEffect(() => {
    if (activeLyric < 0 || !lyricBoxRef.current) return;
    const box = lyricBoxRef.current;
    const el = box.querySelector(`[data-li="${activeLyric}"]`);
    if (el) {
      // Scroll SOLO dentro de la caja de letra (no del panel completo),
      // centrando la línea activa. Evita saltos bruscos de toda la UI.
      const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [activeLyric]);

  if (!track) return null;
  const pct = dur > 0 ? (time / dur) * 100 : 0;
  const glowF = glow / 100;
  const art = desktop ? 'clamp(170px, 32vh, 300px)' : 'min(80vw, 360px)';
  const pad = compact ? 'calc(env(safe-area-inset-top, 14px) + 18px) 22px calc(env(safe-area-inset-bottom, 16px) + 26px)' : '52px 26px 36px';

  const panelBg = desktop
    ? `radial-gradient(130% 85% at 50% 0%, ${ambientRgba(.18 + glowF * .25)}, transparent 62%), var(--surf-0)`
    : `radial-gradient(130% 80% at 50% 0%, ${ambientRgba(.16 + glowF * .28)}, transparent 60%), var(--bg-0)`;

  const panelStyle = desktop ? {
    position:'fixed', top:'50%', left:'50%', transform:`translate(-50%,-50%) scale(${open?1:.95})`,
    width:'min(440px, 92vw)', maxHeight:'94vh', background: panelBg,
    border:'1px solid var(--line)', borderRadius:30, boxShadow:'0 40px 110px #000e',
    opacity: open?1:0, pointerEvents: open?'auto':'none',
    transition:'transform .42s cubic-bezier(.22,1,.36,1), opacity .3s ease, background 1.4s ease',
    zIndex:90, display:'flex', flexDirection:'column', padding:'22px 26px 26px', overflow:'hidden',
  } : {
    position:'absolute', inset:0, width:'100%', background: panelBg,
    transform: open ? 'translateY(0)' : 'translateY(100%)', opacity: open ? 1 : 0,
    transition:'transform .46s cubic-bezier(.22,1,.36,1), opacity .3s ease, background 1.4s ease',
    zIndex:90, display:'flex', flexDirection:'column', padding:pad, overflowY:'auto',
    boxSizing:'border-box', touchAction:'pan-y',
  };

  // ─────────── LAYOUT DESKTOP (estilo Spotify, pantalla completa) ───────────
  if (desktop) {
    const dArt = 'min(46vh, 440px)';
    const Transport = (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:26 }}>
        <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle ? 1 : .4 }}><Icon.Shuf c={shuffle ? T.accent : 'var(--txt-1)'} sz={19} /></button>
        <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={26} /></button>
        <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:60, height:60, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 ${20+glowF*26}px ${hex2rgba(T.accent,.55)}, 0 8px 24px #000a` }}>{loadingAudio ? <Spinner c="#04060a" sz={24} /> : (playing ? <Icon.Pause c="#04060a" sz={26} /> : <Icon.Play c="#04060a" sz={26} />)}</button>
        <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={26} /></button>
        <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat ? 1 : .4 }}><Icon.Rep c={repeat ? T.accent : 'var(--txt-1)'} sz={19} /></button>
      </div>
    );
    return (
      <div style={{ position:'fixed', inset:0, zIndex:90, opacity: open?1:0, pointerEvents: open?'auto':'none', transition:'opacity .38s ease', display:'flex', flexDirection:'column', background:`radial-gradient(120% 90% at 50% -10%, ${ambientRgba(.28 + glowF*.22)}, transparent 58%), var(--bg-0)`, fontFamily:'Inter,sans-serif' }}>
        {/* Barra superior */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 32px', flexShrink:0 }}>
          <button aria-label="Minimizar" onClick={onClose} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.ChevD c="var(--txt-1)" sz={20} /></button>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:9.5, fontWeight:900, letterSpacing:3, color:'var(--txt-2)', textTransform:'uppercase' }}>Reproduciendo desde</div>
            <div style={{ fontSize:13, fontWeight:800, color:'var(--txt-0)', marginTop:3 }}>{track.album || track.artist}</div>
          </div>
          <button aria-label="Cola de reproducción" onClick={onQueue} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Queue c={T.accent} sz={19} /></button>
        </div>

        {/* Cuerpo: portada + letra (bloque centrado con ancho máximo) */}
        <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'clamp(24px,4vw,56px)', padding:'0 clamp(20px,4vw,48px)', alignItems:'center', justifyContent:'center', width:'100%', maxWidth:1120, margin:'0 auto' }}>
          {/* Columna izquierda: portada + info */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minWidth:0 }}>
            <CoverSwipe next={next} prev={prev} playing={playing} glowF={glowF} ambientRgba={ambientRgba} art={dArt} track={track} loadingAudio={loadingAudio} nextCover={nextCover} prevCover={prevCover} />
            <div style={{ width:dArt, maxWidth:'100%', display:'flex', alignItems:'center', gap:14, marginTop:6 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:26, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
                <div style={{ fontSize:15, color:T.accent, marginTop:5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
              </div>
              <button aria-label="Me gusta" onClick={() => toggleFav(track.id)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:6, flexShrink:0 }}><Icon.Heart c={T.accent} filled={faved} sz={26} /></button>
              {onAdd && <button aria-label="Añadir" onClick={() => onAdd(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.Plus c="var(--txt-1)" sz={20} /></button>}
            </div>
          </div>

          {/* Columna derecha: letra */}
          <div style={{ height:'min(72vh, 620px)', display:'flex', flexDirection:'column', minWidth:0, background:'linear-gradient(180deg, var(--surf-0), transparent)', border:'1px solid var(--line-soft)', borderRadius:24, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, padding:'18px 24px 12px', flexShrink:0 }}>
              <Icon.Mic c={T.accent} sz={18} /><span style={{ fontSize:14, fontWeight:900, color:'var(--txt-0)' }}>Letra</span>
              {lyricState.status==='ok' && lyricState.synced.length>0 && setLyricOffset && (
                <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
                  <button aria-label="Atrasar letra" onClick={() => setLyricOffset(o => Math.round((o - 0.5) * 10) / 10)} className="press" style={{ width:26, height:26, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:14, fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontSize:10, color:'var(--txt-2)', fontWeight:700, minWidth:60, textAlign:'center' }}>{lyricOffset>0?'+':''}{lyricOffset.toFixed(1)}s</span>
                  <button aria-label="Adelantar letra" onClick={() => setLyricOffset(o => Math.round((o + 0.5) * 10) / 10)} className="press" style={{ width:26, height:26, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:14, fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              )}
            </div>
            <div ref={lyricBoxRef} style={{ flex:1, overflowY:'auto', padding:'6px 28px 28px' }}>
              {lyricState.status === 'loading' && <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, paddingTop:'30%', color:'var(--txt-2)' }}><Spinner c={T.accent} sz={22} /><span style={{ fontSize:13 }}>Buscando letra…</span></div>}
              {lyricState.status === 'none' && <div style={{ fontSize:14, color:'var(--txt-2)', paddingTop:'34%', textAlign:'center' }}>Letra no disponible para esta pista.</div>}
              {lyricState.status === 'ok' && lyricState.synced.length > 0 && (<>
                {lyricState.synced.map((l, i) => (
                  <div key={i} data-li={i} onClick={() => seek(l.t)} style={{ fontSize: i===activeLyric ? 26 : 20, fontWeight: i===activeLyric ? 800 : 700, color: i===activeLyric ? 'var(--txt-0)' : (i < activeLyric ? 'var(--txt-2)' : 'var(--txt-1)'), margin:'14px 0', lineHeight:1.35, transition:'all .25s ease', cursor:'pointer', opacity: i===activeLyric ? 1 : .55 }}>{l.text || '♪'}</div>
                ))}
                <div style={{ fontSize:10, color:'var(--txt-3)', marginTop:14 }}>Letra sincronizada · {lyricState.source}</div>
              </>)}
              {lyricState.status === 'ok' && lyricState.synced.length === 0 && (<>
                {lyricState.plain.map((line, i) => <div key={i} style={{ fontSize:19, fontWeight:700, color:'var(--txt-1)', margin:'11px 0', lineHeight:1.5 }}>{line || '♪'}</div>)}
                <div style={{ fontSize:10, color:'var(--txt-3)', marginTop:14 }}>Letra · {lyricState.source}</div>
              </>)}
            </div>
          </div>
        </div>

        {/* Barra inferior de control */}
        <div style={{ flexShrink:0, padding:'14px clamp(24px,5vw,64px) 26px', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <span style={{ fontSize:11, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:40, textAlign:'right' }}>{fmt(time)}</span>
            <div style={{ position:'relative', flex:1, height:16, display:'flex', alignItems:'center' }}>
              <div style={{ position:'absolute', left:0, right:0, height:5, background:'var(--surf-2)', borderRadius:99 }} />
              <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 10px ${hex2rgba(T.accent,.6)}`, transition:'width .12s linear' }} />
              <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0, opacity:0, cursor:'pointer' }} />
            </div>
            <span style={{ fontSize:11, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:40 }}>{fmt(dur)}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
              <img src={track.cover ? hiResCover(track.cover, 128) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }} style={{ width:52, height:52, borderRadius:12, objectFit:'cover', flexShrink:0, boxShadow:`0 4px 14px ${hex2rgba(T.accent,.3)}` }} />
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
                <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
              </div>
            </div>
            {Transport}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, minWidth:0 }}>
              <DeviceChip outputs={outputs} sinkId={sinkId} setOutput={setOutput} T={T} />
              {!isIOS && <div style={{ display:'flex', alignItems:'center', gap:8, width:150 }}><Icon.Vol c="var(--txt-2)" sz={17} /><div style={{ flex:1 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {desktop && <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060ad9', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', opacity: open?1:0, pointerEvents: open?'auto':'none', transition:'opacity .3s ease', zIndex:89 }} />}
      <div style={panelStyle} onTouchStart={!desktop ? onPanelTouchStart : undefined} onTouchEnd={!desktop ? onPanelTouchEnd : undefined}>
        {!desktop && <div style={{ width:44, height:5, borderRadius:99, background:'var(--surf-2)', margin:'0 auto 12px', flexShrink:0 }} />}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexShrink:0 }}>
          <button aria-label="Cerrar" onClick={onClose} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.ChevD c="var(--txt-1)" sz={18} /></button>
          <div style={{ textAlign:'center', flex:1, minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:3, color:'var(--txt-2)', textTransform:'uppercase' }}>Reproduciendo desde</div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--txt-0)', marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.album || track.artist}</div>
          </div>
          <div style={{ width:38, height:38, flexShrink:0 }} />
        </div>

        <div style={{ display:'flex', gap:6, background:'var(--surf-1)', borderRadius:12, padding:4, marginBottom:16, flexShrink:0, alignSelf:'center' }}>
          {[['Portada',false],['Letra',true]].map(([lbl,val]) => (
            <button key={lbl} onClick={() => setShowLyrics(val)} className="press" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:9, border:'none', cursor:'pointer', background: showLyrics===val ? grad(T) : 'transparent', color: showLyrics===val ? '#04060a' : 'var(--txt-2)', fontSize:11, fontWeight:800 }}>
              {val ? <Icon.Mic c={showLyrics===val?'#04060a':'var(--txt-2)'} sz={14} /> : <Icon.Play c={showLyrics===val?'#04060a':'var(--txt-2)'} sz={13} />}{lbl}
            </button>
          ))}
        </div>

        {!showLyrics ? (
          <CoverSwipe next={next} prev={prev} playing={playing} glowF={glowF} ambientRgba={ambientRgba} art={art} track={track} loadingAudio={loadingAudio} nextCover={nextCover} prevCover={prevCover} />
        ) : (
          <div ref={lyricBoxRef} style={{ position:'relative', height:art, overflowY:'auto', marginBottom:22, padding:'16px 6px', textAlign:'center', flexShrink:0 }}>
            {lyricState.status === 'loading' && <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, paddingTop:'28%', color:'var(--txt-2)' }}><Spinner c={T.accent} sz={22} /><span style={{ fontSize:13 }}>Buscando letra…</span></div>}
            {lyricState.status === 'none' && <div style={{ fontSize:13, color:'var(--txt-2)', paddingTop:'30%' }}>Letra no disponible para esta pista.</div>}
            {lyricState.status === 'ok' && lyricState.synced.length > 0 && (<>
              {lyricState.synced.map((l, i) => (
                <div key={i} data-li={i} style={{ fontSize: i===activeLyric ? 17 : 14.5, fontWeight: i===activeLyric ? 800 : 600, color: i===activeLyric ? T.accent : (i < activeLyric ? 'var(--txt-2)' : 'var(--txt-1)'), margin:'9px 0', lineHeight:1.4, transition:'all .25s ease' }}>{l.text || '♪'}</div>
              ))}
              {setLyricOffset && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:16 }}>
                  <button aria-label="Atrasar letra" onClick={() => setLyricOffset(o => Math.round((o - 0.5) * 10) / 10)} className="press" style={{ width:30, height:30, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:16, fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontSize:10.5, color:'var(--txt-2)', fontWeight:700, minWidth:90, textAlign:'center' }}>Sincronía {lyricOffset>0?'+':''}{lyricOffset.toFixed(1)}s</span>
                  <button aria-label="Adelantar letra" onClick={() => setLyricOffset(o => Math.round((o + 0.5) * 10) / 10)} className="press" style={{ width:30, height:30, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:16, fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              )}
              <div style={{ fontSize:9.5, color:'var(--txt-3)', marginTop:8 }}>Letra sincronizada · {lyricState.source}</div>
            </>)}
            {lyricState.status === 'ok' && lyricState.synced.length === 0 && (<>
              {lyricState.plain.map((line, i) => <div key={i} style={{ fontSize:14.5, fontWeight:600, color:'var(--txt-0)', margin:'7px 0', lineHeight:1.5 }}>{line || '♪'}</div>)}
              <div style={{ fontSize:9.5, color:'var(--txt-3)', marginTop:14 }}>Letra · {lyricState.source}</div>
            </>)}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexShrink:0 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:21, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
            <div style={{ fontSize:13, color:T.accent, marginTop:5, fontWeight:700 }}>{track.artist}</div>
          </div>
          <button aria-label={faved?'Quitar de Me gusta':'Añadir a Me gusta'} onClick={() => toggleFav(track.id)} className="btn-tap" style={{ background: faved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${faved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', marginRight:10, flexShrink:0 }}><Icon.Heart c={faved ? T.accent : 'var(--txt-1)'} filled={faved} sz={18} /></button>
          {onAdd && <button aria-label="Añadir" onClick={() => onAdd(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', marginRight:10, flexShrink:0 }}><Icon.Plus c="var(--txt-1)" sz={18} /></button>}
          {onMenu && <button aria-label="Más" onClick={() => onMenu(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.Dots c="var(--txt-1)" sz={18} /></button>}
        </div>

        <div style={{ marginBottom:18, flexShrink:0 }}>
          <div style={{ position:'relative', height:16, display:'flex', alignItems:'center', marginBottom:4 }}>
            <div style={{ position:'absolute', left:0, right:0, height:5, background:'var(--surf-2)', borderRadius:99 }} />
            <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 10px ${hex2rgba(T.accent,.6)}`, transition:'width .12s linear' }} />
            <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--txt-2)', fontWeight:700, fontFamily:'monospace' }}><span>{fmt(time)}</span><span>{fmt(dur)}</span></div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, flexShrink:0 }}>
          <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle ? 1 : .3 }}><Icon.Shuf c={shuffle ? T.accent : 'var(--txt-1)'} sz={18} /></button>
          <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={24} /></button>
          <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:64, height:64, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 ${20+glowF*26}px ${hex2rgba(T.accent,.55)}, 0 8px 24px #000a` }}>{loadingAudio ? <Spinner c="#04060a" sz={26} /> : (playing ? <Icon.Pause c="#04060a" sz={26} /> : <Icon.Play c="#04060a" sz={26} />)}</button>
          <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={24} /></button>
          <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat ? 1 : .3 }}><Icon.Rep c={repeat ? T.accent : 'var(--txt-1)'} sz={18} /></button>
        </div>

        <div className="glass" style={{ display:'flex', alignItems:'center', gap:13, background:'var(--surf-0)', border:'1px solid var(--line-soft)', borderRadius:16, padding:'12px 16px', flexShrink:0 }}>
          <Icon.Vol c="var(--txt-2)" sz={16} />
          {isIOS ? (
            <div style={{ flex:1, fontSize:11, color:'var(--txt-2)' }}>Usa los botones de volumen del teléfono</div>
          ) : (
            <div style={{ flex:1 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div>
          )}
          {!isIOS && <span style={{ fontSize:10, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:34, textAlign:'right' }}>{Math.round(vol*100)}%</span>}
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:12, flexShrink:0 }}>
          <DeviceChip outputs={outputs} sinkId={sinkId} setOutput={setOutput} T={T} />
          <button aria-label="Cola de reproducción" onClick={onQueue} className="press" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'8px 14px', cursor:'pointer', color:'var(--txt-1)', fontSize:11.5, fontWeight:700 }}>
            <Icon.Queue c={T.accent} sz={16} /> En cola
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// DETAIL VIEW — artista / álbum (metadatos reales de YouTube Music)
// ═══════════════════════════════════════════════════════════════
function DetailView({ view, ctx }) {
  const { T, track, playing, play, favs, toggleFav, addToTarget, onMenu, goArtist, goAlbum, setView, detailLoading, detailData, downloaded, downloading, downloadMany, isAlbumSaved, saveAlbum, unsaveAlbum, isPlaylistSaved, savePlaylist, unsavePlaylist, selecting, selection, toggleSelect, startSelection, addToQueue, removeFromQueue } = ctx;
  const [showAll, setShowAll] = useState(false);
  // Búsqueda dentro de la vista de detalle (mix, álbum, artista). Hook al nivel
  // superior para cumplir con las Rules of Hooks de React.
  const [detailSearch, setDetailSearch] = useState('');
  useEffect(() => { setShowAll(false); setDetailSearch(''); }, [view]);
  const d = detailData && detailData.type === view.type ? detailData : null;

  // Fuzzy match: verifica si una pista está descargada por ID exacto o por
  // título+artista normalizados. Resuelve el mismatch entre IDs de YT Music
  // y los IDs con los que se guardó la descarga en IndexedDB.
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isDownloaded = React.useCallback((t) => {
    if (!t) return false;
    if (downloaded.has(t.id)) return true;
    // Fallback: comparar título+artista normalizados contra las metas cacheadas.
    const tk = norm(t.title) + '|' + norm(t.artist);
    for (const id of downloaded) {
      const cached = trackById(id);
      if (cached && norm(cached.title) + '|' + norm(cached.artist) === tk) return true;
    }
    return false;
  }, [downloaded]);

  const Back = () => (
    <button onClick={() => setView(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:18, paddingTop:4, fontSize:13, fontWeight:700 }}><Icon.ChevL c="var(--txt-1)" sz={18} /> Atrás</button>
  );

  // ── Mezcla / playlist generada (tracklist embebido en la vista) ──
  if (view.type === 'mix') {
    const songs = (view.tracks || []).map(t => trackById(t.id) || t).filter(Boolean);
    const ids = songs.map(s => s.id);
    // Búsqueda dentro del mix
    const showSearch = songs.length >= 8;
    const normS = (s) => String(s || '').toLowerCase();
    const filteredSongs = detailSearch.trim()
      ? songs.filter(t => normS(t.title).includes(normS(detailSearch)) || normS(t.artist).includes(normS(detailSearch)))
      : songs;
    // Origen para el botón "Ir a la playlist" del menú de 3 puntitos
    const mixFrom = { kind:'mix', label: view.label, tracks: view.tracks };
    let covers = [...new Set(songs.map(s => s.cover).filter(c => c && !c.startsWith('data:')))].slice(0, 4);
    if (!covers.length) covers = [FALLBACK_COVER];
    while (covers.length < 4) covers.push(covers[covers.length - 1]);
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <Back />
        <div style={{ display:'flex', alignItems:'flex-end', gap:18, marginBottom:24 }}>
          <div style={{ width:128, height:128, borderRadius:18, overflow:'hidden', flexShrink:0, boxShadow:`0 16px 40px ${hex2rgba(T.accent,.3)}`, display:'grid', gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr 1fr', gap:1, background:'var(--surf-2)' }}>
            {covers.map((c, i) => <img key={i} src={hiResCover(c)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />)}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Mezcla</div>
            <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{view.label}</div>
            <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:3 }}>{songs.length} canciones{detailSearch.trim() && filteredSongs.length !== songs.length ? ` · ${filteredSongs.length} resultados` : ''}</div>
          </div>
        </div>
        {songs.length > 0 && (
          <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
            <button onClick={() => play(songs[0], ids, { mixLabel: view.label, from: mixFrom })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>
            <DownloadAllButton ids={ids} downloaded={downloaded} downloading={downloading} onClick={() => downloadMany(ids)} T={T} />
            {(() => {
              const pid = 'mix:' + (view.label || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60);
              const saved = isPlaylistSaved && isPlaylistSaved(pid);
              return (
                <button onClick={() => saved ? unsavePlaylist(pid) : savePlaylist({ label: view.label, tracks: songs })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background: saved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${saved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:99, padding:'10px 18px', cursor:'pointer', color: saved ? T.accent : 'var(--txt-1)', fontSize:12, fontWeight:700 }}>
                  <Icon.Heart c={saved ? T.accent : 'var(--txt-1)'} filled={saved} sz={15} /> {saved ? 'Guardado' : 'Guardar'}
                </button>
              );
            })()}
            {!selecting && <button onClick={() => startSelection()} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Check c={T.accent} sz={15} /> Seleccionar</button>}
          </div>
        )}
        {showSearch && <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="Buscar en esta mezcla…" T={T} />}
        {filteredSongs.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{detailSearch}”.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {filteredSongs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, ids, { mixLabel: view.label, from: mixFrom })} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={isDownloaded(t)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
          </div>
        )}
      </div>
    );
  }

  if (view.type === 'artist') {
    const name = d?.name || view.name || 'Artista';
    const albums = d?.albums || [];
    const all = d?.topSongs || [];
    // Búsqueda dentro de las canciones populares del artista
    const showSearch = all.length >= 8;
    const normA = (s) => String(s || '').toLowerCase();
    const filteredAll = detailSearch.trim()
      ? all.filter(t => normA(t.title).includes(normA(detailSearch)) || normA(t.artist).includes(normA(detailSearch)))
      : all;
    const songs = showAll ? filteredAll : filteredAll.slice(0, 25);
    // Origen para el botón "Ir a la playlist" del menú de 3 puntitos
    const artistFrom = { kind:'artist', artistId: view.artistId, name };
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <Back />
        <div style={{ display:'flex', alignItems:'center', gap:18, marginBottom:24 }}>
          <div style={{ width:108, height:108, borderRadius:'50%', overflow:'hidden', flexShrink:0, boxShadow:`0 14px 40px ${hex2rgba(T.accent,.4)}`, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center' }}>
            {d?.thumbnail ? <CoverImg src={d.thumbnail} alt={name} radius={999} style={{ width:'100%', height:'100%' }} /> : <span style={{ fontSize:42, fontWeight:900, color:'#04060a' }}>{name[0]}</span>}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Artista</div>
            <div style={{ fontSize:26, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{name}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:5 }}>{albums.length} álbum(es) · {all.length} canciones{detailSearch.trim() && filteredAll.length !== all.length ? ` · ${filteredAll.length} resultados` : ''}</div>
            {all.length > 0 && <button onClick={() => play(all[0], all.map(s=>s.id), { from: artistFrom })} className="btn-tap" style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'9px 20px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>}
          </div>
        </div>
        {detailLoading && !d ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner c={T.accent} sz={24} /></div>
        ) : (
          <>
            {albums.length > 0 && <>
              <SectionHeader label="Álbumes" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, marginBottom:20 }}>
                {albums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={a.year ? String(a.year) : 'Álbum'} T={T} onClick={() => goAlbum(a.albumId, a.name, name, null, a.cover)} />)}
              </div>
            </>}
            <SectionHeader label="Canciones populares" accent={T.accent} action={!selecting && <button onClick={() => startSelection()} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Seleccionar</button>} />
            {showSearch && <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="Buscar canciones de este artista…" T={T} />}
            {songs.length === 0 && detailSearch.trim() ? (
              <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{detailSearch}”.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {songs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, all.map(s=>s.id), { from: artistFrom })} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={isDownloaded(t)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
              </div>
            )}
            {!showAll && filteredAll.length > 25 && (
              <button onClick={() => setShowAll(true)} className="press" style={{ display:'block', margin:'16px auto 0', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:700 }}>Ver más canciones</button>
            )}
          </>
        )}
      </div>
    );
  }

  // álbum
  const name = d?.name || view.name || 'Álbum';
  const artist = d?.artist || view.artist;
  const allSongs = d?.tracks || [];
  // Búsqueda dentro del álbum
  const showSearch = allSongs.length >= 8;
  const normAl = (s) => String(s || '').toLowerCase();
  const songs = detailSearch.trim()
    ? allSongs.filter(t => normAl(t.title).includes(normAl(detailSearch)) || normAl(t.artist).includes(normAl(detailSearch)))
    : allSongs;
  const cover = d?.cover || view.cover || songs[0]?.cover;
  // Origen para el botón "Ir a la playlist" del menú de 3 puntitos
  const albumFrom = { kind:'album', albumId: view.albumId, name, artist, cover };
  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <Back />
      <div style={{ display:'flex', alignItems:'flex-end', gap:18, marginBottom:24 }}>
        <CoverImg src={cover} alt={name} radius={18} style={{ width:128, height:128, flexShrink:0, boxShadow:`0 16px 40px ${hex2rgba(T.accent,.3)}` }} />
        <div style={{ minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Álbum{d?.year ? ` · ${d.year}` : ''}</div>
            {d?.offline && <span style={{ fontSize:8, fontWeight:900, letterSpacing:1.5, color:'var(--txt-2)', textTransform:'uppercase', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'2px 8px' }}>Offline</span>}
          </div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{name}</div>
          <button onClick={() => goArtist(d?.artistId, artist)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:12.5, color:'var(--txt-1)', fontWeight:700, marginTop:5 }}>{artist}</button>
          <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:3 }}>{allSongs.length} canciones{detailSearch.trim() && songs.length !== allSongs.length ? ` · ${songs.length} resultados` : ''}</div>
        </div>
      </div>
      {detailLoading && !d ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner c={T.accent} sz={24} /></div>
      ) : allSongs.length === 0 ? (
        <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontró el álbum de esta canción.</div>
      ) : (
        <>
          {allSongs.length > 0 && (
            <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
              <button onClick={() => play(allSongs[0], allSongs.map(s=>s.id), { from: albumFrom })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>
              {(() => { const albumId = view.albumId || d?.albumId; const saved = albumId && isAlbumSaved(albumId); const meta = { albumId, name, artist, cover, year: d?.year }; return (
                <button onClick={() => saved ? unsaveAlbum(albumId) : saveAlbum(meta)} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background: saved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${saved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:99, padding:'10px 18px', cursor:'pointer', color: saved ? T.accent : 'var(--txt-1)', fontSize:12, fontWeight:700 }}>
                  <Icon.Heart c={saved ? T.accent : 'var(--txt-1)'} filled={saved} sz={15} /> {saved ? 'Guardado' : 'Guardar'}
                </button>
              ); })()}
              <DownloadAllButton ids={allSongs.map(s=>s.id)} downloaded={downloaded} downloading={downloading} onClick={() => { const albumId = view.albumId || d?.albumId; downloadMany(allSongs.map(s=>s.id)); if (albumId) saveAlbum({ albumId, name, artist, cover, year: d?.year }); }} T={T} />
              {!selecting && <button onClick={() => startSelection()} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Check c={T.accent} sz={15} /> Seleccionar</button>}
            </div>
          )}
          {showSearch && <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="Buscar en este álbum…" T={T} />}
          {songs.length === 0 ? (
            <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{detailSearch}”.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {songs.map((t, i) => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, allSongs.map(s=>s.id), { from: albumFrom })} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={isDownloaded(t)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR (escritorio)
// ═══════════════════════════════════════════════════════════════
function Sidebar({ tab, setTab, nav, T, playlists, setOpenPlaylist, setView }) {
  return (
    <div style={{ width:256, flexShrink:0, height:'100%', background:'var(--surf-0)', borderRight:'1px solid var(--line-soft)', display:'flex', flexDirection:'column', padding:'26px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:11, padding:'0 10px', marginBottom:28 }}>
        <div style={{ width:34, height:34, borderRadius:11, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 16px ${hex2rgba(T.accent,.5)}` }}><Icon.Play c="#04060a" sz={17} /></div>
        <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.3, lineHeight:1.05 }}>VELOCITY<br/><span style={{ fontSize:11, fontWeight:800, letterSpacing:3, color:T.accent }}>MUSIC</span></div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {nav.map(({ id, label, I }) => {
          const act = tab === id;
          return (
            <button key={id} onClick={() => { setTab(id); setView(null); if (id==='library') setOpenPlaylist(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:13, padding:'11px 13px', borderRadius:13, background: act ? `linear-gradient(135deg, ${hex2rgba(T.accent,.16)}, ${hex2rgba(T.accent2,.04)})` : 'transparent', border:`1px solid ${act ? hex2rgba(T.accent,.3) : 'transparent'}`, cursor:'pointer', textAlign:'left', position:'relative' }}>
              {act && <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', width:3, height:18, borderRadius:9, background:T.accent, boxShadow:`0 0 8px ${T.accent}` }} />}
              <I c={act ? T.accent : 'var(--txt-2)'} sz={20} />
              <span style={{ fontSize:13.5, fontWeight:700, color: act ? T.accent : 'var(--txt-1)' }}>{label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop:22, borderTop:'1px solid var(--line-soft)', paddingTop:16, flex:1, overflowY:'auto', minHeight:0 }}>
        <div style={{ fontSize:9.5, fontWeight:900, letterSpacing:2, color:'var(--txt-2)', textTransform:'uppercase', padding:'0 10px', marginBottom:10 }}>Tus Playlists</div>
        <button onClick={() => { setTab('library'); setOpenPlaylist('liked'); setView(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:10, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
          <div style={{ width:30, height:30, borderRadius:8, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.Heart c="#04060a" filled sz={15} /></div>
          <span style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-1)' }}>Me gusta</span>
        </button>
        {playlists.map(p => (
          <button key={p.id} onClick={() => { setTab('library'); setOpenPlaylist(p.id); setView(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:10, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <div style={{ width:30, height:30, borderRadius:8, background:'var(--surf-2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={15} /></div>
            <span style={{ fontSize:12.5, fontWeight:600, color:'var(--txt-1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</span>
          </button>
        ))}
      </div>
      <button onClick={() => { setTab('profile'); setView(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 12px', borderRadius:14, background:'var(--surf-1)', border:'1px solid var(--line-soft)', cursor:'pointer', marginTop:8 }}>
        <div style={{ width:34, height:34, borderRadius:'50%', background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:900, color:'#04060a', flexShrink:0 }}>V</div>
        <div style={{ textAlign:'left', minWidth:0 }}><div style={{ fontSize:12.5, fontWeight:800, color:'var(--txt-0)' }}>Tu perfil</div><div style={{ fontSize:9.5, color:'var(--txt-2)' }}>PRO Member</div></div>
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLAYER BAR (escritorio)
// ═══════════════════════════════════════════════════════════════
function PlayerBar({ track, playing, togglePlay, next, prev, time, dur, seek, vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved, toggleFav, T, onExpand, onMenu, loadingAudio, onQueue }) {
  const pct = dur > 0 ? (time / dur) * 100 : 0;
  if (!track) return (
    <div className="glass" style={{ flexShrink:0, height:90, borderTop:'1px solid var(--line-soft)', background:'#06080fcc', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--txt-2)', fontSize:12.5 }}>Selecciona una canción para empezar</div>
  );
  return (
    <div className="glass" style={{ flexShrink:0, height:90, borderTop:'1px solid var(--line-soft)', background:'#06080fcc', display:'grid', gridTemplateColumns:'minmax(180px,1fr) 2fr minmax(140px,1fr)', alignItems:'center', gap:18, padding:'0 22px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
        <img src={track.cover ? hiResCover(track.cover, 128) : FALLBACK_COVER} alt="" onClick={onExpand} referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }} className="press" style={{ width:52, height:52, borderRadius:12, objectFit:'cover', cursor:'pointer', boxShadow:`0 4px 14px ${hex2rgba(T.accent,.3)}`, flexShrink:0 }} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }} onClick={onExpand}>{track.title}</div>
          <div style={{ fontSize:11, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
        </div>
        <button aria-label="Me gusta" onClick={() => toggleFav(track.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Heart c={faved ? T.accent : 'var(--txt-3)'} filled={faved} sz={18} /></button>
        <button aria-label="Más" onClick={() => onMenu(track.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Dots c="var(--txt-3)" sz={18} /></button>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:7, justifyContent:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:22 }}>
          <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle?1:.32 }}><Icon.Shuf c={shuffle?T.accent:'var(--txt-1)'} sz={16} /></button>
          <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={20} /></button>
          <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:42, height:42, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 16px ${hex2rgba(T.accent,.5)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
          <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={20} /></button>
          <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat?1:.32 }}><Icon.Rep c={repeat?T.accent:'var(--txt-1)'} sz={16} /></button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:9.5, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:30, textAlign:'right' }}>{fmt(time)}</span>
          <div style={{ flex:1, position:'relative', height:14, display:'flex', alignItems:'center' }}>
            <div style={{ position:'absolute', left:0, right:0, height:4, background:'var(--surf-2)', borderRadius:99 }} />
            <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:4, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${hex2rgba(T.accent,.6)}` }} />
            <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
          </div>
          <span style={{ fontSize:9.5, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:30 }}>{fmt(dur)}</span>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, justifyContent:'flex-end' }}>
        <button aria-label="Cola" onClick={onQueue} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Queue c="var(--txt-2)" sz={18} /></button>
        <Icon.Vol c="var(--txt-2)" sz={16} />
        <div style={{ width:110 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRACK MENU + TOAST
// ═══════════════════════════════════════════════════════════════
function TrackMenu({ trackId, onClose, ctx }) {
  const { T, track, favs, toggleFav, addToTarget, goArtist, goAlbum, shareTrack, addToQueue, download, removeDownload, downloaded, playingFrom, goToPlayingPlaylist } = ctx;
  if (!trackId) return null;
  const tk = trackById(trackId);
  if (!tk) return null;
  const faved = favs.includes(trackId);
  const isDl = downloaded.has(trackId);
  const items = [
    { icon: Icon.Queue, label:'Añadir a la cola', action: () => { addToQueue(trackId); onClose(); } },
    { icon: Icon.Disc,  label:'Ir al álbum',      action: () => { goAlbum(tk.albumId, tk.album, tk.artist, tk.title, tk.cover); onClose(); } },
    { icon: Icon.User,  label:'Ir al artista',    action: () => { goArtist(tk.artistId, tk.artist); onClose(); } },
  ];
  // "Ir a la playlist/mix/álbum" — solo si la pista actual se reprodujo desde
  // un origen trackeable (playingFrom != null) Y la pista del menú es la que
  // se está reproduciendo ahora mismo.
  if (playingFrom && goToPlayingPlaylist && track?.id === trackId) {
    const label = playingFrom.kind === 'liked' ? 'Ir a Me gusta'
      : playingFrom.kind === 'mix' ? 'Ir a la mezcla'
      : playingFrom.kind === 'album' ? 'Ir al álbum'
      : playingFrom.kind === 'artist' ? 'Ir al artista'
      : 'Ir a la playlist';
    items.push({ icon: Icon.List, label, action: () => { goToPlayingPlaylist(); onClose(); }, hl: true });
  }
  items.push(
    { icon: Icon.Plus,  label:'Añadir a playlist',action: () => { addToTarget(trackId); onClose(); } },
    { icon: Icon.Heart, label: faved ? 'Quitar de Me gusta' : 'Añadir a Me gusta', action: () => { toggleFav(trackId); onClose(); }, filled: faved },
    isDl
      ? { icon: Icon.Trash, label:'Eliminar descarga', action: () => { removeDownload(trackId); onClose(); } }
      : { icon: Icon.Down,  label:'Descargar (offline)', action: () => { download(tk); onClose(); } },
    { icon: Icon.Share, label:'Compartir enlace', action: () => { shareTrack(tk); onClose(); } },
  );
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', zIndex:130 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 16px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:131, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 12px' }} />
        <div style={{ display:'flex', alignItems:'center', gap:13, padding:'4px 6px 14px', borderBottom:'1px solid var(--line-soft)', marginBottom:8 }}>
          <CoverImg src={tk.cover} alt="" radius={12} style={{ width:52, height:52, flexShrink:0 }} />
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:14.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tk.title}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tk.artist}{tk.album ? ` · ${tk.album}` : ''}</div>
          </div>
        </div>
        {items.map((it, i) => (
          <button key={i} onClick={it.action} className="press" style={{ display:'flex', alignItems:'center', gap:15, width:'100%', padding:'13px 12px', borderRadius:13, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <it.icon c={(it.filled || it.hl) ? T.accent : 'var(--txt-1)'} sz={19} filled={it.filled} />
            <span style={{ fontSize:14, fontWeight:600, color: it.hl ? T.accent : 'var(--txt-0)' }}>{it.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Toast({ msg, T }) {
  if (!msg) return null;
  return (
    <div className="fade-up glass" style={{ position:'fixed', bottom:'calc(env(safe-area-inset-bottom, 20px) + 96px)', left:'50%', transform:'translateX(-50%)', background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:99, padding:'11px 20px', zIndex:140, boxShadow:`0 10px 30px #000a, 0 0 20px ${hex2rgba(T.accent,.2)}`, fontSize:12.5, fontWeight:700, color:'var(--txt-0)', display:'flex', alignItems:'center', gap:8 }}>
      <Icon.Check c={T.accent} sz={16} /> {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  useEffect(() => {
    if (document.getElementById('ms-global')) return;
    const el = document.createElement('style'); el.id = 'ms-global'; el.textContent = CSS;
    document.head.appendChild(el);
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.replace('#', '?'));
      const token = params.get('access_token');
      if (token) {
        localStorage.setItem('velocity.spotify_token', token);
        window.history.replaceState(null, null, window.location.pathname);
        setTimeout(() => {
          showToast('Conectado a Spotify');
        }, 100);
      }
    }
  }, []);

  const [authed, setAuthed] = useState(isAuthed());
  const [email, setEmail] = useState(() => localStorage.getItem('velocity.email') || '');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('velocity.name') || '');
  const [avatar, setAvatar] = useState(() => localStorage.getItem('velocity.avatar') || '');
  const [backendDown, setBackendDown] = useState(false);
  // ── Detectar si el backend está caído (ping al montar + cuando vuelve online) ──
  useEffect(() => {
    if (!authed) return;
    let cancel = false;
    const check = async () => {
      const ok = await api.pingBackend();
      if (!cancel) setBackendDown(!ok);
    };
    check();
    // Re-checkear cuando vuelve la conexión.
    const onOnline = () => check();
    window.addEventListener('online', onOnline);
    return () => { cancel = true; window.removeEventListener('online', onOnline); };
  }, [authed]);

  // Sincronizar el perfil (nombre + avatar) desde el backend al abrir sesión.
  useEffect(() => { if (!authed) return; api.me().then(p => { if (p) { setDisplayName(p.displayName || ''); localStorage.setItem('velocity.name', p.displayName || ''); setAvatar(p.avatar || ''); localStorage.setItem('velocity.avatar', p.avatar || ''); if (p.email) { setEmail(p.email); localStorage.setItem('velocity.email', p.email); } } }).catch(() => {}); }, [authed]);
  const saveProfileName = async (newName) => {
    const p = await api.updateProfile({ displayName: newName });
    setDisplayName(p.displayName || '');
    localStorage.setItem('velocity.name', p.displayName || '');
    return p;
  };
  const saveAvatar = async (id) => {
    setAvatar(id); localStorage.setItem('velocity.avatar', id); // optimista
    try { const p = await api.updateProfile({ avatar: id }); setAvatar(p.avatar || ''); localStorage.setItem('velocity.avatar', p.avatar || ''); } catch {}
  };

  // reproducción
  const [tab, setTab] = useState('home');
  const [track, setTrack] = useState(() => {
    const s = loadPlayerState();
    if (!s || !s.track) return null;
    // Enriquecer con el cover del catálogo (loadMeta ya lo pobló): el estado
    // guardado puede tener cover vacío si saveMeta lo strippeó (data:/blob:).
    const cached = trackById(s.track.id);
    if (cached && cached.cover && !s.track.cover) return { ...s.track, cover: cached.cover };
    return s.track;
  });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(() => { const s = loadPlayerState(); return s ? (s.t || 0) : 0; });
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.85);
  const [expanded, setExpanded] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [queue, setQueue] = useState(() => { const s = loadPlayerState(); return s ? (Array.isArray(s.queue) && s.queue.length ? s.queue : [s.track.id]) : []; });
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [downloaded, setDownloaded] = useState(() => new Set());
  const [downloading, setDownloading] = useState(() => new Set());
  const [playSrc, setPlaySrc] = useState(() => { const s = loadPlayerState(); return s && s.track.url ? s.track.url : null; });
  // ── Dispositivos de salida (altavoz, audífonos, Bluetooth) ──
  const [outputs, setOutputs] = useState([]);
  const [sinkId, setSinkId] = useState('');
  // ── Now Playing: estado de otro dispositivo ──
  const [remotePlaying, setRemotePlaying] = useState(null);
  const sseRef = useRef(null);
  const objUrlRef = useRef(null);
  const resumeRef = useRef((() => { const s = loadPlayerState(); return s ? (s.t || 0) : null; })());
  const radioRef = useRef(false);        // ¿sesión de radio (autollenado de relacionadas)?
  const radioSeedRef = useRef(null);      // id de la pista semilla de la radio actual
  // Sesión de mezcla: al terminar una mezcla, saltar a otra mezcla relacionada.
  const mixSessionRef = useRef({ label: null, used: new Set() });
  const homeRowsRef = useRef([]);         // acceso al feed sin cierre obsoleto
  const libReadyRef = useRef(false);      // biblioteca cargada → feed puede usar datos reales
  const persistRef = useRef({});
  const pendingRef = useRef(null);
  if (!pendingRef.current) { pendingRef.current = new Set(); try { JSON.parse(localStorage.getItem('velocity.pendingDl') || '[]').forEach(x => pendingRef.current.add(x)); } catch {} }
  const resumedRef = useRef(false);
  const playStatsRef = useRef(null);
  if (!playStatsRef.current) { try { playStatsRef.current = JSON.parse(localStorage.getItem('velocity.playStats') || '{}') || {}; } catch { playStatsRef.current = {}; } }
  const recordPlayStat = (t) => { if (!t || !t.id) return; try { const s = playStatsRef.current; const e = s[t.id] || {}; s[t.id] = { count: (e.count || 0) + 1, last: Date.now(), title: t.title || e.title || '', artist: t.artist || e.artist || '', cover: t.cover || e.cover || '', durationSeconds: t.durationSeconds || t.duration || e.durationSeconds || 0 }; localStorage.setItem('velocity.playStats', JSON.stringify(s)); } catch {} };
  const savePending = () => { try { localStorage.setItem('velocity.pendingDl', JSON.stringify([...pendingRef.current])); } catch {} };

  // preferencias persistentes
  const [themeKey, setThemeKey] = usePersisted('velocity.theme', 'emerald');
  const [customPalettes, setCustomPalettes] = usePersisted('velocity.palettes', [
    { id:'p1', name:'Neón Vice', accent:'#ff10f0', accent2:'#00fff7' },
    { id:'p2', name:'Aurora',    accent:'#8b5cf6', accent2:'#ec4899' },
  ]);
  const [activeCustomId, setActiveCustomId] = usePersisted('velocity.paletteId', 'p1');
  const [quality, setQuality] = usePersisted('velocity.quality', 'high');
  const [glow, setGlow] = usePersisted('velocity.glow', 70);
  const [eq, setEq] = usePersisted('velocity.eq', 'waves');
  const [lyricOffset, setLyricOffset] = usePersisted('velocity.lyricOffset', 0);
  const [recentSearches, setRecentSearches] = usePersisted('velocity.searches', []);
  const [settings, setSettings] = usePersisted('velocity.settings', { autoplay:true, normalize:false });
  // Preferencias de onboarding: artistas/géneros elegidos al inicio para
  // arrancar con un feed 100% personalizado desde el día 1.
  const [onboardPrefs, setOnboardPrefs] = usePersisted('velocity.onboard', null);

  // datos del backend
  const [favs, setFavs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [recent, setRecent] = useState([]);
  const [savedAlbums, setSavedAlbums] = useState([]);
  const [savedPlaylists, setSavedPlaylists] = useState([]);
  const [homeRows, setHomeRows] = usePersisted('velocity.home', []);
  const [homeLoading, setHomeLoading] = useState(false);
  const [feedNonce, setFeedNonce] = useState(0);

  // UI transitoria
  const [openPlaylist, setOpenPlaylist] = useState(null);
  // Origen de la pista que se está reproduciendo, para el botón "Ir a la playlist"
  // del menú de 3 puntitos. Formatos:
  //   { kind:'liked' }                                    → Me gusta
  //   { kind:'user-playlist', id: <uuid> }                → playlist del usuario
  //   { kind:'saved-playlist', id: <pid> }                → playlist guardada
  //   { kind:'mix', label, tracks }                       → mix del feed
  //   { kind:'album', albumId, name, artist, cover }      → álbum
  //   { kind:'artist', artistId, name }                   → artista (top songs)
  //   null                                                 → reproducido desde search/radio
  const [playingFrom, setPlayingFrom] = useState(null);
  const [addTarget, setAddTarget] = useState(null);
  const [menuTarget, setMenuTarget] = useState(null);
  const [view, setView] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [showQueue, setShowQueue] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(() => new Set());
  const [catVer, setCatVer] = useState(0);
  const toastTimer = useRef(null);
  const showToast = (m) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2400); };

  const [showImport, setShowImport] = useState(false);
  const [importJob, setImportJob] = useState(null);

  const startImport = async (url) => {
    if (importJob && importJob.busy) return;
    setImportJob({ busy: true, current: 0, total: 0, progress: 0, name: 'Conectando...', playlistId: null, error: null });
    setShowImport(false);
    try {
      const data = await api.importPlaylist(url);
      const { name, tracks } = data;
      if (!tracks || !tracks.length) {
        throw new Error('La playlist no contiene canciones o es privada.');
      }
      setImportJob(prev => ({ ...prev, total: tracks.length, name, current: 0, progress: 0 }));
      const playlistId = await api.createPlaylist(name);
      if (!playlistId) {
        throw new Error('No se pudo crear la playlist.');
      }
      setImportJob(prev => ({ ...prev, playlistId }));

      const batchSize = 50;
      for (let i = 0; i < tracks.length; i += batchSize) {
        const batch = tracks.slice(i, i + batchSize);
        await api.saveTracks(batch);
      }

      const normalizedTracks = tracks.map(t => normalizeTrack(t));
      saveMeta();

      for (let i = 0; i < normalizedTracks.length; i++) {
        const t = normalizedTracks[i];
        try {
          await api.addToPlaylist(playlistId, t.id);
        } catch (e) {
          console.error('Error al agregar a la playlist:', e);
        }
        setImportJob(prev => {
          if (!prev) return null;
          const current = i + 1;
          const progress = Math.round((current / normalizedTracks.length) * 100);
          return { ...prev, current, progress };
        });
      }

      const pls = await api.playlists().catch(() => null);
      if (pls) {
        const withTracks = await Promise.all(pls.map(async p => {
          const ids = await api.playlistTracks(p.id).catch(() => []);
          return { id: p.id, name: p.name, trackIds: ids };
        }));
        setPlaylists(withTracks);
      }

      setImportJob(prev => ({ ...prev, busy: false }));
      showToast('Playlist importada con éxito');
    } catch (e) {
      console.error(e);
      setImportJob({ busy: false, error: e.message || 'Error al conectar' });
      showToast('Error al importar la playlist');
    }
  };

  const startImportText = async (playlistName, trackList) => {
    if (importJob && importJob.busy) return;
    const parsedTracks = parseTextPlaylist(trackList);
    if (!parsedTracks.length) {
      showToast('No se encontraron canciones para importar.');
      return;
    }
    setImportJob({ busy: true, current: 0, total: parsedTracks.length, progress: 0, name: playlistName || 'Playlist importada', playlistId: null, error: null });
    setShowImport(false);
    try {
      const name = playlistName.trim() || 'Playlist importada';
      const playlistId = await api.createPlaylist(name);
      if (!playlistId) {
        throw new Error('No se pudo crear la playlist.');
      }
      setImportJob(prev => ({ ...prev, playlistId }));

      for (let i = 0; i < parsedTracks.length; i++) {
        const item = parsedTracks[i];
        setImportJob(prev => {
          if (!prev) return null;
          const current = i;
          const progress = Math.round((current / parsedTracks.length) * 100);
          return { 
            ...prev, 
            current, 
            progress,
            statusText: `Buscando "${item.title} - ${item.artist}"...`
          };
        });

        try {
          const searchQuery = `${item.title} ${item.artist}`.trim();
          const results = await api.search(searchQuery);
          if (results && results.length > 0) {
            const matchedRaw = results[0];
            const normalized = normalizeTrack(matchedRaw);
            saveMeta();
            await api.saveTracks([normalized]);
            await api.addToPlaylist(playlistId, normalized.id);
          }
        } catch (e) {
          console.error('Error buscando/agregando canción:', item, e);
        }

        setImportJob(prev => {
          if (!prev) return null;
          const current = i + 1;
          const progress = Math.round((current / parsedTracks.length) * 100);
          return { 
            ...prev, 
            current, 
            progress,
            statusText: `Completado ${current}/${parsedTracks.length}`
          };
        });
      }

      const pls = await api.playlists().catch(() => null);
      if (pls) {
        const withTracks = await Promise.all(pls.map(async p => {
          const ids = await api.playlistTracks(p.id).catch(() => []);
          return { id: p.id, name: p.name, trackIds: ids };
        }));
        setPlaylists(withTracks);
      }

      setImportJob(prev => ({ ...prev, busy: false, statusText: null }));
      showToast('Playlist importada con éxito');
    } catch (e) {
      console.error(e);
      setImportJob({ busy: false, error: e.message || 'Error al conectar' });
      showToast('Error al importar la playlist');
    }
  };

  const openImportedPlaylist = () => {
    if (importJob && importJob.playlistId) {
      setOpenPlaylist(importJob.playlistId);
      setTab('library');
      setImportJob(null);
    }
  };

  // ── Detección de versión desactualizada + auto-actualización ──
  // Estrategia doble para no depender solo del Service Worker:
  //  1) SW: si instala una versión nueva y toma el control → hay actualización.
  //  2) Sondeo de versión: compara el hash del bundle en ejecución contra el que
  //     sirve el servidor (index.html, no-cache). Detecta deploys aunque el SW
  //     no cambie. Se revisa al enfocar la app y periódicamente.
  const [updateReady, setUpdateReady] = useState(false);
  const runningBundleRef = useRef(null);
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
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let fired = false;
      const trigger = () => { if (fired || !hadController) return; fired = true; setUpdateReady(true); };
      const onMsg = (e) => { if (e.data && e.data.type === 'vm-updated') trigger(); };
      navigator.serviceWorker.addEventListener('controllerchange', trigger);
      navigator.serviceWorker.addEventListener('message', onMsg);
      var cleanupSW = () => { navigator.serviceWorker.removeEventListener('controllerchange', trigger); navigator.serviceWorker.removeEventListener('message', onMsg); };
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
    return () => { stop = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onFocus); if (typeof cleanupSW === 'function') cleanupSW(); };
  }, []);
  // El aviso (UpdateBanner) SIEMPRE se muestra cuando hay versión nueva.
  // Auto-aplica SOLO si la música está pausada Y el usuario lleva > 30s en la app
  // (evita recargar justo después de login/primera carga).
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    if (!updateReady || playing) return;
    const elapsed = Date.now() - mountedAtRef.current;
    const delay = Math.max(0, 30000 - elapsed); // espera mínimo 30s desde el montaje
    const t = setTimeout(() => applyUpdate(), delay + 2000);
    return () => clearTimeout(t);
  }, [updateReady, playing]);

  const audioRef = useRef(null);
  // Dos <audio> ocultos que pre-descargan las siguientes 2 pistas de la cola.
  const preloadAudioRef = useRef(null);
  const preloadAudio2Ref = useRef(null);
  // Reintento por pista ante error de reproducción (URL de audio expirada, etc.).
  const playErrorRef = useRef({ id: null, n: 0 });
  const playingRef = useRef(false);
  // Web Audio para normalizar volumen (compresor de rango dinámico). Opt-in.
  // ── AudioContext eliminado: era incompatible con background playback en móvil ──
  // createMediaElementSource secuestra el <audio> permanentemente y el AudioContext
  // se suspende en background, deteniendo la música. Ver comentario en normalize.
  const activePalette = customPalettes.find(p => p.id === activeCustomId) || customPalettes[0] || { name:'Personalizado', accent:'#8b5cf6', accent2:'#ec4899' };
  const T = themeKey === 'custom'
    ? { name: activePalette.name || 'Personalizado', accent: activePalette.accent, accent2: activePalette.accent2, vars: activePalette.bg ? tintedVars(activePalette.bg) : undefined }
    : (THEMES[themeKey] || THEMES.emerald);
  const addPalette = () => { const id = 'p' + Date.now(); setCustomPalettes(ps => [...ps, { id, name:'Nueva paleta', accent:'#39ff14', accent2:'#00ffa3' }]); setActiveCustomId(id); setThemeKey('custom'); };
  const updatePalette = (patch) => setCustomPalettes(ps => ps.map(p => p.id === activeCustomId ? { ...p, ...patch } : p));
  const deletePalette = () => { const next = customPalettes.filter(p => p.id !== activeCustomId); const arr = next.length ? next : [{ id:'p' + Date.now(), name:'Mi paleta', accent:'#8b5cf6', accent2:'#ec4899' }]; setCustomPalettes(arr); setActiveCustomId(arr[0].id); };

  // Aplica la paleta del skin (o la base) a las variables CSS del :root.
  useEffect(() => {
    const root = document.documentElement;
    const vars = { ...BASE_VARS, ...(T.vars || {}) };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    // Color de la barra de estado del navegador/PWA acorde al fondo del tema.
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', vars['--bg-0']);
  }, [themeKey, activeCustomId, activePalette.bg]);
  const { w: vw } = useViewport();
  const wide = vw >= 900;

  // Cargar descargas offline + manejar expiración de sesión (401 → re-login)
  useEffect(() => {
    setOnUnauthorized(() => { setAuthed(false); showToast('Tu sesión expiró. Inicia sesión de nuevo.'); });
    homeRows.forEach(sec => (sec.mixes || []).forEach(m => (m.tracks || []).forEach(cacheTrack))); // hidratar caché del feed guardado
    (async () => {
      try {
        await offline.pruneInvalid();            // limpiar descargas corruptas/vacías
        const metas = await offline.listMetas();
        // Primero cachear todas las metas. Luego, para las que tienen data: URL
        // como carátula, forzar una actualización del catálogo: la pista puede
        // estar ya cacheada con una URL HTTPS que no carga sin internet.
        metas.forEach(cacheTrack);
        metas.forEach(m => {
          if (m && m.id && typeof m.cover === 'string' && m.cover.startsWith('data:')) {
            const inCat = trackById(m.id);
            // Siempre promover data: offline sobre HTTPS/vacío.
            cacheTrack({ ...(inCat || m), ...m, cover: m.cover });
          }
        });
        const ids = await offline.listIds();
        setDownloaded(new Set(ids));
        // Refrescar cover del track actual: data: offline gana a HTTPS rota.
        setTrack(prev => {
          if (!prev || !prev.id) return prev;
          const c = trackById(prev.id);
          if (!c || !c.cover) return prev;
          const prevData = typeof prev.cover === 'string' && prev.cover.startsWith('data:');
          const catData = typeof c.cover === 'string' && c.cover.startsWith('data:');
          if (catData && !prevData) return { ...prev, cover: c.cover };
          if (!prev.cover && c.cover) return { ...prev, cover: c.cover };
          return prev;
        });
        // Si la última pista restaurada está descargada, reproducir desde el blob offline.
        try {
          const s = loadPlayerState();
          if (s && s.track && s.track.id && ids.includes(s.track.id)) {
            const b = await offline.getBlob(s.track.id);
            if (b) { const u = URL.createObjectURL(b); objUrlRef.current = u; setPlaySrc(u); }
          }
        } catch {}
        // Rellenar covers de descargas antiguas (solo con red).
        try {
          if (navigator.onLine !== false) {
            const filled = await offline.backfillCovers();
            if (filled && filled.length) {
              filled.forEach(cacheTrack);
              setTrack(prev => {
                if (!prev || !prev.id) return prev;
                const m = filled.find(x => x && x.id === prev.id);
                if (m && m.cover) return { ...prev, cover: m.cover };
                return prev;
              });
            }
          }
        } catch {}
      } catch {}
    })();
    // Guardado del estado del reproductor (posición incluida).
    const save = () => { try { if (persistRef.current.track) localStorage.setItem('velocity.player', JSON.stringify(persistRef.current)); } catch {} };
    const iv = setInterval(save, 3000);
    const onHide = () => save();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(iv); window.removeEventListener('pagehide', onHide); window.removeEventListener('beforeunload', onHide); document.removeEventListener('visibilitychange', onHide); save(); };
  }, []);

  // ── Carga inicial tras autenticación ──
  // Clave de caché de biblioteca por usuario (evita mezclar cuentas en un mismo equipo).
  const libCacheKey = () => 'velocity.lib.' + (localStorage.getItem('velocity.email') || 'u');
  // Persistir la biblioteca en local: estructura ligera + metadatos SOLO de las
  // pistas de la biblioteca, sin carátulas pesadas (data:/blob:) para no exceder
  // la cuota de localStorage (esa era la causa del fallo: setItem lanzaba y se perdía).
  const persistLibCache = (favIds, pls, albums, savedPls, recentIds) => {
    try {
      const libIds = new Set([...(favIds || []), ...(recentIds || [])]);
      (pls || []).forEach(p => (p.trackIds || []).forEach(id => libIds.add(id)));
      const tracks = [...libIds].map(trackById).filter(Boolean).map(t =>
        (typeof t.cover === 'string' && (t.cover.startsWith('data:') || t.cover.startsWith('blob:')))
          ? { ...t, cover: '' } : t
      );
      localStorage.setItem(libCacheKey(), JSON.stringify({ favs: favIds || [], playlists: pls || [], savedAlbums: albums || [], savedPlaylists: savedPls || [], recent: recentIds || [], tracks }));
    } catch {}
  };
  // Restaurar biblioteca desde caché local (disponible aunque el backend esté caído).
  const restoreLibCache = () => {
    try {
      const c = JSON.parse(localStorage.getItem(libCacheKey()) || 'null');
      if (!c) return;
      if (Array.isArray(c.tracks))      c.tracks.forEach(cacheTrack);   // poblar catálogo primero
      if (Array.isArray(c.favs))          setFavs(c.favs);
      if (Array.isArray(c.playlists))     setPlaylists(c.playlists);
      if (Array.isArray(c.savedAlbums))   setSavedAlbums(c.savedAlbums);
      if (Array.isArray(c.savedPlaylists)) setSavedPlaylists(c.savedPlaylists);
      if (Array.isArray(c.recent))      setRecent(c.recent);
    } catch {}
  };
  useEffect(() => {
    if (!authed) return;
    restoreLibCache(); // mostrar datos cacheados de inmediato (offline-first)
    let cancel = false;
    (async () => {
      try {
        const [fav, pls, hist, albums, savedPls] = await Promise.all([
          api.favorites().catch(() => null),
          api.playlists().catch(() => null),
          api.history().catch(() => null),
          api.savedAlbums().catch(() => null),
          api.savedPlaylists().catch(() => null),
        ]);
        if (cancel) return;
        // Solo pisar el estado restaurado si la petición tuvo éxito (backend arriba).
        if (fav !== null)      setFavs(fav);
        if (hist !== null)     setRecent(hist.map(h => h.trackId));
        if (albums !== null)   setSavedAlbums(albums);
        if (savedPls !== null) setSavedPlaylists(savedPls);
        const withTracks = pls === null ? null : await Promise.all(pls.map(async p => {
          const ids = await api.playlistTracks(p.id).catch(() => []);
          return { id: p.id, name: p.name, trackIds: ids };
        }));
        if (!cancel && withTracks !== null) setPlaylists(withTracks);

        // Sincronización de metadatos entre dispositivos: subir lo conocido.
        const local = [..._catalog.values()].map(slimTrack).filter(Boolean);
        if (local.length) api.saveTracks(local);

        // Si el backend respondió, hidratar metadatos faltantes y persistir la caché.
        if (fav !== null) {
          const recentIds = (hist || []).map(h => h.trackId);
          const allIds = new Set([...fav, ...recentIds]);
          (withTracks || []).forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          const missing = [...allIds].filter(id => id && !trackById(id));
          for (let i = 0; i < missing.length && !cancel; i += 300) {
            const metas = await api.getTracks(missing.slice(i, i + 300));
            if (!cancel && metas.length) metas.forEach(normalizeTrack);
          }
          if (!cancel) {
            saveMeta(); setCatVer(v => v + 1);
            persistLibCache(fav, withTracks || [], albums || [], savedPls || [], recentIds);
          }
        }
      } catch {}
      // Marcar la biblioteca como lista para que el feed use datos reales.
      if (!cancel) libReadyRef.current = true;
    })();
    return () => { cancel = true; };
  }, [authed]);

  // ── SSE: escuchar "now playing" de otros dispositivos en tiempo real ──
  // Con reconexión automática: si la conexión se cae, se reintententa tras 3s.
  useEffect(() => {
    if (!authed) return;
    let es = null;
    let reconnectTimer = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      try {
        es = api.subscribeNowPlaying();
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.stopped || !data.playing) { setRemotePlaying(null); return; }
            // No mostrar si es mi propio dispositivo reproduciendo la misma pista.
            if (data.trackId === trackRef.current?.id && data.playing) return;
            setRemotePlaying(data);
          } catch {}
        };
        es.onerror = () => {
          try { es.close(); } catch {}
          if (!stopped) reconnectTimer = setTimeout(connect, 3000);
        };
        sseRef.current = es;
      } catch {
        if (!stopped) reconnectTimer = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => { stopped = true; clearTimeout(reconnectTimer); try { es?.close(); } catch {} };
  }, [authed]);

  // ── Re-persistir la caché al modificar biblioteca (fav/playlist/álbum/recientes) ──
  useEffect(() => {
    if (!authed) return;
    persistLibCache(favs, playlists, savedAlbums, savedPlaylists, recent);
  }, [favs, playlists, savedAlbums, savedPlaylists, recent]);

  // ── Feed personalizado (mixes según lo que escuchas, guardas y descargas) ──
  const feedSigRef = useRef('');
  const feedTokenRef = useRef(0);
  // Ref para que el feed lea downloaded sin que su cambio lo interrumpa.
  // downloaded (Set) se actualiza en cada descarga individual; incluirlo en las
  // dependencias del efecto hacía que el feed se cancelara y regenerara con cada
  // notificación de "canción descargada". Con la ref, el efecto solo se dispara
  // por cambios reales de historial/favs/prefs/nonce, no por cada descarga.
  const downloadedRef = useRef(downloaded);
  downloadedRef.current = downloaded;
  // Limpiar la firma guardada cada vez que feedNonce cambia (nuevo login u otro trigger)
  // para garantizar que el efecto siempre regenere el feed, ignorando homeRows cacheado.
  const prevFeedNonceRef = useRef(feedNonce);
  if (prevFeedNonceRef.current !== feedNonce) {
    prevFeedNonceRef.current = feedNonce;
    feedSigRef.current = '';
  }
  useEffect(() => {
    if (!authed) return;
    // NO arrancar hasta que la biblioteca esté lista: sin ella los seeds estarán
    // vacíos y se generaría un feed genérico aunque el usuario tenga historial.
    if (!libReadyRef.current) {
      const retry = setTimeout(() => setFeedNonce(n => n + 1), 800);
      return () => clearTimeout(retry);
    }
    const score = {};
    recent.forEach((id, i) => { score[id] = (score[id] || 0) + Math.max(1, 12 - i * 0.4); });
    favs.forEach(id => { score[id] = (score[id] || 0) + 6; });
    // Usar la ref para el score de descargas: leemos el valor actual sin
    // hacer que el efecto dependa de downloaded directamente.
    [...downloadedRef.current].forEach(id => { score[id] = (score[id] || 0) + 4; });
    const ranked = Object.keys(score).map(trackById).filter(Boolean).sort((a, b) => score[b.id] - score[a.id]);
    // Tomar hasta 8 seeds con shuffle: artistas distintos, sin repetición,
    // orden aleatorio para que el feed cambie entre sesiones.
    const seedPool = []; const seenArtist = new Set();
    for (const t of ranked) { const a = (t.artist || '').toLowerCase(); if (seenArtist.has(a)) continue; seenArtist.add(a); seedPool.push(t); if (seedPool.length >= 8) break; }
    // Shuffle del pool de seeds para rotación real entre sesiones.
    for (let i = seedPool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seedPool[i], seedPool[j]] = [seedPool[j], seedPool[i]]; }
    const seeds = seedPool.slice(0, 6);
    const topSearches = [...new Set((recentSearches || []).map(s => (s || '').trim()).filter(Boolean))].slice(0, 6);
    const prefsSig = Array.isArray(onboardPrefs) ? onboardPrefs.map(p => p.q).join(',') : '';
    // Incluir un slot temporal en la firma que cambia cada 6h para forzar
    // variación aunque el historial del usuario no haya cambiado.
    const timeSlot = Math.floor(Date.now() / (6 * 3600 * 1000));
    const sig = seeds.map(s => s.id).join('|') + '::' + topSearches.join('|') + '::' + prefsSig + '#' + feedNonce + '@' + timeSlot;
    // No bloquear si feedSigRef fue limpiado (nuevo login): solo comparar cuando
    // hay contenido Y la firma es exactamente la misma.
    if (feedSigRef.current && sig === feedSigRef.current && homeRows.length) return;
    feedSigRef.current = sig;
    const myToken = ++feedTokenRef.current;
    const alive = () => myToken === feedTokenRef.current;
    setHomeLoading(true);
    (async () => {
      const clean = (arr) => arr.filter(Boolean);
      const pick = (arr, n) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
      const oneOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const cap1 = (s) => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
      // Slot de variación temporal: cambia cada 6h → queries distintas sin acción del usuario.
      const vary = () => Math.floor(Date.now() / (6 * 3600 * 1000)) % 5;
      // Sufijos para rotar variantes de una misma query y obtener resultados distintos.
      const VARY_SFXS = ['', ' hits', ' top songs', ' best', ' popular'];
      const vSfx = VARY_SFXS[vary()];
      // Mezcla desde una PISTA semilla: su radio (relacionadas reales), coherente.
      const mixFromSeed = async (seed, limit = 50) => {
        try {
          const rel = await api.radio(seed.id, limit);
          const tracks = capPerArtist(dedupeByTitle([seed, ...rel.map(normalizeTrack)]), 8).filter(t => t.id).slice(0, limit);
          return tracks.length >= 6 ? { label: seed.artist || seed.title || 'Mezcla', tracks } : null;
        } catch { return null; }
      };
      // Mezcla desde una CONSULTA: resuelve la pista real más relevante y arma la
      // lista con su radio. Incluye variación temporal en la query.
      const mixFromQuery = async (label, q) => {
        try {
          const raw = await api.search(q + vSfx);
          const base = raw.map(normalizeTrack).find(t => t.id);
          if (!base) return null;
          const rel = await api.radio(base.id, 50);
          const tracks = capPerArtist(dedupeByTitle([base, ...rel.map(normalizeTrack)]), 6).filter(t => t.id).slice(0, 50);
          return tracks.length >= 6 ? { label, tracks } : null;
        } catch { return null; }
      };
      // Mezcla BARATA desde consulta de GÉNERO/ánimo. Variación temporal incluida.
      const mixFromSearch = async (label, q) => {
        try {
          const raw = await api.search(q + vSfx);
          const tracks = dedupeByTitle(raw.map(normalizeTrack)).filter(t => t.id).slice(0, 50);
          return tracks.length >= 6 ? { label, tracks } : null;
        } catch { return null; }
      };
      // Sección de un género con varias tarjetas por artista.
      const genreCards = async (q, n = 4) => {
        try {
          const raw = await api.search(q + vSfx);
          const cand = dedupeByTitle(raw.map(normalizeTrack)).filter(t => t.id);
          const artists = []; const seen = new Set();
          for (const t of cand) { const a = (t.artist || '').trim(); const k = a.toLowerCase(); if (!a || seen.has(k)) continue; seen.add(k); artists.push(a); if (artists.length >= n) break; }
          return clean(await Promise.all(artists.map(a => mixFromSearch(a, a))));
        } catch { return []; }
      };
      // Descubrimiento: relacionadas a un conjunto de pistas base, excluyendo lo ya conocido.
      const buildDiscovery = async (baseTracks, label = 'Nuevos hallazgos') => {
        const bases = (baseTracks || []).filter(Boolean);
        if (!bases.length) return null;
        const known = new Set([...recent, ...favs, ...[...downloadedRef.current], ...bases.map(s => s.id)]);
        try {
          const rels = await Promise.all(bases.slice(0, 5).map(s => api.radio(s.id, 50).catch(() => [])));
          let tracks = capPerArtist(dedupeByTitle(rels.flat().map(normalizeTrack)), 3).filter(t => t.id && !known.has(t.id));
          for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
          const out = tracks.slice(0, 50);
          return out.length >= 8 ? { label, tracks: out } : null;
        } catch { return null; }
      };
      // Resuelve consultas (géneros) a pistas base reales (para descubrimiento).
      const resolvePrefTracks = async (prefsList) => {
        const arr = await Promise.all((prefsList || []).map(async (p) => { try { const raw = await api.search(p.q); return raw.map(normalizeTrack).find(t => t.id) || null; } catch { return null; } }));
        return arr.filter(Boolean);
      };

      const sections = [];
      const pushSection = (section, mixes) => { if (!mixes.length || !alive()) return; sections.push({ section, mixes }); setHomeRows([...sections]); setHomeLoading(false); };
      const prefs = Array.isArray(onboardPrefs) ? onboardPrefs : [];
      const hasHistory = seeds.length > 0 || topSearches.length > 0 || favs.length > 0;

      // Semillas por RECENCIA (lo que suenas ahora) — distintas de las de frecuencia.
      const freshSeeds = [];
      { const seenA = new Set(); for (const id of recent) { const t = trackById(id); if (!t) continue; const a = (t.artist || '').toLowerCase(); if (!a || seenA.has(a)) continue; seenA.add(a); freshSeeds.push(t); if (freshSeeds.length >= 6) break; } }

      // PERSONAL: radio (relacionadas reales) — pocas, de alto valor.
      // EXPLORACIÓN (géneros/ánimos/tendencias): búsqueda directa barata y coherente.
      if (hasHistory) {
        if (seeds.length) pushSection('Hecho para ti', clean(await Promise.all(seeds.slice(0, 6).map(s => mixFromSeed(s, 50)))));
        // "Inspirado en tus búsquedas": deduplicar búsquedas que apuntan al mismo
        // artista (ej. "Porter Robinson" y "The Trill Porter" → mismo artista).
        // Para cada búsqueda, resolver la pista top → obtener su artista → si ya
        // tenemos un mix de ese artista, descartar; si no, usar radio real.
        if (topSearches.length) {
          const searchMixes = [];
          const usedArtists = new Set(seeds.map(s => (s.artist || '').toLowerCase().replace(/\s+/g, '')));
          await Promise.all(topSearches.map(async (term) => {
            try {
              const raw = await api.search(term);
              const base = raw.map(normalizeTrack).find(t => t.id);
              if (!base) return;
              const artistKey = (base.artist || '').toLowerCase().replace(/\s+/g, '');
              // Si ya tenemos un carrusel de este artista (en seeds o en búsquedas
              // anteriores), no generamos uno duplicado.
              if (usedArtists.has(artistKey)) return;
              usedArtists.add(artistKey);
              const rel = await api.radio(base.id, 50);
              const tracks = capPerArtist(dedupeByTitle([base, ...rel.map(normalizeTrack)]), 6).filter(t => t.id).slice(0, 50);
              if (tracks.length >= 6) searchMixes.push({ label: cap1(base.artist || term), tracks });
            } catch {}
          }));
          if (searchMixes.length) pushSection('Inspirado en tus búsquedas', searchMixes);
        }
        if (freshSeeds.length) pushSection('Tu momento actual', clean(await Promise.all(freshSeeds.slice(0, 5).map(s => mixFromSeed(s, 50)))));
        if (seeds.length) { const bs = pick(seeds, 4); pushSection('Porque te gusta ' + (bs[0]?.artist || 'tu música'), clean(await Promise.all(bs.map(s => mixFromSeed(s, 50))))); }
        if (favs.length) {
          const favSeeds = favs.slice(0, 5);
          try {
            const radios = await Promise.all(favSeeds.map(id => api.radio(id, 50).catch(() => [])));
            const merged = capPerArtist(dedupeByTitle(radios.flat().map(normalizeTrack)), 4).filter(t => t.id).slice(0, 50);
            if (merged.length >= 8) pushSection('Tus favoritos expandidos', [{ label: 'Mix de Favoritos', tracks: merged }]);
          } catch {}
        }
        { const disc = await buildDiscovery(seeds.length ? seeds : freshSeeds, 'Descubrimiento para ti'); if (disc) pushSection('Descubrimiento para ti', [disc]); }
        // Combinar prefs de onboarding con historial personal para usuarios con historial.
        if (prefs.length) pushSection('Tus géneros', clean(await Promise.all(prefs.slice(0, 10).map(p => mixFromSearch(p.label, p.q)))));
        for (const p of pick(prefs, 3)) { if (!alive()) break; pushSection('Lo mejor de ' + p.label, await genreCards(p.q, 4)); }
        pushSection('Estados de ánimo', clean(await Promise.all(pick(MOODS, 8).map(m => mixFromSearch('Mix ' + m.label, m.q)))));
        pushSection('Tendencias ahora', clean(await Promise.all(pick(SEED_ROWS, 6).map(s => mixFromSearch(s.label, s.q)))));
      } else if (prefs.length) {
        // ── CON ONBOARDING sin historial: personalizado por géneros desde el día 1 ──
        pushSection('Basado en tus gustos', clean(await Promise.all(prefs.map(p => mixFromSearch(p.label, p.q)))));
        for (const p of pick(prefs, 6)) { if (!alive()) break; pushSection('Lo mejor de ' + p.label, await genreCards(p.q, 4)); }
        const baseTracks = await resolvePrefTracks(prefs.slice(0, 4));
        { const disc = await buildDiscovery(baseTracks, 'Descubre para ti'); if (disc) pushSection('Descubre para ti', [disc]); }
        pushSection('Estados de ánimo', clean(await Promise.all(pick(MOODS, 8).map(m => mixFromSearch('Mix ' + m.label, m.q)))));
        pushSection('Tendencias ahora', clean(await Promise.all(pick(SEED_ROWS, 6).map(s => mixFromSearch(s.label, s.q)))));
      } else {
        // ── SIN historial ni preferencias: genérico coherente ──
        pushSection('Éxitos del momento', clean(await Promise.all(pick(SEED_ROWS, 6).map(s => mixFromSearch(s.label, s.q)))));
        pushSection('Explora géneros', clean(await Promise.all(pick(GENRES, 8).map(g => mixFromSearch(g.label, g.q)))));
        pushSection('Estados de ánimo', clean(await Promise.all(pick(MOODS, 8).map(m => mixFromSearch('Mix ' + m.label, m.q)))));
        pushSection('Para descubrir', clean(await Promise.all(pick(DISCOVERY, 6).map(d => mixFromSearch(d.label, d.q)))));
      }
      if (alive()) setHomeLoading(false);
    })();
  }, [authed, recent, favs, recentSearches, onboardPrefs, feedNonce]);

  // Refresco dinámico del feed al volver tras un rato.
  useEffect(() => { let h = 0; const v = () => { if (document.visibilityState === 'hidden') h = Date.now(); else if (h && Date.now() - h > 720000) { h = 0; setFeedNonce(n => n + 1); } }; document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v); }, []);

  // ── Reanudar descargas pendientes al volver a la app ──
  useEffect(() => {
    if (!authed || resumedRef.current) return;
    const pend = [...pendingRef.current];
    if (pend.length) { resumedRef.current = true; setTimeout(() => downloadMany(pend), 1200); }
  }, [authed]);

  // ── Sincronizar elemento audio (playSrc incluido: reproduce al resolver archivo offline) ──
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      // Restaurar volumen si el fundido lo dejó en 0 (ej: pantalla bloqueada durante el fade)
      if (a.volume === 0) { cancelAnimationFrame(fadeRafRef.current); clearTimeout(fadeSafetyRef.current); a.volume = vol; }
      // En background, el OS puede tener la sesión de audio suspendida.
      // Usar forceReacquire (pause+load+play) para re-enganzchar.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        forceReacquire();
      } else {
        const p = a.play();
        if (p && p.catch) {
          p.catch((err) => {
            if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
              console.warn('[Audio]', err.name, err.message);
            }
          });
        }
      }
    } else {
      a.pause();
    }
  }, [playing, track, playSrc]);

  // ── Wake Lock API: previene que la CPU/screen se suspenda mientras reproduce ──
  // En algunos dispositivos Android agresivos, el navegador puede suspender
  // el proceso de JS en background incluso con Media Session activa. El Wake Lock
  // mantiene la CPU despierta mientras hay música sonando.
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
    return () => { document.removeEventListener('visibilitychange', onVis); if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; } };
  }, [playing]);

  // ── Normalizar volumen ──
  // Antes se usaba createMediaElementSource + DynamicsCompressor de Web Audio API,
  // pero eso secuestra el <audio> permanentemente: el audio pasa a fluir a través
  // del AudioContext, y cuando el navegador lo suspende en background/pantalla
  // bloqueada, la música se detiene. Por eso se eliminó Web Audio API del camino
  // de audio y se reemplazó por un ajuste simple de volumen.
  // El toggle sigue funcionando: cuando está ON, sube el volumen al máximo
  // (las pistas ya vienen normalizadas del backend).
  useEffect(() => {
    if (settings.normalize && audioRef.current) {
      audioRef.current.volume = Math.max(audioRef.current.volume, vol);
    }
  }, [settings.normalize, vol]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  // ── Enumerar dispositivos de salida de audio ──
  // Sin permiso de micrófono, enumerateDevices() devuelve deviceIds pero labels
  // vacíos. El DeviceChip solicita permiso on-click cuando el usuario lo pulsa.
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
  }, []);

  // ── Aplicar sinkId al elemento audio ──
  useEffect(() => {
    if (audioRef.current && audioRef.current.setSinkId && sinkId) {
      audioRef.current.setSinkId(sinkId).catch(() => {});
    }
  }, [sinkId, track?.id]);

  // Sincronizar playingRef con la intención.
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // ── Reanudación robusta de audio al volver a primer plano ──
  // Problema: cuando el teléfono se bloquea o la app va a background, el OS
  // suspende la sesión de audio. El <audio> sigue reportando paused=false pero
  // no produce sonido. Llamar play() es un no-op porque el navegador cree que
  // ya está reproduciendo.
  // Solución: pause()+play() fuerza al navegador a liberar y re-adquirir la
  // sesión de audio del OS. Es lo mismo que pasa al cambiar de canción.
  const lastTimeRef = useRef(0);
  const stuckCheckRef = useRef(null);

  // Re-enganzchar la sesión de audio del OS.
  // SOLO llamar desde foreground (página visible). En background, NO intervenir
  // — Chrome + Media Session API mantienen el audio solos si no los interrumpimos.
  // load() en background mata la sesión permanentemente.
  const reacquireInFlight = useRef(false);
  const forceReacquire = () => {
    if (reacquireInFlight.current) return;
    const a = audioRef.current;
    if (!a || !playingRef.current || a.ended) return;
    reacquireInFlight.current = true;
    const savedTime = a.currentTime;
    if (a.volume === 0) a.volume = vol;

    // Paso 1: play() sin pause. Menos disruptivo.
    const p1 = a.play();
    if (p1 && p1.then) {
      p1.then(() => { reacquireInFlight.current = false; })
        .catch(() => {
          // Paso 2: pause() + play().
          selfPauseRef.current = true;
          try { a.pause(); } catch {}
          selfPauseRef.current = false;
          setTimeout(() => {
            if (!playingRef.current) { reacquireInFlight.current = false; return; }
            const a2 = audioRef.current;
            if (!a2 || a2.ended) { reacquireInFlight.current = false; return; }
            if (a2.volume === 0) a2.volume = vol;
            const p2 = a2.play();
            if (p2 && p2.then) {
              p2.then(() => { reacquireInFlight.current = false; })
                .catch(() => { reacquireInFlight.current = false; });
            } else { reacquireInFlight.current = false; }
          }, 100);
        });
    } else { reacquireInFlight.current = false; }
  };

  useEffect(() => {
    // Tras video/otra pestaña: el OS deja playing=true pero audio.paused.
    // Re-enganchar al volver a primer plano (visibility + focus + pageshow).
    const tryResume = () => {
      const a = audioRef.current;
      if (!a || !playingRef.current || a.ended) return;
      if (!a.paused && a.currentTime > 0) return;
      // Soft play primero; forceReacquire solo si sigue pausado.
      if (a.volume === 0) a.volume = vol;
      const p = a.play();
      if (p && p.catch) {
        p.catch(() => { setTimeout(forceReacquire, 120); });
      } else if (a.paused) {
        setTimeout(forceReacquire, 120);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') setTimeout(tryResume, 80);
    };
    const onFocus = () => setTimeout(tryResume, 80);
    const onPageShow = (e) => { if (e.persisted || document.visibilityState === 'visible') setTimeout(tryResume, 80); };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);

    stuckCheckRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const a = audioRef.current;
      if (!a || !playingRef.current || a.ended) { lastTimeRef.current = 0; return; }
      const ct = a.currentTime || 0;
      // Pausado con intención de play, o "zombie" (playing pero tiempo congelado).
      if (a.paused) {
        tryResume();
      } else if (lastTimeRef.current > 0 && Math.abs(ct - lastTimeRef.current) < 0.05 && ct > 0.5) {
        forceReacquire();
      }
      lastTimeRef.current = ct;
    }, 1500);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      if (stuckCheckRef.current) { clearInterval(stuckCheckRef.current); stuckCheckRef.current = null; }
    };
  }, [vol]);

  // ── Precargar la(s) siguiente(s) pista(s) al cambiar la actual o la cola ──
  // Cubre el modo radio (la cola se llena después de play()) y garantiza que
  // el cambio a la siguiente sea instantáneo (URL ya resuelta en el backend).
  useEffect(() => {
    if (!track) return;
    const qualityMap = { high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' };
    const qParam = qualityMap[quality] || 'high';
    const ids = queue.length ? queue : [track.id];
    prefetchNext(track.id, ids, qParam);
  }, [track?.id, queue, quality]);

  // ── Pre-buffer del AUDIO de las siguientes 2 pistas (estilo Spotify) ──
  // Dos <audio> ocultos descargan por adelantado los streams de las próximas 2
  // pistas. Al cambiar, el navegador sirve desde caché → arranque instantáneo.
  // URLs firmadas (HMAC): el proxy rechaza sin exp/sig.
  useEffect(() => {
    let cancelled = false;
    const ids = queue.length ? queue : (track ? [track.id] : []);
    const i = track ? ids.indexOf(track.id) : -1;
    const qualityMap = { high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' };
    const qParam = qualityMap[quality] || 'high';
    const preload = async (el, offset) => {
      if (!el || !track || i === -1 || ids.length < 2) { if (el) el.removeAttribute('src'); return; }
      const nextId = ids[(i + offset) % ids.length];
      if (!nextId || nextId === track.id || downloaded.has(nextId)) { el.removeAttribute('src'); return; }
      const nt = trackById(nextId);
      if (!nt) { el.removeAttribute('src'); return; }
      try {
        // Preferir firma ya en caché (síncrona); si no, ensure + warm.
        let url = api.peekStreamUrl({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam }, 90);
        if (!url) url = await api.ensureStreamUrl({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam });
        if (cancelled || !el) return;
        if (el.getAttribute('src') !== url) { el.src = url; try { el.load(); } catch {} }
      } catch {
        if (!cancelled && el) el.removeAttribute('src');
      }
    };
    preload(preloadAudioRef.current, 1);
    preload(preloadAudio2Ref.current, 2);
    // volume=0 en los pre-buffer (no muted: muted causa throttle en mobile).
    if (preloadAudioRef.current) preloadAudioRef.current.volume = 0;
    if (preloadAudio2Ref.current) preloadAudio2Ref.current.volume = 0;
    return () => { cancelled = true; };
    // NO depender de downloaded: causa re-renders que limpian el buffer.
  }, [track?.id, queue, quality]);

  // ── Continuidad en segundo plano: extender la cola ANTES de que acabe ──
  // Si la pista actual es la última de la cola, se anexan relacionadas AHORA
  // (en primer plano), de modo que al terminar (aunque el celular esté
  // bloqueado) `next()` sea síncrono y la reproducción no se detenga.
  const autoExtendRef = useRef(null);
  useEffect(() => {
    if (!track || !settings.autoplay) return;
    const ids = queue.length ? queue : [track.id];
    const i = ids.indexOf(track.id);
    if (i !== -1 && i < ids.length - 1) return;           // aún hay siguiente
    if (autoExtendRef.current === track.id) return;        // ya se pidió para esta
    autoExtendRef.current = track.id;
    (async () => {
      try {
        const addIds = await buildContinuation(track, ids);
        if (!addIds.length) return;
        setQueue(q => { const base = q && q.length ? q : [track.id]; const merged = [...base]; addIds.forEach(id => { if (!merged.includes(id)) merged.push(id); }); return merged; });
      } catch {}
    })();
  }, [track?.id, queue, settings.autoplay]);

  // ── Media Session: estado de posición (barra de progreso en pantalla bloqueada) ──
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (dur > 0 && isFinite(dur)) {
      try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(time, dur), playbackRate: 1 }); } catch {}
    }
  }, [time, dur]);
  // Salir del modo selección al navegar.
  useEffect(() => { if (selecting) { setSelecting(false); setSelection(new Set()); } /* eslint-disable-next-line */ }, [tab, view]);

  // ── Acciones de reproducción ──
  // Fundido de entrada corto para evitar el "clic"/pop al empezar una pista.
  // Solo se aplica con la página visible: cuando está en segundo plano o la
  // pantalla bloqueada, requestAnimationFrame se congela, así que ahí ponemos
  // el volumen directo (sin fundido) para no dejar la música en silencio.
  const fadeRafRef = useRef(null);
  const fadeSafetyRef = useRef(null);
  const pendingFadeRef = useRef(false);
  const selfPauseRef = useRef(false);
  const fadeInAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(fadeRafRef.current);
    clearTimeout(fadeSafetyRef.current);
    const target = vol;
    // Si la página no está visible, no arriesgamos el fundido (rAF congelado).
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      a.volume = target;
      return;
    }
    a.volume = 0;
    const start = performance.now();
    const dur = 130; // ms — imperceptible pero elimina el pop de inicio
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      a.volume = target * (p * (2 - p)); // ease-out
      if (p < 1) fadeRafRef.current = requestAnimationFrame(step);
      else a.volume = target;
    };
    fadeRafRef.current = requestAnimationFrame(step);
    // Red de seguridad: si el rAF se congela (bloqueo de pantalla a mitad del
    // fundido), garantizar que el volumen llegue al objetivo.
    fadeSafetyRef.current = setTimeout(() => { cancelAnimationFrame(fadeRafRef.current); if (audioRef.current) audioRef.current.volume = target; }, dur + 350);
  };

  // Precarga la(s) siguiente(s) pista(s): firma HMAC + resolve backend.
  // Crítico para background: next()/onEnded debe poder poner playSrc sin red.
  const prefetchedRef = useRef(new Set());
  const streamParamsFor = (nt, qParam) => ({
    artist: nt.artist,
    title: nt.title,
    id: nt.id,
    quality: qParam,
    stream: (nt.source === 'soundcloud' && nt.stream) ? nt.stream : undefined,
  });
  const prefetchNext = (currentId, ids, qParam) => {
    if (!ids || ids.length < 1) return;
    const i = ids.indexOf(currentId);
    if (i === -1) return;
    // Actual + próximas 3 (pre-firmar mientras la página puede hacer red).
    for (let n = 0; n <= 3; n++) {
      const nextId = ids[(i + n) % ids.length];
      if (!nextId) continue;
      if (downloaded.has(nextId)) continue;
      const nt = trackById(nextId);
      if (!nt) continue;
      const sp = streamParamsFor(nt, qParam);
      // Siempre re-warm si la firma está por caducar (peek con margen 5 min).
      if (api.peekStreamUrl(sp, 300)) {
        if (n === 0) continue;
        if (prefetchedRef.current.has(nextId + ':' + qParam)) continue;
      }
      prefetchedRef.current.add(nextId + ':' + qParam);
      api.warmStreamUrl(sp);
      api.prefetchStream({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam });
    }
    if (prefetchedRef.current.size > 80) {
      prefetchedRef.current = new Set([...prefetchedRef.current].slice(-40));
    }
  };

  // opts.radio=true → inicia una "radio": la cola se llena con canciones
  // relacionadas a la elegida (tipo Spotify), en vez de una lista fija.
  const ensureRadio = async (seed, existingIds = []) => {
    if (!seed || !seed.id) return;
    radioSeedRef.current = seed.id;
    try {
      const raw = await api.radio(seed.id);
      if (radioSeedRef.current !== seed.id) return; // cambió la semilla mientras cargaba
      let more = capPerArtist(dedupeByTitle(raw.map(normalizeTrack)), 3)
        .filter(t => t.id && t.id !== seed.id && !existingIds.includes(t.id));
      if (!more.length) return;
      const addIds = more.slice(0, 30).map(t => t.id);
      setQueue(q => {
        const base = q && q.length ? q : [seed.id];
        const merged = [...base];
        addIds.forEach(id => { if (!merged.includes(id)) merged.push(id); });
        return merged;
      });
    } catch {}
  };

  // Generación de play: descarta firmas async obsoletas si el usuario ya cambió de pista.
  const playGenRef = useRef(0);

  const applyOnlineSrc = (t, sp, gen, fallbackTrack) => {
    const peeked = api.peekStreamUrl(sp, 90);
    if (peeked) {
      setTrack({ ...t, url: peeked }); setPlaySrc(peeked); return;
    }
    api.ensureStreamUrl(sp).then((signedUrl) => {
      if (playGenRef.current !== gen) return;
      setTrack({ ...t, url: signedUrl }); setPlaySrc(signedUrl);
    }).catch(() => {
      if (playGenRef.current !== gen) return;
      if (fallbackTrack?.url) setPlaySrc(fallbackTrack.url);
    });
  };

  const afterPlaySideEffects = (t, trackWithQuality, initialQueue, qParam, opts) => {
    setRecent(r => [t.id, ...r.filter(x => x !== t.id)].slice(0, 30));
    recordPlayStat(t);
    api.recordHistory(t.id).catch(() => {});
    api.updateNowPlaying({ trackId: t.id, title: t.title, artist: t.artist, cover: t.cover, position: 0, duration: t.durationSeconds || 0, playing: true, deviceName: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Web', quality: qParam });
    api.saveTracks([slimTrack(t)]);
    try { localStorage.setItem('velocity.player', JSON.stringify({ track: trackWithQuality, queue: initialQueue, t: 0 })); } catch {}
    prefetchNext(t.id, initialQueue, qParam);
    if (opts.radio) { radioRef.current = true; ensureRadio(t, initialQueue); }
    else { radioRef.current = false; radioSeedRef.current = null; }
    if (opts.mixLabel) mixSessionRef.current = { label: opts.mixLabel, used: new Set([opts.mixLabel]) };
    else if (!opts.keepMix) mixSessionRef.current = { label: null, used: new Set() };
  };

  const play = (t, list, opts = {}) => {
    if (!t) return;
    // Trackear la playlist de origen si se pasó opts.from. Permite mostrar un
    // botón en el reproductor para volver a la playlist de donde salió la pista.
    if (opts.from !== undefined) setPlayingFrom(opts.from);
    // Cover: priorizar data: offline del catálogo (notificación + UI).
    const cached = trackById(t.id);
    if (cached && cached.cover) {
      if (!t.cover || (String(cached.cover).startsWith('data:') && !String(t.cover || '').startsWith('data:'))) {
        t = { ...t, cover: cached.cover };
      }
    }
    cacheTrack(t); saveMeta();
    // Detener limpiamente la pista anterior para evitar el "clic" al cortar la onda.
    const a = audioRef.current;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    if (a) { try { cancelAnimationFrame(fadeRafRef.current); clearTimeout(fadeSafetyRef.current); selfPauseRef.current = true; a.pause(); } catch {} }
    if (a && visible) { a.volume = 0; pendingFadeRef.current = true; }  // fundido al arrancar
    else { if (a) a.volume = vol; pendingFadeRef.current = false; }      // segundo plano: sin fundido
    const initialQueue = list && list.length ? list : [t.id];
    setQueue(initialQueue);
    const qualityMap = { high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' };
    const qParam = qualityMap[quality] || 'high';
    const sp = streamParamsFor(t, qParam);
    const gen = ++playGenRef.current;

    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }

    // ── Offline: blob local (sin red) ──
    if (downloaded.has(t.id)) {
      const trackWithQuality = { ...t, url: api.streamUrl(sp) };
      setTrack(trackWithQuality); setPlaying(true); setLoadingAudio(true);
      offline.getBlob(t.id).then(b => {
        if (playGenRef.current !== gen) return;
        if (b) { const u = URL.createObjectURL(b); objUrlRef.current = u; setPlaySrc(u); }
        else applyOnlineSrc(t, sp, gen, trackWithQuality);
      }).catch(() => {
        if (playGenRef.current === gen) applyOnlineSrc(t, sp, gen, { ...t, url: api.streamUrl(sp) });
      });
      afterPlaySideEffects(t, { ...t, url: api.streamUrl(sp) }, initialQueue, qParam, opts);
      return;
    }

    if (backendDown) {
      setTrack({ ...t, url: '' }); setPlaySrc(''); setLoadingAudio(false); setPlaying(false);
      showToast('Sin conexión: esta canción no está descargada');
      return;
    }

    // ── Online: preferir firma ya precalentada (síncrono → funciona con pantalla bloqueada) ──
    // Margen 90s: suficiente para acabar la pista y arrancar la siguiente en background.
    const peeked = api.peekStreamUrl(sp, 90);
    if (peeked) {
      const trackWithQuality = { ...t, url: peeked };
      setTrack(trackWithQuality); setPlaying(true); setLoadingAudio(true); setPlaySrc(peeked);
      afterPlaySideEffects(t, trackWithQuality, initialQueue, qParam, opts);
      return;
    }

    // Sin caché: arranque optimista + firma async (foreground o best-effort en bg).
    const placeholder = { ...t, url: api.streamUrl(sp) };
    setTrack(placeholder); setPlaying(true); setLoadingAudio(true);
    afterPlaySideEffects(t, placeholder, initialQueue, qParam, opts);
    api.ensureStreamUrl(sp).then((signedUrl) => {
      if (playGenRef.current !== gen) return;
      const trackWithQuality = { ...t, url: signedUrl };
      setTrack(trackWithQuality);
      setPlaySrc(signedUrl);
      try { localStorage.setItem('velocity.player', JSON.stringify({ track: trackWithQuality, queue: initialQueue, t: 0 })); } catch {}
    }).catch(() => {
      if (playGenRef.current !== gen) return;
      setPlaySrc(''); setLoadingAudio(false); setPlaying(false);
      showToast('No se pudo autorizar el stream. Inicia sesión de nuevo.');
    });
  };
  const togglePlay = () => {
    if (!track) return;
    setPlaying(p => {
      const np = !p;
      // Notificar a otros dispositivos el cambio de estado.
      api.updateNowPlaying({
        trackId: track.id, title: track.title, artist: track.artist, cover: track.cover,
        position: audioRef.current?.currentTime || 0, duration: track.durationSeconds || 0,
        playing: np, deviceName: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Web',
        quality: '',
      });
      return np;
    });
  };
  const orderIds = queue.length ? queue : (track ? [track.id] : []);
  const next = () => {
    if (!track || !orderIds.length) return;
    if (shuffle && orderIds.length > 1) {
      let id; do { id = orderIds[Math.floor(Math.random()*orderIds.length)]; } while (id === track.id && orderIds.length > 1);
      const t = trackById(id); if (t) play(t, orderIds, { keepMix: true }); return;
    }
    const i = orderIds.indexOf(track.id);
    const t = trackById(orderIds[(i+1) % orderIds.length]); if (t) play(t, orderIds, { keepMix: true });
  };
  const prev = () => {
    if (!track || !orderIds.length) return;
    const i = orderIds.indexOf(track.id);
    const t = trackById(orderIds[(i-1+orderIds.length) % orderIds.length]); if (t) play(t, orderIds, { keepMix: true });
  };
  const seek = (v) => { if (audioRef.current) { audioRef.current.currentTime = v; if (audioRef.current.volume < vol && !pendingFadeRef.current) audioRef.current.volume = vol; } setTime(v); };
  // Carátulas vecinas (para el carrusel tipo Spotify en el reproductor).
  const _curIdx = orderIds.indexOf(track?.id);
  const nextCover = orderIds.length > 1 ? (trackById(orderIds[(_curIdx + 1) % orderIds.length]) || {}).cover : null;
  const prevCover = orderIds.length > 1 ? (trackById(orderIds[(_curIdx - 1 + orderIds.length) % orderIds.length]) || {}).cover : null;

  // ── Cola ──
  const addToQueue = (id) => {
    const t = trackById(id); if (!t) return;
    setQueue(q => {
      const base = q.length ? [...q] : (track ? [track.id] : []);
      const without = base.filter(x => x !== id);
      const ci = track ? without.indexOf(track.id) : -1;
      if (ci === -1) return [...without, id];          // sin actual: al final
      without.splice(ci + 1, 0, id);                    // justo después de la actual
      return without;
    });
    if (!track) play(t);
    showToast('Se reproducirá a continuación');
  };
  const reorderQueue = (from, to) => setQueue(q => { const a = [...q]; const [m] = a.splice(from, 1); a.splice(to, 0, m); return a; });
  const removeFromQueue = (id) => setQueue(q => q.filter(x => x !== id || x === track?.id));
  // Quitar de la cola con feedback (usado por el swipe a la izquierda).
  const removeFromQueueToast = (id) => {
    const inQueue = queue.includes(id) && id !== track?.id;
    removeFromQueue(id);
    showToast(inQueue ? 'Eliminada de la cola' : 'No estaba en la cola');
  };

  // ── Descargas offline (IndexedDB, sin diálogo de guardado) ──
  // URL firmada con la calidad actual (misma firma/caché que play/prefetch).
  const streamUrlQ = async (t) => api.ensureStreamUrl({ artist: t.artist, title: t.title, id: t.id, quality: ({ high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' }[quality] || 'high') });
  const fetchBlobWithTimeout = async (url, ms = 90000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.blob();
    } finally { clearTimeout(t); }
  };
  // Descarga resiliente: reintenta una vez con re-resolución fresca (la resolución
  // en frío de yt-dlp puede tardar/fallar la primera vez).
  const fetchTrackBlob = async (tk) => {
    try {
      const url = await streamUrlQ(tk);
      return await fetchBlobWithTimeout(url, 90000);
    } catch (e) {
      await new Promise(r => setTimeout(r, 1500));
      // Nueva firma (caché invalidada por reintento con re-sign).
      api._streamSignCache?.clear?.();
      const url = await streamUrlQ(tk);
      return await fetchBlobWithTimeout(url + (url.includes('?') ? '&' : '?') + '_r=' + Date.now(), 90000);
    }
  };
  const download = async (tk) => {
    if (!tk || downloaded.has(tk.id) || downloading.has(tk.id)) return;
    setDownloading(d => { const n = new Set(d); n.add(tk.id); return n; });
    cacheTrack(tk); saveMeta(); pendingRef.current.add(tk.id); savePending();
    api.saveTracks([slimTrack(tk)]);
    try {
      const blob = await fetchTrackBlob(tk);
      await offline.saveTrack(tk, blob);
      setDownloaded(d => { const n = new Set(d); n.add(tk.id); return n; });
      showToast('Descargada · disponible sin conexión');
    } catch { showToast(`No se pudo descargar: ${tk.title}`); }
    finally { setDownloading(d => { const n = new Set(d); n.delete(tk.id); return n; }); pendingRef.current.delete(tk.id); savePending(); }
  };
  const clearDownloads = async () => {
    try { await offline.deleteAll(); } catch {}
    setDownloaded(new Set());
    showToast('Todas las descargas eliminadas');
  };
  const getDownloads = () => offline.downloadsInfo();
  const removeDownload = async (id) => {
    try { await offline.deleteTrack(id); } catch {}
    setDownloaded(d => { const n = new Set(d); n.delete(id); return n; });
    showToast('Descarga eliminada');
  };
  const downloadMany = async (ids) => {
    const todo = ids.filter(id => !downloaded.has(id) && !downloading.has(id) && trackById(id));
    if (!todo.length) { showToast('Ya está todo descargado'); return; }
    setDownloading(d => { const n = new Set(d); todo.forEach(id => n.add(id)); return n; });
    todo.forEach(id => pendingRef.current.add(id)); savePending(); saveMeta();
    api.saveTracks(todo.map(trackById).map(slimTrack).filter(Boolean));
    let ok = 0, done = 0;
    const worker = async (id) => {
      const tk = trackById(id);
      try {
        const blob = await fetchTrackBlob(tk);
        await offline.saveTrack(tk, blob);
        setDownloaded(d => { const n = new Set(d); n.add(id); return n; });
        ok++;
      } catch {}
      finally {
        setDownloading(d => { const n = new Set(d); n.delete(id); return n; });
        pendingRef.current.delete(id); savePending();
        done++; showToast(`Descargando ${done}/${todo.length}…`);
      }
    };
    const queue = [...todo];
    const CONC = Math.min(4, queue.length);
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { await worker(queue.shift()); } }));
    showToast(`${ok}/${todo.length} descargadas`);
  };

  // Refs para que onEnded lea siempre el estado actual (evita stale closure).
  const queueRef = useRef(queue);
  const trackRef = useRef(track);
  const settingsRef = useRef(settings);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { homeRowsRef.current = homeRows; }, [homeRows]);

  // Construye la continuación de la cola al llegar al final: si venimos de una
  // mezcla, salta a OTRA mezcla relacionada del feed (más variedad); si no,
  // radio de la última pista. Devuelve IDs nuevos a añadir (no reproduce).
  const buildContinuation = async (currentTrack, ids) => {
    const sess = mixSessionRef.current;
    if (sess && sess.label) {
      const allMixes = (homeRowsRef.current || []).flatMap(s => s.mixes || []);
      const recentArtists = new Set(ids.slice(-12).map(id => (trackById(id)?.artist || '').toLowerCase()).filter(Boolean));
      const candidates = allMixes.filter(m => m.label && !sess.used.has(m.label) && (m.tracks || []).length >= 4);
      const related = candidates.find(m => (m.tracks || []).some(t => recentArtists.has((t.artist || '').toLowerCase())))
        || candidates[Math.floor(Math.random() * candidates.length)];
      if (related) {
        sess.used.add(related.label);
        const newIds = (related.tracks || []).map(t => { cacheTrack(t); return t.id; }).filter(id => id && !ids.includes(id));
        if (newIds.length >= 4) return newIds;
      }
    }
    // Radio de la última pista (endless clásico).
    try {
      const rel = await api.radio(currentTrack.id, 50);
      const more = capPerArtist(dedupeByTitle(rel.map(normalizeTrack)), 3).filter(t => t.id && t.id !== currentTrack.id && !ids.includes(t.id));
      if (more.length) { const out = more.slice(0, 50); out.forEach(cacheTrack); return out.map(t => t.id); }
    } catch {}
    // Respaldo: búsqueda por artista.
    try {
      const raw = await api.search(currentTrack.artist || currentTrack.title);
      const more = raw.map(normalizeTrack).filter(t => t.id && t.id !== currentTrack.id && !ids.includes(t.id));
      if (more.length) { const out = more.slice(0, 20); out.forEach(cacheTrack); return out.map(t => t.id); }
    } catch {}
    return [];
  };

  // ── Fin de pista: repeat / autoplay / radio de relacionadas ──
  const onEnded = async () => {
    const currentTrack = trackRef.current;
    const currentQueue = queueRef.current;
    const currentSettings = settingsRef.current;

    if (repeat && audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.volume = vol; audioRef.current.play().catch(() => {}); return; }
    if (!currentSettings.autoplay) {
      api.updateNowPlaying({ trackId: '', title: '', artist: '', cover: '', position: 0, duration: 0, playing: false, deviceName: '', quality: '' });
      setPlaying(false); return;
    }

    const ids = currentQueue.length ? currentQueue : (currentTrack ? [currentTrack.id] : []);
    const i = ids.indexOf(currentTrack?.id);

    // Hay siguiente en la cola → reproducir
    if (i !== -1 && i < ids.length - 1) { next(); return; }

    // Fin de la cola → continuar: otra mezcla relacionada (si venías de una) o
    // radio de relacionadas. keepMix preserva la sesión para seguir encadenando.
    if (currentTrack) {
      const addIds = await buildContinuation(currentTrack, ids);
      if (addIds.length) {
        const nxt = trackById(addIds[0]);
        if (nxt) { play(nxt, [...ids, ...addIds], { keepMix: true }); return; }
      }
    }
    // Fin de la cola sin continuación → notificar stop a otros dispositivos.
    api.updateNowPlaying({ trackId: '', title: '', artist: '', cover: '', position: 0, duration: 0, playing: false, deviceName: '', quality: '' });
    setPlaying(false);
  };
  // Cola de favoritos pendientes: si el backend no está disponible, guardamos
  // los cambios en localStorage y los sincronizamos al volver la conexión.
  const pendingFavsRef = useRef(null);
  if (!pendingFavsRef.current) {
    pendingFavsRef.current = new Map(); // id → 'add' | 'remove'
    try {
      const saved = JSON.parse(localStorage.getItem('velocity.pendingFavs') || '[]');
      saved.forEach(([id, op]) => pendingFavsRef.current.set(id, op));
    } catch {}
  }
  const savePendingFavs = () => {
    try { localStorage.setItem('velocity.pendingFavs', JSON.stringify([...pendingFavsRef.current.entries()])); } catch {}
  };
  // Sincronizar la cola de favoritos pendientes con el backend.
  const flushPendingFavs = React.useCallback(async () => {
    if (!pendingFavsRef.current.size) return;
    const entries = [...pendingFavsRef.current.entries()];
    for (const [id, op] of entries) {
      try {
        if (op === 'add') await api.addFavorite(id);
        else await api.removeFavorite(id);
        pendingFavsRef.current.delete(id);
      } catch { break; } // si falla, dejar el resto para el siguiente intento
    }
    savePendingFavs();
  }, []);
  // Sincronizar al recuperar conexión.
  useEffect(() => {
    const onOnline = () => { if (authed) flushPendingFavs(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [authed, flushPendingFavs]);
  // Sincronizar al iniciar sesión (por si había pendientes de una sesión anterior).
  useEffect(() => { if (authed) flushPendingFavs(); }, [authed]);
  const toggleFav = async (id) => {
    const has = favs.includes(id);
    // Actualización optimista: el UI responde inmediatamente.
    setFavs(f => has ? f.filter(x => x !== id) : [id, ...f]);
    if (!has) { const tk = trackById(id); if (tk) api.saveTracks([slimTrack(tk)]); }
    try {
      has ? await api.removeFavorite(id) : await api.addFavorite(id);
      // Éxito: asegurar que no quede en la cola pendiente.
      pendingFavsRef.current.delete(id);
      savePendingFavs();
    } catch {
      // Sin internet u otro error: guardar en la cola pendiente en vez de revertir.
      // El UI ya muestra el estado correcto; se sincronizará al volver la conexión.
      pendingFavsRef.current.set(id, has ? 'remove' : 'add');
      savePendingFavs();
      // Solo mostrar aviso si hay conexión (si no hay, el usuario ya sabe).
      if (navigator.onLine) {
        setFavs(f => has ? [id, ...f] : f.filter(x => x !== id)); // revertir solo con red
        showToast('No se pudo actualizar Me gusta');
      }
    }
  };

  // ── Playlists (backend) ──
  const createPlaylist = async (name) => {
    try { const id = await api.createPlaylist(name); setPlaylists(p => [...p, { id, name, trackIds: [] }]); return id; }
    catch { showToast('No se pudo crear la playlist'); return null; }
  };
  const addToPlaylist = async (pid, tid) => {
    setPlaylists(p => p.map(pl => pl.id===pid && !pl.trackIds.includes(tid) ? { ...pl, trackIds:[...pl.trackIds, tid] } : pl));
    const tk = trackById(tid); if (tk) api.saveTracks([slimTrack(tk)]);
    try { await api.addToPlaylist(pid, tid); } catch { showToast('No se pudo añadir'); }
  };
  const removeFromPlaylist = async (pid, tid) => {
    setPlaylists(p => p.map(pl => pl.id===pid ? { ...pl, trackIds: pl.trackIds.filter(x => x !== tid) } : pl));
    try { await api.removeFromPlaylist(pid, tid); } catch { showToast('No se pudo quitar'); }
  };
  const deletePlaylist = async (pid) => {
    setPlaylists(p => p.filter(pl => pl.id !== pid));
    try { await api.deletePlaylist(pid); } catch { showToast('No se pudo eliminar'); }
  };

  const addSearch = (term) => setRecentSearches(s => [term, ...s.filter(x => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  const removeSearch = (term) => setRecentSearches(s => s.filter(x => x !== term));

  // ── Navegación a artista / álbum (metadatos reales del backend) ──
  const goMix = (mix) => {
    if (!mix || !mix.tracks) return;
    mix.tracks.forEach(cacheTrack);
    setExpanded(false);
    setView({ type:'mix', label: mix.label, tracks: mix.tracks });
  };
  const goWrapped = () => { setExpanded(false); setOpenPlaylist(null); setView({ type:'wrapped' }); };
  const startAiDj = async () => {
    showToast('AI DJ preparando tu estacion...');
    const score = {};
    recent.forEach((id, i) => { score[id] = (score[id] || 0) + Math.max(1, 12 - i * 0.4); });
    favs.forEach(id => { score[id] = (score[id] || 0) + 6; });
    [...downloaded].forEach(id => { score[id] = (score[id] || 0) + 4; });
    const ranked = Object.keys(score).map(trackById).filter(Boolean).sort((a, b) => score[b.id] - score[a.id]);
    const top = ranked.slice(0, 3);
    let pool = [];
    try {
      if (top.length) { const rels = await Promise.all(top.map(s => api.radio(s.id).catch(() => []))); pool = capPerArtist(dedupeByTitle([...top, ...rels.flat().map(normalizeTrack)]), 2).filter(t => t.id); }
      else { const raw = await api.search('top hits 2024'); pool = dedupeByTitle(raw.map(normalizeTrack)).filter(t => t.id); }
    } catch {}
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    if (!pool.length) { showToast('No se pudo iniciar el AI DJ'); return; }
    pool.forEach(cacheTrack);
    play(pool[0], pool.map(t => t.id), { radio: true });
    showToast('AI DJ sonando tu estacion personalizada');
  };
  // Recupera del backend los metadatos de pistas que no estén en caché local.
  const hydrateTracks = async (ids) => {
    const missing = (ids || []).filter(id => id && !trackById(id));
    if (!missing.length) return;
    try {
      for (let i = 0; i < missing.length; i += 300) {
        const metas = await api.getTracks(missing.slice(i, i + 300));
        metas.forEach(normalizeTrack);
      }
      saveMeta(); setCatVer(v => v + 1);
    } catch {}
  };
  const goArtist = (artistId, name) => {
    setExpanded(false); setView({ type:'artist', artistId, name });
    setDetailData(null); setDetailLoading(true);
    const fallback = () => api.search(name).then(raw => setDetailData({ type:'artist', name, topSongs: dedupeByTitle(raw.map(normalizeTrack)), albums: [] })).catch(() => {});
    if (!artistId) { fallback().finally(() => setDetailLoading(false)); return; }
    api.artist(artistId)
      .then(d => setDetailData({ type:'artist', name: d.name || name, thumbnail: d.thumbnail, topSongs: dedupeByTitle((d.topSongs || []).map(normalizeTrack)), albums: d.albums || [] }))
      .catch(fallback)
      .finally(() => setDetailLoading(false));
  };
  // Navegar al origen de la pista que se está reproduciendo. Soporta cualquier
  // tipo de origen (playlist, mix, álbum, artista). Al navegar, OCULTA el
  // reproductor expandido para que el usuario llegue limpio a la lista.
  const goToPlayingPlaylist = () => {
    if (!playingFrom) return;
    setExpanded(false); // ocultar reproductor expandido
    switch (playingFrom.kind) {
      case 'liked':
        setTab('library'); setView(null); setOpenPlaylist('liked');
        return;
      case 'user-playlist': {
        const exists = playlists.some(p => p.id === playingFrom.id);
        if (!exists) return;
        setTab('library'); setView(null); setOpenPlaylist(playingFrom.id);
        return;
      }
      case 'saved-playlist': {
        const exists = savedPlaylists?.some(p => p.playlistId === playingFrom.id);
        if (!exists) return;
        setTab('library'); setView(null); setOpenPlaylist('saved:' + playingFrom.id);
        return;
      }
      case 'mix':
        // Re-abrir el mix con los tracks que ya tenemos en playingFrom
        setTab('home'); setView({ type:'mix', label: playingFrom.label, tracks: playingFrom.tracks });
        return;
      case 'album':
        setView({ type:'album', albumId: playingFrom.albumId, name: playingFrom.name, artist: playingFrom.artist, cover: playingFrom.cover });
        return;
      case 'artist':
        setView({ type:'artist', artistId: playingFrom.artistId, name: playingFrom.name });
        // Trigger fetch de datos del artista
        goArtist(playingFrom.artistId, playingFrom.name);
        return;
    }
  };
  const goAlbum = (albumId, name, artist, songTitle, cover) => {
    // Pasar la carátula al `view` para que el hero la muestre de inmediato
    // mientras carga (antes desaparecía porque el detalle no la recibía).
    setExpanded(false); setView({ type:'album', albumId, name, artist, cover });
    setDetailData(null); setDetailLoading(true);
    // Las pistas de álbum (YT Music) suelen no traer carátula propia: heredan la
    // del álbum para que no aparezcan sin portada al abrir el detalle.
    const loadAlbum = (aid) => api.album(aid).then(d => {
      const albumCover = d.cover || cover || '';
      const tracks = (d.tracks || []).map(t => normalizeTrack({ ...t, artworkUrl: t.artworkUrl || t.cover || albumCover }));
      setDetailData({ type:'album', name: d.name || name, artist: d.artist || artist, artistId: d.artistId, cover: d.cover || cover, year: d.year, tracks });
    });
    // Fallback offline: buscar en IndexedDB las pistas de este álbum cuando la
    // red no responde. Usa albumId exacto o nombre de álbum como criterio.
    const offlineFallback = async (aid, aName, aArtist, aCover) => {
      try {
        const metas = await offline.listMetas();
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const tracks = metas
          .filter(m => m && (
            (aid && m.albumId === aid) ||
            (aName && norm(m.album) === norm(aName))
          ))
          .map(normalizeTrack);
        if (!tracks.length) return false;
        const albumCover = aCover || tracks.find(t => t.cover)?.cover || '';
        const withCover = tracks.map(t => t.cover ? t : { ...t, cover: albumCover });
        setDetailData({ type:'album', name: aName, artist: aArtist, cover: albumCover, tracks: withCover, offline: true });
        return true;
      } catch { return false; }
    };
    (async () => {
      try {
        let aid = albumId;
        if (!aid) {
          // Resolver el álbum por nombre+artista (más fiable que solo canciones).
          const r = await api.searchAll(`${name} ${artist || ''}`.trim()).catch(() => null);
          aid = r?.albums?.[0]?.albumId
            || (r?.songs || []).map(normalizeTrack).find(t => t.albumId)?.albumId
            || null;
          if (!aid) {
            const raw = await api.search(`${songTitle || name} ${artist || ''}`.trim()).catch(() => []);
            aid = raw.map(normalizeTrack).find(t => t.albumId)?.albumId || null;
          }
        }
        if (aid) await loadAlbum(aid);
        else {
          // Sin aid: intentar fallback offline antes de declarar vacío.
          if (!(await offlineFallback(albumId, name, artist, cover)))
            setDetailData({ type:'album', name, artist, cover, tracks: [], none: true });
        }
      } catch {
        // Red caída: intentar contenido offline antes de mostrar error.
        if (!(await offlineFallback(albumId, name, artist, cover)))
          setDetailData({ type:'album', name, artist, cover, tracks: [], none: true });
      }
      finally { setDetailLoading(false); }
    })();
  };
  const shareTrack = (t) => {
    const url = `https://velocity.music/track/${t.id}`;
    if (navigator.share) navigator.share({ title:t.title, text:`${t.title} — ${t.artist}`, url }).catch(()=>{});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado')).catch(() => showToast('No se pudo copiar'));
    else showToast(url);
  };

  // ── Álbumes guardados en biblioteca ──
  const isAlbumSaved = (albumId) => savedAlbums.some(a => a.albumId === albumId);
  const saveAlbum = async (album) => {
    if (!album || !album.albumId || isAlbumSaved(album.albumId)) return;
    setSavedAlbums(s => [{ ...album, savedAt: Date.now() }, ...s]);
    try { await api.saveAlbum(album); showToast('Álbum guardado en tu biblioteca'); }
    catch { setSavedAlbums(s => s.filter(a => a.albumId !== album.albumId)); showToast('No se pudo guardar el álbum'); }
  };
  const unsaveAlbum = async (albumId) => {
    setSavedAlbums(s => s.filter(a => a.albumId !== albumId));
    try { await api.unsaveAlbum(albumId); showToast('Álbum quitado'); } catch {}
  };

  // ── Mixes/Playlists guardados en biblioteca ──
  const isPlaylistSaved = (pid) => savedPlaylists.some(p => p.playlistId === pid);
  const savePlaylist = async (mix) => {
    if (!mix) return;
    // ID estable: basado en el label del mix (normalizado).
    const pid = 'mix:' + (mix.label || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60);
    if (isPlaylistSaved(pid)) { showToast('Ya está guardado'); return; }
    // Strip data:/blob: URLs del cover: pueden pesar decenas de KB y causar
    // errores 413 (body too large) o timeouts en el POST al backend.
    const rawCover = mix.tracks?.[0]?.cover || '';
    const cover = (typeof rawCover === 'string' && (rawCover.startsWith('data:') || rawCover.startsWith('blob:'))) ? '' : rawCover;
    const entry = { playlistId: pid, name: mix.label || 'Mix', cover, trackIds: (mix.tracks || []).map(t => t.id).filter(Boolean) };
    // Actualización optimista: añadir a estado local inmediatamente.
    setSavedPlaylists(s => [entry, ...s]);
    // Subir los metadatos de las pistas del mix para hidratación entre dispositivos.
    if (mix.tracks?.length) api.saveTracks(mix.tracks.map(slimTrack).filter(Boolean));
    // Sincronizar con el backend. Si falla, NO revertir: la playlist queda
    // guardada localmente (localStorage) y se sincronizará en el próximo login.
    try { await api.savePlaylist(entry); showToast('Mix guardado en tu biblioteca'); }
    catch {
      // Reintento único tras 2s (puede ser un timeout transitorio del túnel).
      setTimeout(() => api.savePlaylist(entry).catch(() => {}), 2000);
      showToast('Guardado localmente · se sincronizará después');
    }
  };
  const unsavePlaylist = async (playlistId) => {
    setSavedPlaylists(s => s.filter(p => p.playlistId !== playlistId));
    try { await api.unsavePlaylist(playlistId); showToast('Mix quitado de biblioteca'); } catch {}
  };

  const onLogout = () => {
    api.sessionEnd(); // fire-and-forget: cerrar sesión en PG antes de limpiar token
    api.logout();
    localStorage.removeItem('velocity.email');
    localStorage.removeItem('velocity.name');
    localStorage.removeItem('velocity.avatar');
    localStorage.removeItem('velocity.home');
    // Recargar la página evita renders intermedios con estado inconsistente.
    window.location.reload();
  };
  const handleAuthed = (em, name) => {
    if (em) { setEmail(em); localStorage.setItem('velocity.email', em); }
    if (name != null) { setDisplayName(name); localStorage.setItem('velocity.name', name); }
    // Registrar inicio de sesión en PG para trazabilidad de tiempo de sesión activa.
    api.sessionStart();
    // Forzar regeneración del feed al hacer login (borra el feed del usuario anterior).
    setHomeRows([]);
    setFeedNonce(n => n + 1);
    setAuthed(true);
  };
  const deleteAccount = async () => { try { await api.deleteAccount(); } catch {} onLogout(); };

  // ── Selección múltiple ──
  const toggleSelect = (id) => setSelection(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const startSelection = (id) => { setSelecting(true); setSelection(new Set(id ? [id] : [])); };
  const clearSelection = () => { setSelecting(false); setSelection(new Set()); };

  const pct = dur > 0 ? (time/dur)*100 : 0;
  persistRef.current = { track: track || null, queue, t: time };

  // Estado de UI actual para el manejador global del botón "retroceder".
  const uiStateRef = useRef({});
  uiStateRef.current = { expanded, showQueue, view, openPlaylist, menuTarget, addTarget, hasTrack: !!track };

  // ── Interceptar el botón/gesto "retroceder" del sistema (Android/iOS) ──
  // Sin esto, retroceder descarga la app (PWA) y DETIENE la música. Con esto,
  // retroceder cierra el overlay abierto (menú, cola, reproductor, vista) y, si
  // no hay nada que cerrar pero hay música, mantiene la app viva (no sale).
  useEffect(() => {
    window.history.pushState({ vg: 1 }, '');
    const onPop = () => {
      const s = uiStateRef.current;
      let handled = true;
      if (s.menuTarget != null) setMenuTarget(null);
      else if (s.addTarget != null) setAddTarget(null);
      else if (s.showQueue) setShowQueue(false);
      else if (s.expanded) setExpanded(false);
      else if (s.view) setView(null);
      else if (s.openPlaylist) setOpenPlaylist(null);
      else handled = false;
      // Reponer el "guardia" si cerramos algo o si hay música sonando (no salir).
      if (handled || s.hasTrack) window.history.pushState({ vg: 1 }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Media Session API: controles de pantalla de bloqueo y notificación del OS ──
  // (Debe declararse ANTES de cualquier return condicional para no romper el
  //  orden de los hooks de React.)
  const mediaArtBlobRef = useRef(null);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    let cancelled = false;
    const appArt = [
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ];
    const applyMeta = (artwork) => {
      if (cancelled || !track) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          artwork: artwork && artwork.length ? artwork : appArt,
        });
      } catch {}
    };
    (async () => {
      if (!track) return;
      const cover = track.cover || (trackById(track.id) || {}).cover || '';
      // HTTPS: ok en la mayoría de SO. data:/blob: → blob same-origin (mejor que data: crudo).
      if (cover && /^https?:/i.test(cover)) {
        applyMeta([{
          src: cover.replace(/=w\d+-h\d+/, '=w512-h512').replace(/=s\d+/, '=s512'),
          sizes: '512x512', type: 'image/jpeg',
        }]);
        return;
      }
      if (cover && (cover.startsWith('data:') || cover.startsWith('blob:'))) {
        try {
          const res = await fetch(cover);
          const blob = await res.blob();
          if (cancelled) return;
          if (mediaArtBlobRef.current) {
            try { URL.revokeObjectURL(mediaArtBlobRef.current); } catch {}
          }
          const u = URL.createObjectURL(blob);
          mediaArtBlobRef.current = u;
          applyMeta([{ src: u, sizes: '512x512', type: blob.type || 'image/jpeg' }]);
          return;
        } catch { /* fall through to app icon */ }
      }
      applyMeta(appArt);
    })();
    const a = () => audioRef.current;
    const doPlay = () => { const el = a(); if (el) { if (el.volume === 0) el.volume = vol; el.play().catch(() => {}); setPlaying(true); } };
    const doPause = () => { const el = a(); if (el) { el.pause(); setPlaying(false); } };
    navigator.mediaSession.setActionHandler('play', doPlay);
    navigator.mediaSession.setActionHandler('pause', doPause);
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    try { navigator.mediaSession.setActionHandler('seekto', (e) => { if (e.seekTime != null) seek(e.seekTime); }); } catch {}
    try { navigator.mediaSession.setActionHandler('seekforward', () => next()); } catch {}
    try { navigator.mediaSession.setActionHandler('seekbackward', () => prev()); } catch {}
    try { navigator.mediaSession.setActionHandler('stop', () => doPause()); } catch {}
    return () => {
      cancelled = true;
      ['play','pause','previoustrack','nexttrack','seekto','seekforward','seekbackward','stop'].forEach(act => {
        try { navigator.mediaSession.setActionHandler(act, null); } catch {}
      });
    };
  }, [track, playing]);

  // Sincronizar estado de reproducción con Media Session
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  // ── Instalación de la PWA (pantalla de inicio) ──
  const [installEvt, setInstallEvt] = useState(null);
  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBIP); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
  const installApp = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch {}
    setInstallEvt(null);
  };

  if (!authed) return <AuthScreen onAuthed={handleAuthed} T={T} />;

  const NAV = [
    { id:'home', label:'Inicio', I: Icon.Home }, { id:'search', label:'Buscar', I: Icon.Search },
    { id:'library', label:'Biblioteca', I: Icon.Lib }, { id:'profile', label:'Perfil', I: Icon.User },
  ];

  const ctx = {
    track, playing, play, T, favs, toggleFav, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist,
    recent, recentSearches, addSearch, removeSearch, homeRows, homeLoading, detailLoading,
    openPlaylist, setOpenPlaylist, setTab, addToTarget: setAddTarget, onMenu: setMenuTarget,
    themeKey, setThemeKey, quality, setQuality, glow, setGlow, eq, setEq, settings, setSettings,
    view, setView, goArtist, goAlbum, goMix, goWrapped, startAiDj, shareTrack, email, onLogout, detailData,
    installApp, canInstall: !!installEvt, isIOS, isStandalone,
    addToQueue, removeFromQueue: removeFromQueueToast, download, removeDownload, downloadMany, clearDownloads, getDownloads, downloaded, downloading, openQueue: () => setShowQueue(true),
    savedAlbums, saveAlbum, unsaveAlbum, isAlbumSaved,
    savedPlaylists, savePlaylist, unsavePlaylist, isPlaylistSaved,
    selecting, selection, toggleSelect, startSelection, clearSelection,
    hydrateTracks, playStats: playStatsRef.current,
    outputs, sinkId, setOutput: setSinkId,
    customPalettes, activeCustomId, setActiveCustomId, activePalette, addPalette, updatePalette, deletePalette,
    displayName, saveProfileName, deleteAccount, avatar, saveAvatar,
    onboardPrefs, setOnboardPrefs, GENRES: ONBOARDING_GENRES,
    backendDown,
    playingFrom, goToPlayingPlaylist,
    showImport, setShowImport, importJob, setImportJob, startImport, startImportText,
  };

  const playerProps = { track, playing, togglePlay, next, prev, time, dur, seek, vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved: track ? favs.includes(track.id) : false, toggleFav, T, loadingAudio, nextCover, prevCover };

  const TabContent = (
    <>
      {tab === 'home' && <HomeTab ctx={ctx} />}
      {tab === 'search' && <SearchTab ctx={ctx} />}
      {tab === 'library' && <LibraryTab ctx={ctx} />}
      {tab === 'profile' && <ProfileTab ctx={ctx} />}
    </>
  );
  const Content = view ? (view.type === 'wrapped' ? <WrappedView ctx={ctx} /> : <DetailView view={view} ctx={ctx} />) : TabContent;

  // Manejo resiliente de errores de reproducción: reintenta una vez con URL
  // fresca (evade caché de borde) y, si vuelve a fallar, salta a la siguiente
  // pista de la cola en lugar de detener todo. Reduce al máximo los cortes.
  const MAX_PLAY_RETRIES = 6;
  const consecutiveFailsRef = useRef(0);
  const sustainedPlayRef = useRef(false);
  const handleAudioError = () => {
    selfPauseRef.current = false;
    const a = audioRef.current;
    const cur = track?.id;
    if (!a || !cur) { setLoadingAudio(false); setPlaying(false); return; }
    const st = playErrorRef.current;
    const n = (st.id === cur) ? st.n : 0;
    const isBlob = typeof a.currentSrc === 'string' && a.currentSrc.startsWith('blob:');
    // Reintentos agresivos: la prioridad es reproducir LA canción seleccionada.
    // 6 intentos con espera creciente (1.5s, 3s, 5s, 8s, 12s, 16s). Cubre: resolución
    // en frío con 5 clientes YT, URL expirada, backend saturado, rate-limit.
    if (n < MAX_PLAY_RETRIES && !isBlob) {
      const attempt = n + 1;
      playErrorRef.current = { id: cur, n: attempt };
      setLoadingAudio(true);
      const delays = [1500, 3000, 5000, 8000, 12000, 16000];
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      setTimeout(async () => {
        if (!audioRef.current || trackRef.current?.id !== cur) return;
        try {
          const q = ({ high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' }[quality] || 'high');
          if (attempt > 2) api._streamSignCache?.clear?.();
          const base = await api.ensureStreamUrl({ artist: track.artist, title: track.title, id: track.id, quality: q });
          // Primeros intentos: URL firmada (backend/caché).
          // Últimos: cache-bust de query (la firma sigue válida; solo fuerza re-fetch red).
          audioRef.current.src = attempt > 2 ? (base + '&_r=' + Date.now()) : base;
          audioRef.current.load();
          const p = audioRef.current.play(); if (p && p.catch) p.catch(() => {});
        } catch {}
      }, delay);
      return;
    }
    // Agotados 6 reintentos (~45s de intentos): saltar con protección anti-cascada.
    playErrorRef.current = { id: cur, n: 0 };
    consecutiveFailsRef.current += 1;
    if (consecutiveFailsRef.current > 2) {
      consecutiveFailsRef.current = 0;
      setLoadingAudio(false); setPlaying(false);
      showToast('Varias pistas no disponibles. Verifica tu conexión.');
      return;
    }
    setLoadingAudio(false);
    const ids = queue && queue.length ? queue : [];
    const i = ids.indexOf(cur);
    if (ids.length > 1 && i !== -1) {
      showToast('Pista no disponible · siguiente…');
      setTimeout(() => next(), 1000);
    } else { setPlaying(false); showToast('No se pudo reproducir esta pista'); api.reportPlaybackError({ trackId: cur, errorCode: 'max_retries', errorMessage: 'Agotados 6 reintentos de reproducción' }); }
  };

  const audioEl = (
    <>
    <audio ref={audioRef} src={playSrc || (track ? track.url : undefined)} preload="auto" playsInline
      onTimeUpdate={() => {
        const a = audioRef.current; if (!a) return;
        const ct = a.currentTime || 0; setTime(ct);
        if (ct > 0 && loadingAudio) setLoadingAudio(false);
      }}
      onLoadedMetadata={() => { setDur(audioRef.current?.duration||0); if (resumeRef.current != null && audioRef.current) { try { audioRef.current.currentTime = resumeRef.current; } catch {} setTime(resumeRef.current); resumeRef.current = null; } }}
      onCanPlay={() => setLoadingAudio(false)}
      onPlay={() => { selfPauseRef.current = false; setLoadingAudio(false); playingRef.current = true; if (!playing) setPlaying(true); }}
      onPlaying={() => { selfPauseRef.current = false; setLoadingAudio(false); playErrorRef.current = { id: null, n: 0 }; sustainedPlayRef.current = false; setTimeout(() => { if (audioRef.current && !audioRef.current.paused && audioRef.current.currentTime > 3) { consecutiveFailsRef.current = 0; sustainedPlayRef.current = true; } }, 5000); if (pendingFadeRef.current) { pendingFadeRef.current = false; fadeInAudio(); } }}
      onStalled={() => setLoadingAudio(true)}
      onWaiting={() => setLoadingAudio(true)}
      onPause={() => {
        if (selfPauseRef.current) return;
        if (pendingFadeRef.current) return;
        const a = audioRef.current;
        if (!a || a.ended) return;
        if (!playingRef.current) return;
        // En background: NO intervenir. Chrome pausa el audio temporalmente
        // y lo reanuda solo. Nuestro forceReacquire haría load() y mataría
        // la sesión permanentemente. Solo guardar el estado.
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        // En foreground: el OS pausó el audio mientras la app está visible.
        // Reanudar con forceReacquire.
        setTimeout(() => {
          if (playingRef.current && audioRef.current && !audioRef.current.ended && audioRef.current.paused) {
            forceReacquire();
          }
        }, 200);
      }}
      onError={handleAudioError}
      onEnded={onEnded}
    />
      {/* Pre-buffer oculto de las siguientes 2 pistas (volume=0, nunca reproducen). */}
      {/* muted=true causa throttle agresivo en mobile; volume=0 es respetado sin throttling. */}
      <audio ref={preloadAudioRef} preload="auto" style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }} aria-hidden="true" tabIndex={-1} />
      <audio ref={preloadAudio2Ref} preload="auto" style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }} aria-hidden="true" tabIndex={-1} />
    </>
  );

  const expandedPlayer = (
    <ExpandedPlayer open={expanded} onClose={() => setExpanded(false)} {...playerProps} audioRef={audioRef}
      glow={glow} quality={quality} compact={!wide} desktop={wide} onAdd={setAddTarget} onMenu={setMenuTarget}
      onQueue={() => setShowQueue(true)} outputs={outputs} sinkId={sinkId} setOutput={setSinkId}
      lyricOffset={lyricOffset} setLyricOffset={setLyricOffset} />
  );
  const addModal = <AddToPlaylistModal trackId={addTarget} onClose={() => { setAddTarget(null); if (selecting) clearSelection(); }} playlists={playlists} createPlaylist={createPlaylist} addToPlaylist={addToPlaylist} removeFromPlaylist={removeFromPlaylist} T={T} />;
  const trackMenu = <TrackMenu trackId={menuTarget} onClose={() => setMenuTarget(null)} ctx={ctx} />;
  const queuePanel = <QueuePanel open={showQueue} onClose={() => setShowQueue(false)} queue={queue} current={track} play={play} T={T} reorder={reorderQueue} remove={removeFromQueue} />;
  const selectionBar = selecting ? (
    <div className="fade-up glass" style={{ position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:'calc(env(safe-area-inset-bottom, 16px) + 92px)', zIndex:100, display:'flex', alignItems:'center', gap:12, background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:99, padding:'8px 10px 8px 16px', boxShadow:'0 12px 34px #000a' }}>
      <span style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)' }}>{selection.size} seleccionada(s)</span>
      <button disabled={!selection.size} onClick={() => selection.size && setAddTarget([...selection])} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:99, padding:'8px 16px', cursor:'pointer', color:'#04060a', fontSize:12, fontWeight:800, opacity: selection.size?1:.5 }}>Añadir a playlist</button>
      <button aria-label="Cancelar" onClick={clearSelection} className="press" style={{ background:'var(--surf-2)', border:'none', borderRadius:'50%', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={16} /></button>
    </div>
  ) : null;

  // Banner "Modo sin conexión": visible cuando el backend está caído.
  const offlineBanner = backendDown ? (
    <div className="fade-up" style={{ position:'fixed', top:'env(safe-area-inset-top, 0px)', left:0, right:0, zIndex:125, display:'flex', alignItems:'center', gap:10, background:'var(--surf-0)', border:'1px solid var(--line)', borderBottom:`1px solid ${hex2rgba(T.accent,.3)}`, padding:'10px 16px', boxShadow:'0 4px 16px #0006' }}>
      <Icon.WifiOff c={T.accent} sz={18} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:800, color:'var(--txt-0)' }}>Modo sin conexión</div>
        <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:1 }}>Tu biblioteca y descargas están disponibles. Búsqueda y streaming requieren conexión.</div>
      </div>
      <button onClick={() => { api.pingBackend().then(ok => { if (ok) { setBackendDown(false); showToast('Conexión restablecida'); } else showToast('El servidor sigue sin responder'); }); }} className="press" style={{ flexShrink:0, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'6px 14px', cursor:'pointer', color:'var(--txt-1)', fontSize:11, fontWeight:700 }}>Reintentar</button>
    </div>
  ) : null;

  // Aviso visible de nueva versión: aparece en la parte superior con mayor visibilidad.
  const updateBanner = updateReady ? (
    <div className="fade-up" style={{ position:'fixed', top:'env(safe-area-inset-top, 0px)', left:0, right:0, zIndex:130, display:'flex', alignItems:'center', gap:10, background:`linear-gradient(135deg, ${hex2rgba(T.accent,.97)}, ${hex2rgba(T.accent2,.97)})`, padding:'11px 16px', boxShadow:'0 6px 24px #000a', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)' }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:900, color:'#04060a' }}>Nueva versión disponible</div>
        <div style={{ fontSize:10, color:'#04060acc', marginTop:1 }}>Toca para actualizar ahora</div>
      </div>
      <button onClick={applyUpdate} className="btn-tap" style={{ flexShrink:0, background:'#04060a', border:'none', borderRadius:99, padding:'8px 18px', cursor:'pointer', color:T.accent, fontSize:12, fontWeight:900, boxShadow:'0 4px 12px #0004' }}>Actualizar</button>
      <button aria-label="Después" onClick={() => setUpdateReady(false)} className="press" style={{ flexShrink:0, background:'#04060a22', border:'none', borderRadius:'50%', width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.X c="#04060a" sz={14} /></button>
    </div>
  ) : null;
  const importModal = showImport ? <ImportPlaylistModal onClose={() => setShowImport(false)} onImport={startImport} onImportText={startImportText} T={T} /> : null;
  const importBanner = <ImportBanner job={importJob} T={T} />;
  const importResultModal = importJob && !importJob.busy ? <ImportResultModal job={importJob} onClose={() => setImportJob(null)} onGoToPlaylist={openImportedPlaylist} T={T} /> : null;

  // ───────────── DESKTOP ─────────────
  if (wide) {
    return (
      <div style={{ position:'relative', height:'100vh', overflow:'hidden', background:'radial-gradient(circle at 25% 0%, #0d1320, #04060a 55%)', display:'flex', flexDirection:'column', fontFamily:'Inter,-apple-system,sans-serif' }}>
        {audioEl}
        <div style={{ position:'absolute', top:-120, left:'40%', width:520, height:320, background:grad(T), filter:'blur(120px)', opacity:.12, pointerEvents:'none', zIndex:0 }} />
        <div style={{ flex:1, display:'flex', overflow:'hidden', position:'relative', zIndex:1 }}>
          <Sidebar tab={tab} setTab={setTab} nav={NAV} T={T} playlists={playlists} setOpenPlaylist={setOpenPlaylist} setView={setView} />
          <main style={{ flex:1, overflowY:'auto' }}>
            <div style={{ maxWidth:1080, margin:'0 auto', padding:'30px 38px 40px' }}>{Content}</div>
          </main>
        </div>
        <PlayerBar {...playerProps} onExpand={() => setExpanded(true)} onMenu={setMenuTarget} onQueue={() => setShowQueue(true)} />
        {expandedPlayer}{addModal}{trackMenu}{queuePanel}{selectionBar}{updateBanner}{offlineBanner}{importModal}{importBanner}{importResultModal}
        <Toast msg={toast} T={T} />
      </div>
    );
  }

  // ───────────── MÓVIL ─────────────
  return (
    <div style={{ position:'relative', height:'100dvh', width:'100%', overflow:'hidden', overflowX:'hidden', background:'radial-gradient(circle at 30% 0%, #0d1320, #04060a 60%)', display:'flex', flexDirection:'column', fontFamily:'Inter,-apple-system,sans-serif' }}>
      {audioEl}
      <div style={{ position:'absolute', top:-60, left:'50%', transform:'translateX(-50%)', width:300, height:200, background:grad(T), filter:'blur(70px)', opacity:.16, pointerEvents:'none', zIndex:0 }} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', paddingTop:'calc(env(safe-area-inset-top, 12px) + 8px)', position:'relative', zIndex:1 }}>
        <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'4px 18px 0', width:'100%', boxSizing:'border-box' }}>{Content}</div>

        {track && (
          <div style={{ padding:'8px 14px 6px' }}>
            <MiniPlayerBar track={track} playing={playing} togglePlay={togglePlay} loadingAudio={loadingAudio} T={T} pct={pct} setExpanded={setExpanded} setMenuTarget={setMenuTarget} next={next} prev={prev} />
          </div>
        )}

        <div className="glass" style={{ display:'flex', justifyContent:'space-around', padding:'10px 0 calc(env(safe-area-inset-bottom, 14px) + 14px)', borderTop:'1px solid var(--line-soft)', background:'#06080faa', userSelect:'none' }}>
          {NAV.map(({ id, label, I }) => {
            const act = tab === id;
            return (
              <button key={id} aria-label={label} onClick={() => { setTab(id); setExpanded(false); setView(null); if (id==='library') setOpenPlaylist(null); }} className="press" style={{ background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'4px 12px', position:'relative' }}>
                {act && <div style={{ position:'absolute', top:-10, width:5, height:5, borderRadius:'50%', background:T.accent, boxShadow:`0 0 8px ${T.accent}` }} />}
                <I c={act ? T.accent : 'var(--txt-3)'} sz={22} />
                <span style={{ fontSize:10, fontWeight:700, color: act ? T.accent : 'var(--txt-3)' }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {expandedPlayer}{addModal}{trackMenu}{queuePanel}{selectionBar}{updateBanner}{offlineBanner}{importModal}{importBanner}{importResultModal}
      {remotePlaying && remotePlaying.trackId && remotePlaying.trackId !== track?.id && (
        <div className="fade-up" style={{ position:'fixed', bottom:80, left:12, right:12, zIndex:80, background:'var(--surf-0)', border:`1px solid ${hex2rgba(T.accent,.3)}`, borderRadius:16, padding:'12px 14px', display:'flex', alignItems:'center', gap:12, boxShadow:'0 8px 24px #000a' }}>
          <img src={remotePlaying.cover ? hiResCover(remotePlaying.cover, 64) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" style={{ width:44, height:44, borderRadius:10, objectFit:'cover', flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:800, color:T.accent }}>Reproduciendo en {remotePlaying.deviceName || 'otro dispositivo'}</div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{remotePlaying.title}</div>
            <div style={{ fontSize:10.5, color:'var(--txt-2)' }}>{remotePlaying.artist}</div>
          </div>
          {remotePlaying.trackId && <button onClick={() => { const t = trackById(remotePlaying.trackId); if (t) play(t); setRemotePlaying(null); }} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:99, padding:'8px 16px', cursor:'pointer', color:'#04060a', fontSize:11, fontWeight:800, flexShrink:0 }}>Reproducir aquí</button>}
        </div>
      )}
      <Toast msg={toast} T={T} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEVICE CHIP — salida de audio (auriculares / parlante)
// ═══════════════════════════════════════════════════════════════
function DeviceChip({ outputs, sinkId, setOutput, T }) {
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

// ═══════════════════════════════════════════════════════════════
// QUEUE PANEL — cola con reordenamiento (arrastrar en escritorio + flechas)
// ═══════════════════════════════════════════════════════════════
function QueuePanel({ open, onClose, queue, current, play, T, reorder, remove }) {
  const [drag, setDrag] = useState(null);
  if (!open) return null;
  const ids = queue && queue.length ? queue : (current ? [current.id] : []);
  const items = ids.map(id => trackById(id)).map((t, i) => ({ t, id: ids[i] })).filter(x => x.t);
  const curIdx = current ? ids.indexOf(current.id) : -1;

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060ad9', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:110 }} />
      <div className="fade-up" style={{ position:'fixed', right:0, top:0, bottom:0, width:'min(440px, 100%)', background:'var(--surf-0)', borderLeft:'1px solid var(--line)', zIndex:111, display:'flex', flexDirection:'column', padding:'calc(env(safe-area-inset-top, 16px) + 18px) 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', boxShadow:'-30px 0 80px #000c' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ fontSize:18, fontWeight:900, color:'var(--txt-0)' }}>En cola</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={18} /></button>
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {items.length === 0 && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:40 }}>La cola está vacía.</div>}
          {items.map(({ t, id }, i) => {
            const isCur = id === current?.id;
            return (
              <div key={id + '_' + i} draggable
                onDragStart={() => setDrag(i)}
                onDragOver={e => { e.preventDefault(); if (drag !== null && drag !== i) { reorder(drag, i); setDrag(i); } }}
                onDragEnd={() => setDrag(null)}
                onDrop={() => setDrag(null)}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 8px', borderRadius:14, marginBottom:3, background: isCur ? hex2rgba(T.accent,.12) : (drag===i ? 'var(--surf-2)' : 'transparent'), border:`1px solid ${isCur ? hex2rgba(T.accent,.3) : 'transparent'}`, opacity: drag===i ? .85 : 1, transform: drag===i ? 'scale(1.02)' : 'none', boxShadow: drag===i ? '0 8px 24px #000a' : 'none', transition:'background .2s ease, transform .15s ease, box-shadow .2s ease', cursor: drag===i ? 'grabbing' : 'default' }}>
                <span style={{ cursor:'grab', display:'flex', flexShrink:0 }}><Icon.Grip c="var(--txt-3)" sz={16} /></span>
                <CoverImg src={t.cover} alt="" radius={9} style={{ width:40, height:40, flexShrink:0 }} />
                <div onClick={() => play(t, ids)} style={{ flex:1, minWidth:0, cursor:'pointer' }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color: isCur ? T.accent : 'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.title}{isCur ? ' · ▶' : ''}</div>
                  <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.artist}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}>
                  <button aria-label="Subir" disabled={i===0} onClick={() => i>0 && reorder(i, i-1)} className="press" style={{ background:'none', border:'none', cursor: i===0?'default':'pointer', padding:4, opacity: i===0?.3:1, transform:'rotate(180deg)' }}><Icon.ChevD c="var(--txt-2)" sz={16} /></button>
                  <button aria-label="Bajar" disabled={i===items.length-1} onClick={() => i<items.length-1 && reorder(i, i+1)} className="press" style={{ background:'none', border:'none', cursor: i===items.length-1?'default':'pointer', padding:4, opacity: i===items.length-1?.3:1 }}><Icon.ChevD c="var(--txt-2)" sz={16} /></button>
                  {!isCur && <button aria-label="Quitar" onClick={() => remove(id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.X c="var(--txt-3)" sz={15} /></button>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:10, color:'var(--txt-3)', textAlign:'center', marginTop:10 }}>Arrastra o usa las flechas para reordenar</div>
      </div>
    </>
  );
}
