import { Innertube, Platform } from 'youtubei.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

const CLIENTS = ['ANDROID', 'IOS', 'WEB', 'TV_EMBEDDED'];
const VISITOR_FILE = path.join(__dirname, '..', 'data', 'youtubei-visitor.txt');

function readVisitor() {
  try {
    if (existsSync(VISITOR_FILE)) {
      return readFileSync(VISITOR_FILE, 'utf8').trim();
    }
  } catch {}
  return null;
}

async function resolveWithClient(yt, { artist, title, videoId, quality }) {
  let targetId = videoId;
  if (!targetId) {
    const query = `${artist} - ${title}`;
    const searchResults = await yt.music.search(query, { type: 'song' });
    const firstSong = searchResults.songs?.contents?.[0];
    if (!firstSong || !firstSong.id) return null;
    targetId = firstSong.id;
  }
  const info = await yt.music.getInfo(targetId);
  const streamingInfo = await info.getStreamingInfo();
  const formats = [];
  for (const set of streamingInfo.audio_sets || []) {
    const mimeType = set.mime_type;
    const setCodecs = set.codecs || '';
    for (const rep of set.representations || []) {
      const url = rep.segment_info?.base_url || rep.base_url;
      if (!url) continue;
      formats.push({
        url,
        mime_type: `${mimeType}; codecs="${rep.codecs || setCodecs}"`,
        bitrate: rep.bitrate || 0,
      });
    }
  }
  if (!formats.length) return null;
  const opus = formats.filter((f) => f.mime_type.includes('opus'));
  if (opus.length) {
    opus.sort((a, b) => b.bitrate - a.bitrate);
    return opus[0].url;
  }
  formats.sort((a, b) => b.bitrate - a.bitrate);
  return formats[0].url;
}

async function main() {
  const visitorData = readVisitor();
  const params = {
    artist: 'System of A Down',
    title: 'Toxicity',
    quality: 'high'
  };

  for (const clientType of CLIENTS) {
    console.log(`\nTesting client: ${clientType}`);
    try {
      const createOpts = { client_type: clientType };
      if (visitorData) createOpts.visitor_data = visitorData;
      const yt = await Innertube.create(createOpts);
      const url = await resolveWithClient(yt, params);
      
      if (!url) {
        console.log(`  [${clientType}] Failed to resolve URL`);
        continue;
      }

      console.log(`  [${clientType}] Resolved URL (truncated): ${url.substring(0, 80)}...`);

      // Test fetch without User-Agent
      const res = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-100' } });
      console.log(`  [${clientType}] Fetch GET status:`, res.status, res.statusText);
      if (res.status !== 206) {
        const text = await res.text();
        console.log(`  [${clientType}] Response snippet: ${text.substring(0, 200)}`);
      }
    } catch (err) {
      console.error(`  [${clientType}] Error:`, err.message);
    }
  }
}

main();
