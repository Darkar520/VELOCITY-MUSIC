// ytmusic-api 5.x can mistake playlist carousels for similar artists. Read
// actual artist cards by browse ID; VLR/playlist IDs are never artist profiles.
export function artistCards(data) {
  const cards = [], seen = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    const row = value.musicTwoRowItemRenderer;
    const id = row?.navigationEndpoint?.browseEndpoint?.browseId;
    const name = row?.title?.runs?.map(run => run.text || '').join('');
    if (/^UC[\w-]+$/.test(id || '') && name && !seen.has(id)) {
      seen.add(id);
      cards.push({ artistId: id, name, thumbnails: row.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [] });
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  };
  walk(data);
  return cards;
}

export async function verifiedArtistProfile(client, id) {
  const profile = await client.getArtist(id);
  const valid = (profile.similarArtists || []).filter(artist => /^UC/.test(artist.artistId || ''));
  if (valid.length || typeof client.constructRequest !== 'function') return { ...profile, similarArtists: valid };
  try {
    const data = await client.constructRequest('browse', { browseId: id });
    return { ...profile, similarArtists: artistCards(data).filter(artist => artist.artistId !== id) };
  } catch { return { ...profile, similarArtists: [] }; }
}
