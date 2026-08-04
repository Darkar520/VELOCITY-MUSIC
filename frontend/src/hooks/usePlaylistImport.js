/**
 * usePlaylistImport — importación de playlists (YouTube/YT Music por URL y
 * pegado de lista en texto plano, que es el camino gratis para Spotify).
 *
 * Extraído de App.jsx sin cambio de comportamiento. Detalles que se conservan:
 *  - Spotify por URL exige Premium en su API: se redirige al flujo gratis
 *    (pestaña "Spotify (gratis)") en lugar de fallar.
 *  - Un solo trabajo a la vez (`importJob.busy` actúa de cerrojo).
 *  - El progreso se publica pista a pista para que ImportBanner lo refleje.
 *  - Al terminar se rehidratan las playlists desde el backend (con sus trackIds)
 *    para que la biblioteca quede consistente sin recargar.
 */
import { useState } from 'react';
import { api } from '../api.js';
import { isSpotifyUrl } from '../spotifyImport.js';
import { saveMeta, normalizeTrack } from '../catalog.js';
import { parseTextPlaylist } from '../import/parsePlaylist.js';

export function usePlaylistImport({ showToast, setPlaylists, setOpenPlaylist, setTab }) {
  const [showImport, setShowImport] = useState(false);
  const [importJob, setImportJob] = useState(null);

  /** Rehidrata las playlists (con trackIds) tras una importación. */
  const refreshPlaylists = async () => {
    const pls = await api.playlists().catch(() => null);
    if (!pls) return;
    const withTracks = await Promise.all(pls.map(async p => {
      const ids = await api.playlistTracks(p.id).catch(() => []);
      return { id: p.id, name: p.name, trackIds: ids };
    }));
    setPlaylists(withTracks);
  };

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

      await refreshPlaylists();

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
            statusText: `Buscando "${item.title} - ${item.artist}"...`,
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
            statusText: `Completado ${current}/${parsedTracks.length}`,
          };
        });
      }

      await refreshPlaylists();

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

  return {
    showImport, setShowImport,
    importJob, setImportJob,
    startImport, startImportText, openImportedPlaylist,
  };
}

export default usePlaylistImport;
