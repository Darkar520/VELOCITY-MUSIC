import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTrackMetadata } from '../src/repositories/trackMetaMerge.js';
import { createPgTrackMetaRepo } from '../src/repositories/postgres.js';

test('track metadata merge preserves existing values when incoming metadata is partial', () => {
  const previous = {
    id: 't1',
    title: 'Known title',
    artist: 'Known artist',
    artistId: 'a1',
    album: 'Known album',
    albumId: 'al1',
    genre: 'Rock',
    cover: 'https://img/known.jpg',
    durationSeconds: 240,
  };

  assert.deepEqual(mergeTrackMetadata(previous, { id: 't1', title: '', artist: '', duration: 0 }), previous);
});

test('track metadata merge accepts non-empty improvements without losing identifiers', () => {
  const merged = mergeTrackMetadata(
    { id: 't1', title: 'Old', artist: 'Artist', artistId: 'a1', durationSeconds: 120 },
    { id: 't1', title: 'New', cover: 'https://img/new.jpg', duration: 180 },
  );

  assert.equal(merged.title, 'New');
  assert.equal(merged.cover, 'https://img/new.jpg');
  assert.equal(merged.durationSeconds, 180);
  assert.equal(merged.artist, 'Artist');
  assert.equal(merged.artistId, 'a1');
});

test('PostgreSQL metadata upsert uses conservative field-wise updates', async () => {
  const statements = [];
  const repo = createPgTrackMetaRepo(async (sql, params) => {
    statements.push({ sql, params });
    return { rows: [] };
  });

  await repo.upsertMany([{ id: 't1', title: '', artist: '', duration: 0 }]);
  const sql = statements[0].sql;
  assert.match(sql, /title=COALESCE\(NULLIF\(EXCLUDED\.title, ''\), track_meta\.title\)/);
  assert.match(sql, /artist=COALESCE\(NULLIF\(EXCLUDED\.artist, ''\), track_meta\.artist\)/);
  assert.match(sql, /duration_seconds=CASE WHEN EXCLUDED\.duration_seconds > 0/);
});
