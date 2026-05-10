-- Migration: create hapticai_releases table
-- Tracks HapticAI binary releases uploaded to object storage.
-- Run once against the database before deploying the upload/download endpoints.

CREATE TABLE IF NOT EXISTS hapticai_releases (
  id          SERIAL PRIMARY KEY,
  platform    TEXT        NOT NULL,          -- 'windows' | 'mac'
  version     TEXT        NOT NULL,          -- e.g. 'v1.0.0'
  size_bytes  BIGINT      NOT NULL,
  storage_key TEXT        NOT NULL,          -- GCS object path
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hapticai_releases_platform_idx
  ON hapticai_releases (platform, uploaded_at DESC);
