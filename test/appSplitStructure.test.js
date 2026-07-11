/**
 * P1-E structural proof: UI extracted from App.jsx; shell still exports entry.
 * Real path: reads shipped source + imports plain JS parser (Node can't load JSX).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (...p) => join(root, 'frontend', 'src', ...p);

test('main.jsx still mounts App + AppErrorBoundary from App.jsx', () => {
  const main = readFileSync(src('main.jsx'), 'utf8');
  assert.match(main, /from ['"]\.\/App\.jsx['"]/);
  assert.match(main, /AppErrorBoundary/);
  assert.match(main, /\bApp\b/);
});

test('App.jsx is slim shell: still default-exports App, no inline HomeTab function', () => {
  const app = readFileSync(src('App.jsx'), 'utf8');
  assert.match(app, /export default function App/);
  assert.match(app, /export \{ AppErrorBoundary \}/);
  assert.doesNotMatch(app, /^function HomeTab\b/m);
  assert.doesNotMatch(app, /^function ExpandedPlayer\b/m);
  assert.doesNotMatch(app, /^function AuthScreen\b/m);
  assert.doesNotMatch(app, /^function QueuePanel\b/m);
  assert.match(app, /from ['"]\.\/tabs\/HomeTab\.jsx['"]/);
  assert.match(app, /from ['"]\.\/player\/ExpandedPlayer\.jsx['"]/);
  assert.match(app, /from ['"]\.\/screens\/AuthScreen\.jsx['"]/);
  assert.match(app, /audioMachine\.js/);
  assert.match(app, /dispatchAudio/);
  const lineCount = app.split(/\n/).length;
  assert.ok(lineCount < 3000, `App.jsx should be slim shell, got ${lineCount} lines`);
});

test('extracted modules exist and export named UI symbols (shipped source)', () => {
  const checks = [
    ['tabs/HomeTab.jsx', 'HomeTab'],
    ['tabs/SearchTab.jsx', 'SearchTab'],
    ['tabs/LibraryTab.jsx', 'LibraryTab'],
    ['tabs/ProfileTab.jsx', 'ProfileTab'],
    ['tabs/DetailView.jsx', 'DetailView'],
    ['tabs/WrappedView.jsx', 'WrappedView'],
    ['screens/AuthScreen.jsx', 'AuthScreen'],
    ['player/ExpandedPlayer.jsx', 'ExpandedPlayer'],
    ['player/MiniPlayerBar.jsx', 'MiniPlayerBar'],
    ['player/PlayerBar.jsx', 'PlayerBar'],
    ['player/QueuePanel.jsx', 'QueuePanel'],
    ['modals/Toast.jsx', 'Toast'],
    ['modals/TrackMenu.jsx', 'TrackMenu'],
    ['layout/Sidebar.jsx', 'Sidebar'],
    ['import/parsePlaylist.js', 'parseTextPlaylist'],
  ];
  for (const [rel, name] of checks) {
    const p = src(...rel.split('/'));
    assert.ok(existsSync(p), `missing ${rel}`);
    const body = readFileSync(p, 'utf8');
    assert.match(
      body,
      new RegExp(`export (function|const) ${name}\\b`),
      `${rel} must export ${name}`,
    );
  }
});

test('UI modules do not import audioMachine / re-own yield policy', () => {
  const dirs = ['tabs', 'player', 'modals', 'screens', 'layout'];
  for (const d of dirs) {
    const dir = src(d);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.(jsx?|js)$/.test(name)) continue;
      const body = readFileSync(join(dir, name), 'utf8');
      assert.doesNotMatch(
        body,
        /audioMachine|audioReduce|EXTERNAL_PAUSE|yieldAudioFocus/,
        `${d}/${name} must not own audio policy`,
      );
    }
  }
});

test('parseTextPlaylist is real shipped parser (not a stub)', async () => {
  const mod = await import(pathToFileURL(src('import', 'parsePlaylist.js')).href);
  const tracks = mod.parseTextPlaylist('Artist - Song Title\nAnother - Track');
  assert.ok(Array.isArray(tracks));
  assert.ok(tracks.length >= 1, 'parser must return tracks from plain text');
  assert.ok(tracks[0].title || tracks[0].artist, 'track has title or artist');
  assert.equal(typeof mod.SPOTIFY_BOOKMARKLET, 'string');
  assert.match(mod.SPOTIFY_BOOKMARKLET, /^javascript:/);
});

test('App.jsx import graph: parseTextPlaylist for startImportText', () => {
  const app = readFileSync(src('App.jsx'), 'utf8');
  assert.match(app, /import\s*\{\s*parseTextPlaylist\s*\}\s*from\s*['"]\.\/import\/parsePlaylist\.js['"]/);
  assert.match(app, /parseTextPlaylist\s*\(/);
  assert.match(app, /startImportText/);
});

test('ImportPlaylistModal imports exported SPOTIFY_BOOKMARKLET', () => {
  const modal = readFileSync(src('modals', 'ImportPlaylistModal.jsx'), 'utf8');
  assert.match(
    modal,
    /import\s*\{[^}]*SPOTIFY_BOOKMARKLET[^}]*\}\s*from\s*['"]\.\.\/import\/parsePlaylist\.js['"]/,
  );
  assert.match(modal, /SPOTIFY_BOOKMARKLET/);
  // Must not be a bare undeclared identifier only — import line required above
  const parseSrc = readFileSync(src('import', 'parsePlaylist.js'), 'utf8');
  assert.match(parseSrc, /export\s+const\s+SPOTIFY_BOOKMARKLET\s*=/);
});

/**
 * Split regression: extracted modules must import symbols they use.
 * Missing imports → ReferenceError at render → AppErrorBoundary spinner loop.
 */
test('extracted UI modules import runtime symbols they reference', () => {
  const required = [
    ['player/MiniPlayerBar.jsx', [
      [/FALLBACK_COVER/, /import\s*\{[^}]*FALLBACK_COVER[^}]*\}\s*from\s*['"]\.\.\/constants\.js['"]/],
      [/useHSwipe\s*\(/, /import\s*\{[^}]*useHSwipe[^}]*\}\s*from\s*['"]\.\.\/hooks\.js['"]/],
    ]],
    ['player/PlayerBar.jsx', [
      [/FALLBACK_COVER/, /import\s*\{[^}]*FALLBACK_COVER[^}]*\}\s*from\s*['"]\.\.\/constants\.js['"]/],
    ]],
    ['player/ExpandedPlayer.jsx', [
      [/FALLBACK_COVER/, /import\s*\{[^}]*FALLBACK_COVER[^}]*\}\s*from\s*['"]\.\.\/constants\.js['"]/],
      [/\bapi\.lyrics\b/, /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*['"]\.\.\/api\.js['"]/],
      [/\boffline\.(getLyrics|saveLyrics)\b/, /import\s+\*\s+as\s+offline\s+from\s*['"]\.\.\/offline\.js['"]/],
    ]],
    ['tabs/DetailView.jsx', [
      [/FALLBACK_COVER/, /import\s*\{[^}]*FALLBACK_COVER[^}]*\}\s*from\s*['"]\.\.\/constants\.js['"]/],
    ]],
  ];
  for (const [rel, pairs] of required) {
    const body = readFileSync(src(...rel.split('/')), 'utf8');
    for (const [usage, imp] of pairs) {
      assert.match(body, usage, `${rel} should use ${usage}`);
      assert.match(body, imp, `${rel} must import for ${usage}`);
    }
  }
});

test('AppErrorBoundary does not auto-reload in a silent spinner loop', () => {
  const app = readFileSync(src('App.jsx'), 'utf8');
  assert.doesNotMatch(
    app,
    /setTimeout\s*\(\s*\(\)\s*=>\s*window\.location\.reload/,
    'error boundary must not schedule automatic reload (infinite load symptom)',
  );
  assert.match(app, /AppErrorBoundary/);
  assert.match(app, /Reintentar|reintentar|reload/i);
});
