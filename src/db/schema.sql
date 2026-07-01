-- Esquema PostgreSQL de Velocity Music (uso personal).
-- Se aplica de forma idempotente.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- hash con sal (>=16 bytes, única por usuario)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id          BIGSERIAL PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL,
  position    INTEGER NOT NULL            -- orden de inserción (0..N)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist
  ON playlist_tracks (playlist_id, position);

CREATE TABLE IF NOT EXISTS favorites (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id     TEXT NOT NULL,
  favorited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)         -- unicidad => idempotencia
);

CREATE TABLE IF NOT EXISTS listening_history (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id  TEXT NOT NULL,
  played_at TIMESTAMPTZ NOT NULL          -- precisión de ms, UTC
);

CREATE INDEX IF NOT EXISTS idx_history_user_time
  ON listening_history (user_id, played_at DESC);
