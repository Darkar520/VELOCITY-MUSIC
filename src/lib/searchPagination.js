// YouTube Music search filters and renderer parsing shared by first and later pages.
export const SEARCH_FILTERS = Object.freeze({
  songs: 'Eg-KAQwIARAAGAAgACgAMABqChAEEAMQCRAFEAo=',
  albums: 'Eg-KAQwIABAAGAEgACgAMABqChAEEAMQCRAFEAo=',
  artists: 'Eg-KAQwIABAAGAAgASgAMABqChAEEAMQCRAFEAo=',
});

const textOf = (renderer) => (renderer?.runs || []).map((run) => run.text || '').join('').trim();
const browseIdOf = (renderer) => renderer?.navigationEndpoint?.browseEndpoint?.browseId || null;
const thumbnailsOf = (renderer) => renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
const columnsOf = (item) => (item?.musicResponsiveListItemRenderer?.flexColumns || [])
  .map((column) => column?.musicResponsiveListItemFlexColumnRenderer?.text);
const rendererOf = (item) => item?.musicResponsiveListItemRenderer || item?.musicTwoRowItemRenderer || item;

function findRenderer(root, name) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value[name]) return value[name];
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }
  return null;
}

function continuationOf(data) {
  const roots = [data?.continuationContents?.musicShelfContinuation, findRenderer(data, 'musicShelfRenderer'), data?.musicShelfRenderer];
  for (const root of roots) {
    for (const continuation of root?.continuations || []) {
      const token = continuation?.nextContinuationData?.continuation
        || continuation?.nextRadioContinuationData?.continuation
        || continuation?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) return token;
    }
  }
  return null;
}

export function parseSearchRows(data, type) {
  const shelf = data?.continuationContents?.musicShelfContinuation || findRenderer(data, 'musicShelfRenderer') || data?.musicShelfRenderer;
  const rows = shelf?.contents || [];
  const results = [];
  for (const row of rows) {
    const renderer = rendererOf(row);
    const columns = columnsOf(row);
    const title = textOf(columns[0]) || textOf(renderer?.title);
    if (!title) continue;
    if (type === 'songs') {
      const runs = columns.flatMap((column) => column?.runs || []);
      const artists = runs.map((run) => ({ name: run.text?.trim(), artistId: run.navigationEndpoint?.browseEndpoint?.browseId }))
        .filter((artist) => artist.name && artist.artistId?.startsWith('UC'));
      const albumRun = runs.find((run) => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'));
      const videoId = renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
        || renderer?.navigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId) continue;
      const durationText = runs.map((run) => run.text).find((value) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value || ''));
      const duration = durationText ? durationText.split(':').reverse().reduce((total, part, index) => total + Number(part) * (60 ** index), 0) : null;
      results.push({ videoId, name: title, artists, album: albumRun ? { albumId: albumRun.navigationEndpoint.browseEndpoint.browseId, name: albumRun.text } : null, duration, thumbnails: thumbnailsOf(renderer) });
    } else if (type === 'albums') {
      const albumId = browseIdOf(renderer);
      if (!albumId) continue;
      const runs = columns.flatMap((column) => column?.runs || renderer?.subtitle?.runs || []);
      const artistRun = runs.find((run) => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
      const year = runs.map((run) => run.text).find((value) => /^\d{4}$/.test(value || ''));
      results.push({ albumId, name: title, artist: artistRun ? { name: artistRun.text, artistId: artistRun.navigationEndpoint.browseEndpoint.browseId } : null, year: year ? Number(year) : null, thumbnails: thumbnailsOf(renderer) });
    } else if (type === 'artists') {
      const artistId = browseIdOf(renderer);
      if (artistId) results.push({ artistId, name: title, thumbnails: thumbnailsOf(renderer) });
    }
  }
  return { results, continuation: continuationOf(data) };
}
