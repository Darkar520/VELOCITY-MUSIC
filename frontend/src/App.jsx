import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api, isAuthed, setOnUnauthorized } from './api.js';
import * as offline from './offline.js';
import { isSpotifyUrl } from './spotifyImport.js';
import { CSS, THEMES, SEED_ROWS, LATIN_ROWS, DISCOVERY, GENRES, ONBOARDING_GENRES, MOODS, ERAS, FALLBACK_COVER, BASE_VARS } from './constants.js';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from './helpers.js';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack, bestCoverFor } from './catalog.js';
import {
  isDocumentVisible,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  shouldFadeIn,
  shouldSuspendPreloads,
  shouldPreExtendQueue,
  mediaSessionPlaybackState,
  isStreamUrlFresh,
} from './audioContinuity.js';
import { selectPlaySync } from './audio/audioMachine.js';
import { runAudioEffects, flushPendingSeek } from './audio/runAudioEffects.js';
import { usePersisted, useViewport, useDominantColor, useHSwipe } from './hooks.js';
import { useLibrarySync } from './hooks/useLibrarySync.js';
import { useHomeFeed } from './hooks/useHomeFeed.js';
import { useLibraryActions } from './hooks/useLibraryActions.js';
import { useDownloads } from './hooks/useDownloads.js';
import { usePlayerStoreBindings } from './hooks/usePlayerStoreBindings.js';
import { useLibraryStoreBindings } from './hooks/useLibraryStoreBindings.js';
import { usePlaybackController } from './hooks/usePlaybackController.js';
import { useLibraryStore } from './store/libraryStore.js';
import { usePlayerStore } from './store/playerStore.js';
import { Icon } from './Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from './components.jsx';
import { Avatar, PixelAvatar, AVATARS } from './avatars.jsx';
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
import { DeviceChip } from './player/DeviceChip.jsx';
import { AddToPlaylistModal } from './modals/AddToPlaylistModal.jsx';
import { ImportPlaylistModal } from './modals/ImportPlaylistModal.jsx';
import { ImportBanner } from './modals/ImportBanner.jsx';
import { ImportResultModal } from './modals/ImportResultModal.jsx';
import { TrackMenu } from './modals/TrackMenu.jsx';
import { Toast } from './modals/Toast.jsx';
import { parseTextPlaylist } from './import/parsePlaylist.js';

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
    remotePlaying, setRemotePlaying,
    downloaded, setDownloaded,
    downloading, setDownloading,
  } = usePlayerStoreBindings();
  const sseRef = useRef(null);
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
    favs, setFavs,
    playlists, setPlaylists,
    recent, setRecent,
    savedAlbums, setSavedAlbums,
    savedPlaylists, setSavedPlaylists,
    homeRows, homeLoading, setHomeRows,
    catVer, setCatVer,
  } = useLibraryStoreBindings();

  // Hook de sincronización con backend (reemplaza los 3 useEffect de biblio)
  useLibrarySync({ authed });

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

  const [showImport, setShowImport] = useState(false);
  const [importJob, setImportJob] = useState(null);

  const startImport = async (url) => {
    if (importJob && importJob.busy) return;
    const raw = String(url || '').trim();
    if (!raw) return;

    // Spotify API exige Premium: redirigir al flujo gratis (extractor + pegar lista).
    if (isSpotifyUrl(raw)) {
      showToast('Spotify: usa la pestaña «Spotify (gratis)» — sin pagar Premium.');
      setShowImport(true);
      return;
    }

    // YouTube / YouTube Music (flujo existente)
    setImportJob({ busy: true, current: 0, total: 0, progress: 0, name: 'Conectando...', playlistId: null, error: null });
    setShowImport(false);
    try {
      const data = await api.importPlaylist(raw);
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

  const nextTrackActionRef = useRef(() => {});
  const prevTrackActionRef = useRef(() => {});
  const audioHydratedRef = useRef(false);

  const setMediaSessionState = (state, positionHint) => {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = state; } catch {}
    if (positionHint != null && navigator.mediaSession.setPositionState) {
      try {
        const a = audioRef.current;
        const d = a && a.duration > 0 && isFinite(a.duration) ? a.duration : 0;
        if (d > 0) {
          navigator.mediaSession.setPositionState({
            duration: d,
            position: Math.min(Math.max(0, positionHint), d),
            playbackRate: 1,
          });
        }
      } catch {}
    }
  };

  // ── Playback controller: play/toggle/next/seek + dispatch unificado al store ──
  const {
    play, togglePlay, next, prev, seek,
    dispatchAudio, getMachine, patchMachine, syncMirrorsFromMachine,
    clearYieldedFocus, restoreInterruptPosition, applySessionResume,
    fadeInAudio, effectCtxRef, orderIds, nextCover, prevCover,
    addToQueue, reorderQueue, removeFromQueue, removeFromQueueToast, prefetchNext,
  } = usePlaybackController({
    audioRef, selfPauseRef, playingRef, fadeRafRef, fadeSafetyRef, pendingFadeRef,
    objUrlRef, queueRef, trackRef, radioRef, radioSeedRef, mixSessionRef,
    nextTrackActionRef, prevTrackActionRef, sessionResumeRef,
    systemPausedRef, interruptPositionRef, interruptTrackIdRef,
    quality, backendDown, downloaded, track, playing, time, vol, queue, shuffle,
    setTrack, setPlaying, setTime, setPlaySrc, setLoadingAudio, setMediaInterrupted,
    setQueue, setRecent, setPlayingFrom, showToast, recordPlayStat, setMediaSessionState,
  });
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

  // ── Re-persistir la caché al modificar biblioteca: lo maneja useLibrarySync ──
  // (antes había un useEffect acá que llamaba persistLibCache — eliminado por duplicación)

  // ── Feed personalizado: extraído a useHomeFeed (reduce ~190 líneas) ──
  // libReadyRef se pasa como booleano en cada render (App re-renderiza al hidratar lib).
  useHomeFeed({ authed, libReady: libReadyRef.current, downloaded, recentSearches, onboardPrefs });

  // ── Reanudar descargas pendientes al volver a la app ──
  useEffect(() => {
    if (!authed || resumedRef.current) return;
    const pend = [...pendingRef.current];
    if (pend.length) { resumedRef.current = true; setTimeout(() => downloadMany(pend), 1200); }
  }, [authed]);

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

  // ── Reanudación tras interrupción por vídeo / zombie silencioso ──
  // Solo en visible. No escribe ancla de yield (A10: no clavar posición).
  const forceReacquire = () => {
    if (!canForceReacquire(isDocumentVisible())) return;
    if (reacquireInFlight.current) return;
    const a = audioRef.current;
    if (!a || !playingRef.current || a.ended) return;
    reacquireInFlight.current = true;
    if (a.volume < vol * 0.5) a.volume = vol;
    const pin = Number.isFinite(a.currentTime) ? a.currentTime : 0;

    const p1 = a.play();
    if (p1 && p1.then) {
      p1.then(() => {
        // Si el browser rebobinó al re-play, reponer SOLO este pin local (no ancla global).
        try {
          if (pin > 1.25 && (a.currentTime || 0) < pin - 1.25) {
            a.currentTime = pin;
            setTime(pin);
          }
        } catch {}
        reacquireInFlight.current = false;
        clearYieldedFocus();
      }).catch(() => {
        selfPauseRef.current = true;
        try { a.pause(); } catch {}
        selfPauseRef.current = false;
        setTimeout(() => {
          if (!playingRef.current || !canForceReacquire(isDocumentVisible())) {
            reacquireInFlight.current = false;
            return;
          }
          const a2 = audioRef.current;
          if (!a2 || a2.ended) { reacquireInFlight.current = false; return; }
          if (a2.volume < vol * 0.5) a2.volume = vol;
          try { if (pin > 0) a2.currentTime = pin; } catch {}
          const p2 = a2.play();
          if (p2 && p2.then) {
            p2.then(() => {
              reacquireInFlight.current = false;
              clearYieldedFocus();
            }).catch(() => { reacquireInFlight.current = false; });
          } else { reacquireInFlight.current = false; }
        }, 100);
      });
    } else { reacquireInFlight.current = false; }
  };

  useEffect(() => {
    const tryResume = () => {
      const a = audioRef.current;
      if (!a) return;
      const timeStuck = lastTimeRef.current > 0
        && Math.abs((a.currentTime || 0) - lastTimeRef.current) < 0.05
        && (a.currentTime || 0) > 0.5
        && !a.paused;
      if (!shouldResumeOnForeground({
        userWantsPlay: getMachine().intent === 'play',
        audioEnded: a.ended,
        audioPaused: a.paused,
        volume: a.volume,
        targetVolume: vol,
        systemPaused: getMachine().focus === 'yielded',
        timeStuck,
      })) return;

      dispatchAudio({
        type: 'DOC_VISIBLE',
        currentTime: a.currentTime || 0,
      });
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(tryResume, 40);
        setTimeout(tryResume, 350);
        setTimeout(tryResume, 1000);
      } else {
        const a = audioRef.current;
        dispatchAudio({
          type: 'DOC_HIDDEN',
          position: a && Number.isFinite(a.currentTime) ? a.currentTime : undefined,
        });
        if (shouldSuspendPreloads(false)) {
          for (const r of [preloadAudioRef, preloadAudio2Ref]) {
            const el = r.current;
            if (!el) continue;
            try { el.removeAttribute('src'); el.load(); } catch {}
          }
        }
      }
    };
    const onFocus = () => {
      if (isDocumentVisible()) setTimeout(tryResume, 60);
    };
    const onPageShow = (e) => {
      if (e.persisted || isDocumentVisible()) setTimeout(tryResume, 60);
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);

    // Solo en foreground: zombie / pause residual (nunca pelear en background).
    stuckCheckRef.current = setInterval(() => {
      if (!isDocumentVisible()) return;
      const a = audioRef.current;
      if (!a || !playingRef.current || a.ended) { lastTimeRef.current = 0; return; }
      const ct = a.currentTime || 0;
      if (a.paused || systemPausedRef.current) {
        tryResume();
      } else if (lastTimeRef.current > 0 && Math.abs(ct - lastTimeRef.current) < 0.05 && ct > 0.5) {
        if (a.volume < vol * 0.5) a.volume = vol;
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
  // Última O penúltima pista → anexar relacionadas YA (en primer plano),
  // para que onEnded/next() sea síncrono con pantalla bloqueada.
  const autoExtendRef = useRef(null);
  useEffect(() => {
    if (!track || !settings.autoplay) return;
    const ids = queue.length ? queue : [track.id];
    const i = ids.indexOf(track.id);
    if (!shouldPreExtendQueue(i, ids.length)) return;
    // Clave por pista+longitud para re-extender si la cola creció y volvemos al final.
    const key = `${track.id}:${ids.length}`;
    if (autoExtendRef.current === key) return;
    autoExtendRef.current = key;
    (async () => {
      try {
        const addIds = await buildContinuation(track, ids);
        if (!addIds.length) return;
        setQueue(q => {
          const base = q && q.length ? q : [track.id];
          const merged = [...base];
          addIds.forEach(id => { if (!merged.includes(id)) merged.push(id); });
          return merged;
        });
      } catch {}
    })();
  }, [track?.id, queue, settings.autoplay]);

  // ── Media Session: posición en notificación ──
  // Durante interrupción por vídeo: congelar en interruptPosition (no “contar” segundos).
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!(dur > 0 && isFinite(dur))) return;
    const pos = mediaInterrupted && interruptPositionRef.current != null
      ? interruptPositionRef.current
      : time;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(Math.max(0, pos), dur),
        playbackRate: 1,
      });
    } catch {}
  }, [time, dur, mediaInterrupted]);
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
  // ── Acciones de biblioteca (fav, playlist, albums, mixes): extraídas a useLibraryActions ──
  const {
    toggleFav, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist,
    isAlbumSaved, saveAlbum, unsaveAlbum,
    isPlaylistSaved, savePlaylist, unsavePlaylist,
  } = useLibraryActions({ authed, showToast });

  // Búsquedas recientes (UI local, no libraryStore)
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
    // Fallback de búsqueda: solo pistas cuyo artista coincida (evita basura genérica).
    const filterArtistTracks = (raw, artistName) => {
      const key = String(artistName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const tracks = dedupeByTitle(raw.map(normalizeTrack));
      if (!key) return tracks;
      const own = tracks.filter((t) => {
        const a = String(t.artist || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return a === key || a.startsWith(key + ' ') || a.includes(key) || key.includes(a);
      });
      return own.length ? own : tracks.slice(0, 8);
    };
    const fallback = () => api.search(name).then((raw) => setDetailData({ type:'artist', name, topSongs: filterArtistTracks(raw, name), albums: [] })).catch(() => {});
    if (!artistId) { fallback().finally(() => setDetailLoading(false)); return; }
    api.artist(artistId)
      .then((d) => {
        const artistName = d.name || name;
        // Cinturón y tirantes: filtrar en cliente por si el backend devuelve algo ajeno.
        const songs = dedupeByTitle((d.topSongs || []).map(normalizeTrack)).filter((t) => {
          if (!artistName) return true;
          const key = String(artistName).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const a = String(t.artist || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return !a || a === key || a.startsWith(key + ' ') || a.includes(key) || key.includes(a);
        });
        setDetailData({ type:'artist', name: artistName, thumbnail: d.thumbnail, topSongs: songs, albums: d.albums || [] });
      })
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
    setExpanded(false); setView({ type:'album', albumId, name, artist, cover });
    setDetailData(null); setDetailLoading(true);

    const applyTracks = (meta, tracks, { offline: isOff = false } = {}) => {
      const albumCover = meta.cover || cover || tracks.find((t) => t.cover)?.cover || '';
      const list = (tracks || []).map((t) => {
        // En vista de álbum: forzar SIEMPRE la portada del álbum, ignorando
        // artworkUrl propio del track (que YTM a veces es thumbnail de video).
        const n = normalizeTrack({ ...t, artworkUrl: albumCover, cover: albumCover });
        cacheTrack(n);
        return n;
      });
      if (!list.length) return false;
      setDetailData({
        type: 'album',
        albumId: meta.albumId || albumId,
        name: meta.name || name,
        artist: meta.artist || artist,
        artistId: meta.artistId,
        cover: albumCover,
        year: meta.year,
        tracks: list,
        offline: isOff || undefined,
      });
      return true;
    };

    const offlineFallback = async (aid, aName, aArtist, aCover) => {
      try {
        const metas = await offline.listMetas();
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const tracks = metas
          .filter((m) => m && (
            (aid && m.albumId === aid)
            || (aName && norm(m.album) === norm(aName))
          ))
          .map(normalizeTrack);
        if (!tracks.length) return false;
        return applyTracks({ name: aName, artist: aArtist, cover: aCover, albumId: aid }, tracks, { offline: true });
      } catch { return false; }
    };

    // Canciones ya en catálogo local (guardadas al ver el álbum antes).
    const catalogFallback = (aid, aName) => {
      const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const all = allCached();
      const tracks = all.filter((t) => (
        (aid && t.albumId === aid)
        || (aName && norm(t.album) === norm(aName) && (!artist || norm(t.artist).includes(norm(artist))))
      ));
      if (tracks.length < 2) return false;
      return applyTracks({ albumId: aid, name: aName, artist, cover }, tracks);
    };

    const searchFallback = async (aName, aArtist) => {
      const q = `${aName || ''} ${aArtist || ''}`.trim();
      if (!q) return false;
      const r = await api.searchAll(q).catch(() => null);
      let songs = (r?.songs || []).map(normalizeTrack);
      if (!songs.length) {
        const raw = await api.search(q).catch(() => []);
        songs = raw.map(normalizeTrack);
      }
      const norm = (s) => (s || '').toLowerCase();
      // Preferir pistas del mismo álbum/artista
      let tracks = songs.filter((t) => (
        (aName && norm(t.album) === norm(aName))
        || (aArtist && norm(t.artist).includes(norm(aArtist)) && aName && norm(t.title + t.album).includes(norm(aName).slice(0, 12)))
      ));
      if (tracks.length < 3) tracks = songs.filter((t) => aArtist && norm(t.artist).includes(norm(aArtist)));
      if (tracks.length < 2) tracks = songs.slice(0, 20);
      if (!tracks.length) return false;
      const albId = tracks.find((t) => t.albumId)?.albumId || albumId;
      return applyTracks({
        albumId: albId,
        name: aName,
        artist: aArtist,
        cover: cover || tracks[0]?.cover,
      }, tracks);
    };

    const loadAlbumApi = async (aid) => {
      const d = await api.album(aid);
      const albumCover = d.cover || cover || '';
      const tracks = (d.tracks || []).map((t) => normalizeTrack({
        ...t,
        // En vista álbum: forzar portada del álbum, no thumbnail de video
        artworkUrl: albumCover,
        cover: albumCover,
      }));
      if (!tracks.length) return false;
      return applyTracks({
        albumId: aid,
        name: d.name || name,
        artist: d.artist || artist,
        artistId: d.artistId,
        cover: albumCover,
        year: d.year,
      }, tracks);
    };

    (async () => {
      try {
        let aid = albumId;
        if (!aid) {
          const r = await api.searchAll(`${name} ${artist || ''}`.trim()).catch(() => null);
          aid = r?.albums?.[0]?.albumId
            || (r?.songs || []).map(normalizeTrack).find((t) => t.albumId)?.albumId
            || null;
          if (!aid) {
            const raw = await api.search(`${songTitle || name} ${artist || ''}`.trim()).catch(() => []);
            aid = raw.map(normalizeTrack).find((t) => t.albumId)?.albumId || null;
          }
        }
        let ok = false;
        if (aid) {
          try { ok = await loadAlbumApi(aid); } catch { ok = false; }
        }
        // API vacía/502 → catálogo → búsqueda → offline (antes: 0 canciones)
        if (!ok) ok = catalogFallback(aid || albumId, name);
        if (!ok) ok = await searchFallback(name, artist);
        if (!ok) ok = await offlineFallback(aid || albumId, name, artist, cover);
        if (!ok) setDetailData({ type: 'album', name, artist, cover, tracks: [], none: true });
      } catch {
        let ok = catalogFallback(albumId, name);
        if (!ok) ok = await searchFallback(name, artist);
        if (!ok) ok = await offlineFallback(albumId, name, artist, cover);
        if (!ok) setDetailData({ type: 'album', name, artist, cover, tracks: [], none: true });
      } finally {
        setDetailLoading(false);
      }
    })();
  };
  const shareTrack = (t) => {
    const url = `https://velocity.music/track/${t.id}`;
    if (navigator.share) navigator.share({ title:t.title, text:`${t.title} — ${t.artist}`, url }).catch(()=>{});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado')).catch(() => showToast('No se pudo copiar'));
    else showToast(url);
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
    const doPlay = () => {
      const el = a();
      if (!el) return;
      if (el.volume < vol * 0.5) el.volume = vol;
      if (getMachine().trackId) {
        dispatchAudio({ type: 'USER_PLAY' });
      } else if (track?.id) {
        dispatchAudio({ type: 'TRACK_SET', trackId: track.id, intent: 'play' });
      }
    };
    const doPause = () => {
      dispatchAudio({ type: 'USER_PAUSE' });
    };
    navigator.mediaSession.setActionHandler('play', doPlay);
    navigator.mediaSession.setActionHandler('pause', doPause);
    // Refs estables: next/prev siempre al día aunque el efecto no se re-bindee.
    navigator.mediaSession.setActionHandler('previoustrack', () => { try { prevTrackActionRef.current(); } catch {} });
    navigator.mediaSession.setActionHandler('nexttrack', () => { try { nextTrackActionRef.current(); } catch {} });
    try { navigator.mediaSession.setActionHandler('seekto', (e) => { if (e.seekTime != null) seek(e.seekTime); }); } catch {}
    try { navigator.mediaSession.setActionHandler('seekforward', () => { try { nextTrackActionRef.current(); } catch {} }); } catch {}
    try { navigator.mediaSession.setActionHandler('seekbackward', () => { try { prevTrackActionRef.current(); } catch {} }); } catch {}
    try { navigator.mediaSession.setActionHandler('stop', () => doPause()); } catch {}
    return () => {
      cancelled = true;
      ['play','pause','previoustrack','nexttrack','seekto','seekforward','seekbackward','stop'].forEach(act => {
        try { navigator.mediaSession.setActionHandler(act, null); } catch {}
      });
    };
  }, [track, playing]);

  // Media Session: en interrupción por vídeo = paused (aunque la intención sea play).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = mediaSessionPlaybackState({
        userWantsPlay: playing,
        yieldedFocus: mediaInterrupted,
      });
    } catch {}
  }, [playing, mediaInterrupted]);

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

  // Letra: se MUESTRA en cualquier pista (ExpandedPlayer online).
  // Offline (IDB) solo biblioteca — backfill al reproducir si ya está en Me gusta /
  // playlist / mezcla. El pack principal se dispara al AÑADIR (useLibraryActions).
  const trackInLibrary = Boolean(track && (
    favs.includes(track.id)
    || playlists.some((p) => (p.trackIds || []).includes(track.id))
    || (savedPlaylists || []).some((p) => (p.trackIds || []).includes(track.id))
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
      {tab === 'home' && <HomeTab T={T} play={play} track={track} playing={playing} onMenu={setMenuTarget} goMix={goMix} displayName={displayName} avatar={avatar} email={email} setTab={setTab} startAiDj={startAiDj} onboardPrefs={onboardPrefs} setOnboardPrefs={setOnboardPrefs} backendDown={backendDown} />}
      {tab === 'search' && <SearchTab T={T} play={play} addToTarget={setAddTarget} onMenu={setMenuTarget} recentSearches={recentSearches} addSearch={addSearch} removeSearch={removeSearch} goArtist={goArtist} goAlbum={goAlbum} goMix={goMix} selecting={selecting} selection={selection} toggleSelect={toggleSelect} startSelection={startSelection} addToQueue={addToQueue} removeFromQueue={removeFromQueueToast} backendDown={backendDown} setTab={setTab} />}
      {tab === 'library' && <LibraryTab T={T} play={play} openPlaylist={openPlaylist} setOpenPlaylist={setOpenPlaylist} addToTarget={setAddTarget} onMenu={setMenuTarget} downloadMany={downloadMany} goAlbum={goAlbum} goMix={goMix} selecting={selecting} selection={selection} toggleSelect={toggleSelect} startSelection={startSelection} addToQueue={addToQueue} removeFromQueue={removeFromQueueToast} setShowImport={setShowImport} hydrateTracks={hydrateTracks} createPlaylist={createPlaylist} removeFromPlaylist={removeFromPlaylist} deletePlaylist={deletePlaylist} savePlaylist={savePlaylist} unsavePlaylist={unsavePlaylist} />}
      {tab === 'profile' && <ProfileTab T={T} themeKey={themeKey} setThemeKey={setThemeKey} quality={quality} setQuality={setQuality} glow={glow} setGlow={setGlow} eq={eq} setEq={setEq} settings={settings} setSettings={setSettings} setOpenPlaylist={setOpenPlaylist} setTab={setTab} email={email} onLogout={onLogout} installApp={installApp} canInstall={!!installEvt} isIOS={isIOS} isStandalone={isStandalone} goWrapped={goWrapped} customPalettes={customPalettes} activeCustomId={activeCustomId} setActiveCustomId={setActiveCustomId} activePalette={activePalette} addPalette={addPalette} updatePalette={updatePalette} deletePalette={deletePalette} displayName={displayName} saveProfileName={saveProfileName} deleteAccount={deleteAccount} avatar={avatar} saveAvatar={saveAvatar} removeDownload={removeDownload} clearDownloads={clearDownloads} getDownloads={getDownloads} />}
    </>
  );
  const Content = view ? (view.type === 'wrapped' ? <WrappedView T={T} setView={setView} play={play} playStats={playStatsRef.current} /> : <DetailView view={view} T={T} play={play} addToTarget={setAddTarget} onMenu={setMenuTarget} goArtist={goArtist} goAlbum={goAlbum} setView={setView} detailLoading={detailLoading} detailData={detailData} downloadMany={downloadMany} saveAlbum={saveAlbum} unsaveAlbum={unsaveAlbum} savePlaylist={savePlaylist} unsavePlaylist={unsavePlaylist} selecting={selecting} selection={selection} toggleSelect={toggleSelect} startSelection={startSelection} addToQueue={addToQueue} removeFromQueue={removeFromQueueToast} />) : TabContent;

  // Manejo resiliente de errores de reproducción: reintenta una vez con URL
  // fresca (evade caché de borde) y, si vuelve a fallar, salta a la siguiente
  // pista de la cola en lugar de detener todo. Reduce al máximo los cortes.
  const MAX_PLAY_RETRIES = 6;
  const handleAudioError = () => {
    // Ignorar errores al vaciar src o sin URL real (cambio de pista).
    if (effectCtxRef.current?._suppressAudioError) return;
    const a = audioRef.current;
    const rawSrc = (a?.currentSrc || a?.getAttribute?.('src') || a?.src || '').trim();
    if (!a || !rawSrc || rawSrc === (typeof location !== 'undefined' ? location.href : '')) return;
    // 401 del proxy llega como error de media; reintentar con firma fresca (abajo).

    selfPauseRef.current = false;
    const cur = track?.id;
    if (!cur) {
      dispatchAudio({ type: 'PLAY_FAILED', reason: 'no-el' });
      return;
    }
    // A13: sin intención de play → machine limpia, no auto-play.
    if (getMachine().intent !== 'play') {
      dispatchAudio({ type: 'PLAY_FAILED', reason: 'stale' });
      playErrorRef.current = { id: null, n: 0 };
      return;
    }
    const st = playErrorRef.current;
    const n = (st.id === cur) ? st.n : 0;
    const isBlob = typeof a.currentSrc === 'string' && a.currentSrc.startsWith('blob:');
    // Reintentos solo con intención de play. 6 intentos con espera creciente.
    if (n < MAX_PLAY_RETRIES && !isBlob) {
      const attempt = n + 1;
      playErrorRef.current = { id: cur, n: attempt };
      setLoadingAudio(true);
      // Primeros reintentos rápidos (resolve yt-dlp a veces falla a la 1ª).
      const delays = [400, 900, 1800, 3500, 7000, 12000];
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      setTimeout(async () => {
        if (!audioRef.current || trackRef.current?.id !== cur) return;
        if (!playingRef.current) { setLoadingAudio(false); return; }
        try {
          const q = ({ high:'high', medium:'medium', low:'low', HQ:'high', Standard:'medium', FLAC:'low' }[quality] || 'high');
          const tk = trackRef.current || track;
          if (attempt >= 1) api._streamSignCache?.clear?.();
          const sp = {
            artist: tk.artist, title: tk.title, id: tk.id, quality: q,
            stream: (tk.source === 'soundcloud' && tk.stream) ? tk.stream : undefined,
          };
          // forceRefresh vía resolve al 2º+ intento (prefetch limpia caché mala).
          if (attempt >= 2) await api.prefetchStream(sp);
          const base = await api.ensureStreamUrl(sp);
          if (!playingRef.current || trackRef.current?.id !== cur) { setLoadingAudio(false); return; }
          const url = attempt >= 2 ? (base + (base.includes('?') ? '&' : '?') + '_r=' + Date.now()) : base;
          audioRef.current.src = url;
          setPlaySrc(url);
          audioRef.current.load();
          const p = audioRef.current.play(); if (p && p.catch) p.catch(() => {});
        } catch {
          if (!playingRef.current) setLoadingAudio(false);
        }
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
    <audio ref={audioRef} src={playSrc || undefined} preload="none"
      onTimeUpdate={() => {
        const a = audioRef.current; if (!a) return;
        // Solo congelar reloj si la interrupción por vídeo está CONFIRMADA y sigue pausado.
        if ((systemPausedRef.current || mediaInterrupted) && a.paused) return;
        const ct = a.currentTime || 0; setTime(ct);
        if (ct > 0 && loadingAudio) setLoadingAudio(false);
      }}
      onLoadedMetadata={() => {
        setDur(audioRef.current?.duration || 0);
        flushPendingSeek(effectCtxRef.current);
        applySessionResume(audioRef.current);
      }}
      onCanPlay={() => {
        setLoadingAudio(false);
        flushPendingSeek(effectCtxRef.current);
        applySessionResume(audioRef.current);
      }}
      onPlay={() => {
        selfPauseRef.current = false;
        const el = audioRef.current;
        if (getMachine().intent !== 'play') {
          selfPauseRef.current = true;
          try { el?.pause(); } catch {}
          selfPauseRef.current = false;
          setLoadingAudio(false);
          return;
        }
        flushPendingSeek(effectCtxRef.current);
        applySessionResume(el);
        restoreInterruptPosition(el);
        if (el && el.volume < vol * 0.5) el.volume = vol;
        setMediaSessionState('playing', el?.currentTime);
        setLoadingAudio(false);
        if (!playing) setPlaying(true);
      }}
      onPlaying={() => {
        selfPauseRef.current = false;
        const el = audioRef.current;
        if (getMachine().intent !== 'play') {
          selfPauseRef.current = true;
          try { el?.pause(); } catch {}
          selfPauseRef.current = false;
          setLoadingAudio(false);
          return;
        }
        flushPendingSeek(effectCtxRef.current);
        applySessionResume(el);
        if (el && el.volume < vol * 0.5) el.volume = vol;
        dispatchAudio({
          type: 'PLAYING',
          position: el?.currentTime || 0,
          trackId: getMachine().trackId || trackRef.current?.id || undefined,
        });
        playErrorRef.current = { id: null, n: 0 };
        sustainedPlayRef.current = false;
        setTimeout(() => {
          if (audioRef.current && !audioRef.current.paused && audioRef.current.currentTime > 3) {
            consecutiveFailsRef.current = 0;
            sustainedPlayRef.current = true;
          }
        }, 5000);
        if (pendingFadeRef.current) {
          pendingFadeRef.current = false;
          if (isDocumentVisible()) fadeInAudio();
          else if (audioRef.current) audioRef.current.volume = vol;
        }
      }}
      onStalled={() => { if (playingRef.current) setLoadingAudio(true); }}
      onWaiting={() => { if (playingRef.current) setLoadingAudio(true); }}
      onPause={() => {
        const a = audioRef.current;
        if (!a) return;
        if (getMachine().intent !== 'play') {
          setLoadingAudio(false);
          return;
        }
        if (!isExternalPause({
          selfPause: selfPauseRef.current,
          pendingFade: pendingFadeRef.current,
          userWantsPlay: getMachine().intent === 'play',
          audioEnded: a.ended,
        })) return;

        dispatchAudio({
          type: 'EXTERNAL_PAUSE',
          hidden: !isDocumentVisible(),
          selfPause: selfPauseRef.current,
          position: a.currentTime || 0,
        });
      }}
      onError={handleAudioError}
      onEnded={() => {
        dispatchAudio({ type: 'ENDED' });
        onEnded();
      }}
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
      lyricOffset={lyricOffset} setLyricOffset={setLyricOffset} inLibrary={trackInLibrary} />
  );
  const addModal = <AddToPlaylistModal trackId={addTarget} onClose={() => { setAddTarget(null); if (selecting) clearSelection(); }} playlists={playlists} createPlaylist={createPlaylist} addToPlaylist={addToPlaylist} removeFromPlaylist={removeFromPlaylist} T={T} />;
  const trackMenu = <TrackMenu trackId={menuTarget} onClose={() => setMenuTarget(null)} T={T} addToTarget={setAddTarget} goArtist={goArtist} goAlbum={goAlbum} shareTrack={shareTrack} addToQueue={addToQueue} download={download} removeDownload={removeDownload} playingFrom={playingFrom} goToPlayingPlaylist={goToPlayingPlaylist} />;
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
