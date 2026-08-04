/**
 * uiFixtures.js — utilidades compartidas por los tests de UI/componentes.
 *
 * Los componentes hoja leen del playerStore/libraryStore y del catálogo
 * (catalog.js, Map en memoria). Estos helpers preparan un estado determinista
 * sin tocar red ni DOM real.
 */
import { usePlayerStore } from '../store/playerStore.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { cacheTrack } from '../catalog.js';

/** Theme mínimo que consumen todos los componentes (accent/accent2). */
export const T = { name: 'Test', accent: '#10d9a0', accent2: '#00ffa3' };

/** Pista de prueba con carátula HTTPS real (no data:, para no chocar con saveMeta). */
export function makeTrack(over = {}) {
  return {
    id: 't1',
    title: 'Toxicity',
    artist: 'System of a Down',
    album: 'Toxicity',
    albumId: 'ALB1',
    artistId: 'ART1',
    cover: 'https://lh3.googleusercontent.com/cover=w544-h544',
    durationSeconds: 200,
    url: '/api/stream-proxy?artist=System+of+a+Down&title=Toxicity&exp=1&sig=x',
    ...over,
  };
}

/** Cachea pistas en catalog.js para que trackById las resuelva. */
export function seedCatalog(tracks) {
  for (const t of tracks) cacheTrack(t);
  return tracks;
}

/**
 * Deja ambos stores en un estado base conocido.
 * No usa setEffectHandler (API legacy): los tests de UI no dispatchan audio.
 */
export function resetStores() {
  useLibraryStore.getState().reset();
  usePlayerStore.setState({
    track: null,
    playing: false,
    time: 0,
    duration: 0,
    queue: [],
    volume: 1,
    shuffle: false,
    repeat: false,
    expanded: false,
    loadingAudio: false,
    playSrc: null,
    mediaInterrupted: false,
    downloaded: new Set(),
    downloading: new Set(),
  });
}

/** Estado de player con una pista sonando y cola. */
export function seedPlaying({ track = makeTrack(), queue = [track.id], playing = true } = {}) {
  seedCatalog([track]);
  usePlayerStore.setState({ track, playing, queue, time: 30, duration: 200 });
  return track;
}
