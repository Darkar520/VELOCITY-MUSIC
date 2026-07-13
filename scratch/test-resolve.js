import { resolveYoutubeiUrl } from '../src/extractors/youtubei.js';
import { createYtDlpExtractor } from '../src/extractors/ytdlp.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function testFetch(url, name) {
  console.log(`\nTesting fetch of ${name} URL...`);
  
  // 1. Without User-Agent (GET)
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-100' } });
    console.log('  [GET No UA] Status:', res.status, res.statusText);
  } catch (err) {
    console.error('  [GET No UA] Error:', err.message);
  }

  // 2. With Browser User-Agent (GET)
  try {
    const res = await fetch(url, { 
      method: 'GET', 
      headers: { 
        'Range': 'bytes=0-100',
        'User-Agent': UA
      } 
    });
    console.log('  [GET With UA] Status:', res.status, res.statusText);
  } catch (err) {
    console.error('  [GET With UA] Error:', err.message);
  }
}

async function main() {
  const params = {
    artist: 'System of A Down',
    title: 'Toxicity',
    quality: 'high'
  };

  console.log('--- Resolving with youtubei.js ---');
  const yiUrl = await resolveYoutubeiUrl(params);
  if (yiUrl) {
    await testFetch(yiUrl, 'Youtubei');
  } else {
    console.log('Youtubei failed to resolve');
  }

  console.log('\n--- Resolving with yt-dlp ---');
  const extractor = createYtDlpExtractor();
  const ydUrl = await extractor(params);
  if (ydUrl) {
    await testFetch(ydUrl, 'Yt-dlp');
  } else {
    console.log('Yt-dlp failed to resolve');
  }
}

main();
