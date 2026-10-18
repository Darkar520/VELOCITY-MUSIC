// The reused element can retain the old currentSrc/time while loading a new src.
// Neither native events nor watchdogs may attribute that clock to the new track.
export function ownsLoadedAudioResource(a, machine) {
  if (!a || machine.srcStatus !== 'ready' || !(a.readyState >= 1)) return false;
  const src = a.getAttribute('src');
  if (!src) return false;
  return !a.currentSrc || a.currentSrc === new URL(src, location.href).href;
}
