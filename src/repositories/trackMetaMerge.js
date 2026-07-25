export function slimTrackMetadata(t) {
  return {
    id: t.id,
    title: t.title || '',
    artist: t.artist || '',
    artistId: t.artistId || null,
    album: t.album || '',
    albumId: t.albumId || null,
    genre: t.genre || '',
    cover: t.cover || '',
    durationSeconds: t.durationSeconds || t.duration || 0,
  };
}

const mergeField = (value, previous, fallback) =>
  value !== '' && value !== null && value !== undefined ? value : (previous ?? fallback);

export function mergeTrackMetadata(previous, track) {
  const incoming = slimTrackMetadata(track);
  return {
    ...previous,
    id: incoming.id,
    title: mergeField(incoming.title, previous?.title, ''),
    artist: mergeField(incoming.artist, previous?.artist, ''),
    artistId: mergeField(incoming.artistId, previous?.artistId, null),
    album: mergeField(incoming.album, previous?.album, ''),
    albumId: mergeField(incoming.albumId, previous?.albumId, null),
    genre: mergeField(incoming.genre, previous?.genre, ''),
    cover: mergeField(incoming.cover, previous?.cover, ''),
    durationSeconds: incoming.durationSeconds > 0
      ? incoming.durationSeconds
      : (previous?.durationSeconds || 0),
  };
}
