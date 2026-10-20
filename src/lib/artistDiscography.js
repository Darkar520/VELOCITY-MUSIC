import { normalizeText } from './normalize.js';

const runsText = (value) => Array.isArray(value?.runs)
  ? value.runs.map((run) => run?.text || '').join('').trim()
  : '';

function albumCard(item, artistName) {
  const endpoint = item?.navigationEndpoint?.browseEndpoint
    || item?.title?.runs?.find((run) => run?.navigationEndpoint?.browseEndpoint)?.navigationEndpoint?.browseEndpoint;
  const albumId = endpoint?.browseId;
  const name = runsText(item?.title) || item?.title?.accessibilityData?.accessibilityData?.label || '';
  if (!/^MPREb_[\w-]+$/.test(albumId || '') || !name) return null;
  const subtitle = runsText(item?.subtitle);
  const yearMatch = subtitle.match(/\b(19|20)\d{2}\b/);
  const thumbnails = item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  return {
    albumId,
    name,
    artist: { name: artistName },
    year: yearMatch ? Number(yearMatch[0]) : null,
    thumbnails: Array.isArray(thumbnails) ? thumbnails : [],
  };
}
/** Maps only album cards from an artist's actual Albums/Singles shelf response. */
export function mapArtistDiscographyItems(items, artistName) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => albumCard(item?.musicTwoRowItemRenderer || item, artistName))
    .filter((album) => {
      if (!album || seen.has(album.albumId)) return false;
      seen.add(album.albumId);
      return true;
    });
}

/** Pulls category shelves and their real browse endpoints from an artist page. */
export function artistDiscographyEndpoints(page) {
  const sections = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    ?.content?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return [];
  const wanted = new Set(['albums', 'singles & eps']);
  return sections.flatMap((section) => {
    const shelf = section?.musicCarouselShelfRenderer;
    if (!shelf) return [];
    const header = shelf.header?.musicCarouselShelfBasicHeaderRenderer;
    const label = normalizeText(runsText(header?.title));
    if (!wanted.has(label)) return [];
    const endpoint = header?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint
      || header?.title?.runs?.find((run) => run?.navigationEndpoint?.browseEndpoint)?.navigationEndpoint?.browseEndpoint;
    return endpoint?.browseId ? [{ label, endpoint }] : [];
  });
}

/** Extract two-row album cards from the artist-discography browse response. */
export function artistDiscographyCards(page) {
  const sections = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    ?.content?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => {
    const contents = section?.musicShelfRenderer?.contents
      || section?.musicCarouselShelfRenderer?.contents
      || section?.gridRenderer?.items;
    return Array.isArray(contents) ? contents.filter((item) => item?.musicTwoRowItemRenderer) : [];
  });
}

export function artistTopSongsEndpoint(page) {
  const sections = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    ?.content?.sectionListRenderer?.contents;
  const shelf = Array.isArray(sections) ? sections.find((section) => {
    const title = runsText(section?.musicShelfRenderer?.title);
    return normalizeText(title) === 'top songs';
  })?.musicShelfRenderer : null;
  return shelf?.title?.runs?.find((run) => run?.navigationEndpoint?.browseEndpoint)
    ?.navigationEndpoint?.browseEndpoint || null;
}

export function artistTopSongsItems(page) {
  const sections = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    ?.content?.sectionListRenderer?.contents;
  const shelf = Array.isArray(sections) ? sections.find((section) => section?.musicPlaylistShelfRenderer)?.musicPlaylistShelfRenderer : null;
  return Array.isArray(shelf?.contents)
    ? shelf.contents.filter((item) => item?.musicResponsiveListItemRenderer)
    : [];
}

/** Maps the artist's catalog-owned Top songs shelf without parser side effects. */
export function mapArtistTopSongs(items, artistId, artistName) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((entry) => {
    const item = entry?.musicResponsiveListItemRenderer || entry;
    const videoId = item?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const columns = item?.flexColumns || [];
    const title = runsText(columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
    if (!videoId || !title || seen.has(videoId)) return [];
    seen.add(videoId);
    const albumRun = columns.map((column) => column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
      .flat().find((run) => run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPREb_'));
    const albumTitle = albumRun?.text || null;
    const duration = item?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || null;
    const thumbnails = item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const cover = thumbnails.at(-1)?.url || null;
    return [{
      id: videoId,
      title,
      artist: artistName,
      artistId,
      album: albumTitle,
      albumId: albumRun?.navigationEndpoint?.browseEndpoint?.browseId || null,
      durationSeconds: duration,
      cover,
      artworkUrl: cover,
      mainstream: true,
    }];
  });
}
