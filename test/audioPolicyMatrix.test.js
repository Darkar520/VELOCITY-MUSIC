/**
 * Matriz de política de audio (anti-regresión cruzada A7–A13).
 *
 * Cada fila es un escenario real de producto. Si un fix futuro rompe otro,
 * esta matriz debe fallar ANTES de que el usuario lo note en Chrome.
 *
 * NO editar expectativas “para que pase el test”: si el producto cambia,
 * actualiza docs/AUDIO-REGRESSIONS.md y esta matriz juntos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  shouldYieldOnExternalPause,
  mediaSessionPlaybackState,
  canRestoreInterruptPosition,
  shouldApplySessionResume,
  isStreamUrlFresh,
  canForceReacquire,
  isExternalPause,
  hideRecoverDelays,
} from '../frontend/src/audioContinuity.js';

/** @typedef {{ id: string, ids: string[], note?: string, check: () => void }} Scenario */

const scenarios = [
  // ── A7 / A11: play oculto ──
  {
    id: 'A7-hidden-yielded-no-steal',
    ids: ['A7', 'A11'],
    note: 'Instagram tiene el foco: no play() oculto',
    check() {
      assert.equal(playSyncStrategy({
        playing: true, hasSrc: true, yieldedFocus: true, visible: false,
      }), 'noop');
    },
  },
  {
    id: 'A11-hidden-not-yielded-lock-next',
    ids: ['A7', 'A11'],
    note: 'Lock screen next: play oculto SÍ (no yielded)',
    check() {
      assert.equal(playSyncStrategy({
        playing: true, hasSrc: true, yieldedFocus: false, visible: false,
      }), 'soft-play');
    },
  },
  {
    id: 'A7-visible-after-yield-resume',
    ids: ['A7', 'A4'],
    note: 'Volver a Velocity tras vídeo: soft-play',
    check() {
      assert.equal(playSyncStrategy({
        playing: true, hasSrc: true, yieldedFocus: true, visible: true,
      }), 'soft-play');
    },
  },
  {
    id: 'A13-no-src-no-play',
    ids: ['A13'],
    note: 'Sin URL fresca: noop aunque playing',
    check() {
      assert.equal(playSyncStrategy({
        playing: true, hasSrc: false, yieldedFocus: false, visible: true,
      }), 'noop');
    },
  },

  // ── Yield ──
  {
    id: 'A7-yield-on-external-pause-hidden',
    ids: ['A7'],
    check() {
      assert.equal(shouldYieldOnExternalPause({
        hidden: true, userWantsPlay: true, selfPause: false,
        pendingFade: false, audioEnded: false, alreadyYielded: false,
      }), true);
    },
  },
  {
    id: 'A7-no-yield-foreground-duck',
    ids: ['A7'],
    check() {
      assert.equal(shouldYieldOnExternalPause({
        hidden: false, userWantsPlay: true, selfPause: false,
        pendingFade: false, audioEnded: false, alreadyYielded: false,
      }), false);
    },
  },
  {
    id: 'A7-no-yield-self-pause',
    ids: ['A7', 'A13'],
    check() {
      assert.equal(shouldYieldOnExternalPause({
        hidden: true, userWantsPlay: true, selfPause: true,
        pendingFade: false, audioEnded: false, alreadyYielded: false,
      }), false);
    },
  },

  // ── A10 ancla vs A12 sesión (NO mezclar) ──
  {
    id: 'A10-no-anchor-restore-without-yield',
    ids: ['A10'],
    note: 'Seek a 0 no se clava al min 2',
    check() {
      assert.equal(canRestoreInterruptPosition({
        yieldedFocus: false, currentTime: 0, savedPosition: 154,
      }), false);
    },
  },
  {
    id: 'A10-anchor-restore-only-when-yielded',
    ids: ['A10', 'A4'],
    check() {
      assert.equal(canRestoreInterruptPosition({
        yieldedFocus: true, currentTime: 0, savedPosition: 154,
      }), true);
    },
  },
  {
    id: 'A12-session-same-track-from-zero',
    ids: ['A12'],
    note: 'Reabrir app: seek al segundo guardado',
    check() {
      assert.equal(shouldApplySessionResume({
        trackId: 'rob', resumeTrackId: 'rob', resumePosition: 50, currentTime: 0,
      }), true);
    },
  },
  {
    id: 'A12-session-not-other-track',
    ids: ['A12', 'A10'],
    note: 'Lonely Day no hereda el segundo de Aerials',
    check() {
      assert.equal(shouldApplySessionResume({
        trackId: 'lonely', resumeTrackId: 'aerials', resumePosition: 154, currentTime: 0,
      }), false);
    },
  },
  {
    id: 'A12-session-no-rewind-if-ahead',
    ids: ['A12'],
    check() {
      assert.equal(shouldApplySessionResume({
        trackId: 'rob', resumeTrackId: 'rob', resumePosition: 50, currentTime: 90,
      }), false);
    },
  },
  {
    id: 'A10-and-A12-orthogonal',
    ids: ['A10', 'A12'],
    note: 'Sin yield no ancla; sesión sí puede aplicar (sistemas distintos)',
    check() {
      assert.equal(canRestoreInterruptPosition({
        yieldedFocus: false, currentTime: 0, savedPosition: 50,
      }), false);
      assert.equal(shouldApplySessionResume({
        trackId: 'x', resumeTrackId: 'x', resumePosition: 50, currentTime: 0,
      }), true);
    },
  },

  // ── A13 URL ──
  {
    id: 'A13-stale-signed-url',
    ids: ['A13'],
    check() {
      const now = 1_700_000_000;
      assert.equal(isStreamUrlFresh(`/api/stream-proxy?exp=${now - 10}&sig=x`, now), false);
      assert.equal(isStreamUrlFresh(`/api/stream-proxy?exp=${now + 200}&sig=x`, now), true);
      assert.equal(isStreamUrlFresh('/api/stream-proxy?artist=a'), false);
    },
  },

  // ── Media Session / reacquire ──
  {
    id: 'A4-ms-playing-even-when-yielded',
    ids: ['A4', 'A7'],
    note: 'mediaSessionPlaybackState NEVER returns paused when user wants music, even if yielded',
    check() {
      assert.equal(mediaSessionPlaybackState({
        userWantsPlay: true, yieldedFocus: true,
      }), 'playing');
    },
  },
  {
    id: 'A1-force-reacquire-only-visible',
    ids: ['A1'],
    check() {
      assert.equal(canForceReacquire(false), false);
      assert.equal(canForceReacquire(true), true);
    },
  },
  {
    id: 'A13-external-pause-requires-intent',
    ids: ['A13'],
    check() {
      assert.equal(isExternalPause({
        selfPause: false, pendingFade: false, userWantsPlay: false, audioEnded: false,
      }), false);
      assert.equal(isExternalPause({
        selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
      }), true);
    },
  },

  // ── Anti soft-recover ──
  {
    id: 'A7-no-hide-recover-delays',
    ids: ['A7', 'A11'],
    note: 'Nunca reintroducir soft-recover timers en hide',
    check() {
      assert.deepEqual(hideRecoverDelays(), []);
    },
  },
];

test('matriz de política audio: todos los escenarios A7–A13', () => {
  const failed = [];
  for (const s of scenarios) {
    try {
      s.check();
    } catch (e) {
      failed.push(`${s.id} [${(s.ids || []).join(',')}] ${s.note || ''}: ${e.message}`);
    }
  }
  assert.equal(
    failed.length,
    0,
    failed.length
      ? `Fallaron ${failed.length}/${scenarios.length} escenarios:\n- ${failed.join('\n- ')}`
      : '',
  );
});

test('matriz: cobertura mínima de IDs de regresión', () => {
  const covered = new Set(scenarios.flatMap((s) => s.ids || []));
  for (const id of ['A1', 'A4', 'A7', 'A10', 'A11', 'A12', 'A13']) {
    assert.ok(covered.has(id), `falta escenario que cubra ${id}`);
  }
});
