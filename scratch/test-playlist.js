import YTMusic from 'ytmusic-api';

async function test() {
  try {
    const yt = new YTMusic();
    await yt.initialize();
    
    // We already know results[0].playlistId is 'PLOoXD-Y3d6-ymC_4tZbKxzpyPyZtW9mnc' (or VLPLOoXD-Y3d6-ymC_4tZbKxzpyPyZtW9mnc)
    // Let's call both and print
    const playlistId = 'PLOoXD-Y3d6-ymC_4tZbKxzpyPyZtW9mnc';
    console.log('Fetching playlist videos:', playlistId);
    const videos = await yt.getPlaylistVideos(playlistId);
    console.log('Videos (first 2):', JSON.stringify(videos.slice(0, 2), null, 2));
    console.log('Total videos found:', videos.length);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
