-- Esquema PostgreSQL de Velocity Music (uso personal).
-- Se aplica de forma idempotente.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- hash con sal (>=16 bytes, única por usuario)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campos de perfil y trazabilidad (idempotente).
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar       TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS play_count   INTEGER NOT NULL DEFAULT 0;

-- Álbumes guardados en la biblioteca del usuario.
CREATE TABLE IF NOT EXISTS saved_albums (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id  TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  artist    TEXT NOT NULL DEFAULT '',
  cover     TEXT NOT NULL DEFAULT '',
  year      TEXT,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, album_id)
);

-- Metadatos de pistas (sincronización de biblioteca entre dispositivos).
CREATE TABLE IF NOT EXISTS track_meta (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL DEFAULT '',
  artist           TEXT NOT NULL DEFAULT '',
  artist_id        TEXT,
  album            TEXT NOT NULL DEFAULT '',
  album_id         TEXT,
  genre            TEXT NOT NULL DEFAULT '',
  cover            TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contadores globales de uso (métricas/trazabilidad).
CREATE TABLE IF NOT EXISTS app_stats (
  metric TEXT PRIMARY KEY,
  value  BIGINT NOT NULL DEFAULT 0
);

-- Registro de búsquedas por usuario (trazabilidad).
CREATE TABLE IF NOT EXISTS search_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  q          TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_log_user_time ON search_log (user_id, created_at DESC);

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

-- Playlists externas guardadas en biblioteca (mixes/playlists de la app guardados por el usuario).
CREATE TABLE IF NOT EXISTS saved_playlists (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL,               -- ID compuesto (ej. "mix:label" o UUID generado en el cliente)
  name       TEXT NOT NULL DEFAULT '',
  cover      TEXT NOT NULL DEFAULT '',
  track_ids  TEXT[] NOT NULL DEFAULT '{}', -- IDs de las pistas en orden
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, playlist_id)
);
