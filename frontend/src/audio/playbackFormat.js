// Probe once per page. Unknown capabilities retain the existing preference;
// an AAC-only profile requires affirmative AAC support, not a user-agent guess.
let browserSupport;
function support() {
  if (browserSupport) return browserSupport;
  try {
    const audio = document.createElement('audio');
    const supported = type => /^(maybe|probably)$/.test(audio.canPlayType(type));
    browserSupport = {
      webm: supported('audio/webm; codecs="opus"'),
      aac: supported('audio/mp4; codecs="mp4a.40.2"'),
    };
  } catch { browserSupport = { webm: false, aac: false }; }
  return browserSupport;
}

export function compatiblePlaybackQuality(quality, capabilities = support()) {
  const tier = quality || 'high';
  if (!['high', 'medium', 'low'].includes(tier)) return quality;
  return !capabilities.webm && capabilities.aac ? `${tier}-aac` : quality;
}

export function canUseOfflineAudio(blob, capabilities = support()) {
  // Keep existing files. A positively incompatible WebM download uses online
  // AAC when connected; it is never silently deleted or transcoded.
  return !/^((audio|video)\/webm)(;|$)/i.test(blob?.type || '')
    || capabilities.webm || !capabilities.aac;
}
