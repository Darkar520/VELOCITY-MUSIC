import { isDocumentVisible, isStreamUrlFresh } from '../audioContinuity.js';
import { selectPlaySync } from './audioMachine.js';
import { runAudioEffects } from './runAudioEffects.js';

// React effects can run after a Media Session action has changed the store.
// Read the current snapshot at execution; never restore src/intent from a render.
export function syncAudioElement(ctx) {
  const { audioRef, effectCtxRef, getMachine, getPlayerState,
    selfPauseRef, setLoadingAudio, vol, fadeRafRef, fadeSafetyRef,
    applySessionResume, restoreInterruptPosition } = ctx;
  const a = audioRef.current;
  if (!a) return;
  const { playSrc, track } = getPlayerState();
  const machine = getMachine();
  // Source mounting and readiness belong to STREAM_READY, including hydration.
  // A pending render must not remount a detached resource or promote readiness.
  if (track?.id !== machine.trackId || a.getAttribute('src') !== playSrc) return;
  const fresh = Boolean(playSrc && (isStreamUrlFresh(playSrc) || String(playSrc).startsWith('blob:')));
  const strategy = selectPlaySync(machine, { visible: isDocumentVisible(), audioPaused: a.paused });
  if (strategy === 'noop') return;
  if (strategy === 'pause') {
    selfPauseRef.current = true;
    try { a.pause(); } catch {}
    selfPauseRef.current = false;
    setLoadingAudio(false);
    return;
  }
  if (strategy === 'soft-play') {
    if (!fresh) return;
    if (a.volume < vol * 0.5) {
      cancelAnimationFrame(fadeRafRef.current);
      clearTimeout(fadeSafetyRef.current);
      a.volume = vol;
    }
    applySessionResume(a);
    restoreInterruptPosition(a);
    runAudioEffects([{ type: 'play' }], effectCtxRef.current);
  }
}
