import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api, isAuthed, setOnUnauthorized } from '../api.js';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function AuthScreen({ onAuthed, T }) {
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
    let cancelled = false;
    const refresh = async () => {
      try {
        const cfg = await api.authConfig();
        if (!cancelled) setGoogleClientId((cfg && cfg.googleClientId) || '');
      } catch { if (!cancelled) setGoogleClientId(''); }
      try {
        const ok = await api.pingBackend();
        if (!cancelled) setBackendDown(!ok);
      } catch { if (!cancelled) setBackendDown(true); }
    };
    refresh();
    // Reintentar: si el backend se cae y vuelve, login/Google reaparecen solos.
    const iv = setInterval(refresh, 8000);
    window.addEventListener('online', refresh);
    return () => { cancelled = true; clearInterval(iv); window.removeEventListener('online', refresh); };
  }, []);
  const googleLogin = () => {
    if (!googleClientId) return;
    setBusy(true); setErr('');
    // Flujo de redirect completo (no popup). Google redirige a
    // /auth/google/callback con el id_token en el hash. Esa página llama al
    // backend, guarda el JWT y vuelve a /.
    //
    // redirect_uri SIN barra final: debe coincidir EXACTO con Google Cloud
    // Console. El callback carga callback.js por ruta ABSOLUTA para que no
    // falle cuando la URL no termina en / (bug "Conectando…" eterno).
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

