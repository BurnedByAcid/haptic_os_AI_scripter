-- Migration: add video caching columns to community_scripts
-- Allows the platform to download and store community video files in GCS so
-- scripts remain playable even if the original host removes the video.
-- Run once before deploying the community media caching feature.

ALTER TABLE community_scripts
  ADD COLUMN IF NOT EXISTS cached_video_url TEXT,
  ADD COLUMN IF NOT EXISTS cache_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (cache_status IN ('pending', 'cached', 'failed'));
