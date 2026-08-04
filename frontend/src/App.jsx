import React, { useState, useEffect, useRef } from 'react';
import { api, isAuthed, setOnUnauthorized } from './api.js';
import * as offline from './offline.js';

import { CSS, THEMES, BASE_VARS } from './constants.js';
import { hex2rgba, grad, dedupeByTitle, capPerArtist, tintedVars } from './helpers.js';
import { cacheTrack, trackById, loadPlayerState, normalizeTrack } from './catalog.js';
import {
  isDocumentVisible,
  shouldPreExtendQueue,
  isStreamUrlFresh,
} from './audioContinuity.js';
import { selectPlaySync } from './audio/audioMachine.js';
import { runAudioEffects } from './audio/runAudioEffects.js';
import { usePersisted, useViewport } from './hooks.js';
import { useLibrarySync } from './hooks/useLibrarySync.js';
import { useHomeFeed } from './hooks/useHomeFeed.js';
import { useLibraryActions } from './hooks/useLibraryActions.js';
import { useDownloads } from './hooks/useDownloads.js';
import { usePlayerStoreBindings } from './hooks/usePlayerStoreBindings.js';
import { useLibraryStoreBindings } from './hooks/useLibraryStoreBindings.js';
import { usePlaybackController } from './hooks/usePlaybackController.js';
import { useAppUpdate } from './hooks/useAppUpdate.js';
import { useMediaSession } from './hooks/useMediaSession.js';
import { useAudioErrorRecovery } from './hooks/useAudioErrorRecovery.js';
import { useAudioElement } from './hooks/useAudioElement.js';
import { useAudioResumeGuard } from './hooks/useAudioResumeGuard.js';
import { useCatalogNavigation } from './hooks/useCatalogNavigation.js';
import { usePlaylistImport } from './hooks/usePlaylistImport.js';
import { useAudioOutput } from './hooks/useAudioOutput.js';
import { useTrackPrebuffer } from './hooks/useTrackPrebuffer.js';
import { useLibraryStore } from './store/libraryStore.js';
import { Icon } from './Icons.jsx';
import { AuthScreen } from './screens/AuthScreen.jsx';
import { HomeTab } from './tabs/HomeTab.jsx';
import { SearchTab } from './tabs/SearchTab.jsx';
import { LibraryTab } from './tabs/LibraryTab.jsx';
import { ProfileTab } from './tabs/ProfileTab.jsx';
import { DetailView } from './tabs/DetailView.jsx';
import { WrappedView } from './tabs/WrappedView.jsx';
import { Sidebar } from './layout/Sidebar.jsx';
import { MiniPlayerBar } from './player/MiniPlayerBar.jsx';
import { ExpandedPlayer } from './player/ExpandedPlayer.jsx';
import { PlayerBar } from './player/PlayerBar.jsx';
import { QueuePanel } from './player/QueuePanel.jsx';
import { AddToPlaylistModal } from './modals/AddToPlaylistModal.jsx';
import { ImportPlaylistModal } from './modals/ImportPlaylistModal.jsx';
import { ImportBanner } from './modals/ImportBanner.jsx';
import { ImportResultModal } from './modals/ImportResultModal.jsx';
import { TrackMenu } from './modals/TrackMenu.jsx';
import { Toast } from './modals/Toast.jsx';


// ── Error Boundary global: evita que un crash de React quede en pantalla negra.
// Si el componente lanza un error no capturado, muestra un botón de recarga
// en lugar de un div vacío negro. Imprescindible para el login de Google y
// cambios de estado bruscos (logout, etc.).
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) {
    console.error('[Velocity] Error capturado:', e);
    console.error('[Velocity] Stack:', e?.stack);
    console.error('[Velocity] Component stack:', info?.componentStack);
    try {
      localStorage.setItem('velocity.lastError', JSON.stringify({
        msg: e?.message || String(e),
        stack: e?.stack,
        componentStack: info?.componentStack,
        ts: Date.now(),
      }));
    } catch {}
  }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{ minHeight:'100dvh', background:'#04060a', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Inter,sans-serif', padding:24 }}>
        <div style={{ maxWidth:360, textAlign:'center' }}>
          <div style={{ fontSize:16, fontWeight:800, color:'#e8eaed', marginBottom:8 }}>Algo salió mal</div>
          <div style={{ fontSize:12, color:'#9aa0a6', marginBottom:18, wordBreak:'break-word' }}>{msg}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ background:'#10d9a0', color:'#04060a', border:'none', borderRadius:12, padding:'12px 22px', fontWeight:800, fontSize:13, cursor:'pointer' }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
export { AppErrorBoundary };

export default function App() {
  useEffect(() => {
    if (document.getElementById('ms-global')) return;
    const el = document.createElement('style'); el.id = 'ms-global'; el.textContent = CSS;
    document.head.appendChild(el);
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

  // reproducción — fuente de verdad: playerStore (sin useState mirror)
  const [tab, setTab] = useState('home');
  const {
    track, setTrack,
    playing, setPlaying,
    time, setTime,
    dur, setDur,
    vol, setVol,
    expanded, setExpanded,
    shuffle, setShuffle,
    repeat, setRepeat,
    queue, setQueue,
    loadingAudio, setLoadingAudio,
    playSrc, setPlaySrc,
    mediaInterrupted, setMediaInterrupted,
    outputs, setOutputs,
    sinkId, setSinkId,
    downloaded, setDownloaded,
  } = usePlayerStoreBindings();
  const objUrlRef = useRef(null);
  // Espejo de session (A12); la fuente de verdad es audioMachine.
  const sessionResumeRef = useRef(null);
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
  // ¿Ya se leyó IndexedDB para saber qué está descargado? El auto-reanudado de
  // pendientes no debe correr antes: lo haría con `downloaded` vacío.
  const downloadsHydratedRef = useRef(false);
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

  // Biblioteca — fuente de verdad: libraryStore (sin mirrors useState)
  const {
    favs,
    playlists, setPlaylists,
    recent, setRecent,
    savedAlbums,
    savedPlaylists,
    homeRows,
    setCatVer,
  } = useLibraryStoreBindings();

  // Hook de sincronización con backend (reemplaza los 3 useEffect de biblio)
  useLibrarySync({ authed, email });

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
  const toastTimer = useRef(null);
  const showToast = (m) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2400); };

  // ── Importación de playlists (URL de YouTube / lista en texto) ──
  const {
    showImport, setShowImport,
    importJob, setImportJob,
    startImport, startImportText, openImportedPlaylist,
  } = usePlaylistImport({ showToast, setPlaylists, setOpenPlaylist, setTab });



  // ── Actualización de versión (SW + sondeo de bundle) e instalación PWA ──
  const {
    updateReady, setUpdateReady, applyUpdate,
    installEvt, installApp, isIOS, isStandalone,
  } = useAppUpdate({ playing });

  const audioRef = useRef(null);
  // Dos <audio> ocultos que pre-descargan las siguientes 2 pistas de la cola.
  const preloadAudioRef = useRef(null);
  const preloadAudio2Ref = useRef(null);
  const preloadEpochRef = useRef(0);
  const [preloadEpoch, setPreloadEpoch] = useState(0);
  // Reintento por pista ante error de reproducción (URL de audio expirada, etc.).
  const playErrorRef = useRef({ id: null, n: 0 });
  const consecutiveFailsRef = useRef(0);
  const sustainedPlayRef = useRef(false);
  const playingRef = useRef(false);
  // Debe existir antes del effectCtx de la machine (pause self).
  const selfPauseRef = useRef(false);
  const fadeRafRef = useRef(null);
  const fadeSafetyRef = useRef(null);
  const pendingFadeRef = useRef(false);
  // Refs de cola/pista al día (next/prev/onEnded/Media Session sin closures stale).
  const queueRef = useRef(queue);
  const trackRef = useRef(track);
  const settingsRef = useRef(settings);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  // Espejos de machine (focus/yield) — leen la machine unificada del playerStore.
  const systemPausedRef = useRef(false);
  const interruptPositionRef = useRef(null);
  const interruptTrackIdRef = useRef(null);
  const reacquireInFlight = useRef(false);
  const lastTimeRef = useRef(0);
  const stuckCheckRef = useRef(null);
  // Detección de pipeline muerto en background (A14): último currentTime visto
  // y cuándo avanzó por última vez. Nunca dispara play() — solo diagnostica.
  const bgLastCtRef = useRef(0);
  const bgLastProgressRef = useRef(Date.now());

  const nextTrackActionRef = useRef(() => {});
  const prevTrackActionRef = useRef(() => {});
  const audioHydratedRef = useRef(false);

  // ── Media Session (metadatos, controles del OS, posición) ──
  // Se declara antes del controlador para poder entregarle setMediaSessionState;
  // las acciones del OS leen el controlador desde mediaCtlRef al ejecutarse.
  const mediaCtlRef = useRef({});
  const { setMediaSessionState } = useMediaSession({
    track, playing, time, dur, vol,
    mediaInterrupted, interruptPositionRef,
    audioRef, ctlRef: mediaCtlRef,
    nextTrackActionRef, prevTrackActionRef,
  });

  // ── Playback controller: play/toggle/next/seek + dispatch unificado al store ──
  const {
    play, togglePlay, next, prev, seek,
    dispatchAudio, getMachine, patchMachine,
    restoreInterruptPosition, applySessionResume,
    fadeInAudio, effectCtxRef, nextCover, prevCover,
    addToQueue, reorderQueue, removeFromQueue, removeFromQueueToast, prefetchNext,
  } = usePlaybackController({
    audioRef, selfPauseRef, playingRef, fadeRafRef, fadeSafetyRef, pendingFadeRef,
    objUrlRef, queueRef, trackRef, radioRef, radioSeedRef, mixSessionRef,
    nextTrackActionRef, prevTrackActionRef, sessionResumeRef,
    systemPausedRef, interruptPositionRef, interruptTrackIdRef,
    quality, backendDown, downloaded, track, playing, time, vol, queue, shuffle,
    setTrack, setPlaying, setTime, setPlaySrc, setLoadingAudio, setMediaInterrupted,
    setQueue, setRecent, setPlayingFrom, showToast, recordPlayStat, setMediaSessionState,
    playErrorRef, consecutiveFailsRef,
  });
  // Publicar el controlador para las acciones de Media Session (ver arriba).
  mediaCtlRef.current = { getMachine, dispatchAudio, seek };
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
    setOnUnauthorized(() => {
      useLibraryStore.getState().reset();
      setAuthed(false);
      showToast('Tu sesión expiró. Inicia sesión de nuevo.');
    });
    homeRows.forEach(sec => (sec.mixes || []).forEach(m => (m.tracks || []).forEach(cacheTrack))); // hidratar caché del feed guardado
    (async () => {
      try {
        // Almacenamiento persistente ANTES de cualquier lectura: evita que el
        // navegador desaloje las descargas por presión de disco.
        offline.ensurePersistentStorage();
        // ORDEN CRÍTICO: `downloaded` se hidrata PRIMERO con listIds(), que solo
        // lee claves (getAllKeys) y es instantáneo. Antes se hacía al final,
        // después de pruneInvalid() + listMetas() — dos lecturas que
        // deserializan TODOS los blobs (cientos de MB con una biblioteca
        // grande). Durante esos segundos `downloaded` estaba vacío, así que las
        // pistas ya descargadas se pintaban como no descargadas y el
        // auto-reanudado de pendientes las volvía a descargar.
        const ids = await offline.listIds();
        setDownloaded(new Set(ids));
        downloadsHydratedRef.current = true;
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
        // Limpieza de registros corruptos (sin blob o de tamaño 0). Va al FINAL
        // y no bloquea nada: es mantenimiento, no un requisito para pintar la
        // biblioteca. Si borra algo, se refleja en `downloaded`.
        try {
          const bad = await offline.pruneInvalid();
          if (bad && bad.length) {
            setDownloaded(prev => { const n = new Set(prev); bad.forEach(id => n.delete(id)); return n; });
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
      finally { downloadsHydratedRef.current = true; }
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
  // NOTA: La hidratación y fetch de biblioteca los maneja useLibrarySync (hook).
  // Antes había un useEffect duplicado acá que competía con el hook, generando
  // race conditions. Se eliminó en el refactor de libraryStore.
  // Marcamos libReadyRef cuando el store termina de hidratar (para el feed).
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    const unsub = useLibraryStore.subscribe((s) => {
      if (!cancelled && (s.favs.length || s.playlists.length || s.recent.length)) {
        libReadyRef.current = true;
      }
    });
    // Si el store ya tenía datos del cache, marcar listo inmediatamente
    const s = useLibraryStore.getState();
    if (s.favs.length || s.playlists.length || s.recent.length) {
      libReadyRef.current = true;
    }
    return () => { cancelled = true; unsub(); };
  }, [authed]);

  // La reproducción entre dispositivos no interviene en el reproductor local.
  // El backend conserva now-playing para compatibilidad con otros clientes.

  // ── Re-persistir la caché al modificar biblioteca: lo maneja useLibrarySync ──
  // (antes había un useEffect acá que llamaba persistLibCache — eliminado por duplicación)

  // ── Feed personalizado: extraído a useHomeFeed (reduce ~190 líneas) ──
  // libReadyRef se pasa como booleano en cada render (App re-renderiza al hidratar lib).
  useHomeFeed({ authed, libReady: libReadyRef.current, downloaded, recentSearches, onboardPrefs });

  // ── Reanudar descargas pendientes al volver a la app ──
  // Antes esto disparaba downloadMany(pendientes) a los 1200 ms de autenticar,
  // sin esperar a que IndexedDB dijera qué había ya descargado. Con una
  // biblioteca grande la hidratación tarda más que ese timeout, así que
  // `downloaded` estaba vacío: las pistas YA descargadas se re-descargaban y se
  // pintaban como "descargando". Ahora se espera la hidratación y, además, se
  // confirma contra IndexedDB (fuente de verdad) justo antes de reanudar.
  useEffect(() => {
    if (!authed || resumedRef.current) return;
    if (!pendingRef.current.size) return;
    let cancelled = false;
    resumedRef.current = true;
    (async () => {
      // Esperar la hidratación de descargas (máx ~15 s por si IndexedDB falla).
      for (let i = 0; i < 150 && !downloadsHydratedRef.current && !cancelled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (cancelled) return;
      let already = new Set();
      try { already = new Set(await offline.listIds()); } catch { /* sin IDB: no reanudar a ciegas */ return; }
      // Purgar de la cola lo que ya está en disco (quedó ahí por un cierre a
      // medias) y quedarse solo con lo que de verdad falta.
      let changed = false;
      for (const id of [...pendingRef.current]) {
        if (already.has(id)) { pendingRef.current.delete(id); changed = true; }
      }
      if (changed) savePending();
      const pend = [...pendingRef.current];
      if (!pend.length || cancelled) return;
      downloadMany(pend);
    })();
    return () => { cancelled = true; };
  }, [authed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate machine una vez (A12/A13) — App reabre en pause sin auto-play.
  useEffect(() => {
    if (audioHydratedRef.current) return;
    audioHydratedRef.current = true;
    const s = loadPlayerState();
    if (!s?.track?.id) return;
    dispatchAudio({
      type: 'HYDRATE',
      trackId: s.track.id,
      position: s.t || 0,
      urlFresh: isStreamUrlFresh(s.track.url),
    });
  }, []);

  // ── Sincronizar elemento audio vía selectPlaySync(machine) ──
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // Mantener srcStatus alineado con playSrc real
    const fresh = Boolean(playSrc && (isStreamUrlFresh(playSrc) || String(playSrc).startsWith('blob:')));
    if (fresh && getMachine().srcStatus !== 'ready') {
      patchMachine({ srcStatus: 'ready' });
    } else if (!playSrc && getMachine().srcStatus === 'ready') {
      patchMachine({ srcStatus: 'none' });
    }
    // intent desde React playing (por si UI cambió sin dispatch)
    if (playing && getMachine().intent !== 'play') {
      patchMachine({ intent: 'play' });
      playingRef.current = true;
    } else if (!playing && getMachine().intent === 'play' && !mediaInterrupted) {
      // no forzar pause aquí: yield mantiene intent play
    }

    const strategy = selectPlaySync(getMachine(), { visible: isDocumentVisible() });
    if (strategy === 'noop') return;
    if (strategy === 'pause') {
      selfPauseRef.current = true;
      try { a.pause(); } catch {}
      selfPauseRef.current = false;
      setLoadingAudio(false);
      return;
    }
    if (strategy === 'soft-play') {
      if (!fresh) return;
      if (a.volume < vol * 0.5) {
        cancelAnimationFrame(fadeRafRef.current);
        clearTimeout(fadeSafetyRef.current);
        a.volume = vol;
      }
      applySessionResume(a);
      restoreInterruptPosition(a);
      runAudioEffects([{ type: 'play' }], effectCtxRef.current);
    }
  }, [playing, track, playSrc, vol, mediaInterrupted]);

  // ── Estrategia de continuidad en background (A14, anti-zombie) ──
  // Lo que SÍ funciona en Chrome 125+ sin mentir al usuario:
  //  1. Media Session activa y HONESTA: 'playing' solo mientras el elemento
  //     realmente suena; handlers play/pause/next/prev siempre vivos. Es lo
  //     que mantiene la pestaña exenta de throttling agresivo.
  //  2. NO pausar el elemento al ocultarse (DOC_HIDDEN no toca el <audio>).
  //  3. Wake Lock mientras está visible (abajo).
  //  4. Si Chrome corta el pipeline igualmente: DETECTAR (isAudioPipelineDead
  //     en el stuckCheck de abajo) → PIPELINE_DEAD → yield honesto con ancla,
  //     y reanudar en DOC_VISIBLE. Jamás play() oculto tras yield (A7) ni
  //     reportar 'playing' cuando no hay salida (zombie A14).
  //  NO usar: AudioContext/MediaElementSource (secuestra el <audio> y mata
  //  background en móvil), bucles de play() ocultos, ni keepalives sintéticos.

  // ── Volumen, Wake Lock y dispositivos de salida: useAudioOutput ──
  useAudioOutput({ audioRef, playing, vol, settings, sinkId, setOutputs, trackId: track?.id });

  // Sincronizar playingRef con la intención.
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // ── Reanudación tras interrupción / zombie silencioso: useAudioResumeGuard ──
  useAudioResumeGuard({
    audioRef, preloadAudioRef, preloadAudio2Ref,
    playingRef, selfPauseRef, systemPausedRef,
    reacquireInFlight, lastTimeRef, stuckCheckRef,
    bgLastCtRef, bgLastProgressRef,
    preloadEpochRef, setPreloadEpoch,
    vol, getMachine, dispatchAudio,
  });

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
  useTrackPrebuffer({
    preloadAudioRef, preloadAudio2Ref, preloadEpochRef, preloadEpoch,
    track, queue, quality, downloaded,
  });

  // ── Continuidad en segundo plano: extender la cola ANTES de que acabe ──
  // Última O penúltima pista → anexar relacionadas YA (en primer plano),
  // para que onEnded/next() sea síncrono con pantalla bloqueada.
  const autoExtendRef = useRef(null);
  const continuationRef = useRef({ key: null, ids: [] });
  useEffect(() => {
    if (!track || !settings.autoplay) return;
    const ids = queue.length ? queue : [track.id];
    const i = ids.indexOf(track.id);
    if (!shouldPreExtendQueue(i, ids.length)) return;
    // Clave por pista+longitud para re-extender si la cola creció y volvemos al final.
    const key = `${track.id}:${ids.length}`;
    if (autoExtendRef.current === key) return;
    autoExtendRef.current = key;
    continuationRef.current = { key, ids: [] };
    (async () => {
      try {
        const addIds = await buildContinuation(track, ids);
        if (!addIds.length || trackRef.current?.id !== track.id) return;
        continuationRef.current = { key, ids: addIds };
        setQueue(q => {
          const base = q && q.length ? q : [track.id];
          const merged = [...base];
          addIds.forEach(id => { if (!merged.includes(id)) merged.push(id); });
          return merged;
        });
      } catch {}
    })();
  }, [track?.id, queue, settings.autoplay]);

  // Salir del modo selección al navegar.
  useEffect(() => { if (selecting) { setSelecting(false); setSelection(new Set()); } /* eslint-disable-next-line */ }, [tab, view]);

  // play/toggle/next/seek/queue viven en usePlaybackController (playerStore.dispatchPolicy).

  // ── Descargas offline: extraídas a useDownloads ──
  const { download, downloadMany, removeDownload, clearDownloads, getDownloads } = useDownloads({ quality, showToast, pendingRef, savePending });

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

  // ── Fin de pista: repeat / autoplay / continuación ya precargada ──
  // Este handler debe ser síncrono: con la pantalla bloqueada no puede esperar
  // radio/búsqueda de red. La continuación se prepara por autoExtend mientras
  // la app está activa; si no está lista, se detiene honestamente.
  const onEnded = () => {
    const currentTrack = trackRef.current;
    const currentQueue = queueRef.current;
    const currentSettings = settingsRef.current;

    if (repeat && audioRef.current) {
      audioRef.current.volume = vol;
      dispatchAudio({ type: 'USER_SEEK', position: 0 });
      dispatchAudio({ type: 'USER_PLAY' });
      return;
    }
    if (!currentSettings.autoplay) {
      api.updateNowPlaying({ trackId: '', title: '', artist: '', cover: '', position: 0, duration: 0, playing: false, deviceName: '', quality: '' });
      setPlaying(false); return;
    }

    const ids = currentQueue.length ? currentQueue : (currentTrack ? [currentTrack.id] : []);
    const i = ids.indexOf(currentTrack?.id);

    // Hay siguiente en la cola → reproducir.
    if (i !== -1 && i < ids.length - 1) { next(); return; }

    // Solo usar una continuación que ya terminó de resolverse mientras estaba
    // en foreground. Nunca bloquear onEnded con llamadas de red.
    const prepared = continuationRef.current;
    const continuationKey = `${currentTrack?.id || ''}:${ids.length}`;
    const addIds = prepared.key === continuationKey ? prepared.ids : [];
    const nxt = trackById(addIds[0]);
    if (nxt) { play(nxt, [...ids, ...addIds], { keepMix: true }); return; }

    // Fin de la cola sin continuación preparada → notificar stop.
    api.updateNowPlaying({ trackId: '', title: '', artist: '', cover: '', position: 0, duration: 0, playing: false, deviceName: '', quality: '' });
    setPlaying(false);
  };
  // ── Handlers del <audio> físico: extraídos a useAudioElement ──
  // El adapter al DOM sigue siendo runAudioEffects (setPolicyEffectCtx); este
  // hook sólo agrupa los callbacks que estaban inline en el JSX. Debe invocarse
  // ANTES del return condicional de AuthScreen (Rules of Hooks).
  const audioHandlers = useAudioElement({
    audioRef, effectCtxRef,
    systemPausedRef, selfPauseRef, playingRef, pendingFadeRef, trackRef,
    playErrorRef, consecutiveFailsRef, sustainedPlayRef, bgLastProgressRef,
    mediaInterrupted, loadingAudio, playing, vol, quality,
    setTime, setDur, setTrack, setLoadingAudio, setPlaying,
    getMachine, dispatchAudio, applySessionResume, restoreInterruptPosition,
    fadeInAudio, setMediaSessionState,
    onTrackEnded: onEnded,
  });

  // Manejo resiliente de errores de reproducción (ladder de 6 reintentos con
  // firma fresca + anti-cascada): extraído a useAudioErrorRecovery.
  const { handleAudioError } = useAudioErrorRecovery({
    audioRef, effectCtxRef, selfPauseRef, playingRef, trackRef,
    playErrorRef, consecutiveFailsRef,
    track, queue, quality,
    getMachine, dispatchAudio, setTrack, setLoadingAudio, setPlaying,
    showToast, next,
  });

  // ── Acciones de biblioteca (fav, playlist, albums, mixes): extraídas a useLibraryActions ──
  const {
    toggleFav, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist,
    saveAlbum, unsaveAlbum,
    savePlaylist, unsavePlaylist,
  } = useLibraryActions({ authed, email, showToast });

  // Búsquedas recientes (UI local, no libraryStore)
  const addSearch = (term) => setRecentSearches(s => [term, ...s.filter(x => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  const removeSearch = (term) => setRecentSearches(s => s.filter(x => x !== term));

  // ── Navegación del catálogo (artista/álbum/mezcla), AI DJ, compartir ──
  // Extraído a useCatalogNavigation (mismas firmas y cadenas de fallback).
  const {
    goMix, goWrapped, startAiDj, hydrateTracks,
    goArtist, goToPlayingPlaylist, goAlbum, shareTrack,
  } = useCatalogNavigation({
    setExpanded, setView, setOpenPlaylist, setTab,
    setDetailData, setDetailLoading, setCatVer,
    showToast, play,
    recent, favs, downloaded,
    playingFrom, playlists, savedPlaylists,
  });

  const onLogout = () => {
    api.sessionEnd(); // fire-and-forget: cerrar sesión en PG antes de limpiar token
    api.logout();
    useLibraryStore.getState().reset();
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
    // Limpiar cualquier estado de la sesión anterior antes de hidratar la nueva.
    useLibraryStore.getState().reset();
    // Forzar regeneración del feed al hacer login (borra el feed del usuario anterior).
    useLibraryStore.getState().setHomeRows([]);
    useLibraryStore.getState().bumpFeedNonce();
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

  // Letra: se MUESTRA en cualquier pista (ExpandedPlayer online).
  // Offline (IDB) solo biblioteca — backfill al reproducir si ya está en Me gusta /
  // playlist / mezcla. El pack principal se dispara al AÑADIR (useLibraryActions).
  const trackInLibrary = Boolean(track && (
    favs.includes(track.id)
    || playlists.some((p) => (p.trackIds || []).includes(track.id))
    || (savedPlaylists || []).some((p) => (p.trackIds || []).includes(track.id))
    || (savedAlbums || []).some((a) => (a.trackIds || []).includes(track.id))
  ));
  useEffect(() => {
    if (!authed || !track?.id || !trackInLibrary) return;
    let cancel = false;
    import('./offlineLibrary.js').then(({ ensureLyricsOffline }) => {
      if (!cancel) ensureLyricsOffline(track);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [authed, track?.id, trackInLibrary, track]);

  if (!authed) return <AuthScreen onAuthed={handleAuthed} T={T} />;

  const NAV = [
    { id:'home', label:'Inicio', I: Icon.Home }, { id:'search', label:'Buscar', I: Icon.Search },
    { id:'library', label:'Biblioteca', I: Icon.Lib }, { id:'profile', label:'Perfil', I: Icon.User },
  ];

  const playerProps = { track, playing, togglePlay, next, prev, time, dur, seek, vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved: track ? favs.includes(track.id) : false, toggleFav, T, loadingAudio, nextCover, prevCover };

  const TabContent = (
    <>
      {tab === 'home' && <HomeTab T={T} play={play} track={track} playing={playing} onMenu={setMenuTarget} onToggleFav={toggleFav} goMix={goMix} displayName={displayName} avatar={avatar} email={email} setTab={setTab} startAiDj={startAiDj} onboardPrefs={onboardPrefs} setOnboardPrefs={setOnboardPrefs} backendDown={backendDown} />}
      {tab === 'search' && <SearchTab T={T} play={play} addToTarget={setAddTarget} onMenu={setMenuTarget} onToggleFav={toggleFav} recentSearches={recentSearches} addSearch={addSearch} removeSearch={removeSearch} goArtist={goArtist} goAlbum={goAlbum} goMix={goMix} selecting={selecting} selection={selection} toggleSelect={toggleSelect} startSelection={startSelection} addToQueue={addToQueue} removeFromQueue={removeFromQueueToast} backendDown={backendDown} setTab={setTab} />}
      {tab === 'library' && <LibraryTab T={T} play={play} openPlaylist={openPlaylist} setOpenPlaylist={setOpenPlaylist} addToTarget={setAddTarget} onMenu={setMenuTarget} onToggleFav={toggleFav} downloadMany={downloadMany} goAlbum={goAlbum} goMix={goMix} selecting={selecting} selection={selection} toggleSelect={toggleSelect} startSelection={startSelection} addToQueue={addToQueue} removeFromQueue={removeFromQueueToast} setShowImport={setShowImport} hydrateTracks={hydrateTracks} createPlaylist={createPlaylist} removeFromPlaylist={removeFromPlaylist} deletePlaylist={deletePlaylist} savePlaylist={savePlaylist} unsavePlaylist={unsavePlaylist} />}
      {tab === 'profile' && <ProfileTab T={T} themeKey={themeKey} setThemeKey={setThemeKey} quality={quality} setQuality={setQuality} glow={glow} setGlow={setGlow} eq={eq} setEq={setEq} settings={settings} setSettings={setSettings} setOpenPlaylist={setOpenPlaylist} setTab={setTab} email={email} onLogout={onLogout} installApp={installApp} canInstall={!!installEvt} isIOS={isIOS} isStandalone={isStandalone} goWrapped={goWrapped} customPalettes={customPalettes} activeCustomId={activeCustomId} setActiveCustomId={setActiveCustomId} activePalette={activePalette} addPalette={addPalette} updatePalette={updatePalette} deletePalette={deletePalette} displayName={displayName} saveProfileName={saveProfileName} deleteAccount={deleteAccount} avatar={avatar} saveAvatar={saveAvatar} removeDownload={removeDownload} clearDownloads={clearDownloads} getDownloads={getDownloads} />}
    </>
  );
  const Content = view ? (view.type === 'wrapped' ? <WrappedView T={T} setView={setView} play={play} playStats={playStatsRef.current} /> : <DetailView view={view} T={T} play={play} addToTarget={setAddTarget} onMenu={setMenuTarget} onToggleFav={toggleFav} goArtist={goArtist} goAlbum={goAlbum} setView={setView} detailLoading={detailLoading} detailData={detailData} downloadMany={downloadMany} saveAlbum={saveAlbum} unsaveAlbum={unsaveAlbum} savePlaylist={savePlaylist} unsavePlaylist={unsavePlaylist} selecting={selecting} selection={selection} toggleSelect={toggleSelect} startSelection={startSelection} addToQueue={addToQueue} removeFromQueue={removeFromQueueToast} />) : TabContent;

  const audioEl = (
    <>
    <audio ref={audioRef} src={playSrc || undefined} preload="none"
      onTimeUpdate={audioHandlers.onTimeUpdate}
      onLoadedMetadata={audioHandlers.onLoadedMetadata}
      onCanPlay={audioHandlers.onCanPlay}
      onPlay={audioHandlers.onPlay}
      onPlaying={audioHandlers.onPlaying}
      onStalled={audioHandlers.onStalled}
      onWaiting={audioHandlers.onWaiting}
      onPause={audioHandlers.onPause}
      onError={handleAudioError}
      onEnded={audioHandlers.onEnded}
    />
      {/* Pre-buffer oculto de las siguientes 2 pistas (volume=0, nunca reproducen). */}
      {/* muted=true causa throttle agresivo en mobile; volume=0 es respetado sin throttling. */}
      {/* preload="metadata" (NO "auto"): con "auto" el navegador descargaba la */}
      {/* pista ENTERA (~3MB) de las 2 siguientes en paralelo; a través del túnel */}
      {/* del backend eso saturaba el ancho de banda y encolaba la resolución de */}
      {/* la pista que el usuario sí quería oír (arranques de 20s+). El resolve ya */}
      {/* se precalienta aparte (api.prefetchStream), así que basta con metadata */}
      {/* para un arranque rápido sin ahogar el túnel. */}
      <audio ref={preloadAudioRef} preload="metadata" style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }} aria-hidden="true" tabIndex={-1} />
      <audio ref={preloadAudio2Ref} preload="metadata" style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }} aria-hidden="true" tabIndex={-1} />
    </>
  );

  const expandedPlayer = (
    <ExpandedPlayer open={expanded} onClose={() => setExpanded(false)} {...playerProps} audioRef={audioRef}
      glow={glow} quality={quality} compact={!wide} desktop={wide} onAdd={setAddTarget} onMenu={setMenuTarget}
      onQueue={() => setShowQueue(true)} outputs={outputs} sinkId={sinkId} setOutput={setSinkId}
      lyricOffset={lyricOffset} setLyricOffset={setLyricOffset} inLibrary={trackInLibrary} />
  );
  const addModal = <AddToPlaylistModal trackId={addTarget} onClose={() => { setAddTarget(null); if (selecting) clearSelection(); }} playlists={playlists} createPlaylist={createPlaylist} addToPlaylist={addToPlaylist} removeFromPlaylist={removeFromPlaylist} T={T} />;
  const trackMenu = <TrackMenu trackId={menuTarget} onClose={() => setMenuTarget(null)} T={T} addToTarget={setAddTarget} onToggleFav={toggleFav} goArtist={goArtist} goAlbum={goAlbum} shareTrack={shareTrack} addToQueue={addToQueue} download={download} removeDownload={removeDownload} playingFrom={playingFrom} goToPlayingPlaylist={goToPlayingPlaylist} />;
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
          <main role="main" aria-label="Aplicación" style={{ flex:1, overflowY:'auto' }}>
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
        <main role="main" aria-label="Aplicación" style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'4px 18px 0', width:'100%', boxSizing:'border-box' }}>{Content}</main>

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
      <Toast msg={toast} T={T} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEVICE CHIP — salida de audio (auriculares / parlante)
