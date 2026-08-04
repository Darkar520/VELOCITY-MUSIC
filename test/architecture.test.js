/**
 * architecture.test.js — invariantes ARQUITECTÓNICOS que no son observables
 * desde el comportamiento de un componente.
 *
 * Reemplaza a test/appSplitStructure.test.js (batería de regex sobre el texto de
 * App.jsx). Todo lo que SÍ era observable se movió a tests de comportamiento en
 * vitest:
 *   - "los módulos extraídos importan los símbolos que usan"
 *       → frontend/src/tabs/__tests__/viewsSmoke.test.jsx (render real de
 *         DetailView/HomeTab/LibraryTab/ImportPlaylistModal) y los tests de
 *         PlayerBar/MiniPlayerBar/ExpandedPlayer/Toast/Sidebar/QueuePanel.
 *   - "AppErrorBoundary no recarga en bucle"
 *       → viewsSmoke.test.jsx ("captura el error, ofrece Reintentar y NO recarga").
 *   - "App usa playerStore/libraryStore y usePlaybackController"
 *       → frontend/src/__tests__/appShell.test.jsx (el flujo play real pasa por
 *         la machine del store y firma la URL).
 *   - "ended playback nunca espera a la red"
 *       → appShell.test.jsx ("onEnded avanza … sin esperar a la red").
 *
 * Aquí sólo quedan dos cosas que un test de comportamiento no puede ver:
 *   1. Que las capas de UI no se apropien de la política de audio (acoplamiento).
 *   2. Que parsePlaylist siga siendo el parser real (contrato de módulo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (...p) => join(root, 'frontend', 'src', ...p);

/**
 * Invariante de acoplamiento: la política de audio vive SOLO en src/audio +
 * playerStore + hooks de playback. Si un componente de UI importara la machine,
 * podría dispatchar por su cuenta y romper la matriz A7–A14 sin que ningún test
 * de render lo note.
 */
test('las capas de UI no se apropian de la política de audio', () => {
  const dirs = ['tabs', 'player', 'modals', 'screens', 'layout'];
  for (const d of dirs) {
    const dir = src(d);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.(jsx?|js)$/.test(name)) continue;
      if (name === '__tests__') continue;
      const body = readFileSync(join(dir, name), 'utf8');
      assert.doesNotMatch(
        body,
        /audioMachine|audioReduce|EXTERNAL_PAUSE|PIPELINE_DEAD|yieldAudioFocus/,
        `${d}/${name} no debe poseer política de audio`,
      );
    }
  }
});

test('parseTextPlaylist sigue siendo el parser real (no un stub)', async () => {
  const mod = await import(pathToFileURL(src('import', 'parsePlaylist.js')).href);
  const tracks = mod.parseTextPlaylist('Artist - Song Title\nAnother - Track');
  assert.ok(Array.isArray(tracks));
  assert.ok(tracks.length >= 1, 'el parser debe devolver pistas desde texto plano');
  assert.ok(tracks[0].title || tracks[0].artist, 'la pista tiene título o artista');
  assert.equal(typeof mod.SPOTIFY_BOOKMARKLET, 'string');
  assert.match(mod.SPOTIFY_BOOKMARKLET, /^javascript:/);
});

/**
 * Presupuesto de tamaño del shell. No es un test de comportamiento, es un
 * guardarraíl del objetivo del refactor: App.jsx debe quedarse en orquestación
 * (estado, dispatch, layout) y no volver a acumular efectos/handlers.
 * El límite se ajusta al cerrar el troceado (ver REFACTOR_PLAN.md).
 */
test('App.jsx se mantiene como shell de orquestación (presupuesto de líneas)', () => {
  const app = readFileSync(src('App.jsx'), 'utf8');
  const lines = app.split(/\n/).length;
  assert.ok(lines <= 1950, `App.jsx crece sin control: ${lines} líneas`);
});
